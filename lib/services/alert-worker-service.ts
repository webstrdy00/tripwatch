import { randomUUID } from "node:crypto";
import type { AlertRule, PrismaClient, QueryResult, WatchItem } from "@prisma/client";

import { canonicalizeAlertFingerprint } from "@/lib/alerts/canonicalize";
import { evaluateBusCondition } from "@/lib/alerts/conditions/bus";
import { evaluateFlightCondition } from "@/lib/alerts/conditions/flight";
import { evaluateForesttripCondition } from "@/lib/alerts/conditions/foresttrip";
import { evaluateTicketCondition } from "@/lib/alerts/conditions/ticket";
import { isEligibleAlert } from "@/lib/alerts/eligibility";
import { composeAlertMessage } from "@/lib/alerts/message-composer";
import {
  classifyIncompleteAttempt,
  isProviderDispatchDue,
  recordLatestOutcome,
  transitionSuccessfulBaseline,
  type AlertBaseline,
  type DeliveryState,
  type IncompleteAttempt
} from "@/lib/alerts/state-machine";
import { sendTelegramMessage, type TelegramDeliveryResult } from "@/lib/alerts/telegram";
import { getSafeOfficialUrl } from "@/lib/official-urls";
import type { AlertCondition, AlertEvaluation, AlertMatch } from "@/lib/alerts/types";
import { db } from "@/lib/db";
import { runWatchItemById, type WatchItemRunResult } from "@/lib/services/watchlist-run-service";
import { parseAlertCondition } from "@/lib/validation/alert-rule-schema";

type Client = Pick<PrismaClient, "alertRule" | "$transaction">;
type Credentials = Readonly<{ botToken: string; chatId: string }>;
type DispatchSignal = Readonly<{ providerDispatchStarted: () => void }>;
type Dispatcher = (id: string, signal: DispatchSignal) => Promise<WatchItemRunResult>;
type Sender = (credentials: Credentials, message: string) => Promise<TelegramDeliveryResult>;

export type AlertWorkerResult = { exitCode: 0 | 4 | 5 | 6 | 7; providerDispatches: number; providerCooldownSkipped: number; evaluated: number; sent: number; rejected: number; ambiguous: number; cancelled: number; suppressed: number; recoveredReserved: number; recoveredSending: number; skipped: number };
export type RunAlertWorkerInput = { limit?: number; credentials: Credentials; db?: Client; now?: () => Date; runWatchItem?: Dispatcher; sendTelegram?: Sender; runId?: string };
type WorkerWatchItem = WatchItem & { results: QueryResult[] };
type WorkerRule = AlertRule & { watchItem: WorkerWatchItem };

