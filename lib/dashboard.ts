import type { QueryResult, WatchItem } from "@prisma/client";

import type { TripWatchStatus } from "@/lib/api-response";
import { db } from "@/lib/db";
import { serializeWatchItems, type WatchItemListItem } from "@/lib/watchlist";
import type { WatchItemType } from "@/lib/validation/common-schema";

export type DashboardResultItem = {
  id: string;
  watchItemId?: string;
  watchItemTitle?: string;
  type: WatchItemType;
  status: TripWatchStatus;
  source?: string;
  checkedAt: string;
  summary?: string;
  officialUrl?: string;
  errorCode?: string;
  errorText?: string;
};

export type DashboardSummaryData = {
  counts: {
    watchItems: number;
    enabledWatchItems: number;
    flights: number;
    buses: number;
    tickets: number;
    queryResults: number;
    successResults: number;
    partialResults: number;
    failedResults: number;
  };
  generatedAt: string;
  lastCheckedAt?: string;
  watchItems: WatchItemListItem[];
  recentResults: DashboardResultItem[];
  failedResults: DashboardResultItem[];
};

type RawDashboardResult = Pick<
  QueryResult,
  "id" | "watchItemId" | "type" | "status" | "source" | "checkedAt" | "summary" | "officialUrl" | "errorCode" | "errorText"
> & {
  watchItem: Pick<WatchItem, "id" | "title"> | null;
};

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

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function asStatus(value: string): TripWatchStatus {
  return value === "success" || value === "partial" || value === "failed" ? value : "failed";
}

function asWatchItemType(value: string): WatchItemType {
  if (value === "flight" || value === "express_bus" || value === "intercity_bus" || value === "ticket") {
    return value;
  }

  return "ticket";
}

function serializeResult(result: RawDashboardResult): DashboardResultItem {
  return {
    id: result.id,
    watchItemId: result.watchItemId ?? result.watchItem?.id ?? undefined,
    watchItemTitle: result.watchItem?.title ?? undefined,
    type: asWatchItemType(result.type),
    status: asStatus(result.status),
    source: result.source ?? undefined,
    checkedAt: toIsoDate(result.checkedAt),
    summary: result.summary ?? undefined,
    officialUrl: result.officialUrl ?? undefined,
    errorCode: result.errorCode ?? undefined,
    errorText: result.errorText ?? undefined
  };
}

export async function getDashboardSummary(): Promise<DashboardSummaryData> {
  const watchItems = await db.watchItem.findMany({
    orderBy: {
      updatedAt: "desc"
    },
    include: watchItemInclude
  });
  const recentResults = await db.queryResult.findMany({
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
    take: 10,
    include: {
      watchItem: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
  const failedResults = await db.queryResult.findMany({
    where: {
      status: "failed"
    },
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
    take: 10,
    include: {
      watchItem: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
  const queryResults = await db.queryResult.count();
  const successResults = await db.queryResult.count({
    where: {
      status: "success"
    }
  });
  const partialResults = await db.queryResult.count({
    where: {
      status: "partial"
    }
  });
  const failedResultCount = await db.queryResult.count({
    where: {
      status: "failed"
    }
  });

  return {
    counts: {
      watchItems: watchItems.length,
      enabledWatchItems: watchItems.filter((item) => item.enabled).length,
      flights: watchItems.filter((item) => item.type === "flight").length,
      buses: watchItems.filter((item) => item.type === "express_bus" || item.type === "intercity_bus").length,
      tickets: watchItems.filter((item) => item.type === "ticket").length,
      queryResults,
      successResults,
      partialResults,
      failedResults: failedResultCount
    },
    generatedAt: new Date().toISOString(),
    lastCheckedAt: recentResults[0] ? toIsoDate(recentResults[0].checkedAt) : undefined,
    watchItems: serializeWatchItems(watchItems).slice(0, 10),
    recentResults: recentResults.map(serializeResult),
    failedResults: failedResults.map(serializeResult)
  };
}
