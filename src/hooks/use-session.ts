import { createContext, useContext } from 'react';
import type { ActiveSessionMetadata } from '@compose-market/sdk';
import type { Network } from '../lib/compose';

export function formatMicroUsdc(wei: string | number | undefined | null): string {
  if (wei === undefined || wei === null || wei === '') return '$0.00';
  const n = Number(wei);
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  const usd = n / 1_000_000;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(6)}`;
}

export function parseUsdToMicroUsdc(usd: string): number | null {
  const value = Number(usd);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 1_000_000);
}

export type ApprovalStep = 'idle' | 'settling' | 'activating' | 'reclaiming';

export interface SessionContextValue {
  sessionState: ActiveSessionMetadata | null;
  spendingAddress: string | null;
  mainBalanceWei: string;
  spendingBalanceWei: string;
  totalBalanceWei: string;
  availableUsd: string;
  approvedUsd: string;
  totalUsd: string;
  hasApprovedLimit: boolean;
  loading: boolean;
  approving: boolean;
  approvalStep: ApprovalStep;
  lastApprovalTxUrl: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  approveLimit: (usdAmount: string) => Promise<void>;
  reclaimLimit: () => Promise<void>;
  getRunSession: () => Promise<{
    token: string;
    userAddress: string;
    network: Network;
  } | null>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('SessionProvider is missing.');
  }
  return ctx;
}
