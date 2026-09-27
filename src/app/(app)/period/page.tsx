/**
 * Period mode's landing screen: today's log.
 *
 * A thin route: the screen is a client component because it reads and writes the
 * API, and the route file exists only so the App Router has an entry. The header
 * is published by the screen (and the exit control by the shell).
 */
import { TodayLogScreen } from '@/components/period/TodayLogScreen';

export default function PeriodTodayPage() {
  return <TodayLogScreen />;
}
