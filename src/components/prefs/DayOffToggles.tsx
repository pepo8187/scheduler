import { TOGGLEABLE_DAYS } from '../../domain/analysis';
import { DAY_LABELS } from '../../domain/format';
import { useScheduler } from '../../state/schedulerStore';

export default function DayOffToggles() {
  const { prefs, dayOffAnalysis, actions } = useScheduler();

  return (
    <div className="day-off-toggles">
      {TOGGLEABLE_DAYS.map((day) => {
        const analysis = dayOffAnalysis?.[day];
        const blocked = (analysis?.blockers.length ?? 0) > 0;
        const isOff = prefs.daysOff.includes(day);
        const tradeOffs = analysis?.deadSubjects ?? [];
        const dropped = analysis?.droppedLectures ?? [];

        return (
          <div key={day} className="day-off-toggle">
            <button
              type="button"
              className={[
                'day-off-toggle__pill',
                isOff && 'day-off-toggle__pill--off',
                blocked && 'day-off-toggle__pill--blocked',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => !blocked && actions.toggleDayOff(day)}
              disabled={blocked}
              title={blocked ? `${DAY_LABELS[day]} is blocked by a required lecture` : `Toggle ${DAY_LABELS[day]} off`}
            >
              {day}
            </button>

            {blocked &&
              analysis!.blockers.map((blocker) => (
                <div key={blocker.lecture.id} className="day-off-note day-off-note--blocked">
                  <p>
                    {DAY_LABELS[day]} is blocked by {blocker.subject.code} {blocker.subject.name} (lecture, fixed)
                  </p>
                  <div className="day-off-note__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => actions.toggleLectureRequired(blocker.subject.code, blocker.lecture.id)}
                    >
                      Clear its priority
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => actions.toggleSubject(blocker.subject.code)}
                    >
                      Exclude subject
                    </button>
                  </div>
                </div>
              ))}

            {!blocked && isOff && dropped.length > 0 && (
              <div className="day-off-note">
                {dropped.map((note) => (
                  <p key={note.lecture.id}>
                    {DAY_LABELS[day]} off: dropping {note.subject.code} lecture
                  </p>
                ))}
              </div>
            )}

            {!blocked &&
              isOff &&
              tradeOffs.map((tradeOff) => (
                <div key={tradeOff.subject.code} className="day-off-note day-off-note--tradeoff">
                  <p>
                    {DAY_LABELS[day]} off leaves {tradeOff.subject.name} with no usable seminar ({tradeOff.reason})
                  </p>
                  <div className="day-off-note__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => actions.disableAllSeminars(tradeOff.subject.code)}
                    >
                      Accept lecture-only
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => actions.toggleSubject(tradeOff.subject.code)}
                    >
                      Exclude subject
                    </button>
                    <button type="button" className="button button--ghost" onClick={() => actions.toggleDayOff(day)}>
                      Keep {day}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
