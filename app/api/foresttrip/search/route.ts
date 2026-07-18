import { NextResponse } from "next/server";

import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { ForesttripSearchData } from "@/lib/normalize/normalize-foresttrip";
import { getOfficialUrl } from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { searchForesttrip } from "@/lib/services/foresttrip-service";
import { foresttripRequestSchema } from "@/lib/validation/foresttrip-schema";

export const dynamic = "force-dynamic";

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    throw new TripWatchError("VALIDATION_ERROR", "요청 본문은 올바른 JSON이어야 합니다.", { cause: error });
  }
}

function failedValidationResponse(error: unknown): TripWatchApiResponse<ForesttripSearchData> {
  const apiError = toApiError(error);
  return failedResponse({
    source: "foresttrip-official-link",
    officialUrl: getOfficialUrl("foresttrip"),
    summary: apiError.message,
    error: { code: apiError.code, message: apiError.message }
  });
}

function httpStatusForResponse(response: TripWatchApiResponse<ForesttripSearchData>): number {
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

async function storeResponse(response: TripWatchApiResponse<ForesttripSearchData>) {
  await createQueryResultFromResponse({
    type: "foresttrip",
    response
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    const response = failedValidationResponse(error);
    await storeResponse(response);
    return NextResponse.json(response, { status: 400 });
  }

  const parsed = foresttripRequestSchema.safeParse(body);
  if (!parsed.success) {
    const response = failedValidationResponse(
      new TripWatchError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", { cause: parsed.error })
    );
    await storeResponse(response);
    return NextResponse.json(response, { status: 400 });
  }

  const response = await searchForesttrip(parsed.data);
  await storeResponse(response);
  return NextResponse.json(response, { status: httpStatusForResponse(response) });
}
