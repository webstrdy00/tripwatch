import { maskSecrets } from "@/lib/secrets";

export type TripWatchErrorCode =
  | "VALIDATION_ERROR"
  | "ALERT_VALIDATION_ERROR"
  | "NOT_FOUND"
  | "WATCH_ITEM_NOT_FOUND"
  | "WATCH_ITEM_TYPE_MISMATCH"
  | "ALERT_RULE_NOT_FOUND"
  | "ALERT_RULE_EXISTS"
  | "ALERT_CONFIG_INVALID"
  | "ALERT_CONFIG_VERSION_CONFLICT"
  | "ALERT_DELIVERY_IN_FLIGHT"
  | "ALERT_STATE_RETAINED"
  | "ALERT_SUBTYPE_UNSUPPORTED"
  | "ALERT_CONDITION_UNSUPPORTED"
  | "ALERT_CONDITION_INVALID"
  | "ALERT_LOCAL_OPERATOR_REQUIRED"
  | "ALERT_OUTBOUND_OPT_IN_REQUIRED"
  | "ALERT_SOURCE_BLOCKED"
  | "ALERT_RESULT_UNSUPPORTED_SHAPE"
  | "ALERT_RESULT_MISMATCH"
  | "ALERT_SUPERSEDED"
  | "ALERT_MESSAGE_INVALID"
  | "ALERT_TRANSPORT_FAILED"
  | "ALERT_INVARIANT_VIOLATION"
  | "NOT_IMPLEMENTED"
  | "DISABLED_WATCH_ITEM"
  | "FAILED_RERUN_COOLDOWN"
  | "TERMINAL_NOT_FOUND"
  | "NO_RESULTS"
  | "NO_SCHEDULE"
  | "HELPER_TIMEOUT"
  | "HELPER_TERMINATION_FAILED"
  | "HELPER_FAILED"
  | "PARSE_ERROR"
  | "UNKNOWN_ERROR";
const TRIP_WATCH_ERROR_CODES: ReadonlySet<TripWatchErrorCode> = new Set([
  "VALIDATION_ERROR",
  "ALERT_VALIDATION_ERROR",
  "NOT_FOUND",
  "WATCH_ITEM_NOT_FOUND",
  "WATCH_ITEM_TYPE_MISMATCH",
  "ALERT_RULE_NOT_FOUND",
  "ALERT_RULE_EXISTS",
  "ALERT_CONFIG_INVALID",
  "ALERT_CONFIG_VERSION_CONFLICT",
  "ALERT_DELIVERY_IN_FLIGHT",
  "ALERT_STATE_RETAINED",
  "ALERT_SUBTYPE_UNSUPPORTED",
  "ALERT_CONDITION_UNSUPPORTED",
  "ALERT_CONDITION_INVALID",
  "ALERT_LOCAL_OPERATOR_REQUIRED",
  "ALERT_OUTBOUND_OPT_IN_REQUIRED",
  "ALERT_SOURCE_BLOCKED",
  "ALERT_RESULT_UNSUPPORTED_SHAPE",
  "ALERT_RESULT_MISMATCH",
  "ALERT_SUPERSEDED",
  "ALERT_MESSAGE_INVALID",
  "ALERT_TRANSPORT_FAILED",
  "ALERT_INVARIANT_VIOLATION",
  "NOT_IMPLEMENTED",
  "DISABLED_WATCH_ITEM",
  "FAILED_RERUN_COOLDOWN",
  "TERMINAL_NOT_FOUND",
  "NO_RESULTS",
  "NO_SCHEDULE",
  "HELPER_TIMEOUT",
  "HELPER_TERMINATION_FAILED",
  "HELPER_FAILED",
  "PARSE_ERROR",
  "UNKNOWN_ERROR"
]);

export function isTripWatchErrorCode(value: unknown): value is TripWatchErrorCode {
  return typeof value === "string" && TRIP_WATCH_ERROR_CODES.has(value as TripWatchErrorCode);
}

export type TripWatchErrorOptions = {
  raw?: string;
  cause?: unknown;
};

export class TripWatchError extends Error {
  readonly code: TripWatchErrorCode;
  readonly raw?: string;
  override readonly cause?: unknown;

  constructor(code: TripWatchErrorCode, message: string, options: TripWatchErrorOptions = {}) {
    super(message);
    this.name = "TripWatchError";
    this.code = code;
    this.raw = options.raw ? maskSecrets(options.raw) : undefined;
    this.cause = options.cause;
  }
}

export function summarizeError(error: unknown): string {
  if (error instanceof TripWatchError) {
    return maskSecrets(error.message);
  }

  if (error instanceof Error) {
    return maskSecrets(error.message || "알 수 없는 오류가 발생했습니다.");
  }

  if (typeof error === "string") {
    return maskSecrets(error);
  }

  return "알 수 없는 오류가 발생했습니다.";
}

export function toApiError(error: unknown) {
  if (error instanceof TripWatchError) {
    return {
      code: error.code,
      message: summarizeError(error),
      raw: error.raw
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: summarizeError(error)
  };
}
