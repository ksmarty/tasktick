'use client';

/**
 * The user table.
 *
 * Three actions per row: promote/demote, disable/enable, delete. All three are
 * refused by the server in the cases that would lock the instance out (demoting
 * or deleting the last administrator, an admin disabling themselves), and the
 * refusal arrives as a 400 with a sentence worth reading — so the error is
 * surfaced verbatim rather than replaced with "something went wrong".
 *
 * Toggles are optimistic: the switch flips, the PATCH goes out, and a failure
 * flips it back with a toast.
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, ConfirmDialog, ListRow, Skeleton, Switch, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { cn } from '@/lib/cn';
import { SettingsGroup } from './SettingsGroup';
import type { AdminUserPayload } from '@/lib/view-types';

export interface AdminUserTableProps {
  /** The signed-in administrator's id, so their own row can be marked. */
  currentUserId: string;
}

export function AdminUserTable({ currentUserId }: AdminUserTableProps) {
  const { toast } = useToast();
  const users = useResource<AdminUserPayload[]>('/api/admin/users');
  const [removeTarget, setRemoveTarget] = useState<AdminUserPayload | null>(null);
  const list = users.data ?? [];

  const refresh = () => {
    invalidate('/api/admin/users');
    invalidate('/api/bootstrap');
    void users.refresh();
  };

  const patch = useMutation(
    async (id: string, body: { isAdmin?: boolean; banned?: boolean }) =>
      api.patch<{ updated: boolean }>(`/api/admin/users/${id}`, body),
    {
      invalidates: ['/api/admin/users', '/api/bootstrap'],
      onSuccess: (_result, [, body]) => {
        const label = body.isAdmin !== undefined ? (body.isAdmin ? 'promoted' : 'demoted') : body.banned ? 'disabled' : 'enabled';
        toast({ title: `User ${label}`, variant: 'success' });
        refresh();
      },
      onError: (message) => {
        toast({ title: 'That change was refused', description: message, variant: 'error' });
        refresh();
      },
    },
  );

  const remove = useMutation(async (id: string) => api.delete<{ deleted: boolean }>(`/api/admin/users/${id}`), {
    invalidates: ['/api/admin/users'],
    onSuccess: () => {
      toast({ title: 'User deleted', description: 'Everything they owned was deleted with them.', variant: 'success' });
      refresh();
    },
    onError: (message) => toast({ title: 'Could not delete that user', description: message, variant: 'error' }),
  });
  return (
    <SettingsGroup
      title="Users"
      footer="Deleting a user removes their tasks, lists, habits and calendars on this server. You cannot remove or demote the last administrator."
    >
      {users.isInitialLoading ? (
        <div className="space-y-2 px-4 py-3">
          <Skeleton variant="rect" className="h-10" />
          <Skeleton variant="rect" className="h-10" />
        </div>
      ) : list.length === 0 ? (
        <ListRow title="No users" subtitle="Something is wrong — you are signed in." />
      ) : (
        list.map((user, index) => {
          const isSelf = user.id === currentUserId;
          /*
           * The controls sit on their own line below the identity.
           *
           * Trailing a row with two switches and a bin left "Demo …" and
           * "demo@tasktick.local · joine…" at six characters on a phone. Each
           * switch is labelled here, which also removes the need for the
           * caption that used to explain which switch did what.
           */
          return (
            <div
              key={user.id}
              className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5', index > 0 && 'hairline-t')}
            >
              <div className="min-w-0 flex-1 basis-full sm:basis-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-body text-label">{user.name}</span>
                  {user.isAdmin ? <Badge variant="tint">Admin</Badge> : null}
                  {user.banned ? <Badge variant="danger">Disabled</Badge> : null}
                  {isSelf ? <span className="shrink-0 text-caption-1 text-tertiary">you</span> : null}
                </div>
                <p className="truncate text-footnote text-secondary">
                  {user.email} · joined {new Date(user.createdAt).toISOString().slice(0, 10)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-x-4">
                <Switch
                  size="sm"
                  label="Admin"
                  checked={user.isAdmin}
                  disabled={isSelf}
                  onCheckedChange={(next) => void patch.run(user.id, { isAdmin: next })}
                />
                <Switch
                  size="sm"
                  label="Active"
                  checked={!user.banned}
                  disabled={isSelf}
                  onCheckedChange={(next) => void patch.run(user.id, { banned: !next })}
                />
                <button
                  type="button"
                  disabled={isSelf}
                  aria-label={`Delete ${user.name}`}
                  onClick={() => setRemoveTarget(user)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-ios px-1 text-subhead text-danger pressable disabled:pointer-events-none disabled:text-tertiary"
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </button>
              </div>
            </div>
          );
        })
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={`Delete ${removeTarget?.name ?? 'this user'}?`}
        message="Their tasks, lists, habits and calendars on this server are deleted with them. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (removeTarget) void remove.run(removeTarget.id);
          setRemoveTarget(null);
        }}
      />
    </SettingsGroup>
  );
}
