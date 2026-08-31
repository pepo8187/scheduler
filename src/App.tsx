import { useEffect, useState } from 'react';
import FileDrop from './components/FileDrop';
import PreferencePanel from './components/prefs/PreferencePanel';
import WeekGrid from './components/grid/WeekGrid';
import AlternativesBar from './components/results/AlternativesBar';
import DiagnosticsPanel from './components/results/DiagnosticsPanel';
import AdvancedPanel from './components/prefs/AdvancedPanel';
import GapExplainer from './components/results/GapExplainer';
import ScoreBreakdown from './components/results/ScoreBreakdown';
import VarietyExplainer from './components/results/VarietyExplainer';
import VarietyStatus from './components/results/VarietyStatus';
import SubjectList from './components/sidebar/SubjectList';
import ThemeToggle from './components/ThemeToggle';
import { useScheduler } from './state/schedulerStore';

export default function App() {
  const {
    timetable,
    selection,
    prefs,
    dayOffAnalysis,
    lectureConflicts,
    lunchAnalysis,
    solveResult,
    isSolving,
    actions,
  } = useScheduler();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    // A fresh solve invalidates any previously-selected rank. Land on the rung this student's
    // seed put forward, which is #1 unless Variety is on.
    setSelectedIndex(solveResult?.variety.index ?? 0);
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
          <div className="panel__header">
            <h2 className="panel__title">Subjects</h2>
          </div>
          <FileDrop />
          <SubjectList />
        </aside>

        <main className="app__main">
          <section className="panel">
            <div className="panel__header">
              <h2 className="panel__title">Preferences</h2>
              {timetable && (
                <button type="button" className="button button--ghost" onClick={actions.resetPrefs}>
                  Reset preferences
                </button>
              )}
            </div>
            {timetable ? (
              <PreferencePanel />
            ) : (
              <p className="placeholder">Days off, cram vs. spread, gaps, day window and teacher filters.</p>
            )}
          </section>

          {timetable && solveResult && (
            <section className="panel">
              <h2 className="panel__title">Alternatives{isSolving && <span className="panel__title-hint"> · optimizing…</span>}</h2>
              <AlternativesBar
                solutions={solutions}
                provenOptimal={solveResult.provenOptimal}
                selectedIndex={selectedIndex}
                varietyIndex={solveResult.variety.index}
                onSelect={setSelectedIndex}
              />
              <VarietyStatus result={solveResult} prefs={prefs} selectedIndex={selectedIndex} />
              {solution && <ScoreBreakdown score={solution.score} />}
              <DiagnosticsPanel
                solution={solution}
                lectureConflicts={lectureConflicts}
                dayOffAnalysis={dayOffAnalysis}
                daysOff={prefs.daysOff}
                lunchAnalysis={lunchAnalysis}
              />
            </section>
          )}

          <section className="panel panel--grow">
            <h2 className="panel__title">Week</h2>
            {timetable ? (
              <WeekGrid timetable={timetable} selection={selection} prefs={prefs} solution={solution} />
            ) : (
              <p className="placeholder">The week grid renders here.</p>
            )}
          </section>

          <GapExplainer />

          <VarietyExplainer />

          <AdvancedPanel />
        </main>
      </div>
    </div>
  );
}
