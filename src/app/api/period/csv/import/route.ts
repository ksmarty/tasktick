/**
 * CSV import of historical period data.
 *
 * One endpoint with two modes, exactly like the TickTick importer, because a
 * preview must be able to prove it writes nothing:
 *
 *   POST multipart/form-data { file, mode: 'preview' } -> counts + row errors
 *   POST multipart/form-data { file, mode: 'commit'  } -> writes, returns counters
 *
 * The file is sent on both calls rather than stashed server-side: the endpoint
 * stays stateless, and the commit parses exactly the bytes the user confirmed.
 * Parsing is pure (`src/lib/period-csv.ts`); the write is a single transaction
 * (`src/server/services/period-import.ts`), so a bad row at the end cannot leave
 * half a history behind.
 */
import { ApiError, badRequest, ok, route } from '@/server/http';
import { parsePeriodCsv } from '@/lib/period-csv';
import { applyPeriodImport } from '@/server/services/period-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A decade of daily logs is a few hundred KB; 5 MB is generous headroom. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const POST = route(async ({ user, req }) => {
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    throw badRequest('Expected a multipart upload containing the CSV file.', 'unsupported_media_type');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('The upload could not be read. Try choosing the file again.', 'invalid_upload');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw badRequest('Attach the CSV file to import.', 'missing_file');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. Split it and import it in parts.`,
      413,
      'payload_too_large',
    );
  }

  const parsed = parsePeriodCsv(await file.text(), { fileName: file.name });
  if (!parsed.ok) throw badRequest(parsed.error, parsed.code);

  const mode = String(form.get('mode') ?? 'preview');
  if (mode !== 'commit') {
    return ok({ mode: 'preview' as const, preview: parsed.preview });
  }

  const summary = await applyPeriodImport({
    userId: user.id,
    plan: parsed.plan,
    parseIssues: parsed.preview.issues,
    parseIssueCount: parsed.preview.issueCount,
    notes: parsed.preview.notes,
  });

  return ok({ mode: 'commit' as const, preview: parsed.preview, summary });
});
