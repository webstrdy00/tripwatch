export const ALERT_EXIT_CODE = Object.freeze({
  clean: 0,
  preflight: 2,
  lock: 3,
  evaluation: 4,
  rejected: 5,
  ambiguous: 6,
  invariant: 7
} as const);

export type AlertExitCode = (typeof ALERT_EXIT_CODE)[keyof typeof ALERT_EXIT_CODE];
export type AlertRunClassification = keyof typeof ALERT_EXIT_CODE;

const PRIORITY: Readonly<Record<AlertExitCode, number>> = Object.freeze({
  0: 0,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7
});

/** Returns the fail-fast aggregate; invariant failures always override prior outcomes. */
export function aggregateAlertExitCodes(codes: readonly AlertExitCode[]): AlertExitCode {
  let selected: AlertExitCode = ALERT_EXIT_CODE.clean;
  for (const code of codes) {
    if (PRIORITY[code] === undefined) {
      throw new TypeError(`Unsupported alert exit code: ${String(code)}`);
    }
    if (PRIORITY[code] > PRIORITY[selected]) {
      selected = code;
    }
  }
  return selected;
}

export function shouldStopAlertRun(code: AlertExitCode): boolean {
  return code === ALERT_EXIT_CODE.rejected || code === ALERT_EXIT_CODE.ambiguous || code === ALERT_EXIT_CODE.invariant;
}
