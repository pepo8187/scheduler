import { PRESETS } from '../../domain/presets';
import { useScheduler } from '../../state/schedulerStore';

export default function PresetBar() {
  const { actions } = useScheduler();

  return (
    <div className="preset-bar">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="button button--pill"
          onClick={() => actions.applyPreset(preset.id)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
