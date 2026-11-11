import { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpDown,
  Box,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  DollarSign,
  Gauge,
  Layers,
  Search,
} from 'lucide-react';
import {
  formatModelTypeLabel,
  formatMs,
  formatPct,
  formatTokens,
  formatUsd,
  getFamilyLogoUrl,
  primaryModalityKey,
  type ModelUsage,
  type TypeEntry,
} from '../../../lib/analytics';
import { Tooltip } from '../../tooltip';
import {
  MODALITY_METRIC_OPTIONS,
  ModalityBreakdown,
  type ModalityMetric,
} from './by-modality';
import { BlockDropdown, type SpentDropdownOption } from './dropdown';

type SortKey =
  | 'totalUsd'
  | 'calls'
  | 'lastUsed'
  | 'totalTokens'
  | 'type'
  | 'p95Ms'
  | 'successRate';
type SortDir = 'asc' | 'desc';
type ModelsView = 'models' | 'type';

const SORT_OPTIONS: SpentDropdownOption<SortKey>[] = [
  { value: 'totalUsd', label: 'COST', icon: DollarSign, tooltip: 'Sort models by total USDC spend' },
  { value: 'calls', label: 'CALLS', icon: Activity, tooltip: 'Sort models by request count' },
  { value: 'totalTokens', label: 'TOKENS', icon: Coins, tooltip: 'Sort models by total tokens' },
  { value: 'p95Ms', label: 'LATENCY', icon: Gauge, tooltip: 'Sort models by P95 latency' },
  { value: 'successRate', label: 'SUCCESS', icon: CheckCircle2, tooltip: 'Sort models by success rate' },
  { value: 'lastUsed', label: 'RECENT', icon: Clock, tooltip: 'Sort models by most recent call' },
  { value: 'type', label: 'TYPE', icon: Layers, tooltip: 'Sort models alphabetically by modality' },
];

const VIEW_OPTIONS: SpentDropdownOption<ModelsView>[] = [
  { value: 'models', label: 'MODELS', icon: Cpu, tooltip: 'Per-model spend, calls, tokens, and latency' },
  { value: 'type', label: 'BY TYPE', icon: Layers, tooltip: 'Spend and call distribution by modality' },
];

function successTone(rate: number | null): 'emerald' | 'amber' | 'danger' | undefined {
  if (rate === null) return undefined;
  if (rate >= 0.99) return 'emerald';
  if (rate >= 0.95) return 'amber';
  return 'danger';
}

