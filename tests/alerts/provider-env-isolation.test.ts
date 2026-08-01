import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runHelperCommand, type HelperCommandOptions } from "../../lib/shell";

const tokenSentinel = "123456:abcdefghijklmnopqrstuvwxyzABCDE";
const chatSentinel = "-100123";

type SpawnCall = { command: string; args: string[]; env: NodeJS.ProcessEnv | undefined };

function fakeSpawn(calls: SpawnCall[]): NonNullable<HelperCommandOptions["spawnImplementation"]> {
  const implementation: NonNullable<HelperCommandOptions["spawnImplementation"]> = (
    command,
    args,
    options,
  ) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true
    });
    calls.push({ command, args: [...args], env: options.env });
    queueMicrotask(() => {
      child.stdout.end("{}");
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };

  return implementation;
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
