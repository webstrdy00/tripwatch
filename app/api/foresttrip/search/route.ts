import { NextResponse } from "next/server";

import { type TripWatchApiResponse, parseJsonBodyWithSchema } from "@/lib/api-response";
import { apiErrorStatus } from "@/lib/api-error-status";
import { buildApiRouteError } from "@/lib/api-route-error";
import type { ForesttripSearchData } from "@/lib/normalize/normalize-foresttrip";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { searchForesttrip } from "@/lib/services/foresttrip-service";
import { foresttripRequestSchema } from "@/lib/validation/foresttrip-schema";

export const dynamic = "force-dynamic";


async function storeResponse(response: TripWatchApiResponse<ForesttripSearchData>) {
  await createQueryResultFromResponse({
    type: "foresttrip",
    response
  });
}

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const input = await parseJsonBodyWithSchema(request, foresttripRequestSchema);
    const response = await searchForesttrip(input);
    await storeResponse(response);

    return NextResponse.json(response, {
      status: response.status === "failed" ? apiErrorStatus(response.error) : 200
    });
  } catch (error) {
    const routeError = buildApiRouteError(error, "foresttrip-official-link");
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
