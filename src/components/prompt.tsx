import { useEffect, useMemo, useState } from 'react';
import type { MissingInputRequirement, WorkflowAttachment } from '../lib/api';
import { RunComposer } from './composer';
import { Modal } from './modal';

export interface PromptProps {
  open: boolean;
  missing: MissingInputRequirement[];
  initialPrompt: string;
  initialAttachments: WorkflowAttachment[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (next: { prompt: string; attachments: WorkflowAttachment[] }) => void;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraftPrompt(initialPrompt);
      setDraftAttachments(initialAttachments);
      setError(null);
    }
  }, [open, initialPrompt, initialAttachments, missing]);

  const acceptedInputs = useMemo<string[] | undefined>(() => {
    const set = new Set<string>();
    for (const item of missing) {
      for (const mod of item.acceptedInputs) {
        if (mod) set.add(mod);
      }
    }
    return set.size > 0 ? Array.from(set) : undefined;
  }, [missing]);

  const handleContinue = (overrideAttachments?: WorkflowAttachment[]) => {
    const nextAttachments = overrideAttachments ?? draftAttachments;
    const trimmedPrompt = draftPrompt.trim();

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
        (item.questions && item.questions.length > 0) &&
        !trimmedPrompt &&
        nextAttachments.length === 0
      ) {
        setError('Enter a response or attach a file to continue.');
        return;
      }
    }

    if (!trimmedPrompt && nextAttachments.length === 0) {
      setError('Provide the requested input to continue.');
      return;
    }

    setError(null);
    onSubmit({ prompt: draftPrompt, attachments: nextAttachments });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Provide Required Input"
      size="md"
    >
      <div className="modal-form">
        <p className="credentials-intro">
          Provide the required input below to continue running this workflow.
        </p>

        <div className="credentials-list">
          {missing.map((item) => (
            <div key={`${item.stepId}-${item.modelId ?? 'clarify'}`} className="credential-card">
              <div className="credential-card-head">
                <div className="credential-card-title-row">
                  <span className="credential-card-name">
                    {item.modelName || item.stepLabel}
                  </span>
                  {item.acceptedInputs.length > 0 ? (
                    item.acceptedInputs.map((mod) => (
                      <span key={mod} className="status-pill">
                        {mod.toUpperCase()}
                      </span>
                    ))
                  ) : (
                    <span className="status-pill">CLARIFY</span>
                  )}
                </div>
                <p className="credential-card-reason">{item.reason}</p>
                {(() => {
                  const distinctQuestions = (item.questions ?? []).filter(
                    (question) => question.trim() && question.trim() !== item.reason.trim(),
                  );
                  return distinctQuestions.length > 0 ? (
                    <div className="credential-vars-box">
                      {distinctQuestions.map((question) => (
                        <p key={question} className="credential-card-reason">
                          {question}
                        </p>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          ))}
        </div>

        <RunComposer
          compact
          label="Input"
          value={draftPrompt}
          onChange={setDraftPrompt}
          attachments={draftAttachments}
          onAttachmentsChange={setDraftAttachments}
          acceptedInputs={acceptedInputs}
          placeholder="Answer, attach a file, or record audio..."
          busy={busy}
          submitLabel="Continue"
          busyLabel="Running..."
          onSubmit={(overrideAttachments) => handleContinue(overrideAttachments)}
          errorText={error}
        />

        <div className="modal-footer">
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
