/**
 * Instance-level state for the signed-out screens.
 *
 * The auth pages need to know three things before they can render honestly:
 * whether any account exists yet (first-run bootstrap), whether registration is
 * open, and whether single sign-on is available. None of that is secret, and a
 * wrong guess produces a dead-end login screen.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { user } from '../db/schema';
import { getEnv, oidcConfigured } from '@/lib/env';

export interface InstanceState {
  /** No accounts yet: the next registration becomes the administrator. */
  isFirstRun: boolean;
  userCount: number;
  registrationMode: 'open' | 'invite' | 'closed';
  /** True when an invite is required to register (and none is more permissive). */
  requiresInvite: boolean;
  oidc: { enabled: boolean; name: string };
  appName: string;
}

export async function getInstanceState(): Promise<InstanceState> {
  const env = getEnv();
  const db = getDb();

  let userCount = 0;
  try {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(user);
    userCount = Number(row?.count ?? 0);
  } catch {
    // The table may not exist yet on a brand-new database before migrations.
    userCount = 0;
  }

  const isFirstRun = userCount === 0;

  return {
    isFirstRun,
    userCount,
    registrationMode: env.REGISTRATION_MODE,
    // First run always permits registration, whatever the configured mode —
    // that is what makes `docker compose up` usable with no CLI step.
    requiresInvite: !isFirstRun && env.REGISTRATION_MODE === 'invite',
    oidc: { enabled: oidcConfigured(), name: env.OIDC_PROVIDER_NAME ?? 'Single sign-on' },
    appName: 'TaskTick',
  };
}

/** Whether a registration attempt should even be offered. */
export function registrationAllowed(state: InstanceState): boolean {
  if (state.isFirstRun) return true;
  return state.registrationMode === 'open' || state.registrationMode === 'invite';
}
