import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence, so a render error in one part of the outbox does not
 * blank the whole page.
 *
 * Error boundaries still have to be class components; there is no hook
 * equivalent for componentDidCatch.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Where Sentry.captureException(error, { contexts: { react: info } }) would
    // go. Deliberately not wired up: the brief has no backend, and adding a
    // reporting dependency for a take-home would be noise.
    console.error('Outbox render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert">
          <h2>Something went wrong.</h2>
          <p>
            The outbox could not be displayed. Reload the page to start again.
          </p>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
