import { kinds, type Block, type Entry, type Kind } from './schema';
import { request } from './api';

const cache = new Map<Kind, Entry[]>();
const CATALOG_STORAGE_PREFIX = 'man0.catalog.v2:';

function readPersistedCatalog(kind: Kind): Entry[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CATALOG_STORAGE_PREFIX}${kind}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Entry[]) : null;
  } catch {
    return null;
  }
}

function writePersistedCatalog(kind: Kind, entries: Entry[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${CATALOG_STORAGE_PREFIX}${kind}`, JSON.stringify(entries));
  } catch {
    // Ignore storage quota errors
  }
}

export const ALL_PILLOW_ID = 'all';

export const MODEL_MODALITY_ORDER = [
  'text',
  'image',
  'video',
  'music',
  'embeddings',
  'others',
] as const;

export const CONNECTOR_ORIGIN_ORDER = ['mcps', 'onchain', 'accounts'] as const;

const FRONTIER_TYPE_ORDER = ['text', 'image', 'video', 'music'] as const;
type FrontierBucket = (typeof FRONTIER_TYPE_ORDER)[number];

export const FAMILY_LOGOS: Record<string, string> = {
  acestep: 'acestep.webp',
  alibaba: 'alibabacloud-color.svg',
  asicloud: 'asicloud.webp',
  anthropic: 'anthropic.png',
  baai: 'baai.svg',
  bria: 'bria.webp',
  blackforestlabs: 'black-forest-labs.svg',
  bytedance: 'bytedance.png',
  cartesia: 'cartesia.avif',
  clarityai: 'clarityai.png',
  cohere: 'cohere-color.svg',
  daily: 'daily.svg',
  deepgram: 'deepgram.png',
  deepseek: 'deepseek-color.svg',
  elevenlabs: 'elevenlabs.svg',
  gemini: 'gemini-color.svg',
  google: 'gemini-color.svg',
  huggingface: 'huggingface-color.png',
  ibm: 'ibm.svg',
  inworld: 'inworld.avif',
  leonardo: 'leonardo.png',
  lykon: 'lykon.jpg',
  meta: 'meta-color.svg',
  microsoft: 'microsoft.webp',
  minimax: 'minimax-color.svg',
  mistral: 'mistral-color.svg',
  moonshot: 'moonshot-color.svg',
  nousresearch: 'nousresearch.png',
  nvidia: 'nvidia-color.svg',
  openai: 'openai.png',
  pixverse: 'pixverse.png',
  prunaai: 'prunaai.png',
  resemble: 'resemble.png',
  roboflow: 'roboflow.png',
  stabilityai: 'stability-color.svg',
  tencent: 'tencent.png',
  thinkingmachines: 'thinkingmachines.png',
  xai: 'xai-grok.svg',
  zai: 'zai.svg',
};

const MODEL_SERIES_FAMILY: Array<[RegExp, keyof typeof FAMILY_LOGOS]> = [
  [/(?:^|\/|-)(?:gpt|chatgpt|o1|o3|o4|whisper|tts-1|dall-e)/i, 'openai'],
  [/(?:^|\/|-)claude/i, 'anthropic'],
  [/(?:^|\/|-)(?:gemini|gemma|imagen|veo|lyria|chirp)/i, 'google'],
  [/(?:^|\/|-)(?:qwen|qwq|wan|cosyvoice|happyhorse)/i, 'alibaba'],
  [/(?:^|\/|-)deepseek/i, 'deepseek'],
  [/(?:^|\/|-)llama/i, 'meta'],
  [/(?:^|\/|-)(?:mistral|ministral|codestral|pixtral|devstral|magistral)/i, 'mistral'],
  [/(?:^|\/|-)flux/i, 'blackforestlabs'],
  [/(?:^|\/|-)(?:glm|cogview|cogvideo)/i, 'zai'],
  [/(?:^|\/|-)(?:kimi|moonshot)/i, 'moonshot'],
  [/(?:^|\/|-)(?:minimax|hailuo)/i, 'minimax'],
  [/(?:^|\/|-)(?:sdxl|stable-diffusion|sd3)/i, 'stabilityai'],
  [/(?:^|\/|-)acestep/i, 'acestep'],
  [/(?:^|\/|-)(?:seedream|seedance|doubao)/i, 'bytedance'],
  [/(?:^|\/|-)grok/i, 'xai'],
  [/(?:^|\/|-)nemotron/i, 'nvidia'],
  [/(?:^|\/|-)(?:command-r|rerank-v|embed-v)/i, 'cohere'],
  [/(?:^|\/|-)bge-/i, 'baai'],
  [/(?:^|\/|-)hunyuan/i, 'tencent'],
  [/(?:^|\/|-)pixverse/i, 'pixverse'],
  [/(?:^|\/|-)bria/i, 'bria'],
  [/(?:^|\/|-)aura-/i, 'deepgram'],
  [/(?:^|\/|-)sonic/i, 'cartesia'],
  [/(?:^|\/|-)(?:phi-|wizardlm|mai-)/i, 'microsoft'],
  [/(?:^|\/|-)granite/i, 'ibm'],
];

export function isMonochromeDarkLogo(src?: string): boolean {
  if (!src) return false;
  return /(?:baai|black-forest-labs|daily|elevenlabs|ibm|xai-grok|zai)\.svg$/i.test(src);
}

export function resolveEntryLogoUrl(entry?: Pick<Entry, 'kind' | 'logo' | 'family' | 'id'> | null): string | undefined {
  if (!entry) return undefined;
  if (entry.logo) return entry.logo;
  if (entry.kind !== 'model') return undefined;

  const fam = entry.family?.trim().toLowerCase();
  if (fam && FAMILY_LOGOS[fam]) {
    return `/families/${FAMILY_LOGOS[fam]}`;
  }
  const id = entry.id || '';
  for (const [pattern, mappedFamily] of MODEL_SERIES_FAMILY) {
    if (pattern.test(id)) {
      return `/families/${FAMILY_LOGOS[mappedFamily]}`;
    }
  }
  return undefined;
}

function toPublicHttpLogoUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        return undefined;
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }
  if (
    trimmed.startsWith('/') &&
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:'
  ) {
    return `${window.location.origin}${trimmed}`;
  }
  return undefined;
}

export function buildBannerBrandLogos(
  nodes: readonly Pick<Block, 'data'>[],
): Array<{ name: string; url?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; url?: string }> = [];

  for (const node of nodes) {
    const ent = node.data.entry;
    const rawName = ent
      ? node.data.kind === 'model' && ent.family
        ? ent.family.charAt(0).toUpperCase() + ent.family.slice(1)
        : ent.name
      : node.data.label;
    const name = rawName?.trim() ?? '';
    if (!name) continue;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const url = toPublicHttpLogoUrl(resolveEntryLogoUrl(ent));
    out.push(url ? { name, url } : { name });
    if (out.length >= 8) break;
  }

  return out;
}

const SUBGROUP_LABELS: Record<string, string> = {
  chat: 'chat',
  'vision-chat': 'vision',
  'speech-to-text': 'stt',
  'text-to-speech': 'tts',
  'speech-to-speech': 's2s',
  'text-to-audio': 'music',
  speech: 'speech',
  realtime: 'realtime',
  'voice-activity-detection': 'vad',
  'deep-research': 'research',
  'text-to-image': 'txt2img',
  'image-to-image': 'img2img',
  'image-to-text': 'img2txt',
  'object-detection': 'detection',
  'image-segmentation': 'img seg',
  'instance-segmentation': 'inst seg',
  classification: 'classify',
  'image-classification': 'img classify',
  'zero-shot-classification': 'zero-shot',
  'zero-shot-image-classification': 'zero-shot',
  'keypoint-detection': 'keypoints',
  'keypoints-detection': 'keypoints',
  'depth-estimation': 'depth',
  ocr: 'ocr',
  rerank: 'rerank',
  reranker: 'reranker',
  decision: 'decision',
  translation: 'translate',
  custom: 'custom',
  'text-to-video': 'txt2vid',
  'image-to-video': 'img2vid',
  'video-edit': 'edit',
  'text-to-embedding': 'text',
  'multimodal-embedding': 'multimodal',
  'image-to-embedding': 'image',
  'developer tools': 'dev tools',
  'marketing automation': 'marketing',
  'project management': 'projects',
  'team collaboration': 'collab',
  'artificial intelligence': 'ai',
  'task management': 'tasks',
  'ai web scraping': 'scraping',
  'web scraping & browser': 'browser',
  'images & design': 'design',
  'social media marketing': 'social ads',
  'social media accounts': 'social',
  'file management & storage': 'storage',
  'web search & research': 'search',
  'customer support': 'support',
  'hr talent & recruitment': 'hr',
  'security & identity tools': 'security',
  'scheduling & booking': 'booking',
  'video conferencing': 'meetings',
  'email newsletters': 'newsletters',
  'payment processing': 'payments',
  'forms & surveys': 'forms',
};

export function displayGroupLabel(kind: Kind, group: string): string {
  const key = group.trim().toLowerCase();
  if (key === ALL_PILLOW_ID) return 'all';
  if (kind === 'connector') {
    if (key === 'mcps' || key === 'mcp') return 'mcp';
    if (key === 'onchain' || key === 'defi') return 'defi';
    if (key === 'accounts' || key === 'account') return 'accounts';
  }
  return key.replace(/[-_]+/g, ' ');
}

export function rawSubgroupKey(scoped: string): string {
  const slash = scoped.indexOf('/');
  return (slash >= 0 ? scoped.slice(slash + 1) : scoped).trim().toLowerCase();
}

export function displaySubgroupLabel(scoped: string): string {
  if (scoped === ALL_PILLOW_ID) return 'all';
  const raw = rawSubgroupKey(scoped);
  if (SUBGROUP_LABELS[raw]) return SUBGROUP_LABELS[raw]!;
  return raw.replace(/[-_]+/g, ' ');
}

export function tooltipSubgroupLabel(scoped: string): string {
  if (scoped === ALL_PILLOW_ID) return 'All';
  const raw = rawSubgroupKey(scoped);
  return raw
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((w) =>
      w.length <= 3 && /^(ocr|ai|crm|bi|hr|it|seo|sms|api|mcp|stt|tts|vad)$/i.test(w)
        ? w.toUpperCase()
        : w[0]!.toUpperCase() + w.slice(1),
    )
    .join(' ');
}

function modelFrontierBucket(entry: Entry): FrontierBucket {
  const g = entry.groups ?? [];
  if (g.includes('image')) return 'image';
  if (g.includes('video')) return 'video';
  if (g.includes('music')) return 'music';
  return 'text';
}

export function buildFamilyCounts(entries: readonly Entry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'model') continue;
    const fam = entry.family || 'other';
    counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  return counts;
}

export function sortCatalogEntries(
  entries: readonly Entry[],
  kind: Kind,
  familyCounts?: ReadonlyMap<string, number>,
): Entry[] {
  if (kind !== 'model') return [...entries];
  const counts = familyCounts ?? buildFamilyCounts(entries);

  const frontier: Entry[] = [];
  const latest: Entry[] = [];
  const rest: Entry[] = [];

  for (const item of entries) {
    if (item.isFrontier) frontier.push(item);
    else if (item.isLatest) latest.push(item);
    else rest.push(item);
  }

  const byType = (a: Entry, b: Entry) =>
    FRONTIER_TYPE_ORDER.indexOf(modelFrontierBucket(a)) -
    FRONTIER_TYPE_ORDER.indexOf(modelFrontierBucket(b));

  frontier.sort(byType);
  latest.sort(byType);
  rest.sort(
    (a, b) => (counts.get(b.family || 'other') ?? 0) - (counts.get(a.family || 'other') ?? 0),
  );

  return [...frontier, ...latest, ...rest];
}
