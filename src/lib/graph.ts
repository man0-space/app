import {
  spacing,
  type Block,
  type Coordinator,
  type Direction,
  type Entry,
  type Flow,
  type Kind,
  type Link,
  type Point,
  type Step,
} from './schema.ts';

export function nextUnknownWorkflowName(existingNames: Iterable<string>): string {
  let unknownCount = 0;
  let maxNumber = 0;
  for (const raw of existingNames) {
    const trimmed = (raw || '').trim();
    const match = /^unknown(?:\s*#(\d+))?$/i.exec(trimmed);
    if (match) {
      unknownCount += 1;
      const num = match[1] ? Number.parseInt(match[1], 10) : 0;
      if (Number.isInteger(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
  }
  const nextIndex = Math.max(unknownCount + 1, maxNumber + 1);
  return `unknown #${nextIndex}`;
}

export function place(flow: Flow, point: Point, stepY = spacing.y): Point {
  const next = { ...point };
  const dy = stepY === 0 ? spacing.y : stepY;
  while (
    flow.nodes.some(
      (node) =>
        Math.abs(node.position.x - next.x) < spacing.x &&
        Math.abs(node.position.y - next.y) < spacing.y,
    )
  ) {
    next.y += dy;
  }
  return next;
}

export function create(defaultName = 'unknown #1'): Flow {
  const resolvedName = defaultName.trim() || 'unknown #1';
  return {
    id: crypto.randomUUID(),
    name: resolvedName,
    brief: '',
    banner: null,
    nodes: [],
    edges: [],
    modified: new Date().toISOString(),
  };
}

export function insert(flow: Flow, kind: Kind, entry?: Entry): Flow {
  const index = flow.nodes.length;
  return {
    ...flow,
    nodes: [
      ...flow.nodes,
      {
        id: crypto.randomUUID(),
        type: 'step',
        position: place(flow, {
          x: 80 + (index % 3) * spacing.x,
          y: 120 + Math.floor(index / 3) * spacing.y,
        }),
        data: {
          label: entry?.name ?? kind.charAt(0).toUpperCase() + kind.slice(1),
          kind,
          ...(entry ? { entry } : {}),
          note: '',
        },
      },
    ],
    modified: new Date().toISOString(),
  };
}

function wire(source: string, target: string): Link {
  return {
    id: crypto.randomUUID(),
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'wire',
  };
}

export interface InsertDirectionalOptions {
  layoutMode?: 'vertical' | 'serpentine';
}

export function insertDirectionalStep(
  flow: Flow,
  entry: Entry,
  anchorNodeId?: string | null,
  direction?: Direction | null,
  options?: InsertDirectionalOptions,
): { flow: Flow; nodeId: string } {
  const nodeId = crypto.randomUUID();
  const modified = new Date().toISOString();
  const baseData: Step = {
    label: entry.name,
    kind: entry.kind,
    entry,
    note: '',
  };

  const anchor = anchorNodeId ? flow.nodes.find((n) => n.id === anchorNodeId) : undefined;

  if (!anchor || !direction) {
    const startX =
      flow.nodes.length === 0
        ? 120
        : Math.max(...flow.nodes.map((n) => n.position.x)) + spacing.x;
    const startY = flow.nodes.length === 0 ? 140 : flow.nodes[0]!.position.y;
    const newNode: Block = {
      id: nodeId,
      type: 'step',
      position: place(flow, { x: startX, y: startY }),
      data: baseData,
    };
    return {
      nodeId,
      flow: {
        ...flow,
        nodes: [...flow.nodes, newNode],
        modified,
      },
    };
  }

  const isVertical = options?.layoutMode === 'vertical';
  const resolvedEdges = assignSmartEdgeHandles(flow.nodes, flow.edges);
  const outgoing = flow.edges.filter((e) => e.source === anchor.id);
  const incoming = flow.edges.filter((e) => e.target === anchor.id);
  const isReversedBandTail =
    !isVertical &&
    direction === 'left' &&
    outgoing.length === 0 &&
    resolvedEdges.some((e) => e.target === anchor.id && e.targetHandle === 'in-right');

  const intent: 'append' | 'prepend' | 'parallel' = isVertical
    ? direction === 'down'
      ? 'append'
      : direction === 'up'
        ? 'prepend'
        : 'parallel'
    : isReversedBandTail || direction === 'right'
      ? 'append'
      : direction === 'left'
        ? 'prepend'
        : 'parallel';

  if (intent === 'append') {
    const stepDx = isVertical ? 0 : isReversedBandTail ? -spacing.x : spacing.x;
    const stepDy = isVertical ? spacing.y : 0;
    if (outgoing.length > 0) {
      const shiftedNodes = flow.nodes.map((n) => {
        if (isVertical) {
          return n.position.y > anchor.position.y + 40
            ? { ...n, position: { x: n.position.x, y: n.position.y + spacing.y } }
            : n;
        }
        return n.position.x > anchor.position.x + 40
          ? { ...n, position: { x: n.position.x + spacing.x, y: n.position.y } }
          : n;
      });
      const tempFlow: Flow = { ...flow, nodes: shiftedNodes };
      const newNode: Block = {
        id: nodeId,
        type: 'step',
        position: place(
          tempFlow,
          {
            x: anchor.position.x + stepDx,
            y: anchor.position.y + stepDy,
          },
          isVertical ? spacing.y : spacing.y,
        ),
        data: baseData,
      };
      const keptEdges = flow.edges.filter((e) => e.source !== anchor.id);
      const splicedEdges: Link[] = [
        ...keptEdges,
        wire(anchor.id, nodeId),
        ...outgoing.map((e) => wire(nodeId, e.target)),
      ];
      return {
        nodeId,
        flow: {
          ...flow,
          nodes: [...shiftedNodes, newNode],
          edges: splicedEdges,
          modified,
        },
      };
    }

    const newNode: Block = {
      id: nodeId,
      type: 'step',
      position: place(flow, {
        x: Math.max(40, anchor.position.x + stepDx),
        y: anchor.position.y + stepDy,
      }),
      data: baseData,
    };
    return {
      nodeId,
      flow: {
        ...flow,
        nodes: [...flow.nodes, newNode],
        edges: [...flow.edges, wire(anchor.id, nodeId)],
        modified,
      },
    };
  }

  if (intent === 'prepend') {
    if (incoming.length > 0) {
      const shiftedNodes = flow.nodes.map((n) => {
        if (isVertical) {
          return n.position.y >= anchor.position.y - 20
            ? { ...n, position: { x: n.position.x, y: n.position.y + spacing.y } }
            : n;
        }
        return n.position.x >= anchor.position.x - 20
          ? { ...n, position: { x: n.position.x + spacing.x, y: n.position.y } }
          : n;
      });
      const tempFlow: Flow = { ...flow, nodes: shiftedNodes };
      const newNode: Block = {
        id: nodeId,
        type: 'step',
        position: place(tempFlow, {
          x: anchor.position.x,
          y: anchor.position.y,
        }),
        data: baseData,
      };
      const keptEdges = flow.edges.filter((e) => e.target !== anchor.id);
      const splicedEdges: Link[] = [
        ...keptEdges,
        ...incoming.map((e) => wire(e.source, nodeId)),
        wire(nodeId, anchor.id),
      ];
      return {
        nodeId,
        flow: {
          ...flow,
          nodes: [...shiftedNodes, newNode],
          edges: splicedEdges,
          modified,
        },
      };
    }

    if (isVertical) {
      const shouldShiftDown = anchor.position.y < spacing.y;
      const shiftedNodes = shouldShiftDown
        ? flow.nodes.map((n) => ({
            ...n,
            position: { x: n.position.x, y: n.position.y + spacing.y },
          }))
        : flow.nodes;
      const targetY = shouldShiftDown ? anchor.position.y : anchor.position.y - spacing.y;
      const tempFlow: Flow = { ...flow, nodes: shiftedNodes };
      const newNode: Block = {
        id: nodeId,
        type: 'step',
        position: place(tempFlow, { x: anchor.position.x, y: targetY }),
        data: baseData,
      };
      return {
        nodeId,
        flow: {
          ...flow,
          nodes: [...shiftedNodes, newNode],
          edges: [...flow.edges, wire(nodeId, anchor.id)],
          modified,
        },
      };
    }

    const shouldShiftRight = anchor.position.x < spacing.x;
    const shiftedNodes = shouldShiftRight
      ? flow.nodes.map((n) => ({
          ...n,
          position: { x: n.position.x + spacing.x, y: n.position.y },
        }))
      : flow.nodes;
    const targetX = shouldShiftRight ? anchor.position.x : anchor.position.x - spacing.x;
    const tempFlow: Flow = { ...flow, nodes: shiftedNodes };
    const newNode: Block = {
      id: nodeId,
      type: 'step',
      position: place(tempFlow, { x: targetX, y: anchor.position.y }),
      data: baseData,
    };
    return {
      nodeId,
      flow: {
        ...flow,
        nodes: [...shiftedNodes, newNode],
        edges: [...flow.edges, wire(nodeId, anchor.id)],
        modified,
      },
    };
  }

  // Parallel branch: orthogonal to primary axis, inheriting upstream parents
  const deltaX = isVertical ? (direction === 'left' ? -spacing.x : spacing.x) : 0;
  const deltaY = isVertical ? 0 : direction === 'up' ? -spacing.y : spacing.y;
  const newNode: Block = {
    id: nodeId,
    type: 'step',
    position: place(
      flow,
      {
        x: Math.max(40, anchor.position.x + deltaX),
        y: anchor.position.y + deltaY,
      },
      deltaY || spacing.y,
    ),
    data: baseData,
  };
  const upstreamParents = incoming.map((e) => e.source);
  const branchEdges = upstreamParents.map((parentId) => wire(parentId, nodeId));

  return {
    nodeId,
    flow: {
      ...flow,
      nodes: [...flow.nodes, newNode],
      edges: [...flow.edges, ...branchEdges],
      modified,
    },
  };
}

export function connect(flow: Flow, source: string, target: string): Flow {
  if (source === target) throw new Error('A step cannot connect to itself.');
  if (!flow.nodes.some((n) => n.id === source) || !flow.nodes.some((n) => n.id === target)) {
    throw new Error('Both steps must exist.');
  }
  if (flow.edges.some((e) => e.source === source && e.target === target)) {
    throw new Error('These steps are already connected.');
  }
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source) throw new Error('This connection would create a cycle.');
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...flow.edges.filter((e) => e.source === id).map((e) => e.target));
  }
  return {
    ...flow,
    edges: [...flow.edges, wire(source, target)],
    modified: new Date().toISOString(),
  };
}

export function remove(flow: Flow, id: string): Flow {
  return {
    ...flow,
    nodes: flow.nodes.filter((n) => n.id !== id),
    edges: flow.edges.filter((e) => e.source !== id && e.target !== id),
    modified: new Date().toISOString(),
  };
}

export function setCoordinator(flow: Flow, coordinator: Coordinator | null): Flow {
  return {
    ...flow,
    coordinator,
    modified: new Date().toISOString(),
  };
}

export function update(flow: Flow, id: string, patch: Partial<Step>): Flow {
  return {
    ...flow,
    nodes: flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    modified: new Date().toISOString(),
  };
}

export const COMPACT_CANVAS_MAX_WIDTH = 768;

const NODE_CARD_W = 228;
const NODE_CARD_H = 88;
const SERPENTINE_COL_PITCH = 288;
const SERPENTINE_PARALLEL_Y = 124;
const SERPENTINE_BAND_GAP = 76;
const VERTICAL_ROW_PITCH = 144;
const VERTICAL_PARALLEL_X = 264;

export interface CanvasViewportBox {
  width?: number;
  height?: number;
  topReserve?: number;
  bottomReserve?: number;
  horizontalReserve?: number;
}

export interface AdaptiveLayoutResult {
  nodes: Block[];
  edges: Link[];
  mode: 'vertical' | 'serpentine';
  columnsPerBand: number;
}

export function isCompactCanvasViewport(width?: number): boolean {
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    return width <= COMPACT_CANVAS_MAX_WIDTH;
  }
  return typeof window !== 'undefined' ? window.innerWidth <= COMPACT_CANVAS_MAX_WIDTH : false;
}

