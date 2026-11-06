import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from 'react-oidc-context';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getMe } from '@/lib/api';
import type { AppConfig } from '@/lib/config';
import { ChatPage } from '@/pages/ChatPage';
import { DocumentsPage } from '@/pages/DocumentsPage';

type Page = 'chat' | 'documents';

function SignIn({ onSignIn, error }: { onSignIn: () => void; error?: string }) {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-medium">Enterprise RAG Authz</h1>
      <p className="text-muted-foreground">
        Ask questions and get cited answers from the documents your role at your company may read.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button onClick={onSignIn}>Sign in</Button>
      </div>
    </main>
  );
}

function App({ config }: { config: AppConfig }) {
  const auth = useAuth();
  const [page, setPage] = useState<Page>('chat');
  const token = auth.user?.access_token;

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(token!),
    enabled: Boolean(token),
  });

  if (auth.isLoading) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <Skeleton className="h-10 w-full" />
      </main>
    );
  }
  if (!auth.isAuthenticated || !token) {
    return <SignIn onSignIn={() => void auth.signinRedirect()} error={auth.error?.message} />;
  }

  function signOut() {
    void auth.removeUser();
    const logout = new URL('/logout', config.loginUrl);
    logout.searchParams.set('client_id', config.clientId);
    logout.searchParams.set('logout_uri', `${window.location.origin}/`);
    window.location.assign(logout);
  }

  // Hiding this is only UX. The API refuses non-admins on every admin route.
  const isAdmin = me.data?.groups.includes('tenant-admin') ?? false;
  const current: Page = page === 'documents' && isAdmin ? 'documents' : 'chat';

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col gap-6 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <nav className="flex items-center gap-1">
          <Button
            variant={current === 'chat' ? 'secondary' : 'ghost'}
            onClick={() => setPage('chat')}
          >
            Chat
          </Button>
          {isAdmin && (
            <Button
              variant={current === 'documents' ? 'secondary' : 'ghost'}
              onClick={() => setPage('documents')}
            >
              Documents
            </Button>
          )}
        </nav>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {me.data && (
            <>
              <span className="font-medium">{auth.user?.profile.email}</span>
              <Badge variant="outline">{me.data.tenant_id}</Badge>
              {me.data.groups.map((group) => (
                <Badge key={group} variant="secondary">
                  {group}
                </Badge>
              ))}
              <span className="text-muted-foreground tabular-nums">
                {me.data.questions_left_today} questions left today
              </span>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1">
        {current === 'documents' && me.data ? (
          <DocumentsPage token={token} tenant={me.data.tenant_id} />
        ) : (
          <ChatPage token={token} onExpired={() => void auth.signinRedirect()} />
        )}
      </main>
    </div>
  );
}

export default App;
