import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Wallet } from 'lucide-react';
import { useAuth } from '../../../contexts/auth';
import { useFocus } from '../../../hooks/use-focus';
import { api, authenticated, type CreatorEarnPayload } from '../../../lib/api';
import { Tooltip } from '../../tooltip';
import { BlockDropdown } from './dropdown';
import { ActivityFeed } from './feed';
import { OverviewCards } from './overview';
import { TimelineChart } from './timeline';
import {
  DATE_WINDOW_OPTIONS,
  NETWORK_FILTER_OPTIONS,
  SOURCE_OPTIONS,
  classifyNetwork,
  enrichEarnEvent,
  mergeWorkflowSummary,
  type BlockId,
  type DateWindow,
  type EarnDashboardProps,
  type EarnNetworkFilter,
  type EnrichedEarnEvent,
  type NormalizedWorkflowRow,
  type OverviewStats,
  type PocketId,
  type RevenueSourceFilter,
  type TimeSeriesBucket,
} from './utils';
import { WorkflowsBlock } from './workflows';

export * from './utils';
export * from './dropdown';
export * from './overview';
export * from './timeline';
export * from './workflows';
export * from './tasks';
export * from './feed';

function windowHours(win: DateWindow): number {
  if (win === '24h') return 24;
  if (win === '7d') return 24 * 7;
  if (win === '30d') return 24 * 30;
  return 24 * 180;
}

