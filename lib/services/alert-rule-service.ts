import type { Prisma, PrismaClient } from "@prisma/client";

import type { PublicAlertRule } from "@/lib/alerts/types";
import { db } from "@/lib/db";
import { parseAlertCondition, type AlertCondition } from "@/lib/validation/alert-rule-schema";
import { watchItemInclude } from "@/lib/watchlist";

export class AlertRuleServiceError extends Error {
  constructor(readonly code: string) { super(code); }
}

type Client = Pick<PrismaClient, "alertRule" | "watchItem" | "$transaction">;
type RuleRow = NonNullable<Awaited<ReturnType<PrismaClient["alertRule"]["findUnique"]>>> & { watchItem: { type: string; paramsJson: string } };
type WatchItemUpdate = { id: string; title?: string; memo?: string | null; enabled?: boolean };
function ruleSnapshotWhere(rule: Record<string, unknown>): Prisma.AlertRuleWhereInput {
  return {
    id: rule.id,
    updatedAt: rule.updatedAt,
    conditionJson: rule.conditionJson,
    channel: rule.channel,
    enabled: rule.enabled,
    outboundOptIn: rule.outboundOptIn,
    configVersion: rule.configVersion,
    latestOutcome: rule.latestOutcome,
    latestOutcomeAt: rule.latestOutcomeAt,
    latestOutcomeCode: rule.latestOutcomeCode,
    baselineState: rule.baselineState,
    baselineFingerprint: rule.baselineFingerprint,
    baselineTransitionSeq: rule.baselineTransitionSeq,
    baselineAt: rule.baselineAt,
    deliveryState: rule.deliveryState,
    attemptId: rule.attemptId,
    attemptRunId: rule.attemptRunId,
    attemptFingerprint: rule.attemptFingerprint,
    attemptTransitionSeq: rule.attemptTransitionSeq,
    attemptResultId: rule.attemptResultId,
    attemptResultType: rule.attemptResultType,
    lastAttemptAt: rule.lastAttemptAt,
    terminalAt: rule.terminalAt,
    deliveryCode: rule.deliveryCode,
    lastProviderRunAt: rule.lastProviderRunAt
  } as Prisma.AlertRuleWhereInput;
}

function watchItemSnapshotWhere(item: Record<string, unknown>): Prisma.WatchItemWhereInput {
  return {
    id: item.id,
    updatedAt: item.updatedAt,
    type: item.type,
    title: item.title,
    paramsJson: item.paramsJson,
    memo: item.memo,
    enabled: item.enabled
  } as Prisma.WatchItemWhereInput;
}

function modeForWatchItem(item: { type: string; paramsJson: string }): "flight_search" | "flight_compare_month" | "express_bus_search" | "intercity_bus_search" | "ticket_seats" | "foresttrip_search" | "schedule" | undefined {
  let params: unknown;
  try { params = JSON.parse(item.paramsJson); } catch { return undefined; }
  if (item.type === "flight") {
    const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
    return typeof record.yearMonth === "string" || typeof record.month === "string" || typeof record.sample === "string" ? "flight_compare_month" : "flight_search";
  }
  if (item.type === "express_bus") return "express_bus_search";
  if (item.type === "intercity_bus") return "intercity_bus_search";
  if (item.type === "foresttrip") return "foresttrip_search";
  if (item.type === "ticket") {
    const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : null;
    return record?.mode === "seats" ? "ticket_seats" : "schedule";
  }
  return undefined;
}

function parseStoredCondition(type: string, paramsJson: string, conditionJson: string): AlertCondition {
  const mode = modeForWatchItem({ type, paramsJson });
  if (!mode || mode === "schedule") throw new AlertRuleServiceError("ALERT_SUBTYPE_UNSUPPORTED");
  try { return parseAlertCondition(type as never, mode, JSON.parse(conditionJson)); } catch { throw new AlertRuleServiceError("ALERT_CONFIG_INVALID"); }
}

