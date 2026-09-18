'use client';

/**
 * Focus: the pomodoro timer's default lengths and auto-start behaviour.
 *
 * These lived under the old Advanced catch-all; they are their own concern, so
 * they get their own section. The focus timer itself links here from
 * `/pomodoro` (through the preserved `/settings/advanced` alias).
 *
 * The controls are in the shared `FocusSection`; the header comes from the
 * settings layout, so this page and its alias render the same bar.
 */
import { FocusSection } from './FocusSection';

export default function FocusSettingsPage() {
  return <FocusSection />;
}
