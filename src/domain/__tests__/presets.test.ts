import { describe, expect, it } from 'vitest';
import { applyPreset, DEFAULT_PREFS, PRESETS } from '../presets';

describe('DEFAULT_PREFS', () => {
  it('has no day off, a neutral compactness, and a day window matching the grid bounds', () => {
    expect(DEFAULT_PREFS.daysOff).toEqual([]);
    expect(DEFAULT_PREFS.compactness).toBe(0);
    expect(DEFAULT_PREFS.dayWindow).toEqual({ start: 480, end: 1200 });
    expect(DEFAULT_PREFS.maxClassesPerDay).toBeNull();
  });

  it('has lunch blocking off by default, with no per-day overrides', () => {
    expect(DEFAULT_PREFS.lunch.enabled).toBe(false);
    expect(DEFAULT_PREFS.lunch.overrides).toEqual({});
  });
});

describe('applyPreset', () => {
  it('Cram it in pushes compactness and gaps toward their cram extremes', () => {
    const result = applyPreset(DEFAULT_PREFS, 'cramIt');
    expect(result.compactness).toBe(1);
    expect(result.gaps).toBeGreaterThan(DEFAULT_PREFS.gaps);
  });

  it('Spread evenly pushes compactness toward its spread extreme', () => {
    const result = applyPreset(DEFAULT_PREFS, 'spreadEvenly');
    expect(result.compactness).toBe(-1);
  });

  it('Late riser pushes the day window start later without touching the end', () => {
    const result = applyPreset(DEFAULT_PREFS, 'lateRiser');
    expect(result.dayWindow.start).toBeGreaterThan(DEFAULT_PREFS.dayWindow.start);
    expect(result.dayWindow.end).toBe(DEFAULT_PREFS.dayWindow.end);
  });

  it('Long weekend takes Friday off and crams the rest', () => {
    const result = applyPreset(DEFAULT_PREFS, 'longWeekend');
    expect(result.daysOff).toContain('Pá');
    expect(result.compactness).toBe(1);
  });

  it('Long weekend does not duplicate Friday if it is already off', () => {
    const prefs = { ...DEFAULT_PREFS, daysOff: ['Pá' as const] };
    const result = applyPreset(prefs, 'longWeekend');
    expect(result.daysOff.filter((d) => d === 'Pá')).toHaveLength(1);
  });

  it('leaves prefs untouched for an unknown preset id', () => {
    // @ts-expect-error exercising the runtime fallback for a bad id
    expect(applyPreset(DEFAULT_PREFS, 'nope')).toBe(DEFAULT_PREFS);
  });

  it('every preset is reachable by id and produces a distinct Prefs object', () => {
    for (const preset of PRESETS) {
      const result = applyPreset(DEFAULT_PREFS, preset.id);
      expect(result).not.toBe(DEFAULT_PREFS);
    }
  });
});
