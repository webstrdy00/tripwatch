import type { AlertEvaluation, CanonicalMatch } from "@/lib/alerts/types";
import { parseAlertCondition } from "@/lib/validation/alert-rule-schema";

type Input = { source: unknown; status: unknown; data: unknown; params: unknown; condition: unknown };
type RecordValue = Record<string, unknown>;
const blocked = (): AlertEvaluation => ({ outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" });
const unsupported = (): AlertEvaluation => ({ outcome: "unsupported_shape", code: "ALERT_RESULT_UNSUPPORTED_SHAPE" });
const result = (matches: CanonicalMatch[]): AlertEvaluation => matches.length ? { outcome: "success_matched", matches } : { outcome: "success_no_match", matches: [] };
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as RecordValue : null;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.normalize("NFC") && !/[\uD800-\uDFFF]/.test(value);
const optionalText = (value: unknown): value is string | null => value === null || text(value);
const integer = (value: unknown, min: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const date = (value: unknown): value is string => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};
const time = (value: unknown): value is string => text(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function evaluateBusCondition(input: Input): AlertEvaluation {
  const express = input.source === "express-bus-booking";
  const intercity = input.source === "intercity-bus-booking";
  if (!express && !intercity) return blocked();
  if (input.status !== "success") return unsupported();

  try {
    const data = record(input.data);
    const params = record(input.params);
    const query = record(data?.query);
    if (!data || !params || !query || !text(query.departName) || !text(query.arriveName) || !date(query.date) || !time(query.time) || !integer(query.passengers, 1) || query.passengers > 9 || query.departName !== params.departName || query.arriveName !== params.arriveName || query.date !== params.date || query.time !== params.time || query.passengers !== params.passengers) return unsupported();
    const schedules = data.schedules;
    if (!Array.isArray(schedules)) return unsupported();

    const condition = parseAlertCondition(express ? "express_bus" : "intercity_bus", express ? "express_bus_search" : "intercity_bus_search", input.condition);
    if (condition.kind !== "seats_at_or_above" || condition.minSeats < query.passengers) return unsupported();
    const seen = new Map<string, number>();
    const matches: CanonicalMatch[] = [];
    for (const value of schedules) {
      const row = record(value);
      if (!row || row.quality !== "complete" || !time(row.departTime) || !text(row.grade) || !integer(row.remainSeats, 0) || !optionalText(row.arriveTime) || !optionalText(row.operator)) return unsupported();
      if (intercity && (!text(row.operator) || !integer(row.totalSeats, 0) || !integer(row.fare, 0))) return unsupported();
      const identity = JSON.stringify([query.departName, query.arriveName, query.date, row.departTime, row.arriveTime ?? null, row.grade, row.operator ?? null]);
      const prior = seen.get(identity);
      if (prior !== undefined && prior !== row.remainSeats) return unsupported();
      seen.set(identity, row.remainSeats);
      if (row.remainSeats >= condition.minSeats) matches.push({ arriveName: query.arriveName, arriveTime: row.arriveTime ?? null, date: query.date, departName: query.departName, departTime: row.departTime, grade: row.grade, operator: row.operator ?? null, remainSeats: row.remainSeats });
    }
    return result(matches);
  } catch {
    return unsupported();
  }
}
