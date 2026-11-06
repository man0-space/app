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
