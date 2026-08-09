import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { isTripWatchErrorCode, TripWatchError, type TripWatchErrorCode } from "@/lib/errors";
import { apiErrorStatus } from "@/lib/api-error-status";

const UNKNOWN_ERROR_MESSAGE = "요청을 처리하지 못했습니다.";

const PUBLIC_MESSAGES: Partial<Record<TripWatchErrorCode, string>> = {
  VALIDATION_ERROR: "요청 값이 올바르지 않습니다.",
  ALERT_VALIDATION_ERROR: "알림 요청 값이 올바르지 않습니다.",
  ALERT_LOCAL_OPERATOR_REQUIRED: "로컬 운영자 요청만 허용됩니다.",
  NOT_FOUND: "요청한 항목을 찾을 수 없습니다.",
  WATCH_ITEM_NOT_FOUND: "관심 조건을 찾을 수 없습니다.",
  WATCH_ITEM_TYPE_MISMATCH: "관심 조건 유형이 조회 유형과 일치하지 않습니다.",
  ALERT_RULE_NOT_FOUND: "알림 규칙을 찾을 수 없습니다.",
  ALERT_CONFIG_VERSION_CONFLICT: "알림 규칙이 변경되었습니다. 다시 시도하세요.",
  ALERT_DELIVERY_IN_FLIGHT: "알림 전송이 진행 중입니다.",
  ALERT_STATE_RETAINED: "보존된 알림 규칙은 삭제할 수 없습니다.",
  ALERT_SUBTYPE_UNSUPPORTED: "이 관심 조건에는 알림을 설정할 수 없습니다.",
  ALERT_CONDITION_UNSUPPORTED: "알림 조건이 지원되지 않습니다.",
  ALERT_CONDITION_INVALID: "알림 조건이 올바르지 않습니다.",
  ALERT_OUTBOUND_OPT_IN_REQUIRED: "알림 전송 동의가 필요합니다.",
  HELPER_TIMEOUT: "외부 조회 시간이 초과되었습니다.",
  HELPER_FAILED: "외부 조회를 완료하지 못했습니다.",
  PARSE_ERROR: "외부 조회 결과를 해석하지 못했습니다.",
  NOT_IMPLEMENTED: "아직 지원하지 않는 기능입니다."
};

export type BoundedApiError = {
  code: TripWatchErrorCode | "UNKNOWN_ERROR";
  message: string;
};

export type ApiRouteError = {
  status: number;
  body: TripWatchApiResponse<never>;
};

function knownErrorCode(error: unknown): TripWatchErrorCode | undefined {
  if (error instanceof TripWatchError) {
    return error.code;
  }

  if (error && typeof error === "object" && isTripWatchErrorCode((error as { code?: unknown }).code)) {
    return (error as { code: TripWatchErrorCode }).code;
  }

  return undefined;
}

export function toBoundedApiError(error: unknown): BoundedApiError {
  const code = knownErrorCode(error);
  if (!code) {
    return { code: "UNKNOWN_ERROR", message: UNKNOWN_ERROR_MESSAGE };
  }

  return { code, message: PUBLIC_MESSAGES[code] ?? UNKNOWN_ERROR_MESSAGE };
}

export function buildApiRouteError(error: unknown, source: string): ApiRouteError {
  const apiError = toBoundedApiError(error);
  return {
    status: apiErrorStatus(error),
    body: failedResponse({
      source,
      summary: apiError.message,
      error: apiError
    })
  };
}
