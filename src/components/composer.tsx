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
