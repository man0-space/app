import assert from 'node:assert/strict';
import test from 'node:test';
import type { InferenceAnalytics } from '@compose-market/sdk';
import {
  emptyAnalyticsResponse,
  formatModelTypeLabel,
  isNear,
  mergeAnalytics,
  resolveAnalytics,
  refreshSse,
  summarize,
  tickTime,
  zeroFillTimeline,
} from '../src/lib/analytics';
import {
  enrichEarnEvent,
  mergeWorkflowSummary,
} from '../src/components/dashboard/royalties/utils';
import { toggleNetworkSelection } from '../src/components/dashboard/usage/networks';

function sampleTotals(overrides?: {
  total?: number;
  succeeded?: number;
  failed?: number;
  streamed?: number;
  inferenceAtomic?: string;
  feeAtomic?: string;
  finalAtomic?: string;
  promptTokens?: number;
  completionTokens?: number;
  avgLatency?: number;
  p95Latency?: number;
}): InferenceAnalytics.InferenceAnalyticsTotals {
  const total = overrides?.total ?? 2;
  const succeeded = overrides?.succeeded ?? total;
  const failed = overrides?.failed ?? 0;
  const streamed = overrides?.streamed ?? 1;
  const promptTokens = overrides?.promptTokens ?? 500;
  const completionTokens = overrides?.completionTokens ?? 250;
  return {
    requests: { total, succeeded, failed, aborted: 0, streamed },
    usage: {
      metrics: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      units: [
        { key: 'prompt_tokens', unit: 'token', quantity: promptTokens },
        { key: 'completion_tokens', unit: 'token', quantity: completionTokens },
      ],
    },
    billing: {
      inferenceAmountAtomic: overrides?.inferenceAtomic ?? '1400000',
      platformFeeAtomic: overrides?.feeAtomic ?? '100000',
      finalAmountAtomic: overrides?.finalAtomic ?? '1500000',
      currency: 'USDC',
      decimals: 6,
    },
    latency: {
      count: total,
      averageMs: overrides?.avgLatency ?? 400,
      p50Ms: 380,
      p95Ms: overrides?.p95Latency ?? 600,
      p99Ms: 720,
    },
  };
}

test('mergeAnalytics aggregates multi-subject totals, deduplicates rows, and merges breakdowns', () => {
  const filters: InferenceAnalytics.InferenceAnalyticsFilters = {
    from: '2026-11-10T00:00:00.000Z',
    to: '2026-11-12T00:00:00.000Z',
    interval: 'day',
  };

  const first = emptyAnalyticsResponse(filters);
  first.totals = sampleTotals({
    total: 2,
    finalAtomic: '1500000',
    inferenceAtomic: '1400000',
    feeAtomic: '100000',
  });
  first.breakdowns.models = [
    {
      key: 'openai/gpt-5',
      label: 'openai',
      types: ['chat'],
      totals: first.totals,
      lastAt: '2026-11-11T10:00:00.000Z',
    },
  ];
  first.timeline = [
    {
      start: '2026-11-10T00:00:00.000Z',
      end: '2026-11-11T00:00:00.000Z',
      totals: first.totals,
    },
  ];

  const second = emptyAnalyticsResponse(filters);
  second.totals = sampleTotals({
    total: 3,
    finalAtomic: '2500000',
    inferenceAtomic: '2300000',
    feeAtomic: '200000',
  });
  second.breakdowns.models = [
    {
      key: 'openai/gpt-5',
      label: 'openai',
      types: ['chat'],
      totals: second.totals,
      lastAt: '2026-11-12T08:00:00.000Z',
    },
  ];
  second.timeline = [
    {
      start: '2026-11-11T00:00:00.000Z',
      end: '2026-11-12T00:00:00.000Z',
      totals: second.totals,
    },
  ];

  const merged = mergeAnalytics([first, second], filters);
  assert.equal(merged.totals.requests.total, 5);
  assert.equal(merged.totals.billing.finalAmountAtomic, '4000000');
  assert.equal(merged.breakdowns.models.length, 1);
  assert.equal(merged.breakdowns.models[0]?.totals.requests.total, 5);
  assert.equal(merged.breakdowns.models[0]?.lastAt, '2026-11-12T08:00:00.000Z');

  const summary = summarize(merged);
  assert.equal(summary.totalUsd, 4);
  assert.equal(summary.inferenceUsd, 3.7);
  assert.equal(summary.platformFeeUsd, 0.3);
  assert.equal(summary.requestCount, 5);
  assert.equal(summary.timeline.length, 3);
});

