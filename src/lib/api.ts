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
