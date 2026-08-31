import { useMemo } from 'react';
import { DAY_LABELS } from '../../domain/format';
import { dayAffinity, newSeed, pickFrom, rngFor } from '../../domain/random';
import type { InterchangeableGroup } from '../../domain/solver';
import { interchangeableFor } from '../../domain/variety';
import { useScheduler } from '../../state/schedulerStore';
import type { Day } from '../../domain/types';

/** The cohort the faculty actually described: one first-semester year, same subjects. */
const COHORT = 400;

/**
 * Stands in when nothing is loaded yet, or when the loaded timetable has no interchangeable
 * groups to illustrate with. Labelled as an example wherever it's used — a chart of made-up
 * data passed off as the user's own would be worse than no chart.
 */
const EXAMPLE: InterchangeableGroup = {
  subjectCode: 'PB001',
  signature: 'St:600-710',
  representativeId: 'PB001/01',
  memberIds: Array.from({ length: 8 }, (_, i) => `PB001/${String(i + 1).padStart(2, '0')}`),
};

/** One deterministic synthetic cohort, so the charts don't reshuffle on every render. */
function cohortSeeds(): string[] {
  const random = rngFor('explainer', 'cohort');
  return Array.from({ length: COHORT }, () => newSeed(random));
}

interface Bar {
  label: string;
  count: number;
  /** Marks the bar the old lowest-group-number rule would have put everybody on. */
  wasEverybody?: boolean;
}

function BarChart({ bars, caption }: { bars: Bar[]; caption: string }) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <figure className="vbars">
      <figcaption className="vbars__caption">{caption}</figcaption>
      {bars.map((bar) => {
        const share = Math.round((bar.count / COHORT) * 100);
        return (
          <div key={bar.label} className="vbars__row" title={`${bar.label}: ${bar.count} of ${COHORT} students`}>
            <span className="vbars__label">{bar.label}</span>
            <span className="vbars__track">
              <span
                className={`vbars__fill${bar.wasEverybody ? ' vbars__fill--was' : ''}`}
                style={{ width: `${(bar.count / max) * 100}%` }}
              />
            </span>
            <span className="vbars__value">{share}%</span>
          </div>
        );
      })}
    </figure>
  );
}

/**
 * Why a whole year no longer receives one identical schedule — demonstrated rather than
 * asserted. Both charts run a synthetic cohort of 400 seeds through the *same* functions the
 * solver uses (`pickFrom`, `dayAffinity`), so what they show is what the app really does, not
 * an illustration of what it's supposed to do.
 */
