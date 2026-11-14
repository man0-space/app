import type {
  Flow,
  Listing,
  Terms,
  User,
  Profile,
  CreatorProfile,
  SocialLink,
  SocialPlatform,
  LinkProvider,
  Consent,
  Policy,
  Provider,
  Coordinator,
  Entry,
  Thread,
} from './schema';

export type {
  Flow,
  Listing,
  Terms,
  User,
  Profile,
  CreatorProfile,
  SocialLink,
  SocialPlatform,
  LinkProvider,
  Consent,
  Policy,
  Provider,
  Coordinator,
  Thread,
};

export interface MissingConnectorRequirement {
  entryId: string;
  slug: string;
  name: string;
  type: 'account' | 'gated';
  userAddress?: string;
  missingVars?: Array<{ varName: string; description?: string; obtainUrl?: string }>;
  reason: string;
  agentWallet?: string;
  runId?: string;
  threadId?: string;
  requestId?: string;
}

export interface MissingInputRequirement {
  stepId: string;
  stepLabel: string;
  modelId?: string;
  modelName?: string;
  acceptedInputs: string[];
  questions?: string[];
  reason: string;
  agentWallet?: string;
  runId?: string;
  threadId?: string;
  proposalId?: string;
}

export type VibePatch =
  | { op: 'set_title'; name: string }
  | { op: 'set_description'; brief: string }
  | { op: 'set_categories'; tasks: string[] }
  | { op: 'set_coordinator'; coordinator: Coordinator | null }
  | { op: 'set_banner'; banner: string }
  | { op: 'add_step'; node: Flow['nodes'][number]; edge?: Flow['edges'][number] }
  | { op: 'update_step'; stepId: string; label?: string; note?: string; entry?: Entry }
  | { op: 'connect_steps'; edge: Flow['edges'][number] }
  | { op: 'remove_step'; stepId: string }
  | { op: 'arrange_canvas'; positions: Record<string, { x: number; y: number }> };

export type VibeStreamEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'patch'; patch: VibePatch }
  | { type: 'banner_start' }
  | { type: 'workflow_ready'; text: string; flow: Flow }
  | { type: 'done'; text: string; flow: Flow }
  | { type: 'error'; error: string };

export interface ConnectorDecisionItem {
  runId: string;
  requestId: string;
  decision: 'connected' | 'discarded';
}

export interface WorkflowBillItem {
  category: 'coordinator' | 'model' | 'connector' | 'agent';
  kind: string;
  name: string;
  subject?: string;
  stepId?: string;
  receiptId?: string;
  txHash?: string;
  amountWei: string;
}

export type RunStreamEvent =
  | { type: 'thread:init'; threadId: string; runId: string }
  | { type: 'step:start'; stepId: string; label: string; kind: string }
  | { type: 'step:done'; stepId: string; label: string; kind: string; output: string }
  | {
      type: 'sse:activity';
      id: string;
      ts: number;
      stepId: string | null;
      kind: string;
      status: 'running' | 'completed' | 'pending' | 'failed';
      title: string;
      summary?: string;
    }
  | { type: 'sse:delta'; stepId: string | null; delta: string }
  | { type: 'sse:bill'; composeBillWei: string; bills: WorkflowBillItem[] }
  | { type: 'connector:pause'; missing: MissingConnectorRequirement[] }
  | { type: 'input:pause'; missingInputs: MissingInputRequirement[] }
  | { type: 'ping'; ts: number }
  | { type: 'result'; execution: Execution }
  | {
      type: 'error';
      statusCode?: number;
      code?: string;
      threadId?: string;
      missing?: MissingConnectorRequirement[];
      missingInputs?: MissingInputRequirement[];
      error: string;
    };

export interface TaskTagItem {
  id: string;
  label: string;
  desc: string;
}

export interface TaskCategoryGroup {
  id: string;
  label: string;
  desc: string;
  tags: TaskTagItem[];
}