export function getAdaptiveFitViewOptions(viewport?: CanvasViewportBox): {
  padding:
    | number
    | {
        top: `${number}px`;
        right: `${number}px`;
        bottom: `${number}px`;
        left: `${number}px`;
      };
  maxZoom: number;
  minZoom: number;
} {
  const compact = isCompactCanvasViewport(viewport?.width);
  const maxZoom = compact ? 0.92 : 1;
  const minZoom = 0.24;
  if (viewport?.bottomReserve || viewport?.topReserve) {
    const top = Math.max(48, Math.round(viewport.topReserve ?? (compact ? 64 : 74)));
    const bottom = Math.max(64, Math.round(viewport.bottomReserve ?? (compact ? 196 : 224)));
    const side = Math.max(16, Math.round((viewport.horizontalReserve ?? (compact ? 32 : 72)) / 2));
    return {
      padding: {
        top: `${top}px` as `${number}px`,
        right: `${side}px` as `${number}px`,
        bottom: `${bottom}px` as `${number}px`,
        left: `${side}px` as `${number}px`,
      },
      maxZoom,
      minZoom,
    };
  }
  return {
    padding: compact ? 0.18 : 0.24,
    maxZoom,
    minZoom,
  };
}

export interface SafeCanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export function computeSafeCanvasViewport(
  nodes: readonly Block[],
  viewport?: CanvasViewportBox,
  measuredById?: ReadonlyMap<string, { width: number; height: number }>,
): SafeCanvasViewport {
  const rawW =
    viewport?.width && Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1200;
  const rawH =
    viewport?.height && Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : typeof window !== 'undefined'
        ? window.innerHeight
        : 760;

  const compact = isCompactCanvasViewport(rawW);
  const maxZoom = compact ? 0.92 : 1;
  const minZoom = 0.24;

  const topPad = Math.max(48, Math.round(viewport?.topReserve ?? (compact ? 64 : 74)));
  const bottomPad = Math.max(64, Math.round(viewport?.bottomReserve ?? (compact ? 210 : 236)));
  const sidePad = Math.max(16, Math.round((viewport?.horizontalReserve ?? (compact ? 32 : 72)) / 2));

  const safeX = sidePad;
  const safeY = topPad;
  const safeW = Math.max(96, rawW - sidePad * 2);
  const safeH = Math.max(96, rawH - topPad - bottomPad);

  if (nodes.length === 0) {
    return {
      x: Math.round(safeX),
      y: Math.round(safeY),
      zoom: maxZoom,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const dims = measuredById?.get(node.id);
    const w = dims && dims.width > 0 ? dims.width : NODE_CARD_W;
    const h = dims && dims.height > 0 ? dims.height : NODE_CARD_H;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const innerMarginX = Math.min(compact ? 12 : 22, Math.floor(safeW * 0.1));
  const innerMarginY = Math.min(compact ? 12 : 18, Math.floor(safeH * 0.1));
  const fitW = Math.max(64, safeW - innerMarginX * 2);
  const fitH = Math.max(64, safeH - innerMarginY * 2);

  const boundsW = Math.max(1, maxX - minX);
  const boundsH = Math.max(1, maxY - minY);

  const rawZoom = Math.min(fitW / boundsW, fitH / boundsH);
  const zoom = Math.min(maxZoom, Math.max(minZoom, rawZoom));

  const safeCenterX = safeX + safeW / 2;
  const safeCenterY = safeY + safeH / 2;
  const boundsCenterX = minX + boundsW / 2;
  const boundsCenterY = minY + boundsH / 2;

  const x = Math.round(safeCenterX - boundsCenterX * zoom);
  const y =
    boundsH * zoom > safeH
      ? Math.round(safeY + innerMarginY - minY * zoom)
      : Math.round(safeCenterY - boundsCenterY * zoom);

  return {
    x,
    y,
    zoom: Number(zoom.toFixed(4)),
  };
}

function decomposeOrderedWaves(
  nodes: readonly Block[],
  edges: readonly Link[],
): string[][] {
  if (nodes.length === 0) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const originalOrder = new Map(nodes.map((n, idx) => [n.id, idx]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      continue;
    }
    outgoing.get(edge.source)!.push(edge.target);
    incoming.get(edge.target)!.push(edge.source);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const rank = new Map<string, number>();
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) rank.set(id, 0);

  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited.add(id);
    const currentRank = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, currentRank + 1));
      const nextDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  // Fallback for any residual nodes
  let fallbackRank = rank.size > 0 ? Math.max(...rank.values()) + 1 : 0;
  for (const node of nodes) {
    if (!visited.has(node.id) && !rank.has(node.id)) {
      rank.set(node.id, fallbackRank);
      fallbackRank += 1;
    }
  }

  const waveMap = new Map<number, string[]>();
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0;
    const list = waveMap.get(r) ?? [];
    list.push(node.id);
    waveMap.set(r, list);
  }

  const sortedRanks = Array.from(waveMap.keys()).sort((a, b) => a - b);
  const waves = sortedRanks.map((r) => waveMap.get(r)!);

  // Two-pass barycenter sweep to minimize parallel branch edge crossings
  const slotOf = new Map<string, number>();
  waves.forEach((wave) => {
    wave.sort((a, b) => (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0));
    wave.forEach((id, idx) => slotOf.set(id, idx));
  });

  for (let pass = 0; pass < 2; pass += 1) {
    for (let w = 1; w < waves.length; w += 1) {
      const wave = waves[w]!;
      wave.sort((a, b) => {
        const parentsA = incoming.get(a) ?? [];
        const parentsB = incoming.get(b) ?? [];
        const baryA =
          parentsA.length > 0
            ? parentsA.reduce((acc, p) => acc + (slotOf.get(p) ?? 0), 0) / parentsA.length
            : (slotOf.get(a) ?? 0);
        const baryB =
          parentsB.length > 0
            ? parentsB.reduce((acc, p) => acc + (slotOf.get(p) ?? 0), 0) / parentsB.length
            : (slotOf.get(b) ?? 0);
        if (Math.abs(baryA - baryB) > 0.001) return baryA - baryB;
        return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
      });
      wave.forEach((id, idx) => slotOf.set(id, idx));
    }

    for (let w = waves.length - 2; w >= 0; w -= 1) {
      const wave = waves[w]!;
      wave.sort((a, b) => {
        const childrenA = outgoing.get(a) ?? [];
        const childrenB = outgoing.get(b) ?? [];
        const baryA =
          childrenA.length > 0
            ? childrenA.reduce((acc, c) => acc + (slotOf.get(c) ?? 0), 0) / childrenA.length
            : (slotOf.get(a) ?? 0);
        const baryB =
          childrenB.length > 0
            ? childrenB.reduce((acc, c) => acc + (slotOf.get(c) ?? 0), 0) / childrenB.length
            : (slotOf.get(b) ?? 0);
        if (Math.abs(baryA - baryB) > 0.001) return baryA - baryB;
        return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
      });
      wave.forEach((id, idx) => slotOf.set(id, idx));
    }
  }

  return waves;
}