export function ModelUsageTable({
  models,
  modalityBreakdown,
  focused = false,
  dataBlock = 'models',
  onClick,
}: {
  models: ModelUsage[];
  modalityBreakdown: TypeEntry[];
  focused?: boolean;
  dataBlock?: string;
  onClick?: () => void;
}) {
  const [view, setView] = useState<ModelsView>('models');
  const [metric, setMetric] = useState<ModalityMetric>('usd');
  const [sortKey, setSortKey] = useState<SortKey>('totalUsd');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [query, setQuery] = useState('');

  const handleSortChange = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((dir) => (dir === 'desc' ? 'asc' : 'desc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? models.filter(
        (model) =>
          model.modelId.toLowerCase().includes(needle) ||
          model.family.toLowerCase().includes(needle),
      )
      : models;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case 'calls':
          cmp = a.calls - b.calls;
          break;
        case 'lastUsed':
          cmp = a.lastUsed - b.lastUsed;
          break;
        case 'totalTokens':
          cmp = a.totalTokens - b.totalTokens;
          break;
        case 'p95Ms':
          cmp = (a.p95Ms ?? -1) - (b.p95Ms ?? -1);
          break;
        case 'successRate':
          cmp = (a.successRate ?? -1) - (b.successRate ?? -1);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        default:
          cmp = a.totalUsd - b.totalUsd;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [models, sortKey, sortDir, query]);

  const visible = focused ? sorted : sorted.slice(0, 6);

  return (
    <section
      className="cm-block"
      data-block={dataBlock}
      data-focused={focused ? 'true' : 'false'}
      onClick={onClick}
    >
      <header className="cm-block__header">
        <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
          <BlockDropdown
            value={view}
            options={VIEW_OPTIONS}
            label="Models breakdown view"
            onChange={setView}
            align="start"
          />
        </div>

        <div className="cm-block__header-side" onClick={(event) => event.stopPropagation()}>
          {view === 'models' ? (
            <>
              {focused && (
                <label className="cm-usage-search">
                  <Search className="cm-usage-search__icon" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter models…"
                    className="cm-usage-search__input"
                    aria-label="Filter models"
                  />
                </label>
              )}
              <BlockDropdown
                value={sortKey}
                options={SORT_OPTIONS}
                label="Sort models"
                onChange={handleSortChange}
                align="end"
                chevron={false}
                triggerIcon={ArrowUpDown}
              />
            </>
          ) : (
            <BlockDropdown
              value={metric}
              options={MODALITY_METRIC_OPTIONS}
              label="Modality metric"
              onChange={setMetric}
              align="end"
            />
          )}
        </div>
      </header>

      {view === 'type' ? (
        <div className="cm-block__body">
          <ModalityBreakdown
            modalityBreakdown={modalityBreakdown}
            metric={metric}
            focused={focused}
          />
        </div>
      ) : models.length === 0 ? (
        <div className="cm-block__empty">No model usage recorded yet</div>
      ) : visible.length === 0 ? (
        <div className="cm-block__empty">No models match “{query}”</div>
      ) : (
        <div
          className="cm-block__body"
          tabIndex={0}
          role="region"
          aria-label="Model usage breakdown"
          onClick={(e) => {
            if (focused) e.stopPropagation();
          }}
        >
          <table className="cm-usage-table">
            <thead>
              <tr>
                <th>MODEL</th>
                <th data-align="right">COST</th>
                <th data-align="right">CALLS</th>
                {focused && <th data-align="right">TOKENS</th>}
                {focused && <th data-align="right">P95</th>}
                {focused && <th data-align="right">SUCCESS</th>}
                {focused && <th>TYPE</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((model) => {
                const logoUrl = getFamilyLogoUrl(model.family) ?? getFamilyLogoUrl(model.modelId);
                const modalityTone = primaryModalityKey(model.type);
                return (
                  <tr key={model.subject}>
                    <td>
                      <Tooltip
                        title={model.modelId}
                        description={`${model.family} · ${formatUsd(model.totalUsd)} · ${model.calls.toLocaleString()} calls`}
                        position="top"
                      >
                        <span className="cm-usage-model">
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt=""
                              className="cm-usage-model__icon"
                            />
                          ) : (
                            <span
                              className="cm-usage-model__icon cm-usage-model__icon--fallback"
                              aria-hidden="true"
                            >
                              <Box className="cm-usage-model__icon-glyph" />
                            </span>
                          )}
                          <span className="cm-usage-model__name">
                            <span className="cm-usage-model__id">{model.modelId}</span>
                            <span className="cm-usage-model__provider">{model.family}</span>
                          </span>
                        </span>
                      </Tooltip>
                    </td>
                    <td data-align="right" className="cm-usage-cost">
                      {formatUsd(model.totalUsd)}
                    </td>
                    <td data-align="right">{model.calls.toLocaleString()}</td>
                    {focused && (
                      <td data-align="right">
                        {model.totalTokens > 0 ? formatTokens(model.totalTokens) : '—'}
                      </td>
                    )}
                    {focused && (
                      <td data-align="right">
                        {model.p95Ms !== null ? formatMs(model.p95Ms) : '—'}
                      </td>
                    )}
                    {focused && (
                      <td data-align="right">
                        <span
                          className="cm-usage-success"
                          data-tone={successTone(model.successRate)}
                        >
                          {formatPct(model.successRate, 0)}
                        </span>
                      </td>
                    )}
                    {focused && (
                      <td>
                        <span className="cm-usage-modality" data-tone={modalityTone}>
                          {formatModelTypeLabel(model.type)}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
