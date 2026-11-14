import { Compass, FolderKanban, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Route } from '../lib/routes';
import { Connector } from './connector';
import { Mark, Wordmark } from './mark';

export type StudioMode = 'vibe' | 'canvas';

interface LayoutProps {
  route: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}

export function Layout({
  route,
  onNavigate,
  children,
}: LayoutProps) {
  return (
    <div className="app-shell">
      <div className="ambient-void" aria-hidden="true" />
      <div className="grid-matrix" aria-hidden="true" />

      <header className="topbar stealth-glass">
        <div className="topbar-left">
          <button
            type="button"
            className="brand"
            onClick={() => onNavigate('studio')}
            aria-label="man0 Studio"
          >
            <Wordmark className="brand-title" />
            <Mark className="brand-symbol" />
          </button>

          <nav className="segmented desktop-nav" aria-label="Primary">
            <button
              type="button"
              className={`seg-btn ${route === 'studio' ? 'active' : ''}`}
              onClick={() => onNavigate('studio')}
            >
              STUDIO
            </button>
            <button
              type="button"
              className={`seg-btn ${route === 'mypage' ? 'active' : ''}`}
              onClick={() => onNavigate('mypage')}
            >
              WORKSPACE
            </button>
            <button
              type="button"
              className={`seg-btn ${route === 'market' ? 'active' : ''}`}
              onClick={() => onNavigate('market')}
            >
              MARKET
            </button>
          </nav>
        </div>

        <div className="topbar-right">
          <Connector />
        </div>
      </header>

      <main className="main-content">{children}</main>

      <nav className="tabbar stealth-glass" aria-label="Mobile">
        <button
          type="button"
          className={`tabbar-item ${route === 'studio' ? 'active' : ''}`}
          onClick={() => onNavigate('studio')}
        >
          <Sparkles size={16} aria-hidden="true" />
          <span>Studio</span>
        </button>
        <button
          type="button"
          className={`tabbar-item ${route === 'mypage' ? 'active' : ''}`}
          onClick={() => onNavigate('mypage')}
        >
          <FolderKanban size={16} aria-hidden="true" />
          <span>Workspace</span>
        </button>
        <button
          type="button"
          className={`tabbar-item ${route === 'market' ? 'active' : ''}`}
          onClick={() => onNavigate('market')}
        >
          <Compass size={16} aria-hidden="true" />
          <span>Market</span>
        </button>
      </nav>
    </div>
  );
}
