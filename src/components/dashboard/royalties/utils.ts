import type React from 'react';
import {
  AllCommunityModule as GridCommunityModule,
  ModuleRegistry as GridModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import {
  AllCommunityModule as ChartsCommunityModule,
  ModuleRegistry as ChartsModuleRegistry,
} from 'ag-charts-community';
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Filter,
  GitBranch,
  Layers,
  Play,
  Radio,
  Sparkles,
} from 'lucide-react';
import type { CreatorEarningEvent, CreatorWorkflowEarningSummary } from '../../../lib/api';
import { explorerTxUrl, externalWalletExplorerUrl, shortHash } from '../../../lib/contracts';
import type { Listing } from '../../../lib/schema';

GridModuleRegistry.registerModules([GridCommunityModule]);
ChartsModuleRegistry.registerModules([ChartsCommunityModule]);

// ============================================================================
// Types
// ============================================================================

export type BlockId = 'chart' | 'models' | 'feed';
export type PocketId = 'overview' | 'models' | 'activity';
export type DateWindow = '24h' | '7d' | '30d' | '180d';
export type EarnNetworkFilter = 'all' | 'near' | 'evm' | 'svm';
export type RevenueSourceFilter = 'all' | 'paid' | 'free';
export type ChartView = 'profit' | 'runs' | 'runtime' | 'success';
export type WorkflowsView = 'workflows' | 'task';
export type WorkflowsSortKey = 'profit' | 'runs' | 'runtime' | 'success' | 'recent' | 'task';
export type TaskMetric = 'profit' | 'runs' | 'runtime';
export type FeedView = 'runs' | 'settlements';
export type RunsFilter = 'all' | 'succeeded' | 'failed';
export type SettlementsFilter = 'all' | 'settled';
export type EarnStatId = 'profit' | 'runs' | 'runtime' | 'success' | 'workflows';
export type PaletteIndex = 0 | 1 | 2 | 3 | 4 | 5;

export interface EarnDashboardProps {
  workflows?: Listing[];
  onSelectWorkflow?: (workflow: Listing) => void;
  hideControlRail?: boolean;
}

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string; size?: number }>;
  logoUrl?: string | null;
  tooltip?: string;
}

export interface NormalizedWorkflowRow {
  listing: Listing | null;
  workflowId: string;
  title: string;
  banner: string | null;
  primaryTask: string;
  allTasks: string[];
  taskLabel: string;
  published: boolean;
  creatorFeePct: number;
  stepsCount: number;
  networkFamily: 'near' | 'evm' | 'svm';
  networkLabel: string;
  logoUrl: string;
  profitUsd: number;
  grossUsd: number;
  composeCostUsd: number;
  runs: number;
  paidRuns: number;
  succeededRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  totalDurationMs: number;
  successPct: number;
  lastRunAt: number;
}

export interface EnrichedEarnEvent {
  id: string;
  workflowId: string;
  workflowTitle: string;
  primaryTask: string;
  allTasks: string[];
  taskLabel: string;
  runnerAddress: string;
  status: string;
  network: string;
  networkFamily: 'near' | 'evm' | 'svm';
  networkLabel: string;
  logoUrl: string;
  kind: 'paid' | 'free';
  royaltiesUsd: number;
  composeBillUsd: number;
  totalChargedUsd: number;
  durationMs: number;
  stepsCount: number;
  txHash: string | null;
  explorerUrl: string | null;
  proofCid: string | null;
  timestamp: number;
}

export interface TimeSeriesBucket {
  index: number;
  startMs: number;
  endMs: number;
  bucketKey: string;
  label: string;
  royaltiesUsd: number;
  composeCostUsd: number;
  totalUsd: number;
  runs: number;
  runTop0: number;
  runTop1: number;
  runTop2: number;
  runOthers: number;
  runtimeMs: number;
  timeTop0: number;
  timeTop1: number;
  timeTop2: number;
  timeOthers: number;
  succeededCount: number;
  totalCount: number;
  successPct: number;
  avgSuccessPct: number;
}

export interface OverviewStats {
  totalProfitUsd: number;
  totalGrossUsd: number;
  totalRuns: number;
  paidRuns: number;
  totalRuntimeMs: number;
  avgRuntimeMs: number;
  avgSuccessPct: number;
  peakSuccessPct: number;
  publishedWorkflows: number;
  totalWorkflows: number;
  avgCreatorFeePct: number;
  profitSparkline: number[];
}

