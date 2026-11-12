import { useMemo, useState } from 'react';
import type { AgChartOptions } from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import { Tooltip } from '../../tooltip';
import { BlockDropdown } from './dropdown';
import {
  BRAND_PALETTE,
  CHART_VIEW_OPTIONS,
  formatMs,
  formatUsd,
  renderTooltipHtml,
  type ChartView,
  type NormalizedWorkflowRow,
  type OverviewStats,
  type PaletteIndex,
  type TimeSeriesBucket,
} from './utils';

export interface TimelineChartProps {
  timeSeriesData: TimeSeriesBucket[];
  topRunsWorkflows: NormalizedWorkflowRow[];
  topRuntimeWorkflows: NormalizedWorkflowRow[];
  totalWorkflowsCount: number;
  overviewStats: OverviewStats;
  isMobile: boolean;
  focused: boolean;
  onToggleFocus: () => void;
}

export function TimelineChart({
  timeSeriesData,
  topRunsWorkflows,
  topRuntimeWorkflows,
  totalWorkflowsCount,
  overviewStats,
  isMobile,
  focused,
  onToggleFocus,
}: TimelineChartProps) {
  const [chartView, setChartView] = useState<ChartView>('profit');

  const chartBadgeLabel = useMemo(() => {
    if (chartView === 'profit') return formatUsd(overviewStats.totalProfitUsd);
    if (chartView === 'runs') return `${overviewStats.totalRuns.toLocaleString()} RUNS`;
    if (chartView === 'runtime') return formatMs(overviewStats.totalRuntimeMs);
    return overviewStats.totalRuns > 0 ? `AVG ${overviewStats.avgSuccessPct.toFixed(1)}%` : '—';
  }, [chartView, overviewStats]);

  const agChartOptions = useMemo<AgChartOptions>(() => {
    const axisFontSize = isMobile ? 11 : 11;
    const monoFont = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace";
    const labelByKey = new Map(timeSeriesData.map((b) => [b.bucketKey, b.label]));
    const chartTheme = {
      baseTheme: 'ag-default-dark' as const,
      params: {
        fontFamily: monoFont,
        fontSize: axisFontSize,
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
          fontSize: axisFontSize,
          rotation: 0,
          avoidCollisions: true,
          formatter: ({ value }: { value: string }) =>
            labelByKey.get(String(value)) ?? String(value),
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
          fontSize: axisFontSize,
          formatter: ({ value }: { value: number }) => {
            if (chartView === 'profit') return formatUsd(value);
            if (chartView === 'runtime') return formatMs(value);
            if (chartView === 'success') return `${Math.round(value)}%`;
            return Math.round(value).toLocaleString();
          },
        },
      },
    };

    if (chartView === 'profit') {
      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'area',
            xKey: 'bucketKey',
            yKey: 'royaltiesUsd',
            yName: 'Royalties',
            stroke: BRAND_PALETTE[0],
            strokeWidth: 2,
            fill: BRAND_PALETTE[0],
            fillOpacity: 0.14,
            interpolation: { type: 'smooth' },
            marker: {
              enabled: false,
              fill: BRAND_PALETTE[0],
              stroke: '#020305',
              strokeWidth: 2,
              size: 6,
            },
            tooltip: {
              renderer: ({ datum }: { datum: TimeSeriesBucket }) =>
                renderTooltipHtml(datum.label, [
                  {
                    label: 'Creator Royalties',
                    value: formatUsd(datum.royaltiesUsd),
                    palette: 0,
                  },
                  {
                    label: 'Inference Volume',
                    value: formatUsd(datum.composeCostUsd),
                    palette: 1,
                  },
                  {
                    label: 'Gross Settled',
                    value: formatUsd(datum.totalUsd),
                    strong: true,
                  },
                  {
                    label: 'Runs',
                    value: datum.runs.toLocaleString(),
                  },
                ]),
            },
          },
        ],
      };
    }

    if (chartView === 'runs') {
      const s0 = topRunsWorkflows[0]?.title || 'Top #1';
      const s1 = topRunsWorkflows[1]?.title || 'Top #2';
      const s2 = topRunsWorkflows[2]?.title || 'Top #3';

      const makeTooltip = ({ datum }: { datum: TimeSeriesBucket }) => {
        const rows: Array<{ label: string; value: string; palette?: PaletteIndex; strong?: boolean }> = [];
        if (topRunsWorkflows[0]) {
          rows.push({
            label: s0,
            value: datum.runTop0.toLocaleString(),
            palette: 0,
          });
        }
        if (topRunsWorkflows[1]) {
          rows.push({
            label: s1,
            value: datum.runTop1.toLocaleString(),
            palette: 1,
          });
        }
        if (topRunsWorkflows[2]) {
          rows.push({
            label: s2,
            value: datum.runTop2.toLocaleString(),
            palette: 2,
          });
        }
        if (datum.runOthers > 0 || totalWorkflowsCount > 3) {
          rows.push({
            label: 'Others',
            value: datum.runOthers.toLocaleString(),
            palette: 3,
          });
        }
        rows.push({
          label: 'Total Runs',
          value: datum.runs.toLocaleString(),
          strong: true,
        });
        return renderTooltipHtml(datum.label, rows);
      };

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'runTop0',
            yName: s0,
            stacked: true,
            fill: BRAND_PALETTE[0],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'runTop1',
            yName: s1,
            stacked: true,
            fill: BRAND_PALETTE[1],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'runTop2',
            yName: s2,
            stacked: true,
            fill: BRAND_PALETTE[2],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'runOthers',
            yName: 'Others',
            stacked: true,
            fill: BRAND_PALETTE[3],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
        ],
      };
    }

    if (chartView === 'runtime') {
      const s0 = topRuntimeWorkflows[0]?.title || 'Top #1';
      const s1 = topRuntimeWorkflows[1]?.title || 'Top #2';
      const s2 = topRuntimeWorkflows[2]?.title || 'Top #3';

      const makeTooltip = ({ datum }: { datum: TimeSeriesBucket }) => {
        const rows: Array<{ label: string; value: string; palette?: PaletteIndex; strong?: boolean }> = [];
        if (topRuntimeWorkflows[0]) {
          rows.push({
            label: s0,
            value: formatMs(datum.timeTop0),
            palette: 0,
          });
        }
        if (topRuntimeWorkflows[1]) {
          rows.push({
            label: s1,
            value: formatMs(datum.timeTop1),
            palette: 1,
          });
        }
        if (topRuntimeWorkflows[2]) {
          rows.push({
            label: s2,
            value: formatMs(datum.timeTop2),
            palette: 2,
          });
        }
        if (datum.timeOthers > 0 || totalWorkflowsCount > 3) {
          rows.push({
            label: 'Others',
            value: formatMs(datum.timeOthers),
            palette: 3,
          });
        }
        rows.push({
          label: 'Total Runtime',
          value: formatMs(datum.runtimeMs),
          strong: true,
        });
        return renderTooltipHtml(datum.label, rows);
      };

      return {
        theme: chartTheme,
        background: { fill: 'transparent' },
        padding: { top: 8, right: 18, bottom: 4, left: 6 },
        data: timeSeriesData,
        legend: { enabled: false },
        axes: baseAxes,
        series: [
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'timeTop0',
            yName: s0,
            stacked: true,
            fill: BRAND_PALETTE[0],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'timeTop1',
            yName: s1,
            stacked: true,
            fill: BRAND_PALETTE[1],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'timeTop2',
            yName: s2,
            stacked: true,
            fill: BRAND_PALETTE[2],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
          {
            type: 'bar',
            xKey: 'bucketKey',
            yKey: 'timeOthers',
            yName: 'Others',
            stacked: true,
            fill: BRAND_PALETTE[3],
            strokeWidth: 0,
            cornerRadius: 2,
            tooltip: { renderer: makeTooltip },
          },
        ],
      };
    }

    const makeSuccessTooltip = ({ datum }: { datum: TimeSeriesBucket }) =>
      renderTooltipHtml(datum.label, [
        {
          label: 'Success Rate',
          value: `${datum.successPct.toFixed(1)}%`,
          palette: 0,
          strong: true,
        },
        {
          label: 'Window Avg',
          value: `${datum.avgSuccessPct.toFixed(1)}%`,
          palette: 'muted',
        },
      ]);

    return {
      theme: chartTheme,
      background: { fill: 'transparent' },
      padding: { top: 8, right: 18, bottom: 4, left: 6 },
      data: timeSeriesData,
      legend: { enabled: false },
      axes: baseAxes,
      series: [
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'successPct',
          yName: 'Success (%)',
          stroke: BRAND_PALETTE[0],
          strokeWidth: 2,
          interpolation: { type: 'smooth' },
          marker: {
            enabled: false,
            fill: BRAND_PALETTE[0],
            stroke: '#020305',
            strokeWidth: 2,
            size: 5,
          },
          tooltip: { renderer: makeSuccessTooltip },
        },
        {
          type: 'line',
          xKey: 'bucketKey',
          yKey: 'avgSuccessPct',
          yName: 'Average (AVG.)',
          stroke: '#64748b',
          strokeWidth: 1.5,
          lineDash: [4, 3],
          marker: { enabled: false },
          tooltip: { renderer: makeSuccessTooltip },
        },
      ],
    };
  }, [
    chartView,
    timeSeriesData,
    topRunsWorkflows,
    topRuntimeWorkflows,
    totalWorkflowsCount,
    isMobile,
  ]);

  return (
    <section
      className="cm-block"
      data-block="chart"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        {focused ? (
          <div className="cm-time-range" onClick={(e) => e.stopPropagation()}>
            {CHART_VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="cm-time-range__option"
                data-active={chartView === opt.value ? 'true' : 'false'}
                onClick={() => setChartView(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          <BlockDropdown
            value={chartView}
            options={CHART_VIEW_OPTIONS}
            onChange={setChartView}
            ariaLabel="Chart metric"
          />
        )}
        <div className="cm-block__header-side">
          <span className="cm-block__badge">{chartBadgeLabel}</span>
        </div>
      </header>

      <div className="cm-block__body">
        <div className="cm-chart-frame">
          <div className="cm-chart-canvas">
            <AgCharts options={agChartOptions} />
          </div>

          {focused && chartView !== 'profit' && (
            <div className="cm-chart-legend">
              {chartView === 'runs' && (
                <>
                  {topRunsWorkflows.map((wf, i) => (
                    <Tooltip
                      key={wf.workflowId}
                      title={wf.title}
                      description={`${wf.runs.toLocaleString()} runs · Tasks: ${wf.taskLabel}`}
                      position="top"
                    >
                      <span className="cm-chart-legend__item">
                        <span className="cm-chart-legend__dot" data-palette={i as PaletteIndex} />
                        {wf.title}
                      </span>
                    </Tooltip>
                  ))}
                  {totalWorkflowsCount > 3 && (
                    <span className="cm-chart-legend__item">
                      <span className="cm-chart-legend__dot" data-palette={3} />
                      Others
                    </span>
                  )}
                </>
              )}

              {chartView === 'runtime' && (
                <>
                  {topRuntimeWorkflows.map((wf, i) => (
                    <Tooltip
                      key={wf.workflowId}
                      title={wf.title}
                      description={`${formatMs(wf.totalDurationMs)} runtime · Tasks: ${wf.taskLabel}`}
                      position="top"
                    >
                      <span className="cm-chart-legend__item">
                        <span className="cm-chart-legend__dot" data-palette={i as PaletteIndex} />
                        {wf.title}
                      </span>
                    </Tooltip>
                  ))}
                  {totalWorkflowsCount > 3 && (
                    <span className="cm-chart-legend__item">
                      <span className="cm-chart-legend__dot" data-palette={3} />
                      Others
                    </span>
                  )}
                </>
              )}

              {chartView === 'success' && (
                <>
                  <span className="cm-chart-legend__item">
                    <span className="cm-chart-legend__dot" data-palette={0} />
                    Success (%)
                  </span>
                  <span className="cm-chart-legend__item">
                    <span className="cm-chart-legend__dot" data-palette="muted" />
                    AVG. ({overviewStats.avgSuccessPct.toFixed(1)}%)
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
