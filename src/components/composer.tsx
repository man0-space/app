import {
  Check,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  Play,
  Plus,
  Send,
  Square,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type WorkflowAttachment } from '../lib/api';

export const ACCEPT_ATTR =
  'image/*,audio/*,video/*,application/pdf,.pdf,.txt,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,.xml,.html,.log';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const TARGET_WAV_SAMPLE_RATE = 16_000;

const MODALITY_ACCEPT_MIME: Record<string, string> = {
  image: 'image/*',
  audio: 'audio/*',
  video: 'video/*',
  pdf: 'application/pdf,.pdf',
  text: '.txt,.md,.markdown,.csv,.tsv,.yaml,.yml,.xml,.html,.log',
  json: 'application/json,.json',
  file: ACCEPT_ATTR,
};

export function buildAcceptAttrFromSdkInputs(acceptedInputs?: readonly string[]): string {
  if (!acceptedInputs || acceptedInputs.length === 0) return ACCEPT_ATTR;
  if (acceptedInputs.includes('file')) return ACCEPT_ATTR;
  const parts: string[] = [];
  for (const mod of acceptedInputs) {
    const mapped = MODALITY_ACCEPT_MIME[mod];
    if (mapped) parts.push(mapped);
  }
  return parts.length > 0 ? parts.join(',') : ACCEPT_ATTR;
}

interface PendingUpload {
  id: string;
  name: string;
  size: number;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function pickSupportedRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function encodeMonoPcm16WavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format = 1
  view.setUint16(22, 1, true); // Mono = 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate = sampleRate * blockAlign
  view.setUint16(32, 2, true); // blockAlign = 1 * 2 bytes
  view.setUint16(34, 16, true); // bitsPerSample = 16
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeMonoPcm16WavBuffer(samples, sampleRate)], { type: 'audio/wav' });
}

export function resampleFloat32Linear(
  samples: Float32Array,
  srcRate: number,
  targetRate: number,
): Float32Array {
  if (srcRate === targetRate || samples.length === 0) return samples;
  const ratio = srcRate / targetRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(samples.length - 1, left + 1);
    const frac = pos - left;
    out[i] = (samples[left] ?? 0) * (1 - frac) + (samples[right] ?? 0) * frac;
  }
  return out;
}

function downmixAndResampleLinear(audioBuffer: AudioBuffer, targetRate: number): Float32Array {
  const channels = audioBuffer.numberOfChannels;
  const srcLength = audioBuffer.length;
  const mono = new Float32Array(srcLength);
  for (let ch = 0; ch < channels; ch += 1) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < srcLength; i += 1) {
      mono[i] = (mono[i] ?? 0) + (channelData[i] ?? 0) / channels;
    }
  }
  return resampleFloat32Linear(mono, audioBuffer.sampleRate, targetRate);
}

export async function transcodeBlobToWav16k(
  rawBlob: Blob,
  stamp: string,
): Promise<{ blob: Blob; fileName: string }> {
  const AudioCtx =
    typeof window !== 'undefined'
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;

  if (!AudioCtx) {
    const ext = rawBlob.type.includes('mp4') ? 'm4a' : 'webm';
    return { blob: rawBlob, fileName: `voice-${stamp}.${ext}` };
  }

  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await rawBlob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const samples = downmixAndResampleLinear(decoded, TARGET_WAV_SAMPLE_RATE);
    return {
      blob: encodeMonoPcm16Wav(samples, TARGET_WAV_SAMPLE_RATE),
      fileName: `voice-${stamp}.wav`,
    };
  } catch {
    const ext = rawBlob.type.includes('mp4') ? 'm4a' : 'webm';
    return { blob: rawBlob, fileName: `voice-${stamp}.${ext}` };
  } finally {
    void ctx.close().catch(() => {});
  }
}
