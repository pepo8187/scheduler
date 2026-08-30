import { useMemo } from 'react';
import { isUnfiltered, seminarIdsForTeacher } from '../../domain/teacherFilter';
import type { CourseEvent, Teacher } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';

interface TeacherChipsProps {
  subjectCode: string;
  seminars: CourseEvent[];
}

/** Narrow a subject's seminar groups by teacher. The first click drops everyone else, then
 *  further clicks add teachers back on — so "I want Ms. Y's and Mr. Z's groups, but not Mr. X's"
 *  is two clicks rather than clicking away every teacher you don't want. */
export default function TeacherChips({ subjectCode, seminars }: TeacherChipsProps) {
  const { selection, actions } = useScheduler();
  const subjectSelection = selection[subjectCode];

  const teachers = useMemo(() => {
    const byId = new Map<string, Teacher>();
    for (const seminar of seminars) for (const teacher of seminar.teachers) byId.set(teacher.id, teacher);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [seminars]);

  if (teachers.length < 2) return null; // nothing to narrow between

  const enabled = subjectSelection?.seminars ?? {};
  // Nothing narrowed away yet, so the next click is the exclusive one.
  const pristine = isUnfiltered(seminars, enabled);

  return (
    <div className="teacher-chips">
      {teachers.map((teacher) => {
        const teacherSeminarIds = seminarIdsForTeacher(seminars, teacher.id);
        const enabledCount = teacherSeminarIds.filter((id) => enabled[id]).length;
        const active = enabledCount === teacherSeminarIds.length;
        const partial = enabledCount > 0 && !active;

        const title = pristine
          ? `Show only ${teacher.name}'s groups`
          : active
            ? `Hide ${teacher.name}'s groups`
            : `Also include ${teacher.name}'s groups`;

        return (
          <button
            key={teacher.id}
            type="button"
            className={`chip${active ? ' chip--active' : ''}${partial ? ' chip--partial' : ''}`}
            aria-pressed={active}
            onClick={() => actions.toggleTeacherGroups(subjectCode, teacher.id)}
            title={title}
          >
            {teacher.name}
          </button>
        );
      })}
    </div>
  );
}
