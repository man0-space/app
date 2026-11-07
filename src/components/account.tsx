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

  async function handleApproveLimit(event: FormEvent) {
    event.preventDefault();
    setLimitError(null);
    setLimitNotice(null);
    const added = Number(limitUsd);
    const previousApproved =
      Number((approvedUsd || '0').replace(/[^0-9.]/g, '')) || 0;
    try {
      await approveLimit(limitUsd);
      const nextTotal = previousApproved + (Number.isFinite(added) ? added : 0);
      setLimitNotice(
        `Added $${added.toFixed(2)} — $${nextTotal.toFixed(2)} total approved for workflows.`,
      );
    } catch (err) {
      setLimitError(err instanceof Error ? err.message : 'Could not approve limit');
    }
  }

  async function handleReclaim() {
    setLimitError(null);
    setLimitNotice(null);
    try {
      await reclaimLimit();
      setLimitNotice('Unused workflow funds returned to your available balance.');
    } catch (err) {
      setLimitError(err instanceof Error ? err.message : 'Could not return unused funds');
    }
  }

  function resetTransferFlow() {
    setResolvedRoute(null);
    setLiveLegs([]);
    setLegRuntime({});
    setManualMode(false);
    setSwapStatus(null);
    setMoneyError(null);
  }

  async function runMoneyPreview(promptText: string) {
    if (!user) return;
    const clean = promptText.trim();
    if (!clean) return;
    setMoneyPrompt(clean);
    setPreviewBusy(true);
    setMoneyError(null);
    setLiveLegs([]);
    setLegRuntime({});
    setManualMode(false);
    setSwapStatus(null);
    try {
      const route = await resolveIntentRoute({
        prompt: clean,
        dry: true,
        links,
      });
      setResolvedRoute(route);
    } catch (err) {
      setResolvedRoute(null);
      if (err instanceof Fault && err.code === NO_FUNDED_WALLET_CODE) {
        setNoFundedDialogOpen(true);
        return;
      }
      setMoneyError(extractWalletErrorMessage(err, 'Unable to find a route'));
    } finally {
      setPreviewBusy(false);
    }
  }

  function applyPromptTemplate(template: string, autoPreview: boolean) {
    setMoneyPrompt(template);
    if (autoPreview) {
      void runMoneyPreview(template);
    } else {
      setResolvedRoute(null);
      setLiveLegs([]);
      setLegRuntime({});
      setSwapStatus(null);
      setMoneyError(null);
      window.requestAnimationFrame(() => {
        moneyInputRef.current?.focus();
      });
    }
  }

  async function handlePrepareOrSend(mode: 'wallet' | 'address') {
    if (!user || !resolvedRoute) return;
    setTransferBusy(true);
    setMoneyError(null);
    let anyLegSent = Object.values(legRuntime).some((r) => r.state === 'sent');
    try {
      let committed = resolvedRoute;
      let legs = liveLegs;

      if (legs.length === 0 || legs.some((l) => !l.quote.depositAddress)) {
        committed = await resolveIntentRoute({
          prompt: moneyPrompt,
          dry: false,
          links,
        });
        legs = routeLegs(committed);
        if (legs.length === 0 || legs.some((l) => !l.quote.depositAddress)) {
          throw new Error('Could not generate transfer address. Try again.');
        }

        const initialRuntime: Record<number, LegRuntimeState> = {};
        legs.forEach((_, idx) => {
          initialRuntime[idx] = { state: 'idle' };
        });

        setResolvedRoute(committed);
        setLiveLegs(legs);
        setLegRuntime(initialRuntime);
        setSwapStatus({ status: 'PENDING_DEPOSIT' });
      }

      setManualMode(mode === 'address');

      if (mode === 'wallet') {
        await executeIntentRoute(committed, (idx, update) => {
          if (update.state === 'sent') {
            anyLegSent = true;
          }
          setLegRuntime((prev) => ({
            ...prev,
            [idx]: {
              ...(prev[idx] ?? { state: 'idle' }),
              state: update.state,
              ...(update.txHash ? { txHash: update.txHash } : {}),
              ...(update.intentHash ? { intentHash: update.intentHash } : {}),
            },
          }));
        });
        setSwapStatus((prev) =>
          prev?.status === 'SUCCESS' ? prev : { status: 'PROCESSING' },
        );
        await refreshBalance();
      }
    } catch (err) {
      if (!anyLegSent && mode === 'wallet') {
        setLiveLegs([]);
        setLegRuntime({});
        setManualMode(false);
        setSwapStatus(null);
      }
      if (err instanceof Fault && err.code === NO_FUNDED_WALLET_CODE) {
        setNoFundedDialogOpen(true);
        return;
      }
      setMoneyError(extractWalletErrorMessage(err, 'Transfer could not be completed'));
    } finally {
      setTransferBusy(false);
    }
  }

  async function handleCopyDeposit(address: string) {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopiedDeposit(address);
    window.setTimeout(() => setCopiedDeposit(null), 1800);
  }

  async function handleCopyWallet(address: string) {
    if (!address) return;
    await navigator.clipboard?.writeText(address);
    setCopiedWallet(address);
    window.setTimeout(
      () => setCopiedWallet((prev) => (prev === address ? null : prev)),
      1800,
    );
  }

  const previewLegs = resolvedRoute ? routeLegs(resolvedRoute) : [];
  const anyOriginSent = Object.values(legRuntime).some((r) => r.state === 'sent');
  const anyOriginSending = Object.values(legRuntime).some((r) => r.state === 'sending');
  const isTransferSuccess = swapStatus?.status === 'SUCCESS';
  const isTransferFailed =
    swapStatus?.status === 'FAILED' ||
    swapStatus?.status === 'INCOMPLETE_DEPOSIT' ||
    swapStatus?.status === 'REFUNDED';
  const awaitingManualDeposit =
    manualMode &&
    !anyOriginSent &&
    !anyOriginSending &&
    (!swapStatus || swapStatus.status === 'PENDING_DEPOSIT');

  const activeMilestoneIndex = (() => {
    if (isTransferSuccess) return 4; // all 4 complete
    if (
      swapStatus?.status === 'PROCESSING' ||
      swapStatus?.status === 'KNOWN_DEPOSIT_TX'
    ) {
      return 2; // step 0 & 1 complete, step 2 ("Swap") active
    }
    if (anyOriginSent) {
      return 2; // origin broadcast complete, waiting on cross-chain solver
    }
    if (anyOriginSending || transferBusy) {
      return 1; // Origin Tx active
    }
    return 0; // Route Ready
  })();

  const transferProgressPct = isTransferSuccess
    ? 100
    : swapStatus?.status === 'PROCESSING' || swapStatus?.status === 'KNOWN_DEPOSIT_TX'
      ? 82
      : anyOriginSent
        ? 60
        : activeMilestoneIndex === 1
          ? 35
          : 20;

  const destinationTx = swapStatus?.swapDetails?.destinationChainTxHashes?.[0];
  const hasManualDepositOption = Boolean(
    resolvedRoute &&
    previewLegs.some(
      (leg) => leg.depositType === 'ORIGIN_CHAIN' && leg.originWalletNetwork !== 'near',
    ),
  );

  const primaryActionLabel = (() => {
    if (!resolvedRoute) return 'Send';
    if (resolvedRoute.action === 'withdraw') return 'Withdraw Now';
    if (resolvedRoute.action === 'swap') return 'Swap Now';
    const outAmt = resolvedRoute.totalOutFormatted || resolvedRoute.quote.amountOutFormatted;
    return outAmt ? `Fund ~$${outAmt}` : 'Fund Account';
  })();

  return (
    <>
      <Tooltip
        label={user ? `Account & Balance (${totalUsd})` : 'Sign in'}
        description={
          user
            ? `${availableUsd} available · ${approvedUsd} approved for workflows`
            : 'Sign in with passkey, email, or social'
        }
      >
        <button
          type="button"
          aria-label={user ? `Account ${handleLabel} balance ${totalUsd}` : 'Sign in'}
          className={`account-chip stealth-glass ${user ? 'is-connected' : ''}`.trim()}
          onClick={() => {
            clear();
            setOpen(true);
          }}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : user ? (
            <>
              <span className="account-chip-gem accent-gold" aria-hidden="true">
                ◆
              </span>
              <span className="account-chip-balance">
                {balanceLoading ? '...' : totalUsd}
              </span>
              <span className="account-chip-sep" aria-hidden="true">
                ·
              </span>
              {avatar || user.image ? (
                <span className="account-chip-avatar">
                  <img src={(avatar || user.image)!} alt="" />
                </span>
              ) : null}
              <span className="account-chip-label">{handleLabel}</span>
            </>
          ) : (
            <>
              <UserRound size={14} />
              <span className="account-chip-label">Sign in</span>
            </>
          )}
        </button>
      </Tooltip>

      {open && user ? (
        <Modal
          title="Account"
          close={() => setOpen(false)}
          size="md"
          headerActions={
            <Button
              icon={<RefreshCw size={13} className={balanceLoading ? 'spin' : ''} />}
              tooltip="Refresh balance"
              size="xs"
              onClick={() => {
                void refreshUser().catch(() => undefined);
                void refreshBalance();
              }}
            />
          }
        >
          <div className="account-panel">
            <CreatorProfileCard
              variant="account"
              compact
              address={user.userAddress}
              nickname={nickname || user.name}
              avatar={avatar || user.image}
              bio={bio || user.bio}
              banner={banner || user.banner}
              socials={socials.length > 0 ? socials : user.socials}
              onEdit={() => {
                setOpen(false);
                setEditingProfile(true);
              }}
            />

            <div ref={pocketsRef} className="account-pockets" aria-label="Account sections">
              <div className="account-wallet-row" aria-label="Primary NEAR wallet">
                <span className="account-pocket-lead">
                  <Wallet size={13} aria-hidden="true" />
                  <span className="account-pocket-title">NEAR</span>
                </span>
                <div className="account-wallet-controls">
                  <span className="account-pocket-badge is-connected">
                    <span className="account-pocket-dot" aria-hidden="true" />
                    {shortHash(user.userAddress, 6, 4)}
                  </span>
                  <Tooltip
                    label={copiedWallet === user.userAddress ? 'Copied' : 'Copy NEAR address'}
                    description={user.userAddress}
                  >
                    <button
                      type="button"
                      className="account-wallet-icon-btn"
                      onClick={() => void handleCopyWallet(user.userAddress)}
                      aria-label="Copy NEAR wallet address"
                    >
                      {copiedWallet === user.userAddress ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  </Tooltip>
                  <Tooltip label="View on Explorer" description={user.userAddress}>
                    <a
                      href={explorerAccountUrl(user.userAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="account-wallet-icon-btn"
                      aria-label="View NEAR wallet on explorer"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </Tooltip>
                </div>
              </div>

              {(
                [
                  { id: 'evm' as const, label: 'EVM', items: evmLinks },
                  { id: 'svm' as const, label: 'SVM', items: svmLinks },
                ] as const
              ).map((net) => (
                <details key={net.id} name={POCKET_GROUP} className="account-pocket">
                  <summary className="account-pocket-summary">
                    <span className="account-pocket-lead">
                      <ChevronRight size={13} className="account-pocket-chevron" aria-hidden="true" />
                      <Wallet size={13} aria-hidden="true" />
                      <span className="account-pocket-title">{net.label}</span>
                    </span>
                    <span className="account-pocket-meta">
                      {net.items.length === 1 ? (
                        <span className="account-pocket-badge is-connected">
                          <span className="account-pocket-dot" aria-hidden="true" />
                          {shortHash(net.items[0]!.address, 6, 4)}
                        </span>
                      ) : net.items.length > 1 ? (
                        <span className="account-pocket-badge is-connected">
                          <span className="account-pocket-dot" aria-hidden="true" />
                          {net.items.length} linked
                        </span>
                      ) : (
                        <span className="account-pocket-badge">None</span>
                      )}
                    </span>
                  </summary>
                  <div className="account-pocket-body">
                    {net.items.length > 0 ? (
                      <div className="account-links-row">
                        {net.items.map((item) => {
                          const itemCopied = copiedWallet === item.address;
                          return (
                            <div key={item.id} className="account-link-item">
                              <code>{shortHash(item.address, 6, 4)}</code>
                              <div className="account-link-actions">
                                <span className="status-pill is-ready">Attached</span>
                                <Tooltip
                                  label={itemCopied ? 'Copied' : `Copy ${net.label} address`}
                                  description={item.address}
                                >
                                  <button
                                    type="button"
                                    className="account-wallet-icon-btn"
                                    onClick={() => void handleCopyWallet(item.address)}
                                    aria-label={`Copy ${net.label} wallet address`}
                                  >
                                    {itemCopied ? <Check size={11} /> : <Copy size={11} />}
                                  </button>
                                </Tooltip>
                                <Tooltip
                                  label={`View ${net.label} on Explorer`}
                                  description={item.address}
                                >
                                  <a
                                    href={externalWalletExplorerUrl(net.id, item.address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="account-wallet-icon-btn"
                                    aria-label={`View ${net.label} wallet on explorer`}
                                  >
                                    <ExternalLink size={11} />
                                  </a>
                                </Tooltip>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <div className="account-pocket-actions">
                      <Button
                        variant="ghost"
                        size="xs"
                        tooltip={false}
                        disabled={linkBusy}
                        onClick={() => void linkWallet(net.id)}
                      >
                        + Attach {net.label}
                      </Button>
                    </div>

                    {linkError ? (
                      <p className="form-error" role="alert">
                        {linkError}
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}

              <details name={POCKET_GROUP} className="account-pocket">
                <summary className="account-pocket-summary">
                  <span className="account-pocket-lead">
                    <ChevronRight size={13} className="account-pocket-chevron" aria-hidden="true" />
                    <span className="account-pocket-title">Session</span>
                  </span>
                  <span className="account-pocket-meta">
                    <span className="account-pocket-stat">{availableUsd} available</span>
                    <span className="account-chip-sep" aria-hidden="true">
                      ·
                    </span>
                    <span
                      className={`account-pocket-stat ${hasApprovedLimit ? 'accent-gold' : ''}`}
                    >
                      {approvedUsd} limit
                    </span>
                  </span>
                </summary>
                <div className="account-pocket-body">
                  <div className="stat-card-grid">
                    <div className="stat-box">
                      <span className="stat-label">Available</span>
                      <span className="stat-val">{availableUsd}</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-label">Approved</span>
                      <span className={`stat-val ${hasApprovedLimit ? 'accent-gold' : ''}`}>
                        {approvedUsd}
                      </span>
                    </div>
                  </div>

                  <form className="account-limit-row" onSubmit={handleApproveLimit}>
                    <div className="preset-row">
                      {LIMIT_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`chip-btn ${limitUsd === preset ? 'is-active' : ''}`}
                          onClick={() => {
                            limitTouchedRef.current = true;
                            setLimitUsd(preset);
                          }}
                        >
                          ${preset}
                        </button>
                      ))}
                    </div>

                    <div className="account-limit-controls">
                      <label htmlFor={limitInputId} className="visually-hidden">
                        Workflow spending limit in USD
                      </label>
                      <input
                        id={limitInputId}
                        type="number"
                        step="0.01"
                        min="0.05"
                        className="input account-limit-input"
                        value={limitUsd}
                        onChange={(event) => {
                          limitTouchedRef.current = true;
                          setLimitUsd(event.target.value);
                        }}
                        placeholder="5.00"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        tooltip={false}
                        icon={
                          approving ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <Check size={13} />
                          )
                        }
                        disabled={approving}
                      >
                        Approve
                      </Button>
                      {hasApprovedLimit ? (
                        <Button
                          icon={<RotateCcw size={13} />}
                          tooltip="Reclaim unused funds"
                          size="sm"
                          disabled={approving}
                          onClick={() => void handleReclaim()}
                        />
                      ) : null}
                    </div>
                  </form>

                  {approving ? (
                    <div className="onchain-progress-card">
                      <progress
                        className="onchain-progress-track"
                        max={100}
                        value={sessionStepProgress(approvalStep)}
                        aria-label="Session limit on-chain settlement"
                      />
                      <div className="onchain-progress-status" role="status" aria-live="polite">
                        <span>{formatSessionStepLabel(approvalStep)}</span>
                        <span className="wf-meta-text">{sessionStepProgress(approvalStep)}%</span>
                      </div>
                    </div>
                  ) : limitNotice ? (
                    <div className="onchain-progress-status" role="status" aria-live="polite">
                      <span className="account-notice">{limitNotice}</span>
                      {lastApprovalTxUrl ? (
                        <a
                          href={lastApprovalTxUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-xs"
                        >
                          <span>Receipt</span>
                          <ExternalLink size={11} />
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {limitError || balanceError ? (
                    <p className="form-error" role="alert">
                      {limitError || balanceError}
                    </p>
                  ) : null}
                </div>
              </details>

              <details ref={fundPocketRef} name={POCKET_GROUP} className="account-pocket">
                <summary className="account-pocket-summary">
                  <span className="account-pocket-lead">
                    <ChevronRight size={13} className="account-pocket-chevron" aria-hidden="true" />
                    <span className="account-pocket-title">Fund / Swap</span>
                  </span>
                  {liveLegs.length > 0 ? (
                    <span className="account-pocket-meta">
                      <span
                        className={`status-pill ${isTransferSuccess ? 'is-ready' : ''}`}
                      >
                        {isTransferSuccess
                          ? 'Credited'
                          : awaitingManualDeposit
                            ? 'Awaiting Deposit'
                            : `${transferProgressPct}%`}
                      </span>
                    </span>
                  ) : null}
                </summary>
                <div className="account-pocket-body">
                  <div className="fund-quick-header">
                    <div className="preset-row" role="group" aria-label="Quick transfer presets">
                      <button
                        type="button"
                        className="chip-btn"
                        disabled={previewBusy || transferBusy}
                        onClick={() => applyPromptTemplate('Deposit $2', true)}
                      >
                        +$2
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        disabled={previewBusy || transferBusy}
                        onClick={() => applyPromptTemplate('Deposit $5', true)}
                      >
                        +$5
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        disabled={previewBusy || transferBusy}
                        onClick={() => applyPromptTemplate('Deposit $10', true)}
                      >
                        +$10
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        disabled={previewBusy || transferBusy}
                        onClick={() =>
                          applyPromptTemplate(`Swap $${smartAccountChipUsd} to NEAR`, true)
                        }
                      >
                        Swap
                      </button>
                      <button
                        type="button"
                        className="chip-btn"
                        disabled={previewBusy || transferBusy}
                        onClick={() =>
                          applyPromptTemplate(
                            svmLinks.length > 0 && evmLinks.length === 0
                              ? `Withdraw $${smartAccountChipUsd} to Solana`
                              : `Withdraw $${smartAccountChipUsd} to my EVM wallet`,
                            true,
                          )
                        }
                      >
                        Withdraw
                      </button>
                    </div>
                    <span className="fund-sources-hint">
                      {links.length > 0
                        ? `Sources: ${[
                          ...evmLinks.map((l) => `EVM ${shortHash(l.address, 4, 4)}`),
                          ...svmLinks.map((l) => `SVM ${shortHash(l.address, 4, 4)}`),
                        ].join(' · ')}`
                        : 'Attach EVM or SVM above to fund from external chains'}
                    </span>
                  </div>

                  <form
                    className="account-money-bar"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runMoneyPreview(moneyPrompt);
                    }}
                  >
                    <label htmlFor={moneyInputId} className="visually-hidden">
                      Transfer amount and network
                    </label>
                    <input
                      ref={moneyInputRef}
                      id={moneyInputId}
                      type="text"
                      className="input"
                      value={moneyPrompt}
                      onChange={(event) => setMoneyPrompt(event.target.value)}
                      placeholder="Deposit $5, Swap $1 to SOL, or Withdraw $2…"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      icon={
                        previewBusy ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <ArrowRight size={13} />
                        )
                      }
                      tooltip="Find route"
                      disabled={previewBusy || transferBusy || !moneyPrompt.trim()}
                    />
                  </form>

                  {previewBusy ? (
                    <div className="onchain-progress-card">
                      <progress
                        className="onchain-progress-track"
                        aria-label="Scanning balances and finding optimal route"
                      />
                      <div className="onchain-progress-status" role="status" aria-live="polite">
                        <span>Scanning balances &amp; finding optimal route…</span>
                      </div>
                    </div>
                  ) : null}

                  {resolvedRoute && !previewBusy ? (
                    <div className="quote-box">
                      <div className="route-ownership-list">
                        {previewLegs.map((leg, idx) => (
                          <div
                            key={`${leg.originToken.assetId}-${idx}`}
                            className="route-ownership-row"
                          >
                            <span className="route-ownership-tag">From</span>
                            <span className="route-ownership-party">
                              <strong>{describeOriginOwner(leg, handleLabel)}</strong>
                              <span className="wf-meta-text"> · {leg.originChainLabel}</span>
                            </span>
                            <span className="route-ownership-amount">{leg.displayAmount}</span>
                          </div>
                        ))}
                        <div className="route-ownership-row is-destination">
                          <span className="route-ownership-tag is-to">To</span>
                          <span className="route-ownership-party">
                            <strong>{describeDestinationOwner(resolvedRoute, handleLabel)}</strong>
                            <span className="wf-meta-text">
                              {' '}
                              · {resolvedRoute.destinationChainLabel} (~
                              {resolvedRoute.quote.timeEstimate || 25}s)
                            </span>
                          </span>
                          <span className="route-ownership-amount accent-gold">
                            ~
                            {resolvedRoute.totalOutFormatted ||
                              resolvedRoute.quote.amountOutFormatted}{' '}
                            {resolvedRoute.action === 'deposit'
                              ? 'USD'
                              : resolvedRoute.destinationToken.symbol}
                          </span>
                        </div>
                      </div>

                      {liveLegs.length === 0 ? (
                        <div className="account-quote-actions">
                          {canAutoSendOrigin(resolvedRoute) ? (
                            <Button
                              variant="primary"
                              size="sm"
                              tooltip={false}
                              icon={
                                transferBusy ? (
                                  <LoaderCircle size={13} className="spin" />
                                ) : (
                                  <Send size={13} />
                                )
                              }
                              disabled={transferBusy}
                              onClick={() => void handlePrepareOrSend('wallet')}
                            >
                              {primaryActionLabel}
                            </Button>
                          ) : null}
                          {hasManualDepositOption ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              tooltip={false}
                              icon={<Copy size={13} />}
                              disabled={transferBusy}
                              onClick={() => void handlePrepareOrSend('address')}
                            >
                              Manual Deposit Address
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="account-transfer-live">
                          {awaitingManualDeposit ? (
                            <div className="onchain-progress-card">
                              <progress
                                className="onchain-progress-track"
                                aria-label="Listening for manual on-chain deposit"
                              />
                              <div
                                className="onchain-progress-status"
                                role="status"
                                aria-live="polite"
                              >
                                <span>
                                  Send exact amount to the bridge address below — settlement starts
                                  automatically once detected.
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="onchain-progress-card">
                              <progress
                                className={`onchain-progress-track ${isTransferSuccess
                                  ? 'is-complete'
                                  : isTransferFailed
                                    ? 'is-failed'
                                    : ''
                                  }`.trim()}
                                max={100}
                                value={transferProgressPct}
                                aria-label="On-chain transfer progress"
                              />
                              <ol className="onchain-milestones" aria-label="Transfer milestones">
                                {TRANSFER_MILESTONES.map((step, idx) => {
                                  const state =
                                    idx < activeMilestoneIndex
                                      ? 'done'
                                      : idx === activeMilestoneIndex
                                        ? isTransferFailed
                                          ? 'failed'
                                          : 'active'
                                        : 'pending';
                                  return (
                                    <li
                                      key={step.id}
                                      className={`onchain-milestone is-${state}`}
                                    >
                                      <span className="onchain-milestone-dot" aria-hidden="true">
                                        {state === 'done' ? <Check size={9} /> : null}
                                      </span>
                                      <span className="onchain-milestone-label">{step.label}</span>
                                    </li>
                                  );
                                })}
                              </ol>
                            </div>
                          )}

                          <div className="onchain-legs-list">
                            {liveLegs.map((leg, idx) => {
                              const rt = legRuntime[idx];
                              const originTxUrl = buildOriginTxUrl(leg, rt);
                              const legDestTx =
                                rt?.status?.swapDetails?.destinationChainTxHashes?.[0]?.explorerUrl;
                              const showManualBox =
                                (manualMode || !canAutoSendOrigin(resolvedRoute)) &&
                                leg.depositType === 'ORIGIN_CHAIN' &&
                                leg.originWalletNetwork !== 'near' &&
                                Boolean(leg.quote.depositAddress);

                              return (
                                <div
                                  key={leg.quote.depositAddress ?? idx}
                                  className="onchain-leg-item"
                                >
                                  <div className="onchain-leg-row">
                                    <span className="onchain-leg-desc">
                                      {leg.displayAmount} · {leg.originChainLabel}
                                    </span>
                                    <span className="onchain-leg-links">
                                      {originTxUrl ? (
                                        <a
                                          href={originTxUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="btn btn-ghost btn-xs"
                                        >
                                          <span>Tx</span>
                                          <ExternalLink size={10} />
                                        </a>
                                      ) : null}
                                      {legDestTx ? (
                                        <a
                                          href={legDestTx}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="btn btn-ghost btn-xs"
                                        >
                                          <span>Receipt</span>
                                          <ExternalLink size={10} />
                                        </a>
                                      ) : null}
                                    </span>
                                  </div>

                                  {showManualBox && leg.quote.depositAddress ? (
                                    <div className="manual-deposit-wrap">
                                      <span className="manual-deposit-caption">
                                        One-time bridge address on {leg.originChainLabel} — send
                                        exact {leg.displayAmount}:
                                      </span>
                                      <div className="copy-bar">
                                        <code className="copy-bar-code">
                                          {leg.quote.depositAddress}
                                          {leg.quote.depositMemo
                                            ? ` (Memo: ${leg.quote.depositMemo})`
                                            : ''}
                                        </code>
                                        <Button
                                          icon={
                                            copiedDeposit === leg.quote.depositAddress ? (
                                              <Check size={13} />
                                            ) : (
                                              <Copy size={13} />
                                            )
                                          }
                                          tooltip={
                                            copiedDeposit === leg.quote.depositAddress
                                              ? 'Copied'
                                              : 'Copy deposit address'
                                          }
                                          size="xs"
                                          onClick={() =>
                                            void handleCopyDeposit(leg.quote.depositAddress!)
                                          }
                                        />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>

                          <div
                            className="onchain-progress-status"
                            role="status"
                            aria-live="polite"
                          >
                            <span
                              className={`status-pill ${isTransferSuccess ? 'is-ready' : ''}`}
                            >
                              {formatSwapState(
                                swapStatus?.status,
                                anyOriginSent,
                                anyOriginSending,
                              )}
                            </span>
                            <span className="onchain-leg-links">
                              {destinationTx?.explorerUrl && liveLegs.length === 1 ? null : destinationTx?.explorerUrl ? (
                                <a
                                  href={destinationTx.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-ghost btn-xs"
                                >
                                  <span>Settlement</span>
                                  <ExternalLink size={11} />
                                </a>
                              ) : null}
                              {awaitingManualDeposit && canAutoSendOrigin(resolvedRoute) ? (
                                <Button
                                  variant="primary"
                                  size="xs"
                                  tooltip={false}
                                  icon={
                                    transferBusy ? (
                                      <LoaderCircle size={11} className="spin" />
                                    ) : (
                                      <Send size={11} />
                                    )
                                  }
                                  disabled={transferBusy}
                                  onClick={() => void handlePrepareOrSend('wallet')}
                                >
                                  {primaryActionLabel}
                                </Button>
                              ) : null}
                              {isTransferSuccess || isTransferFailed || manualMode ? (
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  tooltip={false}
                                  onClick={resetTransferFlow}
                                >
                                  New Transfer
                                </Button>
                              ) : null}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {moneyError ? (
                    <p className="form-error" role="alert">
                      {moneyError}
                    </p>
                  ) : null}
                </div>
              </details>
            </div>

            <footer className="account-sheet-footer">
              <Button
                variant="ghost"
                size="xs"
                tooltip={false}
                icon={<ShieldCheck size={13} aria-hidden="true" />}
                onClick={() => {
                  setOpen(false);
                  setShowTerms(true);
                }}
              >
                Terms
              </Button>
              <Button
                variant="danger"
                size="xs"
                tooltip={false}
                icon={<LogOut size={13} aria-hidden="true" />}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  void logout().catch(() => { });
                }}
              >
                Sign Out
              </Button>
            </footer>
          </div>
        </Modal>
      ) : null}

      {noFundedDialogOpen ? (
        <Modal
          title="Attach an External Wallet"
          size="sm"
          close={() => setNoFundedDialogOpen(false)}
        >
          <div className="account-panel">
            <p>{NO_FUNDED_WALLET_MESSAGE}</p>
            <div className="account-quote-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={linkBusy}
                onClick={() => {
                  setNoFundedDialogOpen(false);
                  void linkWallet('evm');
                }}
              >
                <Wallet size={13} />
                <span>+ Attach EVM</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={linkBusy}
                onClick={() => {
                  setNoFundedDialogOpen(false);
                  void linkWallet('svm');
                }}
              >
                <Wallet size={13} />
                <span>+ Attach Solana</span>
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      <ProfileModal
        isOpen={editingProfile}
        onClose={() => setEditingProfile(false)}
        address={user?.userAddress}
        onSave={async (next) => {
          const updated = await api.profile({
            name: next.name ?? next.nickname ?? '',
            bio: next.bio ?? '',
            image: next.image ?? next.avatar ?? null,
            banner: next.banner ?? null,
            socials: next.socials ?? [],
          });
          await refreshUser();
          return updated;
        }}
      />

      {showTerms ? <Disclaimer close={() => setShowTerms(false)} /> : null}
    </>
  );
}
