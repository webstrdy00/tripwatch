import { TripWatchError } from "@/lib/errors";

export const LOCAL_OPERATOR_HOST = "127.0.0.1:3000";
export const LOCAL_OPERATOR_ORIGIN = "http://127.0.0.1:3000";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function assertLocalOperatorRequest(request: Request): void {
  if (request.headers.get("host") !== LOCAL_OPERATOR_HOST) {
    throw new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "로컬 운영자 요청만 허용됩니다.");
  }

  if (
    MUTATING_METHODS.has(request.method) &&
    (request.headers.get("origin") !== LOCAL_OPERATOR_ORIGIN || request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    throw new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "로컬 운영자 요청만 허용됩니다.");
  }
}

export async function withLocalOperatorRequest<T>(request: Request, callback: () => T | Promise<T>): Promise<T> {
  assertLocalOperatorRequest(request);
  return callback();
}
