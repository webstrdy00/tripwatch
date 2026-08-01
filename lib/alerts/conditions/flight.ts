import type { AlertEvaluation, CanonicalMatch } from "@/lib/alerts/types";
import { parseAlertCondition } from "@/lib/validation/alert-rule-schema";

type Input = { source: unknown; status: unknown; data: unknown; params: unknown; condition: unknown };
type RecordValue = Record<string, unknown>;

const blocked = (): AlertEvaluation => ({ outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" });
const unsupported = (): AlertEvaluation => ({ outcome: "unsupported_shape", code: "ALERT_RESULT_UNSUPPORTED_SHAPE" });
const noMatch = (): AlertEvaluation => ({ outcome: "success_no_match", matches: [] });
const matched = (matches: CanonicalMatch[]): AlertEvaluation => matches.length ? { outcome: "success_matched", matches } : noMatch();
const record = (value: unknown): RecordValue | null => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype ? value as RecordValue : null;
const scalar = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value === value.normalize("NFC") && !/[\uD800-\uDFFF]/.test(value);
const safeInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const isoDate = (value: unknown): value is string => {
  if (!scalar(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

export function evaluateFlightCondition(input: Input): AlertEvaluation {
  if (input.source !== "flight-ticket-search") return blocked();
  if (input.status !== "success") return unsupported();

  try {
    const data = record(input.data);
    const params = record(input.params);
    const query = record(data?.query);
    const summary = record(data?.priceSummary);
    if (!data || !params || !query || !summary || summary.currency !== "KRW") return unsupported();

    const mode = Object.hasOwn(params, "yearMonth") || Object.hasOwn(params, "month") || Object.hasOwn(params, "sample") ? "flight_compare_month" : "flight_search";
    if (mode === "flight_search") {
      if (!scalar(query.from) || !scalar(query.to) || !isoDate(query.date) || Object.hasOwn(query, "yearMonth") || Object.hasOwn(query, "month") || Object.hasOwn(query, "sample") || query.from !== params.from || query.to !== params.to || query.date !== params.date) return unsupported();
      const condition = parseAlertCondition("flight", mode, input.condition);
      if (condition.kind !== "displayed_price_at_or_below") return unsupported();
      const flights = data.flights;
      if (!Array.isArray(flights)) return unsupported();
      const seen = new Map<string, number>();
      const matches: CanonicalMatch[] = [];
      for (const value of flights) {
        const row = record(value);
        if (!row || row.quality !== "complete" || !scalar(row.airlineName) || !scalar(row.departureTime) || !scalar(row.arrivalTime) || !safeInt(row.price, 1, 100_000_000)) return unsupported();
        const identity = JSON.stringify([query.from, query.to, row.departureTime, row.arrivalTime, row.airlineName]);
        const prior = seen.get(identity);
        if (prior !== undefined && prior !== row.price) return unsupported();
        seen.set(identity, row.price);
        if (row.price <= condition.maxDisplayedPriceKrw) matches.push({ airlineName: row.airlineName, arrivalTime: row.arrivalTime, departureTime: row.departureTime, displayedPriceKrw: row.price, from: query.from, to: query.to });
      }
      return matched(matches);
    }

    if (!scalar(query.from) || !scalar(query.to) || !scalar(query.yearMonth) || !/^\d{4}-\d{2}$/.test(query.yearMonth) || query.from !== params.from || query.to !== params.to || query.yearMonth !== params.yearMonth) return unsupported();
    const condition = parseAlertCondition("flight", mode, input.condition);
    if (condition.kind !== "date_displayed_price_at_or_below") return unsupported();
    const dates = data.cheapestDates;
    if (!Array.isArray(dates)) return unsupported();
    const seen = new Map<string, number>();
    const matches: CanonicalMatch[] = [];
    for (const value of dates) {
      const row = record(value);
      if (!row || row.status !== "success" || !isoDate(row.date) || !safeInt(row.minPrice, 1, 100_000_000)) return unsupported();
      const identity = JSON.stringify([query.from, query.to, row.date]);
      const prior = seen.get(identity);
      if (prior !== undefined && prior !== row.minPrice) return unsupported();
      seen.set(identity, row.minPrice);
      if (row.minPrice <= condition.maxDisplayedPriceKrw) matches.push({ date: row.date, displayedPriceKrw: row.minPrice, from: query.from, to: query.to });
    }
    return matched(matches);
  } catch {
    return unsupported();
  }
}
