export const ALERT_TYPES = ["flight", "express_bus", "intercity_bus", "ticket", "foresttrip"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_MODES = [
  "flight_search",
  "flight_compare_month",
  "express_bus_search",
  "intercity_bus_search",
  "ticket_seats",
  "foresttrip_search"
] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export const ALERT_SOURCES = [
  "flight-ticket-search",
  "express-bus-booking",
  "intercity-bus-booking",
  "ticket-availability",
  "foresttrip-vacancy"
] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];
export type AlertChannel = "telegram";
export type AlertLatestOutcome =
  | "never"
  | "success_matched"
  | "success_no_match"
  | "partial"
  | "failed"
  | "blocked_source"
  | "unsupported_shape"
  | "result_type_mismatch"
  | "result_superseded"
  | "parent_disabled"
  | "failed_cooldown"
  | "config_invalid"
  | "message_invalid"
  | "config_changed";
export type AlertBaselineState = "never" | "matched" | "no_match";
export type AlertDeliveryState = "never" | "reserved" | "sending" | "sent" | "rejected" | "ambiguous" | "suppressed" | "cancelled";

export type PublicAlertRule = {
  id: string;
  watchItemId: string;
  channel: AlertChannel;
  condition: AlertCondition;
  enabled: boolean;
  outboundOptIn: boolean;
  configVersion: number;
  latestOutcome: AlertLatestOutcome;
  latestOutcomeAt: string | null;
  latestOutcomeCode: string | null;
  baselineState: AlertBaselineState;
  baselineTransitionSeq: number;
  baselineAt: string | null;
  deliveryState: AlertDeliveryState;
  lastAttemptAt: string | null;
  terminalAt: string | null;
  deliveryCode: string | null;
  lastProviderRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InternalAlertRuleState = {
  baselineFingerprint: string | null;
  attemptId: string | null;
  attemptRunId: string | null;
  attemptFingerprint: string | null;
  attemptTransitionSeq: number | null;
  attemptResultId: string | null;
  attemptResultType: string | null;
};

export type AlertCondition =
  | { kind: "displayed_price_at_or_below"; maxDisplayedPriceKrw: number }
  | { kind: "date_displayed_price_at_or_below"; maxDisplayedPriceKrw: number }
  | { kind: "seats_at_or_above"; minSeats: number }
  | { kind: "availability" };

export type FlightMatch = {
  airlineName: string;
  arrivalTime: string;
  departureTime: string;
  displayedPriceKrw: number;
  from: string;
  to: string;
};

export type FlightCompareMonthMatch = {
  date: string;
  displayedPriceKrw: number;
  from: string;
  to: string;
};

export type BusMatch = {
  arriveName: string;
  arriveTime: string | null;
  date: string;
  departName: string;
  departTime: string;
  grade: string;
  operator: string | null;
  remainSeats: number;
};

export type TicketSeatMatch = {
  date: string;
  eventId: string;
  grade: string;
  platform: string;
  playSeq: string | null;
  remain: number;
  time: string;
};

export type ForesttripMatch = {
  capacity: number | null;
  categoryCode: string;
  categoryLabel: string;
  date: string;
  forestName: string;
  id: string;
  roomName: string;
};

export type AlertMatch = FlightMatch | FlightCompareMonthMatch | BusMatch | TicketSeatMatch | ForesttripMatch;
export type CanonicalMatch = AlertMatch;

export type AlertEvaluation =
  | { outcome: "success_matched"; matches: CanonicalMatch[] }
  | { outcome: "success_no_match"; matches: [] }
  | { outcome: "blocked_source"; code: "ALERT_SOURCE_BLOCKED" }
  | { outcome: "unsupported_shape"; code: "ALERT_RESULT_UNSUPPORTED_SHAPE" };

export type AlertFingerprintInput = {
  fingerprintVersion: "v1";
  type: AlertType;
  mode: AlertMode;
  condition: AlertCondition;
  matches: AlertMatch[];
};

export type CanonicalAlertFingerprint = {
  canonicalJson: string;
  canonicalBytes: Uint8Array;
  fingerprint: `v1:${string}`;
  matches: AlertMatch[];
};
