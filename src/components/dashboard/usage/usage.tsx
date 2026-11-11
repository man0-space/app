import { useMemo } from 'react';
import {
  AllCommunityModule as ChartsCommunityModule,
  ModuleRegistry as ChartsModuleRegistry,
  type AgChartOptions,
} from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import {
  atomicToUsd,
  formatMs,
  formatPct,
  formatTokens,
  formatUsd,
  numberLabel,
  tickTime,
  tooltipTime,
  type AnalyticsInterval,
  type TimelineBucket,
} from '../../../lib/analytics';

ChartsModuleRegistry.registerModules([ChartsCommunityModule]);

export type ChartTab = 'spend' | 'requests' | 'tokens' | 'latency';
export type SeriesTone = 'cyan' | 'fuchsia' | 'emerald' | 'red' | 'amber' | 'muted';

const SERIES_HEX: Record<SeriesTone, string> = {
  cyan: '#38bdf8',
  fuchsia: '#ff2e63',
  emerald: '#10b981',
  red: '#f43f5e',
  amber: '#f59e0b',
  muted: '#64748b',
};

interface ChartRow {
  bucketKey: string;
  label: string;
  t: number;
  end: number;
  spend: number;
  inference: number;
  fee: number;
  succeeded: number;
  failed: number;
  aborted: number;
  total: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  latencyCount: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

function positiveMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function toRows(timeline: TimelineBucket[], interval: AnalyticsInterval): ChartRow[] {
  return timeline.map((bucket) => {
    const { totals } = bucket;
    const hasLatency = totals.latency.count > 0;
    return {
      bucketKey: String(bucket.timestamp),
      label: tickTime(bucket.timestamp, interval),
      t: bucket.timestamp,
      end: bucket.endTimestamp,
      spend: atomicToUsd(totals.billing.finalAmountAtomic),
      inference: atomicToUsd(totals.billing.inferenceAmountAtomic),
      fee: atomicToUsd(totals.billing.platformFeeAtomic),
      succeeded: totals.requests.succeeded,
      failed: totals.requests.failed,
      aborted: totals.requests.aborted,
      total: totals.requests.total,
      tokensIn: totals.usage.metrics.input_tokens ?? totals.usage.metrics.text_input_tokens ?? 0,
      tokensOut: totals.usage.metrics.output_tokens ?? totals.usage.metrics.text_output_tokens ?? 0,
      tokensTotal: totals.usage.metrics.total_tokens ?? 0,
      latencyCount: totals.latency.count,
      avg: hasLatency ? positiveMs(totals.latency.averageMs) : null,
      p50: hasLatency ? positiveMs(totals.latency.p50Ms) : null,
      p95: hasLatency ? positiveMs(totals.latency.p95Ms) : null,
      p99: hasLatency ? positiveMs(totals.latency.p99Ms) : null,
    };
  });
}

function renderSpentTooltipHtml(
  heading: string,
  lines: Array<{ series: SeriesTone; label: string; value: string; strong?: boolean }>,
): string {
  const rowsHtml = lines
    .map(
      (line) => `<div class="cm-chart-tooltip__row" ${line.strong ? 'data-strong="true"' : ''}>
        <span class="cm-chart-tooltip__label">
          <span class="cm-chart-tooltip__dot" data-series="${line.series}"></span>
          ${line.label}
        </span>
        <span class="cm-chart-tooltip__value">${line.value}</span>
      </div>`,
    )
    .join('');

  return `<div class="cm-chart-tooltip">
    <div class="cm-chart-tooltip__time">${heading}</div>
    ${rowsHtml}
  </div>`;
}

export function UsageChart({
  timeline,
  interval,
  tab,
  focused = false,
}: {
  timeline: TimelineBucket[];
  interval: AnalyticsInterval;
  tab: ChartTab;
  focused?: boolean;
}) {
  const rows = useMemo(() => toRows(timeline, interval), [timeline, interval]);
  const hasTokenSplit = useMemo(
    () => rows.some((row) => row.tokensIn > 0 || row.tokensOut > 0),
    [rows],
  );

  const options = useMemo<AgChartOptions>(() => {
    const monoFont = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";
    const chartTheme = {
      baseTheme: 'ag-default-dark' as const,
      params: {
        fontFamily: monoFont,
        fontSize: 11,
      },
    };

    const baseAxes = {
      x: {
        type: 'category' as const,
        line: { enabled: false },
        tick: { enabled: false },
        gridLine: { enabled: false },
        label: {
          color: '#64748b',
          fontFamily: monoFont,
          fontSize: 11,
          rotation: 0,
          avoidCollisions: true,
          formatter: ({ value }: { value: string }) => {
            const ts = Number(value);
            return Number.isFinite(ts) ? tickTime(ts, interval) : String(value);
          },
        },
      },
      y: {
        type: 'number' as const,
        line: { enabled: false },
        tick: { enabled: false },
        gridLine: {
          enabled: true,
          style: [{ stroke: 'rgba(56, 189, 248, 0.08)', lineDash: [3, 3] }],
        },
        label: {
          color: '#64748b',
          fontFamily: monoFont,
          fontSize: 11,
          formatter: ({ value }: { value: number }) => {
            if (tab === 'spend') {
              if (value === 0) return '$0';
              return value >= 1 ? `$${numberLabel(value)}` : `$${value.toFixed(3)}`;
            }
            if (tab === 'requests') return numberLabel(Math.round(value));
            if (tab === 'tokens') return formatTokens(value);
            return formatMs(value);
          },
        },
      },
    };

    if (tab === 'spend') {
      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 16, bottom: 4, left: 6 },
        data: rows,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'area',
            xKey: 'bucketKey',
            yKey: 'spend',
            yName: 'Spend',
            stroke: SERIES_HEX.cyan,
            strokeWidth: 2,
            fill: SERIES_HEX.cyan,
            fillOpacity: 0.16,
            interpolation: { type: 'smooth' },
            marker: {
              enabled: false,
              fill: SERIES_HEX.cyan,
              stroke: '#020305',
              strokeWidth: 2,
              size: 5,
            },
            tooltip: {
              renderer: ({ datum }: { datum: ChartRow }) =>
                renderSpentTooltipHtml(tooltipTime(datum.t, datum.end, interval), [
                  { series: 'cyan', label: 'Inference', value: formatUsd(datum.inference) },
                  { series: 'fuchsia', label: 'Platform fee', value: formatUsd(datum.fee) },
                  { series: 'cyan', label: 'Total', value: formatUsd(datum.spend), strong: true },
                  { series: 'muted', label: 'Requests', value: numberLabel(datum.total) },
                ]),
            },
          },
        ],
      };
    }

    if (tab === 'requests') {
      const makeTooltip = ({ datum }: { datum: ChartRow }) => {
        const success = datum.total > 0 ? datum.succeeded / datum.total : null;
        return renderSpentTooltipHtml(tooltipTime(datum.t, datum.end, interval), [
          { series: 'emerald', label: 'Succeeded', value: numberLabel(datum.succeeded) },
          { series: 'red', label: 'Failed', value: numberLabel(datum.failed) },
          { series: 'amber', label: 'Aborted', value: numberLabel(datum.aborted) },
          { series: 'cyan', label: 'Success rate', value: formatPct(success), strong: true },
        ]);
      };

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 16, bottom: 4, left: 6 },
        data: rows,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'succeeded',
            yName: 'Succeeded',
            stacked: true,
            fill: SERIES_HEX.emerald,
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'failed',
            yName: 'Failed',
            stacked: true,
            fill: SERIES_HEX.red,
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'aborted',
            yName: 'Aborted',
            stacked: true,
            fill: SERIES_HEX.amber,
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
        ],
      };
    }

    if (tab === 'tokens') {
      if (hasTokenSplit) {
        const makeTooltip = ({ datum }: { datum: ChartRow }) =>
          renderSpentTooltipHtml(tooltipTime(datum.t, datum.end, interval), [
            { series: 'cyan', label: 'Input', value: formatTokens(datum.tokensIn) },
            { series: 'fuchsia', label: 'Output', value: formatTokens(datum.tokensOut) },
            {
              series: 'muted',
              label: 'Total',
              value: formatTokens(datum.tokensIn + datum.tokensOut),
              strong: true,
            },
          ]);

        return {
          theme: chartTheme,
          background: { fill: 'transparent' },
          padding: { top: 8, right: 16, bottom: 4, left: 6 },
          data: rows,
          legend: { enabled: false },
          axes: baseAxes,
          series: [
            {
              type: 'bar',
              xKey: 'bucketKey',
              yKey: 'tokensIn',
              yName: 'Input',
              stacked: true,
              fill: SERIES_HEX.cyan,
              strokeWidth: 0,
              cornerRadius: 2,
              tooltip: { renderer: makeTooltip },
            },
            {
              type: 'bar',
              xKey: 'bucketKey',
              yKey: 'tokensOut',
              yName: 'Output',
              stacked: true,
              fill: SERIES_HEX.fuchsia,
              strokeWidth: 0,
              cornerRadius: 2,
              tooltip: { renderer: makeTooltip },
            },
          ],
        };
      }

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 16, bottom: 4, left: 6 },
        data: rows,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'area',
            xKey: 'bucketKey',
            yKey: 'tokensTotal',
            yName: 'Tokens',
            stroke: SERIES_HEX.cyan,
            strokeWidth: 2,
            fill: SERIES_HEX.cyan,
            fillOpacity: 0.14,
            interpolation: { type: 'smooth' },
            marker: { enabled: false },
            tooltip: {
              renderer: ({ datum }: { datum: ChartRow }) =>
                renderSpentTooltipHtml(tooltipTime(datum.t, datum.end, interval), [
                  {
                    series: 'cyan',
                    label: 'Tokens',
                    value: formatTokens(datum.tokensTotal),
                    strong: true,
                  },
                ]),
            },
          },
        ],
      };
    }

    const makeLatencyTooltip = ({ datum }: { datum: ChartRow }) =>
      renderSpentTooltipHtml(tooltipTime(datum.t, datum.end, interval), [
        { series: 'cyan', label: 'P50', value: datum.p50 !== null ? formatMs(datum.p50) : '—' },
        { series: 'amber', label: 'P95', value: datum.p95 !== null ? formatMs(datum.p95) : '—' },
        { series: 'fuchsia', label: 'P99', value: datum.p99 !== null ? formatMs(datum.p99) : '—' },
        {
          series: 'muted',
          label: 'Average',
          value: datum.avg !== null ? formatMs(datum.avg) : '—',
        },
      ]);

    return {
      theme: chartTheme,
      background: { fill: 'transparent' },
      padding: { top: 8, right: 16, bottom: 4, left: 6 },
      data: rows,
      legend: { enabled: false },
      axes: baseAxes,
      series: [
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'p50',
          yName: 'P50',
          stroke: SERIES_HEX.cyan,
          strokeWidth: 2,
          connectMissingData: true,
          interpolation: { type: 'smooth' },
          marker: { enabled: false },
          tooltip: { renderer: makeLatencyTooltip },
        },
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'p95',
          yName: 'P95',
          stroke: SERIES_HEX.amber,
          strokeWidth: 1.6,
          connectMissingData: true,
          interpolation: { type: 'smooth' },
          marker: { enabled: false },
          tooltip: { renderer: makeLatencyTooltip },
        },
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'p99',
          yName: 'P99',
          stroke: SERIES_HEX.fuchsia,
          strokeWidth: 1.6,
          connectMissingData: true,
          interpolation: { type: 'smooth' },
          marker: { enabled: false },
          tooltip: { renderer: makeLatencyTooltip },
        },
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'avg',
          yName: 'Average',
          stroke: SERIES_HEX.muted,
          strokeWidth: 1.4,
          lineDash: [4, 3],
          connectMissingData: true,
          marker: { enabled: false },
          tooltip: { renderer: makeLatencyTooltip },
        },
      ],
    };
  }, [rows, interval, tab, hasTokenSplit]);

  return (
    <div className="cm-chart-frame">
      <div className="cm-chart-canvas">
        <AgCharts options={options} />
      </div>

      {focused && (tab === 'requests' || tab === 'tokens' || tab === 'latency') ? (
        <div className="cm-chart-legend" aria-hidden="true">
          {tab === 'requests' ? (
            <>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="emerald" />
                Succeeded
              </span>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="red" />
                Failed
              </span>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="amber" />
                Aborted
              </span>
            </>
          ) : tab === 'tokens' ? (
            hasTokenSplit ? (
              <>
                <span className="cm-chart-legend__item">
                  <span className="cm-chart-legend__dot" data-series="cyan" />
                  Input
                </span>
                <span className="cm-chart-legend__item">
                  <span className="cm-chart-legend__dot" data-series="fuchsia" />
                  Output
                </span>
              </>
            ) : (
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="cyan" />
                Total tokens
              </span>
            )
          ) : (
            <>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="cyan" />
                P50
              </span>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="amber" />
                P95
              </span>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="fuchsia" />
                P99
              </span>
              <span className="cm-chart-legend__item">
                <span className="cm-chart-legend__dot" data-series="muted" />
                Avg
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default UsageChart;
