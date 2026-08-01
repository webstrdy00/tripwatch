import type { TripWatchStatus } from "@/lib/api-response";
import type {
  AlertBaselineState,
  AlertChannel,
  AlertCondition,
  AlertDeliveryState,
  AlertLatestOutcome,
  PublicAlertRule
} from "@/lib/alerts/types";
import type { WatchItemType } from "@/lib/validation/common-schema";

export const watchItemInclude = {
  results: {
    orderBy: [
      { checkedAt: "desc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const }
    ],
    take: 1
  },
  alertRule: true
};

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
  alertRule: PublicAlertRule | null;
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

type RawAlertRule = {
  id: string;
  watchItemId: string;
  channel: string;
  conditionJson: string;
  enabled: boolean;
  outboundOptIn: boolean;
  configVersion: number;
  latestOutcome: string;
  latestOutcomeAt: Date | null;
  latestOutcomeCode: string | null;
  baselineState: string;
  baselineFingerprint: string | null;
  baselineTransitionSeq: number;
  baselineAt: Date | null;
  deliveryState: string;
  attemptId: string | null;
  attemptRunId: string | null;
  attemptFingerprint: string | null;
  attemptTransitionSeq: number | null;
  attemptResultId: string | null;
  attemptResultType: string | null;
  lastAttemptAt: Date | null;
  terminalAt: Date | null;
  deliveryCode: string | null;
  lastProviderRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  alertRule?: RawAlertRule | null;
};

type ParamsRecord = Record<string, unknown>;

function asStatus(value: string): TripWatchStatus {
  return value === "success" || value === "partial" || value === "failed" ? value : "failed";
}

function asWatchItemType(value: string): WatchItemType {
  if (value === "flight" || value === "express_bus" || value === "intercity_bus" || value === "ticket" || value === "foresttrip") {
    return value;
  }

  return "ticket";
}

function toIsoDate(value: Date): string {
  return value.toISOString();
}

function toOptionalIsoDate(value: Date | null): string | null {
  return value ? toIsoDate(value) : null;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function parsePublicAlertCondition(conditionJson: string): AlertCondition | undefined {
  try {
    const parsed: unknown = JSON.parse(conditionJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const condition = parsed as {
      kind?: unknown;
      maxDisplayedPriceKrw?: unknown;
      minSeats?: unknown;
    };

    if (typeof condition.kind !== "string") {
      return undefined;
    }

    if (
      (condition.kind === "displayed_price_at_or_below" || condition.kind === "date_displayed_price_at_or_below") &&
      hasExactKeys(condition, ["kind", "maxDisplayedPriceKrw"]) &&
      typeof condition.maxDisplayedPriceKrw === "number" &&
      Number.isSafeInteger(condition.maxDisplayedPriceKrw) &&
      condition.maxDisplayedPriceKrw >= 1 &&
      condition.maxDisplayedPriceKrw <= 100_000_000
    ) {
      return { kind: condition.kind, maxDisplayedPriceKrw: condition.maxDisplayedPriceKrw };
    }

    if (
      condition.kind === "seats_at_or_above" &&
      hasExactKeys(condition, ["kind", "minSeats"]) &&
      typeof condition.minSeats === "number" &&
      Number.isSafeInteger(condition.minSeats) &&
      condition.minSeats >= 1 &&
      condition.minSeats <= 99
    ) {
      return { kind: "seats_at_or_above", minSeats: condition.minSeats };
    }

    if (condition.kind === "availability" && hasExactKeys(condition, ["kind"])) {
      return { kind: "availability" };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function asAlertChannel(value: string): AlertChannel | undefined {
  return value === "telegram" ? value : undefined;
}

function asAlertLatestOutcome(value: string): AlertLatestOutcome | undefined {
  return value === "never" ||
    value === "success_matched" ||
    value === "success_no_match" ||
    value === "partial" ||
    value === "failed" ||
    value === "blocked_source" ||
    value === "unsupported_shape" ||
    value === "result_type_mismatch" ||
    value === "result_superseded" ||
    value === "parent_disabled" ||
    value === "failed_cooldown" ||
    value === "config_invalid" ||
    value === "message_invalid" ||
    value === "config_changed"
    ? value
    : undefined;
}

function asAlertBaselineState(value: string): AlertBaselineState | undefined {
  return value === "never" || value === "matched" || value === "no_match" ? value : undefined;
}

function asAlertDeliveryState(value: string): AlertDeliveryState | undefined {
  return value === "never" ||
    value === "reserved" ||
    value === "sending" ||
    value === "sent" ||
    value === "rejected" ||
    value === "ambiguous" ||
    value === "suppressed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function serializeAlertRule(rule: RawAlertRule | null | undefined): PublicAlertRule | null {
  if (!rule) {
    return null;
  }

  const condition = parsePublicAlertCondition(rule.conditionJson);
  const channel = asAlertChannel(rule.channel);
  const latestOutcome = asAlertLatestOutcome(rule.latestOutcome);
  const baselineState = asAlertBaselineState(rule.baselineState);
  const deliveryState = asAlertDeliveryState(rule.deliveryState);

  if (
    !condition ||
    !channel ||
    !latestOutcome ||
    !baselineState ||
    !deliveryState ||
    !Number.isSafeInteger(rule.configVersion) ||
    !Number.isSafeInteger(rule.baselineTransitionSeq)
  ) {
    return null;
  }

  return {
    id: rule.id,
    watchItemId: rule.watchItemId,
    channel,
    condition,
    enabled: rule.enabled,
    outboundOptIn: rule.outboundOptIn,
    configVersion: rule.configVersion,
    latestOutcome,
    latestOutcomeAt: toOptionalIsoDate(rule.latestOutcomeAt),
    latestOutcomeCode: rule.latestOutcomeCode,
    baselineState,
    baselineTransitionSeq: rule.baselineTransitionSeq,
    baselineAt: toOptionalIsoDate(rule.baselineAt),
    deliveryState,
    lastAttemptAt: toOptionalIsoDate(rule.lastAttemptAt),
    terminalAt: toOptionalIsoDate(rule.terminalAt),
    deliveryCode: rule.deliveryCode,
    lastProviderRunAt: toOptionalIsoDate(rule.lastProviderRunAt),
    createdAt: toIsoDate(rule.createdAt),
    updatedAt: toIsoDate(rule.updatedAt)
  };
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
      : undefined,
    alertRule: serializeAlertRule(item.alertRule)
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

  if (item.type === "foresttrip") {
    const forestName = getString(params, "forestName") ?? "?";
    const date = getString(params, "date") ?? "?";
    const category = getString(params, "category") ?? "?";
    return `${forestName} / ${date} / ${category}`;
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
