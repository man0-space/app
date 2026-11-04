import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectConnectedDirectionsByNodeId,
  computeAdaptiveWorkflowLayout,
  computeSafeCanvasViewport,
  connect,
  create,
  getAdaptiveFitViewOptions,
  insert,
  insertDirectionalStep,
  nextUnknownWorkflowName,
  parse,
  remove,
} from '../src/lib/graph.ts';

function network() {
  let flow = insert(insert(insert(create(), 'model'), 'connector'), 'agent');
  flow = connect(flow, flow.nodes[0].id, flow.nodes[1].id);
  return connect(flow, flow.nodes[1].id, flow.nodes[2].id);
}

test('creates editable drafts with progressive unknown names and distinct step identities', () => {
  assert.equal(nextUnknownWorkflowName([]), 'unknown #1');
  assert.equal(nextUnknownWorkflowName(['unknown #1', 'Research']), 'unknown #2');
  assert.equal(nextUnknownWorkflowName(['unknown #1', 'unknown #4']), 'unknown #5');
  const flow = network();
  assert.equal(flow.name, 'unknown #1');
  assert.equal(new Set(flow.nodes.map((n) => n.id)).size, 3);
  assert.equal(flow.edges.length, 2);
});

test('splices directional steps (right, left, up, down) without overwriting workflow name', () => {
  let flow = create('unknown #3');
  const m1 = insertDirectionalStep(flow, {
    id: 'deepseek-v3',
    name: 'DeepSeek V3',
    description: 'Reasoning model',
    kind: 'model',
  });
  flow = m1.flow;
  assert.equal(flow.name, 'unknown #3');
  assert.equal(flow.nodes.length, 1);

  const m2 = insertDirectionalStep(
    flow,
    { id: 'writer-agent', name: 'Writer Agent', description: 'Agent', kind: 'agent' },
    m1.nodeId,
    'right',
  );
  flow = m2.flow;
  assert.equal(flow.edges.length, 1);
  assert.equal(flow.edges[0].source, m1.nodeId);
  assert.equal(flow.edges[0].target, m2.nodeId);

  const c0 = insertDirectionalStep(
    flow,
    { id: 'near-intents', name: 'NEAR Intents', description: 'Connector', kind: 'connector' },
    m1.nodeId,
    'left',
  );
  flow = c0.flow;
  assert.ok(flow.edges.some((e) => e.source === c0.nodeId && e.target === m1.nodeId));

  const parallel = insertDirectionalStep(
    flow,
    { id: 'qwen', name: 'Qwen', description: 'Parallel model', kind: 'model' },
    m1.nodeId,
    'down',
  );
  flow = parallel.flow;
  assert.ok(flow.edges.some((e) => e.source === c0.nodeId && e.target === parallel.nodeId));
  assert.equal(flow.name, 'unknown #3');
});

test('places a catalog step clear of steps that were moved off the grid', () => {
  const flow = network();
  flow.nodes[0].position = { x: 0, y: 175 };
  flow.nodes[1].position = { x: 500, y: 0 };
  flow.nodes[2].position = { x: 500, y: 350 };
  const next = insert(flow, 'agent');
  const added = next.nodes.at(-1)!;
  for (const node of flow.nodes) {
    assert.ok(
      Math.abs(added.position.x - node.position.x) >= 360 ||
      Math.abs(added.position.y - node.position.y) >= 220,
    );
  }
  assert.deepEqual(flow.nodes[0].position, { x: 0, y: 175 });
});

test('rejects cycles, self-links, duplicate links and missing endpoints', () => {
  const flow = network();
  assert.throws(() => connect(flow, flow.nodes[2].id, flow.nodes[0].id), /cycle/i);
  assert.throws(() => connect(flow, flow.nodes[0].id, flow.nodes[0].id), /itself/i);
  assert.throws(() => connect(flow, flow.nodes[0].id, flow.nodes[1].id), /already/i);
  assert.throws(() => connect(flow, flow.nodes[0].id, 'missing'), /exist/i);
});

test('removes incident connections when a step is deleted', () => {
  const flow = network();
  const next = remove(flow, flow.nodes[1].id);
  assert.equal(next.nodes.length, 2);
  assert.equal(next.edges.length, 0);
  assert.equal(flow.nodes.length, 3);
});

test('restores the authored graph without inventing configuration', () => {
  const flow = network();
  assert.deepEqual(parse(JSON.stringify(flow)), flow);
  assert.equal(parse(JSON.stringify(flow)).nodes[0].data.entry, undefined);
});

