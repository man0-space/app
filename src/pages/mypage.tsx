import {
  ArrowUpDown,
  Columns3,
  Edit3,
  Eye,
  FolderKanban,
  FolderOpen,
  LayoutGrid,
  List as ListIcon,
  Play,
  Plus,
  Receipt,
  Share2,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { EarnDashboard } from '../components/dashboard/royalties';
import { SpentDashboard } from '../components/dashboard/usage';
import { Button } from '../components/button';
import { CoordinatorField } from '../components/coordinator';
import { Detail } from '../components/detail';
import { Dropdown, type DropdownOption } from '../components/dropdown';
import { Pagination } from '../components/pagination';
import {
  CreatorProfileCard,
  type CreatorWalletBadge,
  ProfileModal,
} from '../components/profile';
import { Publish } from '../components/publish';
import { Search } from '../components/search';
import {
  buildCategoryFilterOptions,
  matchesCategoryFilter,
  TaskPills,
} from '../components/tags';
import { Tooltip } from '../components/tooltip';
import { useAuth } from '../contexts/auth';
import { useOptions } from '../hooks/use-options';
import { useProfile } from '../hooks/use-profile';
import {
  ensureDraftSavedOnBackend,
  type SavedDraft,
  useWorkflows,
} from '../hooks/use-workflow';
import { authenticated } from '../lib/api';
import {
  explorerAccountUrl,
  explorerTxUrl,
  externalWalletExplorerUrl,
  shortHash,
} from '../lib/contracts';
import { navigateToCreator, navigateToWorkflow } from '../lib/routes';
import type { Flow, Listing } from '../lib/schema';

interface MyPageProps {
  onOpenDraft: (flow: Flow) => void;
  onNewWorkflow: () => void;
  onNotify: (msg: string) => void;
}

type SectionMode = 'workspace' | 'earn' | 'spent';
type LayoutMode = 'cards' | 'list' | 'columns';
type FolderFilter = 'all' | 'drafts' | 'published';
type SortMode = 'recent' | 'name' | 'steps';

const SORT_OPTIONS: DropdownOption[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name' },
  { value: 'steps', label: 'Steps' },
];

interface UnifiedItem {
  id: string;
  kind: 'draft' | 'published';
  title: string;
  description: string;
  banner: string | null;
  stepsCount: number;
  tasks: string[];
  feePercent: number;
  updatedAt: string;
  draft?: SavedDraft;
  published?: Listing;
}

export function MyPage({ onOpenDraft, onNewWorkflow, onNotify }: MyPageProps) {
  const { user, links, openAuthModal } = useAuth();
  const { profile, saveProfile } = useProfile(user?.userAddress);

  const profileWallets = useMemo<CreatorWalletBadge[]>(() => {
    if (!user?.userAddress) return [];
    const out: CreatorWalletBadge[] = [
      {
        network: 'near',
        label: 'NEAR',
        address: user.userAddress,
        explorerUrl: explorerAccountUrl(user.userAddress),
      },
    ];
    const seen = new Set<string>(['near']);
    for (const item of links) {
      const net = item.network === 'svm' ? 'svm' : 'evm';
      if (seen.has(net)) continue;
      seen.add(net);
      out.push({
        network: net,
        label: net.toUpperCase(),
        address: item.address,
        explorerUrl: externalWalletExplorerUrl(net, item.address),
      });
    }
    return out;
  }, [user?.userAddress, links]);
  const { categories, categoryByTag } = useOptions();
  const {
    drafts,
    userWorkflows,
    marketWorkflows,
    saveDraftItem,
    deleteDraftItem,
    deletePublishedWorkflow,
    refreshMarket,
  } = useWorkflows();

  const [section, setSection] = useState<SectionMode>('workspace');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('cards');
  const [folder, setFolder] = useState<FolderFilter>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortMode>('recent');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [detailWorkflow, setDetailWorkflow] = useState<Listing | null>(null);
  const [publishFlow, setPublishFlow] = useState<Flow | null>(null);

  const categoryOptions = useMemo(
    () => buildCategoryFilterOptions(categories),
    [categories],
  );

  const activeTag = category.startsWith('tag:') ? category.slice(4) : null;

  const items = useMemo<UnifiedItem[]>(() => {
    const list: UnifiedItem[] = [];

    const combinedPublished = new Map<string, Listing>();
    for (const w of userWorkflows) {
      if (w.published) combinedPublished.set(w.id, w);
    }
    if (user?.userAddress) {
      const addr = user.userAddress.toLowerCase();
      for (const w of marketWorkflows) {
        if ((w.userAddress ?? '').toLowerCase() === addr && w.published) {
          combinedPublished.set(w.id, w);
        }
      }
    }

    const draftMap = new Map<string, SavedDraft>();
    for (const d of drafts) {
      if (!combinedPublished.has(d.id)) {
        draftMap.set(d.id, d);
      }
    }

    for (const d of draftMap.values()) {
      list.push({
        id: `draft-${d.id}`,
        kind: 'draft',
        title: d.title,
        description:
          d.flow.brief ||
          d.flow.nodes.map((n) => n.data.label).join(' → ') ||
          'Draft workflow',
        banner: d.flow.banner ?? null,
        stepsCount: d.flow.nodes.length,
        tasks: d.flow.tasks ?? [],
        feePercent: 0,
        updatedAt: d.updatedAt,
        draft: d,
      });
    }

    for (const w of combinedPublished.values()) {
      list.push({
        id: `pub-${w.id}`,
        kind: 'published',
        title: w.name,
        description:
          w.terms?.description ||
          w.brief ||
          w.nodes.map((s) => s.data.label).join(' → '),
        banner: w.banner ?? null,
        stepsCount: w.nodes.length,
        tasks: w.terms?.tasks ?? w.tasks ?? [],
        feePercent: w.terms?.creatorFee ?? 0,
        updatedAt: w.published || w.modified,
        published: w,
      });
    }

    return list;
  }, [drafts, userWorkflows, marketWorkflows, user?.userAddress]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (folder === 'drafts' && item.kind !== 'draft') return false;
        if (folder === 'published' && item.kind !== 'published') return false;
        if (!matchesCategoryFilter(item.tasks, category, categoryByTag)) return false;
        if (
          q &&
          !`${item.title} ${item.description} ${item.tasks.join(' ')}`.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === 'name') return a.title.localeCompare(b.title);
        if (sort === 'steps') return b.stepsCount - a.stepsCount;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [items, folder, category, categoryByTag, query, sort]);

  const pageSize = layoutMode === 'cards' ? 9 : 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const selectedColumnItem = useMemo(
    () =>
      filtered.find((i) => i.id === selectedColumnId) ??
      filtered[0] ??
      null,
    [filtered, selectedColumnId],
  );

  const handleOpenItem = (item: UnifiedItem) => {
    if (item.draft) {
      onOpenDraft(item.draft.flow);
    } else if (item.published) {
      setDetailWorkflow(item.published);
    }
  };

  const handleRunItem = async (item: UnifiedItem) => {
    if (item.published) {
      navigateToWorkflow(item.published.id);
      return;
    }
    if (item.draft) {
      if (!authenticated()) {
        openAuthModal();
        onNotify('Sign in to open and run draft workflows');
        return;
      }
      try {
        const saved = await ensureDraftSavedOnBackend(item.draft.flow);
        navigateToWorkflow(saved.id);
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Could not open draft workflow');
      }
    }
  };

  const handleDeleteItem = async (item: UnifiedItem) => {
    if (item.draft) {
      await deleteDraftItem(item.draft.id);
      onNotify('Draft deleted');
    } else if (item.published) {
      await deletePublishedWorkflow(item.published);
      onNotify('Workflow deleted');
    }
  };

  return (
    <div className="mypage-container">
      <div className="mypage-profile-bar">
        <CreatorProfileCard
          profile={profile}
          address={user?.userAddress ?? profile.address}
          wallets={profileWallets}
          isOwner={Boolean(user)}
          onSignIn={!user ? openAuthModal : undefined}
          onPreview={
            user?.userAddress
              ? () => navigateToCreator(profile.nickname || user.userAddress)
              : undefined
          }
          onEdit={() => {
            if (!user) {
              openAuthModal();
              return;
            }
            setEditProfileOpen(true);
          }}
          compact
          rightSlot={
            <div
              className="segmented segmented--adaptive-mobile"
              role="tablist"
              aria-label="Workspace view"
            >
              <Tooltip label="Workspace" description="Drafts & published workflows">
                <button
                  type="button"
                  role="tab"
                  aria-label="Workspace"
                  aria-selected={section === 'workspace'}
                  className={`seg-btn ${section === 'workspace' ? 'active' : ''}`}
                  onClick={() => setSection('workspace')}
                >
                  <FolderKanban size={13} className="seg-btn-glyph" aria-hidden="true" />
                  <span className="seg-btn-label">WORKSPACE</span>
                </button>
              </Tooltip>
              <Tooltip label="Earn" description="Creator royalties & workflow runs">
                <button
                  type="button"
                  role="tab"
                  aria-label="Earn"
                  aria-selected={section === 'earn'}
                  className={`seg-btn ${section === 'earn' ? 'active' : ''}`}
                  onClick={() => setSection('earn')}
                >
                  <TrendingUp size={13} className="seg-btn-glyph" aria-hidden="true" />
                  <span className="seg-btn-label">EARN</span>
                </button>
              </Tooltip>
              <Tooltip label="Spent" description="Inference usage & settlement receipts">
                <button
                  type="button"
                  role="tab"
                  aria-label="Spent"
                  aria-selected={section === 'spent'}
                  className={`seg-btn ${section === 'spent' ? 'active' : ''}`}
                  onClick={() => setSection('spent')}
                >
                  <Receipt size={13} className="seg-btn-glyph" aria-hidden="true" />
                  <span className="seg-btn-label">SPENT</span>
                </button>
              </Tooltip>
            </div>
          }
        />
      </div>

      {section === 'earn' ? (
        <EarnDashboard
          workflows={userWorkflows.length > 0 ? userWorkflows : marketWorkflows}
          onSelectWorkflow={setDetailWorkflow}
        />
      ) : section === 'spent' ? (
        <SpentDashboard />
      ) : (
        <div className="mypage-stage">
          <div className="page-toolbar stealth-glass">
            <div className="toolbar-left">
              <div className="segmented" role="tablist" aria-label="Folder filter">
                {(['all', 'drafts', 'published'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={folder === f}
                    className={`seg-btn ${folder === f ? 'active' : ''}`}
                    onClick={() => {
                      setFolder(f);
                      setPage(1);
                    }}
                  >
                    {f === 'all' ? 'ALL' : f === 'drafts' ? 'DRAFTS' : 'PUBLISHED'}
                  </button>
                ))}
              </div>

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
              <Search
                value={query}
                onChange={(val) => {
                  setQuery(val);
                  setPage(1);
                }}
                placeholder="Search workspace..."
                collapsible
              />

              <div className="segmented" role="tablist" aria-label="View layout">
                <button
                  type="button"
                  role="tab"
                  aria-selected={layoutMode === 'cards'}
                  className={`seg-btn seg-icon ${layoutMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('cards')}
                  aria-label="Cards view"
                >
                  <LayoutGrid size={13} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={layoutMode === 'list'}
                  className={`seg-btn seg-icon ${layoutMode === 'list' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('list')}
                  aria-label="List view"
                >
                  <ListIcon size={13} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={layoutMode === 'columns'}
                  className={`seg-btn seg-icon ${layoutMode === 'columns' ? 'active' : ''}`}
                  onClick={() => setLayoutMode('columns')}
                  aria-label="Columns view"
                >
                  <Columns3 size={13} />
                </button>
              </div>

              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />

              <Button
                icon={<Plus size={14} />}
                tooltip="New workflow"
                variant="primary"
                onClick={onNewWorkflow}
              />
            </div>
          </div>

          <div className="mypage-content scroll-area">
            {filtered.length === 0 ? (
              <div className="empty-box stealth-glass">
                <FolderOpen size={22} aria-hidden="true" />
                <p>No workflows in this folder</p>
                <Button
                  icon={<Plus size={14} />}
                  tooltip="New workflow"
                  variant="primary"
                  onClick={onNewWorkflow}
                />
              </div>
            ) : layoutMode === 'cards' ? (
              <div className="wf-grid">
                {pageItems.map((item) => {
                  const mintTxHash = item.published?.terms?.txHash?.trim() || null;
                  const mintContractId = item.published?.terms?.contractId?.trim() || undefined;
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
                      onClick={() => handleOpenItem(item)}
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
                        <span
                          className={`status-pill ${item.kind === 'published' ? 'is-ready' : ''}`}
                        >
                          {item.kind === 'published' ? 'PUBLISHED' : 'DRAFT'}
                        </span>
                        <div className="wf-card-top-meta">
                          {!item.banner ? renderMintTxBadge(true) : null}
                          <TaskPills
                            tasks={item.tasks}
                            maxVisible={2}
                            activeTag={activeTag}
                            onSelectTag={(tag) => {
                              setCategory((prev) => (prev === `tag:${tag}` ? 'all' : `tag:${tag}`));
                              setPage(1);
                            }}
                          />
                        </div>
                      </div>

                    <h3 className="wf-card-title">
                      <button
                        type="button"
                        className="wf-card-title-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenItem(item);
                        }}
                      >
                        {item.title}
                      </button>
                    </h3>
                    <p className="wf-card-desc">{item.description}</p>

                    <div className="wf-card-footer" onClick={(e) => e.stopPropagation()}>
                      <span className="wf-meta-text">
                        {item.stepsCount} step{item.stepsCount === 1 ? '' : 's'}
                        {item.feePercent > 0 ? ` · +${item.feePercent}%` : ''}
                      </span>
                      <div className="wf-card-actions">
                        {item.draft ? (
                          <>
                            <Button
                              icon={<Edit3 size={13} />}
                              tooltip="Edit"
                              size="xs"
                              onClick={() => onOpenDraft(item.draft!.flow)}
                            />
                            <Button
                              icon={<Play size={13} />}
                              tooltip="Run"
                              variant="primary"
                              size="xs"
                              onClick={() => void handleRunItem(item)}
                            />
                            <Button
                              icon={<Share2 size={13} />}
                              tooltip="Publish"
                              size="xs"
                              onClick={() => setPublishFlow(item.draft!.flow)}
                            />
                          </>
                        ) : item.published ? (
                          <>
                            <Button
                              icon={<Eye size={13} />}
                              tooltip="View details"
                              size="xs"
                              onClick={() => setDetailWorkflow(item.published!)}
                            />
                            <Button
                              icon={<Play size={13} />}
                              tooltip="Run"
                              variant="primary"
                              size="xs"
                              onClick={() => void handleRunItem(item)}
                            />
                          </>
                        ) : null}
                        <Button
                          icon={<Trash2 size={13} />}
                          tooltip="Delete"
                          variant="danger"
                          size="xs"
                          onClick={() => void handleDeleteItem(item)}
                        />
                      </div>
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : layoutMode === 'list' ? (
              <div className="finder-table stealth-glass">
                <div className="finder-head">
                  <span>Name</span>
                  <span className="hide-mobile">Status</span>
                  <span>Steps</span>
                  <span className="hide-mobile">Royalty</span>
                  <span className="hide-mobile">Updated</span>
                  <span>Actions</span>
                </div>
                <div className="finder-body scroll-area">
                  {pageItems.map((item) => (
                    <div
                      key={item.id}
                      className="finder-row"
                      onClick={() => handleOpenItem(item)}
                    >
                      <div className="finder-cell-main">
                        <span className="wf-card-title">{item.title}</span>
                        <span className="wf-meta-text">{item.description}</span>
                      </div>
                      <span className="finder-cell hide-mobile">
                        <span
                          className={`status-pill ${item.kind === 'published' ? 'is-ready' : ''}`}
                        >
                          {item.kind === 'published' ? 'PUBLISHED' : 'DRAFT'}
                        </span>
                      </span>
                      <span className="finder-cell">{item.stepsCount}</span>
                      <span className="finder-cell hide-mobile">
                        {item.feePercent > 0 ? `${item.feePercent}%` : '—'}
                      </span>
                      <span className="finder-cell hide-mobile">
                        {new Date(item.updatedAt).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <div
                        className="finder-actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.draft ? (
                          <>
                            <Button
                              icon={<Edit3 size={13} />}
                              tooltip="Edit"
                              size="xs"
                              onClick={() => onOpenDraft(item.draft!.flow)}
                            />
                            <Button
                              icon={<Play size={13} />}
                              tooltip="Run"
                              variant="primary"
                              size="xs"
                              onClick={() => void handleRunItem(item)}
                            />
                            <Button
                              icon={<Share2 size={13} />}
                              tooltip="Publish"
                              size="xs"
                              onClick={() => setPublishFlow(item.draft!.flow)}
                            />
                          </>
                        ) : item.published ? (
                          <Button
                            icon={<Play size={13} />}
                            tooltip="Run"
                            variant="primary"
                            size="xs"
                            onClick={() => void handleRunItem(item)}
                          />
                        ) : null}
                        <Button
                          icon={<Trash2 size={13} />}
                          tooltip="Delete"
                          variant="danger"
                          size="xs"
                          onClick={() => void handleDeleteItem(item)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="finder-columns stealth-glass">
                <div className="finder-col-folders">
                  {(['all', 'drafts', 'published'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`finder-folder-item ${folder === f ? 'is-active' : ''}`}
                      onClick={() => setFolder(f)}
                    >
                      <FolderOpen size={14} />
                      <span>
                        {f === 'all' ? 'All Items' : f === 'drafts' ? 'Drafts' : 'Published'}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="finder-col-list scroll-area">
                  {filtered.map((item) => {
                    const isSelected = selectedColumnItem?.id === item.id;
                    return (
                      <div key={item.id} className="finder-col-entry">
                        <button
                          type="button"
                          className={`finder-col-row ${isSelected ? 'is-active' : ''}`}
                          onClick={() => setSelectedColumnId(item.id)}
                        >
                          <span className="finder-col-title">{item.title}</span>
                          <span className="wf-meta-text">{item.stepsCount} steps</span>
                        </button>
                        {isSelected ? (
                          <div className="finder-mobile-inspector show-mobile">
                            <p className="wf-card-desc">{item.description}</p>
                            <TaskPills tasks={item.tasks} />
                            <div className="wf-card-actions">
                              {item.draft ? (
                                <Button
                                  icon={<Edit3 size={13} />}
                                  tooltip="Edit"
                                  size="xs"
                                  onClick={() => onOpenDraft(item.draft!.flow)}
                                />
                              ) : (
                                <Button
                                  icon={<Eye size={13} />}
                                  tooltip="View details"
                                  size="xs"
                                  onClick={() => handleOpenItem(item)}
                                />
                              )}
                              <Button
                                icon={<Play size={13} />}
                                tooltip="Run"
                                variant="primary"
                                size="xs"
                                onClick={() => void handleRunItem(item)}
                              />
                              {item.draft ? (
                                <Button
                                  icon={<Share2 size={13} />}
                                  tooltip="Publish"
                                  size="xs"
                                  onClick={() => setPublishFlow(item.draft!.flow)}
                                />
                              ) : null}
                              <Button
                                icon={<Trash2 size={13} />}
                                tooltip="Delete"
                                variant="danger"
                                size="xs"
                                onClick={() => void handleDeleteItem(item)}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="finder-col-inspector hide-mobile">
                  {selectedColumnItem ? (
                    <div className="inspector-card">
                      {selectedColumnItem.banner ? (
                        <div className="wf-card-banner">
                          <img
                            src={selectedColumnItem.banner}
                            alt=""
                            className="wf-card-banner-img"
                          />
                        </div>
                      ) : null}
                      <div className="wf-card-top">
                        <span
                          className={`status-pill ${selectedColumnItem.kind === 'published' ? 'is-ready' : ''}`}
                        >
                          {selectedColumnItem.kind.toUpperCase()}
                        </span>
                        <span className="wf-meta-text">
                          {selectedColumnItem.stepsCount} steps
                        </span>
                      </div>
                      <TaskPills tasks={selectedColumnItem.tasks} />
                      <h3>{selectedColumnItem.title}</h3>
                      <p className="wf-card-desc">{selectedColumnItem.description}</p>
                      {selectedColumnItem.draft ? (
                        <CoordinatorField
                          value={selectedColumnItem.draft.flow.coordinator ?? null}
                          onNotify={onNotify}
                          onChange={(nextCoord) => {
                            void saveDraftItem(
                              {
                                ...selectedColumnItem.draft!.flow,
                                coordinator: nextCoord,
                              },
                              selectedColumnItem.draft!.title,
                              selectedColumnItem.draft!.id,
                            ).catch((err) => {
                              onNotify(
                                err instanceof Error
                                  ? err.message
                                  : 'Unable to update draft Coordinator',
                              );
                            });
                          }}
                        />
                      ) : selectedColumnItem.published?.coordinator ? (
                        <div className="coordinator-summary-pill">
                          <img
                            src={selectedColumnItem.published.coordinator.image}
                            alt=""
                            className="coordinator-summary-avatar"
                          />
                          <div className="coordinator-summary-meta">
                            <span className="coordinator-summary-name">
                              {selectedColumnItem.published.coordinator.name}
                            </span>
                            <span className="coordinator-summary-sub">
                              {selectedColumnItem.published.coordinator.model}
                            </span>
                          </div>
                        </div>
                      ) : null}
                      <div className="wf-card-actions">
                        {selectedColumnItem.draft ? (
                          <>
                            <Button
                              icon={<Edit3 size={13} />}
                              tooltip="Edit"
                              size="xs"
                              onClick={() => onOpenDraft(selectedColumnItem.draft!.flow)}
                            />
                            <Button
                              icon={<Play size={13} />}
                              tooltip="Run"
                              variant="primary"
                              size="xs"
                              onClick={() => void handleRunItem(selectedColumnItem)}
                            />
                            <Button
                              icon={<Share2 size={13} />}
                              tooltip="Publish"
                              size="xs"
                              onClick={() => setPublishFlow(selectedColumnItem.draft!.flow)}
                            />
                          </>
                        ) : (
                          <>
                            <Button
                              icon={<Eye size={13} />}
                              tooltip="View details"
                              size="xs"
                              onClick={() => handleOpenItem(selectedColumnItem)}
                            />
                            <Button
                              icon={<Play size={13} />}
                              tooltip="Run"
                              variant="primary"
                              size="xs"
                              onClick={() => void handleRunItem(selectedColumnItem)}
                            />
                          </>
                        )}
                        <Button
                          icon={<Trash2 size={13} />}
                          tooltip="Delete"
                          variant="danger"
                          size="xs"
                          onClick={() => void handleDeleteItem(selectedColumnItem)}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ProfileModal
        open={editProfileOpen}
        onClose={() => setEditProfileOpen(false)}
        profile={profile}
        onSave={saveProfile}
      />

      <Detail
        workflow={detailWorkflow}
        open={Boolean(detailWorkflow)}
        onClose={() => setDetailWorkflow(null)}
        onDelete={async (wf) => {
          await deletePublishedWorkflow(wf);
          onNotify('Workflow deleted');
        }}
      />

      {publishFlow ? (
        <Publish
          open={Boolean(publishFlow)}
          onClose={() => setPublishFlow(null)}
          flow={publishFlow}
          onPublished={() => {
            setPublishFlow(null);
            void refreshMarket();
            onNotify('Workflow published');
          }}
        />
      ) : null}
    </div>
  );
}
