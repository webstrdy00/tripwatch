import { closeSync, constants, fchmodSync, lstatSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";

const LOCK_DIRECTORY = "/tmp";
const OWNER_MAX_BYTES = 255;
const LOCK_MODE = 0o600;

export interface AlertWorkerLock {
  readonly path: string;
  release(): void;
}

export class AlertWorkerLockError extends Error {
  readonly code = "ALERT_WORKER_LOCKED";

  constructor() {
    super("ALERT_WORKER_LOCKED");
  }
}

interface OwnerRecord {
  readonly pid: number;
  readonly startedAt: string;
  readonly nonce: string;
}

interface LockIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly mode: number;
  readonly nonce: string;
}

function failLock(): never {
  throw new AlertWorkerLockError();
}

function requireStickyTmp(): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(LOCK_DIRECTORY);
  } catch {
    failLock();
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o1777) !== 0o1777) {
    failLock();
  }
}

function lockPathFor(uid: number): string {
  return `${LOCK_DIRECTORY}/jaridash-alerts-${uid}.lock`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOwner(value: string): OwnerRecord | null {
  if (Buffer.byteLength(value, "utf8") > OWNER_MAX_BYTES) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }
    const record = parsed;
    const { nonce, pid, startedAt } = record;
    if (Object.keys(record).length !== 3 || typeof pid !== "number" || !Number.isSafeInteger(pid) || typeof startedAt !== "string" || typeof nonce !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(startedAt) || !/^[0-9a-f]{32}$/.test(nonce)) {
      return null;
    }
    return Object.freeze({ pid, startedAt, nonce });
  } catch {
    return null;
  }
}

function currentIdentity(path: string, uid: number): LockIdentity | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o777) !== LOCK_MODE) {
      return null;
    }
    const owner = parseOwner(readFileSync(path, { encoding: "utf8" }));
    if (owner === null) {
      return null;
    }
    return Object.freeze({ dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o777, nonce: owner.nonce });
  } catch {
    return null;
  }
}

/** Acquires a no-follow owner-token lock. An existing or malformed path always blocks; it is never broken automatically. */
export function acquireAlertWorkerLock(uid: number, now: Date = new Date()): AlertWorkerLock {
  if (!Number.isSafeInteger(uid) || uid < 0) {
    failLock();
  }
  requireStickyTmp();
  const path = lockPathFor(uid);
  const owner: OwnerRecord = Object.freeze({ pid: process.pid, startedAt: now.toISOString(), nonce: randomBytes(16).toString("hex") });
  const serialized = JSON.stringify(owner);
  if (Buffer.byteLength(serialized, "utf8") > OWNER_MAX_BYTES) {
    failLock();
  }

  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, LOCK_MODE);
  } catch {
    failLock();
  }
  try {
    fchmodSync(descriptor, LOCK_MODE);
    if (writeSync(descriptor, serialized, 0, "utf8") !== Buffer.byteLength(serialized, "utf8")) {
      failLock();
    }
  } catch {
    try {
      closeSync(descriptor);
    } finally {
      // Do not unlink after a partial write: a competing process must treat it as occupied.
    }
    failLock();
  }
  closeSync(descriptor);

  const identity = currentIdentity(path, uid);
  if (identity === null || identity.nonce !== owner.nonce) {
    failLock();
  }

  let released = false;
  return Object.freeze({
    path,
    release(): void {
      if (released) {
        return;
      }
      released = true;
      const current = currentIdentity(path, uid);
      if (current === null || current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== identity.uid || current.mode !== identity.mode || current.nonce !== identity.nonce) {
        throw new AlertWorkerLockError();
      }
      try {
        unlinkSync(path);
      } catch {
        throw new AlertWorkerLockError();
      }
    }
  });
}

export const ALERT_WORKER_LOCK_PATH = lockPathFor;