test('zeroFillTimeline zero-fills missing day buckets across the filter window', () => {
  const filters: InferenceAnalytics.InferenceAnalyticsFilters = {
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-04T00:00:00.000Z',
    interval: 'day',
  };
  const res = emptyAnalyticsResponse(filters);
  res.timeline = [
    {
      start: '2026-11-02T00:00:00.000Z',
      end: '2026-11-03T00:00:00.000Z',
      totals: sampleTotals({ total: 4, finalAtomic: '2000000' }),
    },
  ];
  const filled = zeroFillTimeline(res, 'day');
  assert.equal(filled.length, 4);
  assert.equal(filled[0]?.totals.requests.total, 0);
  assert.equal(filled[1]?.totals.requests.total, 4);
  assert.equal(filled[2]?.totals.requests.total, 0);
  assert.equal(filled[3]?.totals.requests.total, 0);
});

test('toggleNetworkSelection and formatModelTypeLabel produce deterministic UI state', () => {
  const added = toggleNetworkSelection(['near:mainnet'], 'eip155:8453', true);
  assert.deepEqual(added, ['eip155:8453', 'near:mainnet']);
  const removed = toggleNetworkSelection(added, 'near:mainnet', false);
  assert.deepEqual(removed, ['eip155:8453']);

  assert.equal(formatModelTypeLabel('text-to-image, image-to-image'), 'Image');
  assert.equal(formatModelTypeLabel('chat'), 'Chat');
});

test('mergeAnalytics preserves P95/P99 latency when empty subjects omit percentile fields and falls back to request samples', () => {
  const filters: InferenceAnalytics.InferenceAnalyticsFilters = {
    from: '2026-11-10T00:00:00.000Z',
    to: '2026-11-11T00:00:00.000Z',
    interval: 'hour',
  };

  const active = emptyAnalyticsResponse(filters);
  active.totals = sampleTotals({ total: 4, avgLatency: 167, p95Latency: 490 });

  const emptySubject = emptyAnalyticsResponse(filters);
  // Simulate SDK omitting p50Ms/p95Ms/p99Ms on a 0-request subject
  emptySubject.totals.latency = {
    count: 0,
    averageMs: 0,
    p50Ms: undefined as unknown as number,
    p95Ms: undefined as unknown as number,
    p99Ms: undefined as unknown as number,
  };

  const merged = mergeAnalytics([active, emptySubject], filters);
  assert.equal(Number.isFinite(merged.totals.latency.p95Ms), true);
  assert.equal(merged.totals.latency.p95Ms, 490);
  const summary = summarize(merged);
  assert.equal(summary.avgLatencyMs, 167);
  assert.equal(summary.p95LatencyMs, 490);

  // Also test fallback computation from request rows when totals.latency.p95Ms is 0
  const zeroPercentileRes = emptyAnalyticsResponse(filters);
  zeroPercentileRes.totals = sampleTotals({ total: 3, avgLatency: 200, p95Latency: 0 });
  zeroPercentileRes.requests.data = [
    {
      id: 'r1',
      responseId: 'resp-1',
      network: 'near:mainnet',
      model: 'nvidia/nemotron',
      family: 'nvidia',
      types: ['text'],
      operation: 'chat',
      status: 'succeeded',
      streamed: true,
      latencyMs: 120,
      startedAt: '2026-11-10T01:00:00.000Z',
      completedAt: '2026-11-10T01:00:00.120Z',
      settlementIds: [],
      usage: { metrics: { input_tokens: 10, output_tokens: 20 }, units: [] },
      billing: {
        inferenceAmountAtomic: '100',
        platformFeeAtomic: '10',
        finalAmountAtomic: '110',
        currency: 'USDC',
        decimals: 6,
      },
    },
    {
      id: 'r2',
      responseId: 'resp-2',
      network: 'near:mainnet',
      model: 'nvidia/nemotron',
      family: 'nvidia',
      types: ['text'],
      operation: 'chat',
      status: 'succeeded',
      streamed: true,
      latencyMs: 310,
      startedAt: '2026-11-10T02:00:00.000Z',
      completedAt: '2026-11-10T02:00:00.310Z',
      settlementIds: [],
      usage: { metrics: { input_tokens: 10, output_tokens: 20 }, units: [] },
      billing: {
        inferenceAmountAtomic: '100',
        platformFeeAtomic: '10',
        finalAmountAtomic: '110',
        currency: 'USDC',
        decimals: 6,
      },
    },
  ];
  const fallbackSummary = summarize(zeroPercentileRes);
  assert.equal(fallbackSummary.p95LatencyMs, 310);
});

test('7d hourly timeline produces strictly unique bucketKey timestamps while tickTime repeats HH:mm', () => {
  const filters: InferenceAnalytics.InferenceAnalyticsFilters = {
    from: '2026-11-07T12:00:00.000Z',
    to: '2026-11-14T11:00:00.000Z',
    interval: 'hour',
  };
  const res = emptyAnalyticsResponse(filters);
  const buckets = zeroFillTimeline(res, 'hour');
  assert.equal(buckets.length, 168);

  const uniqueKeys = new Set(buckets.map((b) => String(b.timestamp)));
  const repeatedLabels = new Set(buckets.map((b) => tickTime(b.timestamp, 'hour')));
  assert.equal(uniqueKeys.size, 168);
  assert.equal(repeatedLabels.size, 24);
});

