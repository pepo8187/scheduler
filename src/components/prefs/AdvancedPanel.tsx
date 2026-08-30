import { useState } from 'react';
import { DEFAULT_TUNING } from '../../domain/score';
import type { Tuning } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';

interface Field {
  key: keyof Tuning;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

interface Group {
  title: string;
  blurb: string;
  warn?: string;
  fields: Field[];
}

/**
 * The objective, spelled out. The defaults are argued for in the README; these controls exist
 * because the exchange rate between a gap and a wasted morning is genuinely personal and no
 * default settles it for everyone.
 */
const GROUPS: Group[] = [
  {
    title: 'Dead time',
    blurb: 'The gap curve the Gaps and Break shape sliders ride on. Plotted live in the panel above.',
    fields: [
      {
        key: 'gapFreeMinutes',
        label: 'Free window',
        hint: 'A gap this short is a changeover, not dead time. Teaching hours run :00–:50, so back-to-back classes still show 10 minutes.',
        min: 0,
        max: 120,
        step: 5,
        unit: 'min',
      },
      {
        key: 'gapScaleMinutes',
        label: 'Curve scale',
        hint: 'Chargeable minutes at which a gap costs about 63% of the cap. Lower makes the curve bite sooner.',
        min: 5,
        max: 480,
        step: 5,
        unit: 'min',
      },
      {
        key: 'gapBadnessCap',
        label: 'Per-gap cap',
        hint: 'The most a single gap can cost, however long. This ceiling is why long stretches consolidate.',
        min: 0,
        max: 1000,
        step: 10,
      },
      {
        key: 'gapWeight',
        label: 'Points per badness',
        hint: 'Scales the whole dead-time term against every other one, before the Gaps slider.',
        min: 0,
        max: 50,
        step: 0.5,
      },
    ],
  },
  {
    title: 'Barely-used days',
    blurb: 'The cost of showing up for a day that barely has anything on it.',
    fields: [
      {
        key: 'sparseDayFullMinutes',
        label: 'A full day is',
        hint: 'Class time that earns the trip. A day at or above this costs nothing; below it, the shortfall is charged pro rata. Set to 0 to switch the term off.',
        min: 0,
        max: 600,
        step: 15,
        unit: 'min',
      },
      {
        key: 'sparseDayWeight',
        label: 'Cost of an empty day',
        hint: 'What a day with nothing at all on it would cost. A half-full day costs half this.',
        min: 0,
        max: 2000,
        step: 10,
      },
    ],
  },
  {
    title: 'Compactness',
    blurb: 'What the Compactness slider charges for at each end.',
    fields: [
      {
        key: 'cramPerDayUsed',
        label: 'Cram: per day used',
        hint: 'Points per day the schedule touches, scaled by how far the slider is toward cram.',
        min: 0,
        max: 2000,
        step: 10,
      },
      {
        key: 'spreadPerUnusedWeekday',
        label: 'Spread: per unused weekday',
        hint: 'Points per available weekday left empty, scaled by how far the slider is toward spread.',
        min: 0,
        max: 2000,
        step: 10,
      },
      {
        key: 'spreadVarianceTiebreak',
        label: 'Spread: evenness nudge',
        hint: 'Breaks ties between arrangements using the same number of days, in favour of evenly loaded ones. Deliberately tiny — variance is measured in minutes².',
        min: 0,
        max: 1,
        step: 0.0001,
      },
    ],
  },
  {
    title: 'Other comfort terms',
    blurb: 'The two straightforwardly linear penalties.',
    fields: [
      {
        key: 'dayWindowPerMinute',
        label: 'Outside day window',
        hint: 'Points per minute scheduled before your start or after your end.',
        min: 0,
        max: 100,
        step: 1,
      },
      {
        key: 'maxPerDayPerExcessClass',
        label: 'Over the daily cap',
        hint: 'Points per class beyond the max-classes-per-day cap, when that cap is on.',
        min: 0,
        max: 2000,
        step: 10,
      },
    ],
  },
  {
    title: 'Priorities',
    blurb: 'The two hard-ish penalties that outrank comfort.',
    warn:
      'These keep the ordering the rest of the app assumes: one collision must outweigh any comfort trade, and a dropped lecture must outweigh comfort but not a collision. They also feed the search’s lower bound, so lowering them changes which schedules the solver is willing to consider at all.',
    fields: [
      {
        key: 'seminarCollisionPerPair',
        label: 'Seminar collision',
        hint: 'Points per overlapping pair involving a seminar.',
        min: 0,
        max: 1_000_000,
        step: 1000,
      },
      {
        key: 'droppedLecturePerEvent',
        label: 'Dropped lecture',
        hint: 'Points per non-★ lecture dropped to honour a day off.',
        min: 0,
        max: 100_000,
        step: 100,
      },
    ],
  },
];

function isDefault(tuning: Tuning): boolean {
  return (Object.keys(DEFAULT_TUNING) as (keyof Tuning)[]).every((k) => tuning[k] === DEFAULT_TUNING[k]);
}

/** Every scoring constant, exposed for anyone who wants to argue with the defaults. */
export default function AdvancedPanel() {
  const { prefs, actions } = useScheduler();
  const [open, setOpen] = useState(false);
  const { tuning } = prefs;
  const pristine = isDefault(tuning);

  return (
    <section className="panel advanced">
      <div className="panel__header">
        <button
          type="button"
          className="advanced__toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="advanced__chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="panel__title">Advanced scoring controls</span>
          {!pristine && <span className="advanced__badge">modified</span>}
        </button>
        {open && (
          <button type="button" className="button button--ghost" onClick={actions.resetTuning} disabled={pristine}>
            Reset to defaults
          </button>
        )}
      </div>

      {open && (
        <div className="advanced__body">
          <p className="advanced__intro">
            Every constant the score is built from. The defaults are the ones the rest of the app is written
            around and they are a reasonable starting point &mdash; but the exchange rate between an hour of
            dead time and a wasted morning is a personal one, so here it is. Changes apply immediately, are
            saved with your other preferences, and <strong>Reset to defaults</strong> puts them all back.
          </p>

          {GROUPS.map((group) => (
            <div key={group.title} className="advanced__group">
              <h3 className="advanced__group-title">{group.title}</h3>
              <p className="advanced__group-blurb">{group.blurb}</p>
              {group.warn && <p className="advanced__warn">{group.warn}</p>}

              {group.fields.map((field) => {
                const value = tuning[field.key];
                const changed = value !== DEFAULT_TUNING[field.key];
                return (
                  <div key={field.key} className={`advanced__field${changed ? ' advanced__field--changed' : ''}`}>
                    <label className="advanced__field-head">
                      <span className="advanced__field-label">{field.label}</span>
                      <span className="advanced__field-input">
                        <input
                          type="number"
                          value={value}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            // An emptied box parses as NaN and would poison every score downstream.
                            if (!Number.isFinite(next)) return;
                            actions.setTuning({ [field.key]: Math.min(field.max, Math.max(field.min, next)) });
                          }}
                        />
                        {/* Always rendered, so the number boxes line up whether or not a field has a unit. */}
                        <span className="advanced__unit">{field.unit ?? ''}</span>
                      </span>
                    </label>
                    <p className="advanced__field-hint">
                      {field.hint} <span className="advanced__default">Default: {DEFAULT_TUNING[field.key]}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
