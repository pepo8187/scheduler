import type { Score } from '../../domain/types';

export default function ScoreBreakdown({ score }: { score: Score }) {
  return (
    <div className="score-breakdown">
      <div className="score-breakdown__total">Total penalty: {Math.round(score.total)}</div>
      <ul className="score-breakdown__terms">
        {score.terms.map((term) => (
          <li key={term.key} className={`score-term${term.cost > 0 ? ' score-term--active' : ''}`}>
            <span className="score-term__label">{term.label}</span>
            <span className="score-term__detail">{term.detail}</span>
            <span className="score-term__cost">{Math.round(term.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
