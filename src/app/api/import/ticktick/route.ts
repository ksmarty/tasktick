/**
 * TickTick import.
 *
 * One endpoint with two modes, because a preview must be able to prove it writes
 * nothing:
 *
 *   POST multipart/form-data { file, mode: 'preview' } -> counts + warnings
 *   POST multipart/form-data { file, mode: 'commit'  } -> writes, returns counters
 *
 * The file is sent on both calls rather than stashed server-side: that keeps the
 * endpoint stateless, and it means the commit always parses exactly the bytes the
 * user confirmed. Parsing is pure (`src/lib/ticktick-import.ts`); the write is a
 * single transaction (`src/server/services/ticktick-import.ts`).
 */
import { route, ok, badRequest, ApiError } from '@/server/http';
import { getSettings } from '@/server/repos/settings';
import { parseTickTickCsv } from '@/lib/ticktick-import';
import { applyTickTickImport } from '@/server/services/ticktick-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Upload cap. The row cap in the parser is the real protection; this exists so a
 * multi-gigabyte body is rejected before it is buffered into memory at all.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const POST = route(async ({ user, req }) => {
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
    throw badRequest('Expected a multipart upload containing the export file.', 'unsupported_media_type');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('The upload could not be read. Try choosing the file again.', 'invalid_upload');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw badRequest('Attach the CSV file TickTick produced under Settings → Backup.', 'missing_file');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(
      `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB. Split the export and import it in parts.`,
      413,
      'payload_too_large',
    );
  }

  const parsed = parseTickTickCsv(await file.text(), { fileName: file.name });
  if (!parsed.ok) throw badRequest(parsed.error, parsed.code);

  const mode = String(form.get('mode') ?? 'preview');
  if (mode !== 'commit') {
    return ok({ mode: 'preview' as const, preview: parsed.plan.preview });
  }

  const settings = await getSettings(user.id);
  const summary = await applyTickTickImport({
    userId: user.id,
    zone: settings.timezone || user.timezone,
    plan: parsed.plan,
  });

  return ok({ mode: 'commit' as const, preview: parsed.plan.preview, summary });
});
