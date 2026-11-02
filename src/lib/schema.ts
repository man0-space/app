import type { Edge, Node } from '@xyflow/react';

export type Kind = 'model' | 'connector' | 'agent';
export type Brand = 'sail';
export type Mode = 'vibe' | 'canvas';
export type View = 'create' | 'workspace' | 'market' | 'workflow';
export type Provider = 'google' | 'discord' | 'github' | 'x';
export type LinkProvider = Provider | 'telegram';
export type SocialPlatform =
  | LinkProvider
  | 'instagram'
  | 'tiktok'
  | 'farcaster'
  | 'spotify'
  | 'soundcloud'
  | 'youtube'
  | 'twitch';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Point = { x: number; y: number };
export type ModelOperationCapability = {
  modality: string;
  operation: string;
  sourceTypes: string[];
  input: string[];
  output: string[];
  pricingUnits: unknown[];
  streamable: boolean;
};
export type Entry = {
  id: string;
  name: string;
  description: string;
  kind: Kind;
  groups?: string[];
  subgroups?: string[];
  modality?: string;
  logo?: string;
  family?: string;
  isFrontier?: boolean;
  isLatest?: boolean;
  input?: string[];
  output?: string[];
  type?: string | string[];
  operations?: ModelOperationCapability[];
};
export type Step = Record<string, unknown> & {
  label: string;
  kind: Kind;
  entry?: Entry;
  note: string;
};
export type Block = Node<Step, 'step'>;
export type Link = Edge;
export type Coordinator = {
  id: string;
  userAddress: string;
  agentId: number;
  walletAddress: string;
  name: string;
  image: string;
  personality: string;
  model: string;
  cid: string;
  txHash: string;
  contractId: string;
  network: string;
  created?: string;
};
export type Flow = {
  id: string;
  name: string;
  brief?: string;
  banner?: string | null;
  tasks?: string[];
  coordinator?: Coordinator | null;
  nodes: Block[];
  edges: Link[];
  modified: string;
};
export type Catalog = { entries: Entry[]; loading: boolean; error: string | null };

export const kinds: Kind[] = ['model', 'connector', 'agent'];
export const brands: Brand[] = ['sail'];
export const labels: Record<Kind, string> = {
  model: 'Models',
  connector: 'Connectors',
  agent: 'Agents',
};