function serializeRule(row: NonNullable<RuleRow>): PublicAlertRule {
  const condition = parseStoredCondition(row.watchItem?.type ?? "", row.watchItem?.paramsJson ?? "", row.conditionJson);
  if (row.channel !== "telegram") throw new AlertRuleServiceError("ALERT_CONFIG_INVALID");
  return { id: row.id, watchItemId: row.watchItemId, channel: "telegram", condition, enabled: row.enabled, outboundOptIn: row.outboundOptIn, configVersion: row.configVersion, latestOutcome: row.latestOutcome as PublicAlertRule["latestOutcome"], latestOutcomeAt: row.latestOutcomeAt?.toISOString() ?? null, latestOutcomeCode: row.latestOutcomeCode, baselineState: row.baselineState as PublicAlertRule["baselineState"], baselineTransitionSeq: row.baselineTransitionSeq, baselineAt: row.baselineAt?.toISOString() ?? null, deliveryState: row.deliveryState as PublicAlertRule["deliveryState"], lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null, terminalAt: row.terminalAt?.toISOString() ?? null, deliveryCode: row.deliveryCode, lastProviderRunAt: row.lastProviderRunAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

async function itemAndMode(client: Client, watchItemId: string) {
  const item = await client.watchItem.findUnique({ where: { id: watchItemId } });
  if (!item) throw new AlertRuleServiceError("WATCH_ITEM_NOT_FOUND");
  const mode = modeForWatchItem(item);
  if (!mode || mode === "schedule") throw new AlertRuleServiceError("ALERT_SUBTYPE_UNSUPPORTED");
  return { item, mode };
}
export async function reloadWatchItem(watchItemId: string, client: Client = db) {
  const item = await client.watchItem.findUnique({ where: { id: watchItemId }, include: watchItemInclude });
  if (!item) throw new AlertRuleServiceError("WATCH_ITEM_NOT_FOUND");
  return item;
}

export async function createAlertRule(input: { watchItemId: string; condition: unknown }, client: Client = db): Promise<PublicAlertRule> {
  const { item, mode } = await itemAndMode(client, input.watchItemId);
  let condition: AlertCondition;
  try { condition = parseAlertCondition(item.type as never, mode, input.condition); } catch { throw new AlertRuleServiceError("ALERT_CONDITION_INVALID"); }
  try { return serializeRule(await client.alertRule.create({ data: { watchItemId: item.id, conditionJson: JSON.stringify(condition) }, include: { watchItem: true } })); } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new AlertRuleServiceError("ALERT_RULE_EXISTS");
    throw error;
  }
}

export async function listAlertRules(client: Client = db): Promise<PublicAlertRule[]> {
  return (await client.alertRule.findMany({ include: { watchItem: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(serializeRule);
}

export async function updateAlertRule(input: { id: string; condition?: unknown; enabled?: boolean; outboundOptIn?: boolean; channel?: "telegram"; configVersion: number }, client: Client = db): Promise<PublicAlertRule> {
  return client.$transaction(async (tx) => {
    const rule = await tx.alertRule.findUnique({ where: { id: input.id }, include: { watchItem: true } });
    if (!rule) throw new AlertRuleServiceError("ALERT_RULE_NOT_FOUND");
    if (rule.configVersion !== input.configVersion) throw new AlertRuleServiceError("ALERT_CONFIG_VERSION_CONFLICT");

    const mode = modeForWatchItem(rule.watchItem);
    if (!mode || mode === "schedule") throw new AlertRuleServiceError("ALERT_SUBTYPE_UNSUPPORTED");

    let conditionJson = rule.conditionJson;
    if (input.condition !== undefined) {
      try { conditionJson = JSON.stringify(parseAlertCondition(rule.watchItem.type as never, mode, input.condition)); } catch { throw new AlertRuleServiceError("ALERT_CONDITION_INVALID"); }
    }

    const conditionChanged = conditionJson !== rule.conditionJson;
    const enabled = input.enabled ?? rule.enabled;
    const outboundOptIn = input.outboundOptIn ?? rule.outboundOptIn;
    const channel = input.channel ?? rule.channel;
    if (enabled && (outboundOptIn !== true || channel !== "telegram")) throw new AlertRuleServiceError("ALERT_OUTBOUND_OPT_IN_REQUIRED");

    const noChange = !conditionChanged && enabled === rule.enabled && outboundOptIn === rule.outboundOptIn && channel === rule.channel;
    if (noChange) return serializeRule(rule);

    const active = rule.deliveryState === "reserved" || rule.deliveryState === "sending";
    if (conditionChanged && active) throw new AlertRuleServiceError("ALERT_DELIVERY_IN_FLIGHT");

    const data: Prisma.AlertRuleUpdateManyMutationInput = conditionChanged
      ? {
          conditionJson,
          enabled: false,
          outboundOptIn: false,
          latestOutcome: "config_changed",
          latestOutcomeAt: new Date(),
          latestOutcomeCode: null,
          baselineState: "never",
          baselineFingerprint: null,
          baselineTransitionSeq: 0,
          baselineAt: null
        }
      : {
          enabled,
          outboundOptIn,
          channel,
          ...(rule.deliveryState === "reserved" && !enabled
            ? { deliveryState: "cancelled", terminalAt: new Date(), deliveryCode: "ALERT_DISABLED" }
            : {})
        };

    if ((await tx.alertRule.updateMany({
      where: ruleSnapshotWhere(rule as unknown as Record<string, unknown>),
      data: { ...data, configVersion: { increment: 1 } }
    })).count !== 1) {
      throw new AlertRuleServiceError("ALERT_CONFIG_VERSION_CONFLICT");
    }
    return serializeRule(await tx.alertRule.findUniqueOrThrow({ where: { id: rule.id }, include: { watchItem: true } }));
  });
}

export const enableAlertRule = (id: string, configVersion: number, client: Client = db) => updateAlertRule({ id, configVersion, enabled: true, outboundOptIn: true, channel: "telegram" }, client);
export const disableAlertRule = (id: string, configVersion: number, client: Client = db) => updateAlertRule({ id, configVersion, enabled: false, outboundOptIn: false, channel: "telegram" }, client);

/** Parent edits and child lifecycle changes share one transaction. */
export async function updateWatchItemWithAlertRuleLifecycle(input: WatchItemUpdate, client: Client = db) {
  return client.$transaction(async (tx) => {
    const item = await tx.watchItem.findUnique({ where: { id: input.id }, include: { alertRule: true } });
    if (!item) throw new AlertRuleServiceError("WATCH_ITEM_NOT_FOUND");

    const title = input.title ?? item.title;
    const memo = input.memo === undefined ? item.memo : input.memo;
    const enabled = input.enabled ?? item.enabled;
    const titleChanged = title !== item.title;
    const parentDisabled = item.enabled && !enabled;
    const rule = item.alertRule;
    const active = rule?.deliveryState === "reserved" || rule?.deliveryState === "sending";

    if (titleChanged && active) throw new AlertRuleServiceError("ALERT_DELIVERY_IN_FLIGHT");

    if (rule && (titleChanged || parentDisabled)) {
      const ruleData: Prisma.AlertRuleUpdateManyMutationInput = {
        enabled: false,
        outboundOptIn: false,
        ...(titleChanged || rule.enabled || rule.outboundOptIn ? { configVersion: { increment: 1 } } : {}),
        ...(parentDisabled && rule.deliveryState === "reserved"
          ? { deliveryState: "cancelled", terminalAt: new Date(), deliveryCode: "ALERT_DISABLED" }
          : {})
      };
      if ((await tx.alertRule.updateMany({
        where: ruleSnapshotWhere(rule as unknown as Record<string, unknown>),
        data: ruleData
      })).count !== 1) {
        throw new AlertRuleServiceError("ALERT_CONFIG_VERSION_CONFLICT");
      }
    }

    if (title !== item.title || memo !== item.memo || enabled !== item.enabled) {
      if ((await tx.watchItem.updateMany({
        where: watchItemSnapshotWhere(item as unknown as Record<string, unknown>),
        data: { title, memo, enabled }
      })).count !== 1) {
        throw new AlertRuleServiceError("ALERT_CONFIG_VERSION_CONFLICT");
      }
    }

    return tx.watchItem.findUniqueOrThrow({ where: { id: item.id }, include: watchItemInclude });
  });
}

export async function deleteWatchItemWithAlertRuleLifecycle(id: string, client: Client = db): Promise<void> {
  await client.$transaction(async (tx) => {
    const item = await tx.watchItem.findUnique({ where: { id }, include: { alertRule: true } });
    if (!item) throw new AlertRuleServiceError("WATCH_ITEM_NOT_FOUND");
    if (item.alertRule) {
      const deleted = await tx.alertRule.deleteMany({ where: { id: item.alertRule.id, enabled: false, outboundOptIn: false, latestOutcome: "never", latestOutcomeAt: null, latestOutcomeCode: null, baselineState: "never", baselineTransitionSeq: 0, deliveryState: "never", baselineFingerprint: null, baselineAt: null, lastProviderRunAt: null, lastAttemptAt: null, terminalAt: null, deliveryCode: null, attemptId: null, attemptRunId: null, attemptFingerprint: null, attemptTransitionSeq: null, attemptResultId: null, attemptResultType: null } });
      if (deleted.count !== 1) throw new AlertRuleServiceError("ALERT_STATE_RETAINED");
    }
    await tx.watchItem.delete({ where: { id } });
  });
}

export async function deleteAlertRuleDraft(id: string, client: Client = db) {
  return client.$transaction(async (tx) => {
    const rule = await tx.alertRule.findUnique({ where: { id } });
    if (!rule) throw new AlertRuleServiceError("ALERT_RULE_NOT_FOUND");
    const deleted = await tx.alertRule.deleteMany({
      where: {
        ...ruleSnapshotWhere(rule as unknown as Record<string, unknown>),
        enabled: false,
        outboundOptIn: false,
        latestOutcome: "never",
        latestOutcomeAt: null,
        latestOutcomeCode: null,
        baselineState: "never",
        baselineTransitionSeq: 0,
        deliveryState: "never",
        baselineFingerprint: null,
        baselineAt: null,
        lastProviderRunAt: null,
        lastAttemptAt: null,
        terminalAt: null,
        deliveryCode: null,
        attemptId: null,
        attemptRunId: null,
        attemptFingerprint: null,
        attemptTransitionSeq: null,
        attemptResultId: null,
        attemptResultType: null
      }
    });
    if (deleted.count !== 1) throw new AlertRuleServiceError("ALERT_STATE_RETAINED");
    return tx.watchItem.findUniqueOrThrow({ where: { id: rule.watchItemId }, include: watchItemInclude });
  });
}

export { serializeRule as serializeAlertRule };
