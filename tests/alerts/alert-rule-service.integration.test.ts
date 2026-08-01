import assert from "node:assert/strict";
import test from "node:test";

import {
  AlertRuleServiceError,
  deleteAlertRuleDraft,
  updateAlertRule,
  updateWatchItemWithAlertRuleLifecycle,
} from "@/lib/services/alert-rule-service";
import { watchItemUpdateSchema } from "@/lib/validation/watchlist-schema";

type Row = Record<string, unknown>;

function seedClient(overrides: Partial<Row> = {}) {
  const item: Row = {
    id: "watch-1",
    type: "flight",
    title: "Seoul trip",
    paramsJson: JSON.stringify({ from: "ICN", to: "CJU", departDate: "2026-08-01", passengers: 1 }),
    memo: null,
    enabled: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z")
  };
  const rule: Row = {
    id: "rule-1",
    watchItemId: item.id,
    channel: "telegram",
    conditionJson: JSON.stringify({ kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 50000 }),
    enabled: true,
    outboundOptIn: true,
    configVersion: 3,
    latestOutcome: "success_matched",
    latestOutcomeAt: new Date("2026-01-02T00:00:00.000Z"),
    latestOutcomeCode: null,
    baselineState: "matched",
    baselineFingerprint: "v1:baseline",
    baselineTransitionSeq: 4,
    baselineAt: new Date("2026-01-02T00:00:00.000Z"),
    deliveryState: "sent",
    attemptId: "attempt-1",
    attemptRunId: "run-1",
    attemptFingerprint: "v1:attempt",
    attemptTransitionSeq: 4,
    attemptResultId: "result-1",
    attemptResultType: "flight",
    lastAttemptAt: new Date("2026-01-02T00:00:00.000Z"),
    terminalAt: new Date("2026-01-02T00:00:01.000Z"),
    deliveryCode: "SENT",
    lastProviderRunAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...overrides
  };

  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
  const client = {
    alertRule: {
      findUnique: async ({ where }: { where: Row }) => where.id === rule.id ? { ...rule, watchItem: item } : null,
      findUniqueOrThrow: async () => ({ ...rule, watchItem: item }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(rule, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          rule[key] = value && typeof value === "object" && "increment" in value
            ? Number(rule[key]) + Number((value as { increment: number }).increment)
            : value;
        }
        rule.updatedAt = new Date();
        return { count: 1 };
      },
      deleteMany: async ({ where }: { where: Row }) => matches(rule, where) ? { count: 1 } : { count: 0 }
    },
    watchItem: {
      findUnique: async ({ where }: { where: Row }) => where.id === item.id ? { ...item, alertRule: rule } : null,
      findUniqueOrThrow: async () => ({ ...item, alertRule: rule }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        if (!matches(item, where)) return { count: 0 };
        Object.assign(item, data);
        item.updatedAt = new Date();
        return { count: 1 };
      },
      update: async ({ data }: { data: Row }) => Object.assign(item, data),
      delete: async () => undefined
    },
    $transaction: async <T>(callback: (tx: never) => Promise<T>) => callback(client as never)
  };
  return { client, item, rule };
}

test("canonical-identical condition is a no-op, while a real condition edit resets only the baseline", async () => {
  const { client, rule } = seedClient();

  const unchanged = await updateAlertRule({
    id: "rule-1",
    configVersion: 3,
    condition: { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 50000 }
  }, client as never);
  assert.equal(unchanged.configVersion, 3);
  assert.equal(rule.enabled, true);

  await updateAlertRule({
    id: "rule-1",
    configVersion: 3,
    condition: { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 49000 }
  }, client as never);
  assert.equal(rule.configVersion, 4);
  assert.equal(rule.enabled, false);
  assert.equal(rule.outboundOptIn, false);
  assert.equal(rule.latestOutcome, "config_changed");
  assert.equal(rule.baselineState, "never");
  assert.equal(rule.baselineFingerprint, null);
  assert.equal(rule.baselineTransitionSeq, 0);
  assert.equal(rule.attemptId, "attempt-1");
  assert.equal(rule.lastAttemptAt instanceof Date, true);
  assert.equal(rule.lastProviderRunAt instanceof Date, true);
  await assert.rejects(
    updateAlertRule({ id: "rule-1", configVersion: 3, enabled: true, outboundOptIn: true, channel: "telegram" }, client as never),
    (error: unknown) => error instanceof AlertRuleServiceError && error.code === "ALERT_CONFIG_VERSION_CONFLICT"
  );
});

