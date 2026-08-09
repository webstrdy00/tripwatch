import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { TripWatchError } from "@/lib/errors";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { createAlertRule, listAlertRules, reloadWatchItem } from "@/lib/services/alert-rule-service";
import { serializeWatchItem } from "@/lib/watchlist";
import { databaseIdSchema } from "@/lib/validation/common-schema";

const SOURCE = "tripwatch:alert-rules";
const DEFAULT_LIST_PAGE_SIZE = 100;
const MAX_LIST_PAGE_SIZE = 100;

export const dynamic = "force-dynamic";

const alertRuleCreateSchema = z.object({
  watchItemId: databaseIdSchema,
  condition: z.unknown()
}).strict();

const alertRuleListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIST_PAGE_SIZE).default(DEFAULT_LIST_PAGE_SIZE)
});

function jsonError(error: unknown) {
  const normalizedError =
    error instanceof TripWatchError && error.code === "VALIDATION_ERROR"
      ? new TripWatchError("ALERT_VALIDATION_ERROR", "알림 규칙 요청 값이 올바르지 않습니다.")
      : error;
  const routeError = buildApiRouteError(normalizedError, SOURCE);

  return NextResponse.json(routeError.body, { status: routeError.status });
}

export async function GET(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const parsedQuery = alertRuleListQuerySchema.safeParse({
      limit: new URL(request.url).searchParams.get("limit") ?? undefined
    });
    if (!parsedQuery.success) {
      throw new TripWatchError("ALERT_VALIDATION_ERROR", "알림 규칙 목록 요청 값이 올바르지 않습니다.");
    }
    const items = (await listAlertRules()).slice(0, parsedQuery.data.limit);

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: `${items.length}개 알림 규칙`,
        data: { items }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const input = await parseJsonBodyWithSchema(request, alertRuleCreateSchema);
    const rule = await createAlertRule(input);
    const item = serializeWatchItem(await reloadWatchItem(rule.watchItemId));

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "알림 규칙을 저장했습니다.",
        data: { item }
      }),
      { status: 201 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
