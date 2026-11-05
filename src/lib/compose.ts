import {
  ComposeSDK,
  type ActiveSessionMetadata,
} from '@compose-market/sdk';
import { type MissingConnectorRequirement, requireEnv } from './api';
import type { Block, Entry } from './schema';

export type Network = 'near:mainnet' | 'near:testnet';

export function nearNetworkId(): Network {
  const raw = requireEnv('VITE_NEAR_NETWORK');
  if (raw === 'testnet' || raw === 'near:testnet') {
    return 'near:testnet';
  }
  if (raw === 'mainnet' || raw === 'near:mainnet') {
    return 'near:mainnet';
  }
  throw new Error('VITE_NEAR_NETWORK must be mainnet or testnet.');
}

export function sessionNetworkFor(network: 'mainnet' | 'testnet'): Network {
  return network === 'testnet' ? 'near:testnet' : 'near:mainnet';
}

export const compose = new ComposeSDK({
  baseUrl: requireEnv('VITE_COMPOSE_API_URL').replace(/\/+$/, ''),
  network: nearNetworkId(),
});

let attachedUserAddress: string | null = null;
let attachedNetwork: Network | null = null;

export function getComposeSdk(userAddress?: string, network?: Network): ComposeSDK {
  const targetNetwork = network ?? attachedNetwork ?? nearNetworkId();
  if (userAddress && (userAddress !== attachedUserAddress || targetNetwork !== attachedNetwork)) {
    compose.wallets.attach({
      address: userAddress,
      network: targetNetwork,
    });
    attachedUserAddress = userAddress;
    attachedNetwork = targetNetwork;
  }
  return compose;
}

export async function readSession(
  spendingAddress: string,
  network: Network,
): Promise<ActiveSessionMetadata> {
  const sdk = getComposeSdk(spendingAddress, network);
  const current = await sdk.keys.getActive({
    network,
  });
  if (current.hasSession && current.token && current.status?.isActive) {
    sdk.keys.use(current.token);
  }
  return current;
}

export async function activateSession(
  spendingAddress: string,
  budgetWei: string,
  network: Network,
  durationMs = 30 * 24 * 60 * 60 * 1000,
  forceNew = false,
): Promise<{ token: string; keyId: string; userAddress: string; network: Network }> {
  const sdk = getComposeSdk(spendingAddress, network);
  const existing = await sdk.keys.getActive({ network }).catch(() => null);
  if (
    !forceNew &&
    existing?.hasSession &&
    existing.token &&
    existing.keyId &&
    existing.status?.isActive &&
    !existing.status.warnings?.budgetDepleted &&
    BigInt(existing.budgetRemaining ?? '0') > 0n
  ) {
    sdk.keys.use(existing.token);
    return {
      token: existing.token,
      keyId: existing.keyId,
      userAddress: spendingAddress,
      network,
    };
  }
  if (existing?.keyId && existing.hasSession) {
    await sdk.keys.revoke(existing.keyId).catch(() => undefined);
  }
  let created: Awaited<ReturnType<typeof sdk.keys.create>> | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      created = await sdk.keys.create({
        network,
        budgetWei,
        expiresAt: Date.now() + durationMs,
        purpose: 'session',
        name: 'workflow-limit',
      });
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/insufficient.*balance/i.test(msg) && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw err;
    }
  }
  if (!created) {
    throw lastError instanceof Error ? lastError : new Error('Failed to activate session.');
  }
  sdk.keys.use(created.token);
  return {
    token: created.token,
    keyId: created.keyId,
    userAddress: spendingAddress,
    network,
  };
}

export async function revokeSession(
  spendingAddress: string,
  network: Network,
  keyId?: string,
): Promise<void> {
  const sdk = getComposeSdk(spendingAddress, network);
  const targetKeyId =
    keyId ?? (await sdk.keys.getActive({ network }).catch(() => null))?.keyId;
  if (targetKeyId) {
    await sdk.keys.revoke(targetKeyId).catch(() => undefined);
  }
}

export async function ensureAuthenticatedComposeSdk(
  userAddress: string,
  network?: Network,
): Promise<ComposeSDK> {
  const targetNetwork = network ?? attachedNetwork ?? nearNetworkId();
  const sdk = getComposeSdk(userAddress, targetNetwork);
  await readSession(userAddress, targetNetwork).catch(() => null);
  return sdk;
}

export async function readConnectorStatus(userAddress: string) {
  const sdk = await ensureAuthenticatedComposeSdk(userAddress);
  return sdk.connectors.status({ userAddress });
}

export async function fetchMcpCredentialSpecs(
  userAddress: string,
  slug: string,
): Promise<Array<{ varName: string; description?: string; obtainUrl?: string }>> {
  const sdk = await ensureAuthenticatedComposeSdk(userAddress);
  const server = await sdk.connectors.mcps.get(slug);
  const creds = (server as { credentials?: Array<{ varName: string; description?: string; obtainUrl?: string }> }).credentials;
  return Array.isArray(creds)
    ? creds.filter(c => typeof c?.varName === 'string' && c.varName.trim().length > 0)
    : [];
}

export async function connectComposioAccountPopup(
  userAddress: string,
  toolkit: string,
): Promise<void> {
  const sdk = await ensureAuthenticatedComposeSdk(userAddress);
  const existing = await sdk.connectors.accounts.list({ userAddress, toolkit });
  const alreadyConnected = (existing.connections ?? []).some(
    conn => conn.slug.toLowerCase() === toolkit.toLowerCase() && conn.connected,
  );
  if (alreadyConnected) {
    await sdk.connectors.accounts.grant({ userAddress, toolkit });
    return;
  }

  const started = await sdk.connectors.accounts.connect({
    userAddress,
    toolkit,
  });

  if (started.status === 'ACTIVE') {
    await sdk.connectors.accounts.grant({ userAddress, toolkit });
    return;
  }

  if (!started.redirectUrl) {
    throw new Error('No authentication redirect URL returned from server.');
  }

  const width = 560;
  const height = 700;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    started.redirectUrl,
    `composio_connect_${toolkit}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  );
  if (!popup) {
    throw new Error('Allow browser popups to connect this account.');
  }

  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const current = await sdk.connectors.accounts
      .status({
        userAddress,
        toolkit,
        connectedAccountId: started.connectedAccountId,
      })
      .catch(() => null);
    if (current?.connected || current?.status === 'ACTIVE') {
      if (!popup.closed) popup.close();
      await sdk.connectors.accounts.grant({ userAddress, toolkit });
      return;
    }
    if (popup.closed) {
      const checkAfterClose = await sdk.connectors.accounts
        .status({
          userAddress,
          toolkit,
          connectedAccountId: started.connectedAccountId,
        })
        .catch(() => null);
      if (checkAfterClose?.connected || checkAfterClose?.status === 'ACTIVE') {
        await sdk.connectors.accounts.grant({ userAddress, toolkit });
        return;
      }
      throw new Error('Account connection window closed before completion.');
    }
  }
  if (!popup.closed) popup.close();
  throw new Error('Timed out waiting for account connection.');
}
