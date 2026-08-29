import { TOGGLEABLE_DAYS } from '../../domain/analysis';
import { DAY_LABELS, formatMinutes, parseTimeToMinutes } from '../../domain/format';
import type { DayWindow, LunchPrefs } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';

/** One day's row in the per-day override list: a toggle, plus a mini time editor once enabled. */
function LunchDayRow({ day, lunch, setLunch }: { day: (typeof TOGGLEABLE_DAYS)[number]; lunch: LunchPrefs; setLunch: (patch: Partial<LunchPrefs>) => void }) {
  const hasOverride = day in lunch.overrides;
  const override = lunch.overrides[day]; // DayWindow | null | undefined
  const skipped = hasOverride && override === null;
  const window: DayWindow = hasOverride && override ? override : lunch.default;

  const setOverride = (value: DayWindow | null | undefined) => {
    const overrides = { ...lunch.overrides };
    if (value === undefined) delete overrides[day];
    else overrides[day] = value;
    setLunch({ overrides });
  };

  return (
    <div className="lunch-day">
      <label className="lunch-day__toggle">
        <input
          type="checkbox"
          checked={hasOverride}
          onChange={(e) => setOverride(e.target.checked ? { ...lunch.default } : undefined)}
        />
        <span>{DAY_LABELS[day]} is different</span>
      </label>

      {hasOverride && (
        <div className="lunch-day__detail">
          <label className="lunch-day__skip">
            <input type="checkbox" checked={skipped} onChange={(e) => setOverride(e.target.checked ? null : { ...lunch.default })} />
            No lunch block this day
          </label>
          {!skipped && (
            <div className="pref-row">
              <label>
                From
                <input
                  type="time"
                  value={formatMinutes(window.start)}
                  onChange={(e) => setOverride({ ...window, start: parseTimeToMinutes(e.target.value) })}
                />
              </label>
              <label>
                Until
                <input
                  type="time"
                  value={formatMinutes(window.end)}
                  onChange={(e) => setOverride({ ...window, end: parseTimeToMinutes(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LunchBreak() {
  const { prefs, actions } = useScheduler();
  const { lunch } = prefs;
  const setLunch = (patch: Partial<LunchPrefs>) => actions.setPrefs({ lunch: { ...lunch, ...patch } });

  return (
    <div className="pref-block">
      <label className="pref-row">
        <input type="checkbox" checked={lunch.enabled} onChange={(e) => setLunch({ enabled: e.target.checked })} />
        <span className="pref-block__label">Block out lunch</span>
      </label>

      {lunch.enabled && (
        <>
          <div className="pref-row">
            <label>
              From
              <input
                type="time"
                value={formatMinutes(lunch.default.start)}
                onChange={(e) => setLunch({ default: { ...lunch.default, start: parseTimeToMinutes(e.target.value) } })}
              />
            </label>
            <label>
              Until
              <input
                type="time"
                value={formatMinutes(lunch.default.end)}
                onChange={(e) => setLunch({ default: { ...lunch.default, end: parseTimeToMinutes(e.target.value) } })}
              />
            </label>
          </div>

          <div className="lunch-days">
            {TOGGLEABLE_DAYS.map((day) => (
              <LunchDayRow key={day} day={day} lunch={lunch} setLunch={setLunch} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
