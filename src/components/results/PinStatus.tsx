import type { PinRelief } from '../../domain/switching';

interface PinStatusProps {
  relief: PinRelief[];
}

/**
 * What the user's pins are costing them.
 *
 * Pinning fights the optimizer by design — that is the whole point of it — but a student who
 * pins three groups can end up with a much worse week and no idea which pin did it. This names
 * the pin and the number, so the trade is visible rather than mysterious.
 *
 * It says **"at least"** on purpose. The figure is the best single swap available inside that
 * one subject, which is a floor on what un-pinning would recover: freeing the subject also lets
 * every other subject move around it. The exact answer needs a whole second search, which used
 * to double a fifteen-second solve for one line of text; since the search got an order of
 * magnitude faster that is a much smaller price, and `domain/switching.ts` says what it now
 * costs. The floor stays for the moment because it is free — every number it needs is already
 * computed for the ghost strips.
 */
export default function PinStatus({ relief }: PinStatusProps) {
  if (relief.length === 0) return null;

  return (
    <p className="pin-status">
      <span className="pin-status__icon" aria-hidden="true">
        📌
      </span>
      Your pins are costing you at least{' '}
      <strong>{Math.round(relief.reduce((sum, r) => sum + r.saves, 0))}</strong> points —{' '}
      {relief.map((r, i) => (
        <span key={r.subjectCode}>
          {i > 0 && ', '}
          un-pinning <strong>{r.subjectCode}</strong> would save at least {Math.round(r.saves)}
        </span>
      ))}
      .
    </p>
  );
}
