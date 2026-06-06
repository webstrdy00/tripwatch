import { NextResponse } from "next/server";

import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { BusSearchData } from "@/lib/normalize/normalize-bus";
import { buildExpressBusOfficialUrl } from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { searchExpressBuses } from "@/lib/services/express-bus-service";
import { expressBusSearchRequestSchema, type BusSearchInput } from "@/lib/validation/bus-schema";

export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

  if (response.error?.code === "TERMINAL_NOT_FOUND" || response.error?.code === "NO_RESULTS") {
    return 404;
  }

  if (response.error?.code === "HELPER_TIMEOUT") {
    return 504;
  }

  if (response.error?.code === "HELPER_FAILED" || response.error?.code === "PARSE_ERROR") {
    return 502;
  }

  return 500;
}

async function storeResponse(response: TripWatchApiResponse<BusSearchData>, watchItemId: string | null) {
  await createQueryResultFromResponse({
    type: "express_bus",
    response,
    watchItemId
  });
}

function validationFailedResponse(error: unknown): TripWatchApiResponse<BusSearchData> {
  const apiError = toApiError(error);

  return failedResponse<BusSearchData>({
    source: "kobus-link",
    officialUrl: buildExpressBusOfficialUrl(),
    summary: apiError.message,
    error: apiError
  });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    const response = validationFailedResponse(error);
    await storeResponse(response, null);
    return NextResponse.json(response, { status: 400 });
  }

  const parsed = expressBusSearchRequestSchema.safeParse(body);

  if (!parsed.success) {
    const response = validationFailedResponse(
      new TripWatchError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {
        raw: parsed.error.issues.map((issue) => issue.message).join("; "),
        cause: parsed.error
      })
    );
    await storeResponse(response, readWatchItemId(body));
    return NextResponse.json(response, { status: 400 });
  }

  const { watchItemId, ...input } = parsed.data;
  const response = await searchExpressBuses(input as BusSearchInput);
  await storeResponse(response, watchItemId ?? null);

  return NextResponse.json(response, { status: httpStatusForResponse(response) });
}
