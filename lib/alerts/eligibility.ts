import type { AlertMode, AlertSource, AlertType } from "@/lib/alerts/types";

export type AlertEligibility = Readonly<{
  source: AlertSource;
  type: AlertType;
  mode: AlertMode;
}>;

export const ALERT_ELIGIBILITY: readonly AlertEligibility[] = [
  { source: "flight-ticket-search", type: "flight", mode: "flight_search" },
  { source: "flight-ticket-search", type: "flight", mode: "flight_compare_month" },
  { source: "express-bus-booking", type: "express_bus", mode: "express_bus_search" },
  { source: "intercity-bus-booking", type: "intercity_bus", mode: "intercity_bus_search" },
  { source: "ticket-availability", type: "ticket", mode: "ticket_seats" },
  { source: "foresttrip-vacancy", type: "foresttrip", mode: "foresttrip_search" }
];

export function isEligibleAlert(source: string, type: string, mode: string): boolean {
  return ALERT_ELIGIBILITY.some((entry) => entry.source === source && entry.type === type && entry.mode === mode);
}

export function getAlertEligibility(type: AlertType, mode: AlertMode): AlertEligibility | undefined {
  return ALERT_ELIGIBILITY.find((entry) => entry.type === type && entry.mode === mode);
}
