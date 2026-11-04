import { OPERATOR_NAME, POWERED_BY } from '@airwheels/ui';

/** Required on traveller pages: who operates the transfer, even under an airline brand (7.2, 19.2). */
export function Footer() {
  return (
    <footer className="mt-10 pb-8 text-center text-xs text-muted-foreground">
      <p className="font-semibold text-ink">{POWERED_BY}</p>
      <p>Transfers operated by {OPERATOR_NAME}</p>
    </footer>
  );
}
