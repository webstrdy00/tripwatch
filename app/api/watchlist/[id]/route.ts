import { NextResponse } from "next/server";

import { assertNoRequestBody, parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { TripWatchError } from "@/lib/errors";
import {
  deleteWatchItemWithAlertRuleLifecycle,
  updateWatchItemWithAlertRuleLifecycle
} from "@/lib/services/alert-rule-service";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { serializeWatchItem } from "@/lib/watchlist";
import { parseDatabaseId } from "@/lib/validation/common-schema";
import { watchItemUpdateSchema } from "@/lib/validation/watchlist-schema";

const SOURCE = "tripwatch:watchlist";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};


function jsonError(error: unknown) {
  const normalizedError =
    error instanceof TripWatchError && error.code === "VALIDATION_ERROR"
      ? new TripWatchError("ALERT_VALIDATION_ERROR", "관심 조건 수정 요청 값이 올바르지 않습니다.")
      : error;
  const routeError = buildApiRouteError(normalizedError, SOURCE);

  return NextResponse.json(routeError.body, { status: routeError.status });
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertLocalOperatorRequest(request);
    const id = parseDatabaseId((await context.params).id);
    const patch = await parseJsonBodyWithSchema(request, watchItemUpdateSchema);
    const item = await updateWatchItemWithAlertRuleLifecycle({ id, ...patch });

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "관심 조건을 수정했습니다.",
        data: {
          item: serializeWatchItem(item)
        }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    assertLocalOperatorRequest(request);
    await assertNoRequestBody(request);
    const id = parseDatabaseId((await context.params).id);
    await deleteWatchItemWithAlertRuleLifecycle(id);

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "관심 조건을 삭제했습니다.",
        data: { id }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
