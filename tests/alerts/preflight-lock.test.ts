import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import test from "node:test";
import { ALERT_DEFAULT_LIMIT, AlertPreflightError, assertWslEvidence, parseAlertArguments, preflightAlertBootstrap } from "../../lib/alerts/alert-preflight";
import { acquireAlertWorkerLock, ALERT_WORKER_LOCK_PATH, AlertWorkerLockError } from "../../lib/alerts/worker-lock";

const token = `123456:${"a".repeat(30)}`;
const credentials: NodeJS.ProcessEnv = { NODE_ENV: "test", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: "-12345" };
const wslRuntime = {
  platform: "linux",
  getuid: () => 1000,
  readProc: () => "Linux microsoft-standard-WSL2"
};

function preflightError(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof AlertPreflightError && error.code === code);
}

test("alert argv permits only the approved literal grammar", () => {
  assert.equal(parseAlertArguments(["--send-telegram"]), ALERT_DEFAULT_LIMIT);
  assert.equal(parseAlertArguments(["--send-telegram", "--limit", "10"]), 10);
  for (const argv of [[], ["--send-telegram", "--limit", "01"], ["--send-telegram", "--limit=5"], ["--limit", "5", "--send-telegram"], ["--send-telegram", "--send-telegram"], ["--send-telegram", "extra"]]) {
    preflightError(() => parseAlertArguments(argv), "INVALID_ARGUMENTS");
  }
});

test("WSL evidence requires Linux, uid, and both Microsoft proc signals", () => {
  assert.equal(assertWslEvidence(wslRuntime), 1000);
  preflightError(() => assertWslEvidence({ ...wslRuntime, platform: "win32" }), "WSL_REQUIRED");
  preflightError(() => assertWslEvidence({ ...wslRuntime, readProc: (path) => path.endsWith("osrelease") ? "microsoft" : "linux" }), "WSL_REQUIRED");
  preflightError(() => assertWslEvidence({ ...wslRuntime, readProc: () => "microsoft".repeat(1000) }), "WSL_REQUIRED");
});

test("mock denial, credential grammar, immutable snapshot, and ambient deletion are fail closed", () => {
  preflightError(() => preflightAlertBootstrap(["--send-telegram"], { ...credentials, TRIPWATCH_USE_MOCK_HELPERS: "true" }, wslRuntime), "MOCK_HELPERS_FORBIDDEN");
  preflightError(() => preflightAlertBootstrap(["--send-telegram"], { ...credentials, TELEGRAM_BOT_TOKEN: ` ${token}` }, wslRuntime), "INVALID_TELEGRAM_CREDENTIALS");
  const env = { ...credentials };
  const bootstrap = preflightAlertBootstrap(["--send-telegram"], env, wslRuntime);
  assert.equal(Object.isFrozen(bootstrap.credentials), true);
  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(env.TELEGRAM_CHAT_ID, undefined);
});

test("production entrypoint keeps DB/provider imports behind its sole dynamic worker import", () => {
  const source = readFileSync("scripts/run-alerts.ts", "utf8");
  assert.equal((source.match(/await import\(/g) ?? []).length, 1);
  assert.match(source, /await import\("\.\.\/lib\/services\/alert-worker-service"\)/);
  assert.doesNotMatch(source, /from "\.\.\/lib\/(?:db|services\/(?!alert-worker-service))/);
});

function cleanPath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

test("lock rejects symlink, FIFO, and directory occupants without unlinking them", { concurrency: false }, () => {
  const uid = process.getuid?.();
  if (process.platform !== "linux" || uid === undefined) {
    return;
  }
  const path = ALERT_WORKER_LOCK_PATH(uid);
  if (existsSync(path)) {
    return;
  }
  try {
    symlinkSync("/dev/null", path);
    assert.throws(() => acquireAlertWorkerLock(uid), AlertWorkerLockError);
    assert.equal(lstatSync(path).isSymbolicLink(), true);
    unlinkSync(path);

    execFileSync("mkfifo", [path]);
    assert.throws(() => acquireAlertWorkerLock(uid), AlertWorkerLockError);
    assert.equal(lstatSync(path).isFIFO(), true);
    unlinkSync(path);

    mkdirSync(path);
    assert.throws(() => acquireAlertWorkerLock(uid), AlertWorkerLockError);
    assert.equal(lstatSync(path).isDirectory(), true);
  } finally {
    cleanPath(path);
  }
});

test("lock cleanup refuses an inode replacement and leaves its replacement intact", { concurrency: false }, () => {
  const uid = process.getuid?.();
  if (process.platform !== "linux" || uid === undefined) {
    return;
  }
  const path = ALERT_WORKER_LOCK_PATH(uid);
  const moved = `${path}.test-moved-${process.pid}`;
  if (existsSync(path) || existsSync(moved)) {
    return;
  }
  try {
    const lock = acquireAlertWorkerLock(uid);
    // Rename keeps the original inode away from the lock path; cleanup must not unlink the new file.
    renameSync(path, moved);
    writeFileSync(path, "replacement", { mode: 0o600 });
    assert.throws(() => lock.release(), AlertWorkerLockError);
    assert.equal(readFileSync(path, "utf8"), "replacement");
  } finally {
    cleanPath(path);
    cleanPath(moved);
  }
});
