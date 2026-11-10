import type { InferenceAnalytics } from '@compose-market/sdk';
import type { FacilitatorChain, NetworkId } from '@compose-market/sdk/chains';
import { FAMILY_LOGOS } from './catalog';
import { explorerTxUrl, externalWalletExplorerUrl, shortHash } from './contracts';

type Response = InferenceAnalytics.InferenceAnalyticsResponse;
type Totals = InferenceAnalytics.InferenceAnalyticsTotals;
type Breakdown = InferenceAnalytics.InferenceAnalyticsBreakdown;
type RequestStatus = InferenceAnalytics.InferenceRequestStatus;
export type AnalyticsInterval = InferenceAnalytics.InferenceAnalyticsInterval;

export interface ModelUsage {
  subject: string;
  modelId: string;
  family: string;
  totalAmountAtomic: bigint;
  totalUsd: number;
  calls: number;
  totalTokens: number;
  tokensIn: number;
  tokensOut: number;
  p50Ms: number | null;
  p95Ms: number | null;
  successRate: number | null;
  lastUsed: number;
  type: string;
}

export interface TimelineBucket {
  timestamp: number;
  endTimestamp: number;
  totals: Totals;
}

export interface TypeEntry {
  key: string;
  usd: number;
  calls: number;
  tokens: number;
  pct: number;
  avgLatencyMs: number | null;
  successRate: number | null;
}

export interface FeedItem {
  id: string;
  requestId: string;
  network: NetworkId;
  model: string;
  type: string;
  pricedUnits: InferenceAnalytics.InferencePricedUnit[];
  inferenceAmountAtomic: string;
  platformFeeAtomic: string;
  finalAmountAtomic: string;
  settlementStatus: InferenceAnalytics.InferenceSettlementStatus;
  transactionHash?: string;
  paymentIntentId?: string;
  settledAt: number;
}

export interface RequestRow {
  id: string;
  model: string;
  family: string;
  type: string;
  operation: string;
  status: RequestStatus;
  streamed: boolean;
  latencyMs: number;
  ttftMs: number | null;
  startedAt: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  error?: string;
}

export interface Summary {
  response: Response;
  totalUsd: number;
  inferenceUsd: number;
  platformFeeUsd: number;
  requestCount: number;
  successRate: number | null;
  streamedShare: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  avgTtftMs: number | null;
  tokensIn: number;
  tokensOut: number;
  interval: AnalyticsInterval;
  modelUsage: ModelUsage[];
  typeBreakdown: TypeEntry[];
  timeline: TimelineBucket[];
  activity: FeedItem[];
  requests: RequestRow[];
}

// =============================================================================
// Atomic / USD & Receipt Helpers (1:1 with compose-market/web/src/lib/receipts.ts)
// =============================================================================

const MICRO = 1_000_000;

export function weiToUsd(wei: string | number | null | undefined): number {
  const n = typeof wei === 'number' ? wei : Number(wei ?? '0');
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / MICRO;
}

export const atomicToUsd = weiToUsd;

function atomic(value: string | undefined | null): bigint {
  if (!value) return 0n;
  return /^\d+$/u.test(value) ? BigInt(value) : 0n;
}

export function addAtomicAmounts(left: string, right: string): string {
  return (atomic(left) + atomic(right)).toString();
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

export function formatWeiUsd(wei: string | number | null | undefined): string {
  return formatUsd(weiToUsd(wei));
}

export function timeAgo(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'just now';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function shortTx(hash: string | undefined | null): string | null {
  if (!hash) return null;
  return shortHash(hash, 6, 4);
}

export function settlementTone(
  status: string | undefined,
): 'violet' | 'amber' | 'emerald' | 'danger' {
  switch (status) {
    case 'settled':
      return 'emerald';
    case 'claimed':
    case 'submitted':
      return 'violet';
    case 'queued':
      return 'amber';
    case 'failed':
      return 'danger';
    default:
      return 'amber';
  }
}

// =============================================================================
// Core Summarizer & Zero-Fill Timeline (1:1 with compose-market/web/src/lib/analytics.ts)
// =============================================================================

function pickMetric(metrics: Record<string, number>, keys: readonly string[]): number {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === 'number' && value > 0) return value;
  }
  return 0;
}

