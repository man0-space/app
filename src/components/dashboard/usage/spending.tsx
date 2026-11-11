import { useMemo, useState } from 'react';
import { Activity, Coins, DollarSign, Gauge } from 'lucide-react';
import {
  atomicToUsd,
  formatMs,
  formatTokens,
  formatUsd,
  numberLabel,
  type AnalyticsInterval,
  type TimelineBucket,
} from '../../../lib/analytics';
import { BlockDropdown, type SpentDropdownOption } from './dropdown';
import { UsageChart, type ChartTab } from './usage';

const TABS: SpentDropdownOption<ChartTab>[] = [
  {
    value: 'spend',
    label: 'SPEND',
    icon: DollarSign,
    tooltip: 'Settled USDC inference spend and platform fee over time',
  },
  {
    value: 'requests',
    label: 'REQUESTS',
    icon: Activity,
    tooltip: 'Succeeded, failed, and aborted requests per bucket',
  },
  {
    value: 'tokens',
    label: 'TOKENS',
    icon: Coins,
    tooltip: 'Input and output token throughput over time',
  },
  {
    value: 'latency',
    label: 'LATENCY',
    icon: Gauge,
    tooltip: 'P50, P95, P99, and mean latency curves across buckets',
  },
];

function usePeriodBadge(timeline: TimelineBucket[], tab: ChartTab): string {
  return useMemo(() => {
    if (tab === 'spend') {
      const total = timeline.reduce(
        (sum, bucket) => sum + atomicToUsd(bucket.totals.billing.finalAmountAtomic),
        0,
      );
      return formatUsd(total);
    }
    if (tab === 'requests') {
      const total = timeline.reduce((sum, bucket) => sum + bucket.totals.requests.total, 0);
      return `${numberLabel(total)} REQS`;
    }
    if (tab === 'tokens') {
      const total = timeline.reduce((sum, bucket) => {
        const metrics = bucket.totals.usage.metrics;
        const input = metrics.input_tokens ?? metrics.text_input_tokens ?? 0;
        const output = metrics.output_tokens ?? metrics.text_output_tokens ?? 0;
        return sum + (input + output > 0 ? input + output : metrics.total_tokens ?? 0);
      }, 0);
      return formatTokens(total);
    }
    let weighted = 0;
    let count = 0;
    for (const bucket of timeline) {
      weighted += bucket.totals.latency.averageMs * bucket.totals.latency.count;
      count += bucket.totals.latency.count;
    }
    return count > 0 ? `${formatMs(weighted / count)} AVG` : '—';
  }, [timeline, tab]);
}

export function SpendingChart({
  timeline,
  interval,
  focused = false,
  dataBlock = 'chart',
  onClick,
}: {
  timeline: TimelineBucket[];
  interval: AnalyticsInterval;
  focused?: boolean;
  dataBlock?: string;
  onClick?: () => void;
}) {
  const [tab, setTab] = useState<ChartTab>('spend');
  const badge = usePeriodBadge(timeline, tab);

  return (
    <section
      className="cm-block"
      data-block={dataBlock}
      data-focused={focused ? 'true' : 'false'}
      onClick={onClick}
    >
      <header className="cm-block__header">
        {focused ? (
          <div className="cm-time-range" onClick={(event) => event.stopPropagation()}>
            {TABS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="cm-time-range__option"
                data-active={tab === option.value ? 'true' : 'false'}
                onClick={() => setTab(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
            <BlockDropdown
              value={tab}
              options={TABS}
              label="Chart metric"
              onChange={setTab}
              align="start"
            />
          </div>
        )}
        <div className="cm-block__header-side">
          <span className="cm-block__badge">{badge}</span>
        </div>
      </header>

      <div className="cm-block__body">
        {timeline.length === 0 ? (
          <div className="cm-block__empty">No telemetry for this range</div>
        ) : (
          <UsageChart timeline={timeline} interval={interval} tab={tab} focused={focused} />
        )}
      </div>
    </section>
  );
}
