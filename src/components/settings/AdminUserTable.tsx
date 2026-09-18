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
 * three controls. So it is a real Material `Table` —
 * `TableContainer`/`Table`/`TableHead`/`TableBody` — which also gives the header
 * row a place to name the two switches that used to need a caption.
 *
 * Toggles are optimistic: the switch flips, the PATCH goes out, and a failure
 * flips it back with a toast.
 *
 * The container scrolls horizontally rather than the page: four columns will not
 * fit a 390px screen at a comfortable density, and a settings page must never
 * hand the document a horizontal scrollbar.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import DeleteIcon from '@mui/icons-material/Delete';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { SettingsGroup } from './SettingsGroup';
import type { AdminUserPayload } from '@/lib/view-types';

export interface AdminUserTableProps {
  /** The signed-in administrator's id, so their own row can be marked. */
  currentUserId: string;
}

/** MUI's visually-hidden recipe, as `sx`: a header still has to be named. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
} as const;

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
      <ListItem sx={{ display: 'block', p: 0 }}>
        <TableContainer>
          <Table size="small" aria-label="Users">
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell align="center">Admin</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell align="right" sx={{ width: 48 }}>
                  <Box component="span" sx={VISUALLY_HIDDEN}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {users.isInitialLoading ? (
                [0, 1].map((key) => (
                  <TableRow key={key}>
                    <TableCell colSpan={4}>
                      <Skeleton variant="rounded" height={40} />
                    </TableCell>
                  </TableRow>
                ))
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant="body1">No users</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Something is wrong — you are signed in.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                list.map((user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <TableRow key={user.id} hover>
                      {/*
                       * The identity column is the flexible one. `maxWidth: 0` with
                       * `width: 100%` is what makes an auto-layout table column take
                       * the remaining space and ellipsise, instead of sizing itself to
                       * its longest line and pushing the controls off a phone.
                       */}
                      <TableCell sx={{ width: '100%', maxWidth: 0 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                            {user.name}
                          </Typography>
                          {user.isAdmin ? <Chip size="small" color="primary" label="Admin" /> : null}
                          {user.banned ? <Chip size="small" color="error" label="Disabled" /> : null}
                          {isSelf ? (
                            <Typography variant="caption" color="text.disabled">
                              you
                            </Typography>
                          ) : null}
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', overflowWrap: 'anywhere' }}
                        >
                          {user.email} · joined {new Date(user.createdAt).toISOString().slice(0, 10)}
                        </Typography>
                      </TableCell>

                      <TableCell align="center" padding="none">
                        <Switch
                          size="small"
                          checked={user.isAdmin}
                          disabled={isSelf}
                          onChange={(_event, next) => void patch.run(user.id, { isAdmin: next })}
                          slotProps={{ input: { 'aria-label': `Admin for ${user.name}` } }}
                        />
                      </TableCell>

                      <TableCell align="center" padding="none">
                        <Switch
                          size="small"
                          checked={!user.banned}
                          disabled={isSelf}
                          onChange={(_event, next) => void patch.run(user.id, { banned: !next })}
                          slotProps={{ input: { 'aria-label': `Active for ${user.name}` } }}
                        />
                      </TableCell>

                      <TableCell align="right" padding="none">
                        <IconButton
                          aria-label={`Delete ${user.name}`}
                          disabled={isSelf}
                          color="error"
                          onClick={() => setRemoveTarget(user)}
                        >
                          <DeleteIcon fontSize="small" aria-hidden />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </ListItem>

      <Dialog open={removeTarget !== null} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>{`Delete ${removeTarget?.name ?? 'this user'}?`}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Their tasks, lists, habits and calendars on this server are deleted with them. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (removeTarget) void remove.run(removeTarget.id);
              setRemoveTarget(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsGroup>
  );
}
