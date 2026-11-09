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
