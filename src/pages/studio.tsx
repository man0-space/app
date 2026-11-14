import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Check,
  Copy,
  FilePlus2,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Maximize2,
  Minus,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Redo2,
  Save,
  Undo2,
  X,
} from 'lucide-react';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '../components/button';
import { Catalog } from '../components/catalog';
import { RichOutput, RunComposer } from '../components/composer';
import { CoordinatorField } from '../components/coordinator';
import { CredentialsModal } from '../components/credentials';
import { type StudioMode } from '../components/layout';
import { BannerMediaFrame } from '../components/media';
import { Prompt } from '../components/prompt';
import { Settings } from '../components/settings';
import { edgeTypes, nodeTypes, type WireEdgeData } from '../components/step';
import { TaskPicker } from '../components/tags';
import { Tooltip } from '../components/tooltip';
import { Vibe } from '../components/vibe';
import { useAuth } from '../contexts/auth';
import { useDismiss } from '../hooks/use-dismiss';
import { uploadMediaImage } from '../hooks/use-profile';
import { formatMicroUsdc, useSession } from '../hooks/use-session';
import { useWorkflows } from '../hooks/use-workflow';
import {
  api,
  authenticated,
  type ConnectorDecisionItem,
  type Execution,
  Fault,
  type MissingConnectorRequirement,
  type MissingInputRequirement,
  type VibePatch,
  type WorkflowAttachment,
} from '../lib/api';
import {
  buildBannerBrandLogos,
  loadAll,
  peekCachedCatalogSnapshot,
} from '../lib/catalog';
import { checkWorkflowConnectors, type ConnectorAuthState } from '../lib/compose';
import {
  assignSmartEdgeHandles,
  collectActiveHandlesByNodeId,
  collectConnectedDirectionsByNodeId,
  computeAdaptiveWorkflowLayout,
  computeSafeCanvasViewport,
  connect as connectFlow,
  create,
  insertDirectionalStep,
  isCompactCanvasViewport,
  layout,
  nextUnknownWorkflowName,
  remove as removeNode,
  setCoordinator,
  update,
} from '../lib/graph';
import type { Block, Coordinator, Direction, Entry, Flow, Kind, Link, Step } from '../lib/schema';

interface StudioProps {
  flow: Flow;
  setFlow: Dispatch<SetStateAction<Flow>>;
  mode: StudioMode;
  setMode: (mode: StudioMode) => void;
  openedFromWorkspaceId?: string | null;
  onClearOpenedFromWorkspace?: () => void;
  onNotify: (msg: string) => void;
}

function hasWipContent(flow: Flow): boolean {
  if (flow.nodes.length > 0) return true;
  if (flow.brief && flow.brief.trim().length > 0) return true;
  if (flow.banner) return true;
  if (flow.coordinator) return true;
  if (flow.tasks && flow.tasks.length > 0) return true;
  const trimmedName = flow.name.trim();
  return Boolean(trimmedName && !/^unknown(?:\s*#\d+)?$/i.test(trimmedName));
}

function formatWipRelativeAge(iso?: string): string {
  if (!iso) return 'now';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return 'now';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function applyVibePatchToFlow(curr: Flow, patch: VibePatch): Flow {
  const modified = new Date().toISOString();
  switch (patch.op) {
    case 'set_title':
      return { ...curr, name: patch.name, modified };
    case 'set_description':
      return { ...curr, brief: patch.brief, modified };
    case 'set_categories':
      return { ...curr, tasks: patch.tasks, modified };
    case 'set_coordinator':
      return setCoordinator(curr, patch.coordinator);
    case 'set_banner':
      return { ...curr, banner: patch.banner, modified };
    case 'add_step':
      return {
        ...curr,
        nodes: [...curr.nodes.filter((n) => n.id !== patch.node.id), patch.node],
        edges: patch.edge
          ? [...curr.edges.filter((e) => e.id !== patch.edge!.id), patch.edge]
          : curr.edges,
        modified,
      };
    case 'update_step':
      return {
        ...curr,
        nodes: curr.nodes.map((n) =>
          n.id === patch.stepId
            ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.note !== undefined ? { note: patch.note } : {}),
                ...(patch.entry !== undefined ? { entry: patch.entry } : {}),
              },
            }
            : n,
        ),
        modified,
      };
    case 'connect_steps':
      return {
        ...curr,
        edges: [...curr.edges.filter((e) => e.id !== patch.edge.id), patch.edge],
        modified,
      };
    case 'remove_step':
      return removeNode(curr, patch.stepId);
    case 'arrange_canvas':
      return {
        ...curr,
        nodes: curr.nodes.map((n) =>
          patch.positions[n.id] ? { ...n, position: patch.positions[n.id]! } : n,
        ),
        modified,
      };
    default:
      return curr;
  }
}

interface PendingInsertion {
  anchorNodeId: string | null;
  direction: Direction | null;
}

const DIRECTION_LABEL: Record<Direction, string> = {
  left: 'Before',
  right: 'After',
  up: 'Parallel above',
  down: 'Parallel below',
};

export function Studio(props: StudioProps) {
  return (
    <ReactFlowProvider>
      <StudioInner {...props} />
    </ReactFlowProvider>
  );
}

