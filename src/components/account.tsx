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

export function AccountChip() {
  const {
    user,
    busy,
    open,
    setOpen,
    refreshUser,
    logout,
    clear,
    links,
    linkBusy,
    linkError,
    linkWallet,
  } = useAuth();
  const {
    availableUsd,
    approvedUsd,
    totalUsd,
    hasApprovedLimit,
    loading: balanceLoading,
    approving,
    approvalStep,
    lastApprovalTxUrl,
    error: balanceError,
    refresh: refreshBalance,
    approveLimit,
    reclaimLimit,
  } = useSession();
  const { nickname, bio, avatar, banner, socials } = useProfile(user?.userAddress);

  const [editingProfile, setEditingProfile] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const [limitUsd, setLimitUsd] = useState('5');
  const limitTouchedRef = useRef(false);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);

  const [moneyPrompt, setMoneyPrompt] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [resolvedRoute, setResolvedRoute] = useState<IntentRoute | null>(null);
  const [liveLegs, setLiveLegs] = useState<IntentLeg[]>([]);
  const [legRuntime, setLegRuntime] = useState<Record<number, LegRuntimeState>>({});
  const [manualMode, setManualMode] = useState(false);
  const [swapStatus, setSwapStatus] = useState<IntentStatus | null>(null);
  const [moneyError, setMoneyError] = useState<string | null>(null);
  const [copiedDeposit, setCopiedDeposit] = useState<string | null>(null);
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);
  const [noFundedDialogOpen, setNoFundedDialogOpen] = useState(false);

  const pocketsRef = useRef<HTMLDivElement | null>(null);
  const fundPocketRef = useRef<HTMLDetailsElement | null>(null);
  const moneyInputRef = useRef<HTMLInputElement | null>(null);
  const limitInputId = useId();
  const moneyInputId = useId();

  const evmLinks = links.filter((item) => item.network !== 'svm');
  const svmLinks = links.filter((item) => item.network === 'svm');

  const handleLabel = user
    ? formatCreatorHandle(nickname || user.name, user.userAddress)
    : 'Sign in';

  const numericAvailableUsd = Number(availableUsd.replace(/[^0-9.]/g, '')) || 0;
  const numericTotalUsd = Number(totalUsd.replace(/[^0-9.]/g, '')) || 0;
  const smartAccountChipUsd =
    numericAvailableUsd >= 1
      ? '1'
      : numericAvailableUsd >= 0.5
        ? '0.50'
        : numericAvailableUsd >= 0.25
          ? '0.25'
          : numericAvailableUsd >= 0.05
            ? (Math.floor(numericAvailableUsd * 100) / 100).toFixed(2)
            : '0.25';

  useEffect(() => {
    if (limitTouchedRef.current || balanceLoading) return;
    if (numericTotalUsd > 0 && numericTotalUsd < 5) {
      const capped = Math.floor(numericTotalUsd * 100) / 100;
      if (capped >= 0.05) {
        setLimitUsd(capped % 1 === 0 ? String(capped) : capped.toFixed(2));
      }
    }
  }, [balanceLoading, numericTotalUsd]);

  useEffect(() => {
    if (!open) return;
    const container = pocketsRef.current;
    if (!container || Object.hasOwn(HTMLDetailsElement.prototype, 'name')) return;
    const onToggle = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || !target.open) return;
      if (target.getAttribute('name') !== POCKET_GROUP) return;
      for (const sibling of container.querySelectorAll<HTMLDetailsElement>(
        `details[name="${POCKET_GROUP}"]`,
      )) {
        if (sibling !== target) sibling.open = false;
      }
    };
    container.addEventListener('toggle', onToggle, true);
    return () => container.removeEventListener('toggle', onToggle, true);
  }, [open]);

  useEffect(() => {
    if (!open || liveLegs.length === 0 || !fundPocketRef.current) return;
    fundPocketRef.current.open = true;
  }, [open, liveLegs.length]);

  useEffect(() => {
    if (!open || liveLegs.length === 0) return;
    if (
      swapStatus?.status === 'SUCCESS' ||
      swapStatus?.status === 'REFUNDED' ||
      swapStatus?.status === 'FAILED'
    ) {
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const checks = await Promise.all(
          liveLegs.map((leg) =>
            leg.quote.depositAddress
              ? api.intentsStatus(leg.quote.depositAddress, leg.quote.depositMemo)
              : Promise.resolve<IntentStatus>({ status: 'PENDING_DEPOSIT' }),
          ),
        );
        if (!active || checks.length === 0) return;
        setLegRuntime((prev) => {
          const updated: Record<number, LegRuntimeState> = { ...prev };
          checks.forEach((st, idx) => {
            updated[idx] = {
              ...(updated[idx] ?? { state: 'idle' }),
              status: st,
            };
          });
          return updated;
        });
        const next = summarizeIntentStatuses(checks);
        setSwapStatus(next);
        if (next.status === 'SUCCESS') {
          await refreshBalance();
        }
      } catch {
        // Retry on next interval
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, liveLegs, swapStatus?.status, refreshBalance]);

}
