/**
 * The calendar-subscription section, pinned from source.
 *
 * The two settings cards that used to hold the outgoing feed — one listing the
 * subscriptions, one to create another — are merged into a single
 * `SettingsGroup`. There is no jsdom here, so the merge is pinned structurally:
 * one group, both halves present inside it, and every endpoint the two cards
 * used still reached.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CARD = readFileSync(new URL('../src/components/settings/IcalSubscriptionCard.tsx', import.meta.url), 'utf8');

describe('the subscription surface is one section', () => {
  it('renders exactly one SettingsGroup', () => {
    expect(CARD.match(/<SettingsGroup\b/g)?.length).toBe(1);
  });

  it('keeps both halves of the job inside it', () => {
    expect(CARD).toContain('No subscriptions yet');
    expect(CARD).toContain('New subscription');
    expect(CARD).toContain('Your new subscription URL');
  });

  it('keeps every endpoint the two cards used', () => {
    expect(CARD).toContain("useResource<IcalTokenPayload[]>('/api/ical-tokens')");
    expect(CARD).toContain("api.post<IcalTokenPayload>('/api/ical-tokens'");
    expect(CARD).toContain('/api/ical-tokens/${token.id}');
    expect(CARD).toContain('toWebcal(');
  });
});
