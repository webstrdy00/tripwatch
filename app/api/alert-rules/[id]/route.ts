import { NextResponse } from "next/server";
import { z } from "zod";

import { assertNoRequestBody, parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { TripWatchError } from "@/lib/errors";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import {
  deleteAlertRuleDraft,
  disableAlertRule,
  reloadWatchItem,
  updateAlertRule
} from "@/lib/services/alert-rule-service";
import { serializeWatchItem } from "@/lib/watchlist";
import { parseDatabaseId } from "@/lib/validation/common-schema";

const SOURCE = "tripwatch:alert-rules";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const alertRuleUpdateSchema = z.object({
  configVersion: z.number().int().positive(),
  condition: z.unknown().optional(),
  enabled: z.boolean().optional(),
  outboundOptIn: z.boolean().optional(),
  channel: z.literal("telegram").optional()
}).strict().superRefine((value, context) => {
  const keys = Object.keys(value).sort();
  const hasExactKeys = (expected: string[]) =>
    keys.length === expected.length && keys.every((key, index) => key === expected.sort()[index]);

  if (value.enabled === true) {
    if (!hasExactKeys(["channel", "configVersion", "enabled", "outboundOptIn"]) || value.outboundOptIn !== true || value.channel !== "telegram") {
      context.addIssue({ code: "custom", message: "활성화 요청에는 명시적 Telegram 전송 동의가 필요합니다." });
    }
    return;
  }

  if (value.enabled === false) {
    if (
      !hasExactKeys(["channel", "configVersion", "enabled", "outboundOptIn"]) ||
      value.outboundOptIn !== false ||
      value.channel !== "telegram"
    ) {
      context.addIssue({ code: "custom", message: "비활성화 요청에는 명시적 Telegram 전송 거부가 필요합니다." });
    }
    return;
  }

  if (!hasExactKeys(["condition", "configVersion"])) {
    context.addIssue({ code: "custom", message: "수정할 알림 조건이 필요합니다." });
  }
});

function jsonError(error: unknown) {
  const normalizedError =
    error instanceof TripWatchError && error.code === "VALIDATION_ERROR"
      ? new TripWatchError("ALERT_VALIDATION_ERROR", "알림 규칙 요청 값이 올바르지 않습니다.")
      : error;
  const routeError = buildApiRouteError(normalizedError, SOURCE);

  return NextResponse.json(routeError.body, { status: routeError.status });
}


export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertLocalOperatorRequest(request);
    const id = parseDatabaseId((await context.params).id);
    const input = await parseJsonBodyWithSchema(request, alertRuleUpdateSchema);
    const rule = input.enabled === false
      ? await disableAlertRule(id, input.configVersion)
      : await updateAlertRule({ id, ...input });
    const item = serializeWatchItem(await reloadWatchItem(rule.watchItemId));

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "알림 규칙을 수정했습니다.",
        data: { item }
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
    const item = serializeWatchItem(await deleteAlertRuleDraft(id));

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "알림 규칙을 삭제했습니다.",
        data: { item }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
