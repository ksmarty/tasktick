/**
 * Finding a setting by typing at it.
 *
 * The settings area is grouped, and the groups are good — but grouping only helps
 * someone who already knows which group a setting lives in. "Where is the
 * timezone?" or "how do I turn off the 24-hour clock?" is a search, not a browse,
 * and on a phone the browse costs three taps before you can even read the labels.
 *
 * So the search is over the section list itself: type two letters and the
 * navigation becomes a short list of sections, each captioned with the group it
 * lives in. It is deliberately *not* a search over individual rows inside a
 * section — that would mean a registry of every control in the app, which drifts
 * the first time somebody adds a row and nobody remembers to register it. A
 * section is one route with one purpose; landing there is enough.
 *
 * ## Ranking
 *
 * Four tiers, best first: an exact label, a label starting with the query, a label
 * containing it, and finally a keyword hit (the words people actually type —
 * "push", "timezone", "backup" — declared next to each section, never rendered).
 * Within a tier, the declared order is kept, so the list is stable as you type
 * instead of reshuffling with every keystroke. That matters more than
 * cleverness: a result that moves under your finger is a result you mis-tap.
 *
 * Pure, and typed against the same `SettingsNavGroup` the navigation renders, so
 * the tests and the UI cannot disagree about what exists.
 */
import type { SettingsNavGroup, SettingsNavSection } from './SettingsTabs';

/** One hit: enough to render a row and to navigate to it. */
export interface SettingsMatch {
  value: string;
  label: string;
  /** The group the section belongs to — the row's caption. */
  group: string;
  /** The route, from the caller's `href` map. */
  href: string;
  /** Higher is a better hit; used only for ordering within one query. */
  rank: number;
}

/**
 * Sections matching `query`, best first.
 *
 * An empty query matches nothing rather than everything: the caller shows the
 * normal navigation in that case, and returning every section would make the two
 * states indistinguishable.
 */
export function searchSettings(
  groups: readonly SettingsNavGroup[],
  href: Record<string, string>,
  query: string,
  isAdmin = false,
): SettingsMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: SettingsMatch[] = [];
  for (const group of groups) {
    for (const section of group.sections) {
      if (section.adminOnly && !isAdmin) continue;
      const rank = rankSection(section, needle);
      if (rank === 0) continue;
      const route = href[section.value];
      /* A section with no route cannot be navigated to, so it is not a hit. */
      if (!route) continue;
      matches.push({ value: section.value, label: section.label, group: group.label, href: route, rank });
    }
  }

  /* Descending rank, and the declared order for ties — `sort` is stable. */
  return matches.sort((a, b) => b.rank - a.rank);
}

/** 4 exact label, 3 label prefix, 2 label contains, 1 keyword contains, 0 no hit. */
function rankSection(section: SettingsNavSection, needle: string): number {
  const label = section.label.toLowerCase();
  if (label === needle) return 4;
  if (label.startsWith(needle)) return 3;
  if (label.includes(needle)) return 2;
  const keywords = section.keywords ?? [];
  if (keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 1;
  return 0;
}
