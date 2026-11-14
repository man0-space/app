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

export function mergeAnalytics(
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

export function mapFeedItem(settlement: InferenceAnalytics.InferenceSettlement): FeedItem {
  const paymentIntentId = (
    settlement as InferenceAnalytics.InferenceSettlement & { paymentIntentId?: string }
  ).paymentIntentId;
  return {
    id: settlement.id,
    requestId: settlement.requestId,
    network: settlement.network as NetworkId,
    model: settlement.model,
    type: settlement.types.join(', '),
    pricedUnits: settlement.pricedUnits,
    inferenceAmountAtomic: settlement.billing.inferenceAmountAtomic,
    platformFeeAtomic: settlement.billing.platformFeeAtomic,
    finalAmountAtomic: settlement.billing.finalAmountAtomic,
    settlementStatus: settlement.status,
    transactionHash:
      settlement.transactionHash ||
      settlement.settleTransactionHash ||
      settlement.claimTransactionHash,
    paymentIntentId,
    settledAt: Date.parse(settlement.settledAt || settlement.createdAt),
  };
}

export function mapRequestRow(record: InferenceAnalytics.InferenceRequestRecord): RequestRow {
  return {
    id: record.id,
    model: record.model,
    family: record.family,
    type: record.types.join(', '),
    operation: record.operation,
    status: record.status,
    streamed: record.streamed,
    latencyMs: record.latencyMs,
    ttftMs: typeof record.timeToFirstTokenMs === 'number' ? record.timeToFirstTokenMs : null,
    startedAt: Date.parse(record.startedAt),
    tokensIn: pickMetric(record.usage.metrics, INPUT_TOKEN_KEYS),
    tokensOut: pickMetric(record.usage.metrics, OUTPUT_TOKEN_KEYS),
    costUsd: atomicToUsd(record.billing.finalAmountAtomic),
    error: record.error ? `${record.error.code}: ${record.error.message}` : undefined,
  };
}

const INTERVAL_MS: Record<AnalyticsInterval, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

const MAX_BUCKETS = 2_000;

function floorToInterval(timestampMs: number, interval: AnalyticsInterval): number {
  const date = new Date(timestampMs);
  if (interval === 'day') {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  if (interval === 'hour') {
    return Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
    );
  }
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  );
}

export function zeroFillTimeline(
  response: Response,
  interval: AnalyticsInterval,
): TimelineBucket[] {
  const step = INTERVAL_MS[interval];
  const byStart = new Map<number, Totals>();
  for (const bucket of response.timeline) {
    byStart.set(Date.parse(bucket.start), bucket.totals);
  }

  const from = response.filters.from ? Date.parse(response.filters.from) : Number.NaN;
  const to = response.filters.to ? Date.parse(response.filters.to) : Number.NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return response.timeline.map((bucket) => ({
      timestamp: Date.parse(bucket.start),
      endTimestamp: Date.parse(bucket.end),
      totals: bucket.totals,
    }));
  }

  const buckets: TimelineBucket[] = [];
  let cursor = floorToInterval(from, interval);
  const last = floorToInterval(to, interval);
  while (cursor <= last && buckets.length < MAX_BUCKETS) {
    buckets.push({
      timestamp: cursor,
      endTimestamp: cursor + step,
      totals: byStart.get(cursor) ?? emptyTotals(),
    });
    cursor += step;
  }
  return buckets;
}

