import { maskSecrets } from "@/lib/secrets";

export type TripWatchErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "WATCH_ITEM_NOT_FOUND"
  | "NOT_IMPLEMENTED"
  | "DISABLED_WATCH_ITEM"
  | "FAILED_RERUN_COOLDOWN"
  | "TERMINAL_NOT_FOUND"
  | "NO_RESULTS"
  | "NO_SCHEDULE"
  | "HELPER_TIMEOUT"
  | "HELPER_FAILED"
  | "PARSE_ERROR"
  | "UNKNOWN_ERROR";

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
