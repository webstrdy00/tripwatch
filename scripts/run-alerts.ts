import { preflightAlertBootstrap, AlertPreflightError } from "../lib/alerts/alert-preflight";
import { acquireAlertWorkerLock, AlertWorkerLockError } from "../lib/alerts/worker-lock";
import { formatAlertDiagnosticEvent } from "../lib/alerts/redaction";
import { ALERT_EXIT_CODE, type AlertExitCode } from "../lib/alerts/exit-codes";

interface ClosedWorkerSummary {
  readonly scanned?: number;
  readonly providerDispatched?: number;
  readonly evaluated?: number;
  readonly sent?: number;
  readonly rejected?: number;
  readonly ambiguous?: number;
  readonly cancelled?: number;
  readonly blocked?: number;
  readonly code?: string;
}


function isExitCode(value: number): value is AlertExitCode {
  return value === 0 || value === 4 || value === 5 || value === 6 || value === 7;
}

function boundedSummary(summary: ClosedWorkerSummary): string {
  const fields: Record<string, string | number | boolean | null> = {};
  for (const key of ["scanned", "providerDispatched", "evaluated", "sent", "rejected", "ambiguous", "cancelled", "blocked"] as const) {
    const value = summary[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000) {
      fields[key] = value;
    }
  }
  if (typeof summary.code === "string" && /^[\x21-\x7E]{1,64}$/.test(summary.code)) {
    fields.code = summary.code;
  }
  return formatAlertDiagnosticEvent(fields);
}

async function main(): Promise<void> {
  let lock: ReturnType<typeof acquireAlertWorkerLock> | undefined;
  try {
    const bootstrap = preflightAlertBootstrap(process.argv.slice(2));
    const getuid = process.getuid;
    if (getuid === undefined) {
      process.exitCode = ALERT_EXIT_CODE.preflight;
      console.error(formatAlertDiagnosticEvent({ code: "WSL_REQUIRED" }));
      return;
    }
    const uid = getuid();
    if (!Number.isSafeInteger(uid) || uid < 0) {
      process.exitCode = ALERT_EXIT_CODE.preflight;
      console.error(formatAlertDiagnosticEvent({ code: "WSL_REQUIRED" }));
      return;
    }
    lock = acquireAlertWorkerLock(uid);

    const workerModule = await import("../lib/services/alert-worker-service");
    const result = await workerModule.runAlertWorker({
      limit: bootstrap.limit,
      credentials: bootstrap.credentials
    });
    if (!isExitCode(result.exitCode)) {
      process.exitCode = ALERT_EXIT_CODE.invariant;
      console.error(formatAlertDiagnosticEvent({ code: "INVALID_WORKER_RESULT" }));
      return;
    }
    process.exitCode = result.exitCode;
    console.log(boundedSummary({
      providerDispatched: result.providerDispatches,
      evaluated: result.evaluated,
      sent: result.sent,
      rejected: result.rejected,
      ambiguous: result.ambiguous,
      cancelled: result.cancelled,
      blocked: result.skipped
    }));
  } catch (error) {
    if (error instanceof AlertPreflightError) {
      process.exitCode = ALERT_EXIT_CODE.preflight;
      console.error(formatAlertDiagnosticEvent({ code: error.code }));
      return;
    }
    if (error instanceof AlertWorkerLockError) {
      process.exitCode = ALERT_EXIT_CODE.lock;
      console.error(formatAlertDiagnosticEvent({ code: error.code }));
      return;
    }
    process.exitCode = ALERT_EXIT_CODE.invariant;
    console.error(formatAlertDiagnosticEvent({ code: "ALERT_WORKER_FAILURE" }));
  } finally {
    if (lock !== undefined) {
      try {
        lock.release();
      } catch {
        process.exitCode = ALERT_EXIT_CODE.invariant;
        console.error(formatAlertDiagnosticEvent({ code: "ALERT_LOCK_RELEASE_FAILED" }));
      }
    }
  }
}

void main();
