/**
 * Pure geometry and colour resolution behind `ProgressRing` / `ProgressBar`.
 */
import { describe, expect, it } from 'vitest';
import {
  clamp01,
  formatPercent,
  progressColor,
  ringDashOffset,
  ringGeometry,
} from '@/components/ui/progress-ring';

describe('ringGeometry', () => {
  it('puts the stroke centre-line half a stroke inside the viewport', () => {
    const geometry = ringGeometry(44, 4);

    expect(geometry.center).toBe(22);
    expect(geometry.radius).toBe(20);
    expect(geometry.circumference).toBeCloseTo(2 * Math.PI * 20, 10);
  });

  it('clamps the stroke so it can never spill outside the viewport', () => {
    const geometry = ringGeometry(20, 40);

    expect(geometry.strokeWidth).toBe(10);
    expect(geometry.radius).toBe(5);
    expect(geometry.radius).toBeGreaterThan(0);
  });

  it('falls back to a hairline stroke for nonsense widths', () => {
    expect(ringGeometry(40, 0).strokeWidth).toBe(1);
    expect(ringGeometry(40, Number.NaN).strokeWidth).toBe(1);
  });

  it('rejects a size that cannot hold a ring', () => {
    expect(() => ringGeometry(0, 4)).toThrow(RangeError);
    expect(() => ringGeometry(-10, 4)).toThrow(RangeError);
  });
});

describe('ringDashOffset', () => {
  const circumference = ringGeometry(44, 4).circumference;

  it('draws nothing at 0 and everything at 1', () => {
    expect(ringDashOffset(0, circumference)).toBeCloseTo(circumference, 10);
    expect(ringDashOffset(1, circumference)).toBe(0);
  });

  it('draws a quarter of the ring at 0.25', () => {
    expect(ringDashOffset(0.25, circumference)).toBeCloseTo(circumference * 0.75, 10);
  });

  it('clamps out-of-range and non-finite values', () => {
    expect(ringDashOffset(-3, circumference)).toBeCloseTo(circumference, 10);
    expect(ringDashOffset(4, circumference)).toBe(0);
    expect(ringDashOffset(Number.NaN, circumference)).toBeCloseTo(circumference, 10);
  });
});

describe('clamp01', () => {
  it('keeps values inside 0..1', () => {
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatPercent', () => {
  it('renders the rounded percentage', () => {
    expect(formatPercent(0.426)).toBe('43%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(2)).toBe('100%');
    expect(formatPercent(0.426, 1)).toBe('42.6%');
  });
});

describe('progressColor', () => {
  it('resolves to design tokens rather than literals', () => {
    expect(progressColor()).toBe('var(--tint)');
    expect(progressColor('success')).toBe('var(--success)');
    expect(progressColor('warning')).toBe('var(--warning)');
    expect(progressColor('danger')).toBe('var(--danger)');
    expect(progressColor('purple')).toBe('var(--ios-purple)');
  });

  it('never returns a hard-coded hex colour', () => {
    for (const color of ['tint', 'success', 'warning', 'danger', 'blue', 'brown'] as const) {
      expect(progressColor(color)).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});
