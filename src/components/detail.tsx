import { ExternalLink, Loader2, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../contexts/auth';
import { explorerTxUrl } from '../lib/contracts';
import { getIpfsGatewayUrl } from '../lib/pinata';
import { navigateToWorkflow } from '../lib/routes';
import type { Listing } from '../lib/schema';
import { Modal } from './modal';
import { CreatorSlot } from './profile';
import { TaskPills } from './tags';
import { Tooltip } from './tooltip';

const MAX_VISIBLE_DETAIL_STEPS = 6;

interface DetailProps {
  workflow: Listing | null;
  open: boolean;
  onClose: () => void;
  onDelete?: (workflow: Listing) => Promise<void>;
  onSelectCreator?: (address: string) => void;
}

export function Detail({
  workflow,
  open,
  onClose,
  onDelete,
  onSelectCreator,
}: DetailProps) {
  const { user, config } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!workflow) return null;

  const platformFeePercent = config?.fees?.platformPercent ?? 2;
  const tasks = workflow.terms?.tasks ?? workflow.tasks ?? [];

  const isOwner = Boolean(
    user?.userAddress &&
      workflow.userAddress &&
      user.userAddress.toLowerCase() === workflow.userAddress.toLowerCase(),
  );

  const mintTxUrl = workflow.terms?.txHash
    ? explorerTxUrl(workflow.terms.txHash, workflow.terms.contractId)
    : null;
  const ipfsUrl = workflow.terms?.cid ? getIpfsGatewayUrl(workflow.terms.cid) : null;

  const handleDelete = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete(workflow);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete workflow');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={workflow.name}
      size="lg"
      headerActions={
        <div className="detail-header-pills">
          {workflow.terms ? (
            <span className="status-pill accent-gold">
              +{workflow.terms.creatorFee}% royalty
            </span>
          ) : null}
          {workflow.userAddress ? (
            <CreatorSlot
              address={workflow.userAddress}
              fallbackName={workflow.creatorName}
              fallbackAvatar={workflow.creatorAvatar}
              showExplorer
              onSelectCreator={
                onSelectCreator
                  ? (address) => {
                      onClose();
                      onSelectCreator(address);
                    }
                  : undefined
              }
            />
          ) : null}
        </div>
      }
    >
      <div className="modal-stack">
        {workflow.banner ? (
          <div className="wf-card-banner">
            <img src={workflow.banner} alt="" className="wf-card-banner-img" />
          </div>
        ) : null}

        {tasks.length > 0 ? <TaskPills tasks={tasks} /> : null}

        {workflow.terms?.description || workflow.brief ? (
          <p className="detail-desc">{workflow.terms?.description || workflow.brief}</p>
        ) : null}

        <div className="detail-steps-list">
          {workflow.nodes.slice(0, MAX_VISIBLE_DETAIL_STEPS).map((node, index) => (
            <div key={node.id} className="detail-step-pill" data-kind={node.data.kind}>
              <span className="detail-step-num">{index + 1}</span>
              <span className="node-type" data-kind={node.data.kind}>
                {node.data.kind.toUpperCase()}
              </span>
              <span className="detail-step-title">
                {node.data.entry?.name || node.data.label}
              </span>
            </div>
          ))}
          {workflow.nodes.length > MAX_VISIBLE_DETAIL_STEPS ? (
            <Tooltip
              label="All steps"
              description={workflow.nodes
                .map((n, idx) => `${idx + 1}. ${n.data.entry?.name || n.data.label}`)
                .join(' · ')}
            >
              <span className="detail-step-pill is-overflow" tabIndex={0}>
                +{workflow.nodes.length - MAX_VISIBLE_DETAIL_STEPS} more
              </span>
            </Tooltip>
          ) : null}
        </div>

        <div className="stat-card-grid">
          <div className="stat-box">
            <span className="stat-label">Steps</span>
            <span className="stat-val">{workflow.nodes.length}</span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Creator Royalty</span>
            <span className="stat-val accent-gold">
              {workflow.terms?.creatorFee ?? 0}%
            </span>
          </div>
          <div className="stat-box">
            <span className="stat-label">Platform Fee</span>
            <span className="stat-val">{platformFeePercent}%</span>
          </div>
        </div>

        {mintTxUrl || ipfsUrl ? (
          <div className="preset-row">
            {mintTxUrl ? (
              <a
                href={mintTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chip-btn"
              >
                <span>
                  {workflow.terms?.chainWorkflowId
                    ? `On-chain NFT #${workflow.terms.chainWorkflowId}`
                    : 'On-chain Mint Tx'}
                </span>
                <ExternalLink size={11} />
              </a>
            ) : null}
            {ipfsUrl ? (
              <a
                href={ipfsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="chip-btn"
              >
                <span>Workflow Card</span>
                <ExternalLink size={11} />
              </a>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="modal-footer">
          <div className="modal-actions-left">
            {isOwner && onDelete ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                <span>Delete</span>
              </button>
            ) : null}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onClose();
                navigateToWorkflow(workflow.id);
              }}
            >
              <Play size={14} aria-hidden="true" />
              <span>Run</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