export function assignSmartEdgeHandles(
  nodes: readonly Block[],
  edges: readonly Link[],
): Link[] {
  if (edges.length === 0) return [];
  const posById = new Map<string, Point>(nodes.map((n) => [n.id, n.position]));

  return edges.map((edge) => {
    const src = posById.get(edge.source);
    const dst = posById.get(edge.target);
    if (!src || !dst) return edge;

    const dx = dst.x - src.x;
    const dy = dst.y - src.y;

    let sourceHandle = 'out';
    let targetHandle = 'in';

    if (dy > NODE_CARD_H * 0.65 && Math.abs(dx) < SERPENTINE_COL_PITCH * 0.62) {
      sourceHandle = 'out-bottom';
      targetHandle = 'in-top';
    } else if (dy < -NODE_CARD_H * 0.65 && Math.abs(dx) < SERPENTINE_COL_PITCH * 0.62) {
      sourceHandle = 'out-top';
      targetHandle = 'in-bottom';
    } else if (dx < -44) {
      sourceHandle = 'out-left';
      targetHandle = 'in-right';
    } else {
      sourceHandle = 'out';
      targetHandle = 'in';
    }

    if (edge.sourceHandle === sourceHandle && edge.targetHandle === targetHandle) {
      return edge;
    }
    return {
      ...edge,
      sourceHandle,
      targetHandle,
    };
  });
}

