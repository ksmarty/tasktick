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
 * This is the one screen in the settings area where a table is genuinely right:
 * a set of accounts, each with the same three per-account facts and the same
 * three controls. So it is the shadcn `Table` — which also gives the header row a
 * place to name the two switches that used to need a caption. The container
 * scrolls horizontally rather than the page: four columns will not fit a 390px
 * screen at a comfortable density, and a settings page must never hand the
 * document a horizontal scrollbar.
 *
 * Toggles are optimistic: the switch flips, the PATCH goes out, and a failure
 * flips it back with a toast.
 */
import { useState } from 'react';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
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
      {/*
       * A table is full-bleed inside the card on purpose: it brings its own column
       * gutters, so this row must not add the shared one.
       */}
      <div className="p-0">
        <Table aria-label="Users">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="text-center">Admin</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.isInitialLoading ? (
              [0, 1].map((key) => (
                <TableRow key={key}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <p className="text-sm">No users</p>
                  <p className="text-xs text-muted-foreground">Something is wrong — you are signed in.</p>
                </TableCell>
              </TableRow>
            ) : (
              list.map((user) => {
                const isSelf = user.id === currentUserId;
                return (
                  <TableRow key={user.id}>
                    {/*
                     * The identity column is the flexible one. `max-w-0` with
                     * `w-full` is what makes an auto-layout table column take the
                     * remaining space and ellipsise, instead of sizing itself to
                     * its longest line and pushing the controls off a phone.
                     */}
                    <TableCell className="w-full max-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{user.name}</span>
                        {user.isAdmin ? <Badge>Admin</Badge> : null}
                        {user.banned ? <Badge variant="destructive">Disabled</Badge> : null}
                        {isSelf ? <span className="text-xs text-muted-foreground">you</span> : null}
                      </div>
                      <p className="text-xs break-all text-muted-foreground">
                        {user.email} · joined {new Date(user.createdAt).toISOString().slice(0, 10)}
                      </p>
                    </TableCell>

                    <TableCell className="text-center">
                      <Switch
                        size="sm"
                        aria-label={`Admin for ${user.name}`}
                        checked={user.isAdmin}
                        disabled={isSelf}
                        onCheckedChange={(next) => void patch.run(user.id, { isAdmin: next })}
                      />
                    </TableCell>

                    <TableCell className="text-center">
                      <Switch
                        size="sm"
                        aria-label={`Active for ${user.name}`}
                        checked={!user.banned}
                        disabled={isSelf}
                        onCheckedChange={(next) => void patch.run(user.id, { banned: !next })}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={`Delete ${user.name}`}
                        disabled={isSelf}
                        onClick={() => setRemoveTarget(user)}
                      >
                        <TrashIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete ${removeTarget?.name ?? 'this user'}?`}</DialogTitle>
            <DialogDescription>
              Their tasks, lists, habits and calendars on this server are deleted with them. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) void remove.run(removeTarget.id);
                setRemoveTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