export interface OptionsResponse {
  tasks: TaskCategoryGroup[];
  maxTaskTags: number;
}

export interface AnalyticsBucket {
  start: string;
  totals: {
    requests: { total: number; succeeded: number; failed: number };
    latency: { count: number; averageMs: number };
    billing: {
      quotedAmountAtomic: string;
      finalAmountAtomic: string;
      composeBillAtomic?: string;
      creatorFeeAtomic?: string;
      currency: string;
    };
  };
}

export interface AnalyticsRequestRow {
  id: string;
  workflowId?: string;
  model: string;
  status: string;
  network: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  billing: {
    quotedAmountAtomic: string;
    finalAmountAtomic: string;
    composeBillAtomic?: string;
    creatorFeeAtomic?: string;
    currency: string;
  };
  usage?: { units?: Array<{ key: string; quantity: number; unit: string }> };
}

export interface AnalyticsSettlementRow {
  id: string;
  workflowId?: string;
  model: string;
  status: string;
  network: string;
  createdAt: string;
  billing: {
    quotedAmountAtomic: string;
    finalAmountAtomic: string;
    composeBillAtomic?: string;
    creatorFeeAtomic?: string;
    currency: string;
  };
  settleTransactionHash?: string;
  transactionHash?: string;
}

export interface AnalyticsPayload {
  filters: { from: string; to: string; interval: string; networks: string[] };
  totals: {
    requests: { total: number; succeeded: number; failed: number };
    latency: { count: number; averageMs: number };
    billing: {
      quotedAmountAtomic: string;
      finalAmountAtomic: string;
      composeBillAtomic?: string;
      creatorFeeAtomic?: string;
      currency: string;
    };
  };
  timeline: AnalyticsBucket[];
  requests: { data: AnalyticsRequestRow[]; nextCursor: string | null };
  settlements: { data: AnalyticsSettlementRow[]; nextCursor: string | null };
}

export interface CreatorWorkflowEarningSummary {
  workflowId: string;
  name: string;
  banner: string | null;
  tasks: string[];
  published: string | null;
  modified: string;
  creatorFee: number;
  stepsCount: number;
  runs: number;
  paidRuns: number;
  succeededRuns: number;
  failedRuns: number;
  earnedAtomic: string;
  totalChargedAtomic: string;
  avgDurationMs: number;
  totalDurationMs: number;
  lastRunAt: string | null;
}

export interface CreatorEarningEvent {
  id: string;
  workflowId: string;
  workflowName: string;
  tasks: string[];
  runnerAddress: string;
  status: string;
  network: string;
  earnedAtomic: string;
  composeBillAtomic: string;
  totalChargedAtomic: string;
  durationMs: number;
  stepsCount: number;
  txHash: string | null;
  proofCid: string | null;
  timestamp: string;
}

export interface CreatorEarnPayload {
  filters: { from: string; to: string };
  workflows: CreatorWorkflowEarningSummary[];
  events: CreatorEarningEvent[];
}

export type Config = {
  providers: { id: Provider; available: boolean }[];
  linkProviders?: { id: LinkProvider; available: boolean }[];
  passkey: { create: boolean; login: boolean };
  email: { enabled: boolean };
  fees: {
    creatorOptions: number[];
    platformPercent: number;
  };
};

export type Auth = {
  token: string;
  user: User;
  expires: string;
};

let current =
  typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
    ? localStorage.getItem('token')
    : null;

export function token(value: string | null) {
  current = value;
  if (value) localStorage.setItem('token', value);
  else localStorage.removeItem('token');
}

export function authenticated() {
  return Boolean(current);
}

export class Fault extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly missing?: MissingConnectorRequirement[],
    readonly missingInputs?: MissingInputRequirement[],
    readonly threadId?: string,
  ) {
    super(message);
  }
}

