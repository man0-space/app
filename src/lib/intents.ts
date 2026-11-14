import { getWallets } from '@wallet-standard/app';
import type { WalletLink } from '../contexts/auth';
import { api, Fault, type IntentLeg, type IntentRoute } from './api';
import { callNearContract } from './contracts';

export const NO_FUNDED_WALLET_CODE = 'NO_FUNDED_WALLET';
export const NO_FUNDED_WALLET_MESSAGE =
  "You didn't connect any funded wallet. Connect an external wallet to fund your Session";

export type { IntentLeg, IntentRoute };

export interface EvmProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

export interface DiscoveredEvmProvider {
  rdns: string;
  name: string;
  provider: EvmProvider;
}

const eip6963Providers = new Map<string, DiscoveredEvmProvider>();
let eip6963Listening = false;

export function resetEip6963ProvidersForTesting(): void {
  eip6963Providers.clear();
  eip6963Listening = false;
}

function ensureEip6963Listener(): void {
  if (typeof window === 'undefined' || eip6963Listening) return;
  eip6963Listening = true;
  window.addEventListener('eip6963:announceProvider', (event: Event) => {
    const detail = (
      event as CustomEvent<{
        info?: { uuid?: string; rdns?: string; name?: string };
        provider?: EvmProvider;
      }>
    ).detail;
    if (!detail?.provider) return;
    const key = detail.info?.rdns || detail.info?.uuid || `provider-${eip6963Providers.size}`;
    eip6963Providers.set(key, {
      rdns: detail.info?.rdns ?? '',
      name: detail.info?.name ?? '',
      provider: detail.provider,
    });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

if (typeof window !== 'undefined') {
  ensureEip6963Listener();
}

const DEDICATED_EVM_RDNS = new Set([
  'io.metamask',
  'io.metamask.flask',
  'io.rabby',
  'com.coinbase.wallet',
  'com.brave.wallet',
  'me.rainbow',
  'io.zerion.wallet',
  'com.trustwallet.app',
  'com.okex.wallet',
]);

const DEMOTED_EVM_RDNS = new Set(['app.meteorwallet', 'app.phantom']);

const RDNS_FRIENDLY_NAMES: Record<string, string> = {
  'io.metamask': 'MetaMask',
  'io.metamask.flask': 'MetaMask Flask',
  'io.rabby': 'Rabby',
  'com.coinbase.wallet': 'Coinbase Wallet',
  'com.brave.wallet': 'Brave Wallet',
  'me.rainbow': 'Rainbow',
  'io.zerion.wallet': 'Zerion',
  'com.trustwallet.app': 'Trust Wallet',
  'com.okex.wallet': 'OKX Wallet',
  'app.phantom': 'Phantom',
  'app.meteorwallet': 'Meteor Wallet',
};

export function friendlyWalletName(rdns?: string, explicitName?: string): string {
  if (explicitName?.trim()) return explicitName.trim();
  const clean = (rdns ?? '').trim().toLowerCase();
  if (clean && RDNS_FRIENDLY_NAMES[clean]) return RDNS_FRIENDLY_NAMES[clean]!;
  return 'your browser wallet';
}

function evmProviderRank(rdns: string): number {
  const clean = rdns.trim().toLowerCase();
  if (DEDICATED_EVM_RDNS.has(clean)) return 0;
  if (DEMOTED_EVM_RDNS.has(clean)) return 2;
  return 1;
}

function getWalletErrorCode(err: unknown): number | string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const rec = err as {
    code?: number | string;
    data?: { originalError?: { code?: number | string } };
    cause?: { code?: number | string };
  };
  return rec.code ?? rec.data?.originalError?.code ?? rec.cause?.code;
}

function isUserRejectedError(err: unknown): boolean {
  const code = getWalletErrorCode(err);
  if (code === 4001 || code === 'ACTION_REJECTED') return true;
  const msg = extractWalletErrorMessage(err, '');
  return /user rejected|user denied|rejected the request|canceled/i.test(msg);
}

function isUnauthorized4100Error(err: unknown): boolean {
  const code = getWalletErrorCode(err);
  if (code === 4100) return true;
  const msg = extractWalletErrorMessage(err, '');
  return /not been authorized|unauthorized.*account|4100/i.test(msg);
}

function isPendingWalletRequestError(err: unknown): boolean {
  const code = getWalletErrorCode(err);
  if (code === -32002) return true;
  const msg = extractWalletErrorMessage(err, '');
  return /already pending|-32002/i.test(msg);
}

function shortAddr(addr: string, head = 6, tail = 4): string {
  const clean = addr.trim();
  if (clean.length <= head + tail + 2) return clean;
  return `${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

export function extractWalletErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const rec = err as {
      code?: unknown;
      shortMessage?: unknown;
      message?: unknown;
      data?: { message?: unknown; originalError?: { code?: unknown; message?: unknown } };
    };
    const code = rec.code ?? rec.data?.originalError?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') {
      return 'Transaction rejected in wallet.';
    }
    for (const candidate of [
      rec.shortMessage,
      rec.message,
      rec.data?.originalError?.message,
      rec.data?.message,
    ]) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return fallback;
}

export async function discoverEvmProviders(): Promise<DiscoveredEvmProvider[]> {
  if (typeof window === 'undefined') return [];
  ensureEip6963Listener();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  if (eip6963Providers.size === 0) {
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }

  let found: DiscoveredEvmProvider[];
  if (eip6963Providers.size > 0) {
    // Strictly use isolated EIP-6963 providers; never touch window.ethereum (avoids evmAsk.js multiplexer errors)
    found = [...eip6963Providers.values()];
  } else {
    found = [];
    const seen = new Set<EvmProvider>();
    const winEth = (
      window as unknown as {
        ethereum?: EvmProvider & { providers?: EvmProvider[] };
      }
    ).ethereum;
    if (Array.isArray(winEth?.providers)) {
      for (const p of winEth.providers) {
        if (p && !seen.has(p)) {
          seen.add(p);
          found.push({ rdns: '', name: '', provider: p });
        }
      }
    }
    if (winEth && !seen.has(winEth)) {
      seen.add(winEth);
      found.push({ rdns: '', name: '', provider: winEth });
    }
  }

  found.sort((a, b) => evmProviderRank(a.rdns) - evmProviderRank(b.rdns));

  return found;
}

function hasEvmWalletAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  ensureEip6963Listener();
  if (eip6963Providers.size > 0) return true;
  return Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

interface LegacySolanaProvider {
  publicKey?: { toString: () => string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString: () => string } }>;
  request?: (args: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;
}

function getInjectedSolanaProvider(): LegacySolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    phantom?: { solana?: LegacySolanaProvider };
    solana?: LegacySolanaProvider;
  };
  return win.phantom?.solana ?? win.solana ?? null;
}

function getStandardSolanaWallets() {
  if (typeof window === 'undefined') return [];
  try {
    return getWallets()
      .get()
      .filter((w) => 'solana:signTransaction' in w.features);
  } catch {
    return [];
  }
}

function hasSvmWalletAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (getInjectedSolanaProvider()) return true;
  return getStandardSolanaWallets().length > 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = window.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(bin);
}

export interface RequestEvmOptions {
  preferredRdns?: string;
  forceAccountPicker?: boolean;
  excludeAddresses?: string[];
}

export interface ResolvedEvmAccount {
  provider: EvmProvider;
  sender: string;
  allAccounts: string[];
  rdns: string;
  walletName: string;
}

function extractAccountsFromPermissions(perms: unknown): string[] {
  if (!Array.isArray(perms)) return [];
  const out: string[] = [];
  for (const item of perms) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as {
      parentCapability?: unknown;
      caveats?: Array<{ type?: unknown; value?: unknown }>;
    };
    if (rec.parentCapability !== 'eth_accounts' || !Array.isArray(rec.caveats)) continue;
    for (const caveat of rec.caveats) {
      if (Array.isArray(caveat?.value)) {
        for (const addr of caveat.value) {
          if (typeof addr === 'string' && addr.trim()) {
            out.push(addr.trim());
          }
        }
      }
    }
  }
  return out;
}

async function promptAccountPermissions(
  provider: EvmProvider,
  needAccountPicker: boolean,
): Promise<string[]> {
  let permAccounts: string[] = [];
  if (needAccountPicker) {
    try {
      const perms = await provider.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      });
      permAccounts = extractAccountsFromPermissions(perms);
    } catch (err) {
      if (isUserRejectedError(err) || isPendingWalletRequestError(err)) {
        throw err;
      }
      // Wallet may not implement EIP-2255 wallet_requestPermissions (-32601); fall through to eth_requestAccounts
    }
  }
  const requested = (await provider.request({ method: 'eth_requestAccounts' }).catch((err) => {
    if (permAccounts.length > 0 && !isUserRejectedError(err)) {
      return permAccounts;
    }
    throw err;
  })) as string[] | null;

  const merged: string[] = [];
  const seen = new Set<string>();
  for (const list of [Array.isArray(requested) ? requested : [], permAccounts]) {
    for (const addr of list) {
      if (typeof addr !== 'string' || !addr.trim()) continue;
      const lower = addr.trim().toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        merged.push(addr.trim());
      }
    }
  }
  return merged;
}

export async function requestEvmAccounts(
  preferredAddress?: string,
  options?: RequestEvmOptions,
): Promise<ResolvedEvmAccount> {
  const discovered = await discoverEvmProviders();
  if (discovered.length === 0) {
    throw new Error('No EVM browser wallet detected.');
  }

  const targetLower = preferredAddress?.trim().toLowerCase() || '';
  const preferredRdnsLower = options?.preferredRdns?.trim().toLowerCase() || '';
  const excludedSet = new Set(
    (options?.excludeAddresses ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean),
  );

  // Order providers: explicit preferredRdns first, then standard rank
  const candidates = [...discovered].sort((a, b) => {
    const aPref = preferredRdnsLower && a.rdns.trim().toLowerCase() === preferredRdnsLower ? -1 : 0;
    const bPref = preferredRdnsLower && b.rdns.trim().toLowerCase() === preferredRdnsLower ? -1 : 0;
    if (aPref !== bPref) return aPref - bPref;
    return evmProviderRank(a.rdns) - evmProviderRank(b.rdns);
  });

  const passiveAccountsByCandidate = new Map<DiscoveredEvmProvider, string[]>();
  let exactActiveMatch: ResolvedEvmAccount | null = null;
  let exactPermittedMatch: ResolvedEvmAccount | null = null;
  let fallbackAuthorized: ResolvedEvmAccount | null = null;

  for (const cand of candidates) {
    try {
      const accounts = (await Promise.race([
        cand.provider.request({ method: 'eth_accounts' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 900)),
      ])) as string[] | null;
      const cleanAccounts = Array.isArray(accounts)
        ? accounts.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        : [];
      passiveAccountsByCandidate.set(cand, cleanAccounts);

      if (cleanAccounts.length > 0) {
        const walletName = friendlyWalletName(cand.rdns, cand.name);
        if (targetLower) {
          if (cleanAccounts[0]!.toLowerCase() === targetLower && !exactActiveMatch) {
            exactActiveMatch = {
              provider: cand.provider,
              sender: cleanAccounts[0]!,
              allAccounts: cleanAccounts,
              rdns: cand.rdns,
              walletName,
            };
          } else {
            const matched = cleanAccounts.find((a) => a.toLowerCase() === targetLower);
            if (matched && !exactPermittedMatch) {
              exactPermittedMatch = {
                provider: cand.provider,
                sender: matched,
                allAccounts: cleanAccounts,
                rdns: cand.rdns,
                walletName,
              };
            }
          }
        }
        if (!fallbackAuthorized && !DEMOTED_EVM_RDNS.has(cand.rdns.trim().toLowerCase())) {
          const preferredNonExcluded =
            cleanAccounts.find((a) => !excludedSet.has(a.toLowerCase())) ?? cleanAccounts[0]!;
          fallbackAuthorized = {
            provider: cand.provider,
            sender: preferredNonExcluded,
            allAccounts: cleanAccounts,
            rdns: cand.rdns,
            walletName,
          };
        }
      }
    } catch {
      passiveAccountsByCandidate.set(cand, []);
    }
  }

  if (targetLower && (exactActiveMatch || exactPermittedMatch)) {
    return (exactActiveMatch ?? exactPermittedMatch)!;
  }

  if (fallbackAuthorized && !targetLower && !options?.forceAccountPicker) {
    return fallbackAuthorized;
  }

  // Filter interactive prompt candidates:
  // 1. If preferredRdns matches an installed wallet, prompt ONLY that wallet.
  // 2. Otherwise, do NOT fall through to demoted non-dedicated EVM wallets (Phantom/Meteor)
  //    when a dedicated/standard EVM wallet is installed.
  const preferredMatches = preferredRdnsLower
    ? candidates.filter((c) => c.rdns.trim().toLowerCase() === preferredRdnsLower)
    : [];
  const nonDemoted = candidates.filter((c) => !DEMOTED_EVM_RDNS.has(c.rdns.trim().toLowerCase()));
  const promptCandidates =
    preferredMatches.length > 0
      ? preferredMatches
      : nonDemoted.length > 0
        ? nonDemoted
        : candidates;

  let firstPrompted: ResolvedEvmAccount | null = null;
  let lastErr: unknown = null;

  for (const cand of promptCandidates) {
    const walletName = friendlyWalletName(cand.rdns, cand.name);
    const passiveList = passiveAccountsByCandidate.get(cand) ?? [];
    // Must force EIP-2255 account picker whenever:
    // - caller requested forceAccountPicker (attaching a wallet), OR
    // - provider already has other accounts connected on this origin, so eth_requestAccounts
    //   would silently return the old account without letting the user authorize preferredAddress!
    const needPicker =
      Boolean(options?.forceAccountPicker) || Boolean(targetLower && passiveList.length > 0);
    try {
      const accounts = await promptAccountPermissions(cand.provider, needPicker);
      if (accounts.length > 0) {
        if (targetLower) {
          const matched = accounts.find((a) => a.toLowerCase() === targetLower);
          if (matched) {
            return {
              provider: cand.provider,
              sender: matched,
              allAccounts: accounts,
              rdns: cand.rdns,
              walletName,
            };
          }
          if (!firstPrompted) {
            firstPrompted = {
              provider: cand.provider,
              sender: accounts[0]!,
              allAccounts: accounts,
              rdns: cand.rdns,
              walletName,
            };
          }
        } else {
          const chosen =
            accounts.find((a) => !excludedSet.has(a.toLowerCase())) ?? accounts[0]!;
          return {
            provider: cand.provider,
            sender: chosen,
            allAccounts: accounts,
            rdns: cand.rdns,
            walletName,
          };
        }
      }
    } catch (err) {
      if (isUserRejectedError(err) || isPendingWalletRequestError(err)) {
        throw err;
      }
      lastErr = err;
    }
  }

  if (targetLower && (firstPrompted || fallbackAuthorized)) {
    const active = (firstPrompted ?? fallbackAuthorized)!;
    throw new Error(
      `Authorize and select ${shortAddr(preferredAddress!)} in ${active.walletName} (currently connected: ${shortAddr(active.sender)}) and try again.`,
    );
  }
  if (firstPrompted) return firstPrompted;
  if (fallbackAuthorized) return fallbackAuthorized;
  throw new Error(extractWalletErrorMessage(lastErr, 'Select an account in your wallet to continue.'));
}

const KNOWN_EVM_CHAINS: Record<
  number,
  {
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls?: string[];
  }
> = {
  1: {
    chainName: 'Ethereum Mainnet',
    rpcUrls: ['https://ethereum-rpc.publicnode.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://etherscan.io'],
  },
  11155111: {
    chainName: 'Ethereum Sepolia',
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  42161: {
    chainName: 'Arbitrum One',
    rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://arbiscan.io'],
  },
  421614: {
    chainName: 'Arbitrum Sepolia',
    rpcUrls: [
      'https://sepolia-rollup.arbitrum.io/rpc',
      'https://arbitrum-sepolia-rpc.publicnode.com',
    ],
    nativeCurrency: { name: 'Arbitrum Sepolia Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
  },
  8453: {
    chainName: 'Base',
    rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://basescan.org'],
  },
  84532: {
    chainName: 'Base Sepolia',
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
    nativeCurrency: { name: 'Base Sepolia Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  10: {
    chainName: 'OP Mainnet',
    rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
  },
  11155420: {
    chainName: 'OP Sepolia',
    rpcUrls: ['https://sepolia.optimism.io', 'https://optimism-sepolia-rpc.publicnode.com'],
    nativeCurrency: { name: 'OP Sepolia Ether', symbol: 'ETH', decimals: 18 },
    blockExplorerUrls: ['https://sepolia-optimism.etherscan.io'],
  },
  137: {
    chainName: 'Polygon',
    rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    blockExplorerUrls: ['https://polygonscan.com'],
  },
};

function normalizeHexChainId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const parsed = Number.parseInt(trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed, 16);
  return Number.isFinite(parsed) && parsed > 0 ? `0x${parsed.toString(16)}` : trimmed;
}

async function switchOrAddEvmChain(
  eth: EvmProvider,
  hexChainId: string,
  meta?: { rdns?: string; walletName?: string; chainLabel?: string },
): Promise<void> {
  const canonicalHex = normalizeHexChainId(hexChainId);
  const currentChainRaw = (await eth
    .request({ method: 'eth_chainId' })
    .catch(() => null)) as string | null;
  if (typeof currentChainRaw === 'string' && normalizeHexChainId(currentChainRaw) === canonicalHex) {
    return;
  }

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: canonicalHex }],
    });
    return;
  } catch (err) {
    if (isUserRejectedError(err) || isPendingWalletRequestError(err)) {
      throw err;
    }
    if (isUnauthorized4100Error(err)) {
      if (meta?.rdns?.toLowerCase() === 'app.phantom') {
        const label = meta.chainLabel || canonicalHex;
        throw new Error(
          `Phantom EVM rejected ${label} (${canonicalHex}). Enable Settings → Developer Settings → Testnet Mode in Phantom, or attach MetaMask / Rabby for ${label}.`,
        );
      }
      // Refresh account permission once then retry chain switch
      await promptAccountPermissions(eth, false).catch(() => []);
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: canonicalHex }],
      });
      return;
    }

    const code = getWalletErrorCode(err);
    const errMsg = extractWalletErrorMessage(err, '');
    const isMissingChain =
      code === 4902 || /unrecognized chain|unknown chain|try adding the chain|4902/i.test(errMsg);
    if (!isMissingChain) throw err;

    const numericId = Number.parseInt(canonicalHex, 16);
    const curated = KNOWN_EVM_CHAINS[numericId];
    if (curated) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: canonicalHex,
            chainName: curated.chainName,
            rpcUrls: curated.rpcUrls,
            nativeCurrency: curated.nativeCurrency,
            ...(curated.blockExplorerUrls ? { blockExplorerUrls: curated.blockExplorerUrls } : {}),
          },
        ],
      });
      return;
    }

    const registry = (await fetch('https://chainid.network/chains.json').then((r) =>
      r.json(),
    )) as Array<{
      chainId: number;
      name: string;
      rpc?: string[];
      nativeCurrency?: { name: string; symbol: string; decimals: number };
      explorers?: Array<{ url: string }>;
    }>;
    const entry = registry.find((c) => c.chainId === numericId);
    const rpcUrls = (entry?.rpc ?? []).filter(
      (u) => u.startsWith('https://') && !u.includes('${'),
    );
    if (!entry || rpcUrls.length === 0) throw err;
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: canonicalHex,
          chainName: entry.name,
          rpcUrls,
          nativeCurrency: entry.nativeCurrency ?? {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
          ...(entry.explorers?.[0]?.url
            ? { blockExplorerUrls: [entry.explorers[0].url] }
            : {}),
        },
      ],
    });
  }
}

export async function resolveIntentRoute(input: {
  prompt: string;
  dry: boolean;
  links: WalletLink[];
}): Promise<IntentRoute> {
  const clean = input.prompt.trim();
  if (!clean) {
    throw new Fault('Describe what you want to fund, swap, or withdraw.', 400);
  }
  const seen = new Map<string, { network: 'evm' | 'svm'; address: string }>();
  for (const item of input.links) {
    if (!item.address?.trim()) continue;
    const key = `${item.network}:${item.address.trim().toLowerCase()}`;
    seen.set(key, { network: item.network, address: item.address.trim() });
  }
  return api.intentsQuote({
    prompt: clean,
    dry: input.dry,
    connectedWallets: [...seen.values()],
  });
}

export function routeLegs(route: IntentRoute): IntentLeg[] {
  if (Array.isArray(route.legs) && route.legs.length > 0) {
    return route.legs;
  }
  return [
    {
      source: route.depositType === 'INTENTS' ? 'intents' : 'external',
      depositType: route.depositType ?? 'ORIGIN_CHAIN',
      originToken: route.originToken,
      originChainLabel: route.originChainLabel,
      originWalletNetwork: route.originWalletNetwork,
      originWalletAddress: route.originWalletAddress,
      intentsAccountId: route.intentsAccountId,
      hexChainId: route.hexChainId,
      destinationToken: route.destinationToken,
      destinationChainLabel: route.destinationChainLabel,
      recipientAddress: route.recipientAddress,
      amountAtomic: route.amountAtomic,
      displayAmount: route.displayAmount,
      quote: route.quote,
    },
  ];
}

export function canAutoSendOrigin(route: IntentRoute): boolean {
  if (typeof window === 'undefined') return false;
  const legs = routeLegs(route);
  return legs.every((leg) => {
    if (leg.depositType === 'INTENTS') {
      return true;
    }
    if (leg.originWalletNetwork === 'near') {
      return true;
    }
    if (leg.originWalletNetwork === 'evm') {
      return hasEvmWalletAvailable();
    }
    if (leg.originWalletNetwork === 'svm') {
      return hasSvmWalletAvailable();
    }
    return false;
  });
}

function parseHexQuantity(raw: unknown): bigint | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^0x[0-9a-fA-F]+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

export async function sendEvmOriginTransfer(input: {
  leg: IntentLeg;
  depositAddress: string;
  preferredRdns?: string;
}): Promise<{ txHash: string; sender: string }> {
  const targetLower = input.leg.originWalletAddress.trim().toLowerCase();
  const resolved = await requestEvmAccounts(input.leg.originWalletAddress, {
    preferredRdns: input.preferredRdns,
  });
  const eth = resolved.provider;
  let sender = resolved.sender;

  if (input.leg.hexChainId) {
    await switchOrAddEvmChain(eth, input.leg.hexChainId, {
      rdns: resolved.rdns,
      walletName: resolved.walletName,
      chainLabel: input.leg.originChainLabel,
    });

    // CAIP-25 multichain wallets (MetaMask v12.6+, Phantom EVM, Rabby, Coinbase) scope account
    // authorization per chain; re-verify eth_requestAccounts on the active chain after switching.
    let postSwitchAccounts = (await eth
      .request({ method: 'eth_requestAccounts' })
      .catch(() => null)) as string[] | null;
    if (Array.isArray(postSwitchAccounts) && postSwitchAccounts.length > 0) {
      let matched = targetLower
        ? postSwitchAccounts.find((a) => a.toLowerCase() === targetLower)
        : postSwitchAccounts[0];
      if (targetLower && !matched) {
        const refreshed = await promptAccountPermissions(eth, true);
        postSwitchAccounts = refreshed;
        matched = refreshed.find((a) => a.toLowerCase() === targetLower);
      }
      if (targetLower && !matched) {
        const active = postSwitchAccounts[0] ?? sender;
        throw new Error(
          `Authorize and select ${shortAddr(input.leg.originWalletAddress)} in ${resolved.walletName} (currently active: ${shortAddr(active)}) and try again.`,
        );
      }
      if (matched) {
        sender = matched;
      }
    }
  }

  const amountBig = BigInt(input.leg.amountAtomic);
  const tokenContract = input.leg.originToken.contractAddress?.trim();
  const isErc20 = Boolean(tokenContract && /^0x[a-fA-F0-9]{40}$/.test(tokenContract));

  const buildBaseTxParams = (fromAddress: string): Record<string, string> => {
    if (isErc20 && tokenContract) {
      const cleanRecipient = input.depositAddress.replace(/^0x/i, '').toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(cleanRecipient)) {
        throw new Error('Deposit address format does not match EVM.');
      }
      const data =
        '0xa9059cbb' +
        cleanRecipient.padStart(64, '0') +
        amountBig.toString(16).padStart(64, '0');
      return {
        from: fromAddress,
        to: tokenContract,
        value: '0x0',
        data,
      };
    }
    return {
      from: fromAddress,
      to: input.depositAddress,
      value: `0x${amountBig.toString(16)}`,
    };
  };

  let baseTxParams = buildBaseTxParams(sender);

  const [latestBlock, gasPriceHex, priorityFeeHex, estimatedGasHex, walletBalHex] =
    await Promise.all([
      eth
        .request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
        .catch(() => null) as Promise<{ baseFeePerGas?: string } | null>,
      eth.request({ method: 'eth_gasPrice', params: [] }).catch(() => null),
      eth.request({ method: 'eth_maxPriorityFeePerGas', params: [] }).catch(() => null),
      eth.request({ method: 'eth_estimateGas', params: [baseTxParams] }).catch(() => null),
      !isErc20 && amountBig > 0n
        ? eth.request({ method: 'eth_getBalance', params: [sender, 'latest'] }).catch(() => null)
        : Promise.resolve(null),
    ]);

  const baseFee = parseHexQuantity(latestBlock?.baseFeePerGas);
  const gasPrice = parseHexQuantity(gasPriceHex);
  const rpcPriorityFee = parseHexQuantity(priorityFeeHex);
  const estimatedGas = parseHexQuantity(estimatedGasHex);
  const walletBalance = parseHexQuantity(walletBalHex);

  const feeOverrides: Record<string, string> = {};
  const fallbackGas = isErc20 ? 95_000n : 21_000n;
  const gasLimit = estimatedGas && estimatedGas > 0n ? (estimatedGas * 125n) / 100n : fallbackGas;
  feeOverrides.gas = `0x${gasLimit.toString(16)}`;

  if (baseFee !== null || gasPrice !== null) {
    const priorityFloor = 1_000_000n; // 0.001 gwei floor on L2s
    const priorityFee =
      rpcPriorityFee !== null && rpcPriorityFee > priorityFloor ? rpcPriorityFee : priorityFloor;
    const fromBase = baseFee !== null ? baseFee * 3n + priorityFee : 0n;
    const fromGasPrice = gasPrice !== null ? gasPrice * 2n + priorityFee : 0n;
    let maxFeePerGas = fromBase > fromGasPrice ? fromBase : fromGasPrice;

    if (!isErc20 && amountBig > 0n && walletBalance !== null && walletBalance > amountBig) {
      const remainingForGas = walletBalance - amountBig;
      const maxAffordablePerGas = remainingForGas / gasLimit;
      const minSafePerGas =
        baseFee !== null ? (baseFee * 135n) / 100n + priorityFee : priorityFee * 2n;
      if (maxAffordablePerGas < maxFeePerGas && maxAffordablePerGas >= minSafePerGas) {
        maxFeePerGas = maxAffordablePerGas;
      }
    }

    if (maxFeePerGas > 0n) {
      const effectivePriority = priorityFee < maxFeePerGas ? priorityFee : maxFeePerGas;
      feeOverrides.maxFeePerGas = `0x${maxFeePerGas.toString(16)}`;
      feeOverrides.maxPriorityFeePerGas = `0x${effectivePriority.toString(16)}`;
    }
  }

  const sendTxOnce = async (withFeeOverrides: boolean): Promise<string> => {
    const txPayload =
      withFeeOverrides && Object.keys(feeOverrides).length > 0
        ? { ...baseTxParams, ...feeOverrides }
        : baseTxParams;
    return (await eth.request({
      method: 'eth_sendTransaction',
      params: [txPayload],
    })) as string;
  };

  const hasOverrides = Object.keys(feeOverrides).length > 0;
  let txHash: string;

  try {
    txHash = await sendTxOnce(hasOverrides);
  } catch (err) {
    if (isUserRejectedError(err) || isPendingWalletRequestError(err)) {
      throw err;
    }

    if (isUnauthorized4100Error(err)) {
      // Explicit EIP-1193 4100 recovery: request account permissions once and verify active account.
      const refreshed = await promptAccountPermissions(eth, true).catch((permErr) => {
        if (isUserRejectedError(permErr)) throw permErr;
        return [] as string[];
      });
      const matched = targetLower
        ? refreshed.find((a) => a.toLowerCase() === targetLower)
        : refreshed[0];

      if (!matched) {
        const activeHint = refreshed[0] ? ` (currently active: ${shortAddr(refreshed[0])})` : '';
        throw new Error(
          `Authorize and select ${shortAddr(input.leg.originWalletAddress)} in ${resolved.walletName}${activeHint} and try again.`,
        );
      }

      sender = matched;
      baseTxParams = buildBaseTxParams(sender);

      try {
        txHash = await sendTxOnce(hasOverrides);
      } catch (retryErr) {
        if (isUnauthorized4100Error(retryErr)) {
          if (resolved.rdns.toLowerCase() === 'app.phantom') {
            const label = input.leg.originChainLabel || input.leg.hexChainId || 'this network';
            throw new Error(
              `Phantom EVM blocked signing on ${label}. Enable Settings → Developer Settings → Testnet Mode in Phantom, or switch ${shortAddr(sender)} to MetaMask / Rabby.`,
            );
          }
          if (refreshed[0] && targetLower && refreshed[0].toLowerCase() !== targetLower) {
            throw new Error(
              `Switch the active account in ${resolved.walletName} from ${shortAddr(refreshed[0])} to ${shortAddr(input.leg.originWalletAddress)} and try again.`,
            );
          }
        }
        throw retryErr;
      }
    } else if (hasOverrides && !/insufficient funds/i.test(extractWalletErrorMessage(err, ''))) {
      // Only fall back to wallet-estimated gas when fee override parameters were rejected
      txHash = await sendTxOnce(false);
    } else {
      throw err;
    }
  }

  await api
    .intentsDeposit({
      txHash,
      depositAddress: input.depositAddress,
      ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
    })
    .catch(() => undefined);

  return { txHash, sender };
}

function resolveNearTokenContract(leg: IntentLeg): string {
  const explicit = leg.originToken.contractAddress?.trim();
  if (explicit) return explicit;
  if (leg.originToken.assetId.startsWith('nep141:')) {
    return leg.originToken.assetId.slice('nep141:'.length).trim();
  }
  throw new Error(`Cannot determine token contract for ${leg.originToken.symbol}.`);
}

async function sendNearOriginTransfer(input: {
  leg: IntentLeg;
  depositAddress: string;
}): Promise<{ txHash: string }> {
  const contractId = resolveNearTokenContract(input.leg);
  const executed = await callNearContract({
    contractId,
    methodName: 'ft_transfer',
    args: {
      receiver_id: input.depositAddress,
      amount: input.leg.amountAtomic,
      ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
    },
    deposit: '1',
    gas: 50_000_000_000_000,
  });

  await api
    .intentsDeposit({
      txHash: executed.txHash,
      depositAddress: input.depositAddress,
      nearSenderAccount: input.leg.originWalletAddress,
      ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
    })
    .catch(() => undefined);

  return { txHash: executed.txHash };
}

export async function requestSvmAccount(options?: {
  forceAccountPicker?: boolean;
  excludeAddresses?: string[];
}): Promise<{ address: string; walletName: string }> {
  const excluded = new Set((options?.excludeAddresses ?? []).map((a) => a.trim()).filter(Boolean));
  const standardWallets = getStandardSolanaWallets();

  if (standardWallets.length > 0) {
    for (const w of standardWallets) {
      if ('standard:connect' in w.features) {
        try {
          if (options?.forceAccountPicker && 'standard:disconnect' in w.features) {
            const allExcluded =
              w.accounts.length > 0 && w.accounts.every((a) => excluded.has(a.address));
            if (allExcluded) {
              const disc = w.features['standard:disconnect'] as { disconnect: () => Promise<void> };
              await disc.disconnect().catch(() => undefined);
            }
          }
          const connectFeature = w.features['standard:connect'] as {
            connect: () => Promise<{ accounts: readonly { address: string }[] }>;
          };
          const connected = await connectFeature.connect();
          const list = connected.accounts.length > 0 ? connected.accounts : w.accounts;
          const chosen = list.find((a) => !excluded.has(a.address)) ?? list[0];
          if (chosen?.address) {
            return { address: chosen.address, walletName: w.name || 'Solana Wallet' };
          }
        } catch (err) {
          if (isUserRejectedError(err)) throw err;
        }
      }
    }
  }

  const injected = getInjectedSolanaProvider() as
    | (LegacySolanaProvider & { disconnect?: () => Promise<void>; isPhantom?: boolean })
    | null;
  if (!injected) {
    throw new Error('No Solana wallet detected.');
  }
  if (
    options?.forceAccountPicker &&
    injected.publicKey &&
    excluded.has(injected.publicKey.toString()) &&
    typeof injected.disconnect === 'function'
  ) {
    await injected.disconnect().catch(() => undefined);
  }
  const resp = await injected.connect();
  const address = resp?.publicKey?.toString() || injected.publicKey?.toString() || '';
  if (!address) {
    throw new Error('Select an account in your Solana wallet to continue.');
  }
  return {
    address,
    walletName: injected.isPhantom ? 'Phantom' : 'Solana Wallet',
  };
}

async function sendSvmOriginTransfer(input: {
  leg: IntentLeg;
  depositAddress: string;
}): Promise<{ txHash: string }> {
  const preferred = input.leg.originWalletAddress.trim();
  const standardWallets = getStandardSolanaWallets();

  // Prefer a Wallet Standard wallet that already exposes the exact preferred Solana address
  const exactStandardWallet = preferred
    ? standardWallets.find((w) => w.accounts.some((a) => a.address === preferred))
    : undefined;

  const injected = getInjectedSolanaProvider();
  if (!exactStandardWallet && injected && typeof injected.request === 'function') {
    const conn = await injected.connect();
    const senderAddress = conn?.publicKey?.toString() || injected.publicKey?.toString() || '';
    if (!senderAddress) {
      throw new Error('Select an account in your Solana wallet to continue.');
    }
    if (!preferred || senderAddress === preferred) {
      const prep = await api.intentsSvmPrepare({
        senderAddress: senderAddress || preferred,
        depositAddress: input.depositAddress,
        amountAtomic: input.leg.amountAtomic,
        ...(input.leg.originToken.contractAddress
          ? { tokenContract: input.leg.originToken.contractAddress }
          : {}),
        decimals: input.leg.originToken.decimals,
        ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
      });

      const signed = (await injected.request({
        method: 'signTransaction',
        params: { message: prep.messageBase58 },
      })) as { serialize?: () => Uint8Array } | Uint8Array;

      const signedBytes =
        signed instanceof Uint8Array
          ? signed
          : typeof signed?.serialize === 'function'
            ? signed.serialize()
            : null;
      if (!signedBytes) {
        throw new Error('Solana wallet did not return a signed transaction.');
      }

      const sent = await api.intentsSvmBroadcast({
        signedTransactionBase64: bytesToBase64(signedBytes),
        depositAddress: input.depositAddress,
        ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
      });
      return { txHash: sent.txHash };
    }
    if (standardWallets.length === 0) {
      throw new Error(
        `Switch your Solana wallet to ${shortAddr(preferred, 4, 4)} (currently active: ${shortAddr(senderAddress, 4, 4)}) and try again.`,
      );
    }
  }

  if (standardWallets.length === 0) {
    throw new Error('No Solana browser wallet detected.');
  }

  let matchedWallet = exactStandardWallet;
  let matchedAccount = exactStandardWallet?.accounts.find((a) => a.address === preferred);
  let fallbackActiveAddress = '';

  if (!matchedAccount) {
    for (const w of standardWallets) {
      let accounts = w.accounts;
      if (accounts.length === 0 && 'standard:connect' in w.features) {
        try {
          const connectFeature = w.features['standard:connect'] as {
            connect: () => Promise<{ accounts: readonly { address: string }[] }>;
          };
          const connected = await connectFeature.connect();
          accounts = connected.accounts as typeof w.accounts;
        } catch (err) {
          if (isUserRejectedError(err)) throw err;
        }
      }
      if (!fallbackActiveAddress && accounts[0]?.address) {
        fallbackActiveAddress = accounts[0].address;
      }
      const found = preferred ? accounts.find((a) => a.address === preferred) : accounts[0];
      if (found) {
        matchedWallet = w;
        matchedAccount = found;
        break;
      }
    }
  }

  if (!matchedWallet || !matchedAccount) {
    if (preferred && fallbackActiveAddress) {
      throw new Error(
        `Switch your Solana wallet to ${shortAddr(preferred, 4, 4)} (currently active: ${shortAddr(fallbackActiveAddress, 4, 4)}) and try again.`,
      );
    }
    throw new Error('Select an account in your Solana wallet to continue.');
  }

  const prep = await api.intentsSvmPrepare({
    senderAddress: matchedAccount.address,
    depositAddress: input.depositAddress,
    amountAtomic: input.leg.amountAtomic,
    ...(input.leg.originToken.contractAddress
      ? { tokenContract: input.leg.originToken.contractAddress }
      : {}),
    decimals: input.leg.originToken.decimals,
    ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
  });

  const signFeature = matchedWallet.features['solana:signTransaction'] as {
    signTransaction: (
      ...inputs: Array<{ account: unknown; transaction: Uint8Array }>
    ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
  };

  const outputs = await signFeature.signTransaction({
    account: matchedAccount,
    transaction: base64ToBytes(prep.transactionBase64),
  });
  const signedBytes = outputs?.[0]?.signedTransaction;
  if (!signedBytes) {
    throw new Error('Solana wallet did not return a signed transaction.');
  }

  const sent = await api.intentsSvmBroadcast({
    signedTransactionBase64: bytesToBase64(signedBytes),
    depositAddress: input.depositAddress,
    ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
  });
  return { txHash: sent.txHash };
}

export async function executeIntentLeg(
  leg: IntentLeg,
  links?: WalletLink[],
): Promise<{
  depositAddress: string;
  depositMemo?: string | null;
  txHash?: string;
  intentHash?: string;
}> {
  const depositAddress = leg.quote.depositAddress;
  if (!depositAddress) {
    throw new Error('Could not generate transfer address. Try again.');
  }

  if (leg.depositType === 'INTENTS') {
    try {
      const generated = await api.intentsGenerate({
        depositAddress,
        assetId: leg.originToken.assetId,
        amountAtomic: leg.amountAtomic,
        ...(leg.quote.depositMemo ? { memo: leg.quote.depositMemo } : {}),
      });
      return {
        depositAddress,
        depositMemo: leg.quote.depositMemo,
        ...(generated.txHash ? { txHash: generated.txHash } : {}),
        intentHash: generated.intentHash,
      };
    } catch (err) {
      if (err instanceof Fault && err.status === 401) {
        const verifier =
          import.meta.env.VITE_NEAR_NETWORK === 'testnet'
            ? 'verifier.tidepool-sandbox.testnet'
            : 'intents.near';
        const executed = await callNearContract({
          contractId: verifier,
          methodName: 'mt_transfer',
          args: {
            receiver_id: depositAddress,
            token_id: leg.originToken.assetId,
            amount: leg.amountAtomic,
            approval: null,
            memo: leg.quote.depositMemo ?? null,
          },
          deposit: '1',
          gas: 100_000_000_000_000,
        });
        await api
          .intentsDeposit({
            txHash: executed.txHash,
            depositAddress,
            nearSenderAccount: leg.intentsAccountId ?? leg.originWalletAddress,
            ...(leg.quote.depositMemo ? { memo: leg.quote.depositMemo } : {}),
          })
          .catch(() => undefined);
        return {
          depositAddress,
          depositMemo: leg.quote.depositMemo,
          txHash: executed.txHash,
          intentHash: executed.txHash,
        };
      }
      throw err;
    }
  }

  const matchedLink = links?.find(
    (l) =>
      l.network === leg.originWalletNetwork &&
      l.address.trim().toLowerCase() === leg.originWalletAddress.trim().toLowerCase(),
  );

  if (leg.originWalletNetwork === 'evm') {
    const { txHash } = await sendEvmOriginTransfer({
      leg,
      depositAddress,
      preferredRdns: matchedLink?.providerRdns,
    });
    return { depositAddress, depositMemo: leg.quote.depositMemo, txHash };
  }

  if (leg.originWalletNetwork === 'svm') {
    const { txHash } = await sendSvmOriginTransfer({ leg, depositAddress });
    return { depositAddress, depositMemo: leg.quote.depositMemo, txHash };
  }

  if (leg.originWalletNetwork === 'near') {
    const { txHash } = await sendNearOriginTransfer({ leg, depositAddress });
    return { depositAddress, depositMemo: leg.quote.depositMemo, txHash };
  }

  throw new Error('Use the manual deposit address below to send from this wallet.');
}

export interface LegProgressUpdate {
  state: 'sending' | 'sent';
  txHash?: string;
  intentHash?: string;
}

export async function executeIntentRoute(
  route: IntentRoute,
  onLegProgress?: (index: number, update: LegProgressUpdate) => void,
  links?: WalletLink[],
): Promise<
  Array<{
    depositAddress: string;
    depositMemo?: string | null;
    txHash?: string;
    intentHash?: string;
  }>
> {
  const legs = routeLegs(route);
  const results: Array<{
    depositAddress: string;
    depositMemo?: string | null;
    txHash?: string;
    intentHash?: string;
  }> = [];
  for (let i = 0; i < legs.length; i++) {
    onLegProgress?.(i, { state: 'sending' });
    const res = await executeIntentLeg(legs[i]!, links);
    onLegProgress?.(i, {
      state: 'sent',
      txHash: res.txHash,
      intentHash: res.intentHash,
    });
    results.push(res);
  }
  return results;
}
