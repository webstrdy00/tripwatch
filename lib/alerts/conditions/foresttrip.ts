import type { AlertEvaluation, CanonicalMatch } from "@/lib/alerts/types";
import { parseAlertCondition } from "@/lib/validation/alert-rule-schema";

type Input = { source: unknown; status: unknown; data: unknown; params: unknown; condition: unknown };
type RecordValue = Record<string, unknown>;
const blocked = (): AlertEvaluation => ({ outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" });
const unsupported = (): AlertEvaluation => ({ outcome: "unsupported_shape", code: "ALERT_RESULT_UNSUPPORTED_SHAPE" });
const result = (matches: CanonicalMatch[]): AlertEvaluation => matches.length ? { outcome: "success_matched", matches } : { outcome: "success_no_match", matches: [] };
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as RecordValue : null;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.normalize("NFC") && !/[\uD800-\uDFFF]/.test(value);
const capacity = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
const date = (value: unknown): value is string => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

export function evaluateForesttripCondition(input: Input): AlertEvaluation {
  if (input.source !== "foresttrip-vacancy") return blocked();
  if (input.status !== "success") return unsupported();

  try {
    const data = record(input.data);
    const params = record(input.params);
    const query = record(data?.query);
    if (!data || !params || !query || !text(query.forestName) || !date(query.date) || !text(query.category) || !Array.isArray(data.rooms) || query.forestName !== params.forestName || query.date !== params.date || query.category !== params.category) return unsupported();

    const condition = parseAlertCondition("foresttrip", "foresttrip_search", input.condition);
    if (condition.kind !== "availability") return unsupported();
    const seen = new Map<string, string>();
    const matches: CanonicalMatch[] = [];
    for (const value of data.rooms) {
      const room = record(value);
      if (!room || !text(room.id) || !text(room.roomName) || room.date !== query.date || room.categoryCode !== query.category || !text(room.categoryLabel) || room.availability !== "available" || !capacity(room.capacity)) return unsupported();
      const identity = JSON.stringify([query.forestName, query.date, query.category, room.id]);
      const serializedValue = JSON.stringify([room.roomName, room.categoryLabel, room.capacity]);
      const prior = seen.get(identity);
      if (prior !== undefined && prior !== serializedValue) return unsupported();
      seen.set(identity, serializedValue);
      matches.push({ capacity: room.capacity, categoryCode: room.categoryCode, categoryLabel: room.categoryLabel, date: room.date, forestName: query.forestName, id: room.id, roomName: room.roomName });
    }
    return result(matches);
  } catch {
    return unsupported();
  }
}
