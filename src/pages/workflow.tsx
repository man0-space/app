import {
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Link2,
  LoaderCircle,
  Lock,
  Maximize2,
  MessageSquare,
  Minus,
  PanelRight,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/button';
import { RichOutput, RunComposer } from '../components/composer';
import { CoordinatorField } from '../components/coordinator';
import { CredentialsModal } from '../components/credentials';
import { Dropdown, type DropdownOption } from '../components/dropdown';
import { BannerMediaFrame } from '../components/media';
import { Modal } from '../components/modal';
import { CreatorSlot } from '../components/profile';
import { Prompt } from '../components/prompt';
import {
  edgeTypes,
  nodeTypes,
  type StepExecStatus,
  type WireEdgeData,
} from '../components/step';
import { TaskPills } from '../components/tags';
import { Tooltip } from '../components/tooltip';
import { useAuth } from '../contexts/auth';
import { ownEscape } from '../hooks/use-dismiss';
import { uploadMediaImage } from '../hooks/use-profile';
import { formatMicroUsdc, useSession } from '../hooks/use-session';
import {
  api,
  authenticated,
  type ConnectorDecisionItem,
  type Execution,
  Fault,
  type MissingConnectorRequirement,
  type MissingInputRequirement,
  type RunStreamEvent,
  type WorkflowAttachment,
  type WorkflowBillItem,
} from '../lib/api';
import { buildBannerBrandLogos, load } from '../lib/catalog';
import { checkWorkflowConnectors, type ConnectorAuthState } from '../lib/compose';
import { explorerTxUrl } from '../lib/contracts';
import {
  collectActiveHandlesByNodeId,
  computeAdaptiveWorkflowLayout,
  computeSafeCanvasViewport,
  isCompactCanvasViewport,
} from '../lib/graph';
import { getIpfsGatewayUrl } from '../lib/pinata';
import { navigateTo, navigateToCreator } from '../lib/routes';
import {
  type Block,
  type Coordinator,
  type Entry,
  type Flow,
  type Link,
  type Listing,
  type Thread,
} from '../lib/schema';

interface WorkflowPageProps {
  workflowId: string | null;
  onOpenDraft: (flow: Flow) => void;
  onNotify: (msg: string) => void;
}

const NEW_THREAD_SENTINEL = '__new__';

function readExplicitUrlThreadId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('thread')?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

function threadStatusLabel(status: Thread['status']): string {
  switch (status) {
    case 'running':
      return 'RUNNING';
    case 'input_required':
      return 'NEEDS INPUT';
    case 'connector_required':
      return 'NEEDS AUTH';
    case 'succeeded':
      return 'DONE';
    case 'failed':
      return 'FAILED';
  }
}

function isRecoverableStreamError(err: unknown): boolean {
  if (!(err instanceof Fault)) return true;
  return (
    err.code === 'STREAM_TRUNCATED' ||
    err.status === 502 ||
    err.status === 503 ||
    err.status === 504
  );
}

interface ThreadSelectorProps {
  threads: readonly Thread[];
  activeThreadId: string | null;
  disabled?: boolean;
  iconOnlyMobile?: boolean;
  onSelectThread: (thread: Thread) => void;
  onNewThread: () => void;
}

function ThreadSelector({
  threads,
  activeThreadId,
  disabled = false,
  iconOnlyMobile = false,
  onSelectThread,
  onNewThread,
}: ThreadSelectorProps) {
  const activeThread = useMemo(
    () => (activeThreadId ? threads.find((t) => t.threadId === activeThreadId) ?? null : null),
    [activeThreadId, threads],
  );

  const options = useMemo<DropdownOption[]>(() => {
    const items: DropdownOption[] = [
      {
        value: NEW_THREAD_SENTINEL,
        label: 'New thread',
        badge: threads.length > 0 ? String(threads.length) : 'NEW',
      },
    ];
    for (const item of threads) {
      const cleanTitle = (item.title || 'Run').trim();
      items.push({
        value: item.threadId,
        label: cleanTitle.length > 28 ? `${cleanTitle.slice(0, 27)}…` : cleanTitle,
        badge: threadStatusLabel(item.status),
        tooltip: item.prompt ? item.prompt.slice(0, 96) : undefined,
      });
    }
    return items;
  }, [threads]);

  return (
    <div className="wf-thread-selector" role="group" aria-label="Workflow threads">
      <Dropdown
        label="Workflow thread"
        variant="compact"
        align="end"
        disabled={disabled}
        iconOnlyMobile={iconOnlyMobile}
        searchable={threads.length > 6}
        searchPlaceholder="Search threads..."
        value={activeThreadId ?? NEW_THREAD_SENTINEL}
        options={options}
        icon={
          <span className="wf-thread-trigger-glyph" aria-hidden="true">
            <MessageSquare size={12} />
            {activeThread ? (
              <span className={`run-thread-dot is-${activeThread.status}`} />
            ) : null}
          </span>
        }
        onChange={(nextValue) => {
          if (nextValue === NEW_THREAD_SENTINEL) {
            onNewThread();
            return;
          }
          const found = threads.find((t) => t.threadId === nextValue);
          if (found) {
            onSelectThread(found);
          }
        }}
      />
      <Tooltip label="New thread" description="Start a fresh isolated run">
        <button
          type="button"
          className="wf-thread-plus-btn"
          aria-label="Start new workflow thread"
          disabled={disabled}
          onClick={onNewThread}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

function billCategoryLabel(category: WorkflowBillItem['category']): string {
  switch (category) {
    case 'coordinator':
      return 'COORDINATOR';
    case 'model':
      return 'MODEL';
    case 'connector':
      return 'CONNECTOR';
    case 'agent':
      return 'AGENT';
  }
}

function ReceiptBillsFold({ bills }: { bills: WorkflowBillItem[] }) {
  if (bills.length === 0) return null;
  return (
    <details className="wf-bills-fold">
      <summary className="wf-bills-summary">
        <span>Itemized compute ({bills.length})</span>
      </summary>
      <ul className="wf-bills-list" role="list">
        {bills.map((bill, idx) => (
          <li key={`${bill.category}:${bill.subject ?? bill.name}:${idx}`} className="wf-bill-row">
            <span className={`wf-bill-kind is-${bill.category}`}>
              {billCategoryLabel(bill.category)}
            </span>
            <span className="wf-bill-label">{bill.name}</span>
            <strong className="wf-bill-amount">{formatMicroUsdc(bill.amountWei)}</strong>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface ExecutionBadgesProps {
  showOutput: boolean;
  outputActive: boolean;
  onToggleOutput: () => void;
  proofUrl?: string | null;
}

function ExecutionBadges({
  showOutput,
  outputActive,
  onToggleOutput,
  proofUrl,
}: ExecutionBadgesProps) {
  if (!showOutput && !proofUrl) return null;
  return (
    <div className="wf-result-badges" role="group" aria-label="Execution output and proof">
      {showOutput ? (
        <Tooltip label="Execution output">
          <button
            type="button"
            className={`wf-result-badge is-output ${outputActive ? 'is-active' : ''}`.trim()}
            aria-pressed={outputActive}
            onClick={onToggleOutput}
          >
            <Sparkles size={12} aria-hidden="true" />
            <span className="wf-result-badge-label">Output</span>
          </button>
        </Tooltip>
      ) : null}
      {proofUrl ? (
        <Tooltip label="IPFS Execution Proof">
          <a
            href={proofUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="wf-result-badge is-proof"
          >
            <ShieldCheck size={12} aria-hidden="true" />
            <span className="wf-result-badge-label">Proof</span>
          </a>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function WorkflowPage(props: WorkflowPageProps) {
  return (
    <ReactFlowProvider>
      <WorkflowInner {...props} />
    </ReactFlowProvider>
  );
}
