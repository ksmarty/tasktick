import { CalendarScreen } from '@/components/calendar';
import { isValidDateOnly } from '@/lib/dates';
import type { CalendarViewMode } from '@/components/calendar';

/**
 * The calendar route.
 *
 * A thin server shell around the client screen: it reads the three query
 * parameters once (`?view=`, `?date=`, `?calendar=`) and validates them before
 * anything is rendered, so a hand-edited URL degrades to the month view instead
 * of throwing. The screen owns everything after that — including writing the
 * parameters back as the user pages around — so there is a single source of
 * truth for "which window am I looking at".
 */
export const dynamic = 'force-dynamic';

const VIEWS: readonly CalendarViewMode[] = ['month', 'week', 'day', 'agenda'];

function parseView(raw: string | string[] | undefined): CalendarViewMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return VIEWS.find((view) => view === value) ?? 'month';
}

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
      initialView={parseView(params.view)}
      initialDate={parseDate(params.date)}
      initialCalendarId={parseId(params.calendar)}
    />
  );
}
