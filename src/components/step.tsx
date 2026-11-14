import {
  getBezierPath,
  getSmoothStepPath,
  Handle,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react';
import { Link2, Plus, Trash2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { isMonochromeDarkLogo, resolveEntryLogoUrl } from '../lib/catalog';
import type { Block, Direction, Kind } from '../lib/schema';
import { Tooltip } from './tooltip';

const KIND_BADGE: Record<Kind, string> = {
  model: '● MODEL',
  connector: '■ CONNECTOR',
  agent: '❖ AGENT',
};

const DIRECTION_ORDER: readonly Direction[] = ['up', 'down', 'left', 'right'];

function directionTipLabel(
  dir: Direction,
  layoutMode: 'vertical' | 'serpentine',
  isReversedTail: boolean,
): string {
  if (layoutMode === 'vertical') {
    if (dir === 'down') return 'Add next step';
    if (dir === 'up') return 'Insert step before';
    return 'Add parallel step';
  }
  if (dir === 'right') return 'Add next step';
  if (dir === 'left') return isReversedTail ? 'Add next step' : 'Insert step before';
  return dir === 'up' ? 'Add step above' : 'Add step below';
}

export type StepExecStatus = 'idle' | 'executing' | 'done' | 'paused' | 'failed';

export interface WireEdgeData extends Record<string, unknown> {
  kind?: Kind;
  active?: boolean;
  done?: boolean;
  readOnly?: boolean;
}

export const Wire = memo(function Wire({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const useOrthogonalRouting =
    sourcePosition === Position.Top ||
    sourcePosition === Position.Bottom ||
    targetPosition === Position.Top ||
    targetPosition === Position.Bottom ||
    sourcePosition === Position.Left ||
    targetPosition === Position.Right ||
    targetX < sourceX - 12;

  const [edgePath, labelX, labelY] = useOrthogonalRouting
    ? getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 18,
        offset: 22,
      })
    : getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      });

  const wireData = data as WireEdgeData | undefined;
  const kind: Kind = wireData?.kind ?? 'model';
  const readOnly = Boolean(wireData?.readOnly);
  const stateClass = readOnly
    ? wireData?.active
      ? 'is-flowing'
      : wireData?.done
        ? 'is-done'
        : 'is-idle'
    : '';

  return (
    <>
      <path d={edgePath} className="synapse-bg" />
      <path
        id={id}
        d={edgePath}
        className={`synapse-active ${selected ? 'is-selected' : ''} ${stateClass}`.trim()}
        data-kind={kind}
      />
      {selected && !readOnly ? (
        <foreignObject
          width="100%"
          height="100%"
          requiredExtensions="http://www.w3.org/1999/xhtml"
          className="edge-fo"
        >
          <button
            type="button"
            className="edge-delete"
            ref={(el) => {
              if (!el) return;
              el.style.setProperty('--edge-x', `${Math.round(labelX)}px`);
              el.style.setProperty('--edge-y', `${Math.round(labelY)}px`);
            }}
            onClick={(event) => {
              event.stopPropagation();
              setEdges((edges) => edges.filter((edge) => edge.id !== id));
            }}
            aria-label="Remove connection"
          >
            <X size={11} />
          </button>
        </foreignObject>
      ) : null}
    </>
  );
});