test('earn royalty helpers classify paidRuns strictly when creator royalties > 0', () => {
  const zeroRoyaltyOwnerRun = enrichEarnEvent(
    {
      id: 'ev-owner',
      workflowId: 'wf-1',
      workflowName: 'Owner Test Flow',
      tasks: ['Automation'],
      runnerAddress: '0uv4zk76ahgxd8az198c2dpd52jk8ek7apj5ncp0a1he0nbdrefatg',
      status: 'succeeded',
      network: 'near:mainnet',
      earnedAtomic: '0',
      composeBillAtomic: '45000',
      totalChargedAtomic: '49500',
      durationMs: 2400,
      stepsCount: 2,
      txHash: '5zhdWSXNYxx9f3SaUQ9XUzutCkmX2Xm9ezMTH1RhgkZ3',
      proofCid: null,
      timestamp: '2026-11-14T10:00:00.000Z',
    },
    new Map(),
  );
  assert.equal(zeroRoyaltyOwnerRun.kind, 'free');

  const royaltyBearingRun = enrichEarnEvent(
    {
      id: 'ev-paid',
      workflowId: 'wf-1',
      workflowName: 'Published Flow',
      tasks: ['Automation'],
      runnerAddress: '0uv4zk76ahgxd8az198c2dpd52jk8ek7apj5ncp0a1he0nbdrefatg',
      status: 'succeeded',
      network: 'near:mainnet',
      earnedAtomic: '25000',
      composeBillAtomic: '100000',
      totalChargedAtomic: '135000',
      durationMs: 3100,
      stepsCount: 3,
      txHash: '5zhdWSXNYxx9f3SaUQ9XUzutCkmX2Xm9ezMTH1RhgkZ3',
      proofCid: null,
      timestamp: '2026-11-14T11:00:00.000Z',
    },
    new Map(),
  );
  assert.equal(royaltyBearingRun.kind, 'paid');

  const mergedZeroRoyalty = mergeWorkflowSummary(
    {
      workflowId: 'wf-1',
      name: 'Owner Test Flow',
      banner: null,
      tasks: ['Automation'],
      published: null,
      modified: '2026-11-14T10:00:00.000Z',
      creatorFee: 0,
      stepsCount: 2,
      runs: 10,
      paidRuns: 10,
      succeededRuns: 10,
      failedRuns: 0,
      earnedAtomic: '0',
      totalChargedAtomic: '495000',
      avgDurationMs: 2400,
      totalDurationMs: 24000,
      lastRunAt: '2026-11-14T10:00:00.000Z',
    },
    undefined,
  );
  assert.equal(mergedZeroRoyalty?.paidRuns, 0);
});

test('resolveAnalytics keeps deduplicated NEAR Compose subjects and rejects external EVM/SVM EOAs', () => {
  const universalNear = '0uv4zk76ahgxd8az198c2dpd52jk8ek7apj5ncp0a1he0nbdrefatg';
  const implicitNear = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
  const namedNear = 'jabyl.near';
  const evmEoa = '0x89caf60b0e742b9299e14d611b205870207b5ce3';
  const svmEoa = '139ckThCRxYDDFXgfRjH4TCiaTJETbb1UMLwACvWJ1fq';

  assert.equal(isNear(universalNear), true);
  assert.equal(isNear(implicitNear), true);
  assert.equal(isNear(namedNear), true);
  assert.equal(isNear(evmEoa), false);
  assert.equal(isNear(svmEoa), false);

  assert.deepEqual(
    resolveAnalytics({
      userAddress: universalNear,
      spendingAddress: implicitNear,
    }),
    [implicitNear, universalNear],
  );

  assert.deepEqual(
    resolveAnalytics({
      userAddress: universalNear,
      spendingAddress: universalNear,
    }),
    [universalNear],
  );

  assert.deepEqual(
    resolveAnalytics({
      userAddress: universalNear,
      spendingAddress: evmEoa,
    }),
    [universalNear],
  );

  assert.deepEqual(
    resolveAnalytics({
      userAddress: null,
      spendingAddress: implicitNear,
    }),
    [],
  );
});

test('refreshSse skips initial mount ready and lease frames while refreshing on invalidate and reconnect ready', () => {
  const state = { seenInitialReady: false };

  // Initial SSE handshake right after mount snapshot should NOT trigger a duplicate GET
  assert.equal(refreshSse('ready', state), false);
  assert.equal(state.seenInitialReady, true);

  // Lease rotation notification should NOT trigger a refresh before reconnect
  assert.equal(refreshSse('lease', state), false);

  // Live telemetry invalidation MUST trigger a refresh
  assert.equal(refreshSse('invalidate', state), true);

  // Subsequent ready frame after lease rotation or reconnect MUST reconcile
  assert.equal(refreshSse('ready', state), true);
});
