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

}
