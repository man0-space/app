import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
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
