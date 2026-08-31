import { useEffect, useState } from 'react';
import { DAY_LABELS } from '../../domain/format';
import { dayAffinity } from '../../domain/random';
import { useScheduler } from '../../state/schedulerStore';

/**
 * The seed and the Variety slider.
 *
 * The seed is shown rather than hidden on purpose. It is the only thing standing between this
 * student's week and the identical week the tool would otherwise hand the other four hundred
 * people taking the same first-semester subjects — and because it is just a string, two friends
 * can paste the same one and deliberately land in the same seminar group.
 */
export default function VarietyControls() {
  const { prefs, actions } = useScheduler();
  const [draft, setDraft] = useState(prefs.seed);
  const [copied, setCopied] = useState(false);

  // The box is a draft until it's committed, but a reroll (or a reset) changes the seed from
  // outside — so follow it whenever the real value moves on.
  useEffect(() => {
    setDraft(prefs.seed);
    setCopied(false);
  }, [prefs.seed]);

  const affinity = dayAffinity(prefs.seed);

  const commit = () => {
    if (draft.trim()) actions.setSeed(draft);
    else setDraft(prefs.seed); // emptied and clicked away: put the real one back
  };

  const copy = () => {
    navigator.clipboard?.writeText(prefs.seed).then(
      () => setCopied(true),
      () => setCopied(false), // denied clipboard permission: the seed is on screen to copy by hand
    );
  };

  return (
    <>
      <div className="pref-block">
        <div className="pref-block__label-row">
          <span className="pref-block__label">Variation seed</span>
          {copied && <span className="pref-block__value">copied</span>}
        </div>
        <div className="seed-row">
          <input
            type="text"
            className="seed-row__input"
            value={draft}
            spellCheck={false}
            autoComplete="off"
            aria-label="Variation seed"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(prefs.seed);
            }}
          />
          <button type="button" className="button button--ghost" onClick={copy}>
            Copy
          </button>
          <button type="button" className="button button--ghost" onClick={actions.rerollSeed}>
            Reroll
          </button>
        </div>
        <p className="pref-block__hint">
          Yours alone, and it never changes on its own &mdash; the same seed and the same
          preferences always give you the same week. It decides which of the equally good options
          you get, so you aren&rsquo;t handed the same group as everyone else on your year. Paste a
          friend&rsquo;s to land in their group on purpose.
        </p>
      </div>

      <div className="pref-block">
        <div className="pref-block__label-row">
          <span className="pref-block__label">Variety</span>
          <span className="pref-block__value">
            {prefs.variety === 0 ? 'Off' : `${Math.round(prefs.variety * 100)}%`}
          </span>
        </div>
        <div className="pref-slider">
          <span className="pref-slider__end">Best possible</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.variety}
            onChange={(e) => actions.setPrefs({ variety: Number(e.target.value) })}
          />
          <span className="pref-slider__end">Stand out</span>
        </div>
        <p className="pref-block__hint">
          {prefs.variety === 0
            ? 'Off: you get the best-scoring week, which is what most of your year will also be getting. Raise this to trade a few points for a week that leans a different way.'
            : `Will accept up to ${Math.round(
                prefs.variety * prefs.tuning.varietyToleranceMax,
              )} points worse than your best week in exchange for one that leans ${
                DAY_LABELS[affinity.order[0]!]
              }. It can never accept a collision or a dropped lecture.`}
        </p>
        {prefs.variety > 0 && (
          <p className="pref-block__hint">
            Your seed leans: {affinity.order.map((day) => DAY_LABELS[day]).join(' › ')}
          </p>
        )}
      </div>
    </>
  );
}