test("rule disable cancels a reservation but preserves a sending attempt", async () => {
  const reserved = seedClient({ deliveryState: "reserved", terminalAt: null, deliveryCode: null });
  await updateAlertRule({ id: "rule-1", configVersion: 3, enabled: false, outboundOptIn: false, channel: "telegram" }, reserved.client as never);
  assert.equal(reserved.rule.deliveryState, "cancelled");
  assert.equal(reserved.rule.deliveryCode, "ALERT_DISABLED");
  assert.equal(reserved.rule.attemptId, "attempt-1");

  const sending = seedClient({ deliveryState: "sending", terminalAt: null, deliveryCode: null });
  await updateAlertRule({ id: "rule-1", configVersion: 3, enabled: false, outboundOptIn: false, channel: "telegram" }, sending.client as never);
  assert.equal(sending.rule.deliveryState, "sending");
  assert.equal(sending.rule.enabled, false);
  assert.equal(sending.rule.outboundOptIn, false);
});

test("title conflicts during active delivery, while memo plus disable is atomic and parent enable leaves the child disabled", async () => {
  const active = seedClient({ deliveryState: "reserved", terminalAt: null, deliveryCode: null });
  await assert.rejects(
    updateWatchItemWithAlertRuleLifecycle({ id: "watch-1", title: "Changed", memo: "new", enabled: false }, active.client as never),
    (error: unknown) => error instanceof AlertRuleServiceError && error.code === "ALERT_DELIVERY_IN_FLIGHT"
  );
  assert.equal(active.item.title, "Seoul trip");
  assert.equal(active.item.memo, null);
  assert.equal(active.item.enabled, true);

  await updateWatchItemWithAlertRuleLifecycle({ id: "watch-1", title: "Seoul trip", memo: "allowed", enabled: false }, active.client as never);
  assert.equal(active.item.memo, "allowed");
  assert.equal(active.item.enabled, false);
  assert.equal(active.rule.deliveryState, "cancelled");

  await updateWatchItemWithAlertRuleLifecycle({ id: "watch-1", enabled: true }, active.client as never);
  assert.equal(active.rule.enabled, false);
  assert.equal(active.rule.outboundOptIn, false);
});
test("real title edits version and disable the child without resetting delivery evidence", async () => {
  const { client, rule } = seedClient();
  await updateWatchItemWithAlertRuleLifecycle({ id: "watch-1", title: "Renamed" }, client as never);
  assert.equal(rule.configVersion, 4);
  assert.equal(rule.enabled, false);
  assert.equal(rule.outboundOptIn, false);
  assert.equal(rule.baselineFingerprint, "v1:baseline");
  assert.equal(rule.attemptId, "attempt-1");
  assert.equal(rule.lastAttemptAt instanceof Date, true);
});

test("draft deletion retains any delivery evidence, including deliveryCode", async () => {
  const { client } = seedClient({
    enabled: false,
    outboundOptIn: false,
    latestOutcome: "never",
    latestOutcomeAt: null,
    baselineState: "never",
    baselineFingerprint: null,
    baselineTransitionSeq: 0,
    baselineAt: null,
    deliveryState: "never",
    attemptId: null,
    attemptRunId: null,
    attemptFingerprint: null,
    attemptTransitionSeq: null,
    attemptResultId: null,
    attemptResultType: null,
    lastAttemptAt: null,
    terminalAt: null,
    lastProviderRunAt: null,
    latestOutcomeCode: null,
    deliveryCode: "RETAINED"
  });
  await assert.rejects(
    deleteAlertRuleDraft("rule-1", client as never),
    (error: unknown) => error instanceof AlertRuleServiceError && error.code === "ALERT_STATE_RETAINED"
  );
});
test("WatchItem PATCH accepts only title, memo, and enabled", () => {
  assert.equal(watchItemUpdateSchema.safeParse({ title: "Updated" }).success, true);
  assert.equal(watchItemUpdateSchema.safeParse({ type: "flight" }).success, false);
  assert.equal(watchItemUpdateSchema.safeParse({ title: "Updated", paramsJson: "{}" }).success, false);
});
