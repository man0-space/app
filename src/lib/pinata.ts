import { api, requireEnv } from './api';
import type { Entry, Kind, Listing, Point, Terms } from './schema';

export interface Pin {
  cid: string;
  uri: string;
  url: string;
  size: number;
}

export interface Node {
  id: string;
  label: string;
  kind: Kind;
  note: string;
  position: Point;
  entry?: Entry;
}

export interface Wire {
  id: string;
  source: string;
  target: string;
}

export interface Card {
  id: string;
  name: string;
  description: string;
  banner?: string;
  tasks: string[];
  userAddress: string;
  createdAt: string;
  creatorFee: number;
  coordinator?: {
    agentId: number;
    walletAddress: string;
    name: string;
    model: string;
    cid: string;
    image: string;
  };
  nodes: Node[];
  edges: Wire[];
}

export function getIpfsGatewayUrl(cidOrUri: string): string {
  const gateway = requireEnv('VITE_PINATA_GATEWAY').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (cidOrUri.startsWith('ipfs://')) {
    return `https://${gateway}/ipfs/${cidOrUri.slice(7)}`;
  }
  if (cidOrUri.startsWith('http://') || cidOrUri.startsWith('https://')) {
    return cidOrUri;
  }
  return `https://${gateway}/ipfs/${cidOrUri}`;
}

export function buildWorkflowCardMetadata(
  flow: Listing,
  terms: Pick<Terms, 'creatorFee' | 'tasks' | 'description'>,
  createdAt = new Date().toISOString(),
): Card {
  return {
    id: flow.id,
    name: flow.name,
    description: terms.description,
    ...(flow.banner ? { banner: flow.banner } : {}),
    tasks: terms.tasks,
    userAddress: flow.userAddress,
    createdAt,
    creatorFee: terms.creatorFee,
    ...(flow.coordinator
      ? {
          coordinator: {
            agentId: flow.coordinator.agentId,
            walletAddress: flow.coordinator.walletAddress,
            name: flow.coordinator.name,
            model: flow.coordinator.model,
            cid: flow.coordinator.cid,
            image: flow.coordinator.image,
          },
        }
      : {}),
    nodes: flow.nodes.map(node => ({
      id: node.id,
      label: node.data.label,
      kind: node.data.kind,
      note: node.data.note,
      position: node.position,
      ...(node.data.entry ? { entry: node.data.entry } : {}),
    })),
    edges: flow.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}

export async function uploadWorkflowMetadata(metadata: Card): Promise<Pin> {
  return api.pinJson({
    content: metadata as unknown as Record<string, unknown>,
    name: `workflow-${metadata.id}.json`,
    keyvalues: {
      type: 'workflow-card',
      id: metadata.id,
      name: metadata.name,
      userAddress: metadata.userAddress,
    },
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file as base64.'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadFileToIpfs(
  file: File,
  keyvalues?: Record<string, string>,
): Promise<Pin> {
  const fileBase64 = await fileToBase64(file);
  return api.pinFile({
    fileBase64,
    fileName: file.name,
    mimeType: file.type,
    name: file.name,
    keyvalues,
  });
}
