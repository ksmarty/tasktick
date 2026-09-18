'use client';

/**
 * Focus: the pomodoro timer's default lengths and auto-start behaviour.
 *
 * These lived under the old Advanced catch-all; they are their own concern, so
 * they get their own section. The focus timer itself links here from
 * `/pomodoro` (through the preserved `/settings/advanced` alias).
 *
 * The controls are in the shared `FocusSection`; the alias renders the same
 * body with its own header.
 */
import { FocusSection } from './FocusSection';

export default function FocusSettingsPage() {
  return <FocusSection title="Focus" />;
}
