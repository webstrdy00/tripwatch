import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  TELEGRAM_REQUEST_LIMIT_BYTES,
  TELEGRAM_RESPONSE_LIMIT_BYTES,
  sendTelegramMessage
} from "../../lib/alerts/telegram";

const credentials = Object.freeze({ botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE", chatId: "-100123" });
const tokenSentinel = credentials.botToken;

function response(status: number, body: string): Response {
  return new Response(body, { status });
}

function oversizedResponse(status: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(TELEGRAM_RESPONSE_LIMIT_BYTES + 1));
      controller.close();
    }
  });
  return new Response(stream, { status });
}

test("Telegram sends one fixed plain-text request and accepts only the bounded success shape", async () => {
  let calls = 0;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const result = await sendTelegramMessage(credentials, "hello", async (url, init) => {
    calls += 1;
    capturedUrl = url;
    capturedInit = init;
    return response(200, '{"ok":true,"result":{"message_id":7}}');
  });

  assert.deepEqual(result, { outcome: "sent", code: "TELEGRAM_SENT" });
  assert.equal(calls, 1);
  assert.equal(capturedUrl, `https://api.telegram.org/bot${tokenSentinel}/sendMessage`);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal((capturedInit?.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal(JSON.parse(String(capturedInit?.body)).text, "hello");
  assert.equal("parse_mode" in JSON.parse(String(capturedInit?.body)), false);
});

test("Telegram rejects all 4xx responses, including an oversized 4xx body", async () => {
  assert.deepEqual(await sendTelegramMessage(credentials, "hello", async () => response(400, "not-json")), { outcome: "rejected", code: "TELEGRAM_4XX" });
  assert.deepEqual(await sendTelegramMessage(credentials, "hello", async () => response(429, "not-json")), { outcome: "rejected", code: "TELEGRAM_RATE_LIMITED" });
  assert.deepEqual(await sendTelegramMessage(credentials, "hello", async () => oversizedResponse(400)), { outcome: "rejected", code: "TELEGRAM_4XX" });
});

test("Telegram makes malformed, rejected, oversized, redirect, server, and network results ambiguous without retry", async () => {
  const cases: Array<() => Promise<Response>> = [
    async () => response(200, "not-json"),
    async () => response(200, '{"ok":false,"result":{"message_id":7}}'),
    async () => response(200, '{"ok":true,"result":{"message_id":"7"}}'),
    async () => oversizedResponse(200),
    async () => response(302, ""),
    async () => response(500, "")
  ];

  for (const fetchImplementation of cases) {
    assert.deepEqual(await sendTelegramMessage(credentials, "hello", fetchImplementation), { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" });
  }

  let calls = 0;
  const networkResult = await sendTelegramMessage(credentials, "hello", async () => {
    calls += 1;
    throw new Error(`network failure for ${tokenSentinel}`);
  });
  assert.deepEqual(networkResult, { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(networkResult).includes(tokenSentinel), false);
});
test("Telegram timeout aborts one request and reports a closed ambiguous code", async () => {
  const timer = mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    queueMicrotask(callback);
    return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

  try {
    let calls = 0;
    const result = await sendTelegramMessage(credentials, "hello", async (_url, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error(`timeout ${tokenSentinel}`)), { once: true });
      });
    });
    assert.deepEqual(result, { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" });
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(tokenSentinel), false);
  } finally {
    timer.mock.restore();
  }
});

test("Telegram never requests an over-limit message or request body", async () => {
  let calls = 0;
  const fakeFetch = async (): Promise<Response> => {
    calls += 1;
    return response(200, '{"ok":true,"result":{"message_id":7}}');
  };

  assert.deepEqual(await sendTelegramMessage(credentials, "x".repeat(3_001), fakeFetch), { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" });
  assert.deepEqual(await sendTelegramMessage(credentials, "x".repeat(TELEGRAM_REQUEST_LIMIT_BYTES), fakeFetch), { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" });
  assert.equal(calls, 0);
});
