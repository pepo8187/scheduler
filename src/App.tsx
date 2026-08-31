import { useEffect, useMemo, useState } from 'react';
import FileDrop from './components/FileDrop';
import PreferencePanel from './components/prefs/PreferencePanel';
import WeekGrid from './components/grid/WeekGrid';
import AlternativesBar from './components/results/AlternativesBar';
import DiagnosticsPanel from './components/results/DiagnosticsPanel';
import AdvancedPanel from './components/prefs/AdvancedPanel';
import GapExplainer from './components/results/GapExplainer';
import PinStatus from './components/results/PinStatus';
import ScoreBreakdown from './components/results/ScoreBreakdown';
import ShapeVariants from './components/results/ShapeVariants';
import SolvePerf from './components/results/SolvePerf';
import VarietyExplainer from './components/results/VarietyExplainer';
import VarietyStatus from './components/results/VarietyStatus';
import SubjectList from './components/sidebar/SubjectList';
import ThemeToggle from './components/ThemeToggle';
import { pinRelief, switchCosts, type SwitchCost } from './domain/switching';
import { useScheduler } from './state/schedulerStore';

export default function App() {
  const {
    timetable,
    selection,
    prefs,
    dayOffAnalysis,
    lectureConflicts,
    lunchAnalysis,
    pinConflicts,
    solveResult,
    isSolving,
    solveStartedAt,
    solveProgress,
    actions,
  } = useScheduler();
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** Which of the current rung's other labellings is on the grid; null is the rung itself. */
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);

  useEffect(() => {
    // A fresh solve invalidates any previously-selected rank. Land on the rung this student's
    // seed put forward, which is #1 unless Variety is on.
    setSelectedIndex(solveResult?.variety.index ?? 0);
    setSelectedVariant(null);
  }, [solveResult]);

  const solutions = solveResult?.solutions ?? [];
  const base = solutions[selectedIndex] ?? solutions[0] ?? null;
  // A variant is a sibling solution, not an edit: picking one swaps the whole assignment on the
  // grid and changes nothing about the ladder it came from.
  const variants = solveResult?.variants[selectedIndex] ?? [];
  const solution = (selectedVariant === null ? null : variants[selectedVariant]) ?? base;

  /**
   * What every unchosen group would cost, priced once per solve rather than per hover. Lives
   * here rather than in `WeekGrid` because two surfaces need it: the ghost blocks on the grid,
   * and the line that tells the user what their pins are costing.
   */
  const costs = useMemo<Map<string, SwitchCost>>(
    () => (timetable && solution ? switchCosts(timetable, selection, prefs, solution) : new Map()),
    [timetable, selection, prefs, solution],
  );
  const relief = useMemo(() => pinRelief(selection, costs), [selection, costs]);

  const selectRung = (index: number) => {
    setSelectedIndex(index);
    setSelectedVariant(null); // a rung's labellings mean nothing on the next rung
  };

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

          {timetable && (solveResult || isSolving) && (
            <section className="panel">
              <h2 className="panel__title">Alternatives</h2>
              <SolvePerf isSolving={isSolving} solveStartedAt={solveStartedAt} progress={solveProgress} result={solveResult} />
              {solveResult && (
                <>
                  <AlternativesBar
                    solutions={solutions}
                    provenOptimal={solveResult.provenOptimal}
                    selectedIndex={selectedIndex}
                    varietyIndex={solveResult.variety.index}
                    onSelect={selectRung}
                  />
                  {base && (
                    <ShapeVariants
                      timetable={timetable}
                      base={base}
                      variants={variants}
                      selected={selectedVariant}
                      onSelect={setSelectedVariant}
                    />
                  )}
                  <VarietyStatus result={solveResult} prefs={prefs} selectedIndex={selectedIndex} />
                  {solution && <ScoreBreakdown score={solution.score} />}
                  <PinStatus relief={relief} />
                  <DiagnosticsPanel
                    solution={solution}
                    lectureConflicts={lectureConflicts}
                    dayOffAnalysis={dayOffAnalysis}
                    daysOff={prefs.daysOff}
                    lunchAnalysis={lunchAnalysis}
                    pinConflicts={pinConflicts}
                  />
                </>
              )}
            </section>
          )}

          <section className="panel panel--grow">
            <h2 className="panel__title">Week</h2>
            {timetable ? (
              <WeekGrid
                timetable={timetable}
                selection={selection}
                solution={solution}
                costs={costs}
                onPin={actions.toggleSeminarPinned}
              />
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
