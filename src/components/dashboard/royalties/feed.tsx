import { useMemo, useState } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { CheckCircle2, ExternalLink, Layers, Play, Radio, XCircle } from 'lucide-react';
import { shortHash } from '../../../lib/contracts';
import { getIpfsGatewayUrl } from '../../../lib/pinata';
import { Tooltip } from '../../tooltip';
import { BlockDropdown } from './dropdown';
import { TaskBadges } from './tasks';
import {
  DEFAULT_AG_COL_DEF,
  FEED_VIEW_OPTIONS,
  formatMs,
  formatUsd,
  getFeedRowId,
  shortTx,
  timeAgo,
  type EnrichedEarnEvent,
  type FeedView,
  type RunsFilter,
  type SettlementsFilter,
} from './utils';

export interface ActivityFeedProps {
  events: EnrichedEarnEvent[];
  focused: boolean;
  isMobile: boolean;
  onToggleFocus: () => void;
}

function isRunSucceeded(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'completed' || s === 'succeeded' || s === 'settled';
}

export function ActivityFeed({
  events,
  focused,
  isMobile,
  onToggleFocus,
}: ActivityFeedProps) {
  const [feedView, setFeedView] = useState<FeedView>('runs');
  const [runsFilter, setRunsFilter] = useState<RunsFilter>('all');
  const [settlementsFilter, setSettlementsFilter] = useState<SettlementsFilter>('all');

  const filteredRunEvents = useMemo(() => {
    if (runsFilter === 'all') return events;
    if (runsFilter === 'succeeded') return events.filter((e) => isRunSucceeded(e.status));
    return events.filter((e) => !isRunSucceeded(e.status));
  }, [events, runsFilter]);

  const settlementEvents = useMemo(() => {
    const withSettlement = events.filter((e) => e.royaltiesUsd > 0);
    if (settlementsFilter === 'settled') {
      return withSettlement.filter((e) => Boolean(e.txHash) || isRunSucceeded(e.status));
    }
    return withSettlement;
  }, [events, settlementsFilter]);

  const feedRows = feedView === 'runs' ? filteredRunEvents : settlementEvents;

  const succeededRunsCount = useMemo(
    () => events.filter((e) => isRunSucceeded(e.status)).length,
    [events],
  );
  const failedRunsCount = useMemo(
    () => events.filter((e) => !isRunSucceeded(e.status)).length,
    [events],
  );
  const paidRunsCount = useMemo(
    () => events.filter((e) => e.royaltiesUsd > 0).length,
    [events],
  );
  const totalSettledUsd = useMemo(
    () => settlementEvents.reduce((acc, e) => acc + e.royaltiesUsd, 0),
    [settlementEvents],
  );

  const feedColumnDefs = useMemo<ColDef<EnrichedEarnEvent>[]>(
    () => [
      {
        headerName: 'Activity',
        field: 'id',
        flex: 1,
        cellRenderer: (params: ICellRendererParams<EnrichedEarnEvent>) => {
          const ev = params.data;
          if (!ev) return null;
          const ok = isRunSucceeded(ev.status);

          if (feedView === 'runs') {
            return (
              <div className="cm-receipt-item">
                <div className="cm-receipt-item__top">
                  <Tooltip
                    title={ev.workflowTitle}
                    description={`Tasks: ${ev.taskLabel} · Runner: ${ev.runnerAddress ? shortHash(ev.runnerAddress) : '—'} · ${ev.networkLabel}`}
                    position="top"
                  >
                    <span className="cm-receipt-item__song">
                      <span
                        className="cm-feed-summary__dot"
                        data-tone={ok ? 'emerald' : 'danger'}
                      />
                      {ev.workflowTitle}
                    </span>
                  </Tooltip>
                  <span
                    className="cm-receipt-item__amount"
                    data-tone={ev.royaltiesUsd > 0 ? 'emerald' : 'neutral'}
                  >
                    {ev.royaltiesUsd > 0 ? formatUsd(ev.royaltiesUsd) : formatMs(ev.durationMs)}
                  </span>
                </div>
                <div className="cm-receipt-item__bottom">
                  <span className="cm-receipt-item__meta">
                    <TaskBadges tasks={ev.allTasks} isMobile={isMobile} />
                    {!isMobile && ev.runnerAddress && <span>{shortHash(ev.runnerAddress)}</span>}
                    <img src={ev.logoUrl} alt="" className="cm-network-filter__logo" />
                    {!isMobile && <span>{ev.networkLabel.split(' ')[0]}</span>}
                  </span>
                  <span className="cm-receipt-item__meta">{timeAgo(ev.timestamp)}</span>
                </div>
                <div className="cm-receipt-detail">
                  <div className="cm-receipt-detail__row">
                    <span>Duration / Steps</span>
                    <strong>
                      {formatMs(ev.durationMs)} · {ev.stepsCount} step{ev.stepsCount === 1 ? '' : 's'}
                    </strong>
                  </div>
                  <div className="cm-receipt-detail__row">
                    <span>Creator Royalty</span>
                    <strong>{formatUsd(ev.royaltiesUsd)}</strong>
                  </div>
                  {ev.proofCid && (
                    <div className="cm-receipt-detail__row">
                      <span>Execution Proof</span>
                      <a
                        href={getIpfsGatewayUrl(ev.proofCid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cm-receipt-tx"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>{shortTx(ev.proofCid)}</span>
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div className="cm-receipt-item">
              <div className="cm-receipt-item__top">
                <Tooltip
                  title={ev.workflowTitle}
                  description={`Royalty settlement · Runner: ${ev.runnerAddress ? shortHash(ev.runnerAddress) : '—'} · ${ev.networkLabel}`}
                  position="top"
                >
                  <span className="cm-receipt-item__song">
                    <span className="cm-settlement-badge" data-tone="emerald">
                      <CheckCircle2 size={10} />
                      Settled
                    </span>
                    <span>{ev.workflowTitle}</span>
                  </span>
                </Tooltip>
                <span className="cm-receipt-item__amount" data-tone="emerald">
                  {formatUsd(ev.royaltiesUsd)}
                </span>
              </div>
              <div className="cm-receipt-item__bottom">
                <span className="cm-receipt-item__meta">
                  <img src={ev.logoUrl} alt="" className="cm-network-filter__logo" />
                  {!isMobile && <span>{ev.networkLabel}</span>}
                  {ev.txHash && ev.explorerUrl ? (
                    <a
                      href={ev.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cm-receipt-tx"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{shortTx(ev.txHash)}</span>
                      <ExternalLink size={10} />
                    </a>
                  ) : ev.txHash ? (
                    <span>{shortTx(ev.txHash)}</span>
                  ) : null}
                </span>
                <span className="cm-receipt-item__meta">{timeAgo(ev.timestamp)}</span>
              </div>
              <div className="cm-receipt-detail">
                <div className="cm-receipt-detail__row">
                  <span>Creator Royalty</span>
                  <strong>{formatUsd(ev.royaltiesUsd)}</strong>
                </div>
                <div className="cm-receipt-detail__row">
                  <span>Inference Bill</span>
                  <strong>{formatUsd(ev.composeBillUsd)}</strong>
                </div>
                <div className="cm-receipt-detail__row">
                  <span>Gross Charged</span>
                  <strong>{formatUsd(ev.totalChargedUsd)}</strong>
                </div>
              </div>
            </div>
          );
        },
      },
    ],
    [feedView, isMobile],
  );

  return (
    <section
      className="cm-block"
      data-block="feed"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        <BlockDropdown
          value={feedView}
          options={
            isMobile
              ? [
                  {
                    value: 'runs',
                    label: `RUNS (${events.length})`,
                    icon: Radio,
                    tooltip: 'Chronological workflow execution feed',
                  },
                  {
                    value: 'settlements',
                    label: `SETTLEMENTS (${settlementEvents.length})`,
                    icon: Layers,
                    tooltip: 'Verified on-chain creator royalty settlements',
                  },
                ]
              : FEED_VIEW_OPTIONS
          }
          onChange={setFeedView}
          ariaLabel="Activity feed view"
        />

        <div className="cm-block__header-side" onClick={(e) => e.stopPropagation()}>
          {feedView === 'runs' ? (
            <BlockDropdown
              value={runsFilter}
              options={[
                {
                  value: 'all',
                  label: 'ALL',
                  count: events.length,
                  icon: Layers,
                  tooltip: 'All workflow executions',
                },
                {
                  value: 'succeeded',
                  label: 'SUCCEEDED',
                  count: succeededRunsCount,
                  icon: Play,
                  tooltip: 'Completed workflow runs',
                },
                {
                  value: 'failed',
                  label: 'FAILED',
                  count: failedRunsCount,
                  icon: XCircle,
                  tooltip: 'Failed or aborted workflow runs',
                },
              ]}
              onChange={setRunsFilter}
              ariaLabel="Filter runs"
              align="end"
            />
          ) : (
            <BlockDropdown
              value={settlementsFilter}
              options={[
                {
                  value: 'all',
                  label: 'ALL',
                  count: settlementEvents.length,
                  icon: Layers,
                  tooltip: 'All royalty settlements',
                },
                {
                  value: 'settled',
                  label: 'SETTLED',
                  count: settlementEvents.length,
                  icon: CheckCircle2,
                  tooltip: 'Settled on-chain royalty payouts',
                },
              ]}
              onChange={setSettlementsFilter}
              ariaLabel="Filter settlements"
              align="end"
            />
          )}
        </div>
      </header>

      <div className="cm-block__body">
        <div className="cm-feed-summary">
          {feedView === 'runs' ? (
            <>
              <span className="cm-feed-summary__item">
                <span className="cm-feed-summary__dot" data-tone="emerald" />
                {succeededRunsCount} SUCCEEDED
              </span>
              {paidRunsCount > 0 && (
                <span className="cm-feed-summary__item">
                  <span className="cm-feed-summary__dot" data-tone="violet" />
                  {paidRunsCount} PAID
                </span>
              )}
              {failedRunsCount > 0 && (
                <span className="cm-feed-summary__item">
                  <span className="cm-feed-summary__dot" data-tone="danger" />
                  {failedRunsCount} FAILED
                </span>
              )}
            </>
          ) : (
            <>
              <span className="cm-feed-summary__item">
                <span className="cm-feed-summary__dot" data-tone="emerald" />
                {settlementEvents.length} SETTLED
              </span>
              <span className="cm-feed-summary__item cm-feed-summary__total">
                {formatUsd(totalSettledUsd)}
              </span>
            </>
          )}
        </div>

        {feedRows.length === 0 ? (
          <div className="cm-block__empty">
            {feedView === 'runs' ? 'NO RUNS IN WINDOW' : 'NO SETTLEMENTS IN WINDOW'}
          </div>
        ) : (
          <div
            className="cm-ag-grid-wrap cm-ag-feed"
            onClick={(e) => {
              if (focused) e.stopPropagation();
            }}
          >
            <AgGridReact
              rowData={feedRows}
              columnDefs={feedColumnDefs}
              getRowId={getFeedRowId}
              suppressScrollOnNewData
              defaultColDef={DEFAULT_AG_COL_DEF}
              headerHeight={0}
              rowHeight={focused ? (isMobile ? 108 : 112) : isMobile ? 58 : 60}
              suppressCellFocus
              animateRows
            />
          </div>
        )}
      </div>
    </section>
  );
}
