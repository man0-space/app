import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveSessionMetadata } from '@compose-market/sdk';
import { useAuth } from '../contexts/auth';
import {
  type ApprovalStep,
  formatMicroUsdc,
  parseUsdToMicroUsdc,
  SessionContext,
} from '../hooks/use-session';
import { api } from '../lib/api';
import {
  activateSession,
  nearNetworkId,
  type Network,
  readSession,
  resetComposeSdk,
  revokeSession,
  sessionNetworkFor,
} from '../lib/compose';
import { explorerTxUrl } from '../lib/contracts';

const SESSION_BAL_CACHE_PREFIX = 'man0.session.bal.v1:';

interface CachedBalanceSnapshot {
  spendingAddress: string;
  mainBalanceWei: string;
  spendingBalanceWei: string;
  network: Network;
}

function readCachedBalance(userAddress?: string | null): CachedBalanceSnapshot | null {
  if (!userAddress || typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_BAL_CACHE_PREFIX}${userAddress.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedBalanceSnapshot> | null;
    if (!parsed || typeof parsed.spendingAddress !== 'string') return null;
    return {
      spendingAddress: parsed.spendingAddress,
      mainBalanceWei: typeof parsed.mainBalanceWei === 'string' ? parsed.mainBalanceWei : '0',
      spendingBalanceWei:
        typeof parsed.spendingBalanceWei === 'string' ? parsed.spendingBalanceWei : '0',
      network: parsed.network === 'near:mainnet' ? 'near:mainnet' : 'near:testnet',
    };
  } catch {
    return null;
  }
}

