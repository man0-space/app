import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  Play,
  Radio,
  XCircle,
  Zap,
} from 'lucide-react';
import type { FacilitatorChain } from '@compose-market/sdk/chains';
import {
  formatModelTypeLabel,
  formatMs,
  formatTokens,
  formatUsd,
  formatWeiUsd,
  networkLogoForChain,
  primaryModalityKey,
  resolveExplorerTxUrl,
  settlementTone,
  shortTx,
  timeAgo,
  type FeedItem,
  type RequestRow,
} from '../../../lib/analytics';
import { Tooltip } from '../../tooltip';
import { BlockDropdown, type SpentDropdownOption } from './dropdown';

export type ActivityTab = 'requests' | 'settlements';
type RequestFilter = 'all' | 'succeeded' | 'failed' | 'streamed';
type SettlementFilter = 'all' | 'settled' | 'submitted' | 'queued' | 'failed';

const VIEW_OPTIONS: SpentDropdownOption<ActivityTab>[] = [
  { value: 'requests', label: 'REQUESTS', icon: Radio, tooltip: 'Chronological inference request telemetry' },
  { value: 'settlements', label: 'SETTLEMENTS', icon: Layers, tooltip: 'On-chain x402 & session settlement receipts' },
];

function requestTone(status: RequestRow['status']): 'emerald' | 'danger' | 'amber' {
  if (status === 'succeeded') return 'emerald';
  if (status === 'failed') return 'danger';
  return 'amber';
}

function RequestsList({
  requests,
  filter,
  focused,
}: {
  requests: RequestRow[];
  filter: RequestFilter;
  focused: boolean;
}) {
  const visible = useMemo(() => {
    const filtered = requests.filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'streamed') return row.streamed;
      if (filter === 'failed') return row.status === 'failed' || row.status === 'aborted';
      return row.status === 'succeeded';
    });
    return focused ? filtered : filtered.slice(0, 6);
  }, [requests, filter, focused]);

  if (visible.length === 0) {
    return <div className="cm-block__empty">No requests match this filter</div>;
  }

  return (
    <div
      className="cm-feed-list"
      onClick={(e) => {
        if (focused) e.stopPropagation();
      }}
    >
      {visible.map((row) => (
        <div key={row.id} className="cm-receipt-item" data-status={row.status}>
          <div className="cm-receipt-item__top">
            <Tooltip
              title={row.model}
              description={`${row.family} · ${row.operation} · ${formatUsd(row.costUsd)}`}
              position="top"
            >
              <span className="cm-receipt-item__model">
                <span className="cm-feed-summary__dot" data-tone={requestTone(row.status)} />
                {row.model}
              </span>
            </Tooltip>
            <span className="cm-receipt-item__meta">
              {(row.latencyMs > 0 || row.ttftMs === null) && (
                <span className="cm-settlement-badge" data-tone="violet">
                  {formatMs(row.latencyMs)}
                </span>
              )}
              {row.ttftMs !== null && (
                <span className="cm-settlement-badge" data-tone="emerald">
                  TTFT {formatMs(row.ttftMs)}
                </span>
              )}
              {row.streamed && (
                <Tooltip title="Streamed" description="Server-sent token stream">
                  <span className="cm-receipt-item__streamed">
                    <Zap size={11} />
                  </span>
                </Tooltip>
              )}
            </span>
          </div>
          <div className="cm-receipt-item__bottom">
            <span className="cm-receipt-item__meta">
              <span>{timeAgo(row.startedAt)}</span>
              {row.type && (
                <span className="cm-usage-modality" data-tone={primaryModalityKey(row.type)}>
                  {formatModelTypeLabel(row.type)}
                </span>
              )}
              <span>{row.family}</span>
            </span>
            <span className="cm-settlement-badge" data-tone={requestTone(row.status)}>
              {row.status}
            </span>
          </div>
          {row.error && (
            <Tooltip title="Request Error" description={row.error}>
              <div className="cm-receipt-item__error">{row.error}</div>
            </Tooltip>
          )}
          {focused && (
            <div className="cm-receipt-detail">
              <div className="cm-receipt-detail__row">
                <span>Tokens in → out</span>
                <strong>
                  {formatTokens(row.tokensIn)} → {formatTokens(row.tokensOut)}
                </strong>
              </div>
              <div className="cm-receipt-detail__row">
                <span>Operation</span>
                <strong>{row.operation}</strong>
              </div>
              <div className="cm-receipt-detail__row">
                <span>Settled cost</span>
                <strong>{formatUsd(row.costUsd)}</strong>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
