import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Clarification, MissingInputRequirement, WorkflowAttachment } from '../lib/api';
import { RunComposer } from './composer';
import { Modal } from './modal';

export interface PromptProps {
  open: boolean;
  missing: MissingInputRequirement[];
  initialPrompt: string;
  initialAttachments: WorkflowAttachment[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (next: {
    prompt: string;
    attachments: WorkflowAttachment[];
    skipClarify?: boolean;
  }) => void;
}

function normalizePromptItems(req: MissingInputRequirement): Clarification[] {
  if (req.items && req.items.length > 0) {
    return req.items;
  }
  const questions = (req.questions ?? []).filter((q) => q.trim().length > 0);
  if (questions.length > 0) {
    return questions.map((question, idx) => ({
      id: `${req.stepId}-q-${idx}`,
      stepId: req.stepId,
      stepTitle: req.modelName || req.stepLabel,
      question,
      acceptedInputs: req.acceptedInputs,
    }));
  }
  return [
    {
      id: `${req.stepId}-reason`,
      stepId: req.stepId,
      stepTitle: req.modelName || req.stepLabel,
      question: req.reason,
      acceptedInputs: req.acceptedInputs,
    },
  ];
}

export function Prompt({
  open,
  missing,
  initialPrompt,
  initialAttachments,
  busy = false,
  onClose,
  onSubmit,
}: PromptProps) {
  const [draftPrompt, setDraftPrompt] = useState(initialPrompt);
  const [draftAttachments, setDraftAttachments] =
    useState<WorkflowAttachment[]>(initialAttachments);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraftPrompt(initialPrompt);
      setDraftAttachments(initialAttachments);
      setSelectedOptions({});
      setError(null);
    }
  }, [open, initialPrompt, initialAttachments, missing]);

  const acceptedInputs = useMemo<string[] | undefined>(() => {
    const set = new Set<string>();
    for (const item of missing) {
      for (const mod of item.acceptedInputs) {
        if (mod) set.add(mod);
      }
      for (const sub of item.items ?? []) {
        for (const mod of sub.acceptedInputs ?? []) {
          if (mod) set.add(mod);
        }
      }
    }
    return set.size > 0 ? Array.from(set) : undefined;
  }, [missing]);

  const canSkipWithDefaults = useMemo(
    () =>
      missing.length > 0 &&
      missing.every(
        (m) =>
          m.canSkipWithDefaults !== false &&
          !(m.acceptedInputs.some((mod) => mod !== 'text') && !m.acceptedInputs.includes('text')),
      ),
    [missing],
  );

  const composeEffectivePrompt = (basePrompt: string): string => {
    const pickedLines: string[] = [];
    for (const req of missing) {
      for (const item of normalizePromptItems(req)) {
        const chosen = selectedOptions[item.id];
        if (chosen) {
          pickedLines.push(`${item.question} ${chosen}`);
        }
      }
    }
    return [basePrompt.trim(), ...pickedLines].filter(Boolean).join('\n');
  };

  const handleContinue = (overrideAttachments?: WorkflowAttachment[]) => {
    const nextAttachments = overrideAttachments ?? draftAttachments;
    const mergedPrompt = composeEffectivePrompt(draftPrompt);

    for (const item of missing) {
      const nonText = item.acceptedInputs.filter((mod) => mod !== 'text');
      const acceptsText = item.acceptedInputs.includes('text');
      if (nonText.length > 0 && !acceptsText) {
        const satisfied = nextAttachments.some(
          (att) => nonText.includes('file') || nonText.includes(att.type),
        );
        if (!satisfied) {
          setError(
            `Attach or record ${nonText.join(' / ')} for "${item.modelName || item.stepLabel}".`,
          );
          return;
        }
      } else if (
        ((item.questions && item.questions.length > 0) || (item.items && item.items.length > 0)) &&
        !mergedPrompt &&
        nextAttachments.length === 0
      ) {
        setError('Select an option, enter a response, or attach a file to continue.');
        return;
      }
    }

    if (!mergedPrompt && nextAttachments.length === 0) {
      setError('Provide the requested input to continue.');
      return;
    }

    setError(null);
    onSubmit({ prompt: mergedPrompt, attachments: nextAttachments });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Coordinator Clarification"
      size="md"
    >
      <div className="modal-form">
        <p className="credentials-intro">
          {missing[0]?.context ||
            'Answer or pick quick options below so the Coordinator can tailor this workflow run.'}
        </p>

        <div className="credentials-list">
          {missing.flatMap((req) =>
            normalizePromptItems(req).map((item) => (
              <div key={item.id} className="credential-card">
                <div className="credential-card-head">
                  <div className="credential-card-title-row">
                    <span className="credential-card-name">
                      {item.stepTitle || req.modelName || req.stepLabel || 'Coordinator'}
                    </span>
                    {(item.acceptedInputs ?? req.acceptedInputs).length > 0 ? (
                      (item.acceptedInputs ?? req.acceptedInputs).map((mod) => (
                        <span key={mod} className="status-pill">
                          {mod.toUpperCase()}
                        </span>
                      ))
                    ) : (
                      <span className="status-pill">CLARIFY</span>
                    )}
                  </div>
                  <p className="credential-card-reason">{item.question}</p>
                  {item.defaultHint ? (
                    <span className="wf-default-hint">Default: {item.defaultHint}</span>
                  ) : null}
                  {item.options && item.options.length > 0 ? (
                    <div className="wf-options-row" role="group" aria-label={item.question}>
                      {item.options.map((opt) => {
                        const active = selectedOptions[item.id] === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            className={`chip-btn ${active ? 'is-active' : ''}`}
                            aria-pressed={active}
                            disabled={busy}
                            onClick={() =>
                              setSelectedOptions((prev) => {
                                const next = { ...prev };
                                if (next[item.id] === opt) delete next[item.id];
                                else next[item.id] = opt;
                                return next;
                              })
                            }
                          >
                            <span>{opt}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            )),
          )}
        </div>

        <RunComposer
          compact
          label="Response"
          value={draftPrompt}
          onChange={setDraftPrompt}
          attachments={draftAttachments}
          onAttachmentsChange={setDraftAttachments}
          acceptedInputs={acceptedInputs}
          placeholder="Add details, attach a file, or record audio..."
          busy={busy}
          submitLabel="Continue"
          busyLabel="Running..."
          onSubmit={(overrideAttachments) => handleContinue(overrideAttachments)}
          errorText={error}
        />

        <div className="modal-footer">
          {canSkipWithDefaults ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                onSubmit({
                  prompt: composeEffectivePrompt(draftPrompt) || 'Proceed with smart defaults.',
                  attachments: draftAttachments,
                  skipClarify: true,
                });
              }}
            >
              <Sparkles size={13} aria-hidden="true" />
              <span>Use smart defaults & run</span>
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
