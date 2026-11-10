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

function WorkflowInner({ workflowId, onOpenDraft, onNotify }: WorkflowPageProps) {
  const { user, config, openAuthModal } = useAuth();
  const {
    spendingAddress,
    approvedUsd,
    hasApprovedLimit,
    getRunSession,
    refresh: refreshSession,
  } = useSession();

  const [workflow, setWorkflow] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(() => !isCompactCanvasViewport());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [outputDialogOpen, setOutputDialogOpen] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [generatingBanner, setGeneratingBanner] = useState(false);

  const planeRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [planeSize, setPlaneSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight - 56 : 760,
  }));
  const [canvasReserves, setCanvasReserves] = useState<{ top: number; bottom: number }>(() => ({
    top: 72,
    bottom: isCompactCanvasViewport() ? 228 : 254,
  }));

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<WorkflowAttachment[]>([]);
  const [runnerCoordinator, setRunnerCoordinator] = useState<Coordinator | null>(null);
  const [pausedThreadId, setPausedThreadId] = useState<string | null>(null);
  const [liveStepOutputs, setLiveStepOutputs] = useState<Record<string, string>>({});
  const [liveStepStreams, setLiveStepStreams] = useState<Record<string, string>>({});
  const [liveCoordinatorStream, setLiveCoordinatorStream] = useState('');
  const [liveActivities, setLiveActivities] = useState<
    Array<{
      id: string;
      ts: number;
      stepId: string | null;
      kind: string;
      status: 'running' | 'completed' | 'pending' | 'failed';
      title: string;
      summary?: string;
    }>
  >([]);
  const [liveBills, setLiveBills] = useState<WorkflowBillItem[]>([]);
  const [liveComposeBillWei, setLiveComposeBillWei] = useState('0');
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [missingConnectors, setMissingConnectors] = useState<MissingConnectorRequirement[]>([]);
  const [proactiveMissingConnectors, setProactiveMissingConnectors] = useState<
    MissingConnectorRequirement[]
  >([]);
  const [connectorAuthByNodeId, setConnectorAuthByNodeId] = useState<
    Record<string, ConnectorAuthState>
  >({});
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false);
  const [missingInputs, setMissingInputs] = useState<MissingInputRequirement[]>([]);
  const [inputPromptOpen, setInputPromptOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<Entry[]>([]);
  const [activeTab, setActiveTab] = useState<'final' | string>('final');
  const [copied, setCopied] = useState(false);

  const instanceRef = useRef<ReactFlowInstance<Block, Link> | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const hydratedScopeRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!sidePanelOpen) return;
    if (typeof window === 'undefined' || window.innerWidth > 768) return;
    return ownEscape(() => setSidePanelOpen(false), 15);
  }, [sidePanelOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onViewportChange = (evt: MediaQueryListEvent) => {
      if (evt.matches) {
        setSidePanelOpen(false);
      }
    };
    mq.addEventListener('change', onViewportChange);
    return () => mq.removeEventListener('change', onViewportChange);
  }, []);

  useEffect(() => {
    const el = planeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const planeRect = el.getBoundingClientRect();
      if (planeRect.width <= 0 || planeRect.height <= 0) return;
      setPlaneSize((prev) =>
        Math.abs(prev.width - planeRect.width) < 6 && Math.abs(prev.height - planeRect.height) < 6
          ? prev
          : { width: Math.round(planeRect.width), height: Math.round(planeRect.height) },
      );
      const hudRect = hudRef.current?.getBoundingClientRect();
      const dockRect = dockRef.current?.getBoundingClientRect();
      const nextTop =
        hudRect && hudRect.height > 0
          ? Math.max(52, Math.ceil(hudRect.bottom - planeRect.top) + 16)
          : 72;
      const nextBottom =
        dockRect && dockRect.height > 0
          ? Math.max(120, Math.ceil(planeRect.bottom - dockRect.top) + 22)
          : isCompactCanvasViewport(planeRect.width)
            ? 228
            : 254;
      setCanvasReserves((prev) =>
        Math.abs(prev.top - nextTop) < 6 && Math.abs(prev.bottom - nextBottom) < 6
          ? prev
          : { top: nextTop, bottom: nextBottom },
      );
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    if (hudRef.current) ro.observe(hudRef.current);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
  }, [loading, sidePanelOpen, workflow?.id, running, Boolean(runError), attachments.length]);

  useEffect(() => {
    const controller = new AbortController();
    load('model', controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setCatalogModels(loaded);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const refreshThreads = useCallback(
    async (targetWorkflowId: string): Promise<Thread[]> => {
      if (!user?.userAddress) {
        setThreads([]);
        return [];
      }
      try {
        const list = await api.workflowThreads(targetWorkflowId);
        setThreads(list);
        return list;
      } catch {
        return [];
      }
    },
    [user?.userAddress],
  );

  const handleStreamEvent = useCallback(
    (evt: RunStreamEvent) => {
      if (evt.type === 'thread:init') {
        setActiveThreadId(evt.threadId);
        if (workflowId) {
          void refreshThreads(workflowId);
        }
      } else if (evt.type === 'step:start') {
        setRunningStepId(evt.stepId);
        setLiveStepStreams((prev) => ({ ...prev, [evt.stepId]: '' }));
      } else if (evt.type === 'step:done') {
        setLiveStepOutputs((prev) => ({ ...prev, [evt.stepId]: evt.output }));
      } else if (evt.type === 'sse:activity') {
        setLiveActivities((prev) => [...prev.slice(-49), evt]);
      } else if (evt.type === 'sse:delta') {
        if (evt.stepId) {
          setLiveStepStreams((prev) => ({
            ...prev,
            [evt.stepId!]: (prev[evt.stepId!] ?? '') + evt.delta,
          }));
        } else {
          setLiveCoordinatorStream((prev) => prev + evt.delta);
        }
      } else if (evt.type === 'sse:bill') {
        setLiveComposeBillWei(evt.composeBillWei);
        setLiveBills(evt.bills);
      } else if (evt.type === 'connector:pause') {
        setMissingConnectors(evt.missing);
        if (evt.missing[0]?.threadId) {
          setPausedThreadId(evt.missing[0].threadId);
          setActiveThreadId(evt.missing[0].threadId);
        }
        setCredentialsModalOpen(true);
      } else if (evt.type === 'input:pause') {
        setMissingInputs(evt.missingInputs);
        if (evt.missingInputs[0]?.threadId) {
          setPausedThreadId(evt.missingInputs[0].threadId);
          setActiveThreadId(evt.missingInputs[0].threadId);
        }
        setInputPromptOpen(true);
      }
    },
    [refreshThreads, workflowId],
  );

  const applyRunOutcomeError = useCallback(
    (err: unknown, fallbackThreadId?: string) => {
      if (err instanceof Fault && err.code === 'CONNECTOR_REQUIRED' && err.missing?.length) {
        const tid = err.threadId ?? err.missing[0]?.threadId ?? fallbackThreadId ?? null;
        setMissingConnectors(err.missing);
        if (tid) {
          setPausedThreadId(tid);
          setActiveThreadId(tid);
        }
        setCredentialsModalOpen(true);
        setRunError(err.message);
      } else if (
        err instanceof Fault &&
        err.code === 'INPUT_REQUIRED' &&
        err.missingInputs?.length
      ) {
        const tid = err.threadId ?? err.missingInputs[0]?.threadId ?? fallbackThreadId ?? null;
        setMissingInputs(err.missingInputs);
        if (tid) {
          setPausedThreadId(tid);
          setActiveThreadId(tid);
        }
        setInputPromptOpen(true);
        setRunError(err.message);
      } else {
        setRunError(err instanceof Error ? err.message : 'Workflow run failed.');
      }
    },
    [],
  );

  const attachToRunningThread = useCallback(
    async (targetWorkflowId: string, targetThreadId: string, defaultStepId?: string | null) => {
      streamAbortRef.current?.abort();
      const controller = new AbortController();
      streamAbortRef.current = controller;
      setRunning(true);
      setRunningStepId(defaultStepId ?? null);
      try {
        const res = await api.watchWorkflowThread(
          targetWorkflowId,
          targetThreadId,
          handleStreamEvent,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setExecution(res);
        setPausedThreadId(null);
        setMissingInputs([]);
        setMissingConnectors([]);
        setRunError(null);
        setActiveTab('final');
        setOutputDialogOpen(true);
        onNotify(res.dry ? 'Dry run complete' : 'Run complete');
      } catch (err) {
        if (controller.signal.aborted) return;
        applyRunOutcomeError(err, targetThreadId);
      } finally {
        if (streamAbortRef.current === controller) {
          setRunningStepId(null);
          setRunning(false);
          void refreshThreads(targetWorkflowId);
          void refreshSession();
        }
      }
    },
    [applyRunOutcomeError, handleStreamEvent, onNotify, refreshSession, refreshThreads],
  );

  const hydrateThread = useCallback(
    (
      thread: Thread,
      targetWorkflow: Listing,
      options?: { autoOpenModals?: boolean },
    ) => {
      streamAbortRef.current?.abort();
      setActiveThreadId(thread.threadId);
      setPrompt(thread.prompt || '');
      setAttachments((thread.attachments as WorkflowAttachment[]) ?? []);
      if (thread.coordinator) {
        setRunnerCoordinator(thread.coordinator);
      }
      setDryRun(Boolean(thread.dry));
      setLiveStepOutputs(thread.stepOutputs ?? {});
      setLiveStepStreams({});
      setLiveCoordinatorStream('');
      setLiveActivities([]);
      setActiveTab('final');
      setOutputDialogOpen(false);

      const nextExecution = (thread.execution as Execution | null | undefined) ?? null;
      setExecution(nextExecution);
      setLiveBills(nextExecution?.bills ?? []);
      setLiveComposeBillWei(nextExecution?.composeBillWei ?? '0');

      const nextMissingInputs =
        (thread.missingInputs as unknown as MissingInputRequirement[]) ?? [];
      const nextMissingConnectors =
        (thread.missingConnectors as unknown as MissingConnectorRequirement[]) ?? [];

      if (thread.status === 'input_required') {
        setRunning(false);
        setRunningStepId(null);
        setPausedThreadId(thread.threadId);
        setMissingInputs(nextMissingInputs);
        setMissingConnectors([]);
        setCredentialsModalOpen(false);
        setInputPromptOpen(options?.autoOpenModals !== false && nextMissingInputs.length > 0);
        setRunError(
          thread.error ||
          nextMissingInputs[0]?.reason ||
          'Additional input is required to continue this workflow.',
        );
      } else if (thread.status === 'connector_required') {
        setRunning(false);
        setRunningStepId(null);
        setPausedThreadId(thread.threadId);
        setMissingConnectors(nextMissingConnectors);
        setMissingInputs([]);
        setInputPromptOpen(false);
        setCredentialsModalOpen(
          options?.autoOpenModals !== false && nextMissingConnectors.length > 0,
        );
        setRunError(thread.error || 'Connect required accounts to continue this workflow.');
      } else if (thread.status === 'running') {
        setPausedThreadId(null);
        setMissingInputs([]);
        setMissingConnectors([]);
        setInputPromptOpen(false);
        setCredentialsModalOpen(false);
        setRunError(null);
        const fallbackRunningNodeId =
          targetWorkflow.nodes.find((n) => !thread.stepOutputs?.[n.id])?.id ?? null;
        void attachToRunningThread(
          targetWorkflow.id,
          thread.threadId,
          thread.runningStepId ?? fallbackRunningNodeId,
        );
      } else if (thread.status === 'failed') {
        setRunning(false);
        setRunningStepId(null);
        setPausedThreadId(null);
        setMissingInputs([]);
        setMissingConnectors([]);
        setInputPromptOpen(false);
        setCredentialsModalOpen(false);
        setRunError(thread.error || 'Workflow execution failed.');
      } else {
        setRunning(false);
        setRunningStepId(null);
        setPausedThreadId(null);
        setMissingInputs([]);
        setMissingConnectors([]);
        setInputPromptOpen(false);
        setCredentialsModalOpen(false);
        setRunError(null);
      }
    },
    [attachToRunningThread, user?.userAddress],
  );

  const handleStartNewThread = useCallback(() => {
    streamAbortRef.current?.abort();
    setActiveThreadId(null);
    setPausedThreadId(null);
    setPrompt('');
    setAttachments([]);
    setLiveStepOutputs({});
    setLiveStepStreams({});
    setLiveCoordinatorStream('');
    setLiveActivities([]);
    setLiveBills([]);
    setLiveComposeBillWei('0');
    setExecution(null);
    setRunError(null);
    setMissingInputs([]);
    setMissingConnectors([]);
    setInputPromptOpen(false);
    setCredentialsModalOpen(false);
    setOutputDialogOpen(false);
    setRunning(false);
    setRunningStepId(null);
    setActiveTab('final');
  }, [user?.userAddress, workflowId]);

  const loadWorkflow = useCallback(async () => {
    if (!workflowId) {
      setWorkflow(null);
      setLoadError('Workflow not found.');
      setLoading(false);
      return;
    }

    streamAbortRef.current?.abort();
    hydratedScopeRef.current = null;
    setLoading(true);
    setAccessDenied(false);
    setLoadError(null);
    setExecution(null);
    setRunning(false);
    setRunningStepId(null);
    setPausedThreadId(null);
    setActiveThreadId(null);
    setThreads([]);
    setPrompt('');
    setRunError(null);
    setMissingInputs([]);
    setMissingConnectors([]);
    setInputPromptOpen(false);
    setCredentialsModalOpen(false);
    setLiveStepOutputs({});
    setLiveStepStreams({});
    setLiveCoordinatorStream('');
    setLiveActivities([]);
    setLiveBills([]);
    setLiveComposeBillWei('0');
    setAttachments([]);
    setSelectedNodeId(null);
    setOutputDialogOpen(false);
    setActiveTab('final');

    try {
      const fetched = await api.workflow(workflowId);
      setWorkflow(fetched);
      setRunnerCoordinator(fetched.coordinator ?? null);
    } catch (err) {
      setWorkflow(null);
      if (err instanceof Fault && (err.status === 401 || err.status === 403)) {
        setAccessDenied(true);
      } else {
        setLoadError(err instanceof Error ? err.message : 'Workflow unavailable.');
      }
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    void loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    if (accessDenied && user?.userAddress) {
      void loadWorkflow();
    }
  }, [accessDenied, user?.userAddress, loadWorkflow]);

  useEffect(() => {
    if (!workflow || !user?.userAddress) {
      setThreads([]);
      return;
    }
    const scope = `${user.userAddress.toLowerCase()}:${workflow.id}`;
    if (hydratedScopeRef.current === scope) return;
    hydratedScopeRef.current = scope;

    let cancelled = false;
    void api
      .workflowThreads(workflow.id)
      .then((list) => {
        if (cancelled) return;
        setThreads(list);
        if (list.length === 0) return;
        const explicitThreadId = readExplicitUrlThreadId();
        if (!explicitThreadId) return;
        const matched = list.find((item) => item.threadId === explicitThreadId);
        if (matched) {
          hydrateThread(matched, workflow, { autoOpenModals: true });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [hydrateThread, user?.userAddress, workflow]);

  const bucketedTopReserve = Math.round(canvasReserves.top / 16) * 16;
  const bucketedBottomReserve = Math.round(canvasReserves.bottom / 20) * 20;

  const adaptiveCanvas = useMemo(() => {
    if (!workflow) return null;
    return computeAdaptiveWorkflowLayout(workflow.nodes, workflow.edges, {
      width: planeSize.width,
      height: planeSize.height,
      topReserve: bucketedTopReserve,
      bottomReserve: bucketedBottomReserve,
    });
  }, [bucketedBottomReserve, bucketedTopReserve, planeSize.height, planeSize.width, workflow]);

  const fitWorkflowCanvas = useCallback(
    (duration = 180) => {
      const inst = instanceRef.current;
      if (!inst || !adaptiveCanvas || adaptiveCanvas.nodes.length === 0) return;
      const measured = new Map<string, { width: number; height: number }>();
      for (const n of adaptiveCanvas.nodes) {
        const internal = inst.getInternalNode(n.id);
        const w = internal?.measured?.width;
        const h = internal?.measured?.height;
        if (w && h) measured.set(n.id, { width: w, height: h });
      }
      const vp = computeSafeCanvasViewport(
        adaptiveCanvas.nodes,
        {
          width: planeSize.width,
          height: planeSize.height,
          topReserve: canvasReserves.top,
          bottomReserve: canvasReserves.bottom,
        },
        measured,
      );
      void inst.setViewport(vp, { duration });
    },
    [
      adaptiveCanvas,
      canvasReserves.bottom,
      canvasReserves.top,
      planeSize.height,
      planeSize.width,
    ],
  );

  useEffect(() => {
    if (!workflow || !adaptiveCanvas) return;
    const frame = requestAnimationFrame(() => {
      fitWorkflowCanvas(180);
    });
    const refineTimer = window.setTimeout(() => {
      fitWorkflowCanvas(140);
    }, 70);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(refineTimer);
    };
  }, [
    adaptiveCanvas,
    canvasReserves.bottom,
    canvasReserves.top,
    fitWorkflowCanvas,
    planeSize.height,
    planeSize.width,
    sidePanelOpen,
    workflow,
  ]);

  const isOwner = Boolean(
    workflow &&
    user?.userAddress &&
    workflow.userAddress &&
    user.userAddress.toLowerCase() === workflow.userAddress.toLowerCase(),
  );

  const canEditBanner = Boolean(isOwner && workflow && !workflow.published);

  const persistWorkflowBanner = useCallback(
    async (nextBanner: string | null) => {
      if (!workflow || workflow.published) return;
      const payload: Flow = {
        id: workflow.id,
        name: workflow.name,
        brief: workflow.brief ?? '',
        banner: nextBanner,
        ...(workflow.tasks?.length ? { tasks: workflow.tasks } : {}),
        ...(workflow.coordinator !== undefined ? { coordinator: workflow.coordinator } : {}),
        nodes: workflow.nodes,
        edges: workflow.edges,
        modified: workflow.modified,
      };
      const saved = await api
        .save(payload, workflow.modified)
        .catch(() => api.save({ ...payload, modified: new Date().toISOString() }));
      setWorkflow(saved);
    },
    [workflow],
  );

  const handleWorkflowBannerUpload = useCallback(
    async (file: File) => {
      if (!canEditBanner) return;
      setUploadingBanner(true);
      try {
        const bannerUrl = await uploadMediaImage(file, 'workflow-banner');
        await persistWorkflowBanner(bannerUrl);
        onNotify('Updated workflow banner');
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Unable to upload banner');
      } finally {
        setUploadingBanner(false);
      }
    },
    [canEditBanner, onNotify, persistWorkflowBanner],
  );

  const handleWorkflowBannerGenerate = useCallback(async () => {
    if (!workflow || !canEditBanner) return;
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setGeneratingBanner(true);
    try {
      const logos = buildBannerBrandLogos(workflow.nodes);
      const generated = await api.generateBanner({
        title: workflow.name.trim() || 'man0 Workflow',
        description:
          workflow.terms?.description?.trim() ||
          workflow.brief?.trim() ||
          workflow.nodes.map((n) => n.data.label).join(', ') ||
          'Autonomous multi-step AI and Web3 workflow.',
        ...(logos.length > 0 ? { logos } : {}),
      });
      await persistWorkflowBanner(generated.imageUrl);
      onNotify('Generated workflow banner');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate banner');
    } finally {
      setGeneratingBanner(false);
    }
  }, [canEditBanner, openAuthModal, onNotify, persistWorkflowBanner, user, workflow]);

  const handleWorkflowBannerRemove = useCallback(async () => {
    if (!canEditBanner) return;
    setUploadingBanner(true);
    try {
      await persistWorkflowBanner(null);
      onNotify('Cleared workflow banner');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to clear banner');
    } finally {
      setUploadingBanner(false);
    }
  }, [canEditBanner, onNotify, persistWorkflowBanner]);

  const isLockedUnpublished = Boolean(
    accessDenied || (workflow && !workflow.published && !isOwner),
  );

  const handleBack = () => {
    if (isOwner && workflow && !workflow.published) {
      navigateTo('/workspace');
      return;
    }
    navigateTo('/market');
  };

  const handleRun = async (
    event?: FormEvent,
    overrides?: {
      prompt?: string;
      attachments?: WorkflowAttachment[];
      threadId?: string;
      connectorDecisions?: ConnectorDecisionItem[];
    },
  ) => {
    event?.preventDefault();
    if (!workflow || isLockedUnpublished) return;

    if (!user) {
      openAuthModal();
      return;
    }

    const effectivePrompt = (overrides?.prompt ?? prompt).trim();
    const effectiveAttachments = overrides?.attachments ?? attachments;
    const completedPriorCount = Object.keys(liveStepOutputs).length;
    const hasIncompletePriorSteps =
      !execution &&
      Boolean(activeThreadId) &&
      completedPriorCount > 0 &&
      completedPriorCount < workflow.nodes.length;
    const resumeThreadId =
      overrides?.threadId?.trim() ||
      pausedThreadId ||
      (hasIncompletePriorSteps ? activeThreadId ?? undefined : undefined);
    const targetThreadId = resumeThreadId || `wf-${workflow.id}-${crypto.randomUUID()}`;
    const activeCoordinator = runnerCoordinator ?? workflow.coordinator ?? null;

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setRunning(true);
    setRunError(null);
    setMissingConnectors([]);
    setCredentialsModalOpen(false);
    setMissingInputs([]);
    setInputPromptOpen(false);
    setActiveThreadId(targetThreadId);

    if (!resumeThreadId) {
      setPausedThreadId(null);
      setLiveStepOutputs({});
      setLiveStepStreams({});
      setLiveCoordinatorStream('');
      setLiveActivities([]);
      setLiveBills([]);
      setLiveComposeBillWei('0');
      setExecution(null);
    } else {
      setLiveCoordinatorStream('');
    }
    const firstPendingStepId = resumeThreadId
      ? (workflow.nodes.find((n) => !Object.prototype.hasOwnProperty.call(liveStepOutputs, n.id))
        ?.id ??
        workflow.nodes[workflow.nodes.length - 1]?.id ??
        null)
      : (workflow.nodes[0]?.id ?? null);
    setRunningStepId(firstPendingStepId);
    try {
      const session = await getRunSession();
      if (!session) {
        setRunning(false);
        setRunningStepId(null);
        openAuthModal();
        setRunError('Approve a session limit in Account before running.');
        return;
      }

      let res: Execution;
      try {
        res = await api.runWorkflow(
          workflow.id,
          effectivePrompt || workflow.brief || undefined,
          session,
          {
            dry: dryRun,
            threadId: targetThreadId,
            ...(effectiveAttachments.length > 0 ? { attachments: effectiveAttachments } : {}),
            ...(activeCoordinator ? { coordinator: activeCoordinator } : {}),
            ...(overrides?.connectorDecisions?.length
              ? { connectorDecisions: overrides.connectorDecisions }
              : {}),
            signal: controller.signal,
            onEvent: handleStreamEvent,
          },
        );
      } catch (runErr) {
        if (controller.signal.aborted || !isRecoverableStreamError(runErr)) {
          throw runErr;
        }
        res = await api.watchWorkflowThread(
          workflow.id,
          targetThreadId,
          handleStreamEvent,
          controller.signal,
        );
      }
      if (controller.signal.aborted) return;

      setExecution(res);
      setPausedThreadId(null);
      setActiveTab('final');
      setOutputDialogOpen(true);
      onNotify(res.dry ? 'Dry run complete' : 'Run complete');
    } catch (err) {
      if (controller.signal.aborted) return;
      applyRunOutcomeError(err, targetThreadId);
    } finally {
      if (streamAbortRef.current === controller) {
        setRunningStepId(null);
        setRunning(false);
        void refreshThreads(workflow.id);
        void refreshSession();
        void refreshConnectorStatus();
      }
    }
  };

}
