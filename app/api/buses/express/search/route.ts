import { NextResponse } from "next/server";

import { parseJsonBodyWithSchema } from "@/lib/api-response";
import { apiErrorStatus } from "@/lib/api-error-status";
import { buildApiRouteError } from "@/lib/api-route-error";
import { createQueryResultFromResponse, preflightWatchItemAssociation } from "@/lib/result-store";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { searchExpressBuses } from "@/lib/services/express-bus-service";
import { expressBusSearchRequestSchema } from "@/lib/validation/bus-schema";

const SOURCE = "kobus-link";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const { watchItemId, ...input } = await parseJsonBodyWithSchema(request, expressBusSearchRequestSchema);
    const association = await preflightWatchItemAssociation(watchItemId, "express_bus");
    const response = await searchExpressBuses(input);

    await createQueryResultFromResponse({
      type: "express_bus",
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
