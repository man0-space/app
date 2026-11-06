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

interface DiscoveredEvmProvider {
  rdns: string;
  provider: EvmProvider;
}

const eip6963Providers = new Map<string, DiscoveredEvmProvider>();
let eip6963Listening = false;

function ensureEip6963Listener(): void {
  if (typeof window === 'undefined' || eip6963Listening) return;
  eip6963Listening = true;
  window.addEventListener('eip6963:announceProvider', (event: Event) => {
    const detail = (
      event as CustomEvent<{ info?: { uuid?: string; rdns?: string }; provider?: EvmProvider }>
    ).detail;
    if (!detail?.provider) return;
    const key = detail.info?.rdns || detail.info?.uuid || `provider-${eip6963Providers.size}`;
    eip6963Providers.set(key, {
      rdns: detail.info?.rdns ?? '',
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

function evmProviderRank(rdns: string): number {
  const clean = rdns.trim().toLowerCase();
  if (DEDICATED_EVM_RDNS.has(clean)) return 0;
  if (DEMOTED_EVM_RDNS.has(clean)) return 2;
  return 1;
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
          found.push({ rdns: '', provider: p });
        }
      }
    }
    if (winEth && !seen.has(winEth)) {
      seen.add(winEth);
      found.push({ rdns: '', provider: winEth });
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

export async function requestEvmAccounts(
  preferredAddress?: string,
): Promise<{ provider: EvmProvider; sender: string }> {
  const candidates = await discoverEvmProviders();
  if (candidates.length === 0) {
    throw new Error('No EVM browser wallet detected.');
  }

  const targetLower = preferredAddress?.trim().toLowerCase() || '';
  let fallbackAuthorized: { provider: EvmProvider; sender: string } | null = null;

  for (const { provider } of candidates) {
    try {
      const accounts = (await Promise.race([
        provider.request({ method: 'eth_accounts' }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 900)),
      ])) as string[] | null;
      if (Array.isArray(accounts) && accounts.length > 0) {
        const matched = targetLower
          ? accounts.find((a) => a.toLowerCase() === targetLower)
          : undefined;
        if (matched) {
          return { provider, sender: matched };
        }
        if (!fallbackAuthorized) {
          fallbackAuthorized = { provider, sender: accounts[0] };
        }
      }
    } catch {
      // Ignore passive provider check failure
    }
  }

  if (fallbackAuthorized && !targetLower) {
    return fallbackAuthorized;
  }

  let firstPrompted: { provider: EvmProvider; sender: string } | null = null;
  let lastErr: unknown = null;
  for (const { provider } of candidates) {
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (Array.isArray(accounts) && accounts.length > 0) {
        const matched = targetLower
          ? accounts.find((a) => a.toLowerCase() === targetLower)
          : undefined;
        if (matched) {
          return { provider, sender: matched };
        }
        if (!targetLower) {
          return { provider, sender: accounts[0]! };
        }
        if (!firstPrompted) {
          firstPrompted = { provider, sender: accounts[0]! };
        }
      }
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4001) throw err;
      lastErr = err;
    }
  }

  if (targetLower && (firstPrompted || fallbackAuthorized)) {
    const activeAddr = (firstPrompted ?? fallbackAuthorized)!.sender;
    throw new Error(
      `Switch your EVM wallet to ${preferredAddress!.slice(0, 6)}…${preferredAddress!.slice(-4)} (currently active: ${activeAddr.slice(0, 6)}…${activeAddr.slice(-4)}) and try again.`,
    );
  }
  if (firstPrompted) return firstPrompted;
  if (fallbackAuthorized) return fallbackAuthorized;
  throw new Error(extractWalletErrorMessage(lastErr, 'Select an account in your wallet to continue.'));
}

async function switchOrAddEvmChain(eth: EvmProvider, hexChainId: string): Promise<void> {
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (err) {
    const errRec = err as {
      code?: number;
      data?: { originalError?: { code?: number } };
      cause?: { code?: number };
    };
    const code = errRec?.code ?? errRec?.data?.originalError?.code ?? errRec?.cause?.code;
    const errMsg = extractWalletErrorMessage(err, '');
    const isMissingChain =
      code === 4902 || /unrecognized chain|unknown chain|try adding the chain|4902/i.test(errMsg);
    if (!isMissingChain) throw err;
    const numericId = Number.parseInt(hexChainId, 16);
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
          chainId: hexChainId,
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

async function sendEvmOriginTransfer(input: {
  leg: IntentLeg;
  depositAddress: string;
}): Promise<{ txHash: string; sender: string }> {
  const { provider: eth, sender } = await requestEvmAccounts(input.leg.originWalletAddress);

  if (input.leg.hexChainId) {
    await switchOrAddEvmChain(eth, input.leg.hexChainId);
  }

  const amountBig = BigInt(input.leg.amountAtomic);
  const tokenContract = input.leg.originToken.contractAddress?.trim();
  const isErc20 = Boolean(tokenContract && /^0x[a-fA-F0-9]{40}$/.test(tokenContract));

  let baseTxParams: Record<string, string>;
  if (isErc20 && tokenContract) {
    const cleanRecipient = input.depositAddress.replace(/^0x/i, '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(cleanRecipient)) {
      throw new Error('Deposit address format does not match EVM.');
    }
    const data =
      '0xa9059cbb' +
      cleanRecipient.padStart(64, '0') +
      amountBig.toString(16).padStart(64, '0');
    baseTxParams = {
      from: sender,
      to: tokenContract,
      value: '0x0',
      data,
    };
  } else {
    baseTxParams = {
      from: sender,
      to: input.depositAddress,
      value: `0x${amountBig.toString(16)}`,
    };
  }

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

  let txHash: string;
  if (Object.keys(feeOverrides).length > 0) {
    try {
      txHash = (await eth.request({
        method: 'eth_sendTransaction',
        params: [{ ...baseTxParams, ...feeOverrides }],
      })) as string;
    } catch (err) {
      const code = (err as { code?: number })?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 4001 || /user rejected|user denied|canceled/i.test(msg)) {
        throw err;
      }
      txHash = (await eth.request({
        method: 'eth_sendTransaction',
        params: [baseTxParams],
      })) as string;
    }
  } else {
    txHash = (await eth.request({
      method: 'eth_sendTransaction',
      params: [baseTxParams],
    })) as string;
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

async function sendSvmOriginTransfer(input: {
  leg: IntentLeg;
  depositAddress: string;
}): Promise<{ txHash: string }> {
  const preferred = input.leg.originWalletAddress.trim();
  const injected = getInjectedSolanaProvider();

  if (injected && typeof injected.request === 'function') {
    const conn = await injected.connect();
    const senderAddress =
      conn?.publicKey?.toString() || injected.publicKey?.toString() || preferred;
    if (!senderAddress) {
      throw new Error('Select an account in your Solana wallet to continue.');
    }

    const prep = await api.intentsSvmPrepare({
      senderAddress,
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

  const standardWallets = getStandardSolanaWallets();
  if (standardWallets.length === 0) {
    throw new Error('No Solana browser wallet detected.');
  }

  const wallet =
    standardWallets.find((w) => w.accounts.some((a) => a.address === preferred)) ??
    standardWallets[0]!;

  let accounts = wallet.accounts;
  if (accounts.length === 0 && 'standard:connect' in wallet.features) {
    const connectFeature = wallet.features['standard:connect'] as {
      connect: () => Promise<{ accounts: readonly { address: string }[] }>;
    };
    const connected = await connectFeature.connect();
    accounts = connected.accounts as typeof wallet.accounts;
  }

  const targetAccount =
    accounts.find((a) => a.address === preferred) ?? accounts[0];
  if (!targetAccount) {
    throw new Error('Select an account in your Solana wallet to continue.');
  }

  const prep = await api.intentsSvmPrepare({
    senderAddress: targetAccount.address,
    depositAddress: input.depositAddress,
    amountAtomic: input.leg.amountAtomic,
    ...(input.leg.originToken.contractAddress
      ? { tokenContract: input.leg.originToken.contractAddress }
      : {}),
    decimals: input.leg.originToken.decimals,
    ...(input.leg.quote.depositMemo ? { memo: input.leg.quote.depositMemo } : {}),
  });

  const signFeature = wallet.features['solana:signTransaction'] as {
    signTransaction: (
      ...inputs: Array<{ account: unknown; transaction: Uint8Array }>
    ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
  };

  const outputs = await signFeature.signTransaction({
    account: targetAccount,
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
