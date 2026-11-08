import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/auth';
import { api, authenticated } from '../lib/api';
import { nextUnknownWorkflowName } from '../lib/graph';
import type { Flow, Listing } from '../lib/schema';

export interface SavedDraft {
  id: string;
  title: string;
  flow: Flow;
  updatedAt: string;
}

export async function ensureDraftSavedOnBackend(
  flow: Flow,
  existingNames: Iterable<string> = [],
): Promise<Listing> {
  const cleanName = flow.name.trim() || nextUnknownWorkflowName(existingNames);
  const payload: Flow = {
    ...flow,
    name: cleanName,
  };
  return api.save(payload, flow.modified).catch(() => api.save(payload));
}

function listingToFlow(w: Listing): Flow {
  return {
    id: w.id,
    name: w.name,
    brief: w.brief,
    banner: w.banner ?? null,
    ...(w.tasks?.length ? { tasks: w.tasks } : {}),
    ...(w.coordinator !== undefined ? { coordinator: w.coordinator } : {}),
    nodes: w.nodes,
    edges: w.edges,
    modified: w.modified,
  };
}

const MARKET_CACHE_KEY = 'man0.workflows.market.v1';
const USER_CACHE_PREFIX = 'man0.workflows.user.v1:';

let memoryMarketCache: Listing[] | null = null;
const memoryUserCache = new Map<string, Listing[]>();

function readCachedListings(key: string): Listing[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Listing[]) : null;
  } catch {
    return null;
  }
}

function writeCachedListings(key: string, items: Listing[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function getInitialMarketWorkflows(): Listing[] {
  if (memoryMarketCache) return memoryMarketCache;
  const persisted = readCachedListings(MARKET_CACHE_KEY);
  if (persisted) {
    memoryMarketCache = persisted;
    return persisted;
  }
  return [];
}

function getInitialUserWorkflows(userAddress?: string | null): Listing[] {
  if (!userAddress || !authenticated()) return [];
  const lower = userAddress.toLowerCase();
  const mem = memoryUserCache.get(lower);
  if (mem) return mem;
  const persisted = readCachedListings(`${USER_CACHE_PREFIX}${lower}`);
  if (persisted) {
    memoryUserCache.set(lower, persisted);
    return persisted;
  }
  return [];
}

export function useWorkflows() {
  const { user } = useAuth();
  const userAddr = user?.userAddress ?? null;

  const [marketWorkflows, setMarketWorkflowsState] = useState<Listing[]>(
    () => getInitialMarketWorkflows(),
  );
  const [userWorkflows, setUserWorkflowsState] = useState<Listing[]>(() =>
    getInitialUserWorkflows(userAddr),
  );
  const [loading, setLoading] = useState<boolean>(
    () => getInitialMarketWorkflows().length === 0 && getInitialUserWorkflows(userAddr).length === 0,
  );
  const [error, setError] = useState<string | null>(null);

  const updateMarketWorkflows = useCallback(
    (updater: Listing[] | ((prev: Listing[]) => Listing[])) => {
      setMarketWorkflowsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        memoryMarketCache = next;
        writeCachedListings(MARKET_CACHE_KEY, next);
        return next;
      });
    },
    [],
  );

  const updateUserWorkflows = useCallback(
    (addr: string | null, updater: Listing[] | ((prev: Listing[]) => Listing[])) => {
      setUserWorkflowsState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        if (addr) {
          const lower = addr.toLowerCase();
          memoryUserCache.set(lower, next);
          writeCachedListings(`${USER_CACHE_PREFIX}${lower}`, next);
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    setUserWorkflowsState(getInitialUserWorkflows(userAddr));
  }, [userAddr]);

  const refreshMarket = useCallback(async () => {
    const hasWarmCache =
      (memoryMarketCache && memoryMarketCache.length > 0) ||
      (userAddr ? (memoryUserCache.get(userAddr.toLowerCase())?.length ?? 0) > 0 : false);
    if (!hasWarmCache) {
      setLoading(true);
    }
    setError(null);
    try {
      const canFetchOwn = Boolean(userAddr && authenticated());
      const [marketList, ownList] = await Promise.all([
        api.market(),
        canFetchOwn ? api.workflows() : Promise.resolve<Listing[]>([]),
      ]);
      updateMarketWorkflows(marketList);
      if (canFetchOwn && userAddr) {
        updateUserWorkflows(userAddr, ownList);
      } else {
        setUserWorkflowsState([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workflows');
    } finally {
      setLoading(false);
    }
  }, [updateMarketWorkflows, updateUserWorkflows, userAddr]);

  useEffect(() => {
    void refreshMarket();
  }, [refreshMarket]);

  const drafts = useMemo<SavedDraft[]>(
    () =>
      userWorkflows
        .filter((w) => !w.published)
        .map((w) => ({
          id: w.id,
          title: w.name,
          flow: listingToFlow(w),
          updatedAt: w.modified,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [userWorkflows],
  );

  const computeDefaultUnknownName = useCallback((): string => {
    return nextUnknownWorkflowName(
      userWorkflows.filter((w) => !w.published).map((w) => w.name),
    );
  }, [userWorkflows]);

  const saveDraftItem = useCallback(
    async (flow: Flow, title?: string, id?: string): Promise<SavedDraft> => {
      if (!authenticated()) {
        throw new Error('Sign in to save workflows.');
      }
      const targetId = id ?? flow.id;
      const otherNames = userWorkflows
        .filter((w) => !w.published && w.id !== targetId)
        .map((w) => w.name);
      const resolvedTitle =
        (title ?? flow.name ?? '').trim() || nextUnknownWorkflowName(otherNames);
      const nextFlow: Flow = {
        ...flow,
        id: targetId,
        name: resolvedTitle,
        modified: new Date().toISOString(),
      };

      const savedListing = await ensureDraftSavedOnBackend(nextFlow, otherNames);
      updateUserWorkflows(userAddr, (prev) => [
        savedListing,
        ...prev.filter((w) => w.id !== savedListing.id),
      ]);

      return {
        id: savedListing.id,
        title: savedListing.name,
        flow: listingToFlow(savedListing),
        updatedAt: savedListing.modified,
      };
    },
    [updateUserWorkflows, userAddr, userWorkflows],
  );

  const deleteDraftItem = useCallback(
    async (id: string) => {
      if (!authenticated()) {
        throw new Error('Sign in to delete drafts.');
      }
      const remoteDraft = userWorkflows.find((w) => w.id === id && !w.published);
      if (remoteDraft) {
        await api.remove(remoteDraft);
      }
      updateUserWorkflows(userAddr, (prev) => prev.filter((w) => w.id !== id));
    },
    [updateUserWorkflows, userAddr, userWorkflows],
  );

  const deletePublishedWorkflow = useCallback(
    async (listing: Listing) => {
      await api.remove(listing);
      updateMarketWorkflows((prev) => prev.filter((w) => w.id !== listing.id));
      updateUserWorkflows(userAddr, (prev) => prev.filter((w) => w.id !== listing.id));
    },
    [updateMarketWorkflows, updateUserWorkflows, userAddr],
  );

  return {
    drafts,
    userWorkflows,
    marketWorkflows,
    loading,
    error,
    refreshMarket,
    computeDefaultUnknownName,
    saveDraftItem,
    deleteDraftItem,
    deletePublishedWorkflow,
  };
}
