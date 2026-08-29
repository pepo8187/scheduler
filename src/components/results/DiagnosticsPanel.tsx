import type { DayOffAnalysis, LectureConflict, LunchAnalysis } from '../../domain/analysis';
import { DAY_LABELS } from '../../domain/format';
import type { Day, Solution } from '../../domain/types';

interface DiagnosticsPanelProps {
  solution: Solution | null;
  lectureConflicts: LectureConflict[];
  dayOffAnalysis: Record<Day, DayOffAnalysis> | null;
  daysOff: Day[];
  lunchAnalysis: LunchAnalysis | null;
}

export default function DiagnosticsPanel({ solution, lectureConflicts, dayOffAnalysis, daysOff, lunchAnalysis }: DiagnosticsPanelProps) {
  const collisions = solution?.overlaps.filter((o) => o.kind === 'seminar') ?? [];
  const droppedIds = solution ? [...solution.assignment.droppedLectures] : [];
  const blockedDays = dayOffAnalysis ? Object.values(dayOffAnalysis).filter((a) => a.blockers.length > 0) : [];
  const tradeOffs = dayOffAnalysis
    ? daysOff.flatMap((day) => (dayOffAnalysis[day]?.deadSubjects ?? []).map((d) => ({ day, ...d })))
    : [];
  const lunchLectureOverlaps = lunchAnalysis?.lectureOverlaps ?? [];
  const lunchTradeOffs = lunchAnalysis?.deadSubjects ?? [];

  const clean =
    collisions.length === 0 &&
    droppedIds.length === 0 &&
    blockedDays.length === 0 &&
    tradeOffs.length === 0 &&
    lectureConflicts.length === 0 &&
    lunchLectureOverlaps.length === 0 &&
    lunchTradeOffs.length === 0;

  if (clean) {
    return <p className="diagnostics-panel diagnostics-panel--clean">No collisions, drops, or trade-offs — this schedule is clean.</p>;
  }

  return (
    <div className="diagnostics-panel">
      {collisions.length > 0 && (
        <div className="diagnostics-panel__section diagnostics-panel__section--warn">
          <h4>Remaining seminar collisions</h4>
          <ul>
            {collisions.map((overlap, i) => (
              <li key={i}>
                {overlap.a.id} overlaps {overlap.b.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      {droppedIds.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Dropped lectures</h4>
          <ul>
            {droppedIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </div>
      )}

      {lectureConflicts.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Lecture ↔ lecture overlaps</h4>
          <ul>
            {lectureConflicts.map((conflict, i) => (
              <li key={i}>
                {DAY_LABELS[conflict.day]}: {conflict.a.id} / {conflict.b.id} (fixed, no action needed)
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockedDays.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Blocked day-off toggles</h4>
          <ul>
            {blockedDays.map((analysis) => (
              <li key={analysis.day}>
                {DAY_LABELS[analysis.day]}: blocked by {analysis.blockers.map((b) => b.subject.code).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tradeOffs.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Trade-offs</h4>
          <ul>
            {tradeOffs.map((tradeOff) => (
              <li key={`${tradeOff.day}-${tradeOff.subject.code}`}>
                {DAY_LABELS[tradeOff.day]}: {tradeOff.subject.name} — {tradeOff.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {lunchLectureOverlaps.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Lunch overlaps a fixed lecture</h4>
          <ul>
            {lunchLectureOverlaps.map((o) => (
              <li key={o.lecture.id}>
                {DAY_LABELS[o.day]}: {o.subject.code} {o.subject.name} (lecture, fixed — no action needed)
              </li>
            ))}
          </ul>
        </div>
      )}

      {lunchTradeOffs.length > 0 && (
        <div className="diagnostics-panel__section">
          <h4>Lunch trade-offs</h4>
          <ul>
            {lunchTradeOffs.map((tradeOff) => (
              <li key={tradeOff.subject.code}>
                {tradeOff.subject.name} — {tradeOff.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
