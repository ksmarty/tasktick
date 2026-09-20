/**
 * The habits month's completion ring: the per-day counts and the arc geometry.
 *
 * Pure functions only — there is no jsdom in this repo, so nothing here renders.
 * The two halves that can be wrong are both arithmetic a reviewer can check by
 * hand: "one arc per completed habit, none for a day with nothing" and "a ring
 * of N sections covers the circle once, with a visible gap at each boundary".
 *
 * The habits' payload shape mirrors the server's: `entries` is a day -> amount
 * map for the requested window, and today is answered by `doneToday`.
 */
import { describe, expect, it } from 'vitest';
import { habitRingSegments, habitsCompletedOn } from '@/components/habits/period';
import { ringArcPath, ringArcs, ringPoint } from '@/components/habits/ring';
import type { DateOnly, Habit } from '@/lib/types';

const TODAY: DateOnly = '2025-03-15';

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    userId: 'u1',
    name: 'Drink water',
    description: null,
    icon: 'droplets',
    color: 'cyan',
    goalType: 'boolean',
    goalTarget: 1,
    unit: null,
    frequency: 'daily',
    weekDays: null,
    timesPerPeriod: 1,
    startDate: '2025-01-01',
    reminders: null,
    archived: false,
    sortOrder: 'a',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('habitsCompletedOn', () => {
  it('counts one per habit completed that day', () => {
    const habits = [
      habit({ id: 'a', entries: { '2025-03-10': 1 } }),
      habit({ id: 'b', entries: { '2025-03-10': 1 } }),
      habit({ id: 'c', entries: { '2025-03-11': 1 } }),
    ];
    expect(habitsCompletedOn(habits, '2025-03-10', TODAY)).toBe(2);
    expect(habitsCompletedOn(habits, '2025-03-11', TODAY)).toBe(1);
  });

  it('is zero for a day with no completions', () => {
    const habits = [habit({ id: 'a', entries: { '2025-03-10': 1 } })];
    expect(habitsCompletedOn(habits, '2025-03-12', TODAY)).toBe(0);
    expect(habitsCompletedOn([], '2025-03-10', TODAY)).toBe(0);
  });

  it('counts a logged amount as the day’s completion, and zero as none', () => {
    const counted = habit({ id: 'a', goalType: 'count', goalTarget: 8, unit: 'glasses' });
    // "Completed on a day" is the app's existing rule (`habitDoneOn`): anything
    // logged counts, and how close that is to the goal is scoring, which stays
    // server-side. The ring must not invent a second definition of done.
    expect(habitsCompletedOn([counted], '2025-03-10', TODAY)).toBe(0);
    expect(habitsCompletedOn([{ ...counted, entries: { '2025-03-10': 3 } }], '2025-03-10', TODAY)).toBe(1);
    expect(habitsCompletedOn([{ ...counted, entries: { '2025-03-10': 0 } }], '2025-03-10', TODAY)).toBe(0);
  });

  it("answers today from the server's own doneToday", () => {
    const habits = [habit({ id: 'a', doneToday: true }), habit({ id: 'b', doneToday: false })];
    expect(habitsCompletedOn(habits, TODAY, TODAY)).toBe(1);
    // `entries` may not even carry today; `doneToday` is the authority for it.
    expect(habitsCompletedOn([habit({ id: 'c', doneToday: true })], TODAY, TODAY)).toBe(1);
  });
});

describe('habitRingSegments', () => {
  const days: DateOnly[] = ['2025-03-09', '2025-03-10', '2025-03-11', '2025-03-12'];

  it('maps a day to its segment count and omits the empty days', () => {
    const habits = [
      habit({ id: 'a', entries: { '2025-03-10': 1, '2025-03-12': 1 } }),
      habit({ id: 'b', entries: { '2025-03-10': 1 } }),
    ];
    const segments = habitRingSegments(habits, days, TODAY);
    expect(segments.get('2025-03-10')).toBe(2);
    expect(segments.get('2025-03-12')).toBe(1);
    // Absent, not zero: the caller asks "is there a ring?" with one lookup.
    expect(segments.has('2025-03-09')).toBe(false);
    expect(segments.has('2025-03-11')).toBe(false);
    expect([...segments.keys()]).toHaveLength(2);
  });

  it('rings only the days the grid was given', () => {
    const habits = [habit({ id: 'a', entries: { '2025-03-10': 1, '2025-04-01': 1 } })];
    expect([...habitRingSegments(habits, days, TODAY).keys()]).toEqual(['2025-03-10']);
  });

  it('has nothing to say without habits', () => {
    expect(habitRingSegments([], days, TODAY).size).toBe(0);
  });
});

describe('ringArcs', () => {
  it('draws nothing for a day with no completions', () => {
    expect(ringArcs(0)).toEqual([]);
    expect(ringArcs(-3)).toEqual([]);
  });

  it('draws one closed ring for a single completion', () => {
    expect(ringArcs(1)).toEqual([{ fromDeg: 0, toDeg: 360 }]);
  });

  it('divides the ring into one section per completion', () => {
    for (const count of [2, 3, 5, 12]) {
      const arcs = ringArcs(count);
      expect(arcs).toHaveLength(count);
      // Every section is the same size, and none is empty or wrapped.
      const sweeps = arcs.map((arc) => arc.toDeg - arc.fromDeg);
      for (const sweep of sweeps) expect(sweep).toBeCloseTo(sweeps[0], 6);
      for (const arc of arcs) expect(arc.toDeg).toBeGreaterThan(arc.fromDeg);
      expect(arcs[arcs.length - 1].toDeg).toBeLessThan(360);
    }
  });

  it('leaves a gap at every boundary, and never more than a quarter of a section', () => {
    for (const count of [2, 3, 4, 8, 12, 31]) {
      const arcs = ringArcs(count);
      const section = 360 / count;
      const gaps = arcs.map((arc, index) => {
        const next = arcs[(index + 1) % arcs.length];
        return (next.fromDeg + (index + 1 === arcs.length ? 360 : 0)) - arc.toDeg;
      });
      for (const gap of gaps) {
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(24 + 1e-9);
        expect(gap).toBeLessThanOrEqual(section / 4 + 1e-9);
      }
      // The sections stay symmetric about 12 o'clock: the first gap straddles it.
      expect(arcs[0].fromDeg).toBeCloseTo(gaps[0] / 2, 6);
    }
  });
});

describe('ringArcPath', () => {
  it('starts at 12 o’clock and travels clockwise', () => {
    const [first] = ringArcs(4);
    const path = ringArcPath(first);
    expect(path).not.toBeNull();
    // The quarter section starts just past the top centre and ends just before
    // 3 o'clock: both endpoints are on the ring's circle.
    const start = ringPoint(first.fromDeg);
    expect(path?.startsWith(`M ${Math.round(start.x * 100) / 100} ${Math.round(start.y * 100) / 100}`)).toBe(true);
    expect(path).toContain('A 16 16 0 0 1');
  });

  it('sets the large-arc flag past a half turn', () => {
    expect(ringArcPath({ fromDeg: 10, toDeg: 170 })).toContain('A 16 16 0 0 1');
    expect(ringArcPath({ fromDeg: 10, toDeg: 200 })).toContain('A 16 16 0 1 1');
  });

  it('refuses the arcs a path cannot express', () => {
    expect(ringArcPath({ fromDeg: 90, toDeg: 90 })).toBeNull();
    expect(ringArcPath({ fromDeg: 0, toDeg: 360 })).toBeNull();
  });
});
