import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/app.css';
import { ActionsProvider } from './api/actions.tsx';
import { App } from './App.tsx';

// Reads are local and cheap, but the data only changes on sync, an action or
// a live poll cycle with news, and all three invalidate what they touch. No
// refetch on focus, one retry. The 30s staleTime stops a refetch of the topic
// and PR on every revisit (back / forward, clicking between two topics); the
// cap keeps time-based state such as expired snoozes from going stale for long.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ActionsProvider>
        <App />
      </ActionsProvider>
    </QueryClientProvider>
  </StrictMode>,
);
