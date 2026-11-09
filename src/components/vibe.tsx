import { ArrowRight, Loader2, Sparkles, Square } from 'lucide-react';

export interface VibeProps {
  value?: string;
  brief?: string;
  onChange?: (value: string) => void;
  onChangeBrief?: (value: string) => void;
  onBuildCanvas?: (prompt: string) => void;
  onGenerate?: (prompt: string) => void;
  onOpenCanvas?: () => void;
  onSwitchToCanvas?: () => void;
  stepCount: number;
  busy?: boolean;
  statusText?: string | null;
  streamPreview?: string;
  errorText?: string | null;
  onCancel?: () => void;
}

const STARTERS = [
  'Monitor competitor announcements, summarize key changes, and draft an alert.',
  'Fetch token market data, analyze risk signals, and output a structured brief.',
  'Extract action items from meeting notes and format a team update.',
] as const;

export function Vibe({
  value,
  brief,
  onChange,
  onChangeBrief,
  onBuildCanvas,
  onGenerate,
  onOpenCanvas,
  onSwitchToCanvas,
  stepCount,
  busy = false,
  statusText,
  streamPreview,
  errorText,
  onCancel,
}: VibeProps) {
  const text = value ?? brief ?? '';
  const handleChange = onChange ?? onChangeBrief;
  const handleGenerate = onBuildCanvas ?? onGenerate;
  const handleSwitch = onOpenCanvas ?? onSwitchToCanvas;

  return (
    <section className="vibe-stage" aria-label="Vibe prompt builder">
      <div className="vibe-card stealth-glass">
        <header className="vibe-header">
          <span className="vibe-badge">● VIBE</span>
          <span className="vibe-meta">
            {stepCount} {stepCount === 1 ? 'STEP' : 'STEPS'} IN CANVAS
          </span>
        </header>

        <textarea
          className="vibe-textarea"
          aria-label="Workflow prompt"
          value={text}
          disabled={busy}
          placeholder="Describe what you want to build..."
          onChange={(event) => handleChange?.(event.target.value)}
        />

        {busy || statusText || streamPreview ? (
          <div className="vibe-live-bar" aria-live="polite">
            <div className="vibe-live-status">
              {busy ? <Loader2 size={13} className="spin" /> : null}
              <span>{statusText || (busy ? 'Designing workflow...' : 'Ready')}</span>
            </div>
            {streamPreview ? <p className="vibe-live-preview">{streamPreview}</p> : null}
          </div>
        ) : null}

        {errorText ? (
          <p className="form-error" role="alert">
            {errorText}
          </p>
        ) : null}

        <div className="vibe-starters">
          {STARTERS.map((sample) => (
            <button
              key={sample}
              type="button"
              className="vibe-starter-chip"
              disabled={busy}
              onClick={() => handleChange?.(sample)}
            >
              {sample}
            </button>
          ))}
        </div>

        <footer className="vibe-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleSwitch}>
            Canvas
            <ArrowRight size={13} />
          </button>
          <div className="vibe-footer-actions">
            {busy && onCancel ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
                <Square size={12} />
                <span>Stop</span>
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !text.trim()}
              onClick={() => handleGenerate?.(text)}
            >
              {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              <span>{busy ? 'Building...' : 'Create'}</span>
            </button>
          </div>
        </footer>
      </div>
    </section>
  );
}
