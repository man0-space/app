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
