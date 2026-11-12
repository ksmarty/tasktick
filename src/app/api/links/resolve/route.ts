/**
 * `GET /api/links/resolve?url=…` — what place does this short maps link point at?
 *
 * The only caller is the detail sheet, for a link it could not read on its own:
 * a `maps.app.goo.gl` id. It answers `{ place: null }` rather than an error when
 * there is nothing to resolve, because "no coordinates" is a normal outcome (a
 * search link, a host that could not be reached) and the sheet's fallback is to
 * keep showing the link it already has.
 *
 * A read: nothing is written, so no `AFFECTS` row. Signed-in only, because the
 * endpoint makes the server fetch a third-party URL on the caller's behalf and
 * there is no reason to offer that to an anonymous request.
 */
import { badRequest, ok, route } from '@/server/http';
import { resolveShortMapsLink } from '@/server/services/link-resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ req }) => {
  const url = req.nextUrl.searchParams.get('url') ?? '';
  if (!url.trim()) throw badRequest('Say which link to resolve.');
  return ok({ place: await resolveShortMapsLink(url) });
});
