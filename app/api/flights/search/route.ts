import { NextResponse } from "next/server";

import { parseJsonBodyWithSchema } from "@/lib/api-response";
import { apiErrorStatus } from "@/lib/api-error-status";
import { buildApiRouteError } from "@/lib/api-route-error";
import { createQueryResultFromResponse, preflightWatchItemAssociation } from "@/lib/result-store";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { searchFlights } from "@/lib/services/flight-service";
import { flightSearchRequestSchema } from "@/lib/validation/flight-schema";

export const dynamic = "force-dynamic";

const SOURCE = "google-flights-link";

function jsonError(error: unknown) {
  const routeError = buildApiRouteError(error, SOURCE);
  return NextResponse.json(routeError.body, { status: routeError.status });
}

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const { watchItemId, ...input } = await parseJsonBodyWithSchema(request, flightSearchRequestSchema);
    const association = await preflightWatchItemAssociation(watchItemId, "flight");
    const response = await searchFlights(input);

    await createQueryResultFromResponse({
      type: "flight",
      response,
      watchItemId,
      association
    });

    return NextResponse.json(response, {
      status: response.status === "failed" ? apiErrorStatus(response.error) : 200
    });
  } catch (error) {
    return jsonError(error);
  }
}
