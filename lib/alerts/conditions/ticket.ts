import type { AlertEvaluation, CanonicalMatch } from "@/lib/alerts/types";
import { parseAlertCondition } from "@/lib/validation/alert-rule-schema";
import { parseTicketInput } from "@/lib/validation/ticket-schema";

type Input = { source: unknown; status: unknown; data: unknown; params: unknown; condition: unknown };
type RecordValue = Record<string, unknown>;
const blocked = (): AlertEvaluation => ({ outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" });
const unsupported = (): AlertEvaluation => ({ outcome: "unsupported_shape", code: "ALERT_RESULT_UNSUPPORTED_SHAPE" });
const result = (matches: CanonicalMatch[]): AlertEvaluation => matches.length ? { outcome: "success_matched", matches } : { outcome: "success_no_match", matches: [] };
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as RecordValue : null;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.normalize("NFC") && !/[\uD800-\uDFFF]/.test(value);
const optionalText = (value: unknown): value is string | null => value === null || text(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const date = (value: unknown): value is string => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const time = (value: unknown): value is string => text(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function evaluateTicketCondition(input: Input): AlertEvaluation {
  if (input.source !== "ticket-availability") return blocked();
  if (input.status !== "success") return unsupported();

  try {
    const data = record(input.data);
    const params = record(input.params);
    const target = typeof params?.input === "string" ? parseTicketInput(params.input) : undefined;
    if (!data || !params || params.mode !== "seats" || !target || !text(data.platform) || !text(data.id) || data.platform !== target.platform || data.id !== target.id || !Array.isArray(data.seats)) return unsupported();

    const condition = parseAlertCondition("ticket", "ticket_seats", input.condition);
    if (condition.kind !== "availability") return unsupported();
    const seen = new Map<string, number>();
    const matches: CanonicalMatch[] = [];
    for (const performanceValue of data.seats) {
      const performance = record(performanceValue);
      if (!performance || !date(performance.date) || !time(performance.time) || !optionalText(performance.playSeq) || !Array.isArray(performance.grades) || performance.grades.length === 0) return unsupported();
      for (const gradeValue of performance.grades) {
        const grade = record(gradeValue);
        if (!grade || !text(grade.grade) || !integer(grade.remain) || (grade.status !== "available" && grade.status !== "sold_out") || (grade.status === "available") !== (grade.remain > 0)) return unsupported();
        const identity = JSON.stringify([data.platform, data.id, performance.date, performance.time, performance.playSeq ?? null, grade.grade]);
        const prior = seen.get(identity);
        if (prior !== undefined && prior !== grade.remain) return unsupported();
        seen.set(identity, grade.remain);
        if (grade.status === "available") matches.push({ date: performance.date, eventId: data.id, grade: grade.grade, platform: data.platform, playSeq: performance.playSeq ?? null, remain: grade.remain, time: performance.time });
      }
    }
    return result(matches);
  } catch {
    return unsupported();
  }
}
