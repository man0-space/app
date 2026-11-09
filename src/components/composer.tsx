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

type RecordStopIntent = 'attach' | 'send' | 'cancel';

export interface RunComposerProps {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  attachments: WorkflowAttachment[];
  onAttachmentsChange: (
    updater: WorkflowAttachment[] | ((prev: WorkflowAttachment[]) => WorkflowAttachment[]),
  ) => void;
  acceptedInputs?: readonly string[];
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  submitDisabled?: boolean;
  submitLabel?: string;
  busyLabel?: string;
  onSubmit: (overrideAttachments?: WorkflowAttachment[]) => void;
  onAuthRequired?: () => boolean;
  secondaryAction?: ReactNode;
  beforeSubmitContent?: ReactNode;
  toolbarMeta?: ReactNode;
  errorText?: string | null;
  compact?: boolean;
  floating?: boolean;
}

export function RunComposer({
  label = 'Input',
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  acceptedInputs,
  placeholder = 'Enter prompt, attach files, or record voice...',
  disabled = false,
  busy = false,
  submitDisabled = false,
  submitLabel = 'Run',
  busyLabel = 'Running...',
  onSubmit,
  onAuthRequired,
  secondaryAction,
  beforeSubmitContent,
  toolbarMeta,
  errorText,
  compact = false,
  floating = false,
}: RunComposerProps) {
  const textareaId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordStopIntentRef = useRef<RecordStopIntent>('attach');

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const dynamicAccept = useMemo(
    () => buildAcceptAttrFromSdkInputs(acceptedInputs),
    [acceptedInputs],
  );

  const cleanupRecordingResources = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecordingResources();
    };
  }, [cleanupRecordingResources]);

  const uploadSingleBlob = useCallback(
    async (blob: Blob, explicitName: string): Promise<WorkflowAttachment | null> => {
      if (onAuthRequired && !onAuthRequired()) {
        return null;
      }
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        setLocalError(`"${explicitName}" exceeds the 20 MB limit.`);
        return null;
      }
      setLocalError(null);
      const pendingId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPendingUploads(prev => [...prev, { id: pendingId, name: explicitName, size: blob.size }]);
      try {
        const pinned = await api.uploadAttachment(blob, explicitName);
        onAttachmentsChange(prev => [...prev, pinned]);
        return pinned;
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : `Failed to upload ${explicitName}.`);
        return null;
      } finally {
        setPendingUploads(prev => prev.filter(item => item.id !== pendingId));
      }
    },
    [onAttachmentsChange, onAuthRequired],
  );

  const handleFilesSelected = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      await Promise.all(list.map(file => uploadSingleBlob(file, file.name)));
    },
    [uploadSingleBlob],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        void handleFilesSelected(event.target.files);
      }
      event.target.value = '';
    },
    [handleFilesSelected],
  );

  const stopRecordingWithIntent = useCallback(
    (intent: RecordStopIntent) => {
      recordStopIntentRef.current = intent;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        cleanupRecordingResources();
        setIsRecording(false);
        setRecordingSeconds(0);
      }
    },
    [cleanupRecordingResources],
  );

  const startRecording = useCallback(async () => {
    if (onAuthRequired && !onAuthRequired()) {
      return;
    }
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setLocalError('Microphone recording is not available in this browser.');
      return;
    }

    setLocalError(null);
    recordStopIntentRef.current = 'attach';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickSupportedRecorderMime();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (evt: BlobEvent) => {
        if (evt.data && evt.data.size > 0) {
          chunksRef.current.push(evt.data);
        }
      };

      recorder.onstop = () => {
        const intent = recordStopIntentRef.current;
        recordStopIntentRef.current = 'attach';
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
        const rawBlob = new Blob(chunksRef.current, { type: recordedMime });
        chunksRef.current = [];
        cleanupRecordingResources();
        setIsRecording(false);
        setRecordingSeconds(0);

        if (intent === 'cancel' || rawBlob.size === 0) return;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
        void transcodeBlobToWav16k(rawBlob, stamp).then(async ({ blob, fileName }) => {
          const uploaded = await uploadSingleBlob(blob, fileName);
          if (uploaded && intent === 'send') {
            const nextList = [
              ...attachmentsRef.current.filter(a => a.url !== uploaded.url),
              uploaded,
            ];
            onSubmitRef.current(nextList);
          }
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);
    } catch (err) {
      cleanupRecordingResources();
      setIsRecording(false);
      setLocalError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access to record voice.'
          : 'Could not start microphone recording.',
      );
    }
  }, [cleanupRecordingResources, onAuthRequired, uploadSingleBlob]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      stopRecordingWithIntent('attach');
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecordingWithIntent]);

  const removeAttachment = useCallback(
    (url: string) => {
      onAttachmentsChange(prev => prev.filter(item => item.url !== url));
    },
    [onAttachmentsChange],
  );

  const isUploading = pendingUploads.length > 0;
  const effectiveSubmitDisabled =
    disabled || busy || isUploading || isRecording || submitDisabled;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        if (!effectiveSubmitDisabled) {
          onSubmit();
        }
      }
    },
    [effectiveSubmitDisabled, onSubmit],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = event.clipboardData?.files;
      if (files && files.length > 0) {
        const plain = event.clipboardData.getData('text/plain');
        if (!plain) {
          event.preventDefault();
        }
        void handleFilesSelected(files);
      }
    },
    [handleFilesSelected],
  );

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (disabled || busy) return;
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault();
        setIsDragging(true);
      }
    },
    [busy, disabled],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setIsDragging(false);
      if (disabled || busy) return;
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        event.preventDefault();
        void handleFilesSelected(event.dataTransfer.files);
      }
    },
    [busy, disabled, handleFilesSelected],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!effectiveSubmitDisabled) {
        onSubmit();
      }
    },
    [effectiveSubmitDisabled, onSubmit],
  );

  const combinedError = useMemo(() => {
    const raw = (errorText || localError || '').trim();
    if (!raw) return null;
    const half = Math.floor(raw.length / 2);
    if (raw.length >= 6) {
      const left = raw.slice(0, half).trim();
      const right = raw.slice(half).trim();
      if (left && left === right) return left;
    }
    const lines = Array.from(
      new Set(
        raw
          .split(/\r?\n+/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    );
    return lines.join(' ');
  }, [errorText, localError]);

  const showHeadRow =
    !floating ||
    Boolean(acceptedInputs && acceptedInputs.length > 0) ||
    attachments.length > 0;

  return (
    <form
      className={`run-composer ${compact ? 'is-compact' : ''} ${floating ? 'is-floating' : ''}`.trim()}
      onSubmit={handleFormSubmit}
    >
      {showHeadRow ? (
        <div className="run-composer-head">
          <div className="run-composer-label-group">
            <label htmlFor={textareaId} className="field-label">
              {label}
            </label>
            {acceptedInputs && acceptedInputs.length > 0 ? (
              <div className="run-sdk-input-badges" aria-label="Accepted step inputs">
                {acceptedInputs.map(modality => (
                  <span key={modality} className="status-pill">
                    {modality.toUpperCase()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {attachments.length > 0 ? (
            <span className="run-composer-count">
              {attachments.length} {attachments.length === 1 ? 'file' : 'files'} attached
            </span>
          ) : null}
        </div>
      ) : (
        <label htmlFor={textareaId} className="sr-only-input">
          {label}
        </label>
      )}

      <div
        className={`run-composer-box ${isDragging ? 'is-dragging' : ''} ${isRecording ? 'is-recording' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {attachments.length > 0 || pendingUploads.length > 0 ? (
          <div className="run-attachment-strip" role="list" aria-label="Attached files">
            {attachments.map(att => (
              <div
                key={att.url}
                className={`run-attachment-chip ${att.type === 'audio' ? 'is-audio' : ''}`}
                role="listitem"
              >
                {att.type === 'image' ? (
                  <img src={att.url} alt="" className="run-attachment-thumb" />
                ) : att.type === 'audio' ? (
                  <audio
                    controls
                    preload="metadata"
                    src={att.url}
                    className="run-attachment-audio-player"
                  />
                ) : att.type === 'video' ? (
                  <Film size={13} className="run-attachment-icon" aria-hidden="true" />
                ) : att.type === 'pdf' || att.type === 'text' ? (
                  <FileText size={13} className="run-attachment-icon" aria-hidden="true" />
                ) : att.type === 'file' ? (
                  <Paperclip size={13} className="run-attachment-icon" aria-hidden="true" />
                ) : (
                  <ImageIcon size={13} className="run-attachment-icon" aria-hidden="true" />
                )}

                <span
                  className="run-attachment-meta"
                  title={`${att.name ?? att.type} (${formatBytes(att.size ?? 0)})`}
                >
                  <span className="run-attachment-name">{att.name ?? att.type}</span>
                  <span className="run-attachment-size">{formatBytes(att.size ?? 0)}</span>
                </span>

                <button
                  type="button"
                  className="run-attachment-remove"
                  aria-label={`Remove ${att.name ?? att.type}`}
                  disabled={busy}
                  onClick={() => removeAttachment(att.url)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            ))}

            {pendingUploads.map(item => (
              <div key={item.id} className="run-attachment-chip is-uploading" role="listitem">
                <LoaderCircle size={13} className="spin" aria-hidden="true" />
                <span className="run-attachment-meta">
                  <span className="run-attachment-name">{item.name}</span>
                  <span className="run-attachment-size">Pinning...</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          id={textareaId}
          className="run-composer-textarea"
          rows={floating ? 1 : compact ? 3 : 2}
          value={value}
          disabled={disabled || busy}
          placeholder={placeholder}
          onChange={event => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />

        <div className="run-composer-toolbar">
          <div className="run-composer-tools">
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              multiple
              accept={dynamicAccept}
              className="sr-only-input"
              tabIndex={-1}
              aria-label="Upload attachment files"
              onChange={handleFileInputChange}
            />

            <button
              type="button"
              className="run-tool-btn"
              aria-label="Attach files"
              title="Attach file"
              disabled={disabled || busy || isRecording}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={15} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`run-tool-btn ${isRecording ? 'is-recording' : ''}`}
              aria-label={isRecording ? 'Stop and attach voice recording' : 'Record voice audio'}
              aria-pressed={isRecording}
              title={
                isRecording
                  ? 'Stop recording and attach WAV audio'
                  : 'Record voice audio (.wav)'
              }
              disabled={disabled || busy}
              onClick={() => void toggleRecording()}
            >
              {isRecording ? (
                <Square size={12} aria-hidden="true" />
              ) : (
                <Mic size={15} aria-hidden="true" />
              )}
            </button>

            {toolbarMeta}

            {isRecording ? (
              <div className="run-recording-pill" role="status" aria-live="polite">
                <span className="run-recording-dot" aria-hidden="true" />
                <span className="run-recording-timer">{formatDuration(recordingSeconds)}</span>
                <div className="run-recording-actions">
                  <button
                    type="button"
                    className="run-rec-action-btn"
                    aria-label="Cancel voice recording"
                    title="Cancel recording"
                    onClick={() => stopRecordingWithIntent('cancel')}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="run-rec-action-btn is-attach"
                    aria-label="Stop and attach WAV audio"
                    title="Attach WAV audio"
                    onClick={() => stopRecordingWithIntent('attach')}
                  >
                    <Check size={12} aria-hidden="true" />
                    <span>Attach</span>
                  </button>
                  <button
                    type="button"
                    className="run-rec-action-btn is-send"
                    aria-label="Stop recording and run workflow"
                    title="Record & Send"
                    onClick={() => stopRecordingWithIntent('send')}
                  >
                    <Send size={11} aria-hidden="true" />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="run-composer-actions">
            {secondaryAction}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={effectiveSubmitDisabled}
            >
              {busy || isUploading ? (
                <LoaderCircle size={14} className="spin" aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              <span>{isUploading ? 'Pinning...' : busy ? busyLabel : submitLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {beforeSubmitContent}

      {combinedError ? (
        <p className="form-error" role="alert">
          {combinedError}
        </p>
      ) : null}
    </form>
  );
}
