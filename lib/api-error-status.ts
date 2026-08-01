import { isTripWatchErrorCode, TripWatchError, type TripWatchErrorCode } from "@/lib/errors";

const STATUS_BY_CODE: Partial<Record<TripWatchErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  ALERT_VALIDATION_ERROR: 400,
  ALERT_LOCAL_OPERATOR_REQUIRED: 403,
  NOT_FOUND: 404,
  WATCH_ITEM_NOT_FOUND: 404,
  ALERT_RULE_NOT_FOUND: 404,
  ALERT_CONFIG_VERSION_CONFLICT: 409,
  ALERT_DELIVERY_IN_FLIGHT: 409,
  ALERT_STATE_RETAINED: 409,
  ALERT_RULE_EXISTS: 409,
  ALERT_SUBTYPE_UNSUPPORTED: 422,
  ALERT_CONDITION_UNSUPPORTED: 422,
  ALERT_CONDITION_INVALID: 422,
  ALERT_OUTBOUND_OPT_IN_REQUIRED: 422
};

function errorCode(error: unknown): TripWatchErrorCode | undefined {
  if (error instanceof TripWatchError) {
    return error.code;
  }

  if (error && typeof error === "object" && isTripWatchErrorCode((error as { code?: unknown }).code)) {
    return (error as { code: TripWatchErrorCode }).code;
  }

  return undefined;
}

export function apiErrorStatus(error: unknown): number {
  const code = errorCode(error);
  return code ? STATUS_BY_CODE[code] ?? 500 : 500;
}
