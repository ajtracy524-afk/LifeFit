import { Component, type ErrorInfo, type ReactNode } from 'react';
import { EmptyState } from './ui/Feedback';
import { Button } from './ui/Button';

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. on navigation). */
  resetKey?: string;
  /** Hide "Zur Startseite" where there is no start page yet (onboarding). */
  homeLink?: boolean;
}

interface State {
  error: Error | null;
}

/** Keeps a single broken screen from taking down the whole app. User data is never touched. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('LifeFit screen error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const homeLink = this.props.homeLink ?? true;
    return (
      <EmptyState
        emoji="🧩"
        title="Hier ist etwas schiefgelaufen"
        text={homeLink ? 'Deine Daten sind sicher. Lade den Bildschirm neu oder geh zurück zur Startseite.' : 'Deine Daten sind sicher. Bitte lade die App neu.'}
        action={
          <>
            {homeLink && (
              <Button variant="secondary" onClick={() => (window.location.hash = '#/today')}>
                Zur Startseite
              </Button>
            )}
            <Button onClick={() => window.location.reload()}>Neu laden</Button>
          </>
        }
      />
    );
  }
}
