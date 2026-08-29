import { intervalsOverlap } from './overlap';
import type { Day, DayWindow, LunchPrefs, Slot } from './types';

/**
 * The effective lunch window for a day: its per-day override if one is set (a custom
 * `DayWindow`, or `null` meaning "no block this day" — a blackout), otherwise `default`.
 * Returns `null` whenever nothing should be blocked that day, including when lunch is
 * disabled entirely.
 */
export function lunchWindowForDay(lunch: LunchPrefs, day: Day): DayWindow | null {
  if (!lunch.enabled) return null;
  if (day in lunch.overrides) return lunch.overrides[day] ?? null;
  return lunch.default;
}

/** Whether a slot falls inside its day's lunch window, if that day has one. */
export function slotDuringLunch(slot: Slot, lunch: LunchPrefs): boolean {
  const window = lunchWindowForDay(lunch, slot.day);
  return window != null && intervalsOverlap(slot.start, slot.end, window.start, window.end);
}
