import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Clock,
  DollarSign,
  GitBranch,
  Layers,
  Play,
} from 'lucide-react';
import { Tooltip } from '../../tooltip';
import { formatMs, formatUsd, successTone, type EarnStatId, type OverviewStats } from './utils';

export function Sparkline({ values }: { values: number[] }) {
  const gradId = React.useId().replace(/:/gu, '');
  if (values.length < 2 || values.every((v) => v === 0)) {
    return <div className="cm-stat-card__spark cm-stat-card__spark--flat" aria-hidden="true" />;
  }
  const w = 120;
  const h = 24;
  const max = Math.max(...values, 0.000001);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 0.000001);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - min) / span) * (h - 4);
    return [x, y] as const;
  });
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      className="cm-stat-card__spark"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface OverviewCardsProps {
  stats: OverviewStats;
}

export function OverviewCards({ stats }: OverviewCardsProps) {
  const [selectedStat, setSelectedStat] = useState<EarnStatId>('profit');
  const [statPickerOpen, setStatPickerOpen] = useState(false);
  const statPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!statPickerOpen) return;
    function handleOutside(e: MouseEvent) {
      if (statPickerRef.current && !statPickerRef.current.contains(e.target as Node)) {
        setStatPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [statPickerOpen]);

  const statPickerItems: Array<{
    id: EarnStatId;
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
    tooltip: string;
  }> = [
    {
      id: 'profit',
      label: 'PROFIT',
      value: formatUsd(stats.totalProfitUsd),
      icon: DollarSign,
      tooltip: 'Net creator royalties earned from workflow executions',
    },
    {
      id: 'runs',
      label: 'RUNS',
      value: stats.totalRuns.toLocaleString(),
      icon: Play,
      tooltip: 'Total workflow executions in the selected window',
    },
    {
      id: 'runtime',
      label: 'RUNTIME',
      value: formatMs(stats.totalRuntimeMs),
      icon: Clock,
      tooltip: 'Cumulative execution duration across all runs',
    },
    {
      id: 'success',
      label: 'SUCCESS',
      value: stats.totalRuns > 0 ? `${stats.avgSuccessPct.toFixed(1)}%` : '—',
      icon: Activity,
      tooltip: 'Average execution success rate across active workflows',
    },
    {
      id: 'workflows',
      label: 'WORKFLOWS',
      value: `${stats.publishedWorkflows} / ${stats.totalWorkflows}`,
      icon: GitBranch,
      tooltip: 'Published workflows earning royalties out of total catalog',
    },
  ];
  const otherStatItems = statPickerItems.filter((s) => s.id !== selectedStat);

  return (
    <section className="cm-overview" data-selected-stat={selectedStat}>
      <div className="cm-overview-grid">
        {/* 1. PROFIT */}
        <div className="cm-stat-card" data-stat="profit">
          <Tooltip
            title="Profit"
            description="Net creator royalties settled from workflow executions"
            position="bottom"
          >
            <span className="cm-stat-card__label">
              <DollarSign className="cm-stat-card__label-icon" />
              PROFIT
            </span>
          </Tooltip>
          <span className="cm-stat-card__value" data-tone="emerald">
            {formatUsd(stats.totalProfitUsd)}
          </span>
          <span className="cm-stat-card__sub">
            {stats.paidRuns.toLocaleString()} PAID RUNS SETTLED
          </span>
          <Sparkline values={stats.profitSparkline} />
        </div>

        {/* 2. RUNS */}
        <div className="cm-stat-card" data-stat="runs">
          <Tooltip
            title="Runs"
            description="Total workflow executions in the selected window"
            position="bottom"
          >
            <span className="cm-stat-card__label">
              <Play className="cm-stat-card__label-icon" />
              RUNS
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">{stats.totalRuns.toLocaleString()}</span>
          <span className="cm-stat-card__sub">
            <span
              className="cm-stat-card__pill"
              data-tone={stats.totalRuns > 0 ? successTone(stats.avgSuccessPct) : undefined}
            >
              {stats.totalRuns > 0 ? `${stats.avgSuccessPct.toFixed(1)}% OK` : '0 SETTLED'}
            </span>
          </span>
        </div>

        {/* 3. RUNTIME */}
        <div className="cm-stat-card" data-stat="runtime">
          <Tooltip
            title="Runtime"
            description="Total cumulative workflow execution time"
            position="bottom"
          >
            <span className="cm-stat-card__label">
              <Clock className="cm-stat-card__label-icon" />
              RUNTIME
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">{formatMs(stats.totalRuntimeMs)}</span>
          <span className="cm-stat-card__sub">{formatMs(stats.avgRuntimeMs)} / RUN</span>
        </div>

        {/* 4. SUCCESS */}
        <div className="cm-stat-card" data-stat="success">
          <Tooltip
            title="Success Rate"
            description="Completed runs divided by total workflow executions"
            position="bottom"
          >
            <span className="cm-stat-card__label">
              <Activity className="cm-stat-card__label-icon" />
              SUCCESS
            </span>
          </Tooltip>
          <span className="cm-stat-card__value">
            {stats.totalRuns > 0 ? `${stats.avgSuccessPct.toFixed(1)}%` : '—'}
          </span>
          <span className="cm-stat-card__sub">
            {stats.totalRuns > 0 ? `PEAK ${stats.peakSuccessPct.toFixed(1)}%` : 'NO RUNS YET'}
          </span>
        </div>

        {/* 5. WORKFLOWS */}
        <div className="cm-stat-card" data-stat="workflows">
          <Tooltip
            title="Published Workflows"
            description="Minted workflows on NEAR vs. total workflows"
            position="bottom"
          >
            <span className="cm-stat-card__label">
              <GitBranch className="cm-stat-card__label-icon" />
              WORKFLOWS
            </span>
          </Tooltip>
          <span className="cm-stat-card__value" data-tone="primary">
            {stats.publishedWorkflows} / {stats.totalWorkflows}
          </span>
          <span className="cm-stat-card__sub">
            {stats.avgCreatorFeePct > 0
              ? `AVG +${stats.avgCreatorFeePct.toFixed(1)}% ROYALTY`
              : 'MINTED ON MARKET'}
          </span>
        </div>

        {/* Narrow Viewport Picker Card (@container max-width: 42rem) */}
        <div ref={statPickerRef} className="cm-dropdown-wrap cm-stat-card--picker-wrap">
          <button
            type="button"
            className="cm-stat-card cm-stat-card--picker"
            onClick={() => setStatPickerOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={statPickerOpen}
            aria-label={`More stats: ${otherStatItems.map((s) => s.label).join(', ')}`}
          >
            <span className="cm-stat-card__label">
              <Layers className="cm-stat-card__label-icon" />
              MORE STATS
            </span>
            <span className="cm-stat-card--picker__value">
              <span className="cm-stat-card__value">{otherStatItems.length}</span>
              <ChevronDown className="cm-stat-card--picker__chevron" />
            </span>
            <span className="cm-stat-card__sub">SWAP METRIC</span>
          </button>

          {statPickerOpen && (
            <div className="cm-dropdown-menu" data-align="end" role="listbox">
              {otherStatItems.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selectedStat === item.id}
                    className="cm-dropdown-item"
                    data-active="false"
                    onClick={() => {
                      setSelectedStat(item.id);
                      setStatPickerOpen(false);
                    }}
                  >
                    <ItemIcon className="cm-sort-dropdown__icon" />
                    <span>{item.label}</span>
                    <span className="cm-stat-card--picker__item-value">{item.value}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
