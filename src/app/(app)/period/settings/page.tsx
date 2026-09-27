/**
 * Period settings: the model knobs, contraception, import/export and the exit.
 *
 * A thin route: the screen is a client component that reads and writes
 * `/api/period/settings`.
 */
import { PeriodSettings } from '@/components/period/PeriodSettings';

export default function PeriodSettingsPage() {
  return <PeriodSettings />;
}