export interface TaskSlice {
  task: string;
  profitUsd: number;
  runs: number;
  runtimeMs: number;
  successSum: number;
  workflowCount: number;
  value: number;
  avgSuccessPct: number;
  paletteIndex: PaletteIndex;
  color: (typeof BRAND_PALETTE)[number];
  pct: number;
}

// ============================================================================
// Constants (man0 Stealth-Glass Accent Palette)
// ============================================================================

export const BRAND_PALETTE = [
  '#10b981', // agent emerald (profit / primary positive)
  '#38bdf8', // model cyan (primary brand)
  '#ff2e63', // connector coral
  '#a855f7', // trigger violet
  '#fde047', // gold
  '#2dd4bf', // teal
] as const;

export const DEFAULT_AG_COL_DEF: ColDef = {
  suppressHeaderMenuButton: true,
  sortable: false,
  resizable: false,
};

export const DATE_WINDOW_OPTIONS: DropdownOption<DateWindow>[] = [
  { value: '24h', label: '24H', icon: Clock, tooltip: 'Activity over the last 24 hours' },
  { value: '7d', label: '7D', icon: Calendar, tooltip: 'Activity over the last 7 days' },
  { value: '30d', label: '30D', icon: Calendar, tooltip: 'Activity over the last 30 days' },
  { value: '180d', label: '180D', icon: Calendar, tooltip: 'Activity over the last 180 days' },
];

export const NETWORK_FILTER_OPTIONS: DropdownOption<EarnNetworkFilter>[] = [
  { value: 'all', label: 'All', tooltip: 'All settlement networks' },
  { value: 'near', label: 'NEAR', logoUrl: '/networks/NEAR-2.png', tooltip: 'NEAR Protocol settlements' },
  { value: 'evm', label: 'EVM', logoUrl: '/networks/ethereum.png', tooltip: 'EVM chain settlements' },
  { value: 'svm', label: 'Solana', logoUrl: '/networks/solana-2.png', tooltip: 'Solana network settlements' },
];

export const SOURCE_OPTIONS: DropdownOption<RevenueSourceFilter>[] = [
  { value: 'all', label: 'ALL RUNS', icon: Filter, tooltip: 'All paid and free workflow executions' },
  { value: 'paid', label: 'PAID', icon: DollarSign, tooltip: 'Settled runs generating creator royalties' },
  { value: 'free', label: 'FREE / DRY', icon: Sparkles, tooltip: 'Zero-fee or owner test executions' },
];

export const CHART_VIEW_OPTIONS: DropdownOption<ChartView>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Net creator royalties and gross run volume over time' },
  { value: 'runs', label: 'RUNS', icon: Play, tooltip: 'Workflow executions segmented by Top 3 workflows + Others' },
  { value: 'runtime', label: 'RUNTIME', icon: Clock, tooltip: 'Total execution runtime segmented by Top 3 workflows + Others' },
  { value: 'success', label: 'SUCCESS', icon: Activity, tooltip: 'Execution success rate (%) over time vs. window average' },
];

export const WORKFLOWS_VIEW_OPTIONS: DropdownOption<WorkflowsView>[] = [
  { value: 'workflows', label: 'WORKFLOWS', icon: GitBranch, tooltip: 'Per-workflow royalties, runs, runtime, and success rate' },
  { value: 'task', label: 'BY TASK', icon: Layers, tooltip: 'Creator performance aggregated by task category' },
];

export const WORKFLOWS_SORT_OPTIONS: DropdownOption<WorkflowsSortKey>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Sort workflows by net creator royalties' },
  { value: 'runs', label: 'RUNS', icon: Play, tooltip: 'Sort workflows by total execution count' },
  { value: 'runtime', label: 'RUNTIME', icon: Clock, tooltip: 'Sort workflows by cumulative execution duration' },
  { value: 'success', label: 'SUCCESS', icon: CheckCircle2, tooltip: 'Sort workflows by execution success rate (%)' },
  { value: 'recent', label: 'RECENT', icon: Clock, tooltip: 'Sort workflows by most recent execution' },
  { value: 'task', label: 'TASK', icon: Layers, tooltip: 'Sort workflows alphabetically by primary task' },
];

export const TASK_METRIC_OPTIONS: DropdownOption<TaskMetric>[] = [
  { value: 'profit', label: 'PROFIT', icon: DollarSign, tooltip: 'Share of net royalties by task category' },
  { value: 'runs', label: 'RUNS', icon: Play, tooltip: 'Share of total executions by task category' },
  { value: 'runtime', label: 'RUNTIME', icon: Clock, tooltip: 'Share of total execution time by task category' },
];

