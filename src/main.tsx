import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/styles.css';

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="empty-box stealth-glass">
          <h1>Unable to open the app</h1>
          <p>{this.state.error}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => location.reload()}>
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

if (location.hostname === '127.0.0.1') {
  location.replace(location.href.replace('://127.0.0.1', '://localhost'));
}

createRoot(document.getElementById('root')!).render(
  <Boundary>
    <App />
  </Boundary>,
);
