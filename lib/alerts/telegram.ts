import type { AlertSecrets } from "@/lib/alerts/redaction";

export const TELEGRAM_TIMEOUT_MS = 10_000;
export const TELEGRAM_RESPONSE_LIMIT_BYTES = 65_536;
export const TELEGRAM_MESSAGE_LIMIT_CODE_POINTS = 3_000;
export const TELEGRAM_MESSAGE_LIMIT_BYTES = 12_000;
export const TELEGRAM_REQUEST_LIMIT_BYTES = 16_384;

export type TelegramDeliveryResult =
  | { outcome: "sent"; code: "TELEGRAM_SENT" }
  | { outcome: "rejected"; code: "TELEGRAM_RATE_LIMITED" | "TELEGRAM_4XX" }
  | { outcome: "ambiguous"; code: "TELEGRAM_AMBIGUOUS" };

type TelegramFetch = (input: string, init: RequestInit) => Promise<Response>;

const encoder = new TextEncoder();

function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validMessage(value: unknown): value is string {
  return typeof value === "string" && codePointLength(value) <= TELEGRAM_MESSAGE_LIMIT_CODE_POINTS && utf8Length(value) <= TELEGRAM_MESSAGE_LIMIT_BYTES;
}

function telegramUrl(botToken: string): string {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

function validTelegramSuccess(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const body = value as Record<string, unknown>;
  if (body.ok !== true || body.result === null || typeof body.result !== "object" || Array.isArray(body.result)) {
    return false;
  }

  const messageId = (body.result as Record<string, unknown>).message_id;
  return typeof messageId === "number" && Number.isInteger(messageId);
}

async function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    throw new Error("aborted");
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new Error("aborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    void reader.read().then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<Uint8Array | null> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    let done = false;
    while (!done) {
      const next = await readWithAbort(reader, signal);
      if (next.done) {
        done = true;
        continue;
      }
      total += next.value.byteLength;
      if (total > TELEGRAM_RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const responseBytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    responseBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return responseBytes;
}

/**
 * Sends exactly one plain-text Bot API request using the preflight-owned credential snapshot.
 * Transport failures intentionally collapse to a closed ambiguous code; no payload or native error escapes.
 */
export async function sendTelegramMessage(
  credentials: Readonly<AlertSecrets>,
  message: string,
  fetchImplementation: TelegramFetch = globalThis.fetch
): Promise<TelegramDeliveryResult> {
  if (!validMessage(message)) {
    return { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
  }

  const requestBody = JSON.stringify({ chat_id: credentials.chatId, text: message });
  if (utf8Length(requestBody) > TELEGRAM_REQUEST_LIMIT_BYTES) {
    return { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(telegramUrl(credentials.botToken), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
      redirect: "error",
      signal: controller.signal
    });
    const responseBytes = await readBoundedResponse(response, controller.signal);

    if (response.status >= 400 && response.status <= 499) {
      return { outcome: "rejected", code: response.status === 429 ? "TELEGRAM_RATE_LIMITED" : "TELEGRAM_4XX" };
    }

    if (response.status < 200 || response.status > 299 || responseBytes === null) {
      return { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
    }

    try {
      return validTelegramSuccess(JSON.parse(new TextDecoder().decode(responseBytes)))
        ? { outcome: "sent", code: "TELEGRAM_SENT" }
        : { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
    } catch {
      return { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
    }
  } catch {
    return { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
  } finally {
    clearTimeout(timeout);
  }
}
