import {
  ArrowLeft,
  ArrowUpDown,
  Compass,
  Eye,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/button';
import { Detail } from '../components/detail';
import { Dropdown, type DropdownOption } from '../components/dropdown';
import { Pagination } from '../components/pagination';
import { CreatorProfileCard, CreatorSlot } from '../components/profile';
import { Search } from '../components/search';
import {
  buildCategoryFilterOptions,
  matchesCategoryFilter,
  TaskPills,
} from '../components/tags';
import { Tooltip } from '../components/tooltip';
import { useOptions } from '../hooks/use-options';
import { prefetchProfiles, useProfile } from '../hooks/use-profile';
import { useWorkflows } from '../hooks/use-workflow';
import { explorerTxUrl, shortHash } from '../lib/contracts';
import {
  marketCreator,
  marketPath,
  marketWorkflow,
  navigateTo,
  navigateToCreator,
  navigateToWorkflow,
  toUrlSlug,
} from '../lib/routes';
import type { Listing } from '../lib/schema';

type SortMode = 'recent' | 'fee-asc' | 'steps';

const SORT_OPTIONS: DropdownOption[] = [
  { value: 'recent', label: 'Newest' },
  { value: 'fee-asc', label: 'Lowest royalty' },
  { value: 'steps', label: 'Most steps' },
];

export function Market() {
  const { marketWorkflows, loading, refreshMarket, deletePublishedWorkflow } = useWorkflows();
  const { categories, categoryByTag } = useOptions();
  const [creatorSlug, setCreatorSlug] = useState<string | null>(() =>
    marketCreator(window.location.pathname),
  );
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortMode>('recent');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Listing | null>(null);

  const categoryOptions = useMemo(
    () => buildCategoryFilterOptions(categories),
    [categories],
  );

  useEffect(() => {
    if (marketWorkflows.length > 0) {
      void prefetchProfiles(marketWorkflows.map((w) => w.userAddress));
    }
  }, [marketWorkflows]);

  useEffect(() => {
    const syncPath = () => {
      const nextCreator = marketCreator(window.location.pathname);
      setCreatorSlug(nextCreator);
      const wfId = marketWorkflow(window.location.pathname);
      if (wfId) {
        const wfSlug = toUrlSlug(wfId).toLowerCase();
        const found = marketWorkflows.find(
          (w) => w.id === wfId || toUrlSlug(w.name).toLowerCase() === wfSlug,
        );
        if (found) setSelectedWorkflow(found);
      }
    };
    syncPath();
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, [marketWorkflows]);

  const { profile: creatorProfile } = useProfile(creatorSlug);

  const matchedWorkflowCreatorAddress = useMemo(() => {
    if (!creatorSlug) return null;
    const slugLower = creatorSlug.toLowerCase();
    const normalizedSlug = toUrlSlug(creatorSlug).toLowerCase();
    const match = marketWorkflows.find((w) => {
      if ((w.userAddress ?? '').toLowerCase() === slugLower) return true;
      if (w.creatorName && toUrlSlug(w.creatorName).toLowerCase() === normalizedSlug) {
        return true;
      }
      return false;
    });
    return match?.userAddress ?? null;
  }, [creatorSlug, marketWorkflows]);

  const canonicalCreatorAddress =
    creatorProfile.userAddress || matchedWorkflowCreatorAddress || null;

  const activeTag = category.startsWith('tag:') ? category.slice(4) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const slugLower = creatorSlug ? creatorSlug.toLowerCase() : '';
    const normalizedSlug = creatorSlug ? toUrlSlug(creatorSlug).toLowerCase() : '';
    const canonicalLower = canonicalCreatorAddress ? canonicalCreatorAddress.toLowerCase() : '';
    return marketWorkflows
      .filter((w) => {
        if (creatorSlug) {
          const ownerLower = (w.userAddress ?? '').toLowerCase();
          const matchesCanonical = Boolean(canonicalLower) && ownerLower === canonicalLower;
          const matchesRaw = ownerLower === slugLower;
          const matchesSlug =
            Boolean(w.creatorName) &&
            toUrlSlug(w.creatorName).toLowerCase() === normalizedSlug;
          if (!matchesCanonical && !matchesRaw && !matchesSlug) {
            return false;
          }
        }
        const tasks = w.terms?.tasks ?? w.tasks ?? [];
        if (!matchesCategoryFilter(tasks, category, categoryByTag)) {
          return false;
        }
        if (
          q &&
          !`${w.name} ${w.terms?.description ?? ''} ${tasks.join(' ')} ${w.creatorName ?? ''} ${w.userAddress ?? ''}`
            .toLowerCase()
            .includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'fee-asc') {
          return (a.terms?.creatorFee ?? 0) - (b.terms?.creatorFee ?? 0);
        }
        if (sort === 'steps') return b.nodes.length - a.nodes.length;
        return (b.published ?? b.modified).localeCompare(a.published ?? a.modified);
      });
  }, [
    marketWorkflows,
    creatorSlug,
    canonicalCreatorAddress,
    category,
    categoryByTag,
    query,
    sort,
  ]);

  const pageSize = 9;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage],
  );

  const handleSelectCreator = (address: string) => {
    setCreatorSlug(address);
    setPage(1);
    navigateToCreator(address);
  };

  const handleClearCreator = () => {
    setCreatorSlug(null);
    setPage(1);
    navigateTo(marketPath());
  };

  return (
    <div className="market-container">
      {creatorSlug ? (
        <div className="market-creator-banner">
          <CreatorProfileCard
            profile={creatorProfile}
            address={canonicalCreatorAddress ?? creatorProfile.address}
            compact
            rightSlot={
              <Button
                icon={<ArrowLeft size={14} />}
                tooltip="All workflows"
                size="xs"
                onClick={handleClearCreator}
              />
            }
          />
        </div>
      ) : null}

      <div className="page-toolbar stealth-glass">
        <div className="toolbar-left">
          <Dropdown
            options={categoryOptions}
            value={category}
            onChange={(val) => {
              setCategory(val);
              setPage(1);
            }}
            icon={<SlidersHorizontal size={13} />}
            iconOnlyMobile
            searchable
            searchPlaceholder="Filter categories..."
          />

          <Dropdown
            options={SORT_OPTIONS}
            value={sort}
            onChange={(val) => setSort(val as SortMode)}
            icon={<ArrowUpDown size={13} />}
            iconOnlyMobile
          />
        </div>

        <div className="toolbar-right">
          <span className="toolbar-meta hide-mobile">{filtered.length} workflows</span>
          <Search
            value={query}
            onChange={(val) => {
              setQuery(val);
              setPage(1);
            }}
            placeholder="Search workflows..."
            collapsible
          />
          <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
          <Button
            icon={<RefreshCw size={14} className={loading ? 'spin' : ''} />}
            tooltip="Refresh market"
            onClick={() => void refreshMarket()}
          />
        </div>
      </div>

      <div className="market-content scroll-area">
        {loading && marketWorkflows.length === 0 ? (
          <div className="empty-box stealth-glass">
            <Compass size={22} className="spin" />
            <p>Loading workflows...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-box stealth-glass">
            <Compass size={22} />
            <p>No workflows match your filter</p>
          </div>
        ) : (
          <div className="wf-grid">
            {pageItems.map((item) => {
              const tasks = item.terms?.tasks ?? item.tasks ?? [];
              const mintTxHash = item.terms?.txHash?.trim() || null;
              const mintContractId = item.terms?.contractId?.trim() || undefined;
              const mintTxUrl = mintTxHash ? explorerTxUrl(mintTxHash, mintContractId) : null;
              const mintNetName =
                mintContractId && mintContractId.endsWith('.testnet') ? 'NEAR Testnet' : 'NEAR';
              const renderMintTxBadge = (inline = false) =>
                mintTxUrl && mintTxHash ? (
                  <Tooltip
                    title={mintNetName}
                    description={`Mint tx · ${shortHash(mintTxHash, 6, 4)}`}
                  >
                    <a
                      href={mintTxUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`wf-media-net-link ${inline ? 'is-inline' : ''}`.trim()}
                      aria-label={`View mint transaction on ${mintNetName}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <img
                        src="/networks/NEAR-2.png"
                        alt={mintNetName}
                        className="wf-media-net-logo"
                      />
                    </a>
                  </Tooltip>
                ) : null;

              return (
                <article
                  key={item.id}
                  className="wf-card stealth-glass"
                  onClick={() => setSelectedWorkflow(item)}
                >
                  {item.banner ? (
                    <div className="wf-card-banner">
                      <img src={item.banner} alt="" className="wf-card-banner-img" />
                      {mintTxUrl ? (
                        <div
                          className="wf-card-media-badge-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {renderMintTxBadge(false)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="wf-card-top">
                    <TaskPills
                      tasks={tasks}
                      maxVisible={2}
                      activeTag={activeTag}
                      onSelectTag={(tag) => {
                        setCategory((prev) => (prev === `tag:${tag}` ? 'all' : `tag:${tag}`));
                        setPage(1);
                      }}
                    />
                    <div className="wf-card-top-meta">
                      {!item.banner ? renderMintTxBadge(true) : null}
                      {item.terms && item.terms.creatorFee > 0 ? (
                        <span className="wf-price">+{item.terms.creatorFee}%</span>
                      ) : null}
                    </div>
                  </div>

                  <h3 className="wf-card-title">
                    <button
                      type="button"
                      className="wf-card-title-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedWorkflow(item);
                      }}
                    >
                      {item.name}
                    </button>
                  </h3>
                  <p className="wf-card-desc">
                    {item.terms?.description ||
                      item.brief ||
                      item.nodes.map((s) => s.data.label).join(' → ')}
                  </p>

                  <div className="wf-card-footer" onClick={(e) => e.stopPropagation()}>
                    <CreatorSlot
                      address={item.userAddress}
                      fallbackName={item.creatorName}
                      fallbackAvatar={item.creatorAvatar}
                      showExplorer
                      onSelectCreator={handleSelectCreator}
                    />

                    <div className="wf-card-actions">
                      <span className="wf-meta-text">
                        {item.nodes.length} {item.nodes.length === 1 ? 'step' : 'steps'}
                      </span>
                      <Button
                        icon={<Eye size={13} />}
                        tooltip="View details"
                        size="xs"
                        onClick={() => setSelectedWorkflow(item)}
                      />
                      <Button
                        icon={<Play size={13} />}
                        tooltip="Run workflow"
                        variant="primary"
                        size="xs"
                        onClick={() => navigateToWorkflow(item.id)}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <Detail
        workflow={selectedWorkflow}
        open={Boolean(selectedWorkflow)}
        onClose={() => setSelectedWorkflow(null)}
        onSelectCreator={handleSelectCreator}
        onDelete={async (wf) => {
          await deletePublishedWorkflow(wf);
        }}
      />
    </div>
  );
}
