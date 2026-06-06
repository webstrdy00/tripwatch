import { NextResponse } from "next/server";

import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { FlightSearchData } from "@/lib/normalize/normalize-flight";
import { getOfficialUrl } from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { compareFlightMonth } from "@/lib/services/flight-service";
import { flightCompareMonthSchema } from "@/lib/validation/flight-schema";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildFallbackOfficialUrl(body: unknown): string {
  const record = asRecord(body);
  const params = new URLSearchParams({
    hl: "ko",
    curr: "KRW"
  });
  const query = [
    stringValue(record.from),
    "to",
    stringValue(record.to),
    stringValue(record.yearMonth) ?? stringValue(record.month) ?? stringValue(record.date)
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (query) {
    params.set("q", query);
  }

  return `${getOfficialUrl("flight")}?${params.toString()}`;
}

function readWatchItemId(body: unknown): string | null {
  return stringValue(asRecord(body).watchItemId) ?? null;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new TripWatchError("VALIDATION_ERROR", "요청 본문은 올바른 JSON이어야 합니다.", {
      cause: error
    });
  }
}

function httpStatusForResponse<T>(response: TripWatchApiResponse<T>): number {
  if (response.status !== "failed") {
    return 200;
  }

  if (response.error?.code === "VALIDATION_ERROR") {
    return 400;
  }

  if (response.error?.code === "HELPER_TIMEOUT") {
    return 504;
  }

  if (response.error?.code === "HELPER_FAILED" || response.error?.code === "PARSE_ERROR") {
    return 502;
  }

  return 500;
}

async function storeResponse(response: TripWatchApiResponse<FlightSearchData>, watchItemId: string | null) {
  await createQueryResultFromResponse({
    type: "flight",
    response,
    watchItemId
  });
}

function validationFailedResponse(error: unknown, body: unknown): TripWatchApiResponse<FlightSearchData> {
  const apiError = toApiError(error);

  return failedResponse<FlightSearchData>({
    source: "google-flights-link",
    officialUrl: buildFallbackOfficialUrl(body),
    summary: apiError.message,
    error: apiError
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    const response = validationFailedResponse(error, undefined);
    await storeResponse(response, null);
    return NextResponse.json(response, { status: 400 });
  }

  const parsed = flightCompareMonthSchema.safeParse(body);

  if (!parsed.success) {
    const response = validationFailedResponse(
      new TripWatchError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {
        raw: parsed.error.issues.map((issue) => issue.message).join("; "),
        cause: parsed.error
      }),
      body
    );
    await storeResponse(response, readWatchItemId(body));
    return NextResponse.json(response, { status: 400 });
  }

  const { watchItemId, ...input } = parsed.data;
  const response = await compareFlightMonth(input);
  await storeResponse(response, watchItemId ?? null);

  return NextResponse.json(response, { status: httpStatusForResponse(response) });
}
