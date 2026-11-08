import {
  Activity,
  ArrowUpDown,
  AudioLines,
  AudioWaveform,
  BarChart3,
  Bot,
  Box,
  Braces,
  Calendar,
  Clapperboard,
  Code2,
  Coins,
  Compass,
  Cpu,
  Crosshair,
  Database,
  Eye,
  FileText,
  Film,
  FolderKanban,
  GitBranch,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutGrid,
  Link2,
  Mail,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Mic,
  Music,
  Plus,
  Radio,
  RefreshCw,
  Scan,
  ScanText,
  Scissors,
  Server,
  Shapes,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Tags,
  Users,
  Video,
  Volume2,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type UIEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ALL_PILLOW_ID,
  buildFamilyCounts,
  CONNECTOR_ORIGIN_ORDER,
  displayGroupLabel,
  displaySubgroupLabel,
  isMonochromeDarkLogo,
  MODEL_MODALITY_ORDER,
  rawSubgroupKey,
  resolveEntryLogoUrl,
  sortCatalogEntries,
  tooltipSubgroupLabel,
} from '../lib/catalog';
import { kinds, type Entry, type Kind } from '../lib/schema';
import { Button } from './button';
import { Search } from './search';
import { Tooltip } from './tooltip';

interface CatalogProps {
  entries: Entry[];
  loading: boolean;
  errors?: Partial<Record<Kind, string>>;
  onRefresh: () => void;
  onAddEntry: (entry: Entry) => void;
  onClose: () => void;
  initialTab?: Kind;
  contextLabel?: string | null;
}

interface PillowItem {
  id: string;
  label: string;
  tooltipTitle: string;
  count: number;
  icon: LucideIcon;
}

const PAGE_SIZE = 80;

const GROUP_ICONS: Record<string, LucideIcon> = {
  [ALL_PILLOW_ID]: LayoutGrid,
  text: FileText,
  image: ImageIcon,
  video: Video,
  music: Music,
  embeddings: Braces,
  others: Shapes,
  mcps: Server,
  onchain: Coins,
  accounts: Link2,
};

const MODEL_SUBGROUP_ICONS: Record<string, LucideIcon> = {
  [ALL_PILLOW_ID]: LayoutGrid,
  chat: MessageSquare,
  'vision-chat': Eye,
  'speech-to-text': AudioWaveform,
  speech: Mic,
  realtime: Radio,
  rerank: ArrowUpDown,
  reranker: ArrowUpDown,
  ocr: ScanText,
  classification: Tags,
  classify: Tags,
  'image-classification': Tags,
  translation: Languages,
  'realtime-translation': Languages,
  'deep-research': Compass,
  'text-to-image': Sparkles,
  'image-to-image': Layers,
  'object-detection': Scan,
  'image-segmentation': Scissors,
  'instance-segmentation': Scissors,
  'image-to-text': FileText,
  'zero-shot-classification': Crosshair,
  'zero-shot-image-classification': Crosshair,
  'keypoint-detection': Waypoints,
  'keypoints-detection': Waypoints,
  'depth-estimation': Box,
  'text-to-speech': Volume2,
  'speech-to-speech': AudioLines,
  'text-to-audio': Music,
  'voice-activity-detection': Activity,
  'text-to-video': Film,
  'image-to-video': Clapperboard,
  'video-edit': SlidersHorizontal,
  'text-to-embedding': Braces,
  'multimodal-embedding': Layers,
  'image-to-embedding': Scan,
  'realtime-omni': Radio,
  'realtime-transcription': FileText,
  'realtime-speech': Mic,
  decision: GitBranch,
  custom: GitBranch,
};

function resolveGroupIcon(kind: Kind, group: string): LucideIcon {
  const key = group.trim().toLowerCase();
  if (GROUP_ICONS[key]) return GROUP_ICONS[key]!;
  if (kind === 'connector') return Server;
  return Shapes;
}

