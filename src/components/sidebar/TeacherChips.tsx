import { useMemo } from 'react';
import type { CourseEvent, Teacher } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';

interface TeacherChipsProps {
  subjectCode: string;
  seminars: CourseEvent[];
}

/** Multi-select a subject's seminar groups by teacher: pick any combination of teachers,
 *  e.g. "I want Ms. Y's and Mr. Z's groups, but not Mr. X's". */
export default function TeacherChips({ subjectCode, seminars }: TeacherChipsProps) {
  const { selection, actions } = useScheduler();
  const subjectSelection = selection[subjectCode];

  const teachers = useMemo(() => {
    const byId = new Map<string, Teacher>();
    for (const seminar of seminars) for (const teacher of seminar.teachers) byId.set(teacher.id, teacher);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [seminars]);

  if (teachers.length < 2) return null; // nothing to narrow between

  return (
    <div className="teacher-chips">
      {teachers.map((teacher) => {
        const teacherSeminarIds = seminars
          .filter((s) => s.teachers.some((t) => t.id === teacher.id))
          .map((s) => s.id);
        const enabledCount = teacherSeminarIds.filter((id) => subjectSelection?.seminars[id]).length;
        const active = enabledCount === teacherSeminarIds.length;
        const partial = enabledCount > 0 && !active;

        return (
          <button
            key={teacher.id}
            type="button"
            className={`chip${active ? ' chip--active' : ''}${partial ? ' chip--partial' : ''}`}
            aria-pressed={active}
            onClick={() => actions.toggleTeacherGroups(subjectCode, teacher.id)}
            title={active ? `Hide ${teacher.name}'s groups` : `Include ${teacher.name}'s groups`}
          >
            {teacher.name}
          </button>
        );
      })}
    </div>
  );
}
