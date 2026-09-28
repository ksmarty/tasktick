/**
 * Wearable import: Apple Health `export.xml`, a RingConn app export, or a CSV.
 *
 *   POST ?mode=preview&fileName=…   body = the file's own bytes
 *   POST ?mode=commit&fileName=…    body = the same bytes again  -> writes
 *
 * ## Why this is a raw body and not multipart, unlike the CSV importer
 *
 * Every other upload in this app is `multipart/form-data`, because that is what a
 * file input naturally produces and the files are small. This one cannot be: an
 * Apple Health `export.xml` is routinely 100–400 MB, and `req.formData()` buffers
 * the whole thing in memory before the handler runs. The client sends the `File`
 * itself as the request body and `parseWearableStream` consumes `req.body` chunk
 * by chunk, so the largest file this app is ever handed never becomes a string.
 * `fileName` and `mode` therefore travel in the query string, which is also why
 * the file is re-sent for the commit: the endpoint stays stateless and a preview
 * provably writes nothing, exactly as the period CSV importer does.
 *
 * ## Why a preview at all, when the merge rule cannot lose data
 *
 * Because the preview answers a question the user cannot answer from the RingConn
 * app: *did anything actually write a body temperature into my Apple Health
 * export?* The preview lists the temperature **source** of every record it read.
 * "RingConn — 0 records" is the finding they need, and it costs them nothing to
 * discover.
 */
import { explainEmptyImport, parseWearableStream, type WearableImportResult } from '@/lib/ringconn';
import { badRequest, ok, route } from '@/server/http';
import { applyWearableImport } from '@/server/services/ringconn-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A 300 MB export on modest hardware takes a while to scan. */
export const maxDuration = 300;

/**
 * The CSV path is buffered, so it is capped. The Apple Health XML path streams and
 * is bounded by record count instead — see `MAX_WEARABLE_RECORDS`.
 */
const MAX_CSV_BYTES = 32 * 1024 * 1024;

export const POST = route(async ({ user, req }) => {
  if (!req.body) throw badRequest('The upload arrived with no file in it.', 'invalid_upload');

  const mode = req.nextUrl.searchParams.get('mode') === 'commit' ? 'commit' : 'preview';
  const fileName = (req.nextUrl.searchParams.get('fileName') ?? 'wearable-export').slice(0, 200);

  const parsed = await parseWearableStream(req.body as ReadableStream<Uint8Array>, {
    fileName,
    maxCsvBytes: MAX_CSV_BYTES,
  });
  if (!parsed.ok) throw badRequest(parsed.error, parsed.code);

  // A file that parsed but carries nothing importable is not a server error; it is
  // an answer, and `explainEmptyImport` words it rather than reporting "0 rows".
  if (parsed.plan.days.length === 0) {
    throw badRequest(explainEmptyImport(parsed.plan), 'nothing_to_import');
  }

  if (mode === 'preview') {
    const body: WearableImportResult = { mode: 'preview', preview: parsed.preview };
    return ok(body);
  }

  const summary = await applyWearableImport({
    userId: user.id,
    plan: parsed.plan,
    parseIssues: parsed.preview.issues,
    parseIssueCount: parsed.preview.issueCount,
    notes: parsed.preview.notes,
  });

  const body: WearableImportResult = { mode: 'commit', preview: parsed.preview, summary };
  return ok(body);
});
