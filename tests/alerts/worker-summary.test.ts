import assert from "node:assert/strict";
import test from "node:test";

import { formatAlertWorkerSummary } from "../../lib/alerts/worker-summary";

const encoder = new TextEncoder();

test("worker summary emits only allowlisted bounded counters, exit classification, and recovery linkage", () => {
  const output = formatAlertWorkerSummary({
    providerDispatched: 2,
    providerCooldownSkipped: 8,
    evaluated: 2,
    sent: 1,
    rejected: 1,
    ambiguous: 0,
    cancelled: 0,
    suppressed: 3,
    recoveredReserved: 4,
    recoveredSending: 5,
    blocked: 0,
    exitCode: 6,
    ruleId: "secret-rule-id",
    title: "private title",
    token: "super-secret"
  } as Parameters<typeof formatAlertWorkerSummary>[0] & Record<string, unknown>);

  assert.deepEqual(JSON.parse(output), {
    providerDispatched: 2,
    providerCooldownSkipped: 8,
    evaluated: 2,
    sent: 1,
    rejected: 1,
    ambiguous: 0,
    cancelled: 0,
    suppressed: 3,
    recoveredReserved: 4,
    recoveredSending: 5,
    blocked: 0,
    exitCode: 6
  });
  assert.equal(output.includes("secret"), false);
  assert.ok(encoder.encode(output).byteLength <= 1_024);
});

test("worker summary drops invalid values and unknown fields", () => {
  const output = formatAlertWorkerSummary({
    sent: 10_001,
    rejected: 1.5,
    blocked: Number.NaN,
    exitCode: 1,
    code: "line\nbreak",
    raw: "stderr",
    id: "rule-id"
  } as Parameters<typeof formatAlertWorkerSummary>[0] & Record<string, unknown>);

  assert.deepEqual(JSON.parse(output), {});
  assert.ok(encoder.encode(output).byteLength <= 1_024);
});

test("worker summary accepts every process exit classification and remains bounded", () => {
  for (const exitCode of [0, 4, 5, 6, 7]) {
    const output = formatAlertWorkerSummary({ exitCode });
    assert.deepEqual(JSON.parse(output), { exitCode });
    assert.ok(encoder.encode(output).byteLength <= 1_024);
  }
});
