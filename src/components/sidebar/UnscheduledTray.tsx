import { useScheduler } from '../../state/schedulerStore';

/** `<nezname>` courses: no scheduled time (state exams, thesis defence). Listed, never placed on the grid. */
export default function UnscheduledTray() {
  const { timetable } = useScheduler();
  if (!timetable || timetable.unscheduled.length === 0) return null;

  return (
    <div className="unscheduled-tray">
      <h3 className="unscheduled-tray__title">Not scheduled</h3>
      <ul className="unscheduled-tray__list">
        {timetable.unscheduled.map((course) => (
          <li key={course.code} className="unscheduled-tray__item">
            <span className="unscheduled-tray__code">{course.code}</span>
            <span className="unscheduled-tray__name">{course.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
