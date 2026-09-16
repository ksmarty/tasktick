import { TodayView } from '@/components/tasks';

/**
 * `/today` — the Today screen.
 *
 * A thin server wrapper: the view itself is a client component because it owns
 * the optimistic agenda, but keeping the route file free of hooks means the page
 * stays a route segment like any other.
 */
export default function TodayPage() {
  return <TodayView />;
}
