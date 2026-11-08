import { Loader2, Share2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../contexts/auth';
import { api } from '../lib/api';
import { mintWorkflowOnChain } from '../lib/contracts';
import { buildWorkflowCardMetadata, uploadWorkflowMetadata } from '../lib/pinata';
import type { Coordinator, Flow, Listing, Terms } from '../lib/schema';
import { CoordinatorField } from './coordinator';
import { Modal } from './modal';
import { TaskPicker } from './tags';

interface PublishProps {
  open: boolean;
  onClose: () => void;
  flow: Flow;
  onPublished: (workflow: Listing) => void;
}

const DEFAULT_CREATOR_FEES = [1, 2, 3];

export function Publish({ open, onClose, flow, onPublished }: PublishProps) {
  const { user, config, openAuthModal } = useAuth();
  const feeOptions =
    config?.fees?.creatorOptions && config.fees.creatorOptions.length > 0
      ? config.fees.creatorOptions
      : DEFAULT_CREATOR_FEES;
  const platformFeePercent = config?.fees?.platformPercent ?? 2;

  const [title, setTitle] = useState(flow.name || '');
  const [description, setDescription] = useState(flow.brief || '');
  const [selectedTasks, setSelectedTasks] = useState<string[]>(() => flow.tasks ?? []);
  const [selectedCoordinator, setSelectedCoordinator] = useState<Coordinator | null>(
    () => flow.coordinator ?? null,
  );
  const [feePercent, setFeePercent] = useState<number>(2);
  const [mintOnChain, setMintOnChain] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stepLabel, setStepLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(flow.name || '');
      setDescription(flow.brief || '');
      setSelectedTasks(flow.tasks ? [...flow.tasks] : []);
      setSelectedCoordinator(flow.coordinator ?? null);
      setFeePercent((prev) =>
        feeOptions.includes(prev) ? prev : feeOptions.includes(2) ? 2 : feeOptions[0]!,
      );
      setStepLabel(null);
      setError(null);
    }
  }, [open, flow.name, flow.brief, flow.tasks, flow.coordinator, feeOptions]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) {
      openAuthModal();
      return;
    }
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Enter a workflow name');
      return;
    }
    if (selectedTasks.length === 0) {
      setError('Select at least one category');
      return;
    }
    if (flow.nodes.length === 0) {
      setError('Add at least one step before publishing');
      return;
    }
    if (flow.nodes.some((n) => !n.data.entry)) {
      setError('Select a catalog step for every node before publishing');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nextFlow: Flow = {
        ...flow,
        name: cleanTitle,
        brief: description.trim(),
        banner: flow.banner ?? null,
        tasks: selectedTasks,
        coordinator: selectedCoordinator,
      };
      setStepLabel('Saving...');
      const saved = await api
        .save(nextFlow, flow.modified)
        .catch(() => api.save(nextFlow));

      const baseTerms: Terms = {
        creatorFee: feePercent,
        tasks: selectedTasks,
        description: description.trim() || `${nextFlow.nodes.length}-step workflow`,
      };

      setStepLabel('Pinning card...');
      const card = buildWorkflowCardMetadata(saved, baseTerms);
      const pin = await uploadWorkflowMetadata(card);
      baseTerms.cid = pin.cid;

      if (mintOnChain) {
        setStepLabel('Minting NFT...');
        const minted = await mintWorkflowOnChain({
          flow: saved,
          terms: baseTerms,
          workflowCardUri: pin.uri,
          banner: saved.banner,
        });
        baseTerms.chainWorkflowId = minted.workflowId;
        baseTerms.txHash = minted.txHash;
        baseTerms.contractId = minted.contractId;
      }

      setStepLabel('Publishing...');
      const published = await api.publish(saved, baseTerms);
      onPublished(published);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to publish workflow');
    } finally {
      setStepLabel(null);
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Publish Workflow" size="md">
      <form className="modal-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            type="text"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Workflow name"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            className="textarea textarea-compact"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional summary..."
          />
        </label>

        <TaskPicker
          value={selectedTasks}
          onChange={setSelectedTasks}
          disabled={busy}
          required
        />

        <CoordinatorField
          value={selectedCoordinator}
          onChange={setSelectedCoordinator}
          disabled={busy}
        />

        <div className="field">
          <span className="field-label">Creator fee ({feePercent}%)</span>
          <div
            className="segmented is-full"
            role="radiogroup"
            aria-label="Creator royalty percentage"
          >
            {feeOptions.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={feePercent === option}
                disabled={busy}
                className={`seg-btn ${feePercent === option ? 'active' : ''}`}
                onClick={() => setFeePercent(option)}
              >
                {option}%
              </button>
            ))}
          </div>
        </div>

        <label className="switch-row">
          <span>Mint ownership NFT</span>
          <input
            type="checkbox"
            checked={mintOnChain}
            disabled={busy}
            onChange={(event) => setMintOnChain(event.target.checked)}
          />
        </label>

        <div className="stat-card-grid">
          <div className="stat-box">
            <span className="stat-label">Steps</span>
            <span className="stat-val">{flow.nodes.length}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Creator Fee</span>
            <span className="stat-val accent-gold">{feePercent}%</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Platform Fee</span>
            <span className="stat-val">{platformFeePercent}%</span>
          </div>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Share2 size={14} />}
            <span>{stepLabel || 'Publish'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
