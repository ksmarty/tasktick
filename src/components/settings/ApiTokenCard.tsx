'use client';

/**
 * API token management for the public GraphQL endpoint.
 *
 * One token per account, so this is a status card plus three actions — create,
 * cycle, revoke — rather than a list. The plaintext is shown **once**, in a
 * dialog that cannot be reopened: the server stores only a keyed hash, so there
 * is nothing to reveal on a later visit, and the copy button is the only way to
 * get it out. The dialog says so in plain words rather than relying on the user
 * to know what "hashed" means.
 *
 * Cycling is destructive in the same way revoking is — every existing
 * integration stops at once — so both ask for confirmation. Creating a token
 * that already exists is refused by the server, so the button becomes "Cycle"
 * rather than pretending to create a second one.
 */
import { useState } from 'react';
import { ClipboardCopyIcon } from '@svg-animated-icons/react/clipboard-copy';
import { GlobeIcon } from '@svg-animated-icons/react/globe';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/app/Toast';
import { api, errorMessage } from '@/lib/api-client';
import { useMutation, useResource } from '@/lib/store';
import { copyText } from './clipboard';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

interface TokenMetadata {
  prefix: string;
  createdAt: number;
  lastUsedAtMs: number | null;
}

interface TokenPayload {
  token: TokenMetadata | null;
}

interface IssuedTokenPayload {
  token: TokenMetadata & { plaintext: string };
}

type PendingAction = 'cycle' | 'revoke' | null;

function formatWhen(ms: number | null | undefined): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleString();
}

export function ApiTokenCard() {
  const { toast } = useToast();
  const resource = useResource<TokenPayload>('/api/tokens');
  const token = resource.data?.token ?? null;

  const [revealed, setRevealed] = useState<IssuedTokenPayload['token'] | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);

  const invalidates = ['/api/tokens'];

  const create = useMutation(() => api.post<IssuedTokenPayload>('/api/tokens'), {
    invalidates,
    onSuccess: (result) => {
      setRevealed(result.token);
      void resource.refresh();
      toast({ title: 'API token created', variant: 'success' });
    },
    onError: (message) => toast({ title: 'Could not create the token', description: message, variant: 'error' }),
  });

  const cycle = useMutation(() => api.put<IssuedTokenPayload>('/api/tokens'), {
    invalidates,
    onSuccess: (result) => {
      setRevealed(result.token);
      setPending(null);
      void resource.refresh();
      toast({ title: 'API token cycled', description: 'The previous token no longer works.', variant: 'success' });
    },
    onError: (message) => {
      setPending(null);
      toast({ title: 'Could not cycle the token', description: message, variant: 'error' });
    },
  });

  const revoke = useMutation(() => api.delete<{ revoked: boolean }>('/api/tokens'), {
    invalidates,
    onSuccess: () => {
      setPending(null);
      void resource.refresh();
      toast({ title: 'API token revoked', variant: 'success' });
    },
    onError: (message) => {
      setPending(null);
      toast({ title: 'Could not revoke the token', description: message, variant: 'error' });
    },
  });

  async function copyRevealed() {
    if (!revealed) return;
    const copied = await copyText(revealed.plaintext);
    toast({
      title: copied ? 'Token copied' : 'Could not copy automatically',
      description: copied ? undefined : 'Select the token and copy it manually before closing this dialog.',
      variant: copied ? 'success' : 'error',
    });
  }

  return (
    <SettingsGroup
      title="API access"
      footer="The GraphQL endpoint is at /api/graphql and accepts an Authorization: Bearer <token> header. Only a hash of the token is stored, so it can never be shown again after you close the dialog."
    >
      {resource.isInitialLoading ? (
        <SettingsRow>
          <Skeleton className="h-5 w-40" />
        </SettingsRow>
      ) : (
        <>
          <SettingsRow>
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              <GlobeIcon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">GraphQL API token</span>
              <span className="block text-xs text-muted-foreground">
                {token ? `Active — ${token.prefix}…` : 'No token yet. Create one to use the API.'}
              </span>
            </span>
            <Badge variant={token ? 'default' : 'secondary'}>{token ? 'Active' : 'None'}</Badge>
          </SettingsRow>

          {token ? (
            <>
              <SettingsRow>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">Created</span>
                  <span className="block text-xs text-muted-foreground">{formatWhen(token.createdAt)}</span>
                </span>
              </SettingsRow>
              <SettingsRow>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">Last used</span>
                  <span className="block text-xs text-muted-foreground">{formatWhen(token.lastUsedAtMs)}</span>
                </span>
              </SettingsRow>
            </>
          ) : null}

          <SettingsRow stacked>
            <div className="flex flex-wrap gap-2">
              {token ? (
                <Button variant="outline" disabled={cycle.isPending} onClick={() => setPending('cycle')}>
                  <ReloadIcon />
                  Cycle token
                </Button>
              ) : (
                <Button disabled={create.isPending} onClick={() => void create.run()}>
                  <Link1Icon />
                  Create token
                </Button>
              )}
              {token ? (
                <Button variant="ghost" disabled={revoke.isPending} onClick={() => setPending('revoke')}>
                  <TrashIcon />
                  Revoke
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Cycling replaces the token immediately; anything still using the old one stops working. You can only
              have one token at a time.
            </p>
          </SettingsRow>
        </>
      )}

      {/* One-time reveal. Closing it is final: the plaintext is not recoverable. */}
      <Dialog open={revealed !== null} onOpenChange={(open) => (open ? undefined : setRevealed(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API token now</DialogTitle>
            <DialogDescription>
              This is the only time it will be shown. Store it somewhere safe — if you lose it, cycle the token to get
              a new one.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-card">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{revealed?.plaintext}</code>
            <Button variant="outline" size="icon-sm" aria-label="Copy API token" onClick={() => void copyRevealed()}>
              <ClipboardCopyIcon />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Use it as <span className="font-mono">Authorization: Bearer &lt;token&gt;</span> against{' '}
            <span className="font-mono">/api/graphql</span>.
          </p>

          <DialogFooter>
            <Button onClick={() => setRevealed(null)}>I have saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation for the two destructive actions. */}
      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending === 'revoke' ? 'Revoke the API token?' : 'Cycle the API token?'}</DialogTitle>
            <DialogDescription>
              {pending === 'revoke'
                ? 'The token stops working immediately. You can create a new one afterwards.'
                : 'A new token is generated and the current one stops working immediately. Any integration using it must be updated.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant={pending === 'revoke' ? 'destructive' : 'default'}
              disabled={cycle.isPending || revoke.isPending}
              onClick={() => {
                if (pending === 'revoke') void revoke.run();
                else void cycle.run();
              }}
            >
              {pending === 'revoke' ? 'Revoke token' : 'Cycle token'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
