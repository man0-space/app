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
