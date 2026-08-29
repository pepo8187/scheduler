import type { Prefs } from './types';

export const DEFAULT_PREFS: Prefs = {
  daysOff: [],
  compactness: 0,
  gaps: 0.3,
  dayWindow: { start: 480, end: 1200 }, // matches the grid's own 08:00-20:00 bounds: no nudge by default
  maxClassesPerDay: null,
  lunch: { enabled: false, default: { start: 600, end: 660 }, overrides: {} }, // 10:00-11:00, opt-in
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
    apply: (prefs) => ({ ...prefs, compactness: 1, gaps: 0.9 }),
  },
  {
    id: 'spreadEvenly',
    label: 'Spread evenly',
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
