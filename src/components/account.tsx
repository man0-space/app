import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  LogOut,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../contexts/auth';
import { formatCreatorHandle, useProfile } from '../hooks/use-profile';
import { type ApprovalStep, useSession } from '../hooks/use-session';
import { api, Fault, type IntentLeg, type IntentRoute, type IntentStatus } from '../lib/api';
import {
  explorerAccountUrl,
  explorerTxUrl,
  externalWalletExplorerUrl,
  shortHash,
} from '../lib/contracts';
import {
  canAutoSendOrigin,
  executeIntentRoute,
  extractWalletErrorMessage,
  NO_FUNDED_WALLET_CODE,
  NO_FUNDED_WALLET_MESSAGE,
  resolveIntentRoute,
  routeLegs,
} from '../lib/intents';
import { Button } from './button';
import { Disclaimer } from './disclaimer';
import { Modal } from './modal';
import { CreatorProfileCard, ProfileModal } from './profile';
import { Tooltip } from './tooltip';

const LIMIT_PRESETS = ['2', '5', '10', '25'];
const POCKET_GROUP = 'account-pocket';

interface LegRuntimeState {
  state: 'idle' | 'sending' | 'sent';
  txHash?: string;
  intentHash?: string;
  status?: IntentStatus;
}

const TRANSFER_MILESTONES = [
  { id: 'ready', label: 'Route Ready' },
  { id: 'origin', label: 'Origin Tx' },
  { id: 'swap', label: 'Swap' },
  { id: 'credited', label: 'Credited' },
] as const;

function formatSwapState(
  status?: IntentStatus['status'],
  anySent?: boolean,
  anySending?: boolean,
): string {
  switch (status) {
    case 'KNOWN_DEPOSIT_TX':
      return 'Origin transfer detected — swapping…';
    case 'PROCESSING':
      return 'Cross-chain settlement in progress…';
    case 'SUCCESS':
      return 'Completed — balance credited';
    case 'REFUNDED':
      return 'Refunded to origin wallet';
    case 'FAILED':
    case 'INCOMPLETE_DEPOSIT':
      return 'Transfer incomplete';
    default:
      if (anySent) return 'Origin tx broadcast — awaiting solver…';
      if (anySending) return 'Confirming origin transfer…';
      return 'Listening for on-chain deposit…';
  }
}

function formatSessionStepLabel(step: ApprovalStep): string {
  switch (step) {
    case 'settling':
      return 'Reserving workflow limit on-chain…';
    case 'activating':
      return 'Activating session…';
    case 'reclaiming':
      return 'Returning unused funds on-chain…';
    default:
      return '';
  }
}

function sessionStepProgress(step: ApprovalStep): number {
  switch (step) {
    case 'settling':
      return 45;
    case 'activating':
      return 85;
    case 'reclaiming':
      return 65;
    default:
      return 100;
  }
}

function summarizeIntentStatuses(statuses: IntentStatus[]): IntentStatus {
  if (statuses.length === 0) {
    return { status: 'PENDING_DEPOSIT' };
  }
  const destTxs = statuses.flatMap((s) => s.swapDetails?.destinationChainTxHashes ?? []);
  const originTxs = statuses.flatMap((s) => s.swapDetails?.originChainTxHashes ?? []);
  if (statuses.every((s) => s.status === 'SUCCESS')) {
    return {
      status: 'SUCCESS',
      swapDetails:
        destTxs.length > 0 || originTxs.length > 0
          ? { destinationChainTxHashes: destTxs, originChainTxHashes: originTxs }
          : undefined,
    };
  }
  if (statuses.some((s) => s.status === 'FAILED' || s.status === 'INCOMPLETE_DEPOSIT')) {
    return { status: 'FAILED' };
  }
  if (statuses.some((s) => s.status === 'REFUNDED')) {
    return { status: 'REFUNDED' };
  }
  if (
    statuses.some(
      (s) =>
        s.status === 'PROCESSING' || s.status === 'KNOWN_DEPOSIT_TX' || s.status === 'SUCCESS',
    )
  ) {
    return {
      status: 'PROCESSING',
      swapDetails:
        destTxs.length > 0 || originTxs.length > 0
          ? { destinationChainTxHashes: destTxs, originChainTxHashes: originTxs }
          : undefined,
    };
  }
  return { status: 'PENDING_DEPOSIT' };
}

function buildOriginTxUrl(leg: IntentLeg, runtime?: LegRuntimeState): string | null {
  const fromStatus = runtime?.status?.swapDetails?.originChainTxHashes?.[0]?.explorerUrl;
  if (fromStatus) return fromStatus;
  const txHash = runtime?.txHash || runtime?.status?.swapDetails?.originChainTxHashes?.[0]?.hash;
  if (!txHash) return null;
  if (leg.originExplorerUrl) {
    try {
      const parsed = new URL(leg.originExplorerUrl);
      const cleanPath = parsed.pathname.replace(/\/+$/, '');
      parsed.pathname = `${cleanPath}/${leg.originWalletNetwork === 'near' ? 'txns' : 'tx'}/${txHash}`;
      return parsed.toString();
    } catch {
      return `${leg.originExplorerUrl.replace(/\/+$/, '')}/${leg.originWalletNetwork === 'near' ? 'txns' : 'tx'
        }/${txHash}`;
    }
  }
  if (leg.originWalletNetwork === 'near') {
    return explorerTxUrl(txHash);
  }
  return null;
}

function describeOriginOwner(leg: IntentLeg, handleLabel: string): string {
  if (
    leg.originWalletNetwork === 'near' ||
    leg.source === 'account' ||
    leg.source === 'intents'
  ) {
    return `Your Smart Account (${handleLabel})`;
  }
  if (leg.originWalletNetwork === 'evm') {
    return `Attached EVM (${shortHash(leg.originWalletAddress, 6, 4)})`;
  }
  return `Attached Solana (${shortHash(leg.originWalletAddress, 6, 4)})`;
}

function describeDestinationOwner(route: IntentRoute, handleLabel: string): string {
  if (route.action === 'withdraw') {
    return `Attached Wallet (${shortHash(route.recipientAddress, 6, 4)})`;
  }
  return `Your Smart Account (${handleLabel})`;
}
