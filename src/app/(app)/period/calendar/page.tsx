/**
 * The cycle month.
 *
 * A thin route: the screen is a client component, because the month reads its own
 * window from the API and owns its gestures.
 */
import { PeriodCalendarScreen } from '@/components/period/PeriodCalendarScreen';

export default function PeriodCalendarPage() {
  return <PeriodCalendarScreen />;
}
