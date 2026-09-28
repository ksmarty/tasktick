/**
 * Period settings → Tracking: the mode switch and the way back to tasks.
 *
 * This is the default landing of `/period/settings`, so the way out is never
 * behind another control. The screen is a client component that reads and writes
 * `/api/period/settings`.
 */
import { PeriodModeSection } from '@/components/period/PeriodSettings';

export default function PeriodTrackingSettingsPage() {
  return <PeriodModeSection />;
}