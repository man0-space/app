import { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import type { InferenceAnalytics } from '@compose-market/sdk';
import type { NetworkId } from '@compose-market/sdk/chains';
import { useAuth } from '../../../contexts/auth';
import { useFacilitatorChains, useSpentAnalytics } from '../../../hooks/use-analytics';
import { useFocus } from '../../../hooks/use-focus';
import { Tooltip } from '../../tooltip';
import { BlockDropdown, type SpentDropdownOption } from './dropdown';
import { ModelUsageTable } from './models';
import { NetworkFilter } from './networks';
import { OverviewCards } from './overview';
import { ReceiptFeed } from './receipts';
import { SpendingChart } from './spending';

export * from './dropdown';
export * from './networks';
export * from './overview';
export * from './usage';
export * from './spending';
export * from './by-modality';
export * from './models';
export * from './receipts';

const RANGES = [
  { label: '24h', ms: 86_400_000, interval: 'hour' },
  { label: '7d', ms: 7 * 86_400_000, interval: 'hour' },
  { label: '30d', ms: 30 * 86_400_000, interval: 'day' },
  { label: '180d', ms: 180 * 86_400_000, interval: 'day' },
] as const;

type RangeId = (typeof RANGES)[number]['label'];
type BlockId = 'chart' | 'models' | 'feed';
type PocketId = 'overview' | 'models' | 'activity';

const RANGE_OPTIONS: SpentDropdownOption<RangeId>[] = [
  { value: '24h', label: '24H', icon: Clock, tooltip: 'Inference usage over the last 24 hours' },
  { value: '7d', label: '7D', icon: CalendarRange, tooltip: 'Inference usage over the last 7 days' },
  { value: '30d', label: '30D', icon: Calendar, tooltip: 'Inference usage over the last 30 days' },
  { value: '180d', label: '180D', icon: CalendarDays, tooltip: 'Inference usage over the last 180 days' },
];

type StableFilters = Omit<
  InferenceAnalytics.InferenceAnalyticsFilters,
  'from' | 'to' | 'networks'
>;

export interface SpentDashboardProps {
  hideControlRail?: boolean;
}

export function Spent({ hideControlRail = false }: SpentDashboardProps) {
  const { openAuthModal } = useAuth();
  const { chains } = useFacilitatorChains();

  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[2]);
  const [selectedNetworks, setSelectedNetworks] = useState<NetworkId[]>([]);
  const [pocket, setPocket] = useState<PocketId>('overview');
  const { containerRef, focused, toggleFocus } = useFocus<BlockId>();

  const filters = useMemo<StableFilters>(
    () => ({
      interval: range.interval,
      limit: 100,
    }),
    [range.interval],
  );

  const {
    owner,
    summary,
    requests,
    activity,
    hasMoreRequests,
    hasMoreSettlements,
    isLoadingMore,
    loadMore,
    isLoading,
    isRefetching,
    error,
    forceRefresh,
  } = useSpentAnalytics({
    rangeId: range.label,
    rangeMs: range.ms,
    networks: selectedNetworks,
    filters,
  });

  const controlRail = !hideControlRail ? (
    <header className="cm-dashboard-control-rail">
      <div className="cm-dashboard-control-rail__brand">
        <span className="cm-dashboard-control-rail__title">
          <span className="cm-dashboard-control-rail__slash">//</span>
          SPENT
        </span>
        {(isRefetching || isLoading) && (
          <span className="cm-dashboard__updating">UPDATING…</span>
        )}
      </div>

      <div className="cm-dashboard-control-rail__actions">
        <NetworkFilter
          chains={chains}
          selected={selectedNetworks}
          onChange={setSelectedNetworks}
        />

        <BlockDropdown
          variant="header"
          value={range.label}
          options={RANGE_OPTIONS}
          ariaLabel="Select Time Range"
          align="end"
          onChange={(value) => {
            const next = RANGES.find((option) => option.label === value);
            if (next) setRange(next);
          }}
        />

        <Tooltip title="Refresh Spend" description="Sync inference usage & settlement telemetry">
          <button
            type="button"
            className="cm-control-icon-button"
            onClick={() => void forceRefresh()}
            disabled={!owner || isRefetching || isLoading}
            aria-label="Refresh spent analytics"
          >
            <RefreshCw size={13} className={isRefetching || isLoading ? 'spin-icon' : ''} />
          </button>
        </Tooltip>
      </div>
    </header>
  ) : null;

  if (!owner) {
    return (
      <div className="cm-dashboard" data-pocket={pocket}>
        {controlRail}
        <div className="cm-dashboard__empty">
          <Wallet className="cm-dashboard__empty-icon" />
          <span className="cm-dashboard__empty-title">Sign in to view spending telemetry</span>
          <span className="cm-dashboard__empty-text">
            Connect your account to inspect model inference costs, token throughput, and x402 settlements.
          </span>
          <button type="button" className="cm-feed-more" onClick={openAuthModal}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="cm-dashboard" data-pocket={pocket}>
        {controlRail}
        <div className="cm-dashboard__empty">
          <Wallet className="cm-dashboard__empty-icon" />
          <span className="cm-dashboard__empty-title">Unable to load usage data</span>
          <span className="cm-dashboard__empty-text">{error.message}</span>
          <button type="button" className="cm-feed-more" onClick={() => void forceRefresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading && !summary) {
    return (
      <div className="cm-dashboard" data-pocket={pocket}>
        {controlRail}
        <div className="cm-dashboard__empty">
          <RefreshCw className="cm-dashboard__empty-icon spin-icon" />
          <span className="cm-dashboard__empty-title">Loading usage data</span>
          <span className="cm-dashboard__empty-text">Reading your inference telemetry…</span>
        </div>
      </div>
    );
  }

  if (!summary || (summary.requestCount === 0 && activity.length === 0)) {
    return (
      <div className="cm-dashboard" data-pocket={pocket}>
        {controlRail}
        <div className="cm-dashboard__empty">
          <Wallet className="cm-dashboard__empty-icon" />
          <span className="cm-dashboard__empty-title">No usage yet</span>
          <span className="cm-dashboard__empty-text">
            Run a workflow or generate media to record your first inference receipt.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="cm-dashboard"
      data-focus={focused ?? undefined}
      data-pocket={pocket}
      data-rail={hideControlRail ? 'hidden' : undefined}
    >
      {controlRail}

      <nav className="cm-pocket-bar cm-pocket-bar--dashboard" aria-label="Spent dashboard view">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'models', label: 'Models' },
            { id: 'activity', label: 'Activity' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className="cm-pocket-bar__tab"
            data-active={pocket === item.id ? 'true' : 'false'}
            onClick={() => setPocket(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {error ? (
        <div className="cm-dashboard__alert">
          Unable to update usage data: {error.message}
        </div>
      ) : null}

      <OverviewCards summary={summary} />

      <SpendingChart
        timeline={summary.timeline}
        interval={summary.interval}
        focused={focused === 'chart'}
        dataBlock="chart"
        onClick={() => toggleFocus('chart')}
      />

      <ModelUsageTable
        models={summary.modelUsage}
        modalityBreakdown={summary.typeBreakdown}
        focused={focused === 'models'}
        dataBlock="models"
        onClick={() => toggleFocus('models')}
      />

      <ReceiptFeed
        receipts={activity}
        requests={requests}
        chains={chains}
        hasMoreSettlements={hasMoreSettlements}
        hasMoreRequests={hasMoreRequests}
        isLoadingMore={isLoadingMore}
        onLoadMore={(kind) => void loadMore(kind)}
        focused={focused === 'feed'}
        dataBlock="feed"
        onClick={() => toggleFocus('feed')}
      />
    </div>
  );
}

export const SpentDashboard = Spent;
export default Spent;
