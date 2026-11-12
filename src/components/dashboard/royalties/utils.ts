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
