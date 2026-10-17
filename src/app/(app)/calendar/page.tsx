import { CalendarScreen } from '@/components/calendar';
import { isValidDateOnly } from '@/lib/dates';

/**
 * The calendar route.
 *
 * A thin server shell around the client screen: it reads the three query
 * parameters once (`?date=`, `?calendar=`, `?event=`) and validates them before
 * anything is rendered, so a hand-edited URL degrades to today instead of
 * throwing. `?event=` is a reminder notification's tap target — the day it opens
 * comes through `?date=`, and the card to show is resolved against that day's
 * payload once it arrives, so a link to an event the user cannot see opens the
 * day rather than nothing. The
 * screen owns everything after that — including writing the parameters back as
 * the user moves around — so there is a single source of truth for "which day am
 * I looking at".
 */
export const dynamic = 'force-dynamic';

/** The user's zone is not known server-side here, so only the shape is checked. */
function parseDate(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && isValidDateOnly(value) ? value : null;
}

function parseId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value : null;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <CalendarScreen
      initialDate={parseDate(params.date)}
      initialCalendarId={parseId(params.calendar)}
      initialEventId={parseId(params.event)}
    />
  );
}
