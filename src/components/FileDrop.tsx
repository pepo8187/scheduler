import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useScheduler } from '../state/schedulerStore';

// Resolved against the deployment base rather than the domain root, so the examples still
// load when the app is served from a subdirectory (see docs/DEPLOY.md).
const EXAMPLES = [
  { label: 'Load podzim23', fileName: 'podzim23-timetable.xml' },
  { label: 'Load podzim22', fileName: 'podzim22-timetable.xml' },
] as const;

export default function FileDrop() {
  const { timetable, fileName, actions } = useScheduler();
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        actions.loadTimetable(text, file.name);
        setError(null);
      } catch {
        setError(`Could not read ${file.name} as a timetable export.`);
      }
    },
    [actions],
  );

  const loadExample = useCallback(
    async (fileName: string) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}${fileName}`);
        const text = await response.text();
        actions.loadTimetable(text, fileName);
        setError(null);
      } catch {
        setError(`Could not load the bundled example ${fileName}.`);
      }
    },
    [actions],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) void loadFile(file);
    },
    [loadFile],
  );

  return (
    <div className="file-drop">
      <div
        className={`file-drop__zone${dragOver ? ' file-drop__zone--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = '';
          }}
        />
        <p className="file-drop__hint">Drop a MUNI IS timetable export here, or click to choose a file</p>
      </div>

      <div className="file-drop__examples">
        {EXAMPLES.map(({ label, fileName }) => (
          <button
            key={fileName}
            type="button"
            className="button button--secondary"
            onClick={() => void loadExample(fileName)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="file-drop__error">{error}</p>}

      {timetable && (
        <p className="file-drop__loaded">
          Loaded {fileName ?? 'timetable'} — {timetable.subjects.length} subject
          {timetable.subjects.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
