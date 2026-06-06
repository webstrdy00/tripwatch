import { NextResponse } from "next/server";

import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { TicketSeatsData } from "@/lib/normalize/normalize-ticket";
import { getTicketOfficialUrlFromInput } from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { getTicketSeats } from "@/lib/services/ticket-service";
import { ticketSeatsRequestSchema } from "@/lib/validation/ticket-schema";

export const dynamic = "force-dynamic";

const FALLBACK_OFFICIAL_URL = "https://tickets.interpark.com";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readWatchItemId(body: unknown): string | null {
  return stringValue(asRecord(body).watchItemId) ?? null;
}

function officialUrlFromBody(body: unknown): string {
  const input = stringValue(asRecord(body).input);
  return input ? (getTicketOfficialUrlFromInput(input) ?? FALLBACK_OFFICIAL_URL) : FALLBACK_OFFICIAL_URL;
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

async function storeResponse(response: TripWatchApiResponse<TicketSeatsData>, watchItemId: string | null) {
  await createQueryResultFromResponse({
    type: "ticket",
    response,
    watchItemId
  });
}

function validationFailedResponse(error: unknown, body: unknown): TripWatchApiResponse<TicketSeatsData> {
  const apiError = toApiError(error);

  return failedResponse<TicketSeatsData>({
    source: "ticket-official-link",
    officialUrl: officialUrlFromBody(body),
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

  const parsed = ticketSeatsRequestSchema.safeParse(body);

  if (!parsed.success) {
    const response = validationFailedResponse(
      new TripWatchError("VALIDATION_ERROR", "URL 또는 platform:id 형식을 확인하세요.", {
        raw: parsed.error.issues.map((issue) => issue.message).join("; "),
        cause: parsed.error
      }),
      body
    );
    await storeResponse(response, readWatchItemId(body));
    return NextResponse.json(response, { status: 400 });
  }

  const { watchItemId, ...input } = parsed.data;
  const response = await getTicketSeats(input);
  await storeResponse(response, watchItemId ?? null);

  return NextResponse.json(response, { status: httpStatusForResponse(response) });
}
