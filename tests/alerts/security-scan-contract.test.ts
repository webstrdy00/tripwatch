import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AUTOMATED_TRANSACTION_ACTION_PATTERN,
  childProcessLaunchOffsets,
  classifyChildProcessLaunches,
  isApprovedAlertStateKeyword
} from "../../scripts/security-scan";

function matchesAction(value: string): boolean {
  AUTOMATED_TRANSACTION_ACTION_PATTERN.lastIndex = 0;
  return AUTOMATED_TRANSACTION_ACTION_PATTERN.test(value);
}

test("transaction action rule catches prohibited domain actions without matching stream cancellation", () => {
  for (const prohibited of [
    "reserve()",
    "autoPay()",
    "cancelBooking()",
    "cancelReservation()",
    "seatSelect()"
  ]) {
    assert.equal(matchesAction(prohibited), true, prohibited);
  }

  for (const allowed of [
    "reader.cancel()",
    "controller.cancel()",
    "createSuppressedDelivery()",
    "deliveryState = 'reserved'"
  ]) {
    assert.equal(matchesAction(allowed), false, allowed);
  }
});
test("child-process launch inventory includes direct, sync, and injected calls", () => {
  const source = [
    "spawn(command, args, { shell: false });",
    "spawnSync(command, args, { shell: false });",
    "execFile(command, args, options);",
    "execFileSync(command, args, options);",
    "(options.spawnImplementation ?? spawn)(command, args, { shell: false });",
    "(seams.spawnChild ?? spawn)(command, args, { shell: false });"
  ].join("\n");

  const offsets = childProcessLaunchOffsets(source);

  assert.equal(offsets.length, 6);
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
});
test("child-process classification cannot borrow a later call's shell contract", () => {
  const relativeFile = "lib/shell.ts";
  const source = readFileSync(resolve(process.cwd(), relativeFile), "utf8");
  const withoutLocalShellContract = source.replace("shell: false", "stdio: 'pipe'");
  const withLaterContract =
    `${withoutLocalShellContract}\n(options.spawnImplementation ?? spawn)(command, [...args], { shell: false });\n`;

  const classifications = classifyChildProcessLaunches(relativeFile, withLaterContract);

  assert.deepEqual(
    classifications.map(({ classification }) => classification),
    ["HIGH", "HIGH"]
  );
});

test("owned-temp classification rejects an additional unapproved launch", () => {
  const relativeFile = "scripts/with-owned-temp-db.ts";
  const source = readFileSync(resolve(process.cwd(), relativeFile), "utf8");
  const baseline = classifyChildProcessLaunches(relativeFile, source);

  assert.equal(baseline.length, 2);
  assert.deepEqual(
    baseline.map(({ classification }) => classification),
    ["ALLOWED", "ALLOWED"]
  );

  const withUnexpectedLaunch = `${source}\nspawn("unexpected", [], { shell: false });\n`;
  const classifications = classifyChildProcessLaunches(relativeFile, withUnexpectedLaunch);

  assert.equal(classifications.length, 3);
  assert.equal(classifications.at(-1)?.classification, "HIGH");
});
test("helper smoke classification binds timeout and output bounds to each lexical supervisor", () => {
  const relativeFile = "scripts/helper-smoke.ts";
  const source = readFileSync(resolve(process.cwd(), relativeFile), "utf8");
  const baseline = classifyChildProcessLaunches(relativeFile, source);

  assert.deepEqual(
    baseline.map(({ classification }) => classification),
    ["ALLOWED", "ALLOWED"]
  );

  const withoutWslTimeout = source.replace("timeout: 10_000", "timeout: undefined");
  assert.deepEqual(
    classifyChildProcessLaunches(relativeFile, withoutWslTimeout).map(({ classification }) => classification),
    ["HIGH", "ALLOWED"]
  );
});

test("owned-temp classification rejects missing local bounds and duplicated approved shapes", () => {
  const relativeFile = "scripts/with-owned-temp-db.ts";
  const source = readFileSync(resolve(process.cwd(), relativeFile), "utf8");

  const withoutMigrationTimeout = source.replace("timeout: 60_000", "timeout: undefined");
  assert.deepEqual(
    classifyChildProcessLaunches(relativeFile, withoutMigrationTimeout).map(({ classification }) => classification),
    ["HIGH", "ALLOWED"]
  );

  const duplicatedApprovedShape =
    `${source}\n(seams.spawnChild ?? spawn)(invocation.executable, invocation.args, { shell: false });\n`;
  assert.deepEqual(
    classifyChildProcessLaunches(relativeFile, duplicatedApprovedShape).map(({ classification }) => classification),
    ["ALLOWED", "ALLOWED", "HIGH"]
  );
});

test("scanner pins 127-only sockets separately from dual self-consistent request authorities", () => {
  const source = readFileSync(resolve(process.cwd(), "scripts/security-scan.ts"), "utf8");

  for (const contract of [
    "ALERT_DEFAULT_LOOPBACK_BINDING",
    "ALERT_LOOPBACK_SOCKET_AND_HTTP_CONTRACT",
    "API_BOUNDARY_INVENTORY",
    "API_BOUNDARY_MIXED_AND_FORWARDED_REJECTION",
    "LOCAL_OPERATOR_EXACT_HOSTNAMES",
    "LOCAL_OPERATOR_HOST_ORIGIN_EQUALITY",
    "LOCAL_OPERATOR_NO_FORWARDED_RESCUE"
  ]) {
    assert.ok(source.includes(contract), contract);
  }

  assert.match(source, /next dev -H 127\\\.0\\\.0\\\.1/);
  assert.match(source, /127\\\.0\\\.0\\\.1[\s\S]*?localhost/);
  assert.ok(source.includes("request instanceof NextRequest"));
  assert.ok(source.includes('request\\.nextUrl\\.hostname === "localhost"'));
  assert.ok(source.includes('hostUrl\\.hostname === "127\\.0\\.0\\.1"'));
  assert.ok(source.includes('headers\\.get\\("origin"\\) !== hostUrl\\.origin'));
});

test("fingerprint and reserve allowlists require exact approved state symbols", () => {
  const approved = '    deliveryAction: eligible ? "reserve" : "suppressed"';
  const unrelated = '    const reserve = await reserveSeat();';
  const fingerprint = "    let fingerprint: string | null = null;";

  assert.equal(isApprovedAlertStateKeyword("lib/alerts/state-machine.ts", "reserve", approved, approved.indexOf("reserve")), true);
  assert.equal(isApprovedAlertStateKeyword("lib/alerts/state-machine.ts", "reserve", unrelated, unrelated.indexOf("reserve")), false);
  assert.equal(
    isApprovedAlertStateKeyword("lib/services/alert-worker-service.ts", "fingerprint", fingerprint, fingerprint.indexOf("fingerprint")),
    true
  );
  assert.equal(
    isApprovedAlertStateKeyword("lib/services/alert-worker-service.ts", "fingerprint", "const fingerprint = unsafe();", 6),
    false
  );
});
