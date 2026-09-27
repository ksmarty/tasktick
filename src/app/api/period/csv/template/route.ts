/**
 * The downloadable CSV template.
 *
 * Served as `text/csv` with a `Content-Disposition` attachment, so the browser
 * downloads it rather than rendering it. The fixed filename means a user who
 * downloads it twice knows which one they filled in.
 */
import { NextResponse } from 'next/server';
import { route } from '@/server/http';
import { buildPeriodTemplateCsv } from '@/lib/period-csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  return new NextResponse(buildPeriodTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="tasktick-period-template.csv"',
      'Cache-Control': 'no-store, private',
    },
  });
});