function handleToDirection(
  handleId: string | null | undefined,
  role: 'source' | 'target',
): Direction {
  switch (handleId) {
    case 'in':
    case 'out-left':
      return 'left';
    case 'out':
    case 'in-right':
      return 'right';
    case 'in-top':
    case 'out-top':
      return 'up';
    case 'in-bottom':
    case 'out-bottom':
      return 'down';
    default:
      return role === 'source' ? 'right' : 'left';
  }
}

export function collectConnectedDirectionsByNodeId(
  nodes: readonly Block[],
  edges: readonly Link[],
): Map<string, Direction[]> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const sets = new Map<string, Set<Direction>>();
  for (const node of nodes) {
    sets.set(node.id, new Set<Direction>());
  }
  const resolved = assignSmartEdgeHandles(nodes, edges);
  for (const edge of resolved) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      continue;
    }
    sets.get(edge.source)?.add(handleToDirection(edge.sourceHandle, 'source'));
    sets.get(edge.target)?.add(handleToDirection(edge.targetHandle, 'target'));
  }
  const order: readonly Direction[] = ['up', 'down', 'left', 'right'];
  const out = new Map<string, Direction[]>();
  for (const [nodeId, set] of sets.entries()) {
    out.set(
      nodeId,
      order.filter((dir) => set.has(dir)),
    );
  }
  return out;
}

