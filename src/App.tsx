import { useCallback, useEffect, useState } from 'react';
import { Layout, type StudioMode } from './components/layout';
import { SessionProvider } from './components/session';
import { Auth } from './contexts/auth';
import { api, authenticated } from './lib/api';
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

const STUDIO_SESSION_KEY = 'man0.studio.session.v1';

interface PersistedStudioSession {
  flow: Flow;
  mode: StudioMode;
  openedFromWorkspaceId: string | null;
}

function readStudioSession(): PersistedStudioSession | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STUDIO_SESSION_KEY);
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
  if (typeof localStorage === 'undefined') return;
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

export function App() {
  const initialSession = readStudioSession();
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
    if (typeof sessionStorage === 'undefined') return;
    try {
      const payload: PersistedStudioSession = {
        flow,
        mode: studioMode,
        openedFromWorkspaceId,
      };
      sessionStorage.setItem(STUDIO_SESSION_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota errors
    }
  }, [flow, studioMode, openedFromWorkspaceId]);

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
    if (authenticated()) {
      void api.clearDraft().catch(() => undefined);
    }
    setFlow(create('unknown #1'));
    setStudioMode('canvas');
    handleNavigate('studio');
  }, [handleNavigate]);

  return (
    <Auth>
      <SessionProvider>
        <Layout route={route} onNavigate={handleNavigate}>
          {route === 'studio' ? (
            <Studio
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
    </Auth>
  );
}