export function summarize(response: Response): Summary {
  const totalUsd = atomicToUsd(response.totals.billing.finalAmountAtomic);
  const interval: AnalyticsInterval = response.filters.interval ?? 'day';
  const requests = response.requests.data.map(mapRequestRow);
  const ttftSamples = requests.filter((row) => row.ttftMs !== null);
  const latencySamples = requests
    .map((row) => row.latencyMs)
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const requestTotals = response.totals.requests;
  const reportedAvgMs =
    response.totals.latency.count > 0 ? finiteNonNeg(response.totals.latency.averageMs) : 0;
  const reportedP95Ms =
    response.totals.latency.count > 0 ? finiteNonNeg(response.totals.latency.p95Ms) : 0;
  const fallbackAvgMs =
    latencySamples.length > 0
      ? latencySamples.reduce((sum, ms) => sum + ms, 0) / latencySamples.length
      : 0;
  const fallbackP95Ms =
    latencySamples.length > 0 ? percentileSorted(latencySamples, 0.95) : 0;

  return {
    response,
    totalUsd,
    inferenceUsd: atomicToUsd(response.totals.billing.inferenceAmountAtomic),
    platformFeeUsd: atomicToUsd(response.totals.billing.platformFeeAtomic),
    requestCount: requestTotals.total,
    successRate: ratio(requestTotals.succeeded, requestTotals.total),
    streamedShare: ratio(requestTotals.streamed, requestTotals.total),
    avgLatencyMs:
      reportedAvgMs > 0 ? reportedAvgMs : fallbackAvgMs > 0 ? fallbackAvgMs : null,
    p95LatencyMs:
      reportedP95Ms > 0 ? reportedP95Ms : fallbackP95Ms > 0 ? fallbackP95Ms : null,
    avgTtftMs:
      ttftSamples.length > 0
        ? ttftSamples.reduce((sum, row) => sum + (row.ttftMs ?? 0), 0) / ttftSamples.length
        : null,
    tokensIn: pickMetric(response.totals.usage.metrics, INPUT_TOKEN_KEYS),
    tokensOut: pickMetric(response.totals.usage.metrics, OUTPUT_TOKEN_KEYS),
    interval,
    modelUsage: response.breakdowns.models
      .map((entry) => {
        const computedTotalTokens =
          entry.totals.usage.metrics.total_tokens ||
          pickMetric(entry.totals.usage.metrics, INPUT_TOKEN_KEYS) +
          pickMetric(entry.totals.usage.metrics, OUTPUT_TOKEN_KEYS);
        return {
          subject: entry.key,
          modelId: entry.key,
          family: entry.label ?? entry.key,
          totalAmountAtomic: atomic(entry.totals.billing.finalAmountAtomic),
          totalUsd: atomicToUsd(entry.totals.billing.finalAmountAtomic),
          calls: entry.totals.requests.total,
          totalTokens: computedTotalTokens,
          tokensIn: pickMetric(entry.totals.usage.metrics, INPUT_TOKEN_KEYS),
          tokensOut: pickMetric(entry.totals.usage.metrics, OUTPUT_TOKEN_KEYS),
          p50Ms: entry.totals.latency.count > 0 ? entry.totals.latency.p50Ms : null,
          p95Ms: entry.totals.latency.count > 0 ? entry.totals.latency.p95Ms : null,
          successRate: ratio(entry.totals.requests.succeeded, entry.totals.requests.total),
          lastUsed: entry.lastAt ? Date.parse(entry.lastAt) : 0,
          type: entry.types?.join(', ') || 'unknown',
        };
      })
      .sort((left, right) => right.totalUsd - left.totalUsd || right.calls - left.calls),
    typeBreakdown: response.breakdowns.types
      .map((entry) => ({
        key: entry.key,
        usd: atomicToUsd(entry.totals.billing.finalAmountAtomic),
        calls: entry.totals.requests.total,
        tokens:
          entry.totals.usage.metrics.total_tokens ||
          pickMetric(entry.totals.usage.metrics, INPUT_TOKEN_KEYS) +
          pickMetric(entry.totals.usage.metrics, OUTPUT_TOKEN_KEYS),
        pct:
          totalUsd > 0
            ? (atomicToUsd(entry.totals.billing.finalAmountAtomic) / totalUsd) * 100
            : 0,
        avgLatencyMs: entry.totals.latency.count > 0 ? entry.totals.latency.averageMs : null,
        successRate: ratio(entry.totals.requests.succeeded, entry.totals.requests.total),
      }))
      .sort((a, b) => b.usd - a.usd || b.calls - a.calls),
    timeline: zeroFillTimeline(response, interval),
    activity: response.settlements.data.map(mapFeedItem),
    requests,
  };
}

