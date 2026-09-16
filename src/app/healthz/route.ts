/**
 * Container health probe.
 *
 * Intentionally unauthenticated and cheap: it must answer "is this process able
 * to serve traffic" without touching user data. Reports the resolved dialect so
 * a misconfigured DATABASE_URL is visible from `docker inspect`.
 */
import { NextResponse } from 'next/server';
import { pingDb } from '@/server/db';
import { describeDatabase } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const db = describeDatabase();
  const healthy = await pingDb();

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database: { dialect: db.dialect, location: db.location, reachable: healthy },
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? 'dev',
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
