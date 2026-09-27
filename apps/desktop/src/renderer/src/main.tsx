import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/app.css';
import { ActionsProvider } from './api/actions.tsx';
import { App } from './App.tsx';

// Reads are local and cheap, but the data only changes on sync or an action,
// and both invalidate what they touch. No refetch on focus, one retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
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