export function requireEnv(name: string): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const nodeEnv =
    typeof globalThis !== 'undefined' && 'process' in globalThis
      ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      : undefined;
  const value = (viteEnv?.[name] ?? nodeEnv?.[name])?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const prefix = `${requireEnv('VITE_API_URL').replace(/\/+$/, '')}/api`;

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${prefix}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(current ? { authorization: `Bearer ${current}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: 'Request failed.' }))) as {
      error?: string;
      code?: string;
      threadId?: string;
      missing?: MissingConnectorRequirement[];
      missingInputs?: MissingInputRequirement[];
    };
    throw new Fault(
      payload.error || 'Request failed.',
      response.status,
      payload.code,
      payload.missing,
      payload.missingInputs,
      payload.threadId,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

async function readNdjson<E>(
  response: Response,
  onEvent: (event: E) => void,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as E);
        } catch {
          // Ignore malformed keepalive lines
        }
      }
      idx = buffer.indexOf('\n');
    }
  }
  const trailing = buffer.trim();
  if (trailing) {
    try {
      onEvent(JSON.parse(trailing) as E);
    } catch {
      // Ignore trailing fragment
    }
  }
}

const body = (value: unknown) => JSON.stringify(value);
const condition = (modified?: string): Record<string, string> =>
  modified ? { 'if-match': modified } : {};

export type Execute = {
  txHash: string;
  signerId: string;
  network: 'mainnet' | 'testnet';
  result: unknown;
  logs: string[];
};

export type Balance = {
  userAddress: string;
  depositAddress: string;
  spendingAddress: string;
  mainBalanceWei: string;
  spendingBalanceWei: string;
  network: 'mainnet' | 'testnet';
};

export type Transfer = Balance & {
  txHash: string;
};

export type IntentToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
};

export type IntentQuote = {
  depositAddress?: string;
  depositMemo?: string | null;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOut?: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
};

export type IntentLeg = {
  source: 'intents' | 'account' | 'external';
  depositType: 'INTENTS' | 'ORIGIN_CHAIN';
  originToken: IntentToken;
  originChainLabel: string;
  originExplorerUrl?: string;
  originWalletNetwork: 'evm' | 'svm' | 'near';
  originWalletAddress: string;
  intentsAccountId?: string;
  hexChainId?: string;
  destinationToken: IntentToken;
  destinationChainLabel: string;
  recipientAddress: string;
  amountAtomic: string;
  displayAmount: string;
  quote: IntentQuote;
};

export type IntentRoute = {
  action: 'deposit' | 'swap' | 'withdraw';
  depositType: 'INTENTS' | 'ORIGIN_CHAIN';
  originToken: IntentToken;
  originChainLabel: string;
  originWalletNetwork: 'evm' | 'svm' | 'near';
  originWalletAddress: string;
  intentsAccountId?: string;
  hexChainId?: string;
  destinationToken: IntentToken;
  destinationChainLabel: string;
  recipientAddress: string;
  amountAtomic: string;
  displayAmount: string;
  quote: IntentQuote;
  legs: IntentLeg[];
  totalOutFormatted: string;
  totalOutUsd: string;
};

export type IntentGenerateResponse = {
  mode: 'submitted';
  txHash?: string;
  intentHash: string;
  correlationId: string;
};

export type IntentSvmPrepareResponse = {
  messageBase58: string;
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
};

export type IntentSvmBroadcastResponse = {
  txHash: string;
  explorerUrl: string;
};

export type IntentStatus = {
  status:
    | 'PENDING_DEPOSIT'
    | 'KNOWN_DEPOSIT_TX'
    | 'PROCESSING'
    | 'SUCCESS'
    | 'INCOMPLETE_DEPOSIT'
    | 'REFUNDED'
    | 'FAILED';
  updatedAt?: string;
  swapDetails?: {
    amountInFormatted?: string;
    amountOutFormatted?: string;
    originChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl?: string }>;
  };
};

export type Trace = {
  id: string;
  label: string;
  kind: string;
  entryId: string | null;
  billWei: string;
  output: string;
};

export type WorkflowAttachment = {
  type: 'image' | 'audio' | 'video' | 'pdf' | 'file' | 'text' | 'json';
  url: string;
  mimeType?: string;
  name?: string;
  size?: number;
  cid?: string;
  text?: string;
};

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file.'));
    reader.readAsDataURL(blob);
  });
}

export type Execution = {
  ok: boolean;
  workflowId: string;
  threadId?: string;
  chainWorkflowId: number | null;
  name: string;
  creatorUserAddress: string;
  userAddress: string;
  network: string;
  dry?: boolean;
  composeBillWei: string;
  creatorFeePercent: number;
  creatorFeeWei: string;
  platformFeePercent: number;
  platformFeeWei: string;
  serviceFeeWei: string;
  totalChargedWei: string;
  txHash: string | null;
  paymentIntentId: string | null;
  proofCid?: string | null;
  proofUrl?: string | null;
  output: string;
  steps: Trace[];
  bills?: WorkflowBillItem[];
};

async function consumeExecutionResponse(
  response: Response,
  onEvent: (event: RunStreamEvent) => void,
): Promise<Execution> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({ error: 'Request failed.' }))) as {
      error?: string;
      code?: string;
      threadId?: string;
      missing?: MissingConnectorRequirement[];
      missingInputs?: MissingInputRequirement[];
    };
    throw new Fault(
      payload.error || 'Request failed.',
      response.status,
      payload.code,
      payload.missing,
      payload.missingInputs,
      payload.threadId,
    );
  }
  let finalResult: Execution | null = null;
  let pausedMissing: MissingConnectorRequirement[] | undefined;
  let pausedMissingInputs: MissingInputRequirement[] | undefined;
  let latestThreadId: string | undefined;
  let streamFault: Fault | null = null;
  let sawTerminal = false;

  await readNdjson<RunStreamEvent>(response, evt => {
    if (evt.type === 'ping') return;
    onEvent(evt);
    if (evt.type === 'thread:init') {
      latestThreadId = evt.threadId;
    } else if (evt.type === 'connector:pause') {
      pausedMissing = evt.missing;
      latestThreadId = evt.missing[0]?.threadId ?? latestThreadId;
    } else if (evt.type === 'input:pause') {
      pausedMissingInputs = evt.missingInputs;
      latestThreadId = evt.missingInputs[0]?.threadId ?? latestThreadId;
    } else if (evt.type === 'result') {
      sawTerminal = true;
      finalResult = evt.execution;
    } else if (evt.type === 'error') {
      sawTerminal = true;
      streamFault = new Fault(
        evt.error || 'Workflow execution failed.',
        evt.statusCode ?? 500,
        evt.code,
        evt.missing ?? pausedMissing,
        evt.missingInputs ?? pausedMissingInputs,
        evt.threadId ?? latestThreadId,
      );
    }
  });

  if (streamFault) throw streamFault;
  if (!sawTerminal || !finalResult) {
    if (pausedMissingInputs?.length) {
      throw new Fault(
        pausedMissingInputs[0]?.reason || 'Additional input is required to run this workflow.',
        428,
        'INPUT_REQUIRED',
        pausedMissing,
        pausedMissingInputs,
        pausedMissingInputs[0]?.threadId ?? latestThreadId,
      );
    }
    if (pausedMissing?.length) {
      throw new Fault(
        'Connect required accounts to run this workflow.',
        428,
        'CONNECTOR_REQUIRED',
        pausedMissing,
        undefined,
        pausedMissing[0]?.threadId ?? latestThreadId,
      );
    }
    throw new Fault(
      'Workflow execution stream ended before receiving a final result.',
      502,
      'STREAM_TRUNCATED',
      undefined,
      undefined,
      latestThreadId,
    );
  }
  return finalResult;
}

async function streamExecutionRequest(
  path: string,
  payloadBody: Record<string, unknown>,
  headers: Record<string, string> | undefined,
  onEvent: (event: RunStreamEvent) => void,
  signal?: AbortSignal,
): Promise<Execution> {
  const response = await fetch(`${prefix}${path}`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
      ...(current ? { authorization: `Bearer ${current}` } : {}),
      ...headers,
    },
    body: body(payloadBody),
  });
  return consumeExecutionResponse(response, onEvent);
}

function executeOrStreamRun(
  path: string,
  extraBody: Record<string, unknown>,
  input?: string,
  composeSession?: {
    token: string;
    userAddress: string;
    network: string;
  },
  options?: {
    attachments?: WorkflowAttachment[];
    dry?: boolean;
    threadId?: string;
    coordinator?: Coordinator | null;
    connectorDecisions?: ConnectorDecisionItem[];
    onEvent?: (event: RunStreamEvent) => void;
    signal?: AbortSignal;
  },
): Promise<Execution> {
  const sessionHeaders = composeSession
    ? {
        'x-compose-key': composeSession.token,
        'x-session-user-address': composeSession.userAddress,
        'x-network-id': composeSession.network,
      }
    : undefined;
  const reqBody: Record<string, unknown> = {
    ...extraBody,
    ...(input !== undefined ? { input } : {}),
    ...(options?.attachments && options.attachments.length > 0
      ? { attachments: options.attachments }
      : {}),
    ...(options?.dry !== undefined ? { dry: options.dry } : {}),
    ...(options?.threadId ? { threadId: options.threadId } : {}),
    ...(options?.coordinator ? { coordinator: options.coordinator } : {}),
    ...(options?.connectorDecisions && options.connectorDecisions.length > 0
      ? { connectorDecisions: options.connectorDecisions }
      : {}),
  };
  if (options?.onEvent) {
    return streamExecutionRequest(path, reqBody, sessionHeaders, options.onEvent, options.signal);
  }
  return request<Execution>(path, {
    method: 'POST',
    headers: sessionHeaders,
    signal: options?.signal,
    body: body(reqBody),
  });
}

export const api = {
  config: () => request<Config>('/config'),
  taskOptions: () => request<OptionsResponse>('/options'),
  options: (mode: 'create' | 'login') =>
    request<{ id: string; options: Record<string, unknown> }>('/auth/passkey/options', {
      method: 'POST',
      body: body({ mode }),
    }),
  register: (id: string, credential: unknown) =>
    request<Auth>('/auth/passkey/register', {
      method: 'POST',
      body: body({ id, credential }),
    }),
  verify: (id: string, credential: unknown) =>
    request<Auth>('/auth/passkey/verify', {
      method: 'POST',
      body: body({ id, credential }),
    }),
  email: (email: string) =>
    request<{
      id: string;
      email: string;
      expiresIn: number;
      code?: string;
    }>('/auth/email/start', {
      method: 'POST',
      body: body({ email }),
    }),
  code: (id: string, code: string) =>
    request<Auth>('/auth/email/verify', {
      method: 'POST',
      body: body({ id, code }),
    }),
  oauth: (provider: Provider, origin = window.location.origin) =>
    `${prefix}/oauth/${provider}/start?origin=${encodeURIComponent(origin)}&mode=auth`,
  oauthLink: (provider: LinkProvider, origin = window.location.origin) =>
    `${prefix}/oauth/${provider}/start?origin=${encodeURIComponent(origin)}&mode=link`,
  linkSocialPopup: async (provider: LinkProvider): Promise<SocialLink> => {
    const url = `${prefix}/oauth/${provider}/start?origin=${encodeURIComponent(window.location.origin)}&mode=link`;
    const width = 500;
    const height = 640;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      url,
      `oauth_link_${provider}`,
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!popup) {
      throw new Error('Allow popups to link this account.');
    }
    return new Promise<SocialLink>((resolve, reject) => {
      const timer = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error('Verification window closed.'));
        }
      }, 400);

      function onMessage(event: MessageEvent) {
        const data = event.data as
          | {
              type?: string;
              ok?: boolean;
              social?: SocialLink;
              profile?: SocialLink;
              error?: string;
            }
          | undefined;
        if (!data || data.type !== 'oauth-link') return;
        cleanup();
        const linked = data.social ?? data.profile;
        if (data.ok && linked) {
          resolve(linked);
        } else {
          reject(new Error(data.error || 'Could not verify social account.'));
        }
      }

      function cleanup() {
        window.clearInterval(timer);
        window.removeEventListener('message', onMessage);
      }

      window.addEventListener('message', onMessage);
    });
  },
  link: (value: {
    network: 'evm' | 'svm';
    address: string;
    providerRdns?: string;
    providerName?: string;
  }) =>
    request<{
      id: string;
      userAddress: string;
      network: 'evm' | 'svm';
      address: string;
      publicKey: string;
      status: 'pending' | 'active' | 'failed';
      transaction: string | null;
      providerRdns?: string;
      providerName?: string;
    }>('/auth/link', {
      method: 'POST',
      body: body(value),
    }),
  unlink: (id: string) =>
    request<{ removed: boolean; id: string }>(`/auth/link/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  links: () =>
    request<
      {
        id: string;
        userAddress: string;
        network: 'evm' | 'svm';
        address: string;
        publicKey: string;
        status: 'pending' | 'active' | 'failed';
        transaction: string | null;
        providerRdns?: string;
        providerName?: string;
      }[]
    >('/auth/links'),
  nearBalance: () => request<Balance>('/near/balance'),
  intentsQuote: (value: {
    prompt: string;
    dry: boolean;
    connectedWallets?: Array<{ network: 'evm' | 'svm' | 'near'; address: string }>;
  }) =>
    request<IntentRoute>('/near/intents/quote', {
      method: 'POST',
      body: body(value),
    }),
  intentsGenerate: (value: {
    depositAddress: string;
    assetId?: string;
    amountAtomic?: string;
    memo?: string;
  }) =>
    request<IntentGenerateResponse>('/near/intents/generate', {
      method: 'POST',
      body: body(value),
    }),
  intentsDeposit: (value: {
    txHash: string;
    depositAddress: string;
    nearSenderAccount?: string;
    memo?: string;
  }) =>
    request<unknown>('/near/intents/deposit', {
      method: 'POST',
      body: body(value),
    }),
  intentsSvmPrepare: (value: {
    senderAddress: string;
    depositAddress: string;
    amountAtomic: string;
    tokenContract?: string;
    decimals?: number;
    memo?: string;
  }) =>
    request<IntentSvmPrepareResponse>('/near/intents/svm-prepare', {
      method: 'POST',
      body: body(value),
    }),
  intentsSvmBroadcast: (value: {
    signedTransactionBase64: string;
    depositAddress: string;
    memo?: string;
  }) =>
    request<IntentSvmBroadcastResponse>('/near/intents/svm-broadcast', {
      method: 'POST',
      body: body(value),
    }),
  intentsStatus: (depositAddress: string, depositMemo?: string | null) => {
    const qs = new URLSearchParams({ depositAddress });
    if (depositMemo) qs.set('depositMemo', depositMemo);
    return request<IntentStatus>(`/near/intents/status?${qs.toString()}`);
  },
  depositReady: () =>
    request<{
      userAddress: string;
      spendingAddress: string;
      network: 'mainnet' | 'testnet';
      status: string;
    }>('/near/deposit/ready', {
      method: 'POST',
    }),
  spendingApprove: (value: { amountWei: string }) =>
    request<Transfer>('/near/spending/approve', {
      method: 'POST',
      body: body(value),
    }),
  spendingReclaim: (value?: { amountWei?: string }) =>
    request<Transfer>('/near/spending/reclaim', {
      method: 'POST',
      body: body(value ?? {}),
    }),
  nearView: <T = unknown>(value: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
  }) =>
    request<{ result: T }>('/near/view', {
      method: 'POST',
      body: body(value),
    }),
  nearExecute: (value: {
    contractId: string;
    methodName: string;
    args?: Record<string, unknown>;
    deposit?: string;
    gas?: number;
  }) =>
    request<Execute>('/near/execute', {
      method: 'POST',
      body: body(value),
    }),
  pinJson: (value: {
    content: Record<string, unknown>;
    name: string;
    keyvalues?: Record<string, string>;
  }) =>
    request<{ cid: string; uri: string; url: string; size: number }>('/ipfs/pin/json', {
      method: 'POST',
      body: body(value),
    }),
  pinFile: (value: {
    fileBase64: string;
    fileName: string;
    mimeType: string;
    name?: string;
    keyvalues?: Record<string, string>;
  }) =>
    request<{ cid: string; uri: string; url: string; size: number }>('/ipfs/pin/file', {
      method: 'POST',
      body: body(value),
    }),
  generateAvatar: (value: { title?: string; description?: string }) =>
    request<{ imageUrl: string; cid: string }>('/generate-avatar', {
      method: 'POST',
      body: body(value),
    }),
  generateBanner: (value: {
    title?: string;
    description?: string;
    logos?: Array<{ name: string; url?: string }>;
  }) =>
    request<{ imageUrl: string; cid: string }>('/generate-banner', {
      method: 'POST',
      body: body(value),
    }),
  coordinators: () => request<Coordinator[]>('/coordinators'),
  mintCoordinator: (value: {
    name: string;
    image: string;
    personality: string;
    model: string;
    contractId?: string;
    network?: 'near:mainnet' | 'near:testnet';
  }) =>
    request<Coordinator>('/coordinators/mint', {
      method: 'POST',
      body: body(value),
    }),
  streamVibe: async (value: {
    prompt: string;
    flow: Flow;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    signal?: AbortSignal;
    onEvent: (event: VibeStreamEvent) => void;
  }): Promise<{ text: string; flow: Flow } | null> => {
    const response = await fetch(`${prefix}/vibe`, {
      method: 'POST',
      signal: value.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/x-ndjson',
        ...(current ? { authorization: `Bearer ${current}` } : {}),
      },
      body: body({
        prompt: value.prompt,
        flow: value.flow,
        ...(value.history ? { history: value.history } : {}),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ error: 'Vibe request failed.' }))) as {
        error?: string;
        code?: string;
      };
      throw new Fault(payload.error || 'Vibe request failed.', response.status, payload.code);
    }
    let donePayload: { text: string; flow: Flow } | null = null;
    let streamError: string | null = null;
    await readNdjson<VibeStreamEvent>(response, evt => {
      value.onEvent(evt);
      if (evt.type === 'done') {
        donePayload = { text: evt.text, flow: evt.flow };
      } else if (evt.type === 'error') {
        streamError = evt.error;
      }
    });
    if (streamError) {
      throw new Fault(streamError, 502);
    }
    return donePayload;
  },
  user: () => request<User>('/user'),
  creatorProfile: (address: string) =>
    request<CreatorProfile>(`/profile/${encodeURIComponent(address)}`),
  creatorProfiles: (addresses: string[]) =>
    request<{ profiles: Record<string, CreatorProfile> }>(
      `/profiles?addresses=${encodeURIComponent(addresses.join(','))}`,
    ),
  logout: () => request<void>('/auth', { method: 'DELETE' }),
  profile: (value: Profile) => request<User>('/profile', { method: 'PUT', body: body(value) }),
  policy: () => request<Policy & { hash: string }>('/policy'),
  consent: (value: { policy: string; terms: true; privacy: true }) =>
    request<Consent>('/consent', { method: 'POST', body: body(value) }),
  workflows: () => request<Listing[]>('/workflows'),
  workflow: (id: string) => request<Listing>(`/workflows/${encodeURIComponent(id)}`),
  workflowThreads: (id: string) =>
    request<Thread[]>(`/workflows/${encodeURIComponent(id)}/threads`),
  workflowThread: (id: string, threadId: string) =>
    request<Thread>(
      `/workflows/${encodeURIComponent(id)}/threads/${encodeURIComponent(threadId)}`,
    ),
  watchWorkflowThread: async (
    id: string,
    threadId: string,
    onEvent: (event: RunStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<Execution> => {
    const response = await fetch(
      `${prefix}/workflows/${encodeURIComponent(id)}/threads/${encodeURIComponent(threadId)}/watch`,
      {
        method: 'GET',
        signal,
        headers: {
          accept: 'application/x-ndjson',
          ...(current ? { authorization: `Bearer ${current}` } : {}),
        },
      },
    );
    return consumeExecutionResponse(response, onEvent);
  },
  market: () => request<Listing[]>('/market'),
  save: (flow: Flow, modified?: string) =>
    request<Listing>('/workflows', {
      method: 'POST',
      headers: condition(modified),
      body: body(flow),
    }),
  publish: (flow: Listing, terms: Terms) =>
    request<Listing>(`/workflows/${flow.id}/publish`, {
      method: 'POST',
      headers: condition(flow.modified),
      body: body(terms),
    }),
  uploadAttachment: async (
    file: File | Blob,
    fileName?: string,
  ): Promise<WorkflowAttachment & { uri: string }> => {
    const fileBase64 = await blobToBase64(file);
    const resolvedName =
      fileName ||
      (file instanceof File && file.name ? file.name : `attachment-${Date.now()}`);
    return request<WorkflowAttachment & { uri: string }>('/uploads', {
      method: 'POST',
      body: body({
        fileBase64,
        fileName: resolvedName,
        mimeType: file.type || 'application/octet-stream',
      }),
    });
  },
  runWorkflow: (
    workflowId: string,
    input?: string,
    composeSession?: {
      token: string;
      userAddress: string;
      network: string;
    },
    options?: {
      attachments?: WorkflowAttachment[];
      dry?: boolean;
      threadId?: string;
      coordinator?: Coordinator | null;
      connectorDecisions?: ConnectorDecisionItem[];
      onEvent?: (event: RunStreamEvent) => void;
      signal?: AbortSignal;
    },
  ) =>
    executeOrStreamRun(
      `/workflows/${workflowId}/run`,
      {},
      input,
      composeSession,
      options,
    ),
  testRunDraft: (
    flow: Flow,
    input?: string,
    composeSession?: {
      token: string;
      userAddress: string;
      network: string;
    },
    options?: {
      attachments?: WorkflowAttachment[];
      dry?: boolean;
      threadId?: string;
      coordinator?: Coordinator | null;
      connectorDecisions?: ConnectorDecisionItem[];
      onEvent?: (event: RunStreamEvent) => void;
      signal?: AbortSignal;
    },
  ) =>
    executeOrStreamRun(
      '/draft/run',
      { flow },
      input,
      composeSession,
      options,
    ),
  remove: (flow: Listing) =>
    request<void>(`/workflows/${flow.id}`, {
      method: 'DELETE',
      headers: condition(flow.modified),
    }),
  current: () => request<Flow | null>('/draft'),
  draft: (flow: Flow, modified?: string) =>
    request<Flow>('/draft', {
      method: 'PUT',
      body: body(flow),
      headers: condition(modified),
    }),
  clearDraft: () => request<void>('/draft', { method: 'DELETE' }),
  analytics: (params?: {
    from?: string;
    to?: string;
    interval?: 'minute' | 'hour' | 'day';
    networks?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.interval) qs.set('interval', params.interval);
    if (params?.networks) qs.set('networks', params.networks);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<AnalyticsPayload>(`/analytics${suffix}`);
  },
  earnAnalytics: (params?: { from?: string; to?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<CreatorEarnPayload>(`/analytics/earn${suffix}`);
  },
};
