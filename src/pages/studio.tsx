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

  const [vibeBusy, setVibeBusy] = useState(false);
  const [vibeStatus, setVibeStatus] = useState<string | null>(null);
  const [vibePreview, setVibePreview] = useState('');
  const [vibeError, setVibeError] = useState<string | null>(null);
  const [vibeHistory, setVibeHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const vibeAbortRef = useRef<AbortController | null>(null);

  const [testInput, setTestInput] = useState('');
  const [testAttachments, setTestAttachments] = useState<WorkflowAttachment[]>([]);
  const [testCoordinator, setTestCoordinator] = useState<Coordinator | null>(
    flow.coordinator ?? null,
  );
  const [pausedTestThreadId, setPausedTestThreadId] = useState<string | null>(null);
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
  const instanceRef = useRef<ReactFlowInstance<Block, Link> | null>(null);
  const hydratedForUserRef = useRef<string | null>(null);
  const lastSyncedDraftJsonRef = useRef<string | null>(null);

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
      return;
    }
    if (openedFromWorkspaceId && openedFromWorkspaceId === flow.id) {
      hydratedForUserRef.current = userAddr;
      return;
    }
    if (hydratedForUserRef.current === userAddr) {
      return;
    }

    let cancelled = false;
    void api
      .current()
      .then((wip) => {
        if (cancelled) return;
        hydratedForUserRef.current = userAddr;
        if (wip) {
          lastSyncedDraftJsonRef.current = JSON.stringify(wip);
          setFlow((curr) => (hasWipContent(curr) ? curr : wip));
        } else {
          lastSyncedDraftJsonRef.current = null;
          const nextDefault = computeDefaultUnknownName();
          setFlow((curr) =>
            hasWipContent(curr) || curr.name === nextDefault
              ? curr
              : { ...curr, name: nextDefault },
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          hydratedForUserRef.current = userAddr;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    user?.consented,
    user?.userAddress,
    openedFromWorkspaceId,
    flow.id,
    computeDefaultUnknownName,
    setFlow,
  ]);

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
      if (lastSyncedDraftJsonRef.current !== null) {
        lastSyncedDraftJsonRef.current = null;
        void api.clearDraft().catch(() => undefined);
      }
      return;
    }

    const serialized = JSON.stringify(flow);
    if (serialized === lastSyncedDraftJsonRef.current) return;

    const timer = window.setTimeout(() => {
      void api
        .draft(flow)
        .then(() => {
          lastSyncedDraftJsonRef.current = serialized;
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
    if (authenticated()) {
      void api.clearDraft().catch(() => undefined);
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
  }, [onClearOpenedFromWorkspace, computeDefaultUnknownName, setFlow, onNotify]);

  const handleSaveDraft = useCallback(async () => {
    if (savingDraft) return;
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setSavingDraft(true);
    try {
      const cleanName = flow.name.trim() || computeDefaultUnknownName();
      const saved = await saveDraftItem({ ...flow, name: cleanName }, cleanName);
      lastSyncedDraftJsonRef.current = null;
      onClearOpenedFromWorkspace?.();
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
      onNotify(err instanceof Error ? err.message : 'Could not save draft');
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
      const logos = buildBannerBrandLogos(flow.nodes);

      const generated = await api.generateBanner({
        title: flow.name.trim() || 'man0 Workflow',
        description:
          flow.brief?.trim() ||
          flow.nodes.map((n) => n.data.label).join(', ') ||
          'Autonomous multi-step AI and Web3 workflow.',
        ...(logos.length > 0 ? { logos } : {}),
      });
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
    }
  }, [user, openAuthModal, flow.name, flow.brief, flow.nodes, commitFlow, onNotify]);

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
        setPausedTestThreadId(null);
        setTestResult(null);
        setTestLiveTitle(null);
        setTestLiveSnippet('');
        setTestLiveBillWei('0');
        setTestActiveTab('final');
      }
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
                if (evt.missing[0]?.threadId) {
                  setPausedTestThreadId(evt.missing[0].threadId);
                }
                setCredentialsModalOpen(true);
              } else if (evt.type === 'input:pause') {
                setMissingInputs(evt.missingInputs);
                if (evt.missingInputs[0]?.threadId) {
                  setPausedTestThreadId(evt.missingInputs[0].threadId);
                }
                setInputPromptOpen(true);
              }
            },
          },
        );
        setTestResult(result);
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
          if (err.missing[0]?.threadId) {
            setPausedTestThreadId(err.missing[0].threadId);
          }
          setCredentialsModalOpen(true);
          setTestError(err.message);
        } else if (
          err instanceof Fault &&
          err.code === 'INPUT_REQUIRED' &&
          err.missingInputs?.length
        ) {
          setMissingInputs(err.missingInputs);
          if (err.missingInputs[0]?.threadId) {
            setPausedTestThreadId(err.missingInputs[0].threadId);
          }
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
          !(openedFromWorkspaceId && openedFromWorkspaceId === targetFlow.id) &&
          hasWipContent(targetFlow)
        ) {
          const serialized = JSON.stringify(targetFlow);
          lastSyncedDraftJsonRef.current = serialized;
          void api.draft(targetFlow).catch(() => {
            lastSyncedDraftJsonRef.current = null;
          });
        }
      };

      try {
        const done = await api.streamVibe({
          prompt: cleanPrompt,
          flow,
          history: vibeHistory,
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
              setVibeHistory((prev) => [
                ...prev.slice(-16),
                { role: 'user', content: cleanPrompt },
                ...(evt.text ? [{ role: 'assistant' as const, content: evt.text }] : []),
              ]);
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
            setVibeHistory((prev) => [
              ...prev.slice(-16),
              { role: 'user', content: cleanPrompt },
              ...(done.text ? [{ role: 'assistant' as const, content: done.text }] : []),
            ]);
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
      }
    },
    [
      vibeBusy,
      user,
      openAuthModal,
      flow,
      vibeHistory,
      openedFromWorkspaceId,
      setFlow,
      setMode,
      planeSize.width,
      planeSize.height,
      fitStudioCanvas,
    ],
  );

}
