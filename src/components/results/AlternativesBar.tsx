import type { Solution } from '../../domain/types';

interface AlternativesBarProps {
  solutions: Solution[];
  provenOptimal: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export default function AlternativesBar({ solutions, provenOptimal, selectedIndex, onSelect }: AlternativesBarProps) {
  if (solutions.length === 0) return null;

  return (
    <div className="alternatives-bar">
      {solutions.map((solution, index) => (
        <button
          key={index}
          type="button"
          className={`alternatives-bar__item${index === selectedIndex ? ' alternatives-bar__item--active' : ''}`}
          onClick={() => onSelect(index)}
        >
          <span className="alternatives-bar__rank">#{index + 1}</span>
          <span className="alternatives-bar__score">{Math.round(solution.score.total)}</span>
        </button>
      ))}
      {!provenOptimal && <span className="alternatives-bar__note">best found — not proven optimal</span>}
    </div>
  );
}
