import { formatMinutes, parseTimeToMinutes } from '../../domain/format';
import { useScheduler } from '../../state/schedulerStore';
import DayOffToggles from './DayOffToggles';
import LunchBreak from './LunchBreak';
import PresetBar from './PresetBar';
import VarietyControls from './VarietyControls';

export default function PreferencePanel() {
  const { prefs, actions } = useScheduler();

  return (
    <div className="preference-panel">
      <PresetBar />

      <div className="pref-block">
        <span className="pref-block__label">Days off</span>
        <DayOffToggles />
      </div>

      <div className="pref-block">
        <div className="pref-block__label-row">
          <span className="pref-block__label">Compactness</span>
          <span className="pref-block__value">{prefs.compactness > 0 ? 'Cram' : prefs.compactness < 0 ? 'Spread' : 'Neutral'}</span>
        </div>
        <div className="pref-slider">
          <span className="pref-slider__end">Spread out</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.1}
            value={prefs.compactness}
            onChange={(e) => actions.setPrefs({ compactness: Number(e.target.value) })}
          />
          <span className="pref-slider__end">Cram together</span>
        </div>
      </div>

      <div className="pref-block">
        <div className="pref-block__label-row">
          <span className="pref-block__label">Gaps</span>
          <span className="pref-block__value">{Math.round(prefs.gaps * 100)}%</span>
        </div>
        <div className="pref-slider">
          <span className="pref-slider__end">Gaps are fine</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={prefs.gaps}
            onChange={(e) => actions.setPrefs({ gaps: Number(e.target.value) })}
          />
          <span className="pref-slider__end">No dead time</span>
        </div>
      </div>

      <div className="pref-block">
        <div className="pref-block__label-row">
          <span className="pref-block__label">Break shape</span>
          <span className="pref-block__value">
            {prefs.gapShape > 0.6 ? 'Several short' : prefs.gapShape < 0.4 ? 'One long' : 'Balanced'}
          </span>
        </div>
        <div className="pref-slider">
          <span className="pref-slider__end">One long break</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.gapShape}
            onChange={(e) => actions.setPrefs({ gapShape: Number(e.target.value) })}
            disabled={prefs.gaps === 0}
          />
          <span className="pref-slider__end">Several short breaks</span>
        </div>
        <p className="pref-block__hint">
          {prefs.gaps === 0
            ? 'No effect while dead time is scored at 0% — raise Gaps to use this.'
            : 'Given the same idle time, should it land in one block or be split into short breathers?'}
        </p>
      </div>

      <div className="pref-block">
        <span className="pref-block__label">Day window</span>
        <div className="pref-row">
          <label>
            From
            <input
              type="time"
              value={formatMinutes(prefs.dayWindow.start)}
              onChange={(e) => actions.setPrefs({ dayWindow: { ...prefs.dayWindow, start: parseTimeToMinutes(e.target.value) } })}
            />
          </label>
          <label>
            Until
            <input
              type="time"
              value={formatMinutes(prefs.dayWindow.end)}
              onChange={(e) => actions.setPrefs({ dayWindow: { ...prefs.dayWindow, end: parseTimeToMinutes(e.target.value) } })}
            />
          </label>
        </div>
      </div>

      <LunchBreak />

      <div className="pref-block">
        <label className="pref-row">
          <input
            type="checkbox"
            checked={prefs.maxClassesPerDay != null}
            onChange={(e) => actions.setPrefs({ maxClassesPerDay: e.target.checked ? 4 : null })}
          />
          <span className="pref-block__label">Max classes per day</span>
          {prefs.maxClassesPerDay != null && (
            <input
              type="number"
              min={1}
              max={10}
              value={prefs.maxClassesPerDay}
              onChange={(e) => actions.setPrefs({ maxClassesPerDay: Number(e.target.value) })}
            />
          )}
        </label>
      </div>

      <VarietyControls />
    </div>
  );
}