type WorkerClient = {
  alertRule: {
    findMany(args: unknown): Promise<WorkerRule[]>;
    findUnique(args: unknown): Promise<WorkerRule | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(fn: (transaction: WorkerClient) => Promise<T>): Promise<T>;
};

function latestResult(watchItem: { results: QueryResult[] }): QueryResult | undefined {
  return [...watchItem.results].sort((left, right) =>
    right.checkedAt.getTime() - left.checkedAt.getTime() ||
    right.createdAt.getTime() - left.createdAt.getTime() ||
    (left.id < right.id ? 1 : left.id > right.id ? -1 : 0)
  )[0];
}

function sameResult(left: QueryResult | undefined, right: QueryResult | undefined): boolean {
  return !left || !right ? left === right : left.id === right.id && left.type === right.type;
}

function sameParent(left: WorkerWatchItem, right: WorkerWatchItem): boolean {
  return left.id === right.id && left.enabled === right.enabled && left.type === right.type &&
    left.paramsJson === right.paramsJson && left.title === right.title &&
    left.updatedAt.getTime() === right.updatedAt.getTime();
}

function sameRuleConfig(left: WorkerRule, right: WorkerRule): boolean {
  return left.id === right.id && left.configVersion === right.configVersion &&
    left.updatedAt.getTime() === right.updatedAt.getTime() &&
    left.lastProviderRunAt?.getTime() === right.lastProviderRunAt?.getTime() &&
    left.conditionJson === right.conditionJson && left.enabled === right.enabled &&
    left.outboundOptIn === right.outboundOptIn && left.channel === right.channel &&
    left.deliveryState === right.deliveryState;
}
function sameFenceConfig(current: AlertRule, expected: AlertRule): boolean {
  return current.configVersion === expected.configVersion && current.enabled === expected.enabled &&
    current.outboundOptIn === expected.outboundOptIn && current.channel === expected.channel;
}
function sameBaselineState(current: AlertRule, expected: AlertRule): boolean {
  return current.baselineState === expected.baselineState &&
    current.baselineFingerprint === expected.baselineFingerprint &&
    current.baselineTransitionSeq === expected.baselineTransitionSeq &&
    current.baselineAt?.getTime() === expected.baselineAt?.getTime() &&
    current.lastAttemptAt?.getTime() === expected.lastAttemptAt?.getTime() &&
    current.deliveryState === expected.deliveryState &&
    current.terminalAt?.getTime() === expected.terminalAt?.getTime();
}


function ruleWithLatest(client: WorkerClient, id: string): Promise<WorkerRule | null> {
  return client.alertRule.findUnique({
    where: { id },
    include: { watchItem: { include: { results: { orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1 } } } }
  });
}

function evaluate(type: string, input: { source: unknown; status: unknown; data: unknown; params: unknown; condition: unknown }): AlertEvaluation {
  if (type === "flight") return evaluateFlightCondition(input);
  if (type === "express_bus" || type === "intercity_bus") return evaluateBusCondition(input);
  if (type === "ticket") return evaluateTicketCondition(input);
  if (type === "foresttrip") return evaluateForesttripCondition(input);
  return { outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" };
}
function summaries(matches: readonly AlertMatch[]): { summary: string }[] { return matches.map((match) => ({ summary: Object.values(match).map((value) => value ?? "—").join(" · ") })); }
function terminalExit(result: TelegramDeliveryResult): 0 | 5 | 6 { return result.outcome === "sent" ? 0 : result.outcome === "rejected" ? 5 : 6; }
function parseJson(value: string): unknown | undefined { try { return JSON.parse(value); } catch { return undefined; } }
function isDeliveryState(value: string): value is DeliveryState {
  return ["never", "reserved", "sending", "sent", "rejected", "ambiguous", "suppressed", "cancelled"].includes(value);
}
function compareFairCandidates(
  left: { lastProviderRunAt: Date | null; createdAt: Date; id: string },
  right: { lastProviderRunAt: Date | null; createdAt: Date; id: string }
): number {
  if (left.lastProviderRunAt === null && right.lastProviderRunAt !== null) return -1;
  if (left.lastProviderRunAt !== null && right.lastProviderRunAt === null) return 1;
  if (left.lastProviderRunAt && right.lastProviderRunAt) {
    const byRun = left.lastProviderRunAt.getTime() - right.lastProviderRunAt.getTime();
    if (byRun) return byRun;
  }
  const byCreated = left.createdAt.getTime() - right.createdAt.getTime();
  return byCreated || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function incompleteAttempt(rule: {
  deliveryState: string;
  attemptId: string | null;
  attemptRunId: string | null;
  attemptFingerprint: string | null;
  attemptTransitionSeq: number | null;
  attemptResultId: string | null;
  attemptResultType: string | null;
  lastAttemptAt: Date | null;
}): IncompleteAttempt | undefined {
  const deliveryState = rule.deliveryState;
  if (!isDeliveryState(deliveryState)) return undefined;
  return { ...rule, deliveryState };
}

function alertBaseline(rule: {
  baselineState: string;
  baselineFingerprint: string | null;
  baselineTransitionSeq: number;
  baselineAt: Date | null;
  lastAttemptAt: Date | null;
}): AlertBaseline | undefined {
  const baselineState = rule.baselineState;
  if (baselineState !== "never" && baselineState !== "matched" && baselineState !== "no_match") return undefined;
  return { ...rule, baselineState };
}
function configuredMode(type: string, params: unknown): "flight_search" | "flight_compare_month" | "express_bus_search" | "intercity_bus_search" | "ticket_seats" | "foresttrip_search" | "schedule" | undefined {
  if (type === "flight") {
    const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
    return typeof record.yearMonth === "string" || typeof record.month === "string" || typeof record.sample === "string" ? "flight_compare_month" : "flight_search";
  }
  if (type === "express_bus") return "express_bus_search";
  if (type === "intercity_bus") return "intercity_bus_search";
  if (type === "foresttrip") return "foresttrip_search";
  if (type === "ticket") return params && typeof params === "object" && !Array.isArray(params) && (params as Record<string, unknown>).mode === "seats" ? "ticket_seats" : "schedule";
  return undefined;
}

/** One-shot orchestration. Provider and Telegram calls deliberately occur outside transactions. */
export async function runAlertWorker(input: RunAlertWorkerInput): Promise<AlertWorkerResult> {
  const client = (input.db ?? db) as unknown as WorkerClient;
  const now = input.now ?? (() => new Date());
  const dispatch = input.runWatchItem ?? ((id, signal) =>
    runWatchItemById(id, { onProviderDispatchStarted: signal.providerDispatchStarted }));
  const telegram = input.sendTelegram ?? sendTelegramMessage;
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new RangeError("limit must be an integer from 1 to 10");
  const counters: AlertWorkerResult = { exitCode: 0, providerDispatches: 0, providerCooldownSkipped: 0, evaluated: 0, sent: 0, rejected: 0, ambiguous: 0, cancelled: 0, suppressed: 0, recoveredReserved: 0, recoveredSending: 0, skipped: 0 };
  const runId = input.runId ?? randomUUID();

  for (const rule of await client.alertRule.findMany({ where: { deliveryState: { in: ["reserved", "sending"] } } })) {
    const attempt = incompleteAttempt(rule);
    if (!attempt) continue;
    const recovery = classifyIncompleteAttempt(attempt);
    if (recovery.kind === "none") continue;
    const update = await client.alertRule.updateMany({
      where: {
        id: rule.id,
        deliveryState: rule.deliveryState,
        attemptId: rule.attemptId,
        attemptRunId: rule.attemptRunId,
        attemptFingerprint: rule.attemptFingerprint,
        attemptTransitionSeq: rule.attemptTransitionSeq,
        attemptResultId: rule.attemptResultId,
        attemptResultType: rule.attemptResultType,
        lastAttemptAt: rule.lastAttemptAt,
        terminalAt: null
      },
      data: { deliveryState: recovery.deliveryState, terminalAt: now(), deliveryCode: recovery.code }
    });
    if (!update.count) continue;
    if (recovery.kind === "cancelled") {
      counters.recoveredReserved += 1;
      counters.cancelled += 1;
    } else {
      counters.recoveredSending += 1;
      counters.ambiguous += 1;
      counters.exitCode = 6;
    }
  }
  if (counters.exitCode === 6) return counters;

  // Materialize the complete fair ordering first. Failed claims and skipped rows never consume the dispatch cap.
  const candidates = await client.alertRule.findMany({
    where: { enabled: true, outboundOptIn: true, channel: "telegram" },
    include: { watchItem: { include: { results: { orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1 } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  for (const candidate of candidates.sort(compareFairCandidates)) {
    if (counters.providerDispatches >= limit || counters.exitCode === 5 || counters.exitCode === 7) break;
    const initial = candidate.watchItem.results[0];
    if (!candidate.watchItem.enabled) { counters.skipped += 1; continue; }
    if (initial && initial.type !== candidate.watchItem.type) {
      await client.alertRule.updateMany({
        where: { id: candidate.id, configVersion: candidate.configVersion, updatedAt: candidate.updatedAt },
        data: recordLatestOutcome("result_type_mismatch", now(), "QUERY_RESULT_TYPE_MISMATCH")
      });
      counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }
    const params = parseJson(candidate.watchItem.paramsJson);
    const configured = configuredMode(candidate.watchItem.type, params);
    const rawCondition = parseJson(candidate.conditionJson);
    let condition: AlertCondition;
    try {
      if (!configured || configured === "schedule") throw new Error("unsupported");
      condition = parseAlertCondition(candidate.watchItem.type as never, configured, rawCondition);
    } catch {
      await client.alertRule.updateMany({
        where: { id: candidate.id, configVersion: candidate.configVersion },
        data: recordLatestOutcome("config_invalid", now(), "ALERT_CONFIG_INVALID")
      });
      counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }

    // Claim and prove the scanned latest row in the same transaction as cursor advance.
    const claimAt = now();
    const claim = await client.$transaction(async (transaction) => {
      const current = await ruleWithLatest(transaction, candidate.id);
      if (!current || !sameRuleConfig(current, candidate) || !sameParent(current.watchItem, candidate.watchItem)) return { kind: "stale" as const };
      if (!isProviderDispatchDue(current.watchItem.type, current.lastProviderRunAt, claimAt)) {
        return { kind: "cooldown" as const };
      }
      const currentLatest = latestResult(current.watchItem);
      if (!sameResult(currentLatest, initial)) {
        const mismatch = currentLatest?.type !== candidate.watchItem.type;
        await transaction.alertRule.updateMany({
          where: { id: current.id, configVersion: current.configVersion, updatedAt: current.updatedAt },
          data: recordLatestOutcome(mismatch ? "result_type_mismatch" : "result_superseded", now(), mismatch ? "QUERY_RESULT_TYPE_MISMATCH" : "QUERY_RESULT_SUPERSEDED")
        });
        return { kind: "result_changed" as const };
      }
      const priorCursor = current.lastProviderRunAt;
      const update = await transaction.alertRule.updateMany({
        where: {
          id: current.id, configVersion: current.configVersion, updatedAt: current.updatedAt,
          conditionJson: current.conditionJson, lastProviderRunAt: current.lastProviderRunAt,
          enabled: true, outboundOptIn: true, channel: "telegram", deliveryState: { notIn: ["reserved", "sending"] },
          watchItem: { is: { id: current.watchItemId, enabled: true, type: current.watchItem.type, paramsJson: current.watchItem.paramsJson, title: current.watchItem.title, updatedAt: current.watchItem.updatedAt } }
        },
        data: { lastProviderRunAt: claimAt }
      });
      return update.count === 1 ? { kind: "claimed" as const, rule: current, priorCursor } : { kind: "stale" as const };
    });
    if (claim.kind !== "claimed") {
      if (claim.kind === "cooldown") counters.providerCooldownSkipped = Math.min(10_000, counters.providerCooldownSkipped + 1);
      if (claim.kind === "result_changed") counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }
    const claimedRule = claim.rule;
    const claimedLatest = latestResult(claimedRule.watchItem);
    if (!sameResult(claimedLatest, initial)) {
      const restored = await client.alertRule.updateMany({
        where: { id: claimedRule.id, configVersion: claimedRule.configVersion, lastProviderRunAt: claimAt },
        data: { lastProviderRunAt: claim.priorCursor }
      });
      if (restored.count !== 1) {
        counters.exitCode = 7;
        break;
      }
      counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }

    let run: WatchItemRunResult;
    let providerDispatchStarted = false;
    const dispatchSignal: DispatchSignal = {
      providerDispatchStarted: () => {
        providerDispatchStarted = true;
      }
    };
    try {
      run = await dispatch(candidate.watchItemId, dispatchSignal);
    } catch {
      if (!providerDispatchStarted) {
        const restored = await client.alertRule.updateMany({
          where: { id: claimedRule.id, configVersion: claimedRule.configVersion, lastProviderRunAt: claimAt },
          data: { lastProviderRunAt: claim.priorCursor }
        });
        if (restored.count !== 1) {
          counters.exitCode = 7;
          break;
        }
        counters.skipped += 1;
      } else {
        counters.providerDispatches += 1;
      }
      await client.alertRule.updateMany({ where: { id: candidate.id, configVersion: candidate.configVersion }, data: recordLatestOutcome("failed", now(), "PROVIDER_DISPATCH_FAILED") });
      counters.exitCode = 4;
      continue;
    }
    if (!run.providerDispatched) {
      const restored = await client.alertRule.updateMany({
        where: { id: claimedRule.id, configVersion: claimedRule.configVersion, lastProviderRunAt: claimAt },
        data: { lastProviderRunAt: claim.priorCursor }
      });
      if (restored.count !== 1) {
        counters.exitCode = 7;
        break;
      }
      counters.skipped += 1;
      continue;
    }
    counters.providerDispatches += 1;
    const result = run.storedResult;
    if (!result || result.type !== candidate.watchItem.type) {
      await client.alertRule.updateMany({ where: { id: candidate.id, configVersion: candidate.configVersion }, data: recordLatestOutcome("result_type_mismatch", now(), "QUERY_RESULT_TYPE_MISMATCH") });
      counters.exitCode = 4;
      continue;
    }

    const fresh = await client.alertRule.findUnique({ where: { id: candidate.id }, include: { watchItem: { include: { results: { orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 1 } } } } });
    const latest = fresh?.watchItem.results[0];
    if (!fresh || !latest || latest.id !== result.id || latest.type !== result.type) {
      if (fresh) await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome(latest?.type === candidate.watchItem.type ? "result_superseded" : "result_type_mismatch", now(), latest?.type === candidate.watchItem.type ? "QUERY_RESULT_SUPERSEDED" : "QUERY_RESULT_TYPE_MISMATCH") });
      counters.exitCode = 4;
      continue;
    }
    if (!fresh.enabled || !fresh.outboundOptIn || fresh.channel !== "telegram" || !fresh.watchItem.enabled) {
      await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("parent_disabled", now(), "ALERT_DISABLED") });
      counters.exitCode = 4;
      continue;
    }
    const payload = parseJson(latest.resultJson);
    const mode = run.alertMode;
    if (payload === undefined || !mode || !isEligibleAlert(latest.source ?? "", fresh.watchItem.type, mode)) {
      await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome(payload === undefined ? "unsupported_shape" : "blocked_source", now(), payload === undefined ? "ALERT_RESULT_UNSUPPORTED_SHAPE" : "ALERT_SOURCE_BLOCKED") });
      counters.exitCode = 4;
      continue;
    }
    // Re-validate the persisted condition against the authoritative run mode, never trust a cast.
    try {
      condition = parseAlertCondition(fresh.watchItem.type as never, mode, parseJson(fresh.conditionJson));
    } catch {
      await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("config_invalid", now(), "ALERT_CONFIG_INVALID") });
      counters.exitCode = 4;
      continue;
    }
    const assessment = evaluate(fresh.watchItem.type, { source: latest.source ?? "", status: latest.status, data: payload, params: parseJson(fresh.watchItem.paramsJson), condition });
    if (assessment.outcome !== "success_matched" && assessment.outcome !== "success_no_match") {
      await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome(assessment.outcome, now(), assessment.code) });
      counters.exitCode = 4;
      continue;
    }
    counters.evaluated += 1;
    let fingerprint: string | null = null;
    let matches: AlertMatch[] = [];
    if (assessment.outcome === "success_matched") {
      try {
        const canonical = canonicalizeAlertFingerprint({ fingerprintVersion: "v1", type: fresh.watchItem.type as never, mode, condition, matches: assessment.matches });
        fingerprint = canonical.fingerprint;
        matches = canonical.matches;
      } catch {
        await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("unsupported_shape", now(), "ALERT_RESULT_UNSUPPORTED_SHAPE") });
        counters.exitCode = 4;
        continue;
      }
    }
    const baseline = alertBaseline(fresh);
    if (!baseline) {
      await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("config_invalid", now(), "ALERT_BASELINE_INVALID") });
      counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }
    const transition = transitionSuccessfulBaseline(baseline, fingerprint ? { matched: true, fingerprint } : { matched: false }, now());
    const { deliveryAction, ...baselineUpdate } = transition;
    if (deliveryAction !== "reserve") {
      const baselineCommit = await client.$transaction(async (transaction) => {
        const current = await ruleWithLatest(transaction, fresh.id);
        if (
          !current ||
          !sameRuleConfig(current, fresh) ||
          !sameBaselineState(current, fresh) ||
          !sameParent(current.watchItem, fresh.watchItem)
        ) {
          return "stale" as const;
        }
        const currentLatest = latestResult(current.watchItem);
        if (!sameResult(currentLatest, latest)) {
          const mismatch = !currentLatest || currentLatest.type !== fresh.watchItem.type;
          const changed = await transaction.alertRule.updateMany({
            where: { id: current.id, configVersion: current.configVersion, updatedAt: current.updatedAt },
            data: recordLatestOutcome(
              mismatch ? "result_type_mismatch" : "result_superseded",
              now(),
              mismatch ? "QUERY_RESULT_TYPE_MISMATCH" : "QUERY_RESULT_SUPERSEDED"
            )
          });
          return changed.count === 1 ? "result_changed" as const : "stale" as const;
        }
        const update = await transaction.alertRule.updateMany({
          where: {
            id: current.id,
            configVersion: current.configVersion,
            updatedAt: current.updatedAt,
            conditionJson: current.conditionJson,
            baselineState: current.baselineState,
            baselineFingerprint: current.baselineFingerprint,
            baselineTransitionSeq: current.baselineTransitionSeq,
            baselineAt: current.baselineAt,
            lastAttemptAt: current.lastAttemptAt,
            terminalAt: current.terminalAt,
            enabled: true,
            outboundOptIn: true,
            channel: "telegram",
            deliveryState: current.deliveryState,
            watchItem: {
              is: {
                id: current.watchItemId,
                enabled: true,
                type: current.watchItem.type,
                paramsJson: current.watchItem.paramsJson,
                title: current.watchItem.title,
                updatedAt: current.watchItem.updatedAt
              }
            }
          },
          data: deliveryAction === "suppressed"
            ? {
                ...baselineUpdate,
                latestOutcomeCode: null,
                deliveryState: "suppressed",
                terminalAt: now(),
                deliveryCode: "ALERT_COOLDOWN_SUPPRESSED"
              }
            : { ...baselineUpdate, latestOutcomeCode: null }
        });
        return update.count === 1 ? "updated" as const : "stale" as const;
      });
      if (baselineCommit === "result_changed") counters.exitCode = 4;
      if (baselineCommit === "stale") counters.skipped += 1;
      if (baselineCommit === "updated" && deliveryAction === "suppressed") counters.suppressed += 1;
      continue;
    }
    const officialUrl = getSafeOfficialUrl(fresh.watchItem.type, latest.officialUrl ?? undefined);
    if (!latest.officialUrl || officialUrl !== latest.officialUrl) { await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("message_invalid", now(), "MESSAGE_INVALID") }); counters.exitCode = 4; continue; }
    const message = composeAlertMessage({ type: fresh.watchItem.type, mode, title: fresh.watchItem.title, matches: summaries(matches), checkedAt: latest.checkedAt, officialUrl: latest.officialUrl, officialUrlAllowed: true, chatId: input.credentials.chatId });
    if (!message.ok) { await client.alertRule.updateMany({ where: { id: fresh.id, configVersion: fresh.configVersion }, data: recordLatestOutcome("message_invalid", now(), message.code) }); counters.exitCode = 4; continue; }
    const attemptId = randomUUID();
    const reservation = await client.$transaction(async (transaction) => {
      const current = await ruleWithLatest(transaction, fresh.id);
      const currentLatest = current ? latestResult(current.watchItem) : undefined;
      if (
        !current ||
        !sameRuleConfig(current, fresh) ||
        !sameBaselineState(current, fresh) ||
        !sameParent(current.watchItem, fresh.watchItem)
      ) {
        return "stale" as const;
      }
      if (!sameResult(currentLatest, latest)) {
        const mismatch = !currentLatest || currentLatest.type !== fresh.watchItem.type;
        const changed = await transaction.alertRule.updateMany({
          where: { id: current.id, configVersion: current.configVersion, updatedAt: current.updatedAt },
          data: recordLatestOutcome(
            mismatch ? "result_type_mismatch" : "result_superseded",
            now(),
            mismatch ? "QUERY_RESULT_TYPE_MISMATCH" : "QUERY_RESULT_SUPERSEDED"
          )
        });
        return changed.count === 1 ? "result_changed" as const : "stale" as const;
      }
      const update = await transaction.alertRule.updateMany({
        where: {
          id: current.id, configVersion: current.configVersion, updatedAt: current.updatedAt,
          conditionJson: current.conditionJson, baselineState: current.baselineState,
          baselineFingerprint: current.baselineFingerprint, baselineTransitionSeq: current.baselineTransitionSeq,
          baselineAt: current.baselineAt, lastAttemptAt: current.lastAttemptAt, terminalAt: current.terminalAt,
          enabled: true, outboundOptIn: true, channel: "telegram", deliveryState: current.deliveryState,
          watchItem: { is: { id: current.watchItemId, enabled: true, type: current.watchItem.type, paramsJson: current.watchItem.paramsJson, title: current.watchItem.title, updatedAt: current.watchItem.updatedAt } }
        },
        data: {
          ...baselineUpdate, latestOutcomeCode: null, deliveryState: "reserved", attemptId, attemptRunId: runId,
          attemptFingerprint: fingerprint, attemptTransitionSeq: transition.baselineTransitionSeq,
          attemptResultId: latest.id, attemptResultType: latest.type, lastAttemptAt: now(), terminalAt: null, deliveryCode: null
        }
      });
      return update.count === 1 ? "reserved" as const : "stale" as const;
    });
    if (reservation !== "reserved") {
      if (reservation === "result_changed") counters.exitCode = 4;
      counters.skipped += 1;
      continue;
    }
    const fence = await client.$transaction(async (transaction) => {
      const current = await ruleWithLatest(transaction, fresh.id);
      const currentLatest = current ? latestResult(current.watchItem) : undefined;
      const ownsReservation = current && current.deliveryState === "reserved" && current.attemptId === attemptId &&
        current.attemptRunId === runId && current.attemptFingerprint === fingerprint &&
        current.attemptTransitionSeq === transition.baselineTransitionSeq && current.attemptResultId === latest.id &&
        current.attemptResultType === latest.type && current.terminalAt === null;
      const valid = ownsReservation && sameFenceConfig(current, fresh) &&
        sameParent(current.watchItem, fresh.watchItem) && sameResult(currentLatest, latest);
      if (!valid) {
        if (!ownsReservation) return "lost" as const;
        const mismatch = !currentLatest || currentLatest.type !== latest.type;
        const cancelled = await transaction.alertRule.updateMany({
          where: { id: current.id, deliveryState: "reserved", attemptId, attemptRunId: runId, attemptFingerprint: fingerprint, attemptTransitionSeq: transition.baselineTransitionSeq, attemptResultId: latest.id, attemptResultType: latest.type, terminalAt: null },
          data: { deliveryState: "cancelled", terminalAt: now(), deliveryCode: mismatch ? "QUERY_RESULT_TYPE_MISMATCH" : !sameResult(currentLatest, latest) ? "QUERY_RESULT_SUPERSEDED" : "ALERT_DISABLED" }
        });
        return cancelled.count === 1 ? "cancelled" as const : "lost" as const;
      }
      const sending = await transaction.alertRule.updateMany({
        where: {
          id: current.id, attemptId, attemptRunId: runId, attemptFingerprint: fingerprint,
          attemptTransitionSeq: transition.baselineTransitionSeq, attemptResultId: latest.id, attemptResultType: latest.type,
          deliveryState: "reserved", terminalAt: null, enabled: true, outboundOptIn: true, channel: "telegram", configVersion: current.configVersion, conditionJson: current.conditionJson,
          watchItem: { is: { id: current.watchItemId, enabled: true, type: current.watchItem.type, paramsJson: current.watchItem.paramsJson, title: current.watchItem.title, updatedAt: current.watchItem.updatedAt } }
        },
        data: { deliveryState: "sending" }
      });
      return sending.count === 1 ? "sending" as const : "lost" as const;
    });
    if (fence === "lost") { counters.exitCode = 7; break; }
    if (fence === "cancelled") {
      counters.cancelled += 1;
      counters.exitCode = 4;
      continue;
    }
    let delivery: TelegramDeliveryResult;
    try {
      delivery = await telegram(input.credentials, message.text);
    } catch {
      delivery = { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
    }
    if ((await client.alertRule.updateMany({
      where: {
        id: fresh.id,
        deliveryState: "sending",
        attemptId,
        attemptRunId: runId,
        attemptFingerprint: fingerprint,
        attemptTransitionSeq: transition.baselineTransitionSeq,
        attemptResultId: latest.id,
        attemptResultType: latest.type,
        terminalAt: null
      },
      data: { deliveryState: delivery.outcome, terminalAt: now(), deliveryCode: delivery.code }
    })).count !== 1) { counters.exitCode = 7; break; }
    if (delivery.outcome === "sent") counters.sent += 1;
    if (delivery.outcome === "rejected") counters.rejected += 1;
    if (delivery.outcome === "ambiguous") counters.ambiguous += 1;
    const exit = terminalExit(delivery);
    if (exit) { counters.exitCode = exit; break; }
  }
  return counters;
}
