import assert from "node:assert/strict";
import test from "node:test";

import { serializeWatchItem, watchItemInclude } from "@/lib/watchlist";
import { serializeAlertRule } from "@/lib/services/alert-rule-service";

const timestamp = new Date("2026-07-18T12:00:00.000Z");
const publicAlertRuleKeys = [
  "id",
  "watchItemId",
  "channel",
  "condition",
  "enabled",
  "outboundOptIn",
  "configVersion",
  "latestOutcome",
  "latestOutcomeAt",
  "latestOutcomeCode",
  "baselineState",
  "baselineTransitionSeq",
  "baselineAt",
  "deliveryState",
  "lastAttemptAt",
  "terminalAt",
  "deliveryCode",
  "lastProviderRunAt",
  "createdAt",
  "updatedAt"
];

function watchItem(alertRule: ReturnType<typeof populatedAlertRule> | null = null) {
  return {
    id: "watch-1",
    type: "flight",
    title: "Flight",
    paramsJson: "{}",
    memo: null,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    results: [
      {
        id: "latest-result",
        status: "success",
        source: "flight-ticket-search",
        checkedAt: timestamp,
        summary: "Latest",
        officialUrl: null,
        errorCode: null,
        errorText: null,
        createdAt: timestamp
      },
      {
        id: "older-result",
        status: "failed",
        source: null,
        checkedAt: new Date("2026-07-17T12:00:00.000Z"),
        summary: null,
        officialUrl: null,
        errorCode: null,
        errorText: "Older",
        createdAt: timestamp
      }
    ],
    alertRule
  };
}

function populatedAlertRule(conditionJson = JSON.stringify({ kind: "availability" })) {
  return {
    id: "alert-1",
    watchItemId: "watch-1",
    channel: "telegram",
    conditionJson,
    enabled: true,
    outboundOptIn: false,
    configVersion: 2,
    latestOutcome: "success_no_match",
    latestOutcomeAt: null,
    latestOutcomeCode: null,
    baselineState: "no_match",
    baselineFingerprint: "internal-fingerprint",
    baselineTransitionSeq: 4,
    baselineAt: null,
    deliveryState: "never",
    attemptId: "internal-attempt",
    attemptRunId: "internal-run",
    attemptFingerprint: "internal-attempt-fingerprint",
    attemptTransitionSeq: 3,
    attemptResultId: "internal-result",
    attemptResultType: "flight",
    lastAttemptAt: null,
    terminalAt: null,
    deliveryCode: null,
    lastProviderRunAt: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

test("watch item include requests the deterministic latest result and alert rule", () => {
  assert.deepEqual(watchItemInclude, {
    results: {
      orderBy: [{ checkedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 1
    },
    alertRule: true
  });
});

test("serializer emits null alert rules and preserves the latest result summary", () => {
  const item = serializeWatchItem(watchItem());

  assert.equal(item.alertRule, null);
  assert.equal(item.latestResult?.id, "latest-result");
  assert.equal(item.latestResult?.checkedAt, "2026-07-18T12:00:00.000Z");
});

test("serializer emits only the public alert rule keys with explicit nulls", () => {
  const item = serializeWatchItem(watchItem(populatedAlertRule()));

  assert.ok(item.alertRule);
  assert.deepEqual(Object.keys(item.alertRule), publicAlertRuleKeys);
  assert.deepEqual(item.alertRule.condition, { kind: "availability" });
  assert.equal(item.alertRule.latestOutcomeAt, null);
  assert.equal(item.alertRule.createdAt, "2026-07-18T12:00:00.000Z");
  for (const internalKey of [
    "baselineFingerprint",
    "attemptId",
    "attemptRunId",
    "attemptFingerprint",
    "attemptTransitionSeq",
    "attemptResultId",
    "attemptResultType",
    "conditionJson",
    "credential",
    "telegramToken",
    "rawError"
  ]) {
    assert.equal(Object.hasOwn(item.alertRule, internalKey), false, internalKey);
  }
});
test("route-facing and WatchItem serializers produce the identical public alert rule", () => {
  const rule = populatedAlertRule();
  const fromWatchItem = serializeWatchItem(watchItem(rule)).alertRule;
  const fromAlertRuleRoute = serializeAlertRule({
    ...rule,
    watchItem: { type: "ticket", paramsJson: JSON.stringify({ mode: "seats" }) }
  } as Parameters<typeof serializeAlertRule>[0]);

  assert.deepEqual(fromAlertRuleRoute, fromWatchItem);
  assert.deepEqual(Object.keys(fromAlertRuleRoute), publicAlertRuleKeys);
});

test("serializer fail-closes malformed or non-strict alert conditions", () => {
  const malformed = serializeWatchItem(watchItem(populatedAlertRule("not-json")));
  const extraKey = serializeWatchItem(
    watchItem(populatedAlertRule(JSON.stringify({ kind: "availability", internal: true })))
  );

  assert.equal(malformed.alertRule, null);
  assert.equal(extraKey.alertRule, null);
});
