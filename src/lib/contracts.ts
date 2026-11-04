import { api, requireEnv, type Execute } from './api';
import type { Coordinator, Listing, Terms } from './schema';

export type Chain = 'mainnet' | 'testnet';

export interface Addresses {
  factory: string;
  workflow: string;
  reputation: string;
  validation: string;
  network: Chain;
}

export function getContractAddresses(): Addresses {
  const rawNetwork = requireEnv('VITE_NEAR_NETWORK');
  if (
    rawNetwork !== 'mainnet' &&
    rawNetwork !== 'testnet' &&
    rawNetwork !== 'near:mainnet' &&
    rawNetwork !== 'near:testnet'
  ) {
    throw new Error('VITE_NEAR_NETWORK must be mainnet or testnet.');
  }
  const network: Chain =
    rawNetwork === 'testnet' || rawNetwork === 'near:testnet' ? 'testnet' : 'mainnet';
  return {
    factory: requireEnv('VITE_FACTORY_ADDRESS'),
    workflow: requireEnv('VITE_WORKFLOW_ADDRESS'),
    reputation: requireEnv('VITE_REPUTATION_ADDRESS'),
    validation: requireEnv('VITE_VALIDATION_ADDRESS'),
    network,
  };
}

export function explorerBaseUrl(contractOrNetwork?: string): string {
  const ref = contractOrNetwork ?? getContractAddresses().network;
  if (ref.endsWith('.testnet') || ref === 'near:testnet' || ref === 'testnet') {
    return 'https://testnet.nearblocks.io';
  }
  return 'https://nearblocks.io';
}

export function explorerTxUrl(txHash: string, contractOrNetwork?: string): string {
  return `${explorerBaseUrl(contractOrNetwork)}/txns/${txHash}`;
}

export function explorerAccountUrl(accountId: string, contractOrNetwork?: string): string {
  const inferred =
    contractOrNetwork ??
    (accountId.endsWith('.testnet')
      ? 'testnet'
      : accountId.endsWith('.near')
        ? 'mainnet'
        : undefined);
  return `${explorerBaseUrl(inferred)}/address/${accountId}`;
}

export function externalWalletExplorerUrl(
  network: 'near' | 'evm' | 'svm',
  address: string,
  contractOrNetwork?: string,
): string {
  if (network === 'evm') {
    return `https://etherscan.io/address/${address}`;
  }
  if (network === 'svm') {
    return `https://solscan.io/account/${address}`;
  }
  return explorerAccountUrl(address, contractOrNetwork);
}

export const NETWORK_LOGO_BY_CHAIN: Record<'near' | 'evm' | 'svm', string> = {
  near: '/networks/NEAR-2.png',
  evm: '/networks/ethereum.png',
  svm: '/networks/solana-2.png',
};

export function shortHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const INLINE_TOKEN_SPLIT_RE = /(\s+)/;
const INLINE_URL_RE = /^(?:https?|ipfs|wss?):\/\//i;
const INLINE_NEAR_NAMED_RE = /^[a-z0-9_.-]{18,}\.(?:near|testnet)$/i;
const INLINE_UNIVERSAL_OR_HEX_RE = /^(?:0u[a-z0-9]{18,}|0x[a-f0-9]{14,}|[a-f0-9]{36,})$/i;
const INLINE_BASE58_RE = /^(?=.*[0-9A-Z])[1-9A-HJ-NP-Za-km-z]{32,88}$/;

function shortenAddressToken(rawToken: string): string {
  if (!rawToken || rawToken.length < 16 || INLINE_URL_RE.test(rawToken)) {
    return rawToken;
  }
  const match = /^([([{'"`]*)(.+?)([)\]}'"`.,;:!?]*)$/.exec(rawToken);
  if (!match) return rawToken;
  const [, prefix, core, suffix] = match;
  if (!core || core.includes('…') || core.includes('/') || INLINE_URL_RE.test(core)) {
    return rawToken;
  }
  if (INLINE_NEAR_NAMED_RE.test(core)) {
    return `${prefix}${core.length > 22 ? shortHash(core, 8, 6) : core}${suffix}`;
  }
  if (INLINE_UNIVERSAL_OR_HEX_RE.test(core) || INLINE_BASE58_RE.test(core)) {
    return `${prefix}${shortHash(core, 6, 4)}${suffix}`;
  }
  return rawToken;
}

export function shortenInlineAddresses(text: string): string {
  if (!text || text.length < 16) return text;
  return text
    .split(INLINE_TOKEN_SPLIT_RE)
    .map((part) => (part.trim() ? shortenAddressToken(part) : part))
    .join('');
}
