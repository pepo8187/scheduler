import { DEFAULT_TUNING } from './score';
import type { Prefs } from './types';

export const DEFAULT_PREFS: Prefs = {
  daysOff: [],
  compactness: 0,
  gaps: 0.3,
  gapShape: 0.5, // neutral bend: consolidate dead time, but without treating every short break as a hole
  dayWindow: { start: 480, end: 1200 }, // matches the grid's own 08:00-20:00 bounds: no nudge by default
  maxClassesPerDay: null,
  lunch: { enabled: false, default: { start: 600, end: 660 }, overrides: {} }, // 10:00-11:00, opt-in
  tuning: DEFAULT_TUNING,
};

export type PresetId = 'cramIt' | 'spreadEvenly' | 'lateRiser' | 'longWeekend';

export interface Preset {
  id: PresetId;
  label: string;
  apply: (prefs: Prefs) => Prefs;
}

export const PRESETS: Preset[] = [
  {
    id: 'cramIt',
    label: 'Cram it in',
    // Cram wants a tight day as well as a tight week: pull the bend all the way toward
    // consolidating dead time into one break rather than scattering short ones.
    apply: (prefs) => ({ ...prefs, compactness: 1, gaps: 0.9, gapShape: 0.15 }),
  },
  {
    id: 'spreadEvenly',
    label: 'Spread evenly',
    // Spreading across the week says nothing about the shape of a day's dead time, so
    // gapShape is deliberately left where the user put it.
    apply: (prefs) => ({ ...prefs, compactness: -1, gaps: 0.2 }),
  },
  {
    id: 'lateRiser',
    label: 'Late riser',
    apply: (prefs) => ({ ...prefs, dayWindow: { ...prefs.dayWindow, start: 600 } }), // nothing before 10:00
  },
  {
    id: 'longWeekend',
    label: 'Long weekend',
    apply: (prefs) => ({
      ...prefs,
      compactness: 1,
      daysOff: prefs.daysOff.includes('Pá') ? prefs.daysOff : [...prefs.daysOff, 'Pá'],
    }),
  },
];

export function applyPreset(prefs: Prefs, id: PresetId): Prefs {
  return PRESETS.find((preset) => preset.id === id)?.apply(prefs) ?? prefs;
}