function StudioInner({
  flow,
  setFlow,
  mode,
  setMode,
  openedFromWorkspaceId,
  onClearOpenedFromWorkspace,
  onNotify,
}: StudioProps) {
  const { user, openAuthModal } = useAuth();
  const {
    spendingAddress,
    approvedUsd,
    hasApprovedLimit,
    getRunSession,
    refresh: refreshSession,
  } = useSession();
  const { drafts, saveDraftItem, computeDefaultUnknownName } = useWorkflows();

  const [entries, setEntries] = useState<Entry[]>(() => peekCachedCatalogSnapshot());
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<Kind, string>>>({});
  const [catalogLoading, setCatalogLoading] = useState<boolean>(
    () => peekCachedCatalogSnapshot().length === 0,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<Kind>('model');
  const [pendingInsertion, setPendingInsertion] = useState<PendingInsertion | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const planeRef = useRef<HTMLDivElement | null>(null);
  const [planeSize, setPlaneSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight - 56 : 760,
  }));
  const [canvasReserves, setCanvasReserves] = useState<{ top: number; bottom: number }>({
    top: 66,
    bottom: 96,
  });
  const manualDragRef = useRef(false);
  const lastAutoLayoutKeyRef = useRef<string>('');
  const closeToolbox = useCallback(() => setToolboxOpen(false), []);
  useDismiss(toolboxOpen, dockRef, closeToolbox, 25);
  const [overviewOpen, setOverviewOpen] = useState<boolean>(() => !isCompactCanvasViewport());
  const [rightPanel, setRightPanel] = useState<'overview' | 'test'>('overview');

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onViewportChange = (evt: MediaQueryListEvent) => {
      if (evt.matches) {
        setOverviewOpen(false);
        setCatalogOpen(false);
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
      const nextTop = hudRect
        ? Math.max(52, Math.ceil(hudRect.bottom - planeRect.top) + 14)
        : 66;
      const nextBottom = dockRect
        ? Math.max(82, Math.ceil(planeRect.bottom - dockRect.top) + 16)
        : 96;
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
  }, [mode, catalogOpen, overviewOpen, selectedId]);

  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [generatingBanner, setGeneratingBanner] = useState(false);

  const [vibePrompt, setVibePrompt] = useState('');
  const [vibeBusy, setVibeBusy] = useState(false);
  const [vibeStatus, setVibeStatus] = useState<string | null>(null);
  const [vibePreview, setVibePreview] = useState('');
  const [vibeError, setVibeError] = useState<string | null>(null);
  const vibeAbortRef = useRef<AbortController | null>(null);

  const [testInput, setTestInput] = useState('');
  const [testAttachments, setTestAttachments] = useState<WorkflowAttachment[]>([]);
  const [testCoordinator, setTestCoordinator] = useState<Coordinator | null>(
    flow.coordinator ?? null,
  );
  const [pausedTestThreadId, setPausedTestThreadId] = useState<string | null>(null);
  const pausedTestContextRef = useRef<{ flowId: string; graphSig: string; input: string } | null>(
    null,
  );
  const [dryTest, setDryTest] = useState(true);
  const [testing, setTesting] = useState(false);
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Execution | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testLiveTitle, setTestLiveTitle] = useState<string | null>(null);
  const [testLiveSnippet, setTestLiveSnippet] = useState('');
  const [testLiveBillWei, setTestLiveBillWei] = useState('0');
  const [testActiveTab, setTestActiveTab] = useState<'final' | string>('final');
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
  const [copiedOutput, setCopiedOutput] = useState(false);

  useEffect(() => {
    if (flow.coordinator) {
      setTestCoordinator(flow.coordinator);
    }
  }, [flow.coordinator]);

  const [past, setPast] = useState<Flow[]>([]);
  const [future, setFuture] = useState<Flow[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);
  const [wipDrafts, setWipDrafts] = useState<Flow[]>([]);
  const instanceRef = useRef<ReactFlowInstance<Block, Link> | null>(null);
  const hydratedForUserRef = useRef<string | null>(null);
  const lastSyncedDraftJsonRef = useRef<string | null>(null);

  const testGraphSignature = useMemo(
    () =>
      `${flow.nodes.map((n) => `${n.id}:${n.data.entry?.id ?? ''}:${n.data.note}`).join('|')}::${flow.edges.map((e) => `${e.source}->${e.target}`).join('|')}`,
    [flow.edges, flow.nodes],
  );

  useEffect(() => {
    const ctx = pausedTestContextRef.current;
    if (!ctx) return;
    if (
      ctx.flowId !== flow.id ||
      ctx.graphSig !== testGraphSignature ||
      ctx.input !== testInput.trim()
    ) {
      pausedTestContextRef.current = null;
      setPausedTestThreadId(null);
      setMissingConnectors([]);
      setMissingInputs([]);
    }
  }, [flow.id, testGraphSignature, testInput]);

  const refreshWipDrafts = useCallback(async () => {
    if (!user?.consented || !user.userAddress || !authenticated()) {
      setWipDrafts([]);
      return;
    }
    const list = await api.drafts().catch(() => null);
    if (list) {
      setWipDrafts(list.filter((item) => hasWipContent(item)));
    }
  }, [user?.consented, user?.userAddress]);

  const catalogAbortRef = useRef<AbortController | null>(null);
  const refreshCatalog = useCallback((force = false) => {
    catalogAbortRef.current?.abort();
    const controller = new AbortController();
    catalogAbortRef.current = controller;
    setCatalogLoading(true);
    loadAll(controller.signal, force)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setEntries(snapshot.entries);
        setCatalogErrors(snapshot.errors);
      })
      .catch(() => {
        // Keep current catalog list
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCatalogLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    return refreshCatalog(false);
  }, [refreshCatalog]);

  useEffect(() => {
    const userAddr = user?.consented ? user.userAddress : null;
    if (!userAddr || !authenticated()) {
      hydratedForUserRef.current = null;
      lastSyncedDraftJsonRef.current = null;
      setWipDrafts([]);
      return;
    }
    hydratedForUserRef.current = userAddr;
    void refreshWipDrafts();
  }, [user?.consented, user?.userAddress, refreshWipDrafts]);

  useEffect(() => {
    if (openedFromWorkspaceId && openedFromWorkspaceId === flow.id) return;
    if (hasWipContent(flow)) return;
    const expectedName = computeDefaultUnknownName();
    if (flow.name !== expectedName) {
      setFlow((curr) => (hasWipContent(curr) ? curr : { ...curr, name: expectedName }));
    }
  }, [computeDefaultUnknownName, flow, openedFromWorkspaceId, setFlow]);

  useEffect(() => {
    if (vibeBusy) return;
    if (!user?.consented || !user.userAddress || !authenticated()) return;
    if (hydratedForUserRef.current !== user.userAddress) return;
    if (openedFromWorkspaceId && openedFromWorkspaceId === flow.id) return;

    if (!hasWipContent(flow)) {
      lastSyncedDraftJsonRef.current = null;
      return;
    }

    const serialized = JSON.stringify(flow);
    if (serialized === lastSyncedDraftJsonRef.current) return;

    const timer = window.setTimeout(() => {
      void api
        .draft(flow)
        .then(() => {
          lastSyncedDraftJsonRef.current = serialized;
          setWipDrafts((prev) => [flow, ...prev.filter((d) => d.id !== flow.id)].slice(0, 8));
        })
        .catch(() => undefined);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [flow, vibeBusy, user?.consented, user?.userAddress, openedFromWorkspaceId]);

  const commitFlow = useCallback(
    (updater: (prev: Flow) => Flow) => {
      setFlow((current) => {
        const next = updater(current);
        if (next === current) return current;
        setPast((p) => [...p.slice(-24), current]);
        setFuture([]);
        return next;
      });
    },
    [setFlow],
  );

  const handleUndo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      setFlow((curr) => {
        setFuture((f) => [curr, ...f]);
        return previous;
      });
      return p.slice(0, -1);
    });
  }, [setFlow]);

  const handleRedo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setFlow((curr) => {
        setPast((p) => [...p, curr]);
        return next;
      });
      return f.slice(1);
    });
  }, [setFlow]);

  const selectedNode = useMemo(
    () => flow.nodes.find((n) => n.id === selectedId) ?? null,
    [flow.nodes, selectedId],
  );

  const openCatalogForInsertion = useCallback(
    (anchorNodeId: string | null, direction: Direction | null, tab: Kind = 'model') => {
      setPendingInsertion({ anchorNodeId, direction });
      setCatalogTab(tab);
      setCatalogOpen(true);
      setToolboxOpen(false);
    },
    [],
  );

  const handleQuickAdd = useCallback(
    (anchorNodeId: string, direction: Direction) => {
      openCatalogForInsertion(anchorNodeId, direction, 'model');
    },
    [openCatalogForInsertion],
  );

  const currentLayoutMode: 'vertical' | 'serpentine' = useMemo(() => {
    const usableH = Math.max(220, planeSize.height - canvasReserves.top - canvasReserves.bottom);
    return isCompactCanvasViewport(planeSize.width) || planeSize.width < usableH * 0.92
      ? 'vertical'
      : 'serpentine';
  }, [canvasReserves.bottom, canvasReserves.top, planeSize.height, planeSize.width]);

  const fitStudioCanvas = useCallback(
    (duration = 200, nodesOverride?: readonly Block[]) => {
      const inst = instanceRef.current;
      const targetNodes = nodesOverride ?? flow.nodes;
      if (!inst || targetNodes.length === 0) return;
      const measured = new Map<string, { width: number; height: number }>();
      for (const n of targetNodes) {
        const internal = inst.getInternalNode(n.id);
        const w = internal?.measured?.width;
        const h = internal?.measured?.height;
        if (w && h) measured.set(n.id, { width: w, height: h });
      }
      const vp = computeSafeCanvasViewport(
        targetNodes,
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
    [canvasReserves.bottom, canvasReserves.top, flow.nodes, planeSize.height, planeSize.width],
  );

  const topologyKey = useMemo(
    () =>
      `${flow.id}|${flow.nodes.map((n) => n.id).join(',')}|${flow.edges
        .map((e) => `${e.source}->${e.target}`)
        .join(',')}`,
    [flow.edges, flow.id, flow.nodes],
  );

  useEffect(() => {
    if (mode !== 'canvas' || flow.nodes.length === 0) return;
    const isPortrait = currentLayoutMode === 'vertical';
    const bucketW = Math.max(1, Math.round(planeSize.width / 160));
    const bucketH = Math.max(1, Math.round(planeSize.height / 160));
    const autoKey = `${topologyKey}|${isPortrait ? 'V' : 'H'}|${bucketW}x${bucketH}`;
    if (lastAutoLayoutKeyRef.current === autoKey) return;
    if (manualDragRef.current && lastAutoLayoutKeyRef.current.startsWith(`${topologyKey}|`)) {
      return;
    }
    const arranged = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, {
      width: planeSize.width,
      height: planeSize.height,
      topReserve: canvasReserves.top,
      bottomReserve: canvasReserves.bottom,
    });
    const moved = arranged.nodes.some((n, idx) => {
      const prev = flow.nodes[idx];
      return (
        !prev ||
        Math.abs(prev.position.x - n.position.x) > 1 ||
        Math.abs(prev.position.y - n.position.y) > 1
      );
    });
    const handlesChanged = arranged.edges.some((e, idx) => {
      const prev = flow.edges[idx];
      return !prev || prev.sourceHandle !== e.sourceHandle || prev.targetHandle !== e.targetHandle;
    });
    if (moved || handlesChanged) {
      setFlow((curr) => ({
        ...curr,
        nodes: arranged.nodes,
        edges: arranged.edges,
      }));
      return;
    }
    lastAutoLayoutKeyRef.current = autoKey;
    const timer = window.setTimeout(() => {
      fitStudioCanvas(180);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [
    canvasReserves.bottom,
    canvasReserves.top,
    currentLayoutMode,
    fitStudioCanvas,
    flow.edges,
    flow.nodes,
    mode,
    planeSize.height,
    planeSize.width,
    setFlow,
    topologyKey,
  ]);

  useEffect(() => {
    if (mode !== 'canvas' || flow.nodes.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      fitStudioCanvas(160);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    canvasReserves.bottom,
    canvasReserves.top,
    catalogOpen,
    fitStudioCanvas,
    flow.nodes.length,
    mode,
    overviewOpen,
    planeSize.height,
    planeSize.width,
  ]);

  const handleAddEntry = useCallback(
    (entry: Entry) => {
      let addedId: string | null = null;
      let nextNodes: Block[] | undefined;
      const anchorId =
        pendingInsertion?.anchorNodeId ??
        selectedId ??
        (flow.nodes.length > 0 ? flow.nodes[flow.nodes.length - 1]!.id : null);
      const direction: Direction | null =
        pendingInsertion?.direction ??
        (anchorId ? (currentLayoutMode === 'vertical' ? 'down' : 'right') : null);

      manualDragRef.current = false;
      lastAutoLayoutKeyRef.current = '';
      commitFlow((current) => {
        const inserted = insertDirectionalStep(current, entry, anchorId, direction, {
          layoutMode: currentLayoutMode,
        });
        addedId = inserted.nodeId;
        const arranged = layout(inserted.flow, {
          width: planeSize.width,
          height: planeSize.height,
          topReserve: canvasReserves.top,
          bottomReserve: canvasReserves.bottom,
        });
        nextNodes = arranged.nodes;
        return arranged;
      });

      if (isCompactCanvasViewport()) {
        setSelectedId(null);
      } else if (addedId) {
        setSelectedId(addedId);
      }
      setCatalogOpen(false);
      setPendingInsertion(null);
      setToolboxOpen(false);

      window.setTimeout(() => {
        fitStudioCanvas(200, nextNodes);
      }, 40);
    },
    [
      pendingInsertion,
      selectedId,
      flow.nodes,
      currentLayoutMode,
      commitFlow,
      planeSize.width,
      planeSize.height,
      canvasReserves.top,
      canvasReserves.bottom,
      fitStudioCanvas,
    ],
  );

  const handleUpdateStep = useCallback(
    (id: string, patch: Partial<Step>) => {
      commitFlow((current) => update(current, id, patch));
    },
    [commitFlow],
  );

  const handleRemoveStep = useCallback(
    (id: string) => {
      manualDragRef.current = false;
      lastAutoLayoutKeyRef.current = '';
      commitFlow((current) =>
        layout(removeNode(current, id), {
          width: planeSize.width,
          height: planeSize.height,
          topReserve: 66,
          bottomReserve: 96,
        }),
      );
      if (selectedId === id) setSelectedId(null);
    },
    [commitFlow, planeSize.height, planeSize.width, selectedId],
  );

  const handleAutoLayout = useCallback(() => {
    manualDragRef.current = false;
    lastAutoLayoutKeyRef.current = '';
    commitFlow((current) =>
      layout(current, {
        width: planeSize.width,
        height: planeSize.height,
        topReserve: 66,
        bottomReserve: 96,
      }),
    );
    window.setTimeout(() => {
      fitStudioCanvas(220);
    }, 30);
  }, [commitFlow, fitStudioCanvas, planeSize.height, planeSize.width]);

  const handleNewFlow = useCallback(() => {
    manualDragRef.current = false;
    lastAutoLayoutKeyRef.current = '';
    lastSyncedDraftJsonRef.current = null;
    onClearOpenedFromWorkspace?.();
    pausedTestContextRef.current = null;
    setPausedTestThreadId(null);
    setMissingConnectors([]);
    setMissingInputs([]);
    if (authenticated()) {
      void refreshWipDrafts();
    }
    const freshName = computeDefaultUnknownName();
    setPast([]);
    setFuture([]);
    setFlow(create(freshName));
    setSelectedId(null);
    setPendingInsertion(null);
    setTestResult(null);
    setTestError(null);
    onNotify('New canvas ready');
  }, [onClearOpenedFromWorkspace, refreshWipDrafts, computeDefaultUnknownName, setFlow, onNotify]);

  const handleSaveDraft = useCallback(async () => {
    if (savingDraft) return;
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setSavingDraft(true);
    try {
      const targetFlowId = flow.id;
      const cleanName = flow.name.trim() || computeDefaultUnknownName();
      const saved = await saveDraftItem({ ...flow, name: cleanName }, cleanName);
      lastSyncedDraftJsonRef.current = null;
      onClearOpenedFromWorkspace?.();
      pausedTestContextRef.current = null;
      setPausedTestThreadId(null);
      setMissingConnectors([]);
      setMissingInputs([]);
      setWipDrafts((prev) => prev.filter((d) => d.id !== targetFlowId && d.id !== saved.id));
      const nextFreshName = nextUnknownWorkflowName([
        ...drafts.map((d) => d.title),
        saved.title,
      ]);
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setPendingInsertion(null);
      setTestResult(null);
      setTestError(null);
      setFlow(create(nextFreshName));
      onNotify(`Saved "${saved.title}" to Workspace`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save workflow');
    } finally {
      setSavingDraft(false);
    }
  }, [
    savingDraft,
    user,
    openAuthModal,
    flow,
    computeDefaultUnknownName,
    saveDraftItem,
    onClearOpenedFromWorkspace,
    drafts,
    setFlow,
    onNotify,
  ]);

  const handleSelectWipDraft = useCallback(
    (wip: Flow) => {
      manualDragRef.current = false;
      lastAutoLayoutKeyRef.current = '';
      lastSyncedDraftJsonRef.current = JSON.stringify(wip);
      onClearOpenedFromWorkspace?.();
      pausedTestContextRef.current = null;
      setPausedTestThreadId(null);
      setMissingConnectors([]);
      setMissingInputs([]);
      setPast([]);
      setFuture([]);
      setSelectedId(null);
      setPendingInsertion(null);
      setTestResult(null);
      setTestError(null);
      setFlow(wip);
      setMode('canvas');
      window.setTimeout(() => {
        fitStudioCanvas(220);
      }, 50);
    },
    [onClearOpenedFromWorkspace, setFlow, setMode, fitStudioCanvas],
  );

  const handleDiscardWipDraft = useCallback(
    (id: string) => {
      setWipDrafts((prev) => prev.filter((d) => d.id !== id));
      if (authenticated()) {
        void api.deleteDraft(id).catch(() => undefined);
      }
      if (flow.id === id) {
        lastSyncedDraftJsonRef.current = null;
        pausedTestContextRef.current = null;
        setPausedTestThreadId(null);
        const freshName = computeDefaultUnknownName();
        setFlow(create(freshName));
      }
    },
    [flow.id, computeDefaultUnknownName, setFlow],
  );

  const handleBannerUpload = useCallback(
    async (file: File) => {
      setUploadingBanner(true);
      try {
        const bannerUrl = await uploadMediaImage(file, 'workflow-banner');
        commitFlow((curr) => ({
          ...curr,
          banner: bannerUrl,
          modified: new Date().toISOString(),
        }));
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Unable to upload banner');
      } finally {
        setUploadingBanner(false);
      }
    },
    [commitFlow, onNotify],
  );

  const handleGenerateBanner = useCallback(async () => {
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setGeneratingBanner(true);
    try {
      const session = await getRunSession();
      if (!session) {
        openAuthModal();
        onNotify('Approve a session limit in Account to generate a banner ($0.03).');
        return;
      }
      const logos = buildBannerBrandLogos(flow.nodes);

      const generated = await api.generateBanner(
        {
          title: flow.name.trim() || 'man0 Workflow',
          description:
            flow.brief?.trim() ||
            flow.nodes.map((n) => n.data.label).join(', ') ||
            'Autonomous multi-step AI and Web3 workflow.',
          ...(logos.length > 0 ? { logos } : {}),
        },
        session,
      );
      commitFlow((curr) => ({
        ...curr,
        banner: generated.imageUrl,
        modified: new Date().toISOString(),
      }));
      onNotify('Generated workflow banner');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to generate banner');
    } finally {
      setGeneratingBanner(false);
      void refreshSession();
    }
  }, [
    user,
    openAuthModal,
    getRunSession,
    refreshSession,
    flow.name,
    flow.brief,
    flow.nodes,
    commitFlow,
    onNotify,
  ]);

  const openTestRunPanel = useCallback(() => {
    if (mode !== 'canvas') setMode('canvas');
    setSelectedId(null);
    setRightPanel('test');
    setOverviewOpen(true);
    setTestError(null);
  }, [mode, setMode]);

  const executeTestRun = useCallback(
    async (
      event?: FormEvent,
      overrides?: {
        prompt?: string;
        attachments?: WorkflowAttachment[];
        threadId?: string;
        skipClarify?: boolean;
        connectorDecisions?: ConnectorDecisionItem[];
      },
    ) => {
      event?.preventDefault();
      if (flow.nodes.length === 0) {
        setTestError('Add at least one step first.');
        return;
      }
      if (flow.nodes.some((n) => !n.data.entry)) {
        setTestError('Select a catalog step for every node first.');
        return;
      }
      if (!user) {
        openAuthModal();
        return;
      }

      const effectiveInput = (overrides?.prompt ?? testInput).trim();
      const effectiveAttachments = overrides?.attachments ?? testAttachments;
      const resumeThreadId = overrides?.threadId?.trim() || undefined;
      const activeCoordinator = testCoordinator ?? flow.coordinator ?? null;

      setTesting(true);
      setTestError(null);
      setMissingConnectors([]);
      setCredentialsModalOpen(false);
      setMissingInputs([]);
      setInputPromptOpen(false);
      if (!resumeThreadId) {
        pausedTestContextRef.current = null;
        setPausedTestThreadId(null);
        setTestResult(null);
        setTestLiveTitle(null);
        setTestLiveSnippet('');
        setTestLiveBillWei('0');
        setTestActiveTab('final');
      }
      const recordPausedThread = (tid?: string) => {
        if (!tid) return;
        pausedTestContextRef.current = {
          flowId: flow.id,
          graphSig: testGraphSignature,
          input: effectiveInput,
        };
        setPausedTestThreadId(tid);
      };
      const firstPendingId = resumeThreadId
        ? (flow.nodes.find((n) => !n.data.output)?.id ?? flow.nodes[0]?.id ?? null)
        : (flow.nodes[0]?.id ?? null);
      setRunningNodeId(firstPendingId);

      try {
        const session = await getRunSession();
        if (!session) {
          setTesting(false);
          setRunningNodeId(null);
          openAuthModal();
          setTestError('Approve a session limit in Account to run steps.');
          return;
        }

        const result = await api.testRunDraft(
          flow,
          effectiveInput || flow.brief || undefined,
          session,
          {
            dry: dryTest,
            ...(overrides?.skipClarify !== undefined
              ? { skipClarify: overrides.skipClarify }
              : {}),
            ...(effectiveAttachments.length > 0 ? { attachments: effectiveAttachments } : {}),
            ...(resumeThreadId ? { threadId: resumeThreadId } : {}),
            ...(activeCoordinator ? { coordinator: activeCoordinator } : {}),
            ...(overrides?.connectorDecisions?.length
              ? { connectorDecisions: overrides.connectorDecisions }
              : {}),
            onEvent: (evt) => {
              if (evt.type === 'step:start') {
                setRunningNodeId(evt.stepId);
                setTestLiveSnippet('');
              } else if (evt.type === 'step:done') {
                setFlow((curr) => ({
                  ...curr,
                  nodes: curr.nodes.map((node) =>
                    node.id === evt.stepId
                      ? { ...node, data: { ...node.data, output: evt.output } }
                      : node,
                  ),
                }));
              } else if (evt.type === 'sse:activity') {
                setTestLiveTitle(evt.summary || evt.title);
              } else if (evt.type === 'sse:delta') {
                setTestLiveSnippet((prev) => `${prev}${evt.delta}`.replace(/\s+/g, ' ').slice(-120));
              } else if (evt.type === 'sse:bill') {
                setTestLiveBillWei(evt.composeBillWei);
              } else if (evt.type === 'connector:pause') {
                setMissingConnectors(evt.missing);
                recordPausedThread(evt.missing[0]?.threadId);
                setCredentialsModalOpen(true);
              } else if (evt.type === 'input:pause') {
                setMissingInputs(evt.missingInputs);
                recordPausedThread(evt.missingInputs[0]?.threadId);
                setInputPromptOpen(true);
              }
            },
          },
        );
        setTestResult(result);
        pausedTestContextRef.current = null;
        setPausedTestThreadId(null);

        const stepOutputs = new Map(result.steps.map((s) => [s.id, s.output]));
        setFlow((curr) => ({
          ...curr,
          nodes: curr.nodes.map((node) =>
            stepOutputs.has(node.id)
              ? { ...node, data: { ...node.data, output: stepOutputs.get(node.id) } }
              : node,
          ),
        }));
      } catch (err) {
        if (err instanceof Fault && err.code === 'CONNECTOR_REQUIRED' && err.missing?.length) {
          setMissingConnectors(err.missing);
          recordPausedThread(err.missing[0]?.threadId);
          setCredentialsModalOpen(true);
          setTestError(err.message);
        } else if (
          err instanceof Fault &&
          err.code === 'INPUT_REQUIRED' &&
          err.missingInputs?.length
        ) {
          setMissingInputs(err.missingInputs);
          recordPausedThread(err.missingInputs[0]?.threadId);
          setInputPromptOpen(true);
          setTestError(err.message);
        } else {
          setTestError(err instanceof Error ? err.message : 'Test run failed.');
        }
      } finally {
        setRunningNodeId(null);
        setTesting(false);
        void refreshSession();
      }
    },
    [
      flow,
      testGraphSignature,
      user,
      openAuthModal,
      getRunSession,
      refreshSession,
      testInput,
      testAttachments,
      testCoordinator,
      dryTest,
      setFlow,
    ],
  );

  const subjectAddress = spendingAddress ?? user?.userAddress ?? null;

  const connectorTopologyKey = useMemo(
    () =>
      flow.nodes
        .filter((n) => n.data.kind === 'connector')
        .map((n) => `${n.id}:${n.data.entry?.id ?? ''}`)
        .join('|'),
    [flow.nodes],
  );

  const refreshStudioConnectors = useCallback(async () => {
    if (!subjectAddress || !connectorTopologyKey) {
      setConnectorAuthByNodeId({});
      setProactiveMissingConnectors([]);
      return;
    }
    const checked = await checkWorkflowConnectors(subjectAddress, flow.nodes).catch(() => null);
    if (!checked) return;
    setConnectorAuthByNodeId(checked.authStateByNodeId);
    setProactiveMissingConnectors(checked.missing);
  }, [connectorTopologyKey, flow.nodes, subjectAddress]);

  useEffect(() => {
    void refreshStudioConnectors();
  }, [refreshStudioConnectors]);

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

  const handleStudioConnectClick = useCallback(
    (_nodeId: string) => {
      if (!user) {
        openAuthModal();
        return;
      }
      setCredentialsModalOpen(true);
    },
    [openAuthModal, user],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        void handleSaveDraft();
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        if (mode !== 'canvas') setMode('canvas');
        const anchorId =
          selectedId ??
          (flow.nodes.length > 0 ? flow.nodes[flow.nodes.length - 1]!.id : null);
        openCatalogForInsertion(anchorId, anchorId ? 'right' : null, 'model');
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (!isTextInput && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    handleSaveDraft,
    mode,
    setMode,
    selectedId,
    flow.nodes,
    openCatalogForInsertion,
    handleRedo,
    handleUndo,
  ]);

  const handleCancelVibe = useCallback(() => {
    vibeAbortRef.current?.abort();
    vibeAbortRef.current = null;
    setVibeBusy(false);
    setVibeStatus(null);
    setGeneratingBanner(false);
  }, []);

  const handleGenerateFromVibe = useCallback(
    async (prompt: string) => {
      const cleanPrompt = prompt.trim();
      if (!cleanPrompt || vibeBusy) return;
      if (!user || !authenticated()) {
        openAuthModal();
        return;
      }

      vibeAbortRef.current?.abort();
      const controller = new AbortController();
      vibeAbortRef.current = controller;

      const snapshotBefore = flow;
      setPast((p) => [...p.slice(-24), snapshotBefore]);
      setFuture([]);

      setVibeBusy(true);
      setVibeError(null);
      setVibePreview('');
      setVibeStatus('Architecting workflow...');

      let workflowReadyHandled = false;
      const persistReadyDraft = (targetFlow: Flow) => {
        if (
          user?.consented &&
          user.userAddress &&
          authenticated() &&
          hasWipContent(targetFlow)
        ) {
          const serialized = JSON.stringify(targetFlow);
          lastSyncedDraftJsonRef.current = serialized;
          setWipDrafts((prev) => [
            targetFlow,
            ...prev.filter((d) => d.id !== targetFlow.id),
          ].slice(0, 8));
          void api.draft(targetFlow).catch(() => {
            lastSyncedDraftJsonRef.current = null;
          });
        }
      };

      try {
        const session = await getRunSession();
        if (!session) {
          openAuthModal();
          setVibeError('Approve a session limit in Account to run Vibe ($0.02).');
          return;
        }

        if (
          user?.consented &&
          user.userAddress &&
          authenticated() &&
          !(openedFromWorkspaceId && openedFromWorkspaceId === snapshotBefore.id) &&
          hasWipContent(snapshotBefore)
        ) {
          setWipDrafts((prev) => [
            snapshotBefore,
            ...prev.filter((d) => d.id !== snapshotBefore.id),
          ].slice(0, 8));
          void api.draft(snapshotBefore).catch(() => undefined);
        }

        const freshFlow = create(computeDefaultUnknownName());
        onClearOpenedFromWorkspace?.();
        pausedTestContextRef.current = null;
        setPausedTestThreadId(null);
        setMissingConnectors([]);
        setMissingInputs([]);
        setTestResult(null);
        setTestError(null);
        lastSyncedDraftJsonRef.current = null;
        setFlow(freshFlow);

        const done = await api.streamVibe({
          prompt: cleanPrompt,
          flow: freshFlow,
          mode: 'create',
          history: [],
          composeSession: session,
          signal: controller.signal,
          onEvent: (evt) => {
            if (evt.type === 'status') {
              setVibeStatus(evt.text);
            } else if (evt.type === 'delta') {
              setVibePreview((prev) => prev + evt.text);
            } else if (evt.type === 'banner_start') {
              setGeneratingBanner(true);
            } else if (evt.type === 'patch') {
              if (evt.patch.op === 'set_banner') {
                setGeneratingBanner(false);
              }
              setFlow((curr) => applyVibePatchToFlow(curr, evt.patch));
            } else if (evt.type === 'workflow_ready') {
              void refreshSession();
              workflowReadyHandled = true;
              manualDragRef.current = false;
              lastAutoLayoutKeyRef.current = '';
              setFlow((curr) => {
                const arranged = layout(
                  { ...evt.flow, banner: curr.banner ?? evt.flow.banner },
                  {
                    width: planeSize.width,
                    height: planeSize.height,
                    topReserve: 66,
                    bottomReserve: 96,
                  },
                );
                persistReadyDraft(arranged);
                return arranged;
              });
              setVibePrompt('');
              setVibeBusy(false);
              setVibeStatus(null);
              setMode('canvas');
              setSelectedId(null);
              setRightPanel('overview');
              setOverviewOpen(!isCompactCanvasViewport());
              window.setTimeout(() => {
                fitStudioCanvas(240);
              }, 60);
            }
          },
        });

        if (done) {
          if (!workflowReadyHandled) {
            manualDragRef.current = false;
            lastAutoLayoutKeyRef.current = '';
            const arrangedDone = layout(done.flow, {
              width: planeSize.width,
              height: planeSize.height,
              topReserve: 66,
              bottomReserve: 96,
            });
            setFlow(arrangedDone);
            setVibePrompt('');
            persistReadyDraft(arrangedDone);
            setMode('canvas');
            setSelectedId(null);
            setRightPanel('overview');
            setOverviewOpen(!isCompactCanvasViewport());
            window.setTimeout(() => {
              fitStudioCanvas(240);
            }, 60);
          } else if (done.flow.banner) {
            setFlow((curr) => {
              if (curr.banner === done.flow.banner) return curr;
              const withBanner = {
                ...curr,
                banner: done.flow.banner,
                modified: new Date().toISOString(),
              };
              persistReadyDraft(withBanner);
              return withBanner;
            });
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setVibeError(err instanceof Error ? err.message : 'Vibe generation failed.');
        }
      } finally {
        if (vibeAbortRef.current === controller) {
          vibeAbortRef.current = null;
        }
        setVibeBusy(false);
        setVibeStatus(null);
        setGeneratingBanner(false);
        void refreshSession();
      }
    },
    [
      vibeBusy,
      user,
      openAuthModal,
      getRunSession,
      refreshSession,
      flow,
      openedFromWorkspaceId,
      onClearOpenedFromWorkspace,
      computeDefaultUnknownName,
      setFlow,
      setMode,
      planeSize.width,
      planeSize.height,
      fitStudioCanvas,
    ],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<Block>[]) => {
      if (changes.some((c) => c.type === 'position' && c.dragging)) {
        manualDragRef.current = true;
      }
      setFlow((current) => {
        const nextNodes = applyNodeChanges(changes, current.nodes);
        const nextEdges = changes.some((c) => c.type === 'position')
          ? assignSmartEdgeHandles(nextNodes, current.edges)
          : current.edges;
        return {
          ...current,
          nodes: nextNodes,
          edges: nextEdges,
        };
      });
    },
    [setFlow],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Link>[]) => {
      setFlow((current) => ({
        ...current,
        edges: applyEdgeChanges(changes, current.edges),
      }));
    },
    [setFlow],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      try {
        commitFlow((current) => connectFlow(current, connection.source, connection.target));
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Invalid connection');
      }
    },
    [commitFlow, onNotify],
  );

  const smartEdges = useMemo(
    () => assignSmartEdgeHandles(flow.nodes, flow.edges),
    [flow.edges, flow.nodes],
  );

  const activeHandlesByNode = useMemo(
    () => collectActiveHandlesByNodeId(flow.nodes, smartEdges),
    [flow.nodes, smartEdges],
  );

  const connectedDirectionsByNode = useMemo(
    () => collectConnectedDirectionsByNodeId(flow.nodes, smartEdges),
    [flow.nodes, smartEdges],
  );

  const nodesForCanvas = useMemo<Block[]>(
    () =>
      flow.nodes.map((node) => {
        const settledStep = testResult?.steps.find((s) => s.id === node.id);
        const priceLabel =
          settledStep?.billWei && BigInt(settledStep.billWei) > 0n
            ? formatMicroUsdc(settledStep.billWei)
            : undefined;
        return {
          ...node,
          data: {
            ...node.data,
            running: runningNodeId === node.id,
            priceLabel,
            liveStatus: runningNodeId === node.id ? testLiveTitle ?? undefined : undefined,
            connectorAuthState: connectorAuthByNodeId[node.id],
            onConnectClick: handleStudioConnectClick,
            onQuickAdd: handleQuickAdd,
            activeHandles: activeHandlesByNode.get(node.id),
            connectedDirections: connectedDirectionsByNode.get(node.id),
            layoutMode: currentLayoutMode,
          },
        };
      }),
    [
      flow.nodes,
      runningNodeId,
      testResult,
      testLiveTitle,
      connectorAuthByNodeId,
      handleStudioConnectClick,
      handleQuickAdd,
      activeHandlesByNode,
      connectedDirectionsByNode,
      currentLayoutMode,
    ],
  );

  const edgesWithState = useMemo<Link[]>(
    () =>
      smartEdges.map((edge) => {
        const sourceKind =
          flow.nodes.find((n) => n.id === edge.source)?.data.kind ?? 'model';
        const wireData: WireEdgeData = {
          kind: sourceKind,
          active: runningNodeId === edge.source,
        };
        return {
          ...edge,
          type: 'wire',
          data: wireData,
        };
      }),
    [smartEdges, flow.nodes, runningNodeId],
  );

  const catalogContextLabel = useMemo(() => {
    if (!pendingInsertion?.anchorNodeId || !pendingInsertion.direction) return null;
    const anchor = flow.nodes.find((n) => n.id === pendingInsertion.anchorNodeId);
    if (!anchor) return null;
    return `${DIRECTION_LABEL[pendingInsertion.direction]} "${anchor.data.label}"`;
  }, [pendingInsertion, flow.nodes]);

  const showRightDrawer = Boolean(selectedNode || overviewOpen);

  const activeMobilePocket: 'canvas' | 'catalog' | 'inspector' = catalogOpen
    ? 'catalog'
    : showRightDrawer
      ? 'inspector'
      : 'canvas';

  const hudNode = (
    <div ref={hudRef} className="studio-hud">
      <div className="studio-hud-left stealth-glass" role="tablist" aria-label="Studio view">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'vibe'}
          className={`seg-btn ${mode === 'vibe' ? 'active' : ''}`}
          onClick={() => setMode('vibe')}
        >
          VIBE
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'canvas'}
          className={`seg-btn ${mode === 'canvas' ? 'active' : ''}`}
          onClick={() => setMode('canvas')}
        >
          CANVAS
        </button>
      </div>

      <div className="studio-hud-right stealth-glass" role="toolbar" aria-label="Canvas controls">
        <Button
          icon={<FilePlus2 size={14} />}
          tooltip="New"
          description="Reset canvas"
          size="xs"
          onClick={handleNewFlow}
        />
        <Button
          icon={<Undo2 size={14} />}
          tooltip="Back"
          description="Undo (⌘Z)"
          size="xs"
          disabled={past.length === 0}
          onClick={handleUndo}
        />
        <Button
          icon={<Redo2 size={14} />}
          tooltip="Forth"
          description="Redo (⇧⌘Z)"
          size="xs"
          disabled={future.length === 0}
          onClick={handleRedo}
        />
        <Button
          icon={savingDraft ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
          tooltip="Save"
          description="Save draft (⌘S)"
          size="xs"
          disabled={savingDraft}
          onClick={() => void handleSaveDraft()}
        />
        <Button
          icon={testing ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
          tooltip="Test run"
          description="Run draft inline"
          variant="primary"
          size="xs"
          active={rightPanel === 'test' && overviewOpen && !selectedNode}
          onClick={openTestRunPanel}
        />
        {mode === 'canvas' ? (
          <Button
            icon={<PanelRight size={14} />}
            tooltip={showRightDrawer ? 'Hide panel' : 'Workflow overview'}
            size="xs"
            active={showRightDrawer}
            onClick={() => {
              if (selectedNode) {
                setSelectedId(null);
                setOverviewOpen(false);
              } else {
                setRightPanel('overview');
                setOverviewOpen((v) => !v);
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );

  const wipSquaresNode = useMemo(() => {
    const visible = wipDrafts.filter((item) => hasWipContent(item));
    if (visible.length === 0) return null;
    return (
      <div className="wip-strip">
        <span className="wip-strip-label">Unsaved drafts</span>
        <div className="wip-grid">
          {visible.map((wip) => {
            const trimmedName = wip.name.trim();
            const isDefaultUnknown = /^unknown(?:\s*#\d+)?$/i.test(trimmedName);
            const displayTitle =
              (!isDefaultUnknown && trimmedName) ||
              wip.brief?.trim() ||
              wip.nodes.map((n) => n.data.label).join(' → ') ||
              trimmedName ||
              'Untitled draft';
            const ageLabel = formatWipRelativeAge(wip.modified);
            return (
              <article key={wip.id} className="wip-square stealth-glass">
                <div className="wip-square-top">
                  <div className="wip-square-dots" aria-hidden="true">
                    {wip.nodes.length > 0 ? (
                      wip.nodes.slice(0, 6).map((n) => (
                        <span key={n.id} className={`dot-${n.data.kind}`} />
                      ))
                    ) : (
                      <span className="dot-model" />
                    )}
                  </div>
                  <button
                    type="button"
                    className="wip-square-discard"
                    aria-label={`Discard unsaved draft ${displayTitle}`}
                    onClick={() => handleDiscardWipDraft(wip.id)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
                <h3 className="wip-square-title">
                  <button
                    type="button"
                    className="wip-square-select"
                    onClick={() => handleSelectWipDraft(wip)}
                  >
                    {displayTitle}
                  </button>
                </h3>
                <span className="wip-square-meta">
                  {wip.nodes.length} {wip.nodes.length === 1 ? 'step' : 'steps'} · {ageLabel}
                </span>
              </article>
            );
          })}
        </div>
      </div>
    );
  }, [wipDrafts, handleDiscardWipDraft, handleSelectWipDraft]);

  return (
    <div className="studio-container">
      {mode === 'vibe' ? (
        <div className="vibe-wrapper">
          {hudNode}
          <Vibe
            value={vibePrompt}
            onChange={setVibePrompt}
            onGenerate={(prompt) => void handleGenerateFromVibe(prompt)}
            stepCount={flow.nodes.length}
            onSwitchToCanvas={() => setMode('canvas')}
            busy={vibeBusy}
            statusText={vibeStatus}
            streamPreview={vibePreview}
            errorText={vibeError}
            onCancel={handleCancelVibe}
            wipSlot={wipSquaresNode}
          />
        </div>
      ) : (
        <div className="canvas-stage" data-pocket={activeMobilePocket}>
          {catalogOpen ? (
            <Catalog
              entries={entries}
              loading={catalogLoading}
              errors={catalogErrors}
              onRefresh={() => refreshCatalog(true)}
              onAddEntry={handleAddEntry}
              onClose={() => {
                setCatalogOpen(false);
                setPendingInsertion(null);
              }}
              initialTab={catalogTab}
              contextLabel={catalogContextLabel}
            />
          ) : null}

          <div ref={planeRef} className="canvas-plane">
            {hudNode}

            <ReactFlow<Block, Link>
              nodes={nodesForCanvas}
              edges={edgesWithState}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={(instance) => {
                instanceRef.current = instance;
                window.requestAnimationFrame(() => {
                  fitStudioCanvas(0);
                });
              }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                setToolboxOpen(false);
              }}
              onPaneClick={() => {
                setSelectedId(null);
                setToolboxOpen(false);
              }}
              minZoom={0.24}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              deleteKeyCode={['Backspace', 'Delete']}
            />

            {flow.nodes.length === 0 ? (
              <div className="canvas-empty stealth-glass">
                <Tooltip label="Add step" description="Choose Model, Connector, or Agent (⌘N)">
                  <button
                    type="button"
                    className="empty-plus-btn"
                    aria-label="Add first step"
                    onClick={() => openCatalogForInsertion(null, null, 'model')}
                  >
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </Tooltip>
                <div className="canvas-empty-actions" role="group" aria-label="Step categories">
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() => openCatalogForInsertion(null, null, 'model')}
                  >
                    <span className="dot-model" />
                    <span>Model</span>
                  </button>
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() => openCatalogForInsertion(null, null, 'connector')}
                  >
                    <span className="dot-connector" />
                    <span>Connector</span>
                  </button>
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() => openCatalogForInsertion(null, null, 'agent')}
                  >
                    <span className="dot-agent" />
                    <span>Agent</span>
                  </button>
                </div>
                {wipSquaresNode}
              </div>
            ) : null}

            <div ref={dockRef} className="canvas-dock">
              {toolboxOpen ? (
                <div
                  className="toolbox-popover stealth-glass open"
                  role="group"
                  aria-label="Add step"
                >
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() =>
                      openCatalogForInsertion(
                        selectedId ?? (flow.nodes[flow.nodes.length - 1]?.id ?? null),
                        flow.nodes.length > 0 ? 'right' : null,
                        'model',
                      )
                    }
                  >
                    <span className="dot-model" />
                    <span>Model</span>
                  </button>
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() =>
                      openCatalogForInsertion(
                        selectedId ?? (flow.nodes[flow.nodes.length - 1]?.id ?? null),
                        flow.nodes.length > 0 ? 'right' : null,
                        'connector',
                      )
                    }
                  >
                    <span className="dot-connector" />
                    <span>Connector</span>
                  </button>
                  <button
                    type="button"
                    className="tool-pill"
                    onClick={() =>
                      openCatalogForInsertion(
                        selectedId ?? (flow.nodes[flow.nodes.length - 1]?.id ?? null),
                        flow.nodes.length > 0 ? 'right' : null,
                        'agent',
                      )
                    }
                  >
                    <span className="dot-agent" />
                    <span>Agent</span>
                  </button>
                </div>
              ) : null}

              <div className="dock-bar stealth-glass">
                <div className="dock-cluster">
                  <Button
                    icon={<PanelLeft size={14} />}
                    tooltip={catalogOpen ? 'Hide catalog' : 'Catalog (⌘N)'}
                    active={catalogOpen}
                    size="xs"
                    onClick={() => {
                      if (catalogOpen) {
                        setCatalogOpen(false);
                        setPendingInsertion(null);
                      } else {
                        const anchorId =
                          selectedId ??
                          (flow.nodes.length > 0 ? flow.nodes[flow.nodes.length - 1]!.id : null);
                        openCatalogForInsertion(anchorId, anchorId ? 'right' : null, 'model');
                      }
                    }}
                  />
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
                    onClick={() => fitStudioCanvas(200)}
                  />
                  <Button
                    icon={<Plus size={14} />}
                    tooltip="Zoom in"
                    size="xs"
                    onClick={() => void instanceRef.current?.zoomIn({ duration: 150 })}
                  />
                  <Button
                    icon={<LayoutGrid size={13} />}
                    tooltip="Auto-arrange"
                    size="xs"
                    onClick={handleAutoLayout}
                  />
                </div>

                <div className="dock-telemetry">
                  <span>
                    {flow.nodes.length} {flow.nodes.length === 1 ? 'step' : 'steps'}
                  </span>
                </div>

                <Tooltip label="Add step" description="Choose category">
                  <button
                    type="button"
                    className={`plus-trigger ${toolboxOpen ? 'active' : ''}`}
                    onClick={() => setToolboxOpen((v) => !v)}
                    aria-label="Add step"
                    aria-expanded={toolboxOpen}
                  >
                    <Plus size={15} aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>

          {selectedNode ? (
            <Settings
              node={selectedNode}
              entries={entries}
              change={handleUpdateStep}
              remove={handleRemoveStep}
              onClose={() => {
                setSelectedId(null);
                setOverviewOpen(false);
              }}
              onBackToOverview={() => {
                setSelectedId(null);
                setRightPanel('overview');
                setOverviewOpen(true);
              }}
            />
          ) : overviewOpen && rightPanel === 'test' ? (
            <aside
              className="studio-drawer studio-drawer-right stealth-glass"
              aria-label="Test run"
            >
              <div className="drawer-header">
                <div className="drawer-title-inline">
                  <Button
                    icon={<ArrowLeft size={13} />}
                    tooltip="Workflow overview"
                    size="xs"
                    onClick={() => setRightPanel('overview')}
                  />
                  <span className="drawer-kicker">TEST RUN</span>
                </div>
                <div className="drawer-header-actions">
                  <Button
                    icon={<X size={14} />}
                    tooltip="Close"
                    size="xs"
                    onClick={() => setOverviewOpen(false)}
                  />
                </div>
              </div>

              <div className="drawer-body scroll-area">
                <div className="stat-box">
                  <span className="stat-label">Session limit</span>
                  <span className="stat-val accent-gold">
                    {user ? (hasApprovedLimit ? approvedUsd : '$0.00') : 'Sign in required'}
                  </span>
                </div>

                <CoordinatorField
                  mode="runner"
                  value={testCoordinator}
                  entries={entries}
                  disabled={testing}
                  onNotify={onNotify}
                  onChange={(nextCoordinator) => {
                    setTestCoordinator(nextCoordinator);
                    setPausedTestThreadId(null);
                  }}
                />

                <RunComposer
                  compact
                  label="Input"
                  value={testInput}
                  onChange={setTestInput}
                  attachments={testAttachments}
                  onAttachmentsChange={setTestAttachments}
                  placeholder={flow.brief || 'Enter test prompt, attach files, or record voice...'}
                  busy={testing}
                  submitDisabled={flow.nodes.length === 0}
                  submitLabel={dryTest ? 'Dry Run' : 'Run'}
                  busyLabel="Running..."
                  onSubmit={(overrideAttachments) =>
                    void executeTestRun(
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
                  beforeSubmitContent={
                    <>
                      <label className="switch-row">
                        <span>Dry run (no external paid actions)</span>
                        <input
                          type="checkbox"
                          checked={dryTest}
                          disabled={testing}
                          onChange={(event) => setDryTest(event.target.checked)}
                        />
                      </label>
                      {effectiveMissingConnectors.length > 0 && !credentialsModalOpen ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            if (!user) openAuthModal();
                            else setCredentialsModalOpen(true);
                          }}
                        >
                          <Link2 size={13} aria-hidden="true" />
                          <span>
                            Connect required{' '}
                            {effectiveMissingConnectors.length === 1 ? 'account' : 'accounts'}
                          </span>
                        </button>
                      ) : null}
                      {testing ? (
                        <div className="wf-live-sse-strip" role="status" aria-live="polite">
                          <span className="wf-fold-dot" aria-hidden="true" />
                          <span className="wf-live-sse-title">
                            {testLiveTitle || 'Executing steps...'}
                          </span>
                          {testLiveSnippet ? (
                            <span className="wf-live-sse-snippet" aria-live="off">
                              {testLiveSnippet}
                            </span>
                          ) : null}
                          {BigInt(testLiveBillWei || '0') > 0n ? (
                            <span className="wf-live-sse-bill">
                              {formatMicroUsdc(testLiveBillWei)}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {missingInputs.length > 0 && !inputPromptOpen ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setInputPromptOpen(true)}
                        >
                          <span>Provide required input</span>
                        </button>
                      ) : null}
                    </>
                  }
                  errorText={testError}
                />

                {testResult ? (
                  <div className="output-box">
                    <div className="output-header">
                      <span className="field-label">
                        Output · {formatMicroUsdc(testResult.totalChargedWei)}
                      </span>
                      <Button
                        icon={copiedOutput ? <Check size={12} /> : <Copy size={12} />}
                        tooltip={copiedOutput ? 'Copied' : 'Copy output'}
                        size="xs"
                        onClick={() => {
                          const selectedStep = testResult.steps.find((s) => s.id === testActiveTab);
                          void navigator.clipboard.writeText(
                            selectedStep ? selectedStep.output : testResult.output,
                          );
                          setCopiedOutput(true);
                          window.setTimeout(() => setCopiedOutput(false), 1600);
                        }}
                      />
                    </div>
                    {testResult.steps.length > 1 ? (
                      <div className="run-output-tabs" role="tablist" aria-label="Test step outputs">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={testActiveTab === 'final'}
                          className={`chip-btn ${testActiveTab === 'final' ? 'is-active' : ''}`}
                          onClick={() => setTestActiveTab('final')}
                        >
                          Deliverable
                        </button>
                        {testResult.steps.map((step, idx) => (
                          <button
                            key={step.id}
                            type="button"
                            role="tab"
                            aria-selected={testActiveTab === step.id}
                            className={`chip-btn wf-step-tab ${testActiveTab === step.id ? 'is-active' : ''}`}
                            onClick={() => setTestActiveTab(step.id)}
                          >
                            <span>
                              {idx + 1}. {step.label}
                            </span>
                            {BigInt(step.billWei || '0') > 0n ? (
                              <span className="node-price-tag">
                                {formatMicroUsdc(step.billWei)}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <RichOutput
                      output={
                        testResult.steps.find((s) => s.id === testActiveTab)?.output ??
                        testResult.output
                      }
                    />
                  </div>
                ) : null}
              </div>
            </aside>
          ) : overviewOpen ? (
            <aside
              className="studio-drawer studio-drawer-right stealth-glass"
              aria-label="Workflow overview"
            >
              <div className="drawer-header">
                <span className="drawer-kicker">WORKFLOW</span>
                <div className="drawer-header-actions">
                  <Button
                    icon={<X size={14} />}
                    tooltip="Hide panel"
                    size="xs"
                    onClick={() => setOverviewOpen(false)}
                  />
                </div>
              </div>

              <div className="drawer-body scroll-area">
                <div className="field">
                  <span className="field-label">Banner</span>
                  <BannerMediaFrame
                    src={flow.banner}
                    uploading={uploadingBanner}
                    generating={generatingBanner}
                    uploadLabel="Upload banner"
                    changeLabel="Change banner"
                    removeLabel="Clear banner"
                    generateLabel="Generate banner"
                    regenerateLabel="Regenerate banner"
                    generateDescription="Uses Name, Description & Steps"
                    onUploadFile={handleBannerUpload}
                    onGenerate={() => void handleGenerateBanner()}
                    onRemove={
                      flow.banner
                        ? () =>
                          commitFlow((curr) => ({
                            ...curr,
                            banner: null,
                            modified: new Date().toISOString(),
                          }))
                        : undefined
                    }
                  />
                </div>

                <label className="field">
                  <span className="field-label">Name</span>
                  <input
                    type="text"
                    name="workflow-name"
                    className="input"
                    required
                    value={flow.name}
                    onChange={(event) =>
                      setFlow((curr) => ({
                        ...curr,
                        name: event.target.value,
                        modified: new Date().toISOString(),
                      }))
                    }
                    onBlur={() => {
                      if (!flow.name.trim()) {
                        const fallbackName = computeDefaultUnknownName();
                        setFlow((curr) => ({
                          ...curr,
                          name: fallbackName,
                          modified: new Date().toISOString(),
                        }));
                      }
                    }}
                    placeholder="unknown #1"
                  />
                </label>

                <label className="field">
                  <span className="field-label">Description</span>
                  <textarea
                    name="workflow-description"
                    className="textarea"
                    rows={3}
                    value={flow.brief ?? ''}
                    onChange={(event) =>
                      setFlow((curr) => ({
                        ...curr,
                        brief: event.target.value,
                        modified: new Date().toISOString(),
                      }))
                    }
                    placeholder="Optional description..."
                  />
                </label>

                <TaskPicker
                  value={flow.tasks ?? []}
                  onChange={(nextTasks) =>
                    commitFlow((curr) => ({
                      ...curr,
                      tasks: nextTasks,
                      modified: new Date().toISOString(),
                    }))
                  }
                />

                <CoordinatorField
                  value={flow.coordinator ?? null}
                  entries={entries}
                  onNotify={onNotify}
                  onChange={(nextCoordinator) =>
                    commitFlow((curr) => setCoordinator(curr, nextCoordinator))
                  }
                />

                <div className="field">
                  <div className="field-head-row">
                    <span className="field-label">Steps ({flow.nodes.length})</span>
                    <Button
                      icon={<Plus size={13} />}
                      tooltip="Add step (⌘N)"
                      size="xs"
                      onClick={() => {
                        const lastId =
                          flow.nodes.length > 0
                            ? flow.nodes[flow.nodes.length - 1]!.id
                            : null;
                        openCatalogForInsertion(lastId, lastId ? 'right' : null, 'model');
                      }}
                    />
                  </div>

                  {flow.nodes.length === 0 ? (
                    <div className="empty-note">No steps added yet</div>
                  ) : (
                    <ol className="overview-steps-list" role="list">
                      {flow.nodes.map((node, idx) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            className="overview-step-row"
                            data-kind={node.data.kind}
                            onClick={() => setSelectedId(node.id)}
                          >
                            <span className="overview-step-idx">{idx + 1}</span>
                            <span className="overview-step-title">{node.data.label}</span>
                            <span className="node-type" data-kind={node.data.kind}>
                              {node.data.kind.toUpperCase()}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      )}

      <CredentialsModal
        open={credentialsModalOpen && effectiveMissingConnectors.length > 0}
        missing={effectiveMissingConnectors}
        userAddress={subjectAddress}
        onClose={() => {
          setCredentialsModalOpen(false);
          void refreshStudioConnectors();
        }}
        onConnected={(decisions) => {
          const shouldAutoResume = Boolean(pausedTestThreadId || missingConnectors.length > 0);
          const resumeId =
            pausedTestThreadId ?? missingConnectors[0]?.threadId ?? undefined;
          setCredentialsModalOpen(false);
          setMissingConnectors([]);
          void refreshStudioConnectors();
          if (shouldAutoResume) {
            void executeTestRun(undefined, {
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
        initialPrompt={testInput}
        initialAttachments={testAttachments}
        busy={testing}
        onClose={() => setInputPromptOpen(false)}
        onSubmit={({ prompt: nextPrompt, attachments: nextAttachments, skipClarify }) => {
          const resumeId =
            pausedTestThreadId ?? missingInputs[0]?.threadId ?? undefined;
          setTestInput(nextPrompt);
          setTestAttachments(nextAttachments);
          setInputPromptOpen(false);
          setMissingInputs([]);
          void executeTestRun(undefined, {
            prompt: nextPrompt,
            attachments: nextAttachments,
            ...(skipClarify !== undefined ? { skipClarify } : {}),
            ...(resumeId ? { threadId: resumeId } : {}),
          });
        }}
      />
    </div>
  );
}
