import { useMemo } from 'react';
import { Activity, Coins, DollarSign } from 'lucide-react';
import {
  formatModelTypeLabel,
  formatMs,
  formatPct,
  formatTokens,
  formatUsd,
  numberLabel,
  primaryModalityKey,
  type TypeEntry,
} from '../../../lib/analytics';
import { Tooltip } from '../../tooltip';
import type { SpentDropdownOption } from './dropdown';

export type ModalityMetric = 'usd' | 'calls' | 'tokens';

export const MODALITY_METRIC_OPTIONS: SpentDropdownOption<ModalityMetric>[] = [
  { value: 'usd', label: 'SPEND', icon: DollarSign, tooltip: 'Share of spend by model modality' },
  { value: 'calls', label: 'CALLS', icon: Activity, tooltip: 'Share of requests by model modality' },
  { value: 'tokens', label: 'TOKENS', icon: Coins, tooltip: 'Share of tokens by model modality' },
];

function metricValue(entry: TypeEntry, metric: ModalityMetric): number {
  if (metric === 'usd') return entry.usd;
  if (metric === 'calls') return entry.calls;
  return entry.tokens;
}

function metricLabel(value: number, metric: ModalityMetric): string {
  if (metric === 'usd') return formatUsd(value);
  if (metric === 'calls') return numberLabel(value);
  return formatTokens(value);
}

export function ModalityBreakdown({
  modalityBreakdown,
  metric,
  focused = false,
}: {
  modalityBreakdown: TypeEntry[];
  metric: ModalityMetric;
  focused?: boolean;
}) {
  const data = useMemo(() => {
    const total = modalityBreakdown.reduce((sum, entry) => sum + metricValue(entry, metric), 0);
    let offset = 0;
    const entries = modalityBreakdown.map((entry) => {
      const value = metricValue(entry, metric);
      const pct =
        total > 0 ? (value / total) * 100 : 100 / Math.max(1, modalityBreakdown.length);
      const start = offset;
      offset += pct;
      const modalityKey = primaryModalityKey(entry.key);
      return { entry, value, pct, start, modalityKey };
    });
    return { entries, total };
  }, [modalityBreakdown, metric]);

  if (data.entries.length === 0) {
    return <div className="cm-block__empty">No modality telemetry in this range</div>;
  }

  return (
    <div
      className="cm-modality-stack"
      onClick={(e) => {
        if (focused) e.stopPropagation();
      }}
    >
      <div className="cm-modality-bar" role="img" aria-label="Spend breakdown by modality">
        <svg className="cm-modality-bar__svg" width="100%" height="100%">
          {data.entries.map(({ entry, value, pct, start, modalityKey }) => (
            <g key={entry.key}>
              <title>
                {`${formatModelTypeLabel(entry.key)}: ${metricLabel(value, metric)} (${pct.toFixed(0)}%)`}
              </title>
              <rect
                x={`${start.toFixed(3)}%`}
                y="0"
                width={`${Math.max(pct, 0.5).toFixed(3)}%`}
                height="100%"
                data-modality={modalityKey}
                className="cm-modality-bar__rect"
              />
              {pct >= 12 && (
                <text
                  x={`${(start + pct / 2).toFixed(3)}%`}
                  y="52%"
                  dominantBaseline="central"
                  textAnchor="middle"
                  className="cm-modality-bar__svg-label"
                >
                  {`${pct.toFixed(0)}%`}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="cm-modality-legend">
        {data.entries.map(({ entry, value, pct, modalityKey }) => (
          <Tooltip
            key={entry.key}
            title={formatModelTypeLabel(entry.key)}
            description={`${metricLabel(value, metric)} · ${numberLabel(entry.calls)} calls (${pct.toFixed(1)}%)`}
            position="top"
          >
            <span className="cm-modality-legend__item">
              <span className="cm-modality-legend__dot" data-modality={modalityKey} />
              <span>{formatModelTypeLabel(entry.key)}</span>
              <span className="cm-modality-legend__metric">{metricLabel(value, metric)}</span>
              <span className="cm-modality-legend__pct">({pct.toFixed(0)}%)</span>
            </span>
          </Tooltip>
        ))}
      </div>

      <div className="cm-modality-detail">
        {data.entries.map(({ entry, value, modalityKey }) => (
          <div key={entry.key} className="cm-modality-detail__row">
            <span className="cm-modality-detail__name">
              <span className="cm-modality-legend__dot" data-modality={modalityKey} />
              {formatModelTypeLabel(entry.key)}
            </span>
            <span className="cm-modality-detail__stats">
              <span data-tone="primary">{metricLabel(value, metric)}</span>
              <span>{numberLabel(entry.calls)} calls</span>
              {entry.tokens > 0 && <span>{formatTokens(entry.tokens)} tok</span>}
              {entry.avgLatencyMs !== null && <span>avg {formatMs(entry.avgLatencyMs)}</span>}
              {entry.successRate !== null && (
                <span data-tone={entry.successRate >= 0.95 ? 'emerald' : 'danger'}>
                  {formatPct(entry.successRate, 0)} ok
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