export default function VarietyExplainer() {
  const { prefs, solveResult } = useScheduler();

  // The widest set of interchangeable groups that actually shaped this student's week — the
  // most illustrative one, and one they can check against their own grid.
  const real = useMemo(() => {
    const groups = interchangeableFor(solveResult?.interchangeable ?? [], solveResult?.solutions[solveResult.variety.index]);
    return groups.reduce<InterchangeableGroup | null>(
      (widest, g) => (!widest || g.memberIds.length > widest.memberIds.length ? g : widest),
      null,
    );
  }, [solveResult]);

  const shown = real ?? EXAMPLE;

  const groupBars = useMemo(() => {
    const counts = new Map<string, number>(shown.memberIds.map((id) => [id, 0]));
    for (const seed of cohortSeeds()) {
      const picked = pickFrom(shown.memberIds, seed, shown.subjectCode, shown.signature)!;
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    // The old rule kept the lowest id, so that one group absorbed the entire year.
    const lowest = [...shown.memberIds].sort((a, b) => a.localeCompare(b))[0];
    return shown.memberIds.map<Bar>((id) => ({ label: id, count: counts.get(id) ?? 0, wasEverybody: id === lowest }));
  }, [shown]);

  const dayBars = useMemo(() => {
    const counts = new Map<Day, number>();
    for (const seed of cohortSeeds()) {
      const top = dayAffinity(seed).order[0]!;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map<Bar>(([day, count]) => ({ label: DAY_LABELS[day], count }));
  }, []);

  const spare = shown.memberIds.length;
  const affinity = dayAffinity(prefs.seed);

  return (
    <section className="panel gap-explainer">
      <h2 className="panel__title">Why you aren&rsquo;t handed everyone else&rsquo;s schedule</h2>

      <p className="gap-explainer__copy">
        Up to four hundred people in a first semester take the exact same subjects. Feed the same
        export into an optimiser with the same preferences and it will, quite correctly, compute
        the same best answer for all of them &mdash; and then four hundred people go and register
        for the same seminar group. The optimiser isn&rsquo;t wrong; it just has no reason to
        prefer one equally good answer over another, so it always picks the same one. Your{' '}
        <strong>seed</strong> gives it a reason.
      </p>

      <h3 className="gap-explainer__subtitle">Free variation: it costs you nothing</h3>
      <p className="gap-explainer__copy">
        Faculties open parallel groups precisely to absorb a big year: the same lab, the same
        hour, several teaching assistants. Those groups are <strong>interchangeable by
        construction</strong> &mdash; the score never looks at who teaches one &mdash; so choosing
        between them is free. The old rule kept the lowest group number, which is how an entire
        year ended up in group 01. Drawing that choice from your seed costs exactly zero points.
      </p>

      <BarChart
        bars={groupBars}
        caption={
          real
            ? `Where ${COHORT} students with your subjects land across ${spare} groups of ${shown.subjectCode} meeting at the same hour`
            : `Example — where ${COHORT} students land across ${spare} parallel groups meeting at the same hour`
        }
      />
      <p className="gap-explainer__copy gap-explainer__copy--muted">
        The highlighted bar is the group the old rule sent <em>everyone</em> to: it would have
        been 100% and every other bar zero. {real ? '' : 'No subject in your timetable runs parallel groups at identical times, so this is a worked example rather than your own data. '}
        The same happens to score <em>ties</em> &mdash; two genuinely equal-cost weeks used to be
        separated by group number, which is not a preference at all. Your seed breaks those too,
        also for free. Both of these are always on.
      </p>

      <h3 className="gap-explainer__subtitle">Paid variation: the Monday lean</h3>
      <p className="gap-explainer__copy">
        Free variation can&rsquo;t fix everything, and it&rsquo;s worth being straight about why.
        Monday-heavy weeks aren&rsquo;t a tie &mdash; they genuinely <strong>score better</strong>
        , because the lectures are anchored there and piling seminars onto a day you&rsquo;re
        already on campus for beats opening a fresh one. No tie-break reaches that. Moving off it
        means accepting a slightly worse week, so the <strong>Variety</strong> slider is off until
        you turn it on, and the price is printed next to your schedule in points.
      </p>
      <p className="gap-explainer__copy">
        Jittering within that budget alone would be weak, because the whole near-optimal band can
        be Monday-heavy. So each seed also gets its own ranking of the weekdays, and among weeks
        that are near-equally good <em>for you</em>, it prefers the ones leaning your way. Yours
        runs <strong>{affinity.order.map((day) => DAY_LABELS[day]).join(' › ')}</strong>. Across a
        cohort those rankings are uniform, so the year spreads out while each person still gets a
        week as good as the best one available to them:
      </p>

      <BarChart bars={dayBars} caption={`The day ${COHORT} students' seeds each lean toward hardest`} />

      <h3 className="gap-explainer__subtitle">What this does not do</h3>
      <ul className="variety-limits">
        <li>
          <strong>It doesn&rsquo;t coordinate anybody.</strong> Nothing here talks to anyone
          else&rsquo;s copy of the app or to the registration system. Two students can still draw
          the same group. This stops the tool <em>amplifying</em> the pile-up; it does not
          allocate capacity, which would need a server that knows who has booked what.
        </li>
        <li>
          <strong>It can&rsquo;t spread what isn&rsquo;t there.</strong> A subject with one
          seminar group gives everyone that group, and no seed changes it. The line under your
          alternatives says how much room your particular timetable actually offered &mdash; so
          when nothing moves, you can see it&rsquo;s the timetable, not a broken feature.
        </li>
        <li>
          <strong>Registration order still decides reality.</strong> This proposes; the
          university&rsquo;s system allocates. What spreading proposals buys you is that the race
          starts from four hundred different opinions instead of one.
        </li>
      </ul>

      <p className="gap-explainer__copy gap-explainer__copy--muted">
        Your seed never changes on its own &mdash; not when you drag a slider, reset your
        preferences, or load next semester&rsquo;s export &mdash; because a schedule that
        reshuffled itself every time you touched something would be useless. Reroll it when you
        want a different draw, or paste a friend&rsquo;s to deliberately land where they land.
      </p>
    </section>
  );
}
