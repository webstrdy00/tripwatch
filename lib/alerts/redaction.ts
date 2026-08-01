export const REDACTION_SENTINEL = "[REDACTED]";
const MAX_DIAGNOSTIC_BYTES = 2_048;
const MAX_EVENT_BYTES = 1_024;
const MAX_CODE_LENGTH = 64;
const encoder = new TextEncoder();

export interface AlertSecrets {
  botToken: string;
  chatId: string;
}

export interface Redactor {
  redact(value: string): string;
  redactDiagnostic(value: unknown): string;
}

function bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateUtf8(value: string, maximum: number): string {
  if (bytes(value) <= maximum) {
    return value;
  }
  let result = "";
  for (const point of value) {
    if (bytes(result + point) > maximum) {
      break;
    }
    result += point;
  }
  return result;
}

function replaceExact(value: string, secret: string): string {
  if (secret === "") {
    return value;
  }
  return value.split(secret).join(REDACTION_SENTINEL);
}

/** Exact-value replacement only: no token-like heuristics or partial secret inference. */
export function createAlertRedactor(secrets: Readonly<AlertSecrets>): Redactor {
  const values = Object.freeze([secrets.botToken, secrets.chatId].filter((value, index, all) => value !== "" && all.indexOf(value) === index));
  return Object.freeze({
    redact(value: string): string {
      return values.reduce((redacted, secret) => replaceExact(redacted, secret), value);
    },
    redactDiagnostic(value: unknown): string {
      const text = typeof value === "string" ? value : value instanceof Error ? value.message : "diagnostic unavailable";
      return truncateUtf8(values.reduce((redacted, secret) => replaceExact(redacted, secret), text), MAX_DIAGNOSTIC_BYTES);
    }
  });
}

export function boundedAlertCode(value: string): string {
  return /^[\x21-\x7E]{1,64}$/.test(value) ? value : "INVALID_CODE";
}

/** Produces a closed, bounded JSON event; arbitrary objects/errors are not accepted. */
export function formatAlertDiagnosticEvent(fields: Readonly<Record<string, string | number | boolean | null>>): string {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) {
      continue;
    }
    const candidate = typeof value === "string" ? truncateUtf8(value, MAX_CODE_LENGTH) : value;
    const serialized = JSON.stringify({ ...safe, [key]: candidate });
    if (bytes(serialized) > MAX_EVENT_BYTES) {
      break;
    }
    safe[key] = candidate;
  }
  return JSON.stringify(safe);
}

export const ALERT_DIAGNOSTIC_LIMITS = Object.freeze({
  code: MAX_CODE_LENGTH,
  eventBytes: MAX_EVENT_BYTES,
  summaryBytes: MAX_DIAGNOSTIC_BYTES
});
