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