const INPUT_TOKEN_KEYS = ['input_tokens', 'text_input_tokens'] as const;
const OUTPUT_TOKEN_KEYS = ['output_tokens', 'text_output_tokens'] as const;

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function emptyTotals(): Totals {
  return {
    requests: { total: 0, succeeded: 0, failed: 0, aborted: 0, streamed: 0 },
    usage: { metrics: {}, units: [] },
    billing: {
      inferenceAmountAtomic: '0',
      platformFeeAtomic: '0',
      finalAmountAtomic: '0',
      currency: 'USDC',
      decimals: 6,
    },
    latency: { count: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 },
  };
}

export function emptyAnalyticsResponse(
  filters: InferenceAnalytics.InferenceAnalyticsFilters = {},
): Response {
  return {
    kind: 'inference',
    filters,
    totals: emptyTotals(),
    breakdowns: {
      families: [],
      models: [],
      types: [],
      operations: [],
      statuses: [],
      settlements: [],
    },
    timeline: [],
    requests: { data: [], nextCursor: null },
    settlements: { data: [], nextCursor: null },
    updatedAt: new Date().toISOString(),
  };
}

function finiteNonNeg(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function percentileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

export function mergeTotals(left: Totals, right: Totals): Totals {
  const metrics: Record<string, number> = { ...left.usage.metrics };
  for (const [k, v] of Object.entries(right.usage.metrics)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      metrics[k] = (metrics[k] ?? 0) + v;
    }
  }

  const unitMap = new Map<string, InferenceAnalytics.InferenceUsageUnit>();
  for (const u of [...(left.usage.units ?? []), ...(right.usage.units ?? [])]) {
    const key = `${u.key}:${u.unit}`;
    const existing = unitMap.get(key);
    if (existing) {
      existing.quantity += u.quantity;
    } else {
      unitMap.set(key, { ...u });
    }
  }

  const lCount = finiteNonNeg(left.latency?.count);
  const rCount = finiteNonNeg(right.latency?.count);
  const totalCount = lCount + rCount;
  const lAvg = finiteNonNeg(left.latency?.averageMs);
  const rAvg = finiteNonNeg(right.latency?.averageMs);
  const lP50 = finiteNonNeg(left.latency?.p50Ms);
  const rP50 = finiteNonNeg(right.latency?.p50Ms);
  const lP95 = finiteNonNeg(left.latency?.p95Ms);
  const rP95 = finiteNonNeg(right.latency?.p95Ms);
  const lP99 = finiteNonNeg(left.latency?.p99Ms);
  const rP99 = finiteNonNeg(right.latency?.p99Ms);

  const mergedLatency =
    totalCount === 0
      ? { count: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 }
      : rCount === 0
        ? { count: lCount, averageMs: lAvg, p50Ms: lP50, p95Ms: lP95, p99Ms: lP99 }
        : lCount === 0
          ? { count: rCount, averageMs: rAvg, p50Ms: rP50, p95Ms: rP95, p99Ms: rP99 }
          : {
              count: totalCount,
              averageMs: (lAvg * lCount + rAvg * rCount) / totalCount,
              p50Ms: (lP50 * lCount + rP50 * rCount) / totalCount,
              p95Ms: Math.max(lP95, rP95),
              p99Ms: Math.max(lP99, rP99),
            };

  return {
    requests: {
      total: left.requests.total + right.requests.total,
      succeeded: left.requests.succeeded + right.requests.succeeded,
      failed: left.requests.failed + right.requests.failed,
      aborted: (left.requests.aborted ?? 0) + (right.requests.aborted ?? 0),
      streamed: left.requests.streamed + right.requests.streamed,
    },
    usage: {
      metrics,
      units: [...unitMap.values()],
    },
    billing: {
      inferenceAmountAtomic: addAtomicAmounts(
        left.billing.inferenceAmountAtomic,
        right.billing.inferenceAmountAtomic,
      ),
      platformFeeAtomic: addAtomicAmounts(
        left.billing.platformFeeAtomic,
        right.billing.platformFeeAtomic,
      ),
      finalAmountAtomic: addAtomicAmounts(
        left.billing.finalAmountAtomic,
        right.billing.finalAmountAtomic,
      ),
      currency: 'USDC',
      decimals: 6,
    },
    latency: mergedLatency,
  };
}