export const NodeCard = memo(function NodeCard({ id, data, selected }: NodeProps<Block>) {
  const { deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [logoFailed, setLogoFailed] = useState(false);
  const subtitle =
    data.entry && data.entry.name !== data.label
      ? data.entry.name
      : data.note || '';
  const readOnly = Boolean(data.readOnly);
  const stepIndex = typeof data.stepIndex === 'number' ? data.stepIndex : null;
  const execStatus = data.execStatus as StepExecStatus | undefined;
  const running = Boolean(data.running) || execStatus === 'executing';
  const priceLabel =
    typeof data.priceLabel === 'string' && data.priceLabel.trim().length > 0
      ? data.priceLabel.trim()
      : null;
  const liveStatus =
    typeof data.liveStatus === 'string' && data.liveStatus.trim().length > 0
      ? data.liveStatus.trim()
      : null;
  const healedLabel =
    typeof data.healedLabel === 'string' && data.healedLabel.trim().length > 0
      ? data.healedLabel.trim()
      : null;
  const connectorAuthState =
    data.connectorAuthState === 'connected' || data.connectorAuthState === 'needs_auth'
      ? data.connectorAuthState
      : undefined;
  const onConnectClick =
    typeof data.onConnectClick === 'function'
      ? (data.onConnectClick as (nodeId: string) => void)
      : undefined;
  const showConnectBtn = Boolean(
    data.kind === 'connector' && connectorAuthState === 'needs_auth' && onConnectClick,
  );
  const onQuickAdd = readOnly
    ? undefined
    : (data.onQuickAdd as ((nodeId: string, dir: Direction) => void) | undefined);
  const activeHandles = Array.isArray(data.activeHandles)
    ? (data.activeHandles as string[])
    : undefined;
  const connectedDirections = Array.isArray(data.connectedDirections)
    ? (data.connectedDirections as Direction[])
    : [];
  const layoutMode: 'vertical' | 'serpentine' =
    data.layoutMode === 'vertical' ? 'vertical' : 'serpentine';
  const isReversedTail = Boolean(
    layoutMode === 'serpentine' &&
      activeHandles?.includes('in-right') &&
      !connectedDirections.includes('left'),
  );
  const availableDirections = DIRECTION_ORDER.filter(
    (dir) => !connectedDirections.includes(dir),
  );
  const activePortsKey = activeHandles ? activeHandles.join(',') : 'default';
  const logoSrc = resolveEntryLogoUrl(data.entry);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, activePortsKey, showConnectBtn, updateNodeInternals]);

  const isPortVisible = (portId: string, defaultVisible: boolean): boolean => {
    if (!activeHandles) return defaultVisible;
    return activeHandles.includes(portId);
  };

  return (
    <div
      className={`wf-node stealth-glass ${readOnly ? 'is-readonly' : ''} ${selected ? 'is-selected' : ''} ${running ? 'is-running' : ''} ${execStatus ? `is-exec-${execStatus}` : ''}`.trim()}
      data-kind={data.kind}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={`port in side-left ${isPortVisible('in', true) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step input"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="in-top"
        className={`port in side-top ${isPortVisible('in-top', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step input top"
      />
      <Handle
        type="target"
        position={Position.Right}
        id="in-right"
        className={`port in side-right ${isPortVisible('in-right', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step input right"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="in-bottom"
        className={`port in side-bottom ${isPortVisible('in-bottom', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step input bottom"
      />

      {onQuickAdd
        ? availableDirections.map((dir) => {
            const label = directionTipLabel(dir, layoutMode, isReversedTail);
            return (
              <Tooltip key={dir} label={label} position={dir === 'up' ? 'top' : 'bottom'}>
                <button
                  type="button"
                  className={`node-add-btn pos-${dir} nodrag nopan`}
                  aria-label={`${label} (${data.label})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuickAdd(id, dir);
                  }}
                >
                  <Plus size={11} aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })
        : null}

      <div className="node-bar">
        <div className="node-bar-left">
          {stepIndex !== null ? <span className="node-step-idx">{stepIndex}</span> : null}
          <span className="node-type" data-kind={data.kind}>
            {KIND_BADGE[data.kind]}
          </span>
        </div>
        <div className="node-bar-right">
          {priceLabel ? <span className="node-price-tag">{priceLabel}</span> : null}
          {execStatus === 'executing' ? (
            <span className="node-exec-tag is-executing">
              <span className="node-exec-dot" aria-hidden="true" />
              <span>EXECUTING</span>
            </span>
          ) : execStatus === 'paused' ? (
            <span className="node-exec-tag is-paused">PAUSED</span>
          ) : execStatus === 'failed' ? (
            <span className="node-exec-tag is-failed">FAILED</span>
          ) : execStatus === 'done' ? (
            <span className="node-exec-tag is-done">DONE</span>
          ) : data.kind === 'connector' && connectorAuthState === 'needs_auth' ? (
            <span className="node-exec-tag is-paused">AUTH</span>
          ) : data.kind === 'connector' && connectorAuthState === 'connected' ? (
            <span className="node-exec-tag is-done">LINKED</span>
          ) : data.entry ? (
            <span className="node-entry-tag">READY</span>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              className="node-delete nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                void deleteElements({ nodes: [{ id }] });
              }}
              aria-label={`Delete ${data.label}`}
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="node-body">
        <div className="node-title-row">
          {logoSrc && !logoFailed ? (
            <img
              src={logoSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className={`node-logo ${isMonochromeDarkLogo(logoSrc) ? 'is-mono-dark' : ''}`}
              onError={() => setLogoFailed(true)}
            />
          ) : null}
          <div className="node-title">{data.label}</div>
        </div>
        {running && liveStatus ? (
          <div className="node-sub is-live">{liveStatus}</div>
        ) : subtitle ? (
          <div className="node-sub">{subtitle}</div>
        ) : null}
        {healedLabel ? (
          <div className="wf-heal-badge is-node" title={healedLabel}>
            <span>{healedLabel}</span>
          </div>
        ) : null}
        {showConnectBtn ? (
          <button
            type="button"
            className="node-connect-btn nodrag nopan"
            aria-label={`Connect ${data.entry?.name || data.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onConnectClick?.(id);
            }}
          >
            <Link2 size={11} aria-hidden="true" />
            <span>Connect</span>
          </button>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className={`port out side-right ${isPortVisible('out', true) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step output"
      />
      <Handle
        type="source"
        position={Position.Top}
        id="out-top"
        className={`port out side-top ${isPortVisible('out-top', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step output top"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="out-left"
        className={`port out side-left ${isPortVisible('out-left', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step output left"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="out-bottom"
        className={`port out side-bottom ${isPortVisible('out-bottom', false) ? 'is-active-port' : 'is-aux-idle'}`}
        aria-label="Step output bottom"
      />
    </div>
  );
});

export const nodeTypes = {
  step: NodeCard,
};

export const edgeTypes = {
  wire: Wire,
};
