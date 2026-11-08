import { Camera, Loader2, Sparkles, UserRound, X } from 'lucide-react';
import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { Tooltip } from './tooltip';

export interface BannerMediaFrameProps {
  src?: string | null;
  alt?: string;
  variant?: 'standalone' | 'card-header';
  compact?: boolean;
  uploading?: boolean;
  generating?: boolean;
  disabled?: boolean;
  uploadLabel?: string;
  changeLabel?: string;
  removeLabel?: string;
  generateLabel?: string;
  regenerateLabel?: string;
  generateDescription?: string;
  onUploadFile?: (file: File) => void | Promise<void>;
  onClickUpload?: () => void;
  onRemove?: () => void;
  onGenerate?: () => void;
  headerActions?: ReactNode;
  className?: string;
}

export function BannerMediaFrame({
  src,
  alt = '',
  variant = 'standalone',
  compact = false,
  uploading = false,
  generating = false,
  disabled = false,
  uploadLabel = 'Upload banner',
  changeLabel = 'Change banner',
  removeLabel = 'Clear banner',
  generateLabel = 'Generate banner',
  regenerateLabel = 'Regenerate banner',
  generateDescription,
  onUploadFile,
  onClickUpload,
  onRemove,
  onGenerate,
  headerActions,
  className = '',
}: BannerMediaFrameProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canUpload = Boolean(onUploadFile || onClickUpload);
  const busy = Boolean(uploading || generating);
  const showGenerate = Boolean(onGenerate);
  const showClear = Boolean(src && onRemove);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onUploadFile) {
      void onUploadFile(file);
    }
  };

  const handleTriggerUpload = () => {
    if (disabled || busy) return;
    if (onClickUpload) {
      onClickUpload();
    } else if (onUploadFile) {
      inputRef.current?.click();
    }
  };

  const frameClasses = [
    'media-banner-frame',
    variant === 'card-header'
      ? 'creator-card-banner media-banner-frame--header'
      : 'media-banner-frame--standalone',
    src ? 'has-media' : '',
    canUpload ? 'is-editable' : '',
    busy ? 'is-busy' : '',
    compact ? 'is-compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={frameClasses}>
      {onUploadFile && !onClickUpload ? (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          onChange={handleFileChange}
        />
      ) : null}

      {src ? <img src={src} alt={alt} className="media-banner-img" /> : null}

      {canUpload ? (
        <Tooltip
          label={
            generating
              ? 'Generating banner...'
              : uploading
                ? 'Uploading banner...'
                : src
                  ? changeLabel
                  : uploadLabel
          }
        >
          <button
            type="button"
            className={`media-hit-overlay ${busy ? 'is-busy' : ''}`.trim()}
            aria-label={src ? changeLabel : uploadLabel}
            disabled={disabled || busy}
            onClick={handleTriggerUpload}
          >
            <span className="media-hit-glyph" aria-hidden="true">
              {busy ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
            </span>
          </button>
        </Tooltip>
      ) : busy ? (
        <span className="media-busy-scrim" aria-hidden="true">
          <Loader2 size={15} className="spin" />
        </span>
      ) : null}

      {showClear || showGenerate ? (
        <div className="media-corner-actions">
          {showClear ? (
            <Tooltip label={removeLabel}>
              <button
                type="button"
                className="media-corner-btn media-corner-btn--clear"
                aria-label={removeLabel}
                disabled={disabled || busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove?.();
                }}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}

          {showGenerate ? (
            <Tooltip
              label={
                generating
                  ? 'Generating banner...'
                  : src
                    ? regenerateLabel
                    : generateLabel
              }
              description={generateDescription}
            >
              <button
                type="button"
                className="media-corner-btn media-corner-btn--generate"
                aria-label={src ? regenerateLabel : generateLabel}
                disabled={disabled || busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerate?.();
                }}
              >
                {generating ? (
                  <Loader2 size={11} className="spin" aria-hidden="true" />
                ) : (
                  <Sparkles size={11} aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {headerActions ? (
        <div className="media-corner-actions creator-card-banner-actions">{headerActions}</div>
      ) : null}
    </div>
  );
}

export interface AvatarMediaFrameProps {
  src?: string | null;
  alt?: string;
  uploading?: boolean;
  generating?: boolean;
  disabled?: boolean;
  uploadLabel?: string;
  changeLabel?: string;
  removeLabel?: string;
  generateLabel?: string;
  regenerateLabel?: string;
  generateDescription?: string;
  onUploadFile?: (file: File) => void | Promise<void>;
  onClickUpload?: () => void;
  onRemove?: () => void;
  onGenerate?: () => void;
  className?: string;
}

export function AvatarMediaFrame({
  src,
  alt = '',
  uploading = false,
  generating = false,
  disabled = false,
  uploadLabel = 'Upload avatar',
  changeLabel = 'Change avatar',
  removeLabel = 'Clear avatar',
  generateLabel = 'Generate avatar',
  regenerateLabel = 'Regenerate avatar',
  generateDescription,
  onUploadFile,
  onClickUpload,
  onRemove,
  onGenerate,
  className = '',
}: AvatarMediaFrameProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canUpload = Boolean(onUploadFile || onClickUpload);
  const busy = Boolean(uploading || generating);
  const showGenerate = Boolean(onGenerate);
  const showClear = Boolean(src && onRemove);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file && onUploadFile) {
      void onUploadFile(file);
    }
  };

  const handleTriggerUpload = () => {
    if (disabled || busy) return;
    if (onClickUpload) {
      onClickUpload();
    } else if (onUploadFile) {
      inputRef.current?.click();
    }
  };

  const circleClasses = [
    'media-avatar-circle',
    'creator-card-avatar',
    canUpload ? 'is-editable' : '',
    busy ? 'is-busy' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`media-avatar-wrap ${className}`.trim()}>
      {onUploadFile && !onClickUpload ? (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          onChange={handleFileChange}
        />
      ) : null}

      <div className={circleClasses}>
        {src ? (
          <img src={src} alt={alt} className="media-avatar-img" />
        ) : (
          <UserRound size={20} aria-hidden="true" />
        )}

        {canUpload ? (
          <Tooltip
            label={
              generating
                ? 'Generating avatar...'
                : uploading
                  ? 'Uploading avatar...'
                  : src
                    ? changeLabel
                    : uploadLabel
            }
          >
            <button
              type="button"
              className={`media-hit-overlay media-hit-overlay--circle ${busy ? 'is-busy' : ''}`.trim()}
              aria-label={src ? changeLabel : uploadLabel}
              disabled={disabled || busy}
              onClick={handleTriggerUpload}
            >
              <span className="media-hit-glyph" aria-hidden="true">
                {busy ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
              </span>
            </button>
          </Tooltip>
        ) : busy ? (
          <span className="media-busy-scrim media-busy-scrim--circle" aria-hidden="true">
            <Loader2 size={13} className="spin" />
          </span>
        ) : null}
      </div>

      {showGenerate ? (
        <Tooltip
          label={
            generating
              ? 'Generating avatar...'
              : src
                ? regenerateLabel
                : generateLabel
          }
          description={generateDescription}
        >
          <button
            type="button"
            className="media-corner-btn media-corner-btn--avatar media-corner-btn--avatar-top media-corner-btn--generate"
            aria-label={src ? regenerateLabel : generateLabel}
            disabled={disabled || busy}
            onClick={(event) => {
              event.stopPropagation();
              onGenerate?.();
            }}
          >
            {generating ? (
              <Loader2 size={10} className="spin" aria-hidden="true" />
            ) : (
              <Sparkles size={10} aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      ) : null}

      {showClear ? (
        <Tooltip label={removeLabel}>
          <button
            type="button"
            className={`media-corner-btn media-corner-btn--avatar ${
              showGenerate ? 'media-corner-btn--avatar-bottom' : 'media-corner-btn--avatar-top'
            } media-corner-btn--clear`}
            aria-label={removeLabel}
            disabled={disabled || busy}
            onClick={(event) => {
              event.stopPropagation();
              onRemove?.();
            }}
          >
            <X size={10} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