function mergeBreakdowns(lists: Breakdown[][]): Breakdown[] {
  const byKey = new Map<string, Breakdown>();
  for (const list of lists) {
    for (const item of list) {
      const existing = byKey.get(item.key);
      if (!existing) {
        byKey.set(item.key, {
          key: item.key,
          ...(item.label ? { label: item.label } : {}),
          ...(item.types ? { types: [...item.types] } : {}),
          ...(item.lastAt ? { lastAt: item.lastAt } : {}),
          totals: mergeTotals(emptyTotals(), item.totals),
        });
      } else {
        const mergedTypes = new Set<string>([...(existing.types ?? []), ...(item.types ?? [])]);
        const latestAt =
          existing.lastAt && item.lastAt
            ? Date.parse(item.lastAt) > Date.parse(existing.lastAt)
              ? item.lastAt
              : existing.lastAt
            : item.lastAt ?? existing.lastAt;
        byKey.set(item.key, {
          key: item.key,
          label: existing.label ?? item.label,
          ...(mergedTypes.size > 0 ? { types: [...mergedTypes] } : {}),
          ...(latestAt ? { lastAt: latestAt } : {}),
          totals: mergeTotals(existing.totals, item.totals),
        });
      }
    }
  }
  return [...byKey.values()];
}

export function mergeAnalyticsResponses(
  responses: readonly Response[],
  fallbackFilters: InferenceAnalytics.InferenceAnalyticsFilters = {},
): Response {
  if (responses.length === 0) {
    return emptyAnalyticsResponse(fallbackFilters);
  }
  if (responses.length === 1) {
    return responses[0];
  }

  let totals = emptyTotals();
  const timelineByStart = new Map<string, InferenceAnalytics.InferenceAnalyticsBucket>();
  const requestById = new Map<string, InferenceAnalytics.InferenceRequestRecord>();
  const settlementById = new Map<string, InferenceAnalytics.InferenceSettlement>();

  for (const res of responses) {
    totals = mergeTotals(totals, res.totals);
    for (const b of res.timeline) {
      const cur = timelineByStart.get(b.start);
      if (!cur) {
        timelineByStart.set(b.start, {
          start: b.start,
          end: b.end,
          totals: mergeTotals(emptyTotals(), b.totals),
        });
      } else {
        cur.totals = mergeTotals(cur.totals, b.totals);
      }
    }
    for (const r of res.requests.data) {
      if (!requestById.has(r.id)) requestById.set(r.id, r);
    }
    for (const s of res.settlements.data) {
      if (!settlementById.has(s.id)) settlementById.set(s.id, s);
    }
  }

  const sortedTimeline = [...timelineByStart.values()].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  const sortedRequests = [...requestById.values()].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  const sortedSettlements = [...settlementById.values()].sort(
    (a, b) =>
      Date.parse(b.settledAt || b.createdAt) - Date.parse(a.settledAt || a.createdAt),
  );

  const base = responses[0];
  return {
    kind: 'inference',
    filters: base.filters ?? fallbackFilters,
    totals,
    breakdowns: {
      families: mergeBreakdowns(responses.map((r) => r.breakdowns.families)),
      models: mergeBreakdowns(responses.map((r) => r.breakdowns.models)),
      types: mergeBreakdowns(responses.map((r) => r.breakdowns.types)),
      operations: mergeBreakdowns(responses.map((r) => r.breakdowns.operations)),
      statuses: mergeBreakdowns(responses.map((r) => r.breakdowns.statuses)),
      settlements: mergeBreakdowns(responses.map((r) => r.breakdowns.settlements)),
    },
    timeline: sortedTimeline,
    requests: {
      data: sortedRequests,
      nextCursor: responses.find((r) => r.requests.nextCursor)?.requests.nextCursor ?? null,
    },
    settlements: {
      data: sortedSettlements,
      nextCursor:
        responses.find((r) => r.settlements.nextCursor)?.settlements.nextCursor ?? null,
    },
    updatedAt: base.updatedAt,
  };
}
