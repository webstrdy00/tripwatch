import assert from "node:assert/strict";
import test from "node:test";

import { aggregateAlertExitCodes, ALERT_EXIT_CODE, shouldStopAlertRun } from "../../lib/alerts/exit-codes";
import { composeAlertMessage, sanitizeAlertDisplay } from "../../lib/alerts/message-composer";
import { ALERT_DIAGNOSTIC_LIMITS, createAlertRedactor, REDACTION_SENTINEL } from "../../lib/alerts/redaction";
import { ATTEMPT_INTERVAL_MS, classifyIncompleteAttempt, isProviderDispatchDue, transitionSuccessfulBaseline } from "../../lib/alerts/state-machine";

const now = new Date("2026-07-18T12:00:00.000Z");
const emptyBaseline = { baselineState: "never" as const, baselineFingerprint: null, baselineTransitionSeq: 0, baselineAt: null, lastAttemptAt: null };

test("successful transitions separate latest outcome, baseline, and delivery action", () => {
  const first = transitionSuccessfulBaseline(emptyBaseline, { matched: true, fingerprint: "v1:F" }, now);
  assert.equal(first.latestOutcome, "success_matched");
  assert.equal(first.deliveryAction, "reserve");
  assert.equal(first.baselineTransitionSeq, 1);

  const unchanged = transitionSuccessfulBaseline({ ...first, lastAttemptAt: now }, { matched: true, fingerprint: "v1:F" }, new Date(now.getTime() + ATTEMPT_INTERVAL_MS * 2));
  assert.equal(unchanged.deliveryAction, "none");
  assert.equal(unchanged.baselineTransitionSeq, 1);

  const noMatch = transitionSuccessfulBaseline({ ...first, lastAttemptAt: now }, { matched: false }, now);
  assert.deepEqual([noMatch.baselineState, noMatch.baselineFingerprint, noMatch.deliveryAction], ["no_match", null, "none"]);

  const reappeared = transitionSuccessfulBaseline({ ...noMatch, lastAttemptAt: now }, { matched: true, fingerprint: "v1:F" }, now);
  assert.equal(reappeared.deliveryAction, "suppressed");
  assert.equal(reappeared.baselineTransitionSeq, 3);
});
test("per-rule provider dispatch intervals are null-due, inclusive, and fail closed", () => {
  const intervals = [
    ["flight", 86_400_000],
    ["express_bus", 3_600_000],
    ["intercity_bus", 3_600_000],
    ["ticket", 3_600_000],
    ["foresttrip", 21_600_000]
  ] as const;
  for (const [type, interval] of intervals) {
    assert.equal(isProviderDispatchDue(type, null, now), true);
    assert.equal(isProviderDispatchDue(type, new Date(now.getTime() - interval + 1), now), false);
    assert.equal(isProviderDispatchDue(type, new Date(now.getTime() - interval), now), true);
  }
  assert.equal(isProviderDispatchDue("unsupported", null, now), false);
  assert.equal(isProviderDispatchDue("flight", new Date("invalid"), now), false);
});

test("attempt gate is inclusive and F/F1/F2 transitions are distinct", () => {
  const prior = { ...emptyBaseline, baselineState: "matched" as const, baselineFingerprint: "F", baselineTransitionSeq: 1, lastAttemptAt: now };
  assert.equal(transitionSuccessfulBaseline(prior, { matched: true, fingerprint: "F1" }, new Date(now.getTime() + ATTEMPT_INTERVAL_MS - 1)).deliveryAction, "suppressed");
  assert.equal(transitionSuccessfulBaseline(prior, { matched: true, fingerprint: "F1" }, new Date(now.getTime() + ATTEMPT_INTERVAL_MS)).deliveryAction, "reserve");
  assert.equal(transitionSuccessfulBaseline({ ...prior, baselineFingerprint: "F1" }, { matched: true, fingerprint: "F2" }, new Date(now.getTime() + ATTEMPT_INTERVAL_MS)).baselineTransitionSeq, 2);
});

test("recovery classifies reserved as cancelled and sending as ambiguous without retry", () => {
  const attempt = { attemptId: "a", attemptRunId: "r", attemptFingerprint: "f", attemptTransitionSeq: 1, attemptResultId: "q", attemptResultType: "flight", lastAttemptAt: now };
  assert.deepEqual(classifyIncompleteAttempt({ ...attempt, deliveryState: "reserved" }), { kind: "cancelled", deliveryState: "cancelled", code: "RECOVERED_BEFORE_SEND" });
  assert.deepEqual(classifyIncompleteAttempt({ ...attempt, deliveryState: "sending" }), { kind: "ambiguous", deliveryState: "ambiguous", code: "RECOVERED_DURING_SEND" });
});

test("message composition sanitizes hostile Unicode, caps matches, and retains mandatory footer", () => {
  const result = composeAlertMessage({
    type: "flight\u202E\n",
    mode: "search\u0000",
    title: "  title\t\u2066 ",
    matches: Array.from({ length: 7 }, (_, index) => ({ summary: `match ${index}\n${"x".repeat(2_000)}` })),
    checkedAt: now,
    officialUrl: "https://www.google.com/travel/flights",
    officialUrlAllowed: true,
    chatId: "123"
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.text, /Checked: 2026-07-18T12:00:00.000Z/);
  assert.match(result.text, /Official: https:\/\/www.google.com\/travel\/flights/);
  assert.equal(result.text.includes("\u202E"), false);
  assert.equal(result.includedMatches, 5);
  assert.equal(sanitizeAlertDisplay("\u0000\u202E", "title"), "—");
});

test("message fixed overflow fails before a reservation could occur", () => {
  const result = composeAlertMessage({ type: "flight", mode: "search", title: "title", matches: [], checkedAt: now, officialUrl: "https://example.com", officialUrlAllowed: true, chatId: "x".repeat(20_000) });
  assert.deepEqual(result, { ok: false, code: "MESSAGE_INVALID" });
});

test("redaction replaces only exact credential and chat values and bounds diagnostics", () => {
  const redactor = createAlertRedactor({ botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE", chatId: "-100123" });
  assert.equal(redactor.redact("123456:abcdefghijklmnopqrstuvwxyzABCDE / -100123 / 123456"), `${REDACTION_SENTINEL} / ${REDACTION_SENTINEL} / 123456`);
  assert.ok(new TextEncoder().encode(redactor.redactDiagnostic("x".repeat(3_000))).byteLength <= ALERT_DIAGNOSTIC_LIMITS.summaryBytes);
});

test("exit aggregation is fail-fast and invariant precedence wins", () => {
  assert.equal(aggregateAlertExitCodes([ALERT_EXIT_CODE.evaluation, ALERT_EXIT_CODE.rejected]), ALERT_EXIT_CODE.rejected);
  assert.equal(aggregateAlertExitCodes([ALERT_EXIT_CODE.ambiguous, ALERT_EXIT_CODE.invariant]), ALERT_EXIT_CODE.invariant);
  assert.equal(shouldStopAlertRun(ALERT_EXIT_CODE.rejected), true);
  assert.equal(shouldStopAlertRun(ALERT_EXIT_CODE.evaluation), false);
});
