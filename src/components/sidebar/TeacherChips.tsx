import { useMemo } from 'react';
import type { CourseEvent, Teacher } from '../../domain/types';
import { useScheduler } from '../../state/schedulerStore';

interface TeacherChipsProps {
  subjectCode: string;
  seminars: CourseEvent[];
}

/** Bulk-select a subject's seminar groups by teacher: "I only want Mr. X's seminars". */
export default function TeacherChips({ subjectCode, seminars }: TeacherChipsProps) {
  const { actions } = useScheduler();

  const teachers = useMemo(() => {
    const byId = new Map<string, Teacher>();
    for (const seminar of seminars) for (const teacher of seminar.teachers) byId.set(teacher.id, teacher);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [seminars]);

  if (teachers.length < 2) return null; // nothing to narrow between

  return (
    <div className="teacher-chips">
      {teachers.map((teacher) => (
        <button
          key={teacher.id}
          type="button"
          className="chip"
          onClick={() => actions.selectTeacherGroups(subjectCode, teacher.id)}
          title={`Only keep ${teacher.name}'s groups`}
        >
          {teacher.name}
        </button>
      ))}
      <button
        type="button"
        className="chip chip--ghost"
        onClick={() => actions.enableAllSeminars(subjectCode)}
        title="Re-enable every group"
      >
        All
      </button>
    </div>
  );
}
