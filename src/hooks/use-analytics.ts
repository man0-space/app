import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { InferenceAnalytics } from '@compose-market/sdk';
import { fetchChains, type FacilitatorChain, type NetworkId } from '@compose-market/sdk/chains';
import { useAuth } from '../contexts/auth';
import {
  buildRollingAnalyticsFilters,
  emptyAnalyticsResponse,
  mapFeedItem,
  mapRequestRow,
  mergeAnalyticsResponses,
  summarize,
  type FeedItem,
  type RequestRow,
  type Summary,
} from '../lib/analytics';
import { compose } from '../lib/compose';
import { SessionContext } from './use-session';

type StableFilters = Omit<
  InferenceAnalytics.InferenceAnalyticsFilters,
  'from' | 'to' | 'networks'
>;

export type ActivityKind = 'requests' | 'settlements';

export interface UseSpentAnalyticsInput {
  rangeId: string;
  rangeMs: number;
  networks: readonly string[];
  filters: StableFilters;
}

export interface UseSpentAnalyticsReturn {
  owner: string | null;
  subjects: string[];
  summary: Summary | null;
  requests: RequestRow[];
  activity: FeedItem[];
  hasMoreRequests: boolean;
  hasMoreSettlements: boolean;
  isLoadingMore: boolean;
  loadMore: (kind: ActivityKind) => Promise<void>;
  isLoading: boolean;
  isRefetching: boolean;
  error: Error | null;
  forceRefresh: () => Promise<void>;
}

const FALLBACK_CHAINS: FacilitatorChain[] = [
  {
    name: 'NEAR Mainnet',
    shortName: 'NEAR',
    network: 'near:mainnet',
    namespace: 'near',
    isTestnet: false,
    explorer: 'https://nearblocks.io',
    rpcUrl: 'https://rpc.mainnet.near.org',
    assetAddress: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    schemes: ['exact', 'batch-settlement'],
    asset: 'USDC',
    decimals: 6,
  },
  {
    name: 'Base',
    shortName: 'Base',
    network: 'eip155:8453',
    namespace: 'eip155',
    isTestnet: false,
    explorer: 'https://basescan.org',
    rpcUrl: 'https://mainnet.base.org',
    assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    schemes: ['exact', 'batch-settlement'],
    asset: 'USDC',
    decimals: 6,
  },
  {
    name: 'Solana',
    shortName: 'Solana',
    network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    namespace: 'solana',
    isTestnet: false,
    explorer: 'https://solscan.io',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    assetAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    schemes: ['exact', 'batch-settlement'],
    asset: 'USDC',
    decimals: 6,
  },
];

let cachedChains: FacilitatorChain[] | null = null;
let chainsInFlight: Promise<FacilitatorChain[]> | null = null;

