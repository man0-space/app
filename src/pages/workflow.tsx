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

  const subjectAddress = spendingAddress ?? user?.userAddress ?? null;

  const refreshConnectorStatus = useCallback(async () => {
    if (!workflow || !subjectAddress) {
      setConnectorAuthByNodeId({});
      setProactiveMissingConnectors([]);
      return;
    }
    const checked = await checkWorkflowConnectors(subjectAddress, workflow.nodes).catch(
      () => null,
    );
    if (!checked) return;
    setConnectorAuthByNodeId(checked.authStateByNodeId);
    setProactiveMissingConnectors(checked.missing);
  }, [subjectAddress, workflow]);

  useEffect(() => {
    void refreshConnectorStatus();
  }, [refreshConnectorStatus]);

  const effectiveMissingConnectors = useMemo<MissingConnectorRequirement[]>(() => {
    const merged: MissingConnectorRequirement[] = [...missingConnectors];
    for (const item of proactiveMissingConnectors) {
      const exists = merged.some(
        (m) =>
          m.entryId === item.entryId ||
          (m.slug && item.slug && m.slug.toLowerCase() === item.slug.toLowerCase()),
      );
      if (!exists) merged.push(item);
    }
    return merged;
  }, [missingConnectors, proactiveMissingConnectors]);

  const handleNodeConnectClick = useCallback(
    (_nodeId: string) => {
      if (!user) {
        openAuthModal();
        return;
      }
      setCredentialsModalOpen(true);
    },
    [openAuthModal, user],
  );

  const stepStatusByNodeId = useMemo(() => {
    const map = new Map<string, StepExecStatus>();
    if (!workflow) return map;

    const pausedStepIds = new Set<string>(
      missingInputs.map((item) => item.stepId).filter((v): v is string => Boolean(v)),
    );
    for (const mc of missingConnectors) {
      for (const node of workflow.nodes) {
        const entryId = node.data.entry?.id ?? '';
        if (entryId === mc.entryId || (mc.slug && entryId.endsWith(`:${mc.slug}`))) {
          pausedStepIds.add(node.id);
        }
      }
    }

    const firstUncompletedNodeId =
      workflow.nodes.find(
        (n) =>
          !execution?.steps.some((s) => s.id === n.id) &&
          !Object.prototype.hasOwnProperty.call(liveStepOutputs, n.id),
      )?.id ?? workflow.nodes[0]?.id;

    for (const node of workflow.nodes) {
      const settled = execution?.steps.find((s) => s.id === node.id);
      const hasLive = Object.prototype.hasOwnProperty.call(liveStepOutputs, node.id);
      if (running && runningStepId === node.id) {
        map.set(node.id, 'executing');
      } else if (pausedThreadId && pausedStepIds.has(node.id)) {
        map.set(node.id, 'paused');
      } else if (settled || hasLive) {
        map.set(node.id, 'done');
      } else if (
        !running &&
        runError &&
        !pausedThreadId &&
        !execution &&
        node.id === firstUncompletedNodeId
      ) {
        map.set(node.id, 'failed');
      } else {
        map.set(node.id, 'idle');
      }
    }
    return map;
  }, [
    execution,
    liveStepOutputs,
    missingConnectors,
    missingInputs,
    pausedThreadId,
    runError,
    running,
    runningStepId,
    workflow,
  ]);

  const stepPriceByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    if (!workflow) return map;
    for (const node of workflow.nodes) {
      const settledStep = execution?.steps.find((s) => s.id === node.id);
      if (settledStep?.billWei && BigInt(settledStep.billWei) > 0n) {
        map.set(node.id, formatMicroUsdc(settledStep.billWei));
        continue;
      }
      const entryId = node.data.entry?.id?.toLowerCase() ?? '';
      const entryTail = entryId.split(':').pop() ?? '';
      const entryName = node.data.entry?.name?.toLowerCase() ?? '';
      let liveWei = 0n;
      for (const bill of liveBills) {
        if (bill.category === 'coordinator') continue;
        if (bill.stepId) {
          if (bill.stepId === node.id) {
            liveWei += BigInt(bill.amountWei || '0');
          }
          continue;
        }
        if (bill.category !== node.data.kind) continue;
        const subj = bill.subject?.toLowerCase() ?? '';
        const bName = bill.name.toLowerCase();
        const matches =
          (entryId && (subj === entryId || subj.endsWith(`:${entryId}`))) ||
          (entryTail.length >= 3 && (subj === entryTail || subj.endsWith(`:${entryTail}`))) ||
          (entryName && bName === entryName);
        if (matches) {
          liveWei += BigInt(bill.amountWei || '0');
        }
      }
      if (liveWei > 0n) {
        map.set(node.id, formatMicroUsdc(liveWei.toString()));
      }
    }
    return map;
  }, [execution, liveBills, workflow]);

  const stepLiveStatusByNodeId = useMemo(() => {
    const map = new Map<string, string>();
    if (!workflow) return map;
    for (const act of liveActivities) {
      if (act.stepId) {
        map.set(act.stepId, act.summary || act.title);
      }
    }
    for (const node of workflow.nodes) {
      const delta = liveStepStreams[node.id]?.replace(/\s+/g, ' ').trim();
      if (delta) {
        map.set(node.id, delta.slice(-84));
      }
    }
    return map;
  }, [liveActivities, liveStepStreams, workflow]);

  const activeHandlesByNode = useMemo(() => {
    if (!adaptiveCanvas) return new Map<string, string[]>();
    return collectActiveHandlesByNodeId(adaptiveCanvas.nodes, adaptiveCanvas.edges);
  }, [adaptiveCanvas]);

  const nodesForCanvas = useMemo<Block[]>(() => {
    if (!adaptiveCanvas) return [];
    return adaptiveCanvas.nodes.map((node, idx) => {
      const execStatus = stepStatusByNodeId.get(node.id) ?? 'idle';
      return {
        ...node,
        selected: selectedNodeId === node.id,
        data: {
          ...node.data,
          readOnly: true,
          stepIndex: idx + 1,
          execStatus,
          running: execStatus === 'executing',
          priceLabel: stepPriceByNodeId.get(node.id),
          liveStatus: stepLiveStatusByNodeId.get(node.id),
          connectorAuthState: connectorAuthByNodeId[node.id],
          onConnectClick: handleNodeConnectClick,
          activeHandles: activeHandlesByNode.get(node.id),
        },
      };
    });
  }, [
    activeHandlesByNode,
    adaptiveCanvas,
    connectorAuthByNodeId,
    handleNodeConnectClick,
    selectedNodeId,
    stepLiveStatusByNodeId,
    stepPriceByNodeId,
    stepStatusByNodeId,
  ]);

  const edgesWithState = useMemo<Link[]>(() => {
    if (!workflow || !adaptiveCanvas) return [];
    return adaptiveCanvas.edges.map((edge) => {
      const sourceKind = workflow.nodes.find((n) => n.id === edge.source)?.data.kind ?? 'model';
      const sourceStatus = stepStatusByNodeId.get(edge.source) ?? 'idle';
      const targetStatus = stepStatusByNodeId.get(edge.target) ?? 'idle';
      const active =
        running &&
        (sourceStatus === 'executing' ||
          (sourceStatus === 'done' && targetStatus === 'executing'));
      const done = sourceStatus === 'done' && targetStatus === 'done';
      const wireData: WireEdgeData = {
        kind: sourceKind,
        readOnly: true,
        active,
        done,
      };
      return {
        ...edge,
        type: 'wire',
        data: wireData,
      };
    });
  }, [adaptiveCanvas, running, stepStatusByNodeId, workflow]);

  const rootAcceptedInputs = useMemo(() => {
    if (!workflow || workflow.nodes.length === 0) return undefined;
    const incomingTargets = new Set(workflow.edges.map((e) => e.target));
    const rootNode = workflow.nodes.find((n) => !incomingTargets.has(n.id)) ?? workflow.nodes[0];
    const entryInputs = rootNode?.data.entry?.input;
    if (!entryInputs || entryInputs.length === 0) return undefined;
    const nonText = entryInputs.filter((m) => m !== 'text');
    return nonText.length > 0 ? entryInputs : undefined;
  }, [workflow]);

  if (loading) {
    return (
      <div className="studio-container wf-run-container">
        <div className="empty-box stealth-glass">
          <LoaderCircle size={22} className="spin" />
          <p>Loading workflow...</p>
        </div>
      </div>
    );
  }

  if (isLockedUnpublished) {
    return (
      <div className="studio-container wf-run-container">
        <div className="empty-box stealth-glass">
          <Lock size={22} aria-hidden="true" />
          <h2>Private workflow</h2>
          <p>Only the creator can open or run this workflow until it is published.</p>
          <div className="wf-card-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigateTo('/market')}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>Market</span>
            </button>
            {!user ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openAuthModal}>
                <span>Sign in</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="studio-container wf-run-container">
        <div className="empty-box stealth-glass">
          <p>{loadError || 'Workflow not found.'}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigateTo('/market')}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
      </div>
    );
  }

  const tasks = workflow.terms?.tasks ?? workflow.tasks ?? [];
  const creatorFeePercent = workflow.published ? (workflow.terms?.creatorFee ?? 0) : 0;
  const platformFeePercent = workflow.published ? (config?.fees?.platformPercent ?? 2) : 0;
  const mintTxUrl = workflow.terms?.txHash
    ? explorerTxUrl(workflow.terms.txHash, workflow.terms.contractId)
    : null;
  const ipfsCardUrl = workflow.terms?.cid ? getIpfsGatewayUrl(workflow.terms.cid) : null;

  const activeStepIndex = runningStepId
    ? Math.max(1, workflow.nodes.findIndex((n) => n.id === runningStepId) + 1)
    : 1;
  const activeStepNode = runningStepId
    ? workflow.nodes.find((n) => n.id === runningStepId)
    : workflow.nodes[0];
  const completedStepCount = workflow.nodes.filter(
    (n) => stepStatusByNodeId.get(n.id) === 'done',
  ).length;
  const canContinueThread = Boolean(
    pausedThreadId ||
    (!execution &&
      activeThreadId &&
      completedStepCount > 0 &&
      completedStepCount < workflow.nodes.length),
  );
  const hasAnyOutput =
    Boolean(execution?.output) ||
    Object.keys(liveStepOutputs).length > 0 ||
    Object.values(liveStepStreams).some((v) => v.length > 0) ||
    liveCoordinatorStream.length > 0 ||
    liveActivities.length > 0;

  const activeTrace =
    activeTab === 'final' || activeTab === 'activity'
      ? null
      : execution?.steps.find((step) => step.id === activeTab) ?? null;
  const liveStepOutput =
    activeTab !== 'final' && activeTab !== 'activity'
      ? (liveStepOutputs[activeTab] ?? liveStepStreams[activeTab])
      : undefined;
  const liveStreamingPreview =
    (runningStepId ? liveStepStreams[runningStepId] : '') ||
    liveCoordinatorStream ||
    Object.values(liveStepOutputs).at(-1) ||
    '';
  const displayedOutput =
    activeTab === 'activity'
      ? ''
      : activeTrace
        ? activeTrace.output
        : activeTab === 'final'
          ? (execution?.output || liveCoordinatorStream || liveStreamingPreview)
          : (liveStepOutput ?? '');

  const latestActivity = liveActivities.at(-1) ?? null;
  const activeStreamSnippet = (
    (runningStepId ? liveStepStreams[runningStepId] : '') || liveCoordinatorStream
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-140);
  const billsToShow = execution?.bills?.length ? execution.bills : liveBills;

  const openStepInspector = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const hasStepResult =
      Boolean(execution?.steps.some((s) => s.id === nodeId)) ||
      Object.prototype.hasOwnProperty.call(liveStepOutputs, nodeId) ||
      Boolean(liveStepStreams[nodeId]);
    if (hasStepResult || (running && runningStepId === nodeId)) {
      setActiveTab(nodeId);
      setOutputDialogOpen(true);
    } else if (hasAnyOutput || running) {
      setActiveTab('final');
      setOutputDialogOpen(true);
    }
  };

  return (
    <div className="studio-container wf-run-container">
      <div
        className="canvas-stage wf-canvas-stage"
        data-side-open={sidePanelOpen ? 'true' : 'false'}
      >
        <div ref={planeRef} className="canvas-plane wf-canvas-plane">
          <header ref={hudRef} className="studio-hud wf-hud">
            <div className="studio-hud-left stealth-glass wf-hud-left">
              <Button
                icon={<ArrowLeft size={14} />}
                tooltip="Back"
                size="xs"
                onClick={handleBack}
              />
              <h1 className="wf-hud-title">{workflow.name}</h1>

              {running ? (
                <button
                  type="button"
                  className="wf-hud-live-pill is-executing"
                  onClick={() => setOutputDialogOpen(true)}
                >
                  <LoaderCircle size={12} className="spin" aria-hidden="true" />
                  <span>Step {activeStepIndex}/{workflow.nodes.length} · Executing</span>
                </button>
              ) : effectiveMissingConnectors.length > 0 ? (
                <button
                  type="button"
                  className="wf-hud-live-pill is-paused"
                  onClick={() => {
                    if (!user) openAuthModal();
                    else setCredentialsModalOpen(true);
                  }}
                >
                  <Link2 size={12} aria-hidden="true" />
                  <span>Connect</span>
                </button>
              ) : pausedThreadId && missingInputs.length > 0 ? (
                <button
                  type="button"
                  className="wf-hud-live-pill is-paused"
                  onClick={() => setInputPromptOpen(true)}
                >
                  <AlertTriangle size={12} aria-hidden="true" />
                  <span>Needs Input</span>
                </button>
              ) : execution ? (
                <button
                  type="button"
                  className="wf-hud-live-pill is-done"
                  onClick={() => {
                    setActiveTab('final');
                    setOutputDialogOpen(true);
                  }}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span>Done · {formatMicroUsdc(execution.totalChargedWei)}</span>
                </button>
              ) : completedStepCount > 0 ? (
                <button
                  type="button"
                  className="wf-hud-live-pill is-done"
                  onClick={() => {
                    const lastDoneId =
                      [...workflow.nodes]
                        .reverse()
                        .find((n) => stepStatusByNodeId.get(n.id) === 'done')?.id ?? 'final';
                    setActiveTab(lastDoneId);
                    setOutputDialogOpen(true);
                  }}
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span>
                    Steps {completedStepCount}/{workflow.nodes.length}
                  </span>
                </button>
              ) : null}
            </div>

            <div
              className="studio-hud-right stealth-glass wf-hud-right"
              role="toolbar"
              aria-label="Workflow controls"
            >
              <div className="wf-hud-zoom hide-mobile">
                <Button
                  icon={<Minus size={14} />}
                  tooltip="Zoom out"
                  size="xs"
                  onClick={() => void instanceRef.current?.zoomOut({ duration: 150 })}
                />
                <Button
                  icon={<Maximize2 size={13} />}
                  tooltip="Fit canvas"
                  size="xs"
                  onClick={() => fitWorkflowCanvas(200)}
                />
                <Button
                  icon={<Plus size={14} />}
                  tooltip="Zoom in"
                  size="xs"
                  onClick={() => void instanceRef.current?.zoomIn({ duration: 150 })}
                />
              </div>

              <button
                type="button"
                className={`wf-session-pill ${hasApprovedLimit ? 'is-funded' : ''}`}
                onClick={openAuthModal}
                title={user ? 'Manage session allowance' : 'Sign in'}
              >
                <Wallet size={13} aria-hidden="true" />
                <span className="hide-mobile">Approved</span>
                <strong>{user ? approvedUsd : '$0.00'}</strong>
              </button>

              {isOwner && !workflow.published ? (
                <Button
                  icon={<Edit3 size={13} />}
                  tooltip="Edit in Studio"
                  size="xs"
                  onClick={() =>
                    onOpenDraft({
                      id: workflow.id,
                      name: workflow.name,
                      brief: workflow.brief,
                      banner: workflow.banner ?? null,
                      ...(workflow.tasks?.length ? { tasks: workflow.tasks } : {}),
                      ...(workflow.coordinator !== undefined
                        ? { coordinator: workflow.coordinator }
                        : {}),
                      nodes: workflow.nodes,
                      edges: workflow.edges,
                      modified: workflow.modified,
                    })
                  }
                />
              ) : null}

              {!sidePanelOpen ? (
                <Button
                  icon={<PanelRight size={14} />}
                  tooltip="Workflow card"
                  size="xs"
                  aria-label="Open workflow card panel"
                  aria-expanded={false}
                  onClick={() => setSidePanelOpen(true)}
                />
              ) : null}
            </div>
          </header>

          <ReactFlow<Block, Link>
            nodes={nodesForCanvas}
            edges={edgesWithState}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              instanceRef.current = instance;
              window.requestAnimationFrame(() => {
                fitWorkflowCanvas(0);
              });
            }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={true}
            onNodeClick={(_, node) => openStepInspector(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            minZoom={0.24}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          />

          <div ref={dockRef} className="wf-floating-dock">
            <div
              className={`wf-prompt-card stealth-glass ${running ? 'is-running' : ''} ${pausedThreadId ? 'is-paused' : ''}`.trim()}
            >
              <div className="wf-prompt-bar">
                <CoordinatorField
                  mode="runner"
                  compact
                  value={runnerCoordinator}
                  entries={catalogModels}
                  disabled={running}
                  onNotify={onNotify}
                  onChange={(nextCoord) => {
                    setRunnerCoordinator(nextCoord);
                    setPausedThreadId(null);
                  }}
                />

                <div className="wf-prompt-toggles">
                  <Tooltip
                    label="Dry run"
                    description="Simulates paid actions without external side effects"
                  >
                    <button
                      type="button"
                      className={`wf-meta-chip ${dryRun ? 'is-dry' : ''}`}
                      aria-pressed={dryRun}
                      disabled={running}
                      onClick={() => setDryRun((v) => !v)}
                    >
                      <span>DRY</span>
                    </button>
                  </Tooltip>

                  {effectiveMissingConnectors.length > 0 && !credentialsModalOpen ? (
                    <button
                      type="button"
                      className="wf-meta-chip is-warn"
                      onClick={() => {
                        if (!user) openAuthModal();
                        else setCredentialsModalOpen(true);
                      }}
                    >
                      <Link2 size={11} aria-hidden="true" />
                      <span>Connect</span>
                    </button>
                  ) : null}

                  {missingInputs.length > 0 && !inputPromptOpen ? (
                    <button
                      type="button"
                      className="wf-meta-chip is-warn"
                      onClick={() => setInputPromptOpen(true)}
                    >
                      <span>Add input</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {running ? (
                <button
                  type="button"
                  className="wf-live-sse-strip"
                  onClick={() => setOutputDialogOpen(true)}
                  aria-label="Open live execution stream"
                >
                  <span className="wf-fold-dot" aria-hidden="true" />
                  <span className="wf-live-sse-title">
                    {latestActivity?.title ||
                      `Step ${activeStepIndex}/${workflow.nodes.length} · ${activeStepNode?.data.entry?.name || activeStepNode?.data.label || 'Executing'
                      }`}
                  </span>
                  {activeStreamSnippet ? (
                    <span className="wf-live-sse-snippet" aria-live="off">
                      {activeStreamSnippet}
                    </span>
                  ) : null}
                  {BigInt(liveComposeBillWei || '0') > 0n ? (
                    <span className="wf-live-sse-bill">
                      {formatMicroUsdc(liveComposeBillWei)}
                    </span>
                  ) : null}
                </button>
              ) : null}

              <RunComposer
                floating
                label={canContinueThread ? 'Continue Thread' : 'Workflow Prompt'}
                value={prompt}
                onChange={setPrompt}
                attachments={attachments}
                onAttachmentsChange={setAttachments}
                acceptedInputs={rootAcceptedInputs}
                placeholder={workflow.brief || 'Prompt workflow, attach media, or record voice...'}
                busy={running}
                submitDisabled={workflow.nodes.length === 0}
                submitLabel={canContinueThread ? 'Continue' : dryRun ? 'Dry Run' : 'Run'}
                busyLabel="Executing..."
                onSubmit={(overrideAttachments) =>
                  void handleRun(
                    undefined,
                    overrideAttachments ? { attachments: overrideAttachments } : undefined,
                  )
                }
                onAuthRequired={() => {
                  if (!user) {
                    openAuthModal();
                    return false;
                  }
                  return true;
                }}
                secondaryAction={
                  !user || !hasApprovedLimit ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={openAuthModal}
                    >
                      <span>{!user ? 'Sign in' : 'Approve limit'}</span>
                    </button>
                  ) : null
                }
                errorText={runError}
              />
            </div>
          </div>
        </div>

        {sidePanelOpen ? (
          <>
            <div
              className="wf-side-backdrop"
              aria-hidden="true"
              onClick={() => setSidePanelOpen(false)}
            />
            <aside
              className="studio-drawer studio-drawer-right wf-side-panel stealth-glass"
              aria-label="Workflow card"
            >
              <div className="drawer-header">
                <h2 className="wf-drawer-title">{workflow.name}</h2>
                <div className="drawer-header-actions">
                  <Button
                    icon={<PanelRight size={14} />}
                    tooltip="Close workflow card"
                    size="xs"
                    active
                    aria-label="Close workflow card panel"
                    aria-expanded={true}
                    onClick={() => setSidePanelOpen(false)}
                  />
                </div>
              </div>

              {user || hasAnyOutput || running || Boolean(!execution?.dry && execution?.proofUrl) ? (
                <div className="wf-drawer-subbar">
                  {user ? (
                    <ThreadSelector
                      threads={threads}
                      activeThreadId={activeThreadId}
                      disabled={running}
                      iconOnlyMobile
                      onSelectThread={(item) =>
                        hydrateThread(item, workflow, { autoOpenModals: false })
                      }
                      onNewThread={handleStartNewThread}
                    />
                  ) : (
                    <span />
                  )}
                  <ExecutionBadges
                    showOutput={hasAnyOutput || running}
                    outputActive={outputDialogOpen}
                    onToggleOutput={() => setOutputDialogOpen((v) => !v)}
                    proofUrl={!execution?.dry ? execution?.proofUrl : null}
                  />
                </div>
              ) : null}

              <div className="drawer-body scroll-area wf-side-body">
                <article className="wf-card wf-side-card">
                  {canEditBanner ? (
                    <BannerMediaFrame
                      src={workflow.banner}
                      uploading={uploadingBanner}
                      generating={generatingBanner}
                      uploadLabel="Upload banner"
                      changeLabel="Change banner"
                      removeLabel="Clear banner"
                      generateLabel="Generate banner"
                      regenerateLabel="Regenerate banner"
                      generateDescription="Uses Name, Description & Steps"
                      onUploadFile={handleWorkflowBannerUpload}
                      onGenerate={() => void handleWorkflowBannerGenerate()}
                      onRemove={
                        workflow.banner ? () => void handleWorkflowBannerRemove() : undefined
                      }
                    />
                  ) : workflow.banner ? (
                    <BannerMediaFrame src={workflow.banner} />
                  ) : null}

                  <div className="wf-card-top">
                    {tasks.length > 0 ? <TaskPills tasks={tasks} /> : <span />}
                    <span className="wf-price">
                      {creatorFeePercent > 0 ? `+${creatorFeePercent}%` : '0%'} royalty
                    </span>
                  </div>

                  {workflow.terms?.description || workflow.brief ? (
                    <p className="wf-side-desc">
                      {workflow.terms?.description || workflow.brief}
                    </p>
                  ) : null}

                  <div className="wf-side-creator-row">
                    {workflow.userAddress ? (
                      <CreatorSlot
                        address={workflow.userAddress}
                        fallbackName={workflow.creatorName}
                        fallbackAvatar={workflow.creatorAvatar}
                        showExplorer
                        onSelectCreator={(address) => {
                          if (workflow.published) {
                            navigateToCreator(address);
                          } else {
                            navigateTo('/workspace');
                          }
                        }}
                      />
                    ) : null}

                    <div className="wf-side-links">
                      {workflow.terms?.chainWorkflowId && mintTxUrl ? (
                        <a
                          href={mintTxUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chip-btn"
                        >
                          <span>#{workflow.terms.chainWorkflowId}</span>
                          <ExternalLink size={10} aria-hidden="true" />
                        </a>
                      ) : null}
                      {ipfsCardUrl ? (
                        <a
                          href={ipfsCardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="chip-btn"
                        >
                          <span>IPFS</span>
                          <ExternalLink size={10} aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="wf-fee-grid">
                    <div className="wf-fee-cell">
                      <span className="wf-fee-label">Creator</span>
                      <strong className={creatorFeePercent > 0 ? 'accent-gold' : ''}>
                        {creatorFeePercent > 0 ? `+${creatorFeePercent}%` : '0%'}
                      </strong>
                    </div>
                    <div className="wf-fee-cell">
                      <span className="wf-fee-label">Platform</span>
                      <strong>{platformFeePercent}%</strong>
                    </div>
                    <div className="wf-fee-cell">
                      <span className="wf-fee-label">Allowance</span>
                      <strong className={hasApprovedLimit ? 'accent-gold' : ''}>
                        {user ? approvedUsd : '$0.00'}
                      </strong>
                    </div>
                  </div>

                  <details className="wf-steps-fold">
                    <summary className="wf-steps-summary">
                      <span className="wf-steps-summary-text">
                        Steps ({workflow.nodes.length})
                      </span>
                      {running ? (
                        <span className="wf-fold-badge is-executing">
                          <span className="wf-fold-dot" aria-hidden="true" />
                          <span>executing</span>
                        </span>
                      ) : pausedThreadId ? (
                        <span className="wf-fold-badge is-paused">paused</span>
                      ) : completedStepCount > 0 ? (
                        <span className="wf-fold-badge is-done">
                          {completedStepCount}/{workflow.nodes.length} done
                        </span>
                      ) : null}
                    </summary>

                    <ol className="overview-steps-list wf-folded-steps-list" role="list">
                      {workflow.nodes.map((node, idx) => {
                        const status = stepStatusByNodeId.get(node.id) ?? 'idle';
                        const priceLabel = stepPriceByNodeId.get(node.id);
                        return (
                          <li key={node.id}>
                            <button
                              type="button"
                              className={`overview-step-row wf-fold-step-row is-${status}`}
                              data-kind={node.data.kind}
                              onClick={() => openStepInspector(node.id)}
                            >
                              <span className="overview-step-idx">{idx + 1}</span>
                              <span className="overview-step-title">
                                {node.data.entry?.name || node.data.label}
                              </span>
                              {priceLabel ? (
                                <span className="node-price-tag">{priceLabel}</span>
                              ) : null}
                              {status === 'executing' ? (
                                <span className="wf-step-inline-state is-executing">
                                  <LoaderCircle size={11} className="spin" aria-hidden="true" />
                                  <span>executing</span>
                                </span>
                              ) : status === 'done' ? (
                                <span className="wf-step-inline-state is-done">done</span>
                              ) : status === 'paused' ? (
                                <span className="wf-step-inline-state is-paused">paused</span>
                              ) : (
                                <span className="node-type" data-kind={node.data.kind}>
                                  {node.data.kind.toUpperCase()}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                </article>

                {execution ? (
                  <section className="wf-side-receipt" aria-label="Settlement receipt">
                    <div className="wf-side-section-head">
                      <span className="drawer-kicker">SETTLEMENT</span>
                      {execution.txHash ? (
                        <div className="wf-card-actions">
                          <a
                            href={explorerTxUrl(execution.txHash, execution.network)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="icon-btn btn-xs"
                            aria-label="View settlement transaction"
                          >
                            <ExternalLink size={11} aria-hidden="true" />
                          </a>
                        </div>
                      ) : null}
                    </div>
                    <div className="run-receipt-bar">
                      <span>
                        {execution.dry ? 'Dry · ' : ''}Charged{' '}
                        <strong>{formatMicroUsdc(execution.totalChargedWei)}</strong>
                      </span>
                      <div className="run-receipt-breakdown">
                        <span>Compute {formatMicroUsdc(execution.composeBillWei)}</span>
                        {BigInt(execution.creatorFeeWei || '0') > 0n ? (
                          <span>· Creator {formatMicroUsdc(execution.creatorFeeWei)}</span>
                        ) : null}
                        <span>· Platform {formatMicroUsdc(execution.platformFeeWei)}</span>
                      </div>
                    </div>
                    <ReceiptBillsFold bills={billsToShow} />
                  </section>
                ) : null}
              </div>
            </aside>
          </>
        ) : null}
      </div>

      <Modal
        open={outputDialogOpen}
        onClose={() => setOutputDialogOpen(false)}
        title={running ? `Executing · ${workflow.name}` : workflow.name}
        size="lg"
        headerActions={
          <div className="wf-sse-dialog-actions">
            {running ? (
              <span className="wf-fold-badge is-executing">
                <span className="wf-fold-dot" aria-hidden="true" />
                <span>step {activeStepIndex}/{workflow.nodes.length}</span>
              </span>
            ) : null}
            {!execution?.dry && execution?.proofUrl ? (
              <Tooltip label="IPFS Execution Proof">
                <a
                  href={execution.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="wf-result-badge is-proof"
                >
                  <ShieldCheck size={12} aria-hidden="true" />
                  <span className="wf-result-badge-label">Proof</span>
                </a>
              </Tooltip>
            ) : null}
            {execution?.txHash ? (
              <a
                href={explorerTxUrl(execution.txHash, execution.network)}
                target="_blank"
                rel="noopener noreferrer"
                className="icon-btn btn-xs"
                aria-label="View settlement transaction"
              >
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
            {displayedOutput ? (
              <Button
                icon={copied ? <Check size={13} /> : <Copy size={13} />}
                tooltip={copied ? 'Copied' : 'Copy output'}
                size="xs"
                onClick={() => {
                  void navigator.clipboard.writeText(displayedOutput);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              />
            ) : null}
          </div>
        }
      >
        <div className="wf-sse-dialog-body">
          {running ? (
            <div className="wf-sse-live-banner" role="status" aria-live="polite">
              <LoaderCircle size={15} className="spin" aria-hidden="true" />
              <div className="wf-sse-live-copy">
                <strong>
                  {latestActivity?.title ||
                    `Executing Step ${activeStepIndex} of ${workflow.nodes.length}`}
                </strong>
                <span>
                  {activeStepNode?.data.entry?.name ||
                    activeStepNode?.data.label ||
                    'Coordinator orchestrating steps'}
                </span>
              </div>
              {BigInt(liveComposeBillWei || '0') > 0n ? (
                <span className="wf-live-sse-bill">{formatMicroUsdc(liveComposeBillWei)}</span>
              ) : null}
            </div>
          ) : null}

          <div
            className="run-output-tabs"
            role="tablist"
            aria-label="Execution step outputs"
            onKeyDown={(evt) => {
              if (
                evt.key !== 'ArrowRight' &&
                evt.key !== 'ArrowLeft' &&
                evt.key !== 'Home' &&
                evt.key !== 'End'
              ) {
                return;
              }
              const tabs = Array.from(
                evt.currentTarget.querySelectorAll<HTMLButtonElement>(
                  'button[role="tab"]:not(:disabled)',
                ),
              );
              if (tabs.length === 0) return;
              const currentIdx = tabs.indexOf(document.activeElement as HTMLButtonElement);
              let nextIdx = 0;
              if (evt.key === 'Home') nextIdx = 0;
              else if (evt.key === 'End') nextIdx = tabs.length - 1;
              else if (evt.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length;
              else nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
              evt.preventDefault();
              const nextBtn = tabs[nextIdx];
              nextBtn?.focus();
              nextBtn?.click();
            }}
          >
            <button
              type="button"
              role="tab"
              tabIndex={activeTab === 'final' ? 0 : -1}
              aria-selected={activeTab === 'final'}
              className={`chip-btn ${activeTab === 'final' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('final')}
            >
              Deliverable
            </button>
            {workflow.nodes.map((node, idx) => {
              const status = stepStatusByNodeId.get(node.id) ?? 'idle';
              const priceLabel = stepPriceByNodeId.get(node.id);
              const selectable =
                status === 'done' ||
                status === 'executing' ||
                Boolean(execution?.steps.some((s) => s.id === node.id)) ||
                Boolean(liveStepOutputs[node.id]) ||
                Boolean(liveStepStreams[node.id]);
              return (
                <button
                  key={node.id}
                  type="button"
                  role="tab"
                  tabIndex={activeTab === node.id ? 0 : -1}
                  disabled={!selectable}
                  aria-selected={activeTab === node.id}
                  className={`chip-btn wf-step-tab ${activeTab === node.id ? 'is-active' : ''} is-${status}`}
                  onClick={() => setActiveTab(node.id)}
                >
                  <span>
                    {idx + 1}. {node.data.entry?.name || node.data.label}
                  </span>
                  {priceLabel ? <span className="node-price-tag">{priceLabel}</span> : null}
                </button>
              );
            })}
            {liveActivities.length > 0 ? (
              <button
                type="button"
                role="tab"
                tabIndex={activeTab === 'activity' ? 0 : -1}
                aria-selected={activeTab === 'activity'}
                className={`chip-btn wf-step-tab ${activeTab === 'activity' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('activity')}
              >
                <span>Activity ({liveActivities.length})</span>
              </button>
            ) : null}
          </div>

          {execution ? (
            <>
              <div className="run-receipt-bar">
                <span>
                  {execution.dry ? 'Dry Run · ' : ''}Charged:{' '}
                  <strong>{formatMicroUsdc(execution.totalChargedWei)}</strong>
                </span>
                <div className="run-receipt-breakdown">
                  <span>Compute {formatMicroUsdc(execution.composeBillWei)}</span>
                  {BigInt(execution.creatorFeeWei || '0') > 0n ? (
                    <span>· Creator {formatMicroUsdc(execution.creatorFeeWei)}</span>
                  ) : null}
                  <span>· Platform {formatMicroUsdc(execution.platformFeeWei)}</span>
                </div>
              </div>
              <ReceiptBillsFold bills={billsToShow} />
            </>
          ) : billsToShow.length > 0 ? (
            <ReceiptBillsFold bills={billsToShow} />
          ) : null}

          <div className="run-output-stage wf-sse-output-stage scrollable">
            {activeTab === 'activity' ? (
              <ol className="wf-activity-feed" role="list">
                {liveActivities.map((act) => (
                  <li key={act.id} className={`wf-activity-row is-${act.status}`}>
                    <span className={`wf-activity-dot is-${act.status}`} aria-hidden="true" />
                    <div className="wf-activity-content">
                      <div className="wf-activity-head">
                        <span className="wf-activity-kind">{act.kind.toUpperCase()}</span>
                        <strong className="wf-activity-title">{act.title}</strong>
                      </div>
                      {act.summary ? (
                        <p className="wf-activity-summary">{act.summary}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : displayedOutput ? (
              <RichOutput output={displayedOutput} />
            ) : running ? (
              <div className="run-placeholder">
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                <p>Streaming live execution events from Coordinator...</p>
              </div>
            ) : (
              <div className="run-placeholder">
                <Sparkles size={18} aria-hidden="true" />
                <p>Run the workflow from the floating prompt-box to stream step outputs.</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <CredentialsModal
        open={credentialsModalOpen && effectiveMissingConnectors.length > 0}
        missing={effectiveMissingConnectors}
        userAddress={subjectAddress}
        onClose={() => {
          setCredentialsModalOpen(false);
          void refreshConnectorStatus();
        }}
        onConnected={(decisions) => {
          const shouldAutoResume = Boolean(pausedThreadId || missingConnectors.length > 0);
          const resumeId = pausedThreadId ?? missingConnectors[0]?.threadId ?? undefined;
          setCredentialsModalOpen(false);
          setMissingConnectors([]);
          void refreshConnectorStatus();
          if (shouldAutoResume) {
            void handleRun(undefined, {
              ...(resumeId ? { threadId: resumeId } : {}),
              ...(decisions?.length ? { connectorDecisions: decisions } : {}),
            });
          } else {
            onNotify('Account connected');
          }
        }}
      />

      <Prompt
        open={inputPromptOpen && missingInputs.length > 0}
        missing={missingInputs}
        initialPrompt={prompt}
        initialAttachments={attachments}
        busy={running}
        onClose={() => setInputPromptOpen(false)}
        onSubmit={({ prompt: nextPrompt, attachments: nextAttachments }) => {
          const resumeId = pausedThreadId ?? missingInputs[0]?.threadId ?? undefined;
          setPrompt(nextPrompt);
          setAttachments(nextAttachments);
          setInputPromptOpen(false);
          setMissingInputs([]);
          void handleRun(undefined, {
            prompt: nextPrompt,
            attachments: nextAttachments,
            ...(resumeId ? { threadId: resumeId } : {}),
          });
        }}
      />
    </div>
  );
}
