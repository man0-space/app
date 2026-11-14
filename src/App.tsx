import { useCallback, useEffect, useRef, useState } from 'react';
import { Layout, type StudioMode } from './components/layout';
import { SessionProvider } from './components/session';
import { Auth, useAuth } from './contexts/auth';
import { create } from './lib/graph';
import {
  navigateTo,
  parseRoute,
  routePath,
  type Route,
  workflowPageId,
} from './lib/routes';
import type { Flow } from './lib/schema';
import { Market } from './pages/market';
import { MyPage } from './pages/mypage';
import { Studio } from './pages/studio';
import { WorkflowPage } from './pages/workflow';

const STUDIO_SESSION_PREFIX = 'man0.studio.session';

interface PersistedStudioSession {
  flow: Flow;
  mode: StudioMode;
  openedFromWorkspaceId: string | null;
}

function studioSessionKeyFor(userAddress?: string | null): string {
  return `${STUDIO_SESSION_PREFIX}${userAddress ? userAddress.toLowerCase() : 'anon'}`;
}

function readStudioSession(userAddress?: string | null): PersistedStudioSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(studioSessionKeyFor(userAddress));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedStudioSession> | null;
    if (
      !parsed ||
      !parsed.flow ||
      typeof parsed.flow.id !== 'string' ||
      !Array.isArray(parsed.flow.nodes) ||
      !Array.isArray(parsed.flow.edges)
    ) {
      return null;
    }
    return {
      flow: parsed.flow,
      mode: parsed.mode === 'vibe' ? 'vibe' : 'canvas',
      openedFromWorkspaceId:
        typeof parsed.openedFromWorkspaceId === 'string' ? parsed.openedFromWorkspaceId : null,
    };
  } catch {
    return null;
  }
}

function purgeLegacyLocalStorage() {
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith('man0_active_draft') ||
            key.startsWith('man0_saved_drafts') ||
            key.startsWith('man0:profile:'))
        ) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access errors
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem;
    } catch {
      // Ignore storage access errors
    }
  }
}

function AppShell() {
  const { user } = useAuth();
  const userScope = user?.userAddress?.toLowerCase() ?? 'anon';
  const prevScopeRef = useRef<string>(userScope);

  const initialSession = readStudioSession(user?.userAddress);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(() =>
    workflowPageId(window.location.pathname),
  );
  const [studioMode, setStudioMode] = useState<StudioMode>(
    () => initialSession?.mode ?? 'canvas',
  );
  const [flow, setFlow] = useState<Flow>(
    () => initialSession?.flow ?? create('unknown #1'),
  );
  const [openedFromWorkspaceId, setOpenedFromWorkspaceId] = useState<string | null>(
    () => initialSession?.openedFromWorkspaceId ?? null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    purgeLegacyLocalStorage();
  }, []);

  useEffect(() => {
    if (prevScopeRef.current === userScope) return;
    prevScopeRef.current = userScope;
    const scoped = readStudioSession(user?.userAddress);
    setOpenedFromWorkspaceId(scoped?.openedFromWorkspaceId ?? null);
    setStudioMode(scoped?.mode ?? 'canvas');
    setFlow(scoped?.flow ?? create('unknown #1'));
  }, [userScope, user?.userAddress]);

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const payload: PersistedStudioSession = {
        flow,
        mode: studioMode,
        openedFromWorkspaceId,
      };
      sessionStorage.setItem(studioSessionKeyFor(user?.userAddress), JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [flow, studioMode, openedFromWorkspaceId, user?.userAddress]);

  useEffect(() => {
    const syncRoute = () => {
      setRoute(parseRoute(window.location.pathname));
      setActiveWorkflowId(workflowPageId(window.location.pathname));
    };
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleNavigate = useCallback((next: Route) => {
    setRoute(next);
    navigateTo(routePath(next));
  }, []);

  const handleOpenInStudio = useCallback(
    (nextFlow: Flow) => {
      setOpenedFromWorkspaceId(nextFlow.id);
      setFlow(nextFlow);
      setStudioMode('canvas');
      handleNavigate('studio');
    },
    [handleNavigate],
  );

  const handleNewWorkflow = useCallback(() => {
    setOpenedFromWorkspaceId(null);
    setFlow(create('unknown #1'));
    setStudioMode('canvas');
    handleNavigate('studio');
  }, [handleNavigate]);

  return (
    <SessionProvider>
      <Layout route={route} onNavigate={handleNavigate}>
        {route === 'studio' ? (
          <Studio
            key={userScope}
            flow={flow}
            setFlow={setFlow}
            mode={studioMode}
            setMode={setStudioMode}
            openedFromWorkspaceId={openedFromWorkspaceId}
            onClearOpenedFromWorkspace={() => setOpenedFromWorkspaceId(null)}
            onNotify={setNotice}
          />
        ) : route === 'mypage' ? (
          <MyPage
            onOpenDraft={handleOpenInStudio}
            onNewWorkflow={handleNewWorkflow}
            onNotify={setNotice}
          />
        ) : route === 'workflow' ? (
          <WorkflowPage
            workflowId={activeWorkflowId}
            onOpenDraft={handleOpenInStudio}
            onNotify={setNotice}
          />
        ) : (
          <Market />
        )}
      </Layout>

      {notice ? (
        <div className="toast stealth-glass" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
    </SessionProvider>
  );
}

export function App() {
  return (
    <Auth>
      <AppShell />
    </Auth>
  );
}
