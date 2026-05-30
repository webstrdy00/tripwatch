import type { TripWatchStatus } from "@/lib/api-response";
import type { WatchItemType } from "@/lib/validation/common-schema";

export type QueryResultListItem = {
  id: string;
  status: TripWatchStatus;
  source?: string;
  checkedAt: string;
  summary?: string;
  officialUrl?: string;
  errorCode?: string;
  errorText?: string;
  createdAt: string;
};

export type WatchItemListItem = {
  id: string;
  type: WatchItemType;
  title: string;
  paramsJson: string;
  memo?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  latestResult?: QueryResultListItem;
};

type RawQueryResult = {
  id: string;
  status: string;
  source: string | null;
  checkedAt: Date;
  summary: string | null;
  officialUrl: string | null;
  errorCode: string | null;
  errorText: string | null;
  createdAt: Date;
};

type RawWatchItem = {
  id: string;
  type: string;
  title: string;
  paramsJson: string;
  memo: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  results?: RawQueryResult[];
};

type ParamsRecord = Record<string, unknown>;

function asStatus(value: string): TripWatchStatus {
  return value === "success" || value === "partial" || value === "failed" ? value : "failed";
}

function asWatchItemType(value: string): WatchItemType {
  if (value === "flight" || value === "express_bus" || value === "intercity_bus" || value === "ticket") {
    return value;
  }

  return "ticket";
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

export function serializeWatchItem(item: RawWatchItem): WatchItemListItem {
  const latestResult = item.results?.[0];

  return {
    id: item.id,
    type: asWatchItemType(item.type),
    title: item.title,
    paramsJson: item.paramsJson,
    memo: item.memo ?? undefined,
    enabled: item.enabled,
    createdAt: toIsoDate(item.createdAt),
    updatedAt: toIsoDate(item.updatedAt),
    latestResult: latestResult
      ? {
          id: latestResult.id,
          status: asStatus(latestResult.status),
          source: latestResult.source ?? undefined,
          checkedAt: toIsoDate(latestResult.checkedAt),
          summary: latestResult.summary ?? undefined,
          officialUrl: latestResult.officialUrl ?? undefined,
          errorCode: latestResult.errorCode ?? undefined,
          errorText: latestResult.errorText ?? undefined,
          createdAt: toIsoDate(latestResult.createdAt)
        }
      : undefined
  };
}

export function serializeWatchItems(items: RawWatchItem[]): WatchItemListItem[] {
  return items.map((item) => serializeWatchItem(item));
}

function parseParams(paramsJson: string): ParamsRecord | undefined {
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ParamsRecord) : undefined;
  } catch {
    return undefined;
  }
}

function getString(params: ParamsRecord | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function summarizeWatchItemParams(item: Pick<WatchItemListItem, "type" | "paramsJson">): string {
  const params = parseParams(item.paramsJson);

  if (item.type === "flight") {
    const from = getString(params, "from") ?? "?";
    const to = getString(params, "to") ?? "?";
    const date = getString(params, "date") ?? "?";
    const returnDate = getString(params, "returnDate");
    const seat = getString(params, "seat") ?? "economy";
    return `${from} → ${to} / ${returnDate ? `${date} ~ ${returnDate}` : date} / ${seat}`;
  }

  if (item.type === "express_bus" || item.type === "intercity_bus") {
    const departName = getString(params, "departName") ?? "?";
    const arriveName = getString(params, "arriveName") ?? "?";
    const date = getString(params, "date") ?? "?";
    const time = getString(params, "time") ?? "00:00";
    return `${departName} → ${arriveName} / ${date} / ${time} 이후`;
  }

  const input = getString(params, "input") ?? "?";
  const mode = getString(params, "mode") ?? "seats";
  return `${input} / ${mode}`;
}

export function summarizeLatestResult(result: QueryResultListItem | undefined): string {
  if (!result) {
    return "아직 조회 결과가 없습니다.";
  }

  if (result.summary) {
    return result.summary;
  }

  if (result.errorText) {
    return result.errorText;
  }

  return result.status;
}
