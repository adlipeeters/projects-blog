import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from 'react-oidc-context';

import App from './App.tsx';
import './index.css';
import { loadConfig } from './lib/config';

// Follows the system setting. Runs before the first render, so there's no flash.
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', prefersDark.matches);
applyTheme();
prefersDark.addEventListener('change', applyTheme);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const config = await loadConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider
      authority={config.authority}
      client_id={config.clientId}
      redirect_uri={`${window.location.origin}/`}
      response_type="code"
      scope="openid email"
      // Tokens stay in memory, so a script can't read them from storage. A reload signs in again
      // through the Cognito session.
      userStore={new WebStorageStateStore({ store: new InMemoryWebStorage() })}
      onSigninCallback={() => window.history.replaceState({}, document.title, '/')}
    >
      <QueryClientProvider client={queryClient}>
        <App config={config} />
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>,
);
