import {
  Activity,
  ArrowUpDown,
  AudioLines,
  AudioWaveform,
  BarChart3,
  Bot,
  Box,
  Braces,
  Calendar,
  Clapperboard,
  Code2,
  Coins,
  Compass,
  Cpu,
  Crosshair,
  Database,
  Eye,
  FileText,
  Film,
  FolderKanban,
  GitBranch,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutGrid,
  Link2,
  Mail,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Mic,
  Music,
  Plus,
  Radio,
  RefreshCw,
  Scan,
  ScanText,
  Scissors,
  Server,
  Shapes,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Tags,
  Users,
  Video,
  Volume2,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type UIEvent,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ALL_PILLOW_ID,
  buildFamilyCounts,
  CONNECTOR_ORIGIN_ORDER,
  displayGroupLabel,
  displaySubgroupLabel,
  isMonochromeDarkLogo,
  MODEL_MODALITY_ORDER,
  rawSubgroupKey,
  resolveEntryLogoUrl,
  sortCatalogEntries,
  tooltipSubgroupLabel,
} from '../lib/catalog';
import { kinds, type Entry, type Kind } from '../lib/schema';
import { Button } from './button';
import { Search } from './search';
import { Tooltip } from './tooltip';

interface CatalogProps {
  entries: Entry[];
  loading: boolean;
  errors?: Partial<Record<Kind, string>>;
  onRefresh: () => void;
  onAddEntry: (entry: Entry) => void;
  onClose: () => void;
  initialTab?: Kind;
  contextLabel?: string | null;
}

interface PillowItem {
  id: string;
  label: string;
  tooltipTitle: string;
  count: number;
  icon: LucideIcon;
}

const PAGE_SIZE = 80;

const GROUP_ICONS: Record<string, LucideIcon> = {
  [ALL_PILLOW_ID]: LayoutGrid,
  text: FileText,
  image: ImageIcon,
  video: Video,
  music: Music,
  embeddings: Braces,
  others: Shapes,
  mcps: Server,
  onchain: Coins,
  accounts: Link2,
};

const MODEL_SUBGROUP_ICONS: Record<string, LucideIcon> = {
  [ALL_PILLOW_ID]: LayoutGrid,
  chat: MessageSquare,
  'vision-chat': Eye,
  'speech-to-text': AudioWaveform,
  speech: Mic,
  realtime: Radio,
  rerank: ArrowUpDown,
  reranker: ArrowUpDown,
  ocr: ScanText,
  classification: Tags,
  classify: Tags,
  'image-classification': Tags,
  translation: Languages,
  'realtime-translation': Languages,
  'deep-research': Compass,
  'text-to-image': Sparkles,
  'image-to-image': Layers,
  'object-detection': Scan,
  'image-segmentation': Scissors,
  'instance-segmentation': Scissors,
  'image-to-text': FileText,
  'zero-shot-classification': Crosshair,
  'zero-shot-image-classification': Crosshair,
  'keypoint-detection': Waypoints,
  'keypoints-detection': Waypoints,
  'depth-estimation': Box,
  'text-to-speech': Volume2,
  'speech-to-speech': AudioLines,
  'text-to-audio': Music,
  'voice-activity-detection': Activity,
  'text-to-video': Film,
  'image-to-video': Clapperboard,
  'video-edit': SlidersHorizontal,
  'text-to-embedding': Braces,
  'multimodal-embedding': Layers,
  'image-to-embedding': Scan,
  'realtime-omni': Radio,
  'realtime-transcription': FileText,
  'realtime-speech': Mic,
  decision: GitBranch,
  custom: GitBranch,
};

function resolveGroupIcon(kind: Kind, group: string): LucideIcon {
  const key = group.trim().toLowerCase();
  if (GROUP_ICONS[key]) return GROUP_ICONS[key]!;
  if (kind === 'connector') return Server;
  return Shapes;
}

function resolveSubgroupIcon(kind: Kind, scoped: string): LucideIcon {
  if (scoped === ALL_PILLOW_ID) return LayoutGrid;
  const raw = rawSubgroupKey(scoped);
  if (kind === 'model') {
    if (MODEL_SUBGROUP_ICONS[raw]) return MODEL_SUBGROUP_ICONS[raw]!;
    if (raw.includes('image')) return ImageIcon;
    if (raw.includes('video')) return Video;
    if (raw.includes('music')) return Music;
    if (raw.includes('audio') || raw.includes('speech')) return Mic;
    if (raw.includes('embed')) return Braces;
    return Shapes;
  }

  if (/(dev|code|it\b|server|url|website)/.test(raw)) return Code2;
  if (/(analytic|business|dashboard|seo)/.test(raw)) return BarChart3;
  if (/(crm|sales|contact|people|customer|hr\b|human)/.test(raw)) return Users;
  if (/(market|social|ads?\b|drip|newsletter)/.test(raw)) return Megaphone;
  if (/(project|task|product)/.test(raw)) return FolderKanban;
  if (/(chat|collab|communicat|team|phone|conferenc|webinar|notif)/.test(raw)) return MessagesSquare;
  if (/(\bai\b|artificial|model)/.test(raw)) return Cpu;
  if (/(ecommerce|payment|account|invoice|fundrais)/.test(raw)) return Coins;
  if (/(doc|note|sheet|form|sign)/.test(raw)) return FileText;
  if (/(email|mail)/.test(raw)) return Mail;
  if (/(database|file|storage|scrap|search|company)/.test(raw)) return Database;
  if (/(calendar|schedul|time)/.test(raw)) return Calendar;
  if (/(secur|complian)/.test(raw)) return Shield;
  if (/(image|video|audio|media|speech|transcri)/.test(raw)) return Sparkles;
  if (/(smart-contract|chain)/.test(raw)) return Braces;
  return Tag;
}

function resolveEntryFallbackIcon(entry: Entry): LucideIcon {
  if (entry.kind === 'agent') return Bot;
  if (entry.kind === 'connector') {
    const groups = entry.groups ?? [];
    if (groups.includes('onchain')) return Coins;
    if (groups.includes('accounts')) return Link2;
    return Server;
  }

  const mod = (entry.modality ?? '').trim().toLowerCase();
  if (mod === 'text-generation') return FileText;
  if (mod === 'image-generation') return ImageIcon;
  if (mod === 'video-generation') return Video;
  if (mod === 'music-generation') return Music;
  if (mod === 'embeddings') return Braces;
  if (MODEL_SUBGROUP_ICONS[mod]) return MODEL_SUBGROUP_ICONS[mod]!;

  const groups = entry.groups ?? [];
  for (const g of groups) {
    if (g !== 'others' && GROUP_ICONS[g]) return GROUP_ICONS[g]!;
  }
  const firstSub = entry.subgroups?.[0];
  if (firstSub) return resolveSubgroupIcon('model', firstSub);
  return FileText;
}