export function collectActiveHandlesByNodeId(
  nodes: readonly Block[],
  edges: readonly Link[],
  options?: { includeHorizontalDefaults?: boolean },
): Map<string, string[]> {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const sets = new Map<string, Set<string>>();
  for (const node of nodes) {
    const base = new Set<string>();
    if (options?.includeHorizontalDefaults) {
      base.add('in');
      base.add('out');
    }
    sets.set(node.id, base);
  }
  const resolved = assignSmartEdgeHandles(nodes, edges);
  for (const edge of resolved) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) {
      continue;
    }
    sets.get(edge.source)?.add(edge.sourceHandle || 'out');
    sets.get(edge.target)?.add(edge.targetHandle || 'in');
  }
  const out = new Map<string, string[]>();
  for (const [nodeId, set] of sets.entries()) {
    out.set(nodeId, Array.from(set).sort());
  }
  return out;
}

function buildVerticalPositions(
  waves: readonly string[][],
  usableW: number,
): { positions: Map<string, Point>; width: number; height: number } {
  const positions = new Map<string, Point>();
  const maxPerSubRow = Math.max(1, Math.floor((usableW + 24) / VERTICAL_PARALLEL_X));
  let cursorY = 80;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = cursorY;

  for (const wave of waves) {
    const subRows: string[][] = [];
    for (let i = 0; i < wave.length; i += maxPerSubRow) {
      subRows.push(wave.slice(i, i + maxPerSubRow));
    }
    for (const subRow of subRows) {
      const m = subRow.length;
      subRow.forEach((id, idx) => {
        const x = Math.round(120 + (idx - (m - 1) / 2) * VERTICAL_PARALLEL_X);
        const y = Math.round(cursorY);
        positions.set(id, { x, y });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + NODE_CARD_W);
        maxY = Math.max(maxY, y + NODE_CARD_H);
      });
      cursorY += VERTICAL_ROW_PITCH;
    }
  }

  // Normalize minX to 80 for clean positive coordinates
  if (Number.isFinite(minX) && minX !== 80) {
    const shiftX = 80 - minX;
    for (const [id, pt] of positions.entries()) {
      positions.set(id, { x: pt.x + shiftX, y: pt.y });
    }
    maxX += shiftX;
    minX = 80;
  }

  return {
    positions,
    width: Math.max(NODE_CARD_W, maxX - (Number.isFinite(minX) ? minX : 80)),
    height: Math.max(NODE_CARD_H, maxY - 80),
  };
}

