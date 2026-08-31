import { useState } from 'react';
import { describeSlots, describeTeachers } from '../../domain/format';
import { isAllCleared, isUnfiltered } from '../../domain/teacherFilter';
import type { Subject } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';
import TeacherChips from './TeacherChips';

interface SubjectCardProps {
  subject: Subject;
}

export default function SubjectCard({ subject }: SubjectCardProps) {
  const { selection, actions } = useScheduler();
  const [expanded, setExpanded] = useState(true);
  const subjectSelection = selection[subject.code];
  if (!subjectSelection) return null;

  return (
    <div className={`subject-card${subjectSelection.enabled ? '' : ' subject-card--disabled'}`}>
      <div className="subject-card__header">
        <label className="subject-card__toggle">
          <input
            type="checkbox"
            checked={subjectSelection.enabled}
            onChange={() => actions.toggleSubject(subject.code)}
          />
          <span className="subject-card__code">{subject.code}</span>
          <span className="subject-card__name">{subject.name}</span>
        </label>
        <button
          type="button"
          className="subject-card__collapse"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      {expanded && subjectSelection.enabled && (
        <div className="subject-card__body">
          {subject.lectures.map((lecture) => {
            const lectureSelection = subjectSelection.lectures[lecture.id];
            if (!lectureSelection) return null;
            return (
              <div key={lecture.id} className="event-row event-row--lecture">
                <label className="event-row__checkbox">
                  <input
                    type="checkbox"
                    checked={lectureSelection.enabled}
                    onChange={() => actions.toggleLecture(subject.code, lecture.id)}
                  />
                  <span className="event-row__badge">Lecture</span>
                </label>
                <div className="event-row__detail">
                  <span className="event-row__time">{describeSlots(lecture)}</span>
                  <span className="event-row__teacher">{describeTeachers(lecture)}</span>
                </div>
                <button
                  type="button"
                  className={`priority-star${lectureSelection.required ? ' priority-star--on' : ''}`}
                  onClick={() => actions.toggleLectureRequired(subject.code, lecture.id)}
                  disabled={!lectureSelection.enabled}
                  title={lectureSelection.required ? 'Required: pins its day' : 'Mark as required (★)'}
                >
                  ★
                </button>
              </div>
            );
          })}

          {subject.seminars.length > 0 && (
            <div className="subject-card__seminar-tools">
              <TeacherChips subjectCode={subject.code} seminars={subject.seminars} />
              <div className="subject-card__reset">
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => actions.disableAllSeminars(subject.code)}
                  disabled={isAllCleared(subject.seminars, subjectSelection.seminars)}
                  title={`Deselect every ${subject.code} seminar group`}
                >
                  Deselect groups
                </button>
                <button
                  type="button"
                  className="button button--ghost button--tiny"
                  onClick={() => actions.enableAllSeminars(subject.code)}
                  disabled={isUnfiltered(subject.seminars, subjectSelection.seminars)}
                  title={`Re-enable every ${subject.code} seminar group`}
                >
                  Reset groups
                </button>
              </div>
            </div>
          )}

          {subject.seminars.map((seminar) => (
            <div key={seminar.id} className="event-row event-row--seminar">
              <label className="event-row__checkbox">
                <input
                  type="checkbox"
                  checked={subjectSelection.seminars[seminar.id] ?? false}
                  onChange={() => actions.toggleSeminar(subject.code, seminar.id)}
                />
                <span className="event-row__badge event-row__badge--seminar">{seminar.group}</span>
              </label>
              <div className="event-row__detail">
                <span className="event-row__time">{describeSlots(seminar)}</span>
                <span className="event-row__teacher">{describeTeachers(seminar)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