export const FEED_VIEW_OPTIONS: DropdownOption<FeedView>[] = [
  { value: 'runs', label: 'RUNS', icon: Radio, tooltip: 'Chronological workflow execution activity feed' },
  { value: 'settlements', label: 'SETTLEMENTS', icon: Layers, tooltip: 'Verified on-chain creator royalty settlements' },
];

// ============================================================================
// Pure Helpers
// ============================================================================

export function atomicToUsd(atomic: string | number | null | undefined): number {
  const n = typeof atomic === 'number' ? atomic : Number(atomic ?? '0');
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / 1_000_000;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

export function formatMs(ms: number): string {
  const safe = Math.max(0, Math.round(Number(ms) || 0));
  if (safe === 0) return '0ms';
  if (safe < 1000) return `${safe}ms`;
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)}s`;
  if (safe < 3_600_000) {
    const mins = Math.floor(safe / 60_000);
    const secs = Math.floor((safe % 60_000) / 1000);
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  const hrs = Math.floor(safe / 3_600_000);
  const mins = Math.floor((safe % 3_600_000) / 60_000);
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

export function shortTx(txHash?: string | null): string {
  if (!txHash) return '';
  return shortHash(txHash, 6, 4);
}

export function timeAgo(ts?: number | string | null): string {
  if (!ts) return 'recent';
  const parsed = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'recent';
  const diffSec = Math.max(1, Math.floor((Date.now() - parsed) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function successTone(pct: number): 'emerald' | 'amber' | 'danger' {
  if (pct >= 95) return 'emerald';
  if (pct >= 75) return 'amber';
  return 'danger';
}

export function classifyNetwork(network?: string | null): {
  family: 'near' | 'evm' | 'svm';
  label: string;
  logoUrl: string;
} {
  const raw = (network ?? '').toLowerCase();
  if (raw.startsWith('solana')) {
    return { family: 'svm', label: 'Solana', logoUrl: '/networks/solana-2.png' };
  }
  if (raw.startsWith('eip155:')) {
    return { family: 'evm', label: 'EVM', logoUrl: '/networks/ethereum.png' };
  }
  return {
    family: 'near',
    label: raw.includes('testnet') ? 'NEAR Testnet' : 'NEAR',
    logoUrl: '/networks/NEAR-2.png',
  };
}

export function resolveEventExplorerUrl(network: string, txHash: string | null): string | null {
  if (!txHash) return null;
  const raw = (network ?? '').toLowerCase();
  if (raw.startsWith('solana')) {
    const devnet = raw.includes('etwtrabzayq6imfeykouru166vu2xqa1') || raw.includes('devnet');
    return `https://solscan.io/tx/${encodeURIComponent(txHash)}${devnet ? '?cluster=devnet' : ''}`;
  }
  if (raw.startsWith('eip155:')) {
    if (raw === 'eip155:8453') return `https://basescan.org/tx/${encodeURIComponent(txHash)}`;
    if (raw === 'eip155:84532') return `https://sepolia.basescan.org/tx/${encodeURIComponent(txHash)}`;
    if (raw === 'eip155:42161') return `https://arbiscan.io/tx/${encodeURIComponent(txHash)}`;
    if (raw === 'eip155:43114') return `https://snowtrace.io/tx/${encodeURIComponent(txHash)}`;
    return externalWalletExplorerUrl('evm', txHash).replace('/address/', '/tx/');
  }
  return explorerTxUrl(txHash, raw.includes('testnet') ? 'v1.testnet' : 'v1.near');
}

export function normalizeTaskList(rawTasks?: readonly string[] | null): string[] {
  const raw = (Array.isArray(rawTasks) ? rawTasks : [])
    .flatMap((t) => (typeof t === 'string' ? t.split(',') : []))
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const k = item.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out.length > 0 ? out : ['Automation'];
}

export function renderTooltipHtml(
  title: string,
  rows: Array<{ label: string; value: string; palette?: PaletteIndex | 'muted' | 'danger'; strong?: boolean }>,
): string {
  const rowsHtml = rows
    .map((r) => {
      const dot =
        r.palette !== undefined
          ? `<span class="cm-chart-tooltip__dot" data-palette="${r.palette}"></span>`
          : '';
      return `<div class="cm-chart-tooltip__row" ${r.strong ? 'data-strong="true"' : ''}>
        <span class="cm-chart-tooltip__label">${dot}${r.label}</span>
        <span class="cm-chart-tooltip__value">${r.value}</span>
      </div>`;
    })
    .join('');
  return `<div class="cm-chart-tooltip">
    <div class="cm-chart-tooltip__time">${title}</div>
    ${rowsHtml}
  </div>`;
}