function buildSerpentinePositions(
  waves: readonly string[][],
  columnsPerBand: number,
): { positions: Map<string, Point>; width: number; height: number; bandCount: number } {
  const positions = new Map<string, Point>();
  const cols = Math.max(1, columnsPerBand);
  const bandCount = Math.max(1, Math.ceil(waves.length / cols));
  let bandTopY = 100;
  let maxX = 100 + NODE_CARD_W;
  let maxY = bandTopY + NODE_CARD_H;

  for (let band = 0; band < bandCount; band += 1) {
    const bandWaves = waves.slice(band * cols, (band + 1) * cols);
    const maxParallelInBand = Math.max(1, ...bandWaves.map((w) => w.length));
    const bandSpanH =
      (maxParallelInBand - 1) * SERPENTINE_PARALLEL_Y + NODE_CARD_H;
    const reversed = band % 2 === 1;

    bandWaves.forEach((wave, slot) => {
      const col = reversed ? cols - 1 - slot : slot;
      const x = Math.round(100 + col * SERPENTINE_COL_PITCH);
      const waveSpanH = (wave.length - 1) * SERPENTINE_PARALLEL_Y + NODE_CARD_H;
      const offsetY = Math.round((bandSpanH - waveSpanH) / 2);

      wave.forEach((id, idx) => {
        const y = Math.round(bandTopY + offsetY + idx * SERPENTINE_PARALLEL_Y);
        positions.set(id, { x, y });
        maxX = Math.max(maxX, x + NODE_CARD_W);
        maxY = Math.max(maxY, y + NODE_CARD_H);
      });
    });

    bandTopY += bandSpanH + SERPENTINE_BAND_GAP;
  }

  return {
    positions,
    width: Math.max(NODE_CARD_W, maxX - 100),
    height: Math.max(NODE_CARD_H, maxY - 100),
    bandCount,
  };
}

