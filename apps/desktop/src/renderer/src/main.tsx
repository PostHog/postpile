import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/app.css';
import { ActionsProvider } from './api/actions.tsx';
import { errorReporter } from './api/telemetry.ts';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { watchWindowErrors } from './lib/error-report.ts';

// First, so an error while the app starts is reported too.
watchWindowErrors(window, errorReporter);

// Reads are local and cheap, but the data only changes on sync, an action or
// a live poll cycle with news, and all three invalidate what they touch. No
// refetch on focus, one retry. No refetch on reconnect either: the API is on
// this Mac, and the browser's "online" after a wake from sleep would refetch
// every query at once (all are stale by then) on top of the wake's poll and
// catch-ups (DESIGN.md "Memory on big boards"); the live poll's news refetches
// what changed. The 30s staleTime stops a refetch of the topic and PR on
// every revisit (back / forward, clicking between two topics); the cap keeps
// time-based state such as expired snoozes from going stale for long.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: 1, staleTime: 30_000 },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ActionsProvider>
          <App />
        </ActionsProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