// =============================================================================
// Formatters & Display Helpers
// =============================================================================

export function numberLabel(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    notation: value >= 100_000 ? 'compact' : 'standard',
  }).format(value);
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 100_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.round(value));
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPct(rate: number | null, digits = 1): string {
  if (rate === null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function tickTime(timestamp: number, interval: AnalyticsInterval): string {
  const date = new Date(timestamp);
  if (interval === 'day') return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function tooltipTime(
  timestamp: number,
  endTimestamp: number,
  interval: AnalyticsInterval,
): string {
  const date = new Date(timestamp);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (interval === 'day') return day;
  const end = new Date(endTimestamp);
  return `${day} ${two(date.getHours())}:${two(date.getMinutes())}–${two(end.getHours())}:${two(end.getMinutes())}`;
}

export interface RollingAnalyticsInput {
  rangeMs: number;
  filters: Omit<InferenceAnalytics.InferenceAnalyticsFilters, 'from' | 'to' | 'networks'>;
  networks: readonly string[];
}

export function buildRollingAnalyticsFilters(
  input: RollingAnalyticsInput,
  now = Date.now(),
): InferenceAnalytics.InferenceAnalyticsFilters {
  const networks = [...new Set(input.networks)].sort();
  return {
    ...input.filters,
    from: new Date(now - input.rangeMs).toISOString(),
    to: new Date(now).toISOString(),
    ...(networks.length > 0 ? { networks } : {}),
  };
}

// =============================================================================
// Family Logo, Modality Label & Chain Explorer Helpers
// =============================================================================

const SERIES_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|\/|-)(?:gpt|chatgpt|o1|o3|o4|whisper|tts-1|dall-e)/i, 'openai'],
  [/(?:^|\/|-)claude/i, 'anthropic'],
  [/(?:^|\/|-)(?:gemini|gemma|imagen|veo|lyria|chirp)/i, 'google'],
  [/(?:^|\/|-)(?:qwen|qwq|wan|cosyvoice|happyhorse)/i, 'alibaba'],
  [/(?:^|\/|-)deepseek/i, 'deepseek'],
  [/(?:^|\/|-)llama/i, 'meta'],
  [/(?:^|\/|-)(?:mistral|ministral|codestral|pixtral|devstral|magistral)/i, 'mistral'],
  [/(?:^|\/|-)flux/i, 'blackforestlabs'],
  [/(?:^|\/|-)(?:glm|cogview|cogvideo)/i, 'zai'],
  [/(?:^|\/|-)grok/i, 'xai'],
  [/(?:^|\/|-)kimi/i, 'moonshot'],
  [/(?:^|\/|-)minimax/i, 'minimax'],
  [/(?:^|\/|-)command/i, 'cohere'],
  [/(?:^|\/|-)nemotron/i, 'nvidia'],
];