function resolveSubgroupIcon(kind: Kind, scoped: string): LucideIcon {
  if (scoped === ALL_PILLOW_ID) return LayoutGrid;
  const raw = rawSubgroupKey(scoped);
  if (kind === 'model') {
    if (MODEL_SUBGROUP_ICONS[raw]) return MODEL_SUBGROUP_ICONS[raw]!;
    if (raw.includes('image')) return ImageIcon;
    if (raw.includes('video')) return Video;
    if (raw.includes('music')) return Music;
    if (raw.includes('audio') || raw.includes('speech')) return Mic;
    if (raw.includes('embed')) return Braces;
    return Shapes;
  }

  if (/(dev|code|it\b|server|url|website)/.test(raw)) return Code2;
  if (/(analytic|business|dashboard|seo)/.test(raw)) return BarChart3;
  if (/(crm|sales|contact|people|customer|hr\b|human)/.test(raw)) return Users;
  if (/(market|social|ads?\b|drip|newsletter)/.test(raw)) return Megaphone;
  if (/(project|task|product)/.test(raw)) return FolderKanban;
  if (/(chat|collab|communicat|team|phone|conferenc|webinar|notif)/.test(raw)) return MessagesSquare;
  if (/(\bai\b|artificial|model)/.test(raw)) return Cpu;
  if (/(ecommerce|payment|account|invoice|fundrais)/.test(raw)) return Coins;
  if (/(doc|note|sheet|form|sign)/.test(raw)) return FileText;
  if (/(email|mail)/.test(raw)) return Mail;
  if (/(database|file|storage|scrap|search|company)/.test(raw)) return Database;
  if (/(calendar|schedul|time)/.test(raw)) return Calendar;
  if (/(secur|complian)/.test(raw)) return Shield;
  if (/(image|video|audio|media|speech|transcri)/.test(raw)) return Sparkles;
  if (/(smart-contract|chain)/.test(raw)) return Braces;
  return Tag;
}

function resolveEntryFallbackIcon(entry: Entry): LucideIcon {
  if (entry.kind === 'agent') return Bot;
  if (entry.kind === 'connector') {
    const groups = entry.groups ?? [];
    if (groups.includes('onchain')) return Coins;
    if (groups.includes('accounts')) return Link2;
    return Server;
  }

  const mod = (entry.modality ?? '').trim().toLowerCase();
  if (mod === 'text-generation') return FileText;
  if (mod === 'image-generation') return ImageIcon;
  if (mod === 'video-generation') return Video;
  if (mod === 'music-generation') return Music;
  if (mod === 'embeddings') return Braces;
  if (MODEL_SUBGROUP_ICONS[mod]) return MODEL_SUBGROUP_ICONS[mod]!;

  const groups = entry.groups ?? [];
  for (const g of groups) {
    if (g !== 'others' && GROUP_ICONS[g]) return GROUP_ICONS[g]!;
  }
  const firstSub = entry.subgroups?.[0];
  if (firstSub) return resolveSubgroupIcon('model', firstSub);
  return FileText;
}

