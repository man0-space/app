import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  Activity,
  ChevronDown,
  Coins,
  DollarSign,
  Gauge,
  LayoutGrid,
  Rocket,
} from 'lucide-react';
import {
  atomicToUsd,
  formatMs,
  formatPct,
  formatTokens,
  formatUsd,
  numberLabel,
  type Summary,
} from '../../../lib/analytics';
import { Tooltip } from '../../tooltip';

function successTone(rate: number | null): 'emerald' | 'amber' | 'danger' | undefined {
  if (rate === null) return undefined;
  if (rate >= 0.99) return 'emerald';
  if (rate >= 0.95) return 'amber';
  return 'danger';
}

function Sparkline({ values }: { values: number[] }) {
  const gradientId = useId().replace(/:/gu, '');
  const geometry = useMemo(() => {
    if (values.length === 0) return null;
    const max = Math.max(...values, 0);
    if (max <= 0) return { area: '', line: '' };
    const width = 120;
    const height = 24;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : index * step;
      const y = height - (value / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M ${points.join(' L ')}`;
    const firstX = values.length === 1 ? width / 2 : 0;
    const lastX = values.length === 1 ? width / 2 : width;
    return { line, area: `${line} L ${lastX} ${height} L ${firstX} ${height} Z` };
  }, [values]);

  if (!geometry || !geometry.area) {
    return <span className="cm-stat-card__spark cm-stat-card__spark--flat" aria-hidden="true" />;
  }

  return (
    <svg
      className="cm-stat-card__spark"
      viewBox="0 0 120 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${gradientId}-spark`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${gradientId}-spark)`} />
      <path
        d={geometry.line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type SpentStatId = 'spent' | 'requests' | 'latency' | 'ttft' | 'tokens';

interface StatDefinition {
  id: SpentStatId;
  label: string;
  tooltip: string;
  icon: ComponentType<{ className?: string }>;
  value: string;
  tone?: 'primary' | 'accent';
  sub: ReactNode;
  spark?: number[];
}

function buildStats(summary: Summary, spendSeries: number[]): StatDefinition[] {
  const tone = successTone(summary.successRate);
  return [
    {
      id: 'spent',
      label: 'Total Spent',
      tooltip: 'Total settled USDC spend across inference calls and x402 sessions',
      icon: DollarSign,
      value: formatUsd(summary.totalUsd),
      tone: 'primary',
      sub: `${numberLabel(summary.requestCount)} requests settled`,
      spark: spendSeries,
    },
    {
      id: 'requests',
      label: 'Requests',
      tooltip: 'Total inference requests executed in the selected window',
      icon: Activity,
      value: numberLabel(summary.requestCount),
      sub: (
        <>
          <span className="cm-stat-card__pill" data-tone={tone}>
            {formatPct(summary.successRate)} success
          </span>
          {summary.streamedShare !== null
            ? ` · ${formatPct(summary.streamedShare, 0)} streamed`
            : ''}
        </>
      ),
    },
    {
      id: 'latency',
      label: 'Avg Latency',
      tooltip: 'Mean end-to-end request latency and P95 tail latency',
      icon: Gauge,
      value: summary.avgLatencyMs !== null ? formatMs(summary.avgLatencyMs) : '—',
      sub: `P95 ${formatMs(summary.p95LatencyMs ?? 0)}`,
    },
    {
      id: 'ttft',
      label: 'Avg TTFT',
      tooltip: 'Mean time-to-first-token across streamed responses',
      icon: Rocket,
      value: summary.avgTtftMs !== null ? formatMs(summary.avgTtftMs) : '—',
      tone: 'accent',
      sub: 'time to first token',
    },
    {
      id: 'tokens',
      label: 'Tokens',
      tooltip: 'Total input and output tokens processed across models',
      icon: Coins,
      value: formatTokens(summary.tokensIn + summary.tokensOut),
      sub: (
        <>
          {formatTokens(summary.tokensIn)} in <span aria-hidden="true">→</span>{' '}
          {formatTokens(summary.tokensOut)} out
        </>
      ),
    },
  ];
}

function StatCard({ stat }: { stat: StatDefinition }) {
  const Icon = stat.icon;
  return (
    <div className="cm-stat-card" data-stat={stat.id}>
      <Tooltip title={stat.label} description={stat.tooltip} position="bottom">
        <span className="cm-stat-card__label">
          <Icon className="cm-stat-card__label-icon" />
          {stat.label}
        </span>
      </Tooltip>
      <span className="cm-stat-card__value" data-tone={stat.tone}>
        {stat.value}
      </span>
      <span className="cm-stat-card__sub">{stat.sub}</span>
      {stat.spark ? <Sparkline values={stat.spark} /> : null}
    </div>
  );
}

export function OverviewCards({ summary }: { summary: Summary }) {
  const [selectedStat, setSelectedStat] = useState<SpentStatId>('spent');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function handleOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [pickerOpen]);

  const spendSeries = useMemo(
    () =>
      summary.timeline.map((bucket) =>
        atomicToUsd(bucket.totals.billing.finalAmountAtomic),
      ),
    [summary.timeline],
  );
  const stats = useMemo(() => buildStats(summary, spendSeries), [summary, spendSeries]);
  const others = stats.filter((stat) => stat.id !== selectedStat);
  const selected = stats.find((stat) => stat.id === selectedStat) ?? stats[0];

  return (
    <section className="cm-overview" data-selected-stat={selected.id}>
      <div className="cm-overview-grid">
        {stats.map((stat) => (
          <StatCard key={stat.id} stat={stat} />
        ))}

        <div ref={pickerRef} className="cm-dropdown-wrap cm-stat-card--picker-wrap">
          <button
            type="button"
            className="cm-stat-card cm-stat-card--picker"
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label={`More stats: ${others.map((stat) => stat.label).join(', ')}`}
          >
            <span className="cm-stat-card__label">
              <LayoutGrid className="cm-stat-card__label-icon" />
              More stats
            </span>
            <span className="cm-stat-card--picker__value">
              <span className="cm-stat-card__value">{others.length}</span>
              <ChevronDown className="cm-stat-card--picker__chevron" />
            </span>
            <span className="cm-stat-card__sub">swap metric</span>
          </button>

          {pickerOpen && (
            <div className="cm-dropdown-menu" data-align="end" role="listbox">
              {others.map((stat) => {
                const Icon = stat.icon;
                return (
                  <button
                    key={stat.id}
                    type="button"
                    role="option"
                    aria-selected={selectedStat === stat.id}
                    className="cm-dropdown-item"
                    data-active="false"
                    onClick={() => {
                      setSelectedStat(stat.id);
                      setPickerOpen(false);
                    }}
                  >
                    <Icon className="cm-sort-dropdown__icon" />
                    <span>{stat.label}</span>
                    <span className="cm-stat-card--picker__item-value">{stat.value}</span>
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