export function getFamilyLogoUrl(familyOrModel: string | undefined | null): string | null {
  if (!familyOrModel) return null;
  const normalized = familyOrModel
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (FAMILY_LOGOS[normalized]) {
    return `/families/${FAMILY_LOGOS[normalized]}`;
  }
  const prefix = familyOrModel.split(/[/:]/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (prefix && FAMILY_LOGOS[prefix]) {
    return `/families/${FAMILY_LOGOS[prefix]}`;
  }
  for (const [pattern, key] of SERIES_PATTERNS) {
    if (pattern.test(familyOrModel) && FAMILY_LOGOS[key]) {
      return `/families/${FAMILY_LOGOS[key]}`;
    }
  }
  return null;
}

const TYPE_LABEL_MAP: Record<string, string> = {
  text: 'Text',
  llm: 'Text',
  'text-generation': 'Text',
  conversational: 'Chat',
  image: 'Image',
  'text-to-image': 'Image',
  'image-to-image': 'Image Edit',
  audio: 'Audio',
  'text-to-speech': 'TTS',
  'speech-to-text': 'STT',
  'text-to-audio': 'Music',
  'music-generation': 'Music',
  video: 'Video',
  'text-to-video': 'Video',
  'image-to-video': 'Video',
  embedding: 'Embed',
  embeddings: 'Embed',
  'feature-extraction': 'Embed',
  rerank: 'Rerank',
  'deep-research': 'Research',
  unknown: 'Other',
};

export function primaryModalityKey(rawType: string | undefined | null): string {
  const first = (rawType ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();
  if (!first) return 'unknown';
  if (first === 'llm') return 'text';
  if (first === 'embeddings') return 'embedding';
  return first;
}

export function formatModelTypeLabel(rawType: string | undefined | null): string {
  const key = primaryModalityKey(rawType);
  if (TYPE_LABEL_MAP[key]) return TYPE_LABEL_MAP[key];
  return key
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

export function networkLogoForChain(network: string | undefined | null): string {
  const raw = (network ?? '').toLowerCase();
  if (raw.startsWith('solana:')) return '/networks/solana-2.png';
  if (raw.startsWith('near:')) return '/networks/NEAR-2.png';
  return '/networks/ethereum.png';
}

export function resolveExplorerTxUrl(
  chains: readonly FacilitatorChain[],
  network: string,
  txHash: string,
): string {
  if (!txHash) return '#';
  const matched = chains.find((c) => c.network === network);
  if (matched?.explorer) {
    const base = matched.explorer.replace(/\/+$/, '');
    const query = matched.explorerQuery
      ? matched.explorerQuery.startsWith('?')
        ? matched.explorerQuery
        : `?${matched.explorerQuery}`
      : '';
    if (matched.namespace === 'near' || network.startsWith('near:')) {
      return `${base}/txns/${encodeURIComponent(txHash)}${query}`;
    }
    return `${base}/tx/${encodeURIComponent(txHash)}${query}`;
  }
  const lower = network.toLowerCase();
  if (lower.startsWith('solana:')) {
    const devnet = lower.includes('devnet') || lower.includes('etwtrabzayq6imfeykouru166vu2xqa1');
    return `https://solscan.io/tx/${encodeURIComponent(txHash)}${devnet ? '?cluster=devnet' : ''}`;
  }
  if (lower.startsWith('near:')) {
    return explorerTxUrl(txHash, lower.includes('testnet') ? 'v1.testnet' : 'v1.near');
  }
  if (lower === 'eip155:8453') return `https://basescan.org/tx/${encodeURIComponent(txHash)}`;
  if (lower === 'eip155:42161') return `https://arbiscan.io/tx/${encodeURIComponent(txHash)}`;
  if (lower === 'eip155:43114') return `https://snowtrace.io/tx/${encodeURIComponent(txHash)}`;
  return externalWalletExplorerUrl('evm', txHash).replace('/address/', '/tx/');
}

// =============================================================================
// Compose Analytics Subject & SSE Reconciliation Helpers
// =============================================================================

export function isNear(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 64) return false;
  if (/^0s[0-9a-f]{40}$/.test(normalized)) return true;
  if (/^0u[0123456789abcdefghjkmnpqrstvwxyz]{51}[0g]$/.test(normalized)) return true;
  if (/^0x[0-9a-fA-F]{40}$/.test(normalized)) return false;
  if (/^[0-9a-f]{64}$/.test(normalized)) return true;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)+([a-z\d]+[-_])*[a-z\d]+$/.test(normalized);
}

export function resolveAnalytics(input: {
  userAddress?: string | null;
  spendingAddress?: string | null;
}): string[] {
  if (!input.userAddress?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates = [input.spendingAddress, input.userAddress];
  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    if (!isNear(trimmed)) continue;
    const dedupKey = trimmed.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(trimmed);
  }
  return out;
}

export interface AnalyticsSseStreamState {
  seenInitialReady: boolean;
}

export function refreshSse(
  eventType: string | undefined | null,
  state: AnalyticsSseStreamState,
): boolean {
  if (eventType === 'invalidate') {
    return true;
  }
  if (eventType === 'ready') {
    if (!state.seenInitialReady) {
      state.seenInitialReady = true;
      return false;
    }
    return true;
  }
  return false;
}
