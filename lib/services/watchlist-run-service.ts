import type { QueryResult, WatchItem } from "@prisma/client";

import { failedResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { db } from "@/lib/db";
import { summarizeError, type TripWatchErrorCode } from "@/lib/errors";
import {
  buildExpressBusOfficialUrl,
  buildIntercityBusOfficialUrl,
  getOfficialUrl,
  getTicketOfficialUrlFromInput
} from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { searchExpressBuses } from "@/lib/services/express-bus-service";
import { compareFlightMonth, searchFlights } from "@/lib/services/flight-service";
import { searchIntercityBuses } from "@/lib/services/intercity-bus-service";
import { getTicketSchedule, getTicketSeats } from "@/lib/services/ticket-service";
import { searchForesttrip } from "@/lib/services/foresttrip-service";
import { expressBusSearchSchema, intercityBusSearchSchema } from "@/lib/validation/bus-schema";
import type { WatchItemType } from "@/lib/validation/common-schema";
import { flightCompareMonthSchema, flightSearchSchema } from "@/lib/validation/flight-schema";
import { ticketLookupSchema } from "@/lib/validation/ticket-schema";
import { foresttripSearchSchema } from "@/lib/validation/foresttrip-schema";

export const WATCHLIST_RUN_SOURCE = "tripwatch:watchlist-run";
export const FAILED_RERUN_COOLDOWN_MS = 60_000;

type RunnableWatchItem = Pick<WatchItem, "id" | "type" | "title" | "paramsJson" | "enabled">;

export type WatchItemRunResult = {
  item?: RunnableWatchItem;
  response: TripWatchApiResponse<unknown>;
};

function parseParamsJson(paramsJson: string): unknown {
  try {
    return JSON.parse(paramsJson) as unknown;
  } catch {
    return undefined;
  }
}

function errorIssues(rawParams: unknown, message: string, source: string, officialUrl?: string): TripWatchApiResponse<unknown> {
  return failedResponse({
    source,
    officialUrl,
    summary: message,
    error: {
      code: "VALIDATION_ERROR",
      message,
      raw: typeof rawParams === "undefined" ? "관심 조건 JSON이 올바르지 않습니다." : undefined
    }
  });
}

function validationFailedResponse(
  message: string,
  rawIssues: string,
  source: string,
  officialUrl?: string
): TripWatchApiResponse<unknown> {
  return failedResponse({
    source,
    officialUrl,
    summary: message,
    error: {
      code: "VALIDATION_ERROR",
      message,
      raw: rawIssues
    }
  });
}

function hasCompareMonthParams(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const params = value as Record<string, unknown>;

  return typeof params.yearMonth === "string" || typeof params.month === "string" || typeof params.sample === "string";
}

function ticketOfficialUrlFromParams(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = (value as Record<string, unknown>).input;

  return typeof input === "string" ? getTicketOfficialUrlFromInput(input) : undefined;
}

function officialUrlForItem(item: RunnableWatchItem): string | undefined {
  if (item.type === "flight") {
    return getOfficialUrl("flight");
  }

  if (item.type === "express_bus") {
    return buildExpressBusOfficialUrl();
  }

  if (item.type === "intercity_bus") {
    return buildIntercityBusOfficialUrl();
  }

  if (item.type === "ticket") {
    return ticketOfficialUrlFromParams(parseParamsJson(item.paramsJson));
  }

  if (item.type === "foresttrip") {
    return getOfficialUrl("foresttrip");
  }

  return undefined;
}

export function isFailedRerunCooldownActive(
  result: Pick<QueryResult, "status" | "checkedAt"> | undefined,
  now = new Date()
): boolean {
  return Boolean(
    result?.status === "failed" &&
      now.getTime() - result.checkedAt.getTime() < FAILED_RERUN_COOLDOWN_MS
  );
}

function zodIssueMessages(issues: { message: string }[]): string {
  return issues.map((issue) => issue.message).join("; ");
}

async function saveRunResult(item: RunnableWatchItem, response: TripWatchApiResponse<unknown>): Promise<void> {
  await createQueryResultFromResponse({
    type: item.type,
    response,
    watchItemId: item.id
  });
}

async function runFlight(rawParams: unknown): Promise<TripWatchApiResponse<unknown>> {
  if (typeof rawParams === "undefined") {
    return errorIssues(rawParams, "저장된 항공권 조건이 올바르지 않습니다.", "google-flights-link", getOfficialUrl("flight"));
  }

  if (hasCompareMonthParams(rawParams)) {
    const parsed = flightCompareMonthSchema.safeParse(rawParams);

    if (!parsed.success) {
      return validationFailedResponse(
        "저장된 항공권 월별 비교 조건이 올바르지 않습니다.",
        zodIssueMessages(parsed.error.issues),
        "google-flights-link",
        getOfficialUrl("flight")
      );
    }

    return compareFlightMonth(parsed.data);
  }

  const parsed = flightSearchSchema.safeParse(rawParams);

  if (!parsed.success) {
    return validationFailedResponse(
      "저장된 항공권 조건이 올바르지 않습니다.",
      zodIssueMessages(parsed.error.issues),
      "google-flights-link",
      getOfficialUrl("flight")
    );
  }

  return searchFlights(parsed.data);
}

async function runExpressBus(rawParams: unknown): Promise<TripWatchApiResponse<unknown>> {
  if (typeof rawParams === "undefined") {
    return errorIssues(rawParams, "저장된 고속버스 조건이 올바르지 않습니다.", "kobus-link", buildExpressBusOfficialUrl());
  }

  const parsed = expressBusSearchSchema.safeParse(rawParams);

  if (!parsed.success) {
    return validationFailedResponse(
      "저장된 고속버스 조건이 올바르지 않습니다.",
      zodIssueMessages(parsed.error.issues),
      "kobus-link",
      buildExpressBusOfficialUrl()
    );
  }

  return searchExpressBuses(parsed.data);
}

async function runIntercityBus(rawParams: unknown): Promise<TripWatchApiResponse<unknown>> {
  if (typeof rawParams === "undefined") {
    return errorIssues(rawParams, "저장된 시외버스 조건이 올바르지 않습니다.", "tmoney-link", buildIntercityBusOfficialUrl());
  }

  const parsed = intercityBusSearchSchema.safeParse(rawParams);

  if (!parsed.success) {
    return validationFailedResponse(
      "저장된 시외버스 조건이 올바르지 않습니다.",
      zodIssueMessages(parsed.error.issues),
      "tmoney-link",
      buildIntercityBusOfficialUrl()
    );
  }

  return searchIntercityBuses(parsed.data);
}

async function runTicket(rawParams: unknown): Promise<TripWatchApiResponse<unknown>> {
  if (typeof rawParams === "undefined") {
    return errorIssues(rawParams, "저장된 공연 조건이 올바르지 않습니다.", "ticket-official-link");
  }

  const parsed = ticketLookupSchema.safeParse(rawParams);

  if (!parsed.success) {
    return validationFailedResponse(
      "저장된 공연 조건이 올바르지 않습니다.",
      zodIssueMessages(parsed.error.issues),
      "ticket-official-link",
      ticketOfficialUrlFromParams(rawParams)
    );
  }

  return parsed.data.mode === "schedule" ? getTicketSchedule(parsed.data) : getTicketSeats(parsed.data);
}
async function runForesttrip(rawParams: unknown): Promise<TripWatchApiResponse<unknown>> {
  if (typeof rawParams === "undefined") {
    return errorIssues(rawParams, "저장된 자연휴양림 조건이 올바르지 않습니다.", "foresttrip-official-link", getOfficialUrl("foresttrip"));
  }

  const parsed = foresttripSearchSchema.safeParse(rawParams);

  if (!parsed.success) {
    return validationFailedResponse(
      "저장된 자연휴양림 조건이 올바르지 않습니다.",
      zodIssueMessages(parsed.error.issues),
      "foresttrip-official-link",
      getOfficialUrl("foresttrip")
    );
  }

  return searchForesttrip(parsed.data);
}


async function dispatchWatchItem(item: RunnableWatchItem): Promise<TripWatchApiResponse<unknown>> {
  const rawParams = parseParamsJson(item.paramsJson);

  if (item.type === "flight") {
    return runFlight(rawParams);
  }

  if (item.type === "express_bus") {
    return runExpressBus(rawParams);
  }

  if (item.type === "intercity_bus") {
    return runIntercityBus(rawParams);
  }

  if (item.type === "ticket") {
    return runTicket(rawParams);
  }
  if (item.type === "foresttrip") {
    return runForesttrip(rawParams);
  }


  return failedResponse({
    source: WATCHLIST_RUN_SOURCE,
    summary: "이 관심 조건 유형은 아직 다시 조회를 지원하지 않습니다.",
    error: {
      code: "NOT_IMPLEMENTED",
      message: "이 관심 조건 유형은 아직 다시 조회를 지원하지 않습니다."
    }
  });
}

export async function runWatchItem(item: RunnableWatchItem): Promise<WatchItemRunResult> {
  if (!item.enabled) {
    const response = failedResponse({
      source: WATCHLIST_RUN_SOURCE,
      officialUrl: officialUrlForItem(item),
      summary: "비활성 관심 조건은 다시 조회할 수 없습니다.",
      error: {
        code: "DISABLED_WATCH_ITEM",
        message: "비활성 관심 조건은 다시 조회할 수 없습니다."
      }
    });

    await saveRunResult(item, response);

    return {
      item,
      response
    };
  }

  let response: TripWatchApiResponse<unknown>;

  try {
    response = await dispatchWatchItem(item);
  } catch (error) {
    const message = summarizeError(error);

    response = failedResponse({
      source: WATCHLIST_RUN_SOURCE,
      officialUrl: officialUrlForItem(item),
      summary: message,
      error: {
        code: "UNKNOWN_ERROR",
        message
      }
    });
  }

  await saveRunResult(item, response);

  return {
    item,
    response
  };
}

export async function runWatchItemById(id: string): Promise<WatchItemRunResult> {
  const item = await db.watchItem.findUnique({
    where: {
      id
    },
    include: {
      results: {
        orderBy: [
          {
            checkedAt: "desc"
          },
          {
            createdAt: "desc"
          },
          {
            id: "desc"
          }
        ],
        take: 1,
        select: {
          status: true,
          checkedAt: true
        }
      }
    }
  });

  if (!item) {
    return {
      response: failedResponse({
        source: WATCHLIST_RUN_SOURCE,
        summary: "관심 조건을 찾을 수 없습니다.",
        error: {
          code: "WATCH_ITEM_NOT_FOUND",
          message: "관심 조건을 찾을 수 없습니다."
        }
      })
    };
  }

  if (item.enabled && isFailedRerunCooldownActive(item.results[0])) {
    return {
      item,
      response: failedResponse({
        source: WATCHLIST_RUN_SOURCE,
        officialUrl: officialUrlForItem(item),
        summary: "마지막 실패 후 1분이 지나야 다시 조회할 수 있습니다.",
        error: {
          code: "FAILED_RERUN_COOLDOWN",
          message: "마지막 실패 후 1분이 지나야 다시 조회할 수 있습니다."
        }
      })
    };
  }

  return runWatchItem(item);
}

export function httpStatusForRunResponse(response: TripWatchApiResponse<unknown>): number {
  if (response.status !== "failed") {
    return 200;
  }

  const errorCode = response.error?.code as TripWatchErrorCode | undefined;

  if (errorCode === "VALIDATION_ERROR") {
    return 400;
  }

  if (errorCode === "WATCH_ITEM_NOT_FOUND") {
    return 404;
  }

  if (errorCode === "DISABLED_WATCH_ITEM") {
    return 409;
  }

  if (errorCode === "FAILED_RERUN_COOLDOWN") {
    return 429;
  }

  if (errorCode === "NOT_IMPLEMENTED") {
    return 501;
  }

  if (errorCode === "TERMINAL_NOT_FOUND" || errorCode === "NO_RESULTS" || errorCode === "NO_SCHEDULE") {
    return 404;
  }

  if (errorCode === "HELPER_TIMEOUT") {
    return 504;
  }

  if (errorCode === "HELPER_FAILED" || errorCode === "PARSE_ERROR") {
    return 502;
  }

  return 500;
}

export function isWatchItemType(value: string): value is WatchItemType {
  return value === "flight" || value === "express_bus" || value === "intercity_bus" || value === "ticket" || value === "foresttrip";
}
