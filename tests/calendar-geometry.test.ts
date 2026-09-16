/**
 * Geometry tests: minute <-> pixel conversion, snapping and contrast.
 *
 * Pure functions only — there is no jsdom in this repo, so nothing here touches
 * the DOM. Each expectation is written as the arithmetic a reviewer can check by
 * hand: at 60px per hour, one pixel is one minute.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUR_HEIGHT,
  MINUTES_PER_DAY,
  clampMinutes,
  formatHourLabel,
  formatMinuteLabel,
  minuteOfDay,
  minuteToTime,
  minutesToPixels,
  pixelsToMinutes,
  pixelsToSnappedMinutes,
  readableTextOn,
  relativeLuminance,
  snapMinutes,
  timeToMinute,
} from '@/components/calendar/geometry';
import { combineDateAndTime } from '@/lib/dates';

describe('minutes <-> pixels', () => {
  it('maps an hour to exactly one row height', () => {
    expect(minutesToPixels(60, 60)).toBe(60);
    expect(minutesToPixels(60, DEFAULT_HOUR_HEIGHT)).toBe(DEFAULT_HOUR_HEIGHT);
    expect(minutesToPixels(0)).toBe(0);
    expect(minutesToPixels(MINUTES_PER_DAY, 60)).toBe(24 * 60);
  });

  it('is the exact inverse of pixelsToMinutes', () => {
    expect(pixelsToMinutes(60, 60)).toBe(60);
    expect(pixelsToMinutes(DEFAULT_HOUR_HEIGHT / 2)).toBe(30);
    expect(pixelsToMinutes(minutesToPixels(47, 56), 56)).toBeCloseTo(47, 10);
  });

  it('never divides by a zero hour height (month view passes 0)', () => {
    expect(pixelsToMinutes(120, 0)).toBe(0);
  });
});

describe('snapping', () => {
  it('rounds to the nearest quarter hour', () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(37)).toBe(30);
    expect(snapMinutes(38)).toBe(45);
    expect(snapMinutes(52)).toBe(45);
    expect(snapMinutes(53)).toBe(60);
    expect(snapMinutes(600)).toBe(600);
  });

  it('goes from pixels straight to a snapped minute', () => {
    // At 60px/hour, 1px is 1 minute.
    expect(pixelsToSnappedMinutes(0, 60)).toBe(0);
    expect(pixelsToSnappedMinutes(7, 60)).toBe(0);
    expect(pixelsToSnappedMinutes(8, 60)).toBe(15);
    expect(pixelsToSnappedMinutes(125, 60)).toBe(120);
    expect(pixelsToSnappedMinutes(60, 60, 30)).toBe(60);
    expect(pixelsToSnappedMinutes(50, 60, 30)).toBe(60);
  });
});

describe('clampMinutes', () => {
  it('keeps a value inside the day', () => {
    expect(clampMinutes(-30)).toBe(0);
    expect(clampMinutes(600)).toBe(600);
    expect(clampMinutes(1500)).toBe(MINUTES_PER_DAY);
    expect(clampMinutes(600, 0, 540)).toBe(540);
  });
});

describe('instants and floating times', () => {
  const zone = 'Europe/Berlin';

  it('reads the minute of day in the user zone', () => {
    const ms = combineDateAndTime('2025-03-10', '14:35', zone);
    expect(minuteOfDay(ms, zone)).toBe(14 * 60 + 35);
    expect(minuteOfDay(combineDateAndTime('2025-03-10', '00:00', zone), zone)).toBe(0);
  });

  it('parses and formats HH:mm', () => {
    expect(timeToMinute('09:30')).toBe(570);
    expect(timeToMinute('00:00')).toBe(0);
    expect(timeToMinute(null)).toBe(0);
    expect(timeToMinute('nonsense')).toBe(0);
    expect(minuteToTime(570)).toBe('09:30');
    expect(minuteToTime(-5)).toBe('00:00');
    expect(minuteToTime(2000)).toBe('24:00');
  });
});

describe('labels', () => {
  it('formats gutter hour labels in both clock preferences', () => {
    expect(formatHourLabel(0, '24h')).toBe('00:00');
    expect(formatHourLabel(9, '24h')).toBe('09:00');
    expect(formatHourLabel(13, '24h')).toBe('13:00');
    expect(formatHourLabel(0, '12h')).toBe('12 AM');
    expect(formatHourLabel(9, '12h')).toBe('9 AM');
    expect(formatHourLabel(12, '12h')).toBe('12 PM');
    expect(formatHourLabel(13, '12h')).toBe('1 PM');
  });

  it('formats the drag ghost label with minutes', () => {
    expect(formatMinuteLabel(570, '24h')).toBe('09:30');
    expect(formatMinuteLabel(0, '12h')).toBe('12:00 AM');
    expect(formatMinuteLabel(870, '12h')).toBe('2:30 PM');
  });
});

describe('contrast', () => {
  it('orders luminance the way the eye does', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffcc00')).toBeGreaterThan(relativeLuminance('#007aff'));
    expect(relativeLuminance('not-a-colour')).toBe(0);
  });

  it('picks dark text for the bright accents and light text for the dark ones', () => {
    // The cited failure mode: white on yellow/orange is unreadable.
    expect(readableTextOn('#ffcc00')).toBe('dark'); // yellow
    expect(readableTextOn('#ff9500')).toBe('dark'); // orange
    expect(readableTextOn('#34c759')).toBe('dark'); // green
    expect(readableTextOn('#007aff')).toBe('light'); // blue
    expect(readableTextOn('#ff3b30')).toBe('light'); // red
    expect(readableTextOn('#5856d6')).toBe('light'); // indigo
    expect(readableTextOn('#8e8e93')).toBe('light'); // grey
  });
});