function CatalogCard({
  entry,
  deferred,
  onSelect,
}: {
  entry: Entry;
  deferred: boolean;
  onSelect: (entry: Entry) => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoSrc = resolveEntryLogoUrl(entry);
  const showLogo = Boolean(logoSrc && !logoFailed);
  const FallbackIcon = resolveEntryFallbackIcon(entry);
  const tierBadge = entry.isFrontier ? 'FRONTIER' : entry.isLatest ? 'LATEST' : null;

  return (
    <button
      type="button"
      className={`catalog-card ${deferred ? 'catalog-card--deferred' : ''} ${
        entry.isFrontier ? 'catalog-card--frontier' : ''
      }`}
      data-kind={entry.kind}
      onClick={() => onSelect(entry)}
    >
      <div className="catalog-card-head">
        <span className="catalog-card-icon" aria-hidden="true">
          {showLogo ? (
            <img
              src={logoSrc}
              alt=""
              loading="lazy"
              decoding="async"
              className={`catalog-card-logo ${isMonochromeDarkLogo(logoSrc) ? 'is-mono-dark' : ''}`}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <FallbackIcon size={13} className="catalog-card-glyph" />
          )}
        </span>
        <span className="catalog-card-title">{entry.name}</span>
        <span className="catalog-card-meta">
          {entry.kind === 'model' && showLogo ? (
            <FallbackIcon size={11} className="catalog-card-mod-glyph" aria-hidden="true" />
          ) : null}
          {tierBadge ? (
            <span
              className={`catalog-card-tier ${
                entry.isFrontier ? 'catalog-card-tier--frontier' : 'catalog-card-tier--latest'
              }`}
            >
              {tierBadge}
            </span>
          ) : null}
        </span>
      </div>
      <div className="catalog-card-sub">{entry.description || entry.id}</div>
      <span className="catalog-card-add" aria-hidden="true">
        <Plus size={12} />
      </span>
    </button>
  );
}

function PillowToolbar({
  items,
  selectedId,
  onSelect,
  ariaLabel,
  kind,
  sub = false,
}: {
  items: PillowItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
  kind: Kind;
  sub?: boolean;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [focusIdx, setFocusIdx] = useState(0);

  useEffect(() => {
    const selIdx = items.findIndex((item) => item.id === selectedId);
    setFocusIdx(selIdx >= 0 ? selIdx : 0);
  }, [items, selectedId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ('focusGroup' in HTMLElement.prototype || items.length === 0) return;
    let next = focusIdx;
    if (event.key === 'ArrowRight') {
      next = (focusIdx + 1) % items.length;
    } else if (event.key === 'ArrowLeft') {
      next = (focusIdx - 1 + items.length) % items.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setFocusIdx(next);
    const buttons = barRef.current?.querySelectorAll<HTMLButtonElement>('button[data-pillow-id]');
    buttons?.[next]?.focus();
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!barRef.current) return;
    if (
      Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
      barRef.current.scrollWidth > barRef.current.clientWidth
    ) {
      barRef.current.scrollLeft += event.deltaY;
    }
  };

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={ariaLabel}
      data-kind={kind}
      className={`catalog-pillow-bar ${
        sub ? 'catalog-pillow-bar--sub' : 'catalog-pillow-bar--primary'
      }`}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
    >
      {items.map((item, idx) => {
        const Icon = item.icon;
        const isSelected = selectedId === item.id;
        return (
          <Tooltip
            key={item.id}
            position="bottom"
            label={item.tooltipTitle}
            description={`${item.count} ${item.count === 1 ? 'step' : 'steps'}`}
          >
            <button
              type="button"
              data-pillow-id={item.id}
              aria-label={item.tooltipTitle}
              aria-pressed={isSelected}
              tabIndex={idx === focusIdx ? 0 : -1}
              className={`catalog-pillow-chip ${sub ? 'catalog-pillow-chip--sub' : ''}`}
              onFocus={() => setFocusIdx(idx)}
              onClick={(event) => {
                onSelect(item.id);
                event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
              }}
            >
              <Icon size={sub ? 12 : 13.5} className="catalog-pillow-glyph" aria-hidden="true" />
              <span className="catalog-pillow-text-wrap" aria-hidden={!isSelected}>
                <span className="catalog-pillow-text">{item.label}</span>
              </span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function Catalog({
  entries,
  loading,
  errors,
  onRefresh,
  onAddEntry,
  onClose,
  initialTab = 'model',
  contextLabel = null,
}: CatalogProps) {
  const [tab, setTab] = useState<Kind>(initialTab);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string>(ALL_PILLOW_ID);
  const [activeSubgroup, setActiveSubgroup] = useState<string>(ALL_PILLOW_ID);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTab(initialTab);
    setActiveGroup(ALL_PILLOW_ID);
    setActiveSubgroup(ALL_PILLOW_ID);
    setVisibleCount(PAGE_SIZE);
  }, [initialTab]);

  const handleTabChange = (next: Kind) => {
    setTab(next);
    setActiveGroup(ALL_PILLOW_ID);
    setActiveSubgroup(ALL_PILLOW_ID);
    setVisibleCount(PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const trimmedQuery = query.trim().toLowerCase();

  const tabEntries = useMemo(
    () => entries.filter((entry) => entry.kind === tab),
    [entries, tab],
  );

  const modelFamilyCounts = useMemo(
    () => (tab === 'model' ? buildFamilyCounts(tabEntries) : undefined),
    [tab, tabEntries],
  );

  const matchesQuery = useCallback(
    (entry: Entry): boolean => {
      if (!trimmedQuery) return true;
      const groupLabels = (entry.groups ?? [])
        .map((g) => displayGroupLabel(entry.kind, g))
        .join(' ');
      const subLabels = (entry.subgroups ?? []).map((s) => rawSubgroupKey(s)).join(' ');
      const fam = entry.family ?? '';
      const mod = entry.modality ?? '';
      return `${entry.name} ${entry.description} ${entry.id} ${fam} ${mod} ${groupLabels} ${subLabels}`
        .toLowerCase()
        .includes(trimmedQuery);
    },
    [trimmedQuery],
  );

  const primaryPillows = useMemo<PillowItem[]>(() => {
    if (tab === 'agent') return [];

    const order =
      tab === 'connector'
        ? (CONNECTOR_ORIGIN_ORDER as readonly string[])
        : (MODEL_MODALITY_ORDER as readonly string[]);

    const counts = new Map<string, number>();
    for (const preset of order) {
      counts.set(preset, 0);
    }

    let totalMatching = 0;
    for (const entry of tabEntries) {
      if (!matchesQuery(entry)) continue;
      totalMatching += 1;
      const rawGroups =
        entry.groups && entry.groups.length > 0
          ? entry.groups
          : [tab === 'connector' ? 'mcps' : 'others'];
      for (const g of rawGroups) {
        const normalized = order.includes(g) ? g : tab === 'model' ? 'others' : g;
        counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      }
    }

    if (totalMatching === 0) return [];

    const categoryItems = order
      .filter((id) => (counts.get(id) ?? 0) > 0)
      .map((id) => {
        const label = displayGroupLabel(tab, id);
        return {
          id,
          label,
          tooltipTitle: label.toUpperCase(),
          count: counts.get(id) ?? 0,
          icon: resolveGroupIcon(tab, id),
        };
      });

    return [
      {
        id: ALL_PILLOW_ID,
        label: 'all',
        tooltipTitle: tab === 'model' ? 'ALL MODELS' : 'ALL CONNECTORS',
        count: totalMatching,
        icon: LayoutGrid,
      },
      ...categoryItems,
    ];
  }, [tab, tabEntries, matchesQuery]);

  const resolvedGroup = useMemo(() => {
    if (activeGroup === ALL_PILLOW_ID) return ALL_PILLOW_ID;
    return primaryPillows.some((p) => p.id === activeGroup) ? activeGroup : ALL_PILLOW_ID;
  }, [activeGroup, primaryPillows]);

  const subPillows = useMemo<PillowItem[]>(() => {
    if (resolvedGroup === ALL_PILLOW_ID || tab === 'agent') return [];
    const prefix = `${resolvedGroup}/`;
    const counts = new Map<string, number>();
    let groupTotal = 0;

    for (const entry of tabEntries) {
      const entryGroups =
        entry.groups && entry.groups.length > 0
          ? entry.groups
          : [tab === 'connector' ? 'mcps' : 'others'];
      if (!entryGroups.includes(resolvedGroup)) continue;
      if (!matchesQuery(entry)) continue;
      groupTotal += 1;
      for (const sub of entry.subgroups ?? []) {
        if (!sub.startsWith(prefix)) continue;
        counts.set(sub, (counts.get(sub) ?? 0) + 1);
      }
    }

    const subItems = [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, count]) => ({
        id,
        label: displaySubgroupLabel(id),
        tooltipTitle: tooltipSubgroupLabel(id),
        count,
        icon: resolveSubgroupIcon(tab, id),
      }));

    const minSubItems = tab === 'model' ? 2 : 1;
    if (subItems.length < minSubItems) return [];

    return [
      {
        id: ALL_PILLOW_ID,
        label: 'all',
        tooltipTitle: `All ${displayGroupLabel(tab, resolvedGroup).toUpperCase()}`,
        count: groupTotal,
        icon: LayoutGrid,
      },
      ...subItems,
    ];
  }, [resolvedGroup, tab, tabEntries, matchesQuery]);

  const resolvedSubgroup = useMemo(() => {
    if (activeSubgroup === ALL_PILLOW_ID || resolvedGroup === ALL_PILLOW_ID) {
      return ALL_PILLOW_ID;
    }
    return subPillows.some((p) => p.id === activeSubgroup) ? activeSubgroup : ALL_PILLOW_ID;
  }, [activeSubgroup, resolvedGroup, subPillows]);

  const filteredItems = useMemo<Entry[]>(() => {
    const matching = tabEntries.filter((entry) => {
      if (!matchesQuery(entry)) return false;
      if (resolvedGroup !== ALL_PILLOW_ID) {
        const groups =
          entry.groups && entry.groups.length > 0
            ? entry.groups
            : [tab === 'connector' ? 'mcps' : 'others'];
        if (!groups.includes(resolvedGroup)) return false;
      }
      if (resolvedSubgroup !== ALL_PILLOW_ID) {
        if (!(entry.subgroups ?? []).includes(resolvedSubgroup)) return false;
      }
      return true;
    });

    return sortCatalogEntries(matching, tab, modelFamilyCounts);
  }, [tabEntries, matchesQuery, resolvedGroup, resolvedSubgroup, tab, modelFamilyCounts]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [trimmedQuery, resolvedGroup, resolvedSubgroup, tab]);

  const handleSelectGroup = (groupId: string) => {
    if (groupId === ALL_PILLOW_ID || resolvedGroup === groupId) {
      setActiveGroup(ALL_PILLOW_ID);
      setActiveSubgroup(ALL_PILLOW_ID);
    } else {
      setActiveGroup(groupId);
      setActiveSubgroup(ALL_PILLOW_ID);
    }
  };

  const handleSelectSubgroup = (subId: string) => {
    setActiveSubgroup((curr) =>
      subId === ALL_PILLOW_ID || curr === subId ? ALL_PILLOW_ID : subId,
    );
  };

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (visibleCount >= filteredItems.length) return;
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        setVisibleCount((curr) => Math.min(curr + PAGE_SIZE, filteredItems.length));
      }
    },
    [visibleCount, filteredItems.length],
  );

  const tabError = errors?.[tab];
  const hasSubrow = resolvedGroup !== ALL_PILLOW_ID && subPillows.length > 0;
  const visibleItems = filteredItems.slice(0, visibleCount);

  return (
    <aside className="studio-drawer studio-drawer-left stealth-glass" aria-label="Step catalog">
      <div className="drawer-header">
        <div className="drawer-title-group">
          <span className="drawer-kicker">CATALOG</span>
          {contextLabel ? <span className="drawer-sublabel">{contextLabel}</span> : null}
        </div>
        <div className="drawer-header-actions">
          <Button
            icon={<RefreshCw size={13} className={loading ? 'spin' : ''} />}
            tooltip="Refresh catalog"
            size="xs"
            onClick={onRefresh}
          />
          <Button icon={<X size={14} />} tooltip="Close catalog" size="xs" onClick={onClose} />
        </div>
      </div>

      <div className="drawer-controls catalog-controls">
        <Search value={query} onChange={setQuery} placeholder="Filter steps..." />
        <div className="segmented" role="tablist" aria-label="Step category">
          {kinds.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              className={`seg-btn ${tab === item ? 'active' : ''}`}
              onClick={() => handleTabChange(item)}
            >
              {item === 'model' ? 'MODEL' : item === 'connector' ? 'CONNECTOR' : 'AGENT'}
            </button>
          ))}
        </div>

        {tab !== 'agent' && primaryPillows.length > 0 ? (
          <div className="catalog-filter-stack" data-kind={tab}>
            <PillowToolbar
              items={primaryPillows}
              selectedId={resolvedGroup}
              onSelect={handleSelectGroup}
              ariaLabel={tab === 'model' ? 'Model modalities' : 'Connector sources'}
              kind={tab}
            />
            <div
              className={`catalog-subrow-shell ${hasSubrow ? 'is-open' : ''}`}
              aria-hidden={!hasSubrow}
              inert={!hasSubrow}
            >
              <div className="catalog-subrow-inner">
                {subPillows.length > 0 ? (
                  <PillowToolbar
                    items={subPillows}
                    selectedId={resolvedSubgroup}
                    onSelect={handleSelectSubgroup}
                    ariaLabel={
                      tab === 'model' ? 'Model sub-modalities' : 'Connector subcategories'
                    }
                    kind={tab}
                    sub
                  />
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={listRef}
        className="drawer-body scroll-area catalog-list"
        onScroll={handleScroll}
      >
        {loading && tabEntries.length === 0 ? (
          <div className="empty-note">Loading steps...</div>
        ) : tabError && tabEntries.length === 0 ? (
          <div className="catalog-error-box">
            <p className="empty-note">{tabError}</p>
            <button type="button" className="btn btn-ghost btn-xs" onClick={onRefresh}>
              <RefreshCw size={12} />
              <span>Retry</span>
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-note">No matching steps</div>
        ) : (
          <>
            {visibleItems.map((entry, idx) => (
              <CatalogCard
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                deferred={idx >= 16}
                onSelect={onAddEntry}
              />
            ))}
            {visibleCount < filteredItems.length ? (
              <button
                type="button"
                className="catalog-more-btn"
                onClick={() =>
                  setVisibleCount((curr) => Math.min(curr + PAGE_SIZE, filteredItems.length))
                }
              >
                Show more ({visibleCount} of {filteredItems.length})
              </button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
