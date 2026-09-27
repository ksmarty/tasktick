/**
 * Insights: the predictions, their uncertainty, and the cycle history.
 *
 * A thin route: the screen is a client component that reads `/api/period/prediction`
 * and `/api/period/stats`.
 */
import { InsightsScreen } from '@/components/period/InsightsScreen';

export default function PeriodInsightsPage() {
  return <InsightsScreen />;
}
