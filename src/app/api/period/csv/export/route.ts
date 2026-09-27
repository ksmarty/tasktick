/**
 * Full period-data export as CSV.
 *
 * Emits exactly the column set the importer reads, so the file round-trips: a
 * user can export, edit the file in a spreadsheet, and import it back. That is
 * why the export is CSV rather than JSON — the point is to be editable — and why
 * it is a separate endpoint from the template.
 */
import { NextResponse } from 'next/server';
import { ok, route } from '@/server/http';
import { listContraceptionDays, listContraceptionMethods, listPeriodCycles, listPeriodDayLogs } from '@/server/repos/period';
import { serialisePeriodCsv } from '@/lib/period-csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const format = new URL(req.url).searchParams.get('format');
  const [cycles, days, methods, contraceptionDays] = await Promise.all([
    listPeriodCycles(user.id),
    listPeriodDayLogs(user.id),
    listContraceptionMethods(user.id),
    listContraceptionDays(user.id),
  ]);

  const methodById = new Map(methods.map((method) => [method.id, method]));
  const csv = serialisePeriodCsv({
    cycles,
    days,
    methods,
    contraceptionDays: contraceptionDays
      .map((day) => {
        const method = methodById.get(day.methodId);
        if (!method) return null;
        return {
          date: day.date,
          method: method.method,
          label: method.label,
          status: day.status,
          notes: day.notes,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
  });

  // `?format=json` is the escape hatch for a client that wants the rows without
  // writing a CSV parser; the default stays the editable spreadsheet form.
  if (format === 'json') {
    return ok({ cycles, days, methods, contraceptionDays });
  }

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tasktick-period-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store, private',
    },
  });
});
