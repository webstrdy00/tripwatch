const DASH = "—";
const MAX_MESSAGE_CODE_POINTS = 3_000;
const MAX_MESSAGE_BYTES = 12_000;
const MAX_REQUEST_BYTES = 16_384;
const MAX_MATCH_LINE_CODE_POINTS = 240;
const MAX_MATCH_LINE_BYTES = 960;
const MAX_OFFICIAL_URL_BYTES = 2_048;
const MAX_MATCHES = 5;

function isUnsafeDisplayCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00 && codePoint <= 0x1f) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function replaceUnsafeDisplay(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && isUnsafeDisplayCodePoint(codePoint) ? " " : character;
  }).join("");
}
const UNICODE_WHITESPACE = /\p{White_Space}+/gu;
const encoder = new TextEncoder();

export type DisplayField = "title" | "route" | "forest" | "room" | "category" | "airline" | "operator" | "grade";

export interface AlertMessageMatch {
  /** Canonically sorted by the caller; this composer deliberately preserves that order. */
  readonly summary: string;
}

export interface ComposeAlertMessageInput {
  type: string;
  mode: string;
  title: string;
  matches: readonly AlertMessageMatch[];
  omittedMatchCount?: number;
  checkedAt: Date;
  officialUrl: string;
  /** Must be true only after the owning official-URL allowlist validates the URL. */
  officialUrlAllowed: boolean;
  chatId: string;
}

export type ComposeAlertMessageResult =
  | { ok: true; text: string; requestBytes: number; includedMatches: number }
  | { ok: false; code: "MESSAGE_INVALID" };

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function truncateCodePoints(value: string, maximum: number): string {
  const points = Array.from(value);
  return points.length <= maximum ? value : points.slice(0, maximum).join("");
}

function truncateUtf8(value: string, maximum: number): string {
  if (byteLength(value) <= maximum) {
    return value;
  }
  let output = "";
  for (const point of value) {
    if (byteLength(output + point) > maximum) {
      break;
    }
    output += point;
  }
  return output;
}
function replaceUnpairedSurrogates(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += " ";
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      output += " ";
    } else {
      output += value[index];
    }
  }
  return output;
}


export function sanitizeAlertDisplay(value: string, field: DisplayField): string {
  const maximum = field === "title" ? 120 : 60;
  const sanitized = replaceUnsafeDisplay(replaceUnpairedSurrogates(value))
    .normalize("NFC")
    .replace(UNICODE_WHITESPACE, " ")
    .trim();
  return truncateCodePoints(sanitized, maximum) || DASH;
}

function sanitizeMatchLine(value: string): string {
  const sanitized =
    replaceUnsafeDisplay(replaceUnpairedSurrogates(value))
      .normalize("NFC")
      .replace(UNICODE_WHITESPACE, " ")
      .trim() || DASH;
  return truncateUtf8(truncateCodePoints(sanitized, MAX_MATCH_LINE_CODE_POINTS), MAX_MATCH_LINE_BYTES);
}

function isSafeOfficialUrl(value: string, allowed: boolean): boolean {
  if (!allowed || byteLength(value) > MAX_OFFICIAL_URL_BYTES) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.toString() === value;
  } catch {
    return false;
  }
}

function requestBytes(chatId: string, text: string): number {
  return byteLength(JSON.stringify({ chat_id: chatId, text }));
}

/** Builds plain text only. It has no transport or reservation side effects. */
export function composeAlertMessage(input: ComposeAlertMessageInput): ComposeAlertMessageResult {
  if (!isSafeOfficialUrl(input.officialUrl, input.officialUrlAllowed) || !Number.isFinite(input.checkedAt.getTime())) {
    return { ok: false, code: "MESSAGE_INVALID" };
  }

  const title = sanitizeAlertDisplay(input.title, "title");
  const checkedAt = input.checkedAt.toISOString();
  const header = ["JariDash alert", `${sanitizeAlertDisplay(input.type, "route")} / ${sanitizeAlertDisplay(input.mode, "route")} — ${title}`];
  const footer = [`Checked: ${checkedAt}`, `Official: ${input.officialUrl}`];
  const fixed = [...header, ...footer].join("\n");
  if (Array.from(fixed).length > MAX_MESSAGE_CODE_POINTS || byteLength(fixed) > MAX_MESSAGE_BYTES || requestBytes(input.chatId, fixed) > MAX_REQUEST_BYTES) {
    return { ok: false, code: "MESSAGE_INVALID" };
  }

  const lines: string[] = [];
  for (const match of input.matches.slice(0, MAX_MATCHES)) {
    const line = `• ${sanitizeMatchLine(match.summary)}`;
    const candidate = [...header, ...lines, line, ...footer].join("\n");
    if (Array.from(candidate).length > MAX_MESSAGE_CODE_POINTS || byteLength(candidate) > MAX_MESSAGE_BYTES || requestBytes(input.chatId, candidate) > MAX_REQUEST_BYTES) {
      break;
    }
    lines.push(line);
  }

  const omitted = Math.max(0, input.matches.length - lines.length, input.omittedMatchCount ?? 0);
  if (omitted > 0) {
    const line = `… ${omitted} more match${omitted === 1 ? "" : "es"}`;
    const candidate = [...header, ...lines, line, ...footer].join("\n");
    if (Array.from(candidate).length <= MAX_MESSAGE_CODE_POINTS && byteLength(candidate) <= MAX_MESSAGE_BYTES && requestBytes(input.chatId, candidate) <= MAX_REQUEST_BYTES) {
      lines.push(line);
    }
  }

  const text = [...header, ...lines, ...footer].join("\n");
  const bytes = requestBytes(input.chatId, text);
  if (Array.from(text).length > MAX_MESSAGE_CODE_POINTS || byteLength(text) > MAX_MESSAGE_BYTES || bytes > MAX_REQUEST_BYTES) {
    return { ok: false, code: "MESSAGE_INVALID" };
  }
  return { ok: true, text, requestBytes: bytes, includedMatches: Math.min(lines.filter((line) => line.startsWith("• ")).length, MAX_MATCHES) };
}
