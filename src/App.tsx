import { useEffect, useState } from 'react';
import FileDrop from './components/FileDrop';
import PreferencePanel from './components/prefs/PreferencePanel';
import WeekGrid from './components/grid/WeekGrid';
import AlternativesBar from './components/results/AlternativesBar';
import DiagnosticsPanel from './components/results/DiagnosticsPanel';
import GapExplainer from './components/results/GapExplainer';
import ScoreBreakdown from './components/results/ScoreBreakdown';
import SubjectList from './components/sidebar/SubjectList';
import ThemeToggle from './components/ThemeToggle';
import { useScheduler } from './state/schedulerStore';

export default function App() {
  const { timetable, selection, prefs, dayOffAnalysis, lectureConflicts, solveResult } = useScheduler();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0); // a fresh solve invalidates any previously-selected rank
  }, [solveResult]);

  const solutions = solveResult?.solutions ?? [];
  const solution = solutions[selectedIndex] ?? solutions[0] ?? null;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <h1 className="app__title">Schedule Optimizer</h1>
          <p className="app__subtitle">Pick the seminar groups that fit your week</p>
        </div>
        <ThemeToggle />
      </header>

      <div className="app__body">
        <aside className="app__sidebar panel">
          <h2 className="panel__title">Subjects</h2>
          <FileDrop />
          <SubjectList />
        </aside>

        <main className="app__main">
          <section className="panel">
            <h2 className="panel__title">Preferences</h2>
            {timetable ? (
              <PreferencePanel />
            ) : (
              <p className="placeholder">Days off, cram vs. spread, gaps, day window and teacher filters.</p>
            )}
          </section>

          {timetable && solveResult && (
            <section className="panel">
              <h2 className="panel__title">Alternatives</h2>
              <AlternativesBar
                solutions={solutions}
                provenOptimal={solveResult.provenOptimal}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />
              {solution && <ScoreBreakdown score={solution.score} />}
              <DiagnosticsPanel
                solution={solution}
                lectureConflicts={lectureConflicts}
                dayOffAnalysis={dayOffAnalysis}
                daysOff={prefs.daysOff}
              />
            </section>
          )}

          <section className="panel panel--grow">
            <h2 className="panel__title">Week</h2>
            {timetable ? (
              <WeekGrid timetable={timetable} selection={selection} solution={solution} />
            ) : (
              <p className="placeholder">The week grid renders here.</p>
            )}
          </section>

          <GapExplainer />
        </main>
      </div>
    </div>
  );
}
