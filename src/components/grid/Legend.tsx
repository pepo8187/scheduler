export default function Legend() {
  return (
    <div className="legend">
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--lecture" aria-hidden="true" />
        Lecture — fixed
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--seminar" aria-hidden="true" />
        Seminar — chosen for you
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--clash" aria-hidden="true" />
        Overlapping lectures
      </span>
      <span className="legend__item">
        <span className="legend__swatch legend__swatch--ghost" aria-hidden="true" />
        Unselected candidate group
      </span>
    </div>
  );
}
