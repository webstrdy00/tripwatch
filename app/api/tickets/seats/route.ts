import { NextResponse } from "next/server";

import { parseJsonBodyWithSchema } from "@/lib/api-response";
import { apiErrorStatus } from "@/lib/api-error-status";
import { buildApiRouteError } from "@/lib/api-route-error";
import { createQueryResultFromResponse, preflightWatchItemAssociation } from "@/lib/result-store";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { getTicketSeats } from "@/lib/services/ticket-service";
import { ticketSeatsRequestSchema } from "@/lib/validation/ticket-schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const { watchItemId, ...input } = await parseJsonBodyWithSchema(request, ticketSeatsRequestSchema);
    const association = await preflightWatchItemAssociation(watchItemId, "ticket");
    const response = await getTicketSeats(input);

    await createQueryResultFromResponse({
      type: "ticket",
      response,
      watchItemId: watchItemId ?? null,
      association
    });

    return NextResponse.json(response, {
      status: response.status === "failed" ? apiErrorStatus(response.error) : 200
    });
  } catch (error) {
    const routeError = buildApiRouteError(error, "ticket-official-link");
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