export function useFacilitatorChains(): {
  chains: Array<FacilitatorChain & { network: NetworkId }>;
  loading: boolean;
} {
  const [chains, setChains] = useState<FacilitatorChain[]>(() => cachedChains ?? FALLBACK_CHAINS);
  const [loading, setLoading] = useState<boolean>(() => cachedChains === null);

  useEffect(() => {
    if (cachedChains) {
      setChains(cachedChains);
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!chainsInFlight) {
      chainsInFlight = fetchChains({ baseUrl: compose.baseUrl })
        .then((res) => (Array.isArray(res.chains) && res.chains.length > 0 ? res.chains : FALLBACK_CHAINS))
        .catch(() => FALLBACK_CHAINS)
        .finally(() => {
          chainsInFlight = null;
        });
    }
    void chainsInFlight.then((resolved) => {
      cachedChains = resolved;
      if (!cancelled) {
        setChains(resolved);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const supported = useMemo(
    () =>
      [...chains]
        .filter((chain): chain is FacilitatorChain & { network: NetworkId } => Boolean(chain.network))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [chains],
  );

  return { chains: supported, loading };
}

function normalizeSubject(addr: string): string {
  const trimmed = addr.trim();
  return trimmed.startsWith('0x') ? trimmed.toLowerCase() : trimmed;
}

export function useSpentAnalytics(input: UseSpentAnalyticsInput): UseSpentAnalyticsReturn {
  const { user, links } = useAuth();
  const sessionCtx = useContext(SessionContext);
  const spendingAddress = sessionCtx?.spendingAddress ?? null;

  const subjects = useMemo<string[]>(() => {
    if (!user?.userAddress) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    const candidates = [
      spendingAddress,
      user.userAddress,
      ...links.filter((l) => l.status !== 'failed').map((l) => l.address),
    ];
    for (const raw of candidates) {
      if (!raw || !raw.trim()) continue;
      const norm = normalizeSubject(raw);
      const dedupKey = norm.toLowerCase();
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push(norm);
    }
    return out;
  }, [user?.userAddress, spendingAddress, links]);

  const owner = user?.userAddress ?? null;

  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const [extraRequests, setExtraRequests] = useState<RequestRow[]>([]);
  const [extraSettlements, setExtraSettlements] = useState<FeedItem[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const cursorsBySubjectRef = useRef<{
    requests: Map<string, string | null>;
    settlements: Map<string, string | null>;
  }>({
    requests: new Map(),
    settlements: new Map(),
  });

  const subjectsKey = subjects.join('|');
  const networksKey = [...input.networks].sort().join(',');
  const filtersKey = JSON.stringify(input.filters);
  const resetKey = `${subjectsKey}:${input.rangeId}:${networksKey}:${filtersKey}`;

  const hasSummaryRef = useRef(false);
  hasSummaryRef.current = summary !== null;

  const fetchSnapshot = useCallback(
    async (background = false) => {
      if (subjects.length === 0) {
        setSummary(null);
        setError(null);
        setIsLoading(false);
        setIsRefetching(false);
        return;
      }

      if (background || hasSummaryRef.current) setIsRefetching(true);
      else setIsLoading(true);

      try {
        const rollingFilters = buildRollingAnalyticsFilters({
          rangeMs: input.rangeMs,
          filters: input.filters,
          networks: input.networks,
        });

        const settled = await Promise.allSettled(
          subjects.map(async (subject) => ({
            subject,
            response: await compose.analytics.get(rollingFilters, { userAddress: subject }),
          })),
        );

        const fulfilled = settled
          .filter(
            (
              item,
            ): item is PromiseFulfilledResult<{
              subject: string;
              response: InferenceAnalytics.InferenceAnalyticsResponse;
            }> => item.status === 'fulfilled',
          )
          .map((item) => item.value);

        if (fulfilled.length === 0) {
          const firstRejected = settled.find(
            (item): item is PromiseRejectedResult => item.status === 'rejected',
          );
          const reason = firstRejected?.reason;
          throw reason instanceof Error
            ? reason
            : new Error('Unable to load inference spending telemetry.');
        }

        const reqCursors = new Map<string, string | null>();
        const setCursors = new Map<string, string | null>();
        for (const { subject, response } of fulfilled) {
          reqCursors.set(subject, response.requests.nextCursor);
          setCursors.set(subject, response.settlements.nextCursor);
        }
        cursorsBySubjectRef.current = {
          requests: reqCursors,
          settlements: setCursors,
        };

        const merged =
          fulfilled.length > 0
            ? mergeAnalyticsResponses(
              fulfilled.map((f) => f.response),
              rollingFilters,
            )
            : emptyAnalyticsResponse(rollingFilters);

        setSummary(summarize(merged));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsLoading(false);
        setIsRefetching(false);
      }
    },
    [subjectsKey, input.rangeMs, networksKey, filtersKey],
  );

  useEffect(() => {
    setExtraRequests([]);
    setExtraSettlements([]);
    cursorsBySubjectRef.current = { requests: new Map(), settlements: new Map() };
    void fetchSnapshot(hasSummaryRef.current);
  }, [resetKey, fetchSnapshot]);

  // Live SSE reconciliation via @compose-market/sdk analytics.subscribe + window focus/online
  useEffect(() => {
    if (subjects.length === 0) return;

    const controller = new AbortController();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void fetchSnapshot(true);
      }, 350);
    };

    for (const subject of subjects) {
      void (async () => {
        try {
          const stream = compose.analytics.subscribe({
            userAddress: subject,
            ...(input.networks.length > 0 ? { networks: [...input.networks] } : {}),
            signal: controller.signal,
          });
          for await (const event of stream) {
            if (controller.signal.aborted) break;
            if (event) scheduleRefresh();
          }
        } catch {
          // SSE stream disconnect or abort — silent fallback to focus/manual refresh
        }
      })();
    }

    const onFocus = () => scheduleRefresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      controller.abort();
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [subjectsKey, networksKey, fetchSnapshot]);

  const hasMoreRequests = useMemo(() => {
    if (!summary) return false;
    for (const c of cursorsBySubjectRef.current.requests.values()) {
      if (c) return true;
    }
    return Boolean(summary.response.requests.nextCursor);
  }, [summary, extraRequests.length]);

  const hasMoreSettlements = useMemo(() => {
    if (!summary) return false;
    for (const c of cursorsBySubjectRef.current.settlements.values()) {
      if (c) return true;
    }
    return Boolean(summary.response.settlements.nextCursor);
  }, [summary, extraSettlements.length]);

  const loadMore = useCallback(
    async (kind: ActivityKind) => {
      if (subjects.length === 0 || !summary || isLoadingMore) return;
      const cursorMap =
        kind === 'requests'
          ? cursorsBySubjectRef.current.requests
          : cursorsBySubjectRef.current.settlements;

      const activeEntries = [...cursorMap.entries()].filter(
        (entry): entry is [string, string] => Boolean(entry[1]),
      );
      if (activeEntries.length === 0) return;

      setIsLoadingMore(true);
      try {
        const rollingFilters = buildRollingAnalyticsFilters({
          rangeMs: input.rangeMs,
          filters: input.filters,
          networks: input.networks,
        });

        const pages = await Promise.allSettled(
          activeEntries.map(async ([subject, cursor]) => ({
            subject,
            response: await compose.analytics.get(
              {
                ...rollingFilters,
                [kind === 'requests' ? 'requestCursor' : 'settlementCursor']: cursor,
              },
              { userAddress: subject },
            ),
          })),
        );

        const nextRows: RequestRow[] = [];
        const nextReceipts: FeedItem[] = [];

        for (const res of pages) {
          if (res.status !== 'fulfilled') continue;
          const { subject, response } = res.value;
          if (kind === 'requests') {
            cursorMap.set(subject, response.requests.nextCursor);
            nextRows.push(...response.requests.data.map(mapRequestRow));
          } else {
            cursorMap.set(subject, response.settlements.nextCursor);
            nextReceipts.push(...response.settlements.data.map(mapFeedItem));
          }
        }

        if (kind === 'requests' && nextRows.length > 0) {
          setExtraRequests((prev) => {
            const seen = new Set<string>([
              ...summary.requests.map((r) => r.id),
              ...prev.map((r) => r.id),
            ]);
            const deduped = nextRows.filter((r) => !seen.has(r.id));
            return [...prev, ...deduped].sort((a, b) => b.startedAt - a.startedAt);
          });
        } else if (kind === 'settlements' && nextReceipts.length > 0) {
          setExtraSettlements((prev) => {
            const seen = new Set<string>([
              ...summary.activity.map((s) => s.id),
              ...prev.map((s) => s.id),
            ]);
            const deduped = nextReceipts.filter((s) => !seen.has(s.id));
            return [...prev, ...deduped].sort((a, b) => b.settledAt - a.settledAt);
          });
        }
      } finally {
        setIsLoadingMore(false);
      }
    },
    [subjectsKey, summary, isLoadingMore, input.rangeMs, networksKey, filtersKey],
  );

  const forceRefresh = useCallback(async () => {
    await fetchSnapshot(true);
  }, [fetchSnapshot]);

  return {
    owner,
    subjects,
    summary,
    requests: summary ? [...summary.requests, ...extraRequests] : [],
    activity: summary ? [...summary.activity, ...extraSettlements] : [],
    hasMoreRequests,
    hasMoreSettlements,
    isLoadingMore,
    loadMore,
    isLoading: Boolean(owner) && isLoading,
    isRefetching,
    error,
    forceRefresh,
  };
}