test('preserves the brief and task categories with its graph', () => {
  const flow = {
    ...network(),
    brief: 'Research an input topic, then produce a report.',
    tasks: ['DeFi Execution', 'Security Audit'],
  };
  assert.deepEqual(parse(JSON.stringify(flow)), flow);
  const { brief, tasks, ...earlier } = flow;
  assert.equal(parse(JSON.stringify(earlier)).brief, undefined);
  assert.equal(parse(JSON.stringify(earlier)).tasks, undefined);
  assert.throws(() => parse(JSON.stringify({ ...flow, brief: 42 })), /brief/i);
  assert.throws(() => parse(JSON.stringify({ ...flow, tasks: [123] })), /categories/i);
});

test('rejects corrupt saved drafts and malformed graphs', () => {
  assert.throws(() => parse('{'), /saved|json/i);
  assert.throws(() => parse(JSON.stringify({ ...network(), nodes: null })), /saved|invalid/i);
  const flow = network();
  assert.throws(
    () =>
      parse(
        JSON.stringify({
          ...flow,
          edges: [{ id: 'bad', source: 'missing', target: flow.nodes[0].id }],
        }),
      ),
    /saved|invalid/i,
  );
});

test('caps fitView maxZoom <= 1.0 on desktop and <= 0.92 on mobile so 1-2 nodes are never gigantic', () => {
  const desktopFit = getAdaptiveFitViewOptions({ width: 1280, height: 720 });
  const mobileFit = getAdaptiveFitViewOptions({ width: 390, height: 760 });
  assert.ok(desktopFit.maxZoom <= 1.0);
  assert.ok(mobileFit.maxZoom <= 0.92);
});

test('self-adjusts 9-step linear workflows into boustrophedon serpentine on landscape and vertical TB on mobile', () => {
  let flow = create('Pipeline');
  for (let i = 0; i < 9; i++) {
    flow = insert(flow, 'model');
  }
  for (let i = 0; i < 8; i++) {
    flow = connect(flow, flow.nodes[i].id, flow.nodes[i + 1].id);
  }

  const landscape = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, {
    width: 1280,
    height: 720,
  });
  assert.equal(landscape.mode, 'serpentine');
  assert.ok(landscape.columnsPerBand >= 2 && landscape.columnsPerBand < 9);
  // Row 0 progresses left-to-right; row 1 reverses right-to-left under the last node of row 0
  const posById = new Map(landscape.nodes.map((n) => [n.id, n.position]));
  const ySet = Array.from(new Set(landscape.nodes.map((n) => n.position.y))).sort((a, b) => a - b);
  assert.ok(ySet.length >= 2);
  const row0Nodes = flow.nodes.filter((n) => posById.get(n.id)!.y === ySet[0]);
  const row1Nodes = flow.nodes.filter((n) => posById.get(n.id)!.y === ySet[1]);
  assert.ok(row0Nodes.length >= 2 && row1Nodes.length >= 2);
  assert.ok(posById.get(row0Nodes[0].id)!.x < posById.get(row0Nodes.at(-1)!.id)!.x);
  assert.ok(posById.get(row1Nodes[0].id)!.x > posById.get(row1Nodes.at(-1)!.id)!.x);
  // Row-wrap edge routes out-bottom -> in-top, and reversed row routes out-left -> in-right
  const wrapEdge = landscape.edges.find(
    (e) => e.source === row0Nodes.at(-1)!.id && e.target === row1Nodes[0].id,
  );
  assert.equal(wrapEdge?.sourceHandle, 'out-bottom');
  assert.equal(wrapEdge?.targetHandle, 'in-top');
  const reverseEdge = landscape.edges.find(
    (e) => e.source === row1Nodes[0].id && e.target === row1Nodes[1].id,
  );
  assert.equal(reverseEdge?.sourceHandle, 'out-left');
  assert.equal(reverseEdge?.targetHandle, 'in-right');

  const mobile = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, {
    width: 390,
    height: 760,
  });
  assert.equal(mobile.mode, 'vertical');
  for (let i = 0; i < 8; i++) {
    const cur = mobile.nodes.find((n) => n.id === flow.nodes[i].id)!;
    const nxt = mobile.nodes.find((n) => n.id === flow.nodes[i + 1].id)!;
    assert.ok(cur.position.y < nxt.position.y);
  }
});