function writeCachedBalance(userAddress: string, snap: CachedBalanceSnapshot): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(
      `${SESSION_BAL_CACHE_PREFIX}${userAddress.toLowerCase()}`,
      JSON.stringify(snap),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userAddress = user?.userAddress ?? null;
  const initialBal = readCachedBalance(userAddress);

  const [sessionState, setSessionState] = useState<ActiveSessionMetadata | null>(null);
  const [spendingAddress, setSpendingAddress] = useState<string | null>(
    () => initialBal?.spendingAddress ?? userAddress,
  );
  const [sessionNetwork, setSessionNetwork] = useState<Network>(
    () => initialBal?.network ?? nearNetworkId(),
  );
  const [mainBalanceWei, setMainBalanceWei] = useState<string>(
    () => initialBal?.mainBalanceWei ?? '0',
  );
  const [spendingBalanceWei, setSpendingBalanceWei] = useState<string>(
    () => initialBal?.spendingBalanceWei ?? '0',
  );
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvalStep, setApprovalStep] = useState<ApprovalStep>('idle');
  const [lastApprovalTxUrl, setLastApprovalTxUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeUserRef = useRef<string | null>(userAddress);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    if (activeUserRef.current !== userAddress) {
      activeUserRef.current = userAddress;
      refreshSeqRef.current += 1;
      const cached = readCachedBalance(userAddress);
      setSessionState(null);
      setSpendingAddress(cached?.spendingAddress ?? userAddress);
      setSessionNetwork(cached?.network ?? nearNetworkId());
      setMainBalanceWei(cached?.mainBalanceWei ?? '0');
      setSpendingBalanceWei(cached?.spendingBalanceWei ?? '0');
      setLastApprovalTxUrl(null);
      setError(null);
      if (!userAddress) {
        resetComposeSdk();
      }
    }
  }, [userAddress]);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    const targetUser = userAddress;
    if (!targetUser) {
      resetComposeSdk();
      setSessionState(null);
      setSpendingAddress(null);
      setMainBalanceWei('0');
      setSpendingBalanceWei('0');
      setLastApprovalTxUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    const warm = readCachedBalance(targetUser);
    if (warm) {
      setSpendingAddress(warm.spendingAddress);
      setSessionNetwork(warm.network);
      setMainBalanceWei(warm.mainBalanceWei);
      setSpendingBalanceWei(warm.spendingBalanceWei);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const bal = await api.nearBalance();
      if (refreshSeqRef.current !== seq || activeUserRef.current !== targetUser) {
        return;
      }
      const net = sessionNetworkFor(bal.network);
      setSessionNetwork(net);
      setSpendingAddress(bal.spendingAddress);
      setMainBalanceWei(bal.mainBalanceWei);
      setSpendingBalanceWei(bal.spendingBalanceWei);
      writeCachedBalance(targetUser, {
        spendingAddress: bal.spendingAddress,
        mainBalanceWei: bal.mainBalanceWei,
        spendingBalanceWei: bal.spendingBalanceWei,
        network: net,
      });

      let active = await readSession(bal.spendingAddress, net).catch(() => null);
      if (refreshSeqRef.current !== seq || activeUserRef.current !== targetUser) {
        return;
      }
      const activeRemaining = BigInt(active?.budgetRemaining ?? '0');
      if (
        BigInt(bal.spendingBalanceWei) > 0n &&
        (!active?.hasSession ||
          !active.token ||
          !active.status?.isActive ||
          active.status.warnings?.budgetDepleted ||
          activeRemaining <= 0n)
      ) {
        await activateSession(bal.spendingAddress, bal.spendingBalanceWei, net);
        if (refreshSeqRef.current !== seq || activeUserRef.current !== targetUser) {
          return;
        }
        active = await readSession(bal.spendingAddress, net).catch(() => null);
      }
      if (refreshSeqRef.current === seq && activeUserRef.current === targetUser) {
        setSessionState(active);
      }
    } catch (err) {
      if (refreshSeqRef.current === seq && activeUserRef.current === targetUser) {
        setError(err instanceof Error ? err.message : 'Unable to load balance');
      }
    } finally {
      if (refreshSeqRef.current === seq && activeUserRef.current === targetUser) {
        setLoading(false);
      }
    }
  }, [userAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approveLimit = useCallback(
    async (usdAmount: string) => {
      if (!userAddress) {
        throw new Error('Sign in first.');
      }
      const amountMicro = parseUsdToMicroUsdc(usdAmount);
      if (!amountMicro) {
        throw new Error('Enter a valid USD amount.');
      }
      setApproving(true);
      setApprovalStep('settling');
      setError(null);
      setLastApprovalTxUrl(null);
      try {
        const result = await api.spendingApprove({
          amountWei: String(amountMicro),
        });
        const net = sessionNetworkFor(result.network);
        setSessionNetwork(net);
        setSpendingAddress(result.spendingAddress);
        setMainBalanceWei(result.mainBalanceWei);
        setSpendingBalanceWei(result.spendingBalanceWei);
        writeCachedBalance(userAddress, {
          spendingAddress: result.spendingAddress,
          mainBalanceWei: result.mainBalanceWei,
          spendingBalanceWei: result.spendingBalanceWei,
          network: net,
        });
        setLastApprovalTxUrl(
          result.txHash ? explorerTxUrl(result.txHash, result.network) : null,
        );

        setApprovalStep('activating');
        await activateSession(
          result.spendingAddress,
          result.spendingBalanceWei,
          net,
          30 * 24 * 60 * 60 * 1000,
          true,
        );
        const active = await readSession(result.spendingAddress, net).catch(() => null);
        setSessionState(active);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not approve workflow limit';
        setError(msg);
        throw err;
      } finally {
        setApprovalStep('idle');
        setApproving(false);
      }
    },
    [userAddress],
  );

  const reclaimLimit = useCallback(async () => {
    if (!userAddress) {
      throw new Error('Sign in first.');
    }
    setApproving(true);
    setApprovalStep('reclaiming');
    setError(null);
    try {
      if (spendingAddress) {
        await revokeSession(spendingAddress, sessionNetwork, sessionState?.keyId).catch(
          () => undefined,
        );
      }
      const result = await api.spendingReclaim();
      const net = sessionNetworkFor(result.network);
      setSessionNetwork(net);
      setSpendingAddress(result.spendingAddress);
      setMainBalanceWei(result.mainBalanceWei);
      setSpendingBalanceWei(result.spendingBalanceWei);
      writeCachedBalance(userAddress, {
        spendingAddress: result.spendingAddress,
        mainBalanceWei: result.mainBalanceWei,
        spendingBalanceWei: result.spendingBalanceWei,
        network: net,
      });
      setLastApprovalTxUrl(
        result.txHash ? explorerTxUrl(result.txHash, result.network) : null,
      );
      setSessionState(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not return unused funds';
      setError(msg);
      throw err;
    } finally {
      setApprovalStep('idle');
      setApproving(false);
    }
  }, [userAddress, spendingAddress, sessionNetwork, sessionState?.keyId]);

  const getRunSession = useCallback(async () => {
    if (!spendingAddress || BigInt(spendingBalanceWei) <= 0n) {
      return null;
    }
    const activeRemaining = BigInt(sessionState?.budgetRemaining ?? '0');
    if (
      sessionState?.hasSession &&
      sessionState.token &&
      sessionState.status?.isActive &&
      !sessionState.status.warnings?.budgetDepleted &&
      activeRemaining > 0n
    ) {
      return {
        token: sessionState.token,
        userAddress: spendingAddress,
        network: sessionNetwork,
      };
    }
    const created = await activateSession(
      spendingAddress,
      spendingBalanceWei,
      sessionNetwork,
    );
    const active = await readSession(spendingAddress, sessionNetwork).catch(() => null);
    setSessionState(active);
    return {
      token: created.token,
      userAddress: spendingAddress,
      network: sessionNetwork,
    };
  }, [spendingAddress, spendingBalanceWei, sessionState, sessionNetwork]);

  const totalBalanceWei = useMemo(
    () => (BigInt(mainBalanceWei || '0') + BigInt(spendingBalanceWei || '0')).toString(),
    [mainBalanceWei, spendingBalanceWei],
  );

  const availableUsd = useMemo(() => formatMicroUsdc(mainBalanceWei), [mainBalanceWei]);
  const approvedUsd = useMemo(() => formatMicroUsdc(spendingBalanceWei), [spendingBalanceWei]);
  const totalUsd = useMemo(() => formatMicroUsdc(totalBalanceWei), [totalBalanceWei]);
  const hasApprovedLimit = useMemo(
    () => BigInt(spendingBalanceWei || '0') > 0n,
    [spendingBalanceWei],
  );

  const value = useMemo(
    () => ({
      sessionState,
      spendingAddress,
      mainBalanceWei,
      spendingBalanceWei,
      totalBalanceWei,
      availableUsd,
      approvedUsd,
      totalUsd,
      hasApprovedLimit,
      loading,
      approving,
      approvalStep,
      lastApprovalTxUrl,
      error,
      refresh,
      approveLimit,
      reclaimLimit,
      getRunSession,
    }),
    [
      sessionState,
      spendingAddress,
      mainBalanceWei,
      spendingBalanceWei,
      totalBalanceWei,
      availableUsd,
      approvedUsd,
      totalUsd,
      hasApprovedLimit,
      loading,
      approving,
      approvalStep,
      lastApprovalTxUrl,
      error,
      refresh,
      approveLimit,
      reclaimLimit,
      getRunSession,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