export function enrichEarnEvent(
  ev: CreatorEarningEvent,
  workflowById: Map<string, NormalizedWorkflowRow>,
): EnrichedEarnEvent {
  const wf = workflowById.get(ev.workflowId);
  const allTasks = wf?.allTasks?.length ? wf.allTasks : normalizeTaskList(ev.tasks);
  const net = classifyNetwork(ev.network);
  const royaltiesUsd = atomicToUsd(ev.earnedAtomic);
  const composeBillUsd = atomicToUsd(ev.composeBillAtomic);
  const totalChargedUsd = atomicToUsd(ev.totalChargedAtomic);
  const ts = Date.parse(ev.timestamp);
  return {
    id: ev.id,
    workflowId: ev.workflowId,
    workflowTitle: wf?.title || ev.workflowName || 'Untitled Workflow',
    primaryTask: allTasks[0] ?? 'Automation',
    allTasks,
    taskLabel: allTasks.join(', '),
    runnerAddress: ev.runnerAddress || '',
    status: ev.status || 'completed',
    network: ev.network || 'near:mainnet',
    networkFamily: net.family,
    networkLabel: net.label,
    logoUrl: net.logoUrl,
    kind: royaltiesUsd > 0 ? 'paid' : 'free',
    royaltiesUsd,
    composeBillUsd,
    totalChargedUsd,
    durationMs: Math.max(0, Number(ev.durationMs) || 0),
    stepsCount: Math.max(0, Number(ev.stepsCount) || wf?.stepsCount || 0),
    txHash: ev.txHash,
    explorerUrl: resolveEventExplorerUrl(ev.network || 'near:mainnet', ev.txHash),
    proofCid: ev.proofCid,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
  };
}

export function mergeWorkflowSummary(
  summary: CreatorWorkflowEarningSummary | undefined,
  listing: Listing | undefined,
): Omit<NormalizedWorkflowRow, 'networkFamily' | 'networkLabel' | 'logoUrl'> | null {
  const workflowId = summary?.workflowId ?? listing?.id;
  if (!workflowId) return null;
  const allTasks = normalizeTaskList(
    summary?.tasks?.length ? summary.tasks : listing?.terms?.tasks ?? listing?.tasks,
  );
  const runs = summary?.runs ?? 0;
  const succeededRuns = summary?.succeededRuns ?? 0;
  const failedRuns = summary?.failedRuns ?? 0;
  const profitUsd = atomicToUsd(summary?.earnedAtomic);
  const paidRuns = profitUsd > 0 ? summary?.paidRuns ?? 0 : 0;
  const grossUsd = atomicToUsd(summary?.totalChargedAtomic);
  const composeCostUsd = Math.max(0, Number((grossUsd - profitUsd).toFixed(6)));
  const avgDurationMs = summary?.avgDurationMs ?? 0;
  const totalDurationMs = summary?.totalDurationMs ?? 0;
  const successPct = runs > 0 ? Number(((succeededRuns / runs) * 100).toFixed(1)) : 100;
  const lastRaw = summary?.lastRunAt ?? summary?.modified ?? listing?.published ?? listing?.modified;
  const parsedLast = lastRaw ? Date.parse(lastRaw) : 0;

  return {
    listing: listing ?? null,
    workflowId,
    title: summary?.name || listing?.name || 'Untitled Workflow',
    banner: summary?.banner ?? listing?.banner ?? null,
    primaryTask: allTasks[0] ?? 'Automation',
    allTasks,
    taskLabel: allTasks.join(', '),
    published: Boolean(summary?.published ?? listing?.published),
    creatorFeePct: summary?.creatorFee ?? listing?.terms?.creatorFee ?? 0,
    stepsCount: summary?.stepsCount ?? listing?.nodes?.length ?? 0,
    profitUsd,
    grossUsd,
    composeCostUsd,
    runs,
    paidRuns,
    succeededRuns,
    failedRuns,
    avgDurationMs,
    totalDurationMs,
    successPct,
    lastRunAt: Number.isFinite(parsedLast) ? parsedLast : 0,
  };
}

export const getWorkflowRowId = <T extends { workflowId: string }>(params: { data: T }) =>
  params.data.workflowId;
export const getTaskRowId = <T extends { task: string }>(params: { data: T }) =>
  params.data.task;
export const getFeedRowId = <T extends { id: string }>(params: { data: T }) => params.data.id;