export function computeAdaptiveWorkflowLayout(
  nodes: readonly Block[],
  edges: readonly Link[],
  viewport?: CanvasViewportBox,
): AdaptiveLayoutResult {
  if (nodes.length === 0) {
    return { nodes: [], edges: [...edges], mode: 'serpentine', columnsPerBand: 1 };
  }

  const rawW =
    viewport?.width && Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1200;
  const rawH =
    viewport?.height && Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : typeof window !== 'undefined'
        ? window.innerHeight
        : 760;

  const compact = isCompactCanvasViewport(rawW);
  const usableW = Math.max(
    240,
    rawW - (viewport?.horizontalReserve ?? (compact ? 40 : 96)),
  );
  const usableH = Math.max(
    220,
    rawH -
      (viewport?.topReserve ?? (compact ? 68 : 80)) -
      (viewport?.bottomReserve ?? (compact ? 190 : 140)),
  );
  const maxZoom = compact ? 0.92 : 1;

  const waves = decomposeOrderedWaves(nodes, edges);

  if (waves.length === 1 && waves[0]!.length === 1) {
    const singleNodes = nodes.map((n) => ({
      ...n,
      position: { x: 100, y: 100 },
    }));
    return {
      nodes: singleNodes,
      edges: assignSmartEdgeHandles(singleNodes, edges),
      mode: compact || usableW < usableH ? 'vertical' : 'serpentine',
      columnsPerBand: 1,
    };
  }

  const isPortraitContainer = compact || usableW / usableH < 0.92;
  const containerAspect = usableW / usableH;

  let bestPositions: Map<string, Point> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMode: 'vertical' | 'serpentine' = isPortraitContainer ? 'vertical' : 'serpentine';
  let bestCols = waves.length;

  // Evaluate Vertical (Top -> Bottom) candidate
  const verticalCandidate = buildVerticalPositions(waves, usableW);
  {
    const scale = Math.min(
      maxZoom,
      usableW / verticalCandidate.width,
      usableH / verticalCandidate.height,
    );
    const graphAspect = verticalCandidate.width / verticalCandidate.height;
    const aspectRatioMatch =
      Math.min(containerAspect, graphAspect) / Math.max(containerAspect, graphAspect);
    const orientationBonus = isPortraitContainer ? 1.18 : 0.86;
    const score = scale * (0.78 + 0.22 * aspectRatioMatch) * orientationBonus;
    bestScore = score;
    bestPositions = verticalCandidate.positions;
    bestMode = 'vertical';
    bestCols = 1;
  }

  // Evaluate Landscape Boustrophedon Serpentine candidates across all column widths C in [2..L]
  if (!compact || usableW > usableH * 1.15) {
    const maxCols = Math.max(2, waves.length);
    for (let cols = 2; cols <= maxCols; cols += 1) {
      const candidate = buildSerpentinePositions(waves, cols);
      const scale = Math.min(
        maxZoom,
        usableW / candidate.width,
        usableH / candidate.height,
      );
      const graphAspect = candidate.width / candidate.height;
      const aspectRatioMatch =
        Math.min(containerAspect, graphAspect) / Math.max(containerAspect, graphAspect);
      const wrapCount = Math.max(0, candidate.bandCount - 1);
      // Mild tie-breaker prefers fewer wraps when zoom scale is already crisp
      const wrapFactor = Math.pow(0.975, wrapCount);
      const orientationBonus = isPortraitContainer ? 0.88 : 1.08;
      const score = scale * (0.8 + 0.2 * aspectRatioMatch) * wrapFactor * orientationBonus;

      if (score > bestScore) {
        bestScore = score;
        bestPositions = candidate.positions;
        bestMode = 'serpentine';
        bestCols = cols;
      }
    }
  }

  const nextNodes = nodes.map((node) => ({
    ...node,
    position: bestPositions?.get(node.id) ?? node.position,
  }));
  const nextEdges = assignSmartEdgeHandles(nextNodes, edges);

  return {
    nodes: nextNodes,
    edges: nextEdges,
    mode: bestMode,
    columnsPerBand: bestCols,
  };
}

