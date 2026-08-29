import { useScheduler } from '../../state/schedulerStore';
import SubjectCard from './SubjectCard';
import UnscheduledTray from './UnscheduledTray';

export default function SubjectList() {
  const { timetable } = useScheduler();

  if (!timetable) {
    return <p className="placeholder">Load a timetable export to list subjects, their lectures and every seminar group.</p>;
  }

  return (
    <div className="subject-list">
      {timetable.subjects.map((subject) => (
        <SubjectCard key={subject.code} subject={subject} />
      ))}
      <UnscheduledTray />
    </div>
  );
}
