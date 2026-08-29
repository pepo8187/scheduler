import { formatMinutes } from '../../domain/format';
import type { HourRulerEntry } from '../../domain/types';

interface HourRulerProps {
  minHour: number;
  maxHour: number;
  hours: HourRulerEntry[];
}

export default function HourRuler({ minHour, maxHour, hours }: HourRulerProps) {
  const total = maxHour - minHour;

  return (
    <div className="hour-ruler">
      <div className="hour-ruler__gutter" aria-hidden="true" />
      <div className="hour-ruler__track">
        {hours.map((hour) => (
          <span
            key={hour.start}
            className="hour-ruler__label"
            style={{ left: `${((hour.start - minHour) / total) * 100}%` }}
          >
            {formatMinutes(hour.start)}
          </span>
        ))}
      </div>
    </div>
  );
}
