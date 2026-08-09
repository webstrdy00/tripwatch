import { NextResponse } from "next/server";

import { parseJsonBodyWithSchema } from "@/lib/api-response";
import { apiErrorStatus } from "@/lib/api-error-status";
import { buildApiRouteError } from "@/lib/api-route-error";
import { createQueryResultFromResponse, preflightWatchItemAssociation } from "@/lib/result-store";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { searchIntercityBuses } from "@/lib/services/intercity-bus-service";
import { intercityBusSearchRequestSchema } from "@/lib/validation/bus-schema";

const SOURCE = "tmoney-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const { watchItemId, ...input } = await parseJsonBodyWithSchema(request, intercityBusSearchRequestSchema);
    const association = await preflightWatchItemAssociation(watchItemId, "intercity_bus");
    const response = await searchIntercityBuses(input);

    await createQueryResultFromResponse({
      type: "intercity_bus",
      response,
      watchItemId,
      association
    });

    return NextResponse.json(response, {
      status: response.status === "failed" ? apiErrorStatus(response.error) : 200
    });
  } catch (error) {
    const routeError = buildApiRouteError(error, SOURCE);
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
