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
          title={index === varietyIndex ? 'Your seed picked this one' : undefined}
        >
          <span className="alternatives-bar__rank">
            #{index + 1}
            {index === varietyIndex && <span className="alternatives-bar__pick-dot" aria-hidden="true" />}
          </span>
          <span className="alternatives-bar__score">{Math.round(solution.score.total)}</span>
        </button>
      ))}
      {!provenOptimal && <span className="alternatives-bar__note">best found — not proven optimal</span>}
    </div>
  );
}
