import { Component, type ReactNode } from 'react';
import { errorReporter } from '../api/telemetry.ts';
import { Button } from './Button.tsx';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * At the app root: a render error shows a reload screen instead of a blank
 * window, and is reported like any other renderer error. React only offers
 * this as a class component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    errorReporter.report(error, 'react_render');
  }

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-3 bg-window px-5">
        <p className="max-w-sm text-center text-xs leading-relaxed text-muted">
          Something went wrong while showing this screen. Reloading usually fixes it; your topics and GitHub are not affected.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </main>
    );
  }
}
