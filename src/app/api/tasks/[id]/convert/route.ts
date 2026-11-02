/**
 * Turning a task into a calendar event.
 *
 * One call rather than two on the client (`POST /api/events` + `DELETE
 * /api/tasks/:id`) because the pair is a single intention: a half that lands on
 * its own leaves either a duplicate or a disappearance, and the client cannot
 * undo what it does not know about. The rules — what carries over, what is
 * refused, and the compensating delete when the removal fails — live in
 * `@/server/services/task-to-event`.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { getSettings } from '@/server/repos/settings';
import { convertTaskSchema } from '@/lib/schemas';
import { ConversionError, convertTaskToEvent } from '@/server/services/task-to-event';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, params, req }) => {
  const body = await parseJson(req, convertTaskSchema);
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  try {
    const result = await convertTaskToEvent(user.id, params.id, body.calendarId, zone);
    return ok(result, 201);
  } catch (error) {
    if (error instanceof ConversionError) {
      /*
       * A refusal is the user's to act on, so it carries its own sentence: a
       * parent task with subtasks and a task with no date need different fixes,
       * and neither is "that task does not exist".
       */
      if (error.refusal === 'not-found') throw notFound(error.message);
      throw new Error(error.message);
    }
    throw error;
  }
});
