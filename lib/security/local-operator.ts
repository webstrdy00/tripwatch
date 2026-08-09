import { NextRequest } from "next/server";
import { TripWatchError } from "@/lib/errors";

const LOCAL_OPERATOR_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hasFrameworkReconstructedUrl(request: Request, requestUrl: URL, hostUrl: URL): boolean {
  return (
    request instanceof NextRequest &&
    request.nextUrl.hostname === "localhost" &&
    requestUrl.hostname === "localhost" &&
    hostUrl.hostname === "127.0.0.1" &&
    requestUrl.port === hostUrl.port
  );
}

function parseHostUrl(host: string | null): URL | null {
  if (host === null) return null;

  try {
    const hostUrl = new URL(`http://${host}`);
    if (
      hostUrl.host !== host ||
      hostUrl.username !== "" ||
      hostUrl.password !== "" ||
      hostUrl.pathname !== "/" ||
      hostUrl.search !== "" ||
      hostUrl.hash !== ""
    ) {
      return null;
    }
    return hostUrl;
  } catch {
    return null;
  }
}

export function assertLocalOperatorRequest(request: Request): void {
  const requestUrl = new URL(request.url);
  const hostname = requestUrl.hostname.toLowerCase();
  const host = request.headers.get("host");
  const hostUrl = parseHostUrl(host);
  const urlMatchesHost =
    host !== null &&
    hostUrl !== null &&
    (host === requestUrl.host || hasFrameworkReconstructedUrl(request, requestUrl, hostUrl));

  if (
    requestUrl.protocol !== "http:" ||
    !LOCAL_OPERATOR_HOSTNAMES.has(hostname) ||
    hostUrl === null ||
    !LOCAL_OPERATOR_HOSTNAMES.has(hostUrl.hostname.toLowerCase()) ||
    !urlMatchesHost
  ) {
    throw new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "로컬 운영자 요청만 허용됩니다.");
  }

  if (
    MUTATING_METHODS.has(request.method.toUpperCase()) &&
    (request.headers.get("origin") !== hostUrl.origin ||
      request.headers.get("sec-fetch-site") !== "same-origin")
  ) {
    throw new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "로컬 운영자 요청만 허용됩니다.");
  }
}

export async function withLocalOperatorRequest<T>(request: Request, callback: () => T | Promise<T>): Promise<T> {
  assertLocalOperatorRequest(request);
  return callback();
}
