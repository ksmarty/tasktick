'use client';

/**
 * Instance administration.
 *
 * Gated on the bootstrap user's `isAdmin`. A non-administrator does not get a
 * broken screen: they get told, and the admin-only endpoints would refuse them
 * anyway.
 */
import { ShieldCheck } from 'lucide-react';
import { EmptyState, NavBar, Skeleton } from '@/components/ui';
import { useResource } from '@/lib/store';
import { AdminUserTable } from '@/components/settings/AdminUserTable';
import { InviteManager } from '@/components/settings/InviteManager';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdminSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const user = bootstrap.data?.user;

  return (
    <div className="min-h-dvh pb-8">
      <NavBar title="Admin" back backHref="/settings" backLabel="Settings" largeTitle />

      {!user ? (
        <div className="space-y-4 px-4 pt-2">
          <Skeleton variant="rect" className="h-40" />
          <Skeleton variant="rect" className="h-40" />
        </div>
      ) : !user.isAdmin ? (
        <EmptyState
          icon={ShieldCheck}
          title="Administrators only"
          description="This account cannot manage the instance. Ask the person who set up TaskTick to promote you."
        />
      ) : (
        <>
          <InviteManager />
          <AdminUserTable currentUserId={user.id} />
        </>
      )}
    </div>
  );
}
