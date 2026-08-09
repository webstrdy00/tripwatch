import type { QueryResult, WatchItem } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import type { TripWatchApiResponse, TripWatchStatus } from "@/lib/api-response";
import { parseJsonBodyWithSchema } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { db } from "@/lib/db";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { isFailedRerunCooldownActive, runWatchItem } from "@/lib/services/watchlist-run-service";
import type { WatchItemType } from "@/lib/validation/common-schema";

const SOURCE = "tripwatch:watchlist-run-batch";
const MAX_BATCH_LIMIT = 10;

export const dynamic = "force-dynamic";

type BatchWatchItemType = WatchItemType;

type BatchWatchItem = Pick<WatchItem, "id" | "type" | "title" | "paramsJson" | "enabled"> & {
  results: Pick<QueryResult, "status" | "checkedAt">[];
};

export type BatchRunItemResult = {
  watchItemId: string;
  title: string;
  type: string;
  status?: TripWatchStatus;
  checkedAt?: string;
  summary?: string;
  officialUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  skipped: boolean;
  skipReason?: string;
};

export type WatchlistBatchRunData = {
  requested: {
    type?: BatchWatchItemType;
    failedOnly: boolean;
    includeTickets: boolean;
    includeForesttrip: boolean;
    limit: number;
  };
  checkedAt: string;
  totalCandidates: number;
  executedCount: number;
  skippedCount: number;
  results: BatchRunItemResult[];
};

const batchTypeSchema = z.enum(["flight", "express_bus", "intercity_bus", "ticket", "foresttrip"]);

function normalizeInteger(value: unknown): unknown {
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }

  return value;
}

const runBatchSchema = z.object({
  type: batchTypeSchema.optional(),
  failedOnly: z.boolean().default(false),
  includeTickets: z.boolean().default(false),
  includeForesttrip: z.boolean().default(false),
  limit: z
    .preprocess(normalizeInteger, z.number().int().min(1).default(MAX_BATCH_LIMIT))
    .transform((value) => Math.min(value, MAX_BATCH_LIMIT))
}).strict();

type RunBatchInput = z.infer<typeof runBatchSchema>;

const watchItemInclude = {
  results: {
    orderBy: [
      {
        checkedAt: "desc" as const
      },
      {
        createdAt: "desc" as const
      },
      {
        id: "desc" as const
      }
    ],
    take: 1
  }
};


function targetTypes(input: RunBatchInput): string[] {
  if (input.type === "ticket" && !input.includeTickets) {
    return [];
  }

  if (input.type === "foresttrip" && !input.includeForesttrip) {
    return [];
  }

  if (input.type) {
    return [input.type];
  }

  const types = ["flight", "express_bus", "intercity_bus"];

  if (input.includeTickets) {
    types.push("ticket");
  }

  if (input.includeForesttrip) {
    types.push("foresttrip");
  }

  return types;
}

function latestResult(item: BatchWatchItem): Pick<QueryResult, "status" | "checkedAt"> | undefined {
  return item.results[0];
}

function isLatestFailed(item: BatchWatchItem): boolean {
  return latestResult(item)?.status === "failed";
}

function skippedResult(item: BatchWatchItem): BatchRunItemResult {
  return {
    watchItemId: item.id,
    title: item.title,
    type: item.type,
    skipped: true,
    skipReason: "FAILED_RERUN_COOLDOWN",
    summary: "마지막 실패 후 1분이 지나지 않아 다시 조회를 건너뛰었습니다."
  };
}

function resultFromResponse(item: BatchWatchItem, response: TripWatchApiResponse<unknown>): BatchRunItemResult {
  return {
    watchItemId: item.id,
    title: item.title,
    type: item.type,
    status: response.status,
    checkedAt: response.checkedAt,
    summary: response.summary ?? response.error?.message,
    officialUrl: response.officialUrl,
    errorCode: response.error?.code,
    errorMessage: response.error?.message,
    skipped: false
  };
}

function batchStatus(results: BatchRunItemResult[]): TripWatchStatus {
  const executed = results.filter((result) => !result.skipped);

  if (executed.length === 0) {
    return "failed";
  }

  if (results.some((result) => result.skipped)) {
    return "partial";
  }

  if (executed.every((result) => result.status === "success")) {
    return "success";
  }

  if (executed.every((result) => result.status === "failed")) {
    return "failed";
  }

  return "partial";
}

function batchSummary(data: WatchlistBatchRunData, status: TripWatchStatus): string {
  if (data.totalCandidates === 0) {
    if (data.requested.type === "ticket" && !data.requested.includeTickets) {
      return "공연 관심 조건은 includeTickets=true일 때만 다시 조회합니다.";
    }

    if (data.requested.type === "foresttrip" && !data.requested.includeForesttrip) {
      return "자연휴양림 관심 조건은 includeForesttrip=true일 때만 다시 조회합니다.";
    }

    return "다시 조회할 관심 조건이 없습니다.";
  }

  const skippedText = data.skippedCount > 0 ? `, 건너뜀 ${data.skippedCount}개` : "";
  const statusText = status === "success" ? "완료" : status === "partial" ? "부분 완료" : "실패";

  return `관심 조건 다시 조회 ${statusText}: 실행 ${data.executedCount}개${skippedText}.`;
}

function batchResponse(data: WatchlistBatchRunData): TripWatchApiResponse<WatchlistBatchRunData> {
  const status = batchStatus(data.results);
  const summary = batchSummary(data, status);

  return {
    status,
    checkedAt: data.checkedAt,
    source: SOURCE,
    summary,
    data,
    error:
      status === "failed"
        ? {
            code: data.executedCount === 0 ? "NO_RESULTS" : "UNKNOWN_ERROR",
            message: summary
          }
        : undefined
  };
}


export async function POST(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const input = await parseJsonBodyWithSchema(request, runBatchSchema);
    const types = targetTypes(input);
    const allCandidates =
      types.length === 0
        ? []
        : await db.watchItem.findMany({
            where: {
              enabled: true,
              type: {
                in: types
              }
            },
            orderBy: {
              updatedAt: "desc"
            },
            include: watchItemInclude
          });
    const candidates = input.failedOnly ? allCandidates.filter(isLatestFailed) : allCandidates;
    const limitedCandidates = candidates.slice(0, input.limit);
    const results: BatchRunItemResult[] = [];

    for (const item of limitedCandidates) {
      if (isFailedRerunCooldownActive(latestResult(item), new Date())) {
        results.push(skippedResult(item));
        continue;
      }

      const { response } = await runWatchItem(item);
      results.push(resultFromResponse(item, response));
    }

    const data: WatchlistBatchRunData = {
      requested: {
        type: input.type,
        failedOnly: input.failedOnly,
        includeTickets: input.includeTickets,
        includeForesttrip: input.includeForesttrip,
        limit: input.limit
      },
      checkedAt: new Date().toISOString(),
      totalCandidates: candidates.length,
      executedCount: results.filter((result) => !result.skipped).length,
      skippedCount: results.filter((result) => result.skipped).length,
      results
    };

    return NextResponse.json(batchResponse(data));
  } catch (error) {
    const routeError = buildApiRouteError(error, SOURCE);
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
