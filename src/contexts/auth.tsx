import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import {
  api,
  token,
  authenticated,
  Fault,
  type Auth as AuthPayload,
  type Config,
  type Provider,
} from '../lib/api';
import type { User } from '../lib/schema';
import { requestEvmAccounts } from '../lib/intents';
import { Disclaimer } from '../components/disclaimer';

export interface WalletLink {
  id: string;
  userAddress: string;
  network: 'evm' | 'svm';
  address: string;
  publicKey: string;
  status: 'pending' | 'active' | 'failed';
  transaction: string | null;
}

export interface AuthState {
  user: User | null;
  busy: boolean;
  error: string | null;
  config: Config | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  openAuthModal: () => void;
  refreshUser: () => Promise<void>;
  login: () => Promise<User>;
  createPasskey: () => Promise<User>;
  signPasskey: () => Promise<User>;
  sendCode: (email: string) => Promise<{ id: string; email: string; code?: string }>;
  verifyCode: (id: string, code: string) => Promise<User>;
  connect: (provider: Provider) => Promise<User>;
  logout: () => Promise<void>;
  update: (user: User) => void;
  clear: () => void;
  links: WalletLink[];
  linkBusy: boolean;
  linkError: string | null;
  refreshLinks: () => Promise<void>;
  linkWallet: (network: 'evm' | 'svm') => Promise<void>;
}

const Context = createContext<AuthState | null>(null);

const USER_CACHE_KEY = 'man0.auth.user.v1';
const LINKS_CACHE_KEY = 'man0.auth.links.v1';
const CONFIG_CACHE_KEY = 'man0.auth.config.v1';

function readStorageJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore storage quota errors
  }
}

function readHydratedUser(): User | null {
  if (!authenticated()) return null;
  const cached = readStorageJson<User>(USER_CACHE_KEY);
  return cached && typeof cached.userAddress === 'string' && cached.userAddress.length > 0
    ? cached
    : null;
}

function readHydratedLinks(userAddress?: string | null): WalletLink[] {
  if (!userAddress || !authenticated()) return [];
  const cached = readStorageJson<WalletLink[]>(LINKS_CACHE_KEY);
  if (!Array.isArray(cached)) return [];
  return cached.filter(
    (item) =>
      item &&
      typeof item.address === 'string' &&
      item.userAddress?.toLowerCase() === userAddress.toLowerCase(),
  );
}
