import { describeShapeDays, describeShapeLoad } from '../../domain/shape';
import type { Solution } from '../../domain/types';

interface AlternativesBarProps {
  solutions: Solution[];
  provenOptimal: boolean;
  selectedIndex: number;
  /** Which rung this student's seed put forward. Marked, never reordered — see below. */
  varietyIndex: number;
  onSelect: (index: number) => void;
}

/**
 * The strip stays a truthful ladder: sorted by real score, cheapest first, always. Variation
 * marks a rung rather than reordering them, so a student can see exactly what their seed cost
 * them and click straight back to the strict optimum.
 *
 * Each rung also says which days it uses. Rank and score alone made the strip unreadable once
 * the solver started keeping equal-scoring weeks apart: ten rungs marked "#n / 55" invite a
 * click-through-all-ten, and nine of them are usually the same Monday and Tuesday of fixed
 * lectures with one seminar moved. The day line is the shape the strip is now deduped by
 * (`domain/shape.ts`), so it is exactly the thing that differs between rungs.
 */
export default function AlternativesBar({
  solutions,
  provenOptimal,
  selectedIndex,
  varietyIndex,
  onSelect,
}: AlternativesBarProps) {
  if (solutions.length === 0) return null;

  return (
    <div className="alternatives-bar">
      {solutions.map((solution, index) => (
        <button
          key={index}
          type="button"
          className={`alternatives-bar__item${index === selectedIndex ? ' alternatives-bar__item--active' : ''}${
            index === varietyIndex ? ' alternatives-bar__item--pick' : ''
          }`}
          onClick={() => onSelect(index)}
          title={`${describeShapeLoad(solution.events) || 'nothing scheduled'}${
            index === varietyIndex ? ' — your seed picked this one' : ''
          }`}
        >
          <span className="alternatives-bar__rank">
            #{index + 1}
            {index === varietyIndex && <span className="alternatives-bar__pick-dot" aria-hidden="true" />}
          </span>
          <span className="alternatives-bar__score">{Math.round(solution.score.total)}</span>
          <span className="alternatives-bar__shape">{describeShapeDays(solution.events) || '—'}</span>
        </button>
      ))}
      {!provenOptimal && <span className="alternatives-bar__note">best found — not proven optimal</span>}
    </div>
  );
}
