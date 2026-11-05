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

export function Auth({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => readHydratedUser());
  const [busy, setBusy] = useState<boolean>(() => authenticated() && !readHydratedUser());
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(() =>
    readStorageJson<Config>(CONFIG_CACHE_KEY),
  );
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState<string | null>(null);
  const [links, setLinksState] = useState<WalletLink[]>(() =>
    readHydratedLinks(readHydratedUser()?.userAddress),
  );
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    writeStorageJson(USER_CACHE_KEY, next);
    if (!next) {
      writeStorageJson(LINKS_CACHE_KEY, null);
    }
  }, []);

  const setLinks = useCallback((next: WalletLink[]) => {
    setLinksState(next);
    writeStorageJson(LINKS_CACHE_KEY, next);
  }, []);

  const pendingRef = useRef<{
    resolve: (user: User) => void;
    reject: (reason?: unknown) => void;
  } | null>(null);

  useEffect(() => {
    api
      .config()
      .then((nextConfig) => {
        setConfig(nextConfig);
        writeStorageJson(CONFIG_CACHE_KEY, nextConfig);
      })
      .catch(() => {});
    if (!authenticated()) {
      setUser(null);
      setBusy(false);
      return;
    }
    api
      .user()
      .then((freshUser) => {
        setUser(freshUser);
      })
      .catch((err) => {
        if (err instanceof Fault && err.status === 401) {
          token(null);
          setUser(null);
        }
      })
      .finally(() => setBusy(false));
  }, [setUser]);

  const refreshLinks = useCallback(async () => {
    if (!user?.userAddress || !authenticated()) {
      setLinksState([]);
      return;
    }
    try {
      const list = await api.links();
      setLinks(list);
    } catch {
      // Keep cached links on transient network failure
    }
  }, [setLinks, user?.userAddress]);

  useEffect(() => {
    if (user?.userAddress) {
      void refreshLinks();
    } else {
      setLinksState([]);
    }
  }, [user?.userAddress, refreshLinks]);

  function complete(result: AuthPayload): User {
    token(result.token);
    setUser(result.user);
    setOpen(false);
    if (pendingRef.current) {
      pendingRef.current.resolve(result.user);
      pendingRef.current = null;
    }
    return result.user;
  }

  async function createPasskey(): Promise<User> {
    setBusy(true);
    setError(null);
    try {
      const { id, options } = await api.options('create');
      const credential = await startRegistration({
        optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
      });
      return complete(await api.register(id, credential));
    } catch (err) {
      const message = (err as Error).message || 'Passkey creation failed.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function signPasskey(): Promise<User> {
    setBusy(true);
    setError(null);
    try {
      const { id, options } = await api.options('login');
      const credential = await startAuthentication({
        optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
      });
      return complete(await api.verify(id, credential));
    } catch (err) {
      const message = (err as Error).message || 'Passkey sign-in failed.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(email: string) {
    setBusy(true);
    setError(null);
    try {
      return await api.email(email);
    } catch (err) {
      const message = (err as Error).message || 'Could not send code.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(id: string, code: string): Promise<User> {
    setBusy(true);
    setError(null);
    try {
      return complete(await api.code(id, code));
    } catch (err) {
      const message = (err as Error).message || 'Verification failed.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function connect(provider: Provider): Promise<User> {
    setBusy(true);
    setError(null);
    try {
      const url = api.oauth(provider, window.location.origin);
      const width = 500;
      const height = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
      const popup = window.open(
        url,
        `oauth_${provider}`,
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
      );
      if (!popup) {
        throw new Error('Allow popups to continue.');
      }

      const result = await new Promise<AuthPayload>((resolve, reject) => {
        const timer = window.setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(new Error('Sign-in closed.'));
          }
        }, 400);

        function onMessage(event: MessageEvent) {
          const data = event.data as
            | {
                type?: string;
                ok?: boolean;
                auth?: AuthPayload;
                error?: string;
              }
            | undefined;
          if (!data || data.type !== 'oauth') return;
          cleanup();
          if (data.ok && data.auth) {
            resolve(data.auth);
          } else {
            reject(new Error(data.error || 'Sign-in failed.'));
          }
        }

        function cleanup() {
          window.clearInterval(timer);
          window.removeEventListener('message', onMessage);
        }

        window.addEventListener('message', onMessage);
      });

      return complete(result);
    } catch (err) {
      const message = (err as Error).message || 'Sign-in failed.';
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function linkWallet(network: 'evm' | 'svm') {
    if (!user) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      let address = '';
      if (network === 'evm') {
        const { sender } = await requestEvmAccounts();
        address = sender;
      } else {
        const win = window as unknown as {
          phantom?: {
            solana?: {
              connect: () => Promise<{ publicKey: { toString: () => string } }>;
            };
          };
          solana?: {
            connect: () => Promise<{ publicKey: { toString: () => string } }>;
          };
        };
        const sol = win.phantom?.solana ?? win.solana;
        if (!sol) throw new Error('No Solana wallet detected.');
        const resp = await sol.connect();
        address = resp.publicKey.toString();
      }

      await api.link({ network, address });
      const refreshed = await api.links();
      setLinks(refreshed);
    } catch (err) {
      setLinkError((err as Error).message || 'Wallet linking failed.');
    } finally {
      setLinkBusy(false);
    }
  }

  function login(): Promise<User> {
    if (user) return Promise.resolve(user);
    setError(null);
    setOpen(true);
    return new Promise<User>((resolve, reject) => {
      pendingRef.current = { resolve, reject };
    });
  }

  async function logout(): Promise<void> {
    setBusy(true);
    try {
      await api.logout();
      token(null);
      setUser(null);
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Context.Provider
      value={{
        user,
        busy,
        error,
        config,
        open,
        setOpen: (next) => {
          setOpen(next);
          if (!next && pendingRef.current) {
            pendingRef.current.reject(new Error('Sign in to continue.'));
            pendingRef.current = null;
          }
        },
        openAuthModal: () => setOpen(true),
        refreshUser: async () => {
          const current = await api.user();
          setUser(current);
        },
        login,
        createPasskey,
        signPasskey,
        sendCode,
        verifyCode,
        connect,
        logout,
        update: setUser,
        clear: () => setError(null),
        links,
        linkBusy,
        linkError,
        refreshLinks,
        linkWallet,
      }}
    >
      {children}
      {user && !user.consented && deferred !== user.userAddress ? (
        <Disclaimer
          required
          close={() => setDeferred(user.userAddress)}
          accepted={async () => {
            const current = await api.user();
            setUser(current);
          }}
        />
      ) : null}
    </Context.Provider>
  );
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('Authentication context is missing.');
  return value;
}
