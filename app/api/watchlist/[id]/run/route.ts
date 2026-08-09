import { NextResponse } from "next/server";

import { assertNoRequestBody } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import {
  httpStatusForRunResponse,
  runWatchItemById
} from "@/lib/services/watchlist-run-service";
import { parseDatabaseId } from "@/lib/validation/common-schema";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    assertLocalOperatorRequest(request);
    await assertNoRequestBody(request);
    const id = parseDatabaseId((await context.params).id);
    const { response } = await runWatchItemById(id);

    return NextResponse.json(response, {
      status: httpStatusForRunResponse(response)
    });
  } catch (error) {
    const routeError = buildApiRouteError(error, "tripwatch:watchlist-run");
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
