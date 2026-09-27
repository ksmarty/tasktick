/** A single stretch of using one contraception method. */
import { notFound, ok, parseJson, route } from '@/server/http';
import {
  deleteContraceptionMethod,
  getContraceptionMethod,
  updateContraceptionMethod,
} from '@/server/repos/period';
import { updateContraceptionMethodSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const method = await getContraceptionMethod(user.id, params.id);
  if (!method) throw notFound('That contraception record does not exist.');
  return ok(method);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateContraceptionMethodSchema);
  const method = await updateContraceptionMethod(user.id, params.id, body);
  if (!method) throw notFound('That contraception record does not exist.');
  return ok(method);
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deleteContraceptionMethod(user.id, params.id);
  if (!deleted) throw notFound('That contraception record does not exist.');
  return ok({ deleted: true });
});
