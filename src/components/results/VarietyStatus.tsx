import { DAY_LABELS } from '../../domain/format';
import type { SolveResult } from '../../domain/solver';
import { interchangeableFor } from '../../domain/variety';
import type { Prefs } from '../../domain/types';

interface VarietyStatusProps {
  result: SolveResult;
  prefs: Prefs;
  selectedIndex: number;
}

/** Lists a few subject codes without letting a busy timetable run off the line. */
function summarize(codes: string[], limit = 5): string {
  if (codes.length <= limit) return codes.join(', ');
  return `${codes.slice(0, limit).join(', ')} and ${codes.length - limit} more`;
}

/**
 * What variation actually did for this student, in a line each.
 *
 * Both halves matter. The price has to be visible, or the feature is quietly making people's
 * schedules worse on their behalf. And the *headroom* has to be visible, or a student whose
 * subjects each run a single seminar group will read "nothing changed" as a broken feature
 * rather than as a timetable with nothing to spread across.
 */
export default function VarietyStatus({ result, prefs, selectedIndex }: VarietyStatusProps) {
  const { variety, solutions } = result;

  // Only the sets that actually shaped the week on screen: a collapsed set whose representative
  // was dropped by forward checking, or simply not the value chosen, is not this student's.
  const interchangeable = interchangeableFor(result.interchangeable, solutions[selectedIndex]);

  // One subject can contribute several sets — a lab running eleven pairs of same-hour groups is
  // eleven free choices within one subject, not eleven subjects.
  const subjects = [...new Set(interchangeable.map((group) => group.subjectCode))];
  const spare = interchangeable.reduce((n, group) => n + group.memberIds.length - 1, 0);
  const elsewhere = selectedIndex !== variety.index ? <> You&rsquo;re looking at #{selectedIndex + 1} instead.</> : null;

  return (
    <div className="variety-status">
      {prefs.variety > 0 && solutions.length > 0 && (
        <p className="variety-status__line">
          <span className="variety-status__badge">Your seed picked #{variety.index + 1}</span>
          {variety.cost > 0 ? (
            <>
              {' '}
              &mdash; {Math.round(variety.cost)} points worse than the tightest week, in exchange for one
              that leans {DAY_LABELS[variety.affinity.order[0]!]}.{elsewhere}
            </>
          ) : variety.index > 0 ? (
            <>
              {' '}
              &mdash; a different week from the top of the list at no cost at all: they score exactly the
              same.{elsewhere}
            </>
          ) : variety.bandSize > 1 ? (
            <>
              {' '}
              &mdash; your seed leans {DAY_LABELS[variety.affinity.order[0]!]}, and the best week already
              does too, so there was nothing worth trading for.{elsewhere}
            </>
          ) : (
            <>
              {' '}
              &mdash; nothing else came within {Math.round(variety.tolerance)} points of it, so there was
              nothing to trade for. Raise Variety to widen the search.{elsewhere}
            </>
          )}
        </p>
      )}

      {interchangeable.length > 0 ? (
        <p className="variety-status__line variety-status__line--muted">
          {summarize(subjects)} {subjects.length === 1 ? 'puts' : 'put'} groups on your week at an hour
          where {interchangeable.length === 1 ? 'another group meets' : 'other groups meet'} too &mdash;{' '}
          {spare} other {spare === 1 ? 'group' : 'groups'} across{' '}
          {interchangeable.length} {interchangeable.length === 1 ? 'slot' : 'slots'} would have done just
          as well. Your seed chose between them for free, instead of sending your whole year to the
          lowest-numbered one.
        </p>
      ) : (
        <p className="variety-status__line variety-status__line--muted">
          None of your subjects run parallel groups at identical times, so there was no free variation to
          be had &mdash; every group here differs in when it actually meets.
        </p>
      )}
    </div>
  );
}
