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

export interface Mint {
  workflowId: number;
  txHash: string;
  signerId: string;
  network: Chain;
  contractId: string;
}

export async function callNearContract(params: {
  contractId: string;
  methodName: string;
  args?: Record<string, unknown>;
  deposit?: string;
  gas?: number;
}): Promise<Execute> {
  return api.nearExecute(params);
}

function parseMintedWorkflowId(response: Execute): number {
  if (typeof response.result === 'number' && Number.isInteger(response.result) && response.result > 0) {
    return response.result;
  }
  if (typeof response.result === 'string') {
    const parsed = Number.parseInt(response.result, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  for (const log of response.logs) {
    if (!log.startsWith('EVENT_JSON:')) continue;
    try {
      const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as {
        event?: string;
        data?:
          | { workflow_id?: number; token_ids?: string[] }
          | Array<{ workflow_id?: number; token_ids?: string[] }>;
      };
      const payload = Array.isArray(event.data) ? event.data[0] : event.data;
      if (event.event === 'workflow_minted' && payload?.workflow_id) {
        return payload.workflow_id;
      }
      if (event.event === 'nft_mint' && payload?.token_ids?.[0]) {
        const parsed = Number.parseInt(payload.token_ids[0], 10);
        if (Number.isInteger(parsed) && parsed > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore non-matching log lines
    }
  }
  throw new Error('Workflow transaction succeeded, but workflow_id was not returned in outcome.');
}

export async function mintCoordinatorOnChain(input: {
  name: string;
  image: string;
  personality: string;
  model: string;
}): Promise<Coordinator> {
  const contracts = getContractAddresses();
  const network: 'near:mainnet' | 'near:testnet' =
    contracts.network === 'testnet' ? 'near:testnet' : 'near:mainnet';

  return api.mintCoordinator({
    name: input.name.trim(),
    image: input.image,
    personality: input.personality.trim(),
    model: input.model.trim(),
    contractId: contracts.factory,
    network,
  });
}

export async function mintWorkflowOnChain(input: {
  flow: Listing;
  terms: Pick<Terms, 'creatorFee' | 'tasks' | 'description'>;
  workflowCardUri: string;
  banner?: string | null;
  agentIds?: number[];
}): Promise<Mint> {
  const contracts = getContractAddresses();
  const coordinatorAgentId = input.flow.coordinator?.agentId;
  const combinedAgentIds = [
    ...(input.agentIds ?? []),
    ...(typeof coordinatorAgentId === 'number' && coordinatorAgentId > 0 ? [coordinatorAgentId] : []),
  ];
  const uniqueAgentIds = Array.from(
    new Set(combinedAgentIds.filter(id => Number.isInteger(id) && id > 0)),
  );

  const executed = await callNearContract({
    contractId: contracts.workflow,
    methodName: 'mint_workflow',
    args: {
      params: {
        title: input.flow.name,
        description: input.terms.description,
        banner: input.banner ?? '',
        workflow_card_uri: input.workflowCardUri,
        units: 1_000_000,
        lease_enabled: false,
        lease_duration: 0,
        lease_percent: 0,
        has_coordinator: Boolean(input.flow.coordinator),
        coordinator_model: input.flow.coordinator?.model ?? '',
      },
      agent_ids: uniqueAgentIds,
    },
    deposit: '0',
    gas: uniqueAgentIds.length > 0 ? 180_000_000_000_000 : 100_000_000_000_000,
  });

  const workflowId = parseMintedWorkflowId(executed);

  return {
    workflowId,
    txHash: executed.txHash,
    signerId: executed.signerId,
    network: executed.network,
    contractId: contracts.workflow,
  };
}
