import { z } from "zod";

import type { AlertMode, AlertType } from "@/lib/alerts/types";

const displayedPriceSchema = z.number().int().safe().min(1).max(100_000_000);
const seatsSchema = z.number().int().safe().min(1).max(99);

const flightSearchConditionSchema = z.object({
  kind: z.literal("displayed_price_at_or_below"),
  maxDisplayedPriceKrw: displayedPriceSchema
}).strict();
const flightCompareMonthConditionSchema = z.object({
  kind: z.literal("date_displayed_price_at_or_below"),
  maxDisplayedPriceKrw: displayedPriceSchema
}).strict();
const busConditionSchema = z.object({
  kind: z.literal("seats_at_or_above"),
  minSeats: seatsSchema
}).strict();
const availabilityConditionSchema = z.object({
  kind: z.literal("availability")
}).strict();

export type AlertCondition =
  | z.infer<typeof flightSearchConditionSchema>
  | z.infer<typeof flightCompareMonthConditionSchema>
  | z.infer<typeof busConditionSchema>
  | z.infer<typeof availabilityConditionSchema>;

export class AlertConditionValidationError extends Error {
  readonly code: "ALERT_CONDITION_UNSUPPORTED" | "ALERT_SUBTYPE_UNSUPPORTED";

  constructor(code: "ALERT_CONDITION_UNSUPPORTED" | "ALERT_SUBTYPE_UNSUPPORTED") {
    super(code);
    this.name = "AlertConditionValidationError";
    this.code = code;
  }
}

export function parseAlertCondition(type: AlertType, mode: AlertMode | "schedule", value: unknown): AlertCondition {
  if (type === "flight" && mode === "flight_search") {
    const parsed = flightSearchConditionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  if (type === "flight" && mode === "flight_compare_month") {
    const parsed = flightCompareMonthConditionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  if ((type === "express_bus" && mode === "express_bus_search") || (type === "intercity_bus" && mode === "intercity_bus_search")) {
    const parsed = busConditionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  if ((type === "ticket" && mode === "ticket_seats") || (type === "foresttrip" && mode === "foresttrip_search")) {
    const parsed = availabilityConditionSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  if (type === "ticket" && mode === "schedule") throw new AlertConditionValidationError("ALERT_SUBTYPE_UNSUPPORTED");
  throw new AlertConditionValidationError("ALERT_CONDITION_UNSUPPORTED");
}
