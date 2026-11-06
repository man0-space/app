import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, authenticated } from '../lib/api';
import { shortHash } from '../lib/contracts';
import { uploadFileToIpfs } from '../lib/pinata';
import { toUrlSlug } from '../lib/routes';
import type {
  CreatorProfile,
  CreatorWallets,
  LinkProvider,
  Provider,
  SocialLink,
  SocialPlatform,
} from '../lib/schema';
import { useAuth } from '../contexts/auth';

export type { CreatorWallets, LinkProvider, Provider, SocialPlatform };
export type SocialLinkRecord = SocialLink;

export interface CreatorProfileData {
  address: string | null;
  userAddress: string | null;
  nickname: string | null;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  socials: SocialLinkRecord[];
  wallets?: CreatorWallets;
}

const PROFILE_UPDATED_EVENT = 'man0:profile-updated';
const remoteProfileCache = new Map<string, CreatorProfile>();
const inflightProfileFetches = new Map<string, Promise<CreatorProfile>>();

function emitProfileUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }
}

export async function prefetchProfiles(addresses: string[]): Promise<void> {
  const uniqueMissing: string[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    const trimmed = (raw || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower) || remoteProfileCache.has(lower) || inflightProfileFetches.has(lower)) {
      continue;
    }
    seen.add(lower);
    uniqueMissing.push(trimmed);
  }
  if (uniqueMissing.length === 0) return;
  try {
    const { profiles } = await api.creatorProfiles(uniqueMissing.slice(0, 100));
    let changed = false;
    for (const [lower, item] of Object.entries(profiles)) {
      remoteProfileCache.set(lower.toLowerCase(), item);
      changed = true;
    }
    if (changed) emitProfileUpdated();
  } catch {
    // Non-fatal prefetch error
  }
}

export function linkSocialOAuth(provider: LinkProvider): Promise<SocialLinkRecord> {
  return api.linkSocialPopup(provider);
}

export function sanitizeCreatorNickname(
  nickname?: string | null,
  address?: string | null,
): string | null {
  const n = (nickname || '').trim();
  if (!n) return null;
  if (address && n.toLowerCase() === address.trim().toLowerCase()) return null;
  if (/^0x[a-fA-F0-9]{14,}$/.test(n)) return null;
  if (/^0u[0-9a-z]{20,}$/i.test(n)) return null;
  if (/^[a-fA-F0-9]{40,64}$/.test(n)) return null;
  return n;
}

export function formatCreatorShortAddress(address?: string | null): string | null {
  const raw = (address || '').trim();
  if (!raw) return null;
  if (raw.endsWith('.near') || raw.endsWith('.testnet')) {
    return raw.length > 22 ? shortHash(raw, 8, 6) : raw;
  }
  return shortHash(raw, 6, 4);
}

export function formatCreatorHandle(
  nickname?: string | null,
  address?: string | null,
): string {
  const clean = sanitizeCreatorNickname(nickname, address);
  if (clean) return clean;
  return formatCreatorShortAddress(address) || '';
}

export async function prepareMediaBlob(
  file: File,
  kind: 'avatar' | 'banner' | 'workflow-banner',
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const maxWidth = kind === 'avatar' ? 512 : 1440;
  const maxHeight = kind === 'avatar' ? 512 : 640;

  let targetW = bitmap.width;
  let targetH = bitmap.height;

  if (kind === 'avatar') {
    const side = Math.min(maxWidth, Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      throw new Error('Image processing is unavailable.');
    }
    const scale = Math.max(side / bitmap.width, side / bitmap.height);
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.drawImage(bitmap, (side - drawW) / 2, (side - drawH) / 2, drawW, drawH);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))),
        'image/webp',
        0.88,
      );
    });
    return new File([blob], `${kind}-${Date.now()}.webp`, { type: 'image/webp' });
  }

  const ratio = Math.min(1, maxWidth / targetW, maxHeight / targetH);
  targetW = Math.max(1, Math.round(targetW * ratio));
  targetH = Math.max(1, Math.round(targetH * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Image processing is unavailable.');
  }
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode banner image.'))),
      'image/webp',
      0.88,
    );
  });
  return new File([blob], `${kind}-${Date.now()}.webp`, { type: 'image/webp' });
}

export async function uploadMediaImage(
  file: File,
  kind: 'avatar' | 'banner' | 'workflow-banner',
): Promise<string> {
  const processed = await prepareMediaBlob(file, kind);
  if (authenticated()) {
    const pinned = await uploadFileToIpfs(processed, { mediaKind: kind });
    return pinned.url;
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Could not read image.'));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(processed);
  });
}

function looksLikeChainAddress(raw?: string | null): boolean {
  const s = (raw || '').trim();
  if (!s) return false;
  return (
    /^0u[a-z0-9]{18,}$/i.test(s) ||
    /^0x[a-f0-9]{40}$/i.test(s) ||
    /^[a-f0-9]{64}$/i.test(s) ||
    /\.(?:near|testnet)$/i.test(s) ||
    /^(?=.*[0-9A-Z])[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(s)
  );
}
