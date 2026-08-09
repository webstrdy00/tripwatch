import { formatAlertDiagnosticEvent } from "@/lib/alerts/redaction";

const COUNTER_KEYS = [
  "providerDispatched",
  "providerCooldownSkipped",
  "evaluated",
  "sent",
  "rejected",
  "ambiguous",
  "cancelled",
  "suppressed",
  "recoveredReserved",
  "recoveredSending",
  "blocked"
] as const;

const EXIT_CODES = [0, 4, 5, 6, 7] as const;

export type AlertWorkerSummary = Partial<Record<(typeof COUNTER_KEYS)[number], unknown>> & {
  readonly exitCode?: unknown;
};

export function formatAlertWorkerSummary(summary: AlertWorkerSummary): string {
  const fields: Record<string, string | number> = {};

  for (const key of COUNTER_KEYS) {
    const value = summary[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000) {
      fields[key] = value;
    }
  }

  if (typeof summary.exitCode === "number" && EXIT_CODES.includes(summary.exitCode as (typeof EXIT_CODES)[number])) {
    fields.exitCode = summary.exitCode;
  }

  return formatAlertDiagnosticEvent(fields);
}