export function Earn({
  workflows = [],
  onSelectWorkflow,
  hideControlRail = false,
}: EarnDashboardProps) {
  const { user, openAuthModal } = useAuth();
  const { containerRef, focused: focusedBlock, toggleFocus } = useFocus<BlockId>();
  const [pocket, setPocket] = useState<PocketId>('overview');
  const [dateWindow, setDateWindow] = useState<DateWindow>('30d');
  const [networkFilter, setNetworkFilter] = useState<EarnNetworkFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<RevenueSourceFilter>('all');

  const [payload, setPayload] = useState<CreatorEarnPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const fetchEarnData = useCallback(
    async (background = false) => {
      if (!user?.userAddress || !authenticated()) {
        setPayload(null);
        return;
      }
      if (background) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const now = Date.now();
        const fromIso = new Date(now - windowHours(dateWindow) * 3_600_000).toISOString();
        const toIso = new Date(now).toISOString();
        const data = await api.earnAnalytics({
          from: fromIso,
          to: toIso,
          limit: 500,
        });
        setPayload(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load creator earnings.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user?.userAddress, dateWindow],
  );

  useEffect(() => {
    void fetchEarnData(Boolean(payload));
  }, [fetchEarnData]);

  const creatorListings = useMemo(() => {
    if (!user?.userAddress) return [];
    const addr = user.userAddress.toLowerCase();
    return workflows.filter((w) => (w.userAddress ?? '').toLowerCase() === addr);
  }, [workflows, user?.userAddress]);

  const baseWorkflowRows = useMemo<NormalizedWorkflowRow[]>(() => {
    const listingById = new Map(creatorListings.map((w) => [w.id, w]));
    const summaryById = new Map((payload?.workflows ?? []).map((s) => [s.workflowId, s]));
    const allIds = new Set<string>([...listingById.keys(), ...summaryById.keys()]);

    const dominantNetByWf = new Map<string, string>();
    for (const ev of payload?.events ?? []) {
      if (!dominantNetByWf.has(ev.workflowId) && ev.network) {
        dominantNetByWf.set(ev.workflowId, ev.network);
      }
    }

    const out: NormalizedWorkflowRow[] = [];
    for (const id of allIds) {
      const merged = mergeWorkflowSummary(summaryById.get(id), listingById.get(id));
      if (!merged) continue;
      const netMeta = classifyNetwork(dominantNetByWf.get(id) ?? 'near:mainnet');
      out.push({
        ...merged,
        networkFamily: netMeta.family,
        networkLabel: netMeta.label,
        logoUrl: netMeta.logoUrl,
      });
    }
    return out;
  }, [creatorListings, payload]);

  const allEvents = useMemo<EnrichedEarnEvent[]>(() => {
    const wfById = new Map(baseWorkflowRows.map((w) => [w.workflowId, w]));
    return (payload?.events ?? []).map((ev) => enrichEarnEvent(ev, wfById));
  }, [payload?.events, baseWorkflowRows]);

  const windowCutoffMs = useMemo(
    () => Date.now() - windowHours(dateWindow) * 3_600_000,
    [dateWindow, payload],
  );

  const filteredEvents = useMemo<EnrichedEarnEvent[]>(() => {
    return allEvents.filter((ev) => {
      if (networkFilter !== 'all' && ev.networkFamily !== networkFilter) return false;
      if (sourceFilter === 'paid' && ev.kind !== 'paid') return false;
      if (sourceFilter === 'free' && ev.kind !== 'free') return false;
      if (ev.timestamp < windowCutoffMs) return false;
      return true;
    });
  }, [allEvents, networkFilter, sourceFilter, windowCutoffMs]);

  const normalizedWorkflows = useMemo<NormalizedWorkflowRow[]>(() => {
    if (networkFilter === 'all' && sourceFilter === 'all') {
      return baseWorkflowRows;
    }
    const aggByWf = new Map<
      string,
      {
        runs: number;
        paidRuns: number;
        succeededRuns: number;
        failedRuns: number;
        profitUsd: number;
        grossUsd: number;
        totalDurationMs: number;
        lastRunAt: number;
        network: string;
      }
    >();
    for (const ev of filteredEvents) {
      const cur = aggByWf.get(ev.workflowId) ?? {
        runs: 0,
        paidRuns: 0,
        succeededRuns: 0,
        failedRuns: 0,
        profitUsd: 0,
        grossUsd: 0,
        totalDurationMs: 0,
        lastRunAt: 0,
        network: ev.network,
      };
      cur.runs += 1;
      if (ev.kind === 'paid') cur.paidRuns += 1;
      const s = ev.status.toLowerCase();
      if (s === 'completed' || s === 'succeeded' || s === 'settled') cur.succeededRuns += 1;
      else cur.failedRuns += 1;
      cur.profitUsd = Number((cur.profitUsd + ev.royaltiesUsd).toFixed(6));
      cur.grossUsd = Number((cur.grossUsd + ev.totalChargedUsd).toFixed(6));
      cur.totalDurationMs += ev.durationMs;
      if (ev.timestamp > cur.lastRunAt) cur.lastRunAt = ev.timestamp;
      aggByWf.set(ev.workflowId, cur);
    }

    return baseWorkflowRows
      .map((row) => {
        const agg = aggByWf.get(row.workflowId);
        if (!agg) {
          return networkFilter === 'all' || networkFilter === 'near'
            ? {
                ...row,
                runs: 0,
                paidRuns: 0,
                succeededRuns: 0,
                failedRuns: 0,
                profitUsd: 0,
                grossUsd: 0,
                composeCostUsd: 0,
                avgDurationMs: 0,
                totalDurationMs: 0,
              }
            : null;
        }
        const netMeta = classifyNetwork(agg.network);
        return {
          ...row,
          networkFamily: netMeta.family,
          networkLabel: netMeta.label,
          logoUrl: netMeta.logoUrl,
          runs: agg.runs,
          paidRuns: agg.paidRuns,
          succeededRuns: agg.succeededRuns,
          failedRuns: agg.failedRuns,
          profitUsd: agg.profitUsd,
          grossUsd: agg.grossUsd,
          composeCostUsd: Math.max(0, Number((agg.grossUsd - agg.profitUsd).toFixed(6))),
          totalDurationMs: agg.totalDurationMs,
          avgDurationMs: agg.runs > 0 ? Math.round(agg.totalDurationMs / agg.runs) : 0,
          successPct: agg.runs > 0 ? Number(((agg.succeededRuns / agg.runs) * 100).toFixed(1)) : 100,
          lastRunAt: agg.lastRunAt || row.lastRunAt,
        };
      })
      .filter((item): item is NormalizedWorkflowRow => item !== null);
  }, [baseWorkflowRows, filteredEvents, networkFilter, sourceFilter]);

  const topRunsWorkflows = useMemo(
    () =>
      [...normalizedWorkflows]
        .sort((a, b) => b.runs - a.runs || b.profitUsd - a.profitUsd)
        .slice(0, 3),
    [normalizedWorkflows],
  );

  const topRuntimeWorkflows = useMemo(
    () =>
      [...normalizedWorkflows]
        .sort((a, b) => b.totalDurationMs - a.totalDurationMs || b.runs - a.runs)
        .slice(0, 3),
    [normalizedWorkflows],
  );

  const timeSeriesData = useMemo<TimeSeriesBucket[]>(() => {
    const now = Date.now();
    const bucketCount =
      dateWindow === '24h' ? 12 : dateWindow === '7d' ? 7 : dateWindow === '30d' ? 15 : 12;
    const totalWindowMs = Math.max(3_600_000, now - windowCutoffMs);
    const stepMs = Math.max(1, Math.floor(totalWindowMs / bucketCount));

    const runTopIds = topRunsWorkflows.map((w) => w.workflowId);
    const timeTopIds = topRuntimeWorkflows.map((w) => w.workflowId);

    const buckets = Array.from({ length: bucketCount }, (_, idx) => {
      const startMs = windowCutoffMs + idx * stepMs;
      const endMs = idx === bucketCount - 1 ? now + 1000 : startMs + stepMs;
      const d = new Date(startMs);
      const label =
        dateWindow === '24h'
          ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return {
        index: idx,
        startMs,
        endMs,
        bucketKey: String(startMs),
        label,
        royaltiesUsd: 0,
        composeCostUsd: 0,
        totalUsd: 0,
        runs: 0,
        runTop0: 0,
        runTop1: 0,
        runTop2: 0,
        runOthers: 0,
        runtimeMs: 0,
        timeTop0: 0,
        timeTop1: 0,
        timeTop2: 0,
        timeOthers: 0,
        succeededCount: 0,
        totalCount: 0,
        successPct: 0,
        avgSuccessPct: 0,
      };
    });

    for (const ev of filteredEvents) {
      const clampedTs = Math.max(windowCutoffMs, Math.min(now, ev.timestamp || now));
      const bIdx = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((clampedTs - windowCutoffMs) / stepMs)),
      );
      const b = buckets[bIdx];
      b.royaltiesUsd = Number((b.royaltiesUsd + ev.royaltiesUsd).toFixed(6));
      b.composeCostUsd = Number((b.composeCostUsd + ev.composeBillUsd).toFixed(6));
      b.totalUsd = Number((b.totalUsd + ev.totalChargedUsd).toFixed(6));
      b.runs += 1;

      const rIdx = runTopIds.indexOf(ev.workflowId);
      if (rIdx === 0) b.runTop0 += 1;
      else if (rIdx === 1) b.runTop1 += 1;
      else if (rIdx === 2) b.runTop2 += 1;
      else b.runOthers += 1;

      const dur = Math.max(0, Math.round(ev.durationMs || 0));
      if (dur > 0) {
        b.runtimeMs += dur;
        const tIdx = timeTopIds.indexOf(ev.workflowId);
        if (tIdx === 0) b.timeTop0 += dur;
        else if (tIdx === 1) b.timeTop1 += dur;
        else if (tIdx === 2) b.timeTop2 += dur;
        else b.timeOthers += dur;
      }

      b.totalCount += 1;
      const status = ev.status.toLowerCase();
      if (status === 'completed' || status === 'succeeded' || status === 'settled') {
        b.succeededCount += 1;
      }
    }

    const activeBuckets = buckets.filter((b) => b.totalCount > 0);
    const overallAvgSuccess =
      activeBuckets.length > 0
        ? Number(
            (
              activeBuckets.reduce(
                (acc, b) => acc + (b.succeededCount / b.totalCount) * 100,
                0,
              ) / activeBuckets.length
            ).toFixed(1),
          )
        : 0;

    return buckets.map((b) => ({
      ...b,
      successPct:
        b.totalCount > 0
          ? Number(((b.succeededCount / b.totalCount) * 100).toFixed(1))
          : overallAvgSuccess,
      avgSuccessPct: overallAvgSuccess,
    }));
  }, [
    dateWindow,
    windowCutoffMs,
    topRunsWorkflows,
    topRuntimeWorkflows,
    filteredEvents,
  ]);

  const overviewStats = useMemo<OverviewStats>(() => {
    const totalProfitUsd = normalizedWorkflows.reduce((acc, w) => acc + w.profitUsd, 0);
    const totalGrossUsd = normalizedWorkflows.reduce((acc, w) => acc + w.grossUsd, 0);
    const totalRuns = normalizedWorkflows.reduce((acc, w) => acc + w.runs, 0);
    const paidRuns = normalizedWorkflows.reduce((acc, w) => acc + w.paidRuns, 0);
    const totalSucceeded = normalizedWorkflows.reduce((acc, w) => acc + w.succeededRuns, 0);
    const totalRuntimeMs = normalizedWorkflows.reduce((acc, w) => acc + w.totalDurationMs, 0);
    const avgRuntimeMs = totalRuns > 0 ? Math.round(totalRuntimeMs / totalRuns) : 0;
    const avgSuccessPct =
      totalRuns > 0 ? Number(((totalSucceeded / totalRuns) * 100).toFixed(1)) : 0;
    const activeWfs = normalizedWorkflows.filter((w) => w.runs > 0);
    const peakSuccessPct =
      activeWfs.length > 0
        ? Number(Math.max(...activeWfs.map((w) => w.successPct)).toFixed(1))
        : 0;
    const publishedWfs = normalizedWorkflows.filter((w) => w.published);
    const avgCreatorFeePct =
      publishedWfs.length > 0
        ? Number(
            (
              publishedWfs.reduce((acc, w) => acc + w.creatorFeePct, 0) / publishedWfs.length
            ).toFixed(1),
          )
        : 0;

    return {
      totalProfitUsd,
      totalGrossUsd,
      totalRuns,
      paidRuns,
      totalRuntimeMs,
      avgRuntimeMs,
      avgSuccessPct,
      peakSuccessPct,
      publishedWorkflows: publishedWfs.length,
      totalWorkflows: normalizedWorkflows.length,
      avgCreatorFeePct,
      profitSparkline: timeSeriesData.map((d) => d.royaltiesUsd),
    };
  }, [normalizedWorkflows, timeSeriesData]);

  const controlRail = !hideControlRail ? (
    <header className="cm-dashboard-control-rail">
      <div className="cm-dashboard-control-rail__brand">
        <span className="cm-dashboard-control-rail__title">
          <span className="cm-dashboard-control-rail__slash">//</span>
          EARN
        </span>
        {(isRefreshing || isLoading) && (
          <span className="cm-dashboard__updating">UPDATING…</span>
        )}
      </div>

      <div className="cm-dashboard-control-rail__actions">
        <BlockDropdown
          variant="header"
          value={networkFilter}
          options={NETWORK_FILTER_OPTIONS}
          onChange={setNetworkFilter}
          ariaLabel="Filter by Network"
          align="end"
        />

        <BlockDropdown
          variant="header"
          value={sourceFilter}
          options={SOURCE_OPTIONS}
          onChange={setSourceFilter}
          ariaLabel="Filter by Run Type"
          align="end"
        />

        <BlockDropdown
          variant="header"
          value={dateWindow}
          options={DATE_WINDOW_OPTIONS}
          onChange={setDateWindow}
          ariaLabel="Select Date Range"
          align="end"
        />

        <Tooltip title="Sync Revenue" description="Refresh creator royalties & execution telemetry">
          <button
            type="button"
            className="cm-control-icon-button"
            onClick={() => void fetchEarnData(true)}
            disabled={!user || isRefreshing || isLoading}
            aria-label="Refresh creator revenue"
          >
            <RefreshCw size={13} className={isRefreshing || isLoading ? 'spin-icon' : ''} />
          </button>
        </Tooltip>
      </div>
    </header>
  ) : null;

  if (!user) {
    return (
      <div className="cm-dashboard" data-pocket={pocket}>
        {controlRail}
        <div className="cm-dashboard__empty">
          <Wallet className="cm-dashboard__empty-icon" />
          <span className="cm-dashboard__empty-title">Sign in to view creator royalties</span>
          <span className="cm-dashboard__empty-text">
            Connect your account to track published workflow runs, runtime, and x402 payouts.
          </span>
          <button type="button" className="cm-feed-more" onClick={openAuthModal}>
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="cm-dashboard"
      data-focus={focusedBlock ?? undefined}
      data-pocket={pocket}
      data-rail={hideControlRail ? 'hidden' : undefined}
    >
      {controlRail}

      <nav className="cm-pocket-bar cm-pocket-bar--dashboard" aria-label="Earn dashboard view">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'models', label: 'Workflows' },
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

      {error && (
        <div className="cm-dashboard__alert">{error}</div>
      )}

      <OverviewCards stats={overviewStats} />

      <TimelineChart
        timeSeriesData={timeSeriesData}
        topRunsWorkflows={topRunsWorkflows}
        topRuntimeWorkflows={topRuntimeWorkflows}
        totalWorkflowsCount={normalizedWorkflows.length}
        overviewStats={overviewStats}
        isMobile={isMobile}
        focused={focusedBlock === 'chart'}
        onToggleFocus={() => toggleFocus('chart')}
      />

      <WorkflowsBlock
        workflows={normalizedWorkflows}
        focused={focusedBlock === 'models'}
        isMobile={isMobile}
        onToggleFocus={() => toggleFocus('models')}
        onSelectWorkflow={onSelectWorkflow}
      />

      <ActivityFeed
        events={filteredEvents}
        focused={focusedBlock === 'feed'}
        isMobile={isMobile}
        onToggleFocus={() => toggleFocus('feed')}
      />
    </div>
  );
}

export const EarnDashboard = Earn;
export default Earn;
