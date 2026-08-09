import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runHelperCommand, type HelperCommandOptions } from "../../lib/shell";

const tokenSentinel = "123456:abcdefghijklmnopqrstuvwxyzABCDE";
const chatSentinel = "-100123";

type SpawnCall = { command: string; args: string[]; env: NodeJS.ProcessEnv | undefined; detached: boolean | undefined };
type FakeChild = EventEmitter & {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  kill(signal?: NodeJS.Signals | number): boolean;
};

function createFakeChild(pid: number, signals: Array<NodeJS.Signals | number>): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: (signal?: NodeJS.Signals | number) => {
      if (signal) signals.push(signal);
      return true;
    }
  });
}

function fakeSpawn(calls: SpawnCall[]): NonNullable<HelperCommandOptions["spawnImplementation"]> {
  const implementation: NonNullable<HelperCommandOptions["spawnImplementation"]> = (
    command,
    args,
    options
  ) => {
    const child = createFakeChild(calls.length + 1, []);
    calls.push({ command, args: [...args], env: options.env, detached: options.detached });
    queueMicrotask(() => {
      child.stdout.end("{}");
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };

  return implementation;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 150): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for fake process signal");
    await delay(5);
  }
}

function assertTelegramAbsent(env: NodeJS.ProcessEnv | undefined): void {
  assert.ok(env);
  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(env.TELEGRAM_CHAT_ID, undefined);
  assert.equal(Object.values(env).includes(tokenSentinel), false);
  assert.equal(Object.values(env).includes(chatSentinel), false);
}

test("all provider helper styles receive a cloned environment without Telegram credentials", async () => {
  const calls: SpawnCall[] = [];
  const spawnImplementation = fakeSpawn(calls);
  const providerStyles = [
    ["flight-helper", ["--from", "ICN"]],
    ["express-bus-helper", ["--date", "2026-08-01"]],
    ["intercity-bus-helper", ["--date", "2026-08-01"]],
    ["ticket-helper", ["--event", "42"]],
    ["foresttrip-helper", ["--forest", "alpha"]]
  ] as const;

  for (const [command, args] of providerStyles) {
    const selectedEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PROVIDER_STYLE: command, TELEGRAM_BOT_TOKEN: tokenSentinel, TELEGRAM_CHAT_ID: chatSentinel };
    await runHelperCommand(command, args, { timeoutMs: 1_000, env: selectedEnv, spawnImplementation });
    assert.equal(selectedEnv.TELEGRAM_BOT_TOKEN, tokenSentinel);
    assert.equal(selectedEnv.TELEGRAM_CHAT_ID, chatSentinel);
    assert.notEqual(calls[calls.length - 1].env, selectedEnv);
  }

  assert.equal(calls.length, providerStyles.length);
  for (const call of calls) {
    assertTelegramAbsent(call.env);
  }
});

test("the default process environment is also cloned and stripped immediately before spawn", async () => {
  const calls: SpawnCall[] = [];
  const priorToken = process.env.TELEGRAM_BOT_TOKEN;
  const priorChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = tokenSentinel;
  process.env.TELEGRAM_CHAT_ID = chatSentinel;

  try {
    await runHelperCommand("flight-helper", [], { timeoutMs: 1_000, spawnImplementation: fakeSpawn(calls) });
  } finally {
    if (priorToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = priorToken;
    if (priorChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = priorChat;
  }

  assert.equal(calls.length, 1);
  assertTelegramAbsent(calls[0].env);
});
test("timeout terminates only the fake direct child with TERM then KILL and settles once after close", async () => {
  const signals: Array<NodeJS.Signals | number> = [];
  const events: string[] = [];
  let child!: FakeChild;
  let spawnCount = 0;
  const spawnImplementation: NonNullable<HelperCommandOptions["spawnImplementation"]> = (_command, _args, options) => {
    spawnCount += 1;
    assert.equal(options.env?.TELEGRAM_BOT_TOKEN, undefined);
    child = createFakeChild(731, signals);
    return child;
  };

  const pending = runHelperCommand("fake-helper", [], { timeoutMs: 5, spawnImplementation });
  let settlements = 0;
  void pending.then(
    () => {
      settlements += 1;
    },
    () => {
      settlements += 1;
    }
  );

  await waitFor(() => signals.length === 2);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.pid, 731);
  events.push("close");
  child.emit("close", 0);
  child.emit("close", 0);

  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "HELPER_TIMEOUT");
    return true;
  });
  assert.equal(spawnCount, 1);
  assert.deepEqual(events, ["close"]);
  assert.equal(settlements, 1);
});

test("stdout overflow retains the byte cap, terminates once, and never parses late output", async () => {
  const signals: Array<NodeJS.Signals | number> = [];
  let child!: FakeChild;
  const spawnImplementation: NonNullable<HelperCommandOptions["spawnImplementation"]> = () => {
    child = createFakeChild(732, signals);
    return child;
  };

  const pending = runHelperCommand("fake-helper", [], {
    timeoutMs: 1_000,
    stdoutLimitBytes: 1,
    spawnImplementation
  });
  child.stdout.write("😀");
  child.stdout.write('{"late":true}');
  await waitFor(() => signals.length === 2);
  child.emit("close", 0);

  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: unknown }).code, "HELPER_FAILED");
    return true;
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("missing close after direct-child termination reports termination failure without retrying", async () => {
  const signals: Array<NodeJS.Signals | number> = [];
  let spawnCount = 0;
  const spawnImplementation: NonNullable<HelperCommandOptions["spawnImplementation"]> = () => {
    spawnCount += 1;
    return createFakeChild(733, signals);
  };

  await assert.rejects(
    runHelperCommand("fake-helper", [], { timeoutMs: 5, spawnImplementation }),
    (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "HELPER_TERMINATION_FAILED");
      return true;
    }
  );
  assert.equal(spawnCount, 1);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test(
  "POSIX timeout kills an owned helper process group including a TERM-resistant descendant",
  { skip: process.platform === "win32" },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "jaridash-helper-group-"));
    const pidPath = join(directory, "descendant.pid");
    const descendantSource = "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
    const parentSource = [
      "const {spawn}=require('node:child_process')",
      "const {writeFileSync}=require('node:fs')",
      "const child=spawn(process.execPath,['-e',process.argv[2]],{stdio:'ignore'})",
      "writeFileSync(process.argv[1],String(child.pid))",
      "process.on('SIGTERM',()=>{})",
      "setInterval(()=>{},1000)"
    ].join(";");

    try {
      await assert.rejects(
        runHelperCommand(process.execPath, ["-e", parentSource, pidPath, descendantSource], { timeoutMs: 150 }),
        (error: unknown) => {
          assert.equal((error as { code?: unknown }).code, "HELPER_TIMEOUT");
          return true;
        }
      );

      const descendantPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
      assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
      assert.throws(
        () => process.kill(descendantPid, 0),
        (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH"
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
