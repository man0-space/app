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
