'use client';

/**
 * Tags: the settings section for the labels a task can carry.
 *
 * A thin page — the work is in `TagsSettings`, which opens the same
 * `TagManagerDialog` the task editor does. It exists as a route so it can be
 * linked, deep-linked and found by the settings search like every other section;
 * the header comes from the settings layout.
 */
import { TagsSettings } from '@/components/settings/TagsSettings';

export default function TagsSettingsPage() {
  return <TagsSettings />;
}