test('identifies connected card sides accurately so quick-add "+" buttons never overlap live edges', () => {
  const single = insert(create('Lone'), 'model');
  const singleDirs = collectConnectedDirectionsByNodeId(single.nodes, single.edges);
  assert.deepEqual(singleDirs.get(single.nodes[0].id), []);

  let chain = create('Chain');
  for (let i = 0; i < 6; i++) chain = insert(chain, 'model');
  for (let i = 0; i < 5; i++) chain = connect(chain, chain.nodes[i].id, chain.nodes[i + 1].id);

  // Mobile vertical layout: middle nodes connect on up + down; top node only down; bottom node only up
  const mobile = computeAdaptiveWorkflowLayout(chain.nodes, chain.edges, {
    width: 390,
    height: 780,
  });
  const mobileDirs = collectConnectedDirectionsByNodeId(mobile.nodes, mobile.edges);
  assert.deepEqual(mobileDirs.get(chain.nodes[0].id), ['down']);
  assert.deepEqual(mobileDirs.get(chain.nodes[1].id), ['up', 'down']);
  assert.deepEqual(mobileDirs.get(chain.nodes[5].id), ['up']);

  // Desktop serpentine layout (narrow enough to wrap): wrap source uses down, wrap target uses up + left
  const serp = computeAdaptiveWorkflowLayout(chain.nodes, chain.edges, {
    width: 960,
    height: 720,
  });
  const serpDirs = collectConnectedDirectionsByNodeId(serp.nodes, serp.edges);
  assert.ok(serpDirs.get(chain.nodes[0].id)?.includes('right'));
  assert.ok(!serpDirs.get(chain.nodes[0].id)?.includes('left'));
});

test('supports vertical orientation directional insertion (down appends, up prepends, right branches)', () => {
  let flow = create('Mobile Vertical');
  const s1 = insertDirectionalStep(
    flow,
    { id: 'm1', name: 'Step 1', description: 'First', kind: 'model' },
    null,
    null,
    { layoutMode: 'vertical' },
  );
  flow = s1.flow;

  const s2 = insertDirectionalStep(
    flow,
    { id: 'm2', name: 'Step 2', description: 'Second', kind: 'agent' },
    s1.nodeId,
    'down',
    { layoutMode: 'vertical' },
  );
  flow = s2.flow;
  assert.ok(flow.edges.some((e) => e.source === s1.nodeId && e.target === s2.nodeId));

  const s0 = insertDirectionalStep(
    flow,
    { id: 'm0', name: 'Step 0', description: 'Zero', kind: 'connector' },
    s1.nodeId,
    'up',
    { layoutMode: 'vertical' },
  );
  flow = s0.flow;
  assert.ok(flow.edges.some((e) => e.source === s0.nodeId && e.target === s1.nodeId));

  const branch = insertDirectionalStep(
    flow,
    { id: 'm1b', name: 'Step 1B', description: 'Parallel', kind: 'model' },
    s1.nodeId,
    'right',
    { layoutMode: 'vertical' },
  );
  flow = branch.flow;
  assert.ok(flow.edges.some((e) => e.source === s0.nodeId && e.target === branch.nodeId));
});

test('frames workflow nodes strictly inside the unobstructed band above the promptbox on desktop and mobile', () => {
  let flow = create('Promptbox Safe');
  for (let i = 0; i < 6; i++) flow = insert(flow, 'model');
  for (let i = 0; i < 5; i++) flow = connect(flow, flow.nodes[i].id, flow.nodes[i + 1].id);

  // Desktop with tall promptbox (bottomReserve = 270px, topReserve = 68px on 820px height)
  const deskBox = { width: 1280, height: 820, topReserve: 68, bottomReserve: 270 };
  const deskLayout = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, deskBox);
  const deskVp = computeSafeCanvasViewport(deskLayout.nodes, deskBox);
  for (const node of deskLayout.nodes) {
    const screenTop = node.position.y * deskVp.zoom + deskVp.y;
    const screenBottom = (node.position.y + 88) * deskVp.zoom + deskVp.y;
    assert.ok(screenTop >= deskBox.topReserve - 1, `desktop top ${screenTop} < ${deskBox.topReserve}`);
    assert.ok(
      screenBottom <= deskBox.height - deskBox.bottomReserve + 1,
      `desktop bottom ${screenBottom} > ${deskBox.height - deskBox.bottomReserve}`,
    );
  }

  // Mobile with floating promptbox (bottomReserve = 240px, topReserve = 62px on 667px height)
  const mobBox = { width: 375, height: 667, topReserve: 62, bottomReserve: 240 };
  const mobLayout = computeAdaptiveWorkflowLayout(flow.nodes, flow.edges, mobBox);
  const mobVp = computeSafeCanvasViewport(mobLayout.nodes, mobBox);
  for (const node of mobLayout.nodes) {
    const screenTop = node.position.y * mobVp.zoom + mobVp.y;
    const screenBottom = (node.position.y + 88) * mobVp.zoom + mobVp.y;
    assert.ok(screenTop >= mobBox.topReserve - 1, `mobile top ${screenTop} < ${mobBox.topReserve}`);
    assert.ok(
      screenBottom <= mobBox.height - mobBox.bottomReserve + 1,
      `mobile bottom ${screenBottom} > ${mobBox.height - mobBox.bottomReserve}`,
    );
  }
});
