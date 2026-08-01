import { openSync, readSync, closeSync } from "node:fs";

export const ALERT_DEFAULT_LIMIT = 5;
export const ALERT_MAX_LIMIT = 10;
export const TELEGRAM_ENV_NAMES = Object.freeze(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const);

export interface AlertCredentials {
  readonly botToken: string;
  readonly chatId: string;
}

export interface AlertBootstrap {
  readonly limit: number;
  readonly credentials: AlertCredentials;
}

export type AlertPreflightCode =
  | "INVALID_ARGUMENTS"
  | "WSL_REQUIRED"
  | "MOCK_HELPERS_FORBIDDEN"
  | "INVALID_TELEGRAM_CREDENTIALS"
  | "TELEGRAM_ENV_NOT_REMOVED";

export class AlertPreflightError extends Error {
  readonly code: AlertPreflightCode;

  constructor(code: AlertPreflightCode) {
    super(code);
    this.code = code;
  }
}

export interface WslEvidenceRuntime {
  readonly platform: string;
  readonly getuid?: () => number;
  readonly readProc?: (path: string) => string;
}

function readBoundedProc(path: string): string {
  const maximumBytes = 4_096;
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maximumBytes + 1);
    const read = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (read > maximumBytes) {
      throw new AlertPreflightError("WSL_REQUIRED");
    }
    return buffer.subarray(0, read).toString("utf8");
  } catch (error) {
    if (error instanceof AlertPreflightError) {
      throw error;
    }
    throw new AlertPreflightError("WSL_REQUIRED");
  } finally {
    closeSync(descriptor);
  }
}

/** Verifies kernel evidence rather than trusting mutable WSL environment hints. */
export function assertWslEvidence(runtime: WslEvidenceRuntime = {
  platform: process.platform,
  getuid: process.getuid,
  readProc: readBoundedProc
}): number {
  if (runtime.platform !== "linux" || typeof runtime.getuid !== "function") {
    throw new AlertPreflightError("WSL_REQUIRED");
  }
  const uid = runtime.getuid();
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw new AlertPreflightError("WSL_REQUIRED");
  }

  try {
    const readProc = runtime.readProc ?? readBoundedProc;
    const release = readProc("/proc/sys/kernel/osrelease");
    const version = readProc("/proc/version");
    if (Buffer.byteLength(release, "utf8") > 4_096 || Buffer.byteLength(version, "utf8") > 4_096 || !/microsoft/i.test(release) || !/microsoft/i.test(version)) {
      throw new AlertPreflightError("WSL_REQUIRED");
    }
  } catch (error) {
    if (error instanceof AlertPreflightError) {
      throw error;
    }
    throw new AlertPreflightError("WSL_REQUIRED");
  }
  return uid;
}

/** Parses only the documented argv tokens; npm's wrapper is intentionally not accepted here. */
export function parseAlertArguments(argv: readonly string[]): number {
  if (argv.length < 1 || argv[0] !== "--send-telegram") {
    throw new AlertPreflightError("INVALID_ARGUMENTS");
  }
  if (argv.length === 1) {
    return ALERT_DEFAULT_LIMIT;
  }
  if (argv.length !== 3 || argv[1] !== "--limit" || !/^(?:[1-9]|10)$/.test(argv[2])) {
    throw new AlertPreflightError("INVALID_ARGUMENTS");
  }
  return Number(argv[2]);
}

function isAscii(value: string): boolean {
  return Array.from(value).every((character) => character.charCodeAt(0) <= 0x7f);
}

function isToken(value: string): boolean {
  const length = Buffer.byteLength(value, "utf8");
  return isAscii(value) && length >= 36 && length <= 128 && /^[1-9][0-9]{5,15}:[A-Za-z0-9_-]{30,100}$/.test(value);
}

function isChatId(value: string): boolean {
  return isAscii(value) && /^-?[1-9][0-9]{0,19}$/.test(value);
}

/** Copies credentials once, without coercion or trimming, then makes the snapshot immutable. */
export function readTelegramCredentials(env: NodeJS.ProcessEnv = process.env): AlertCredentials {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (typeof botToken !== "string" || typeof chatId !== "string" || !isToken(botToken) || !isChatId(chatId)) {
    throw new AlertPreflightError("INVALID_TELEGRAM_CREDENTIALS");
  }
  return Object.freeze({ botToken, chatId });
}

/** Removes credential names, then proves a dynamic import cannot observe them through process.env. */
export function removeTelegramCredentialsFromAmbientEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of TELEGRAM_ENV_NAMES) {
    delete env[name];
  }
  if (TELEGRAM_ENV_NAMES.some((name) => Object.prototype.hasOwnProperty.call(env, name) || env[name] !== undefined)) {
    throw new AlertPreflightError("TELEGRAM_ENV_NOT_REMOVED");
  }
}

/** Pure bootstrap ordering for the CLI: argv, WSL, mock denial, immutable credentials, env removal. */
export function preflightAlertBootstrap(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, runtime?: WslEvidenceRuntime): AlertBootstrap {
  const limit = parseAlertArguments(argv);
  assertWslEvidence(runtime);
  if (env.TRIPWATCH_USE_MOCK_HELPERS === "true") {
    throw new AlertPreflightError("MOCK_HELPERS_FORBIDDEN");
  }
  const credentials = readTelegramCredentials(env);
  removeTelegramCredentialsFromAmbientEnv(env);
  return Object.freeze({ limit, credentials });
}