export function layout(flow: Flow, viewport?: CanvasViewportBox): Flow {
  if (!flow.nodes.length) return flow;
  const arranged = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, viewport);
  return {
    ...flow,
    nodes: arranged.nodes,
    edges: arranged.edges,
    modified: new Date().toISOString(),
  };
}

export function parse(value: string): Flow {
  let flow: Flow;
  try {
    flow = JSON.parse(value);
  } catch {
    throw new Error('The saved workflow contains invalid JSON.');
  }
  if (
    !flow ||
    typeof flow.id !== 'string' ||
    typeof flow.name !== 'string' ||
    typeof flow.modified !== 'string' ||
    !Array.isArray(flow.nodes) ||
    !Array.isArray(flow.edges)
  ) {
    throw new Error('The saved workflow is invalid.');
  }
  if (flow.brief !== undefined && typeof flow.brief !== 'string') {
    throw new Error('The saved workflow has an invalid brief.');
  }
  if (flow.banner !== undefined && flow.banner !== null && typeof flow.banner !== 'string') {
    throw new Error('The saved workflow has an invalid banner.');
  }
  if (
    flow.tasks !== undefined &&
    (!Array.isArray(flow.tasks) || flow.tasks.some((task) => typeof task !== 'string'))
  ) {
    throw new Error('The saved workflow has invalid categories.');
  }
  const ids = new Set<string>();
  for (const node of flow.nodes) {
    if (
      !node ||
      typeof node.id !== 'string' ||
      ids.has(node.id) ||
      node.type !== 'step' ||
      !node.position ||
      !Number.isFinite(node.position.x) ||
      !Number.isFinite(node.position.y) ||
      !node.data ||
      !['model', 'connector', 'agent'].includes(node.data.kind) ||
      typeof node.data.label !== 'string' ||
      typeof node.data.note !== 'string'
    ) {
      throw new Error('The saved workflow has an invalid step.');
    }
    ids.add(node.id);
  }
  const edges = flow.edges;
  let checked: Flow = { ...flow, edges: [] };
  for (const edge of edges) {
    if (
      !edge ||
      typeof edge.id !== 'string' ||
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string'
    ) {
      throw new Error('The saved workflow has an invalid connection.');
    }
    try {
      checked = connect(checked, edge.source, edge.target);
    } catch {
      throw new Error('The saved workflow has an invalid connection.');
    }
  }
  return flow;
}
