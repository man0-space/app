export type Route = 'studio' | 'mypage' | 'market' | 'workflow';

const RESERVED_ROOT_SEGMENTS = new Set([
  '',
  'studio',
  'my-page',
  'mypage',
  'workspace',
  'market',
  'workflow',
  'run',
  'api',
  'assets',
  'branding',
  'marks',
  'logos',
  'icons',
  'fonts',
  'favicon.ico',
]);

export function toUrlSlug(raw?: string | null): string {
  if (!raw) return '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const trimmed = decoded.trim().replace(/^@+/, '').trim();
  if (!trimmed) return '';
  const hyphenated = trimmed
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return hyphenated ? encodeURIComponent(hyphenated) : '';
}

function decodeSegment(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const trimmed = decoded.trim().replace(/^@+/, '').trim();
  return trimmed || null;
}

export function workflowPageId(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  const match = /^(?:workflow|run)\/([^/]+)$/i.exec(clean);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]).trim();
    return id || null;
  } catch {
    return match[1].trim() || null;
  }
}

export function marketCreator(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const legacyMatch = /^market\/([^/]+)(?:\/[^/]+)?$/i.exec(clean);
  if (legacyMatch) {
    return decodeSegment(legacyMatch[1]);
  }

  const segments = clean.split('/');
  if (segments.length === 1 || segments.length === 2) {
    const firstLower = segments[0].toLowerCase();
    if (RESERVED_ROOT_SEGMENTS.has(firstLower)) return null;
    return decodeSegment(segments[0]);
  }

  return null;
}

export function marketWorkflow(pathname: string): string | null {
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const legacyMatch = /^market\/[^/]+\/([^/]+)$/i.exec(clean);
  if (legacyMatch) {
    return decodeSegment(legacyMatch[1]);
  }

  const segments = clean.split('/');
  if (segments.length === 2) {
    const firstLower = segments[0].toLowerCase();
    if (RESERVED_ROOT_SEGMENTS.has(firstLower)) return null;
    return decodeSegment(segments[1]);
  }

  return null;
}

export function parseRoute(pathname: string): Route {
  if (workflowPageId(pathname) !== null) return 'workflow';
  const clean = pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === 'my-page' || clean === 'mypage' || clean === 'workspace') return 'mypage';
  if (clean === 'market' || marketCreator(pathname) !== null) return 'market';
  return 'studio';
}

export function routePath(route: Route): string {
  if (route === 'mypage') return '/workspace';
  if (route === 'market') return '/market';
  if (route === 'workflow') return '/market';
  return '/studio';
}

export function workflowPath(id: string): string {
  return `/workflow/${encodeURIComponent(id)}`;
}

export function marketPath(creator?: string | null, workflowTitle?: string | null): string {
  const creatorSlug = toUrlSlug(creator);
  if (!creatorSlug) return '/market';
  const wfSlug = toUrlSlug(workflowTitle);
  return wfSlug ? `/${creatorSlug}/${wfSlug}` : `/${creatorSlug}`;
}

export function navigateTo(pathname: string): void {
  if (window.location.pathname !== pathname) {
    window.history.pushState(null, '', pathname);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function navigateToWorkflow(id: string): void {
  navigateTo(workflowPath(id));
}

export function navigateToCreator(creator?: string | null): void {
  navigateTo(marketPath(creator));
}
