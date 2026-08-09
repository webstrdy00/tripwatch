import { spawn, spawnSync } from "node:child_process";
import { lstat, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

export type OwnedTempDb = {
  databaseUrl: string;
  childEnv: NodeJS.ProcessEnv;
  acquireCleanupLease: () => Promise<() => Promise<void>>;
};

type OwnerEvidence = {
  directory: string;
  marker: string;
  nonce: string;
  device?: number;
  inode?: number;
  mode?: number;
};

export type OwnedTempDbSeams = {
  assertOwner?: () => Promise<void>;
  migrate?: (databaseUrl: string) => void;
  assertDatabase?: (databaseUrl: string) => Promise<void>;
  createDatabaseUrl?: (directory: string) => string;
};

export type OwnedCommandSeams = OwnedTempDbSeams & {
  spawnChild?: typeof spawn;
};

const ROOT = resolve(process.cwd());
const TEMP_ROOT = resolve(tmpdir());
const MARKER_NAME = ".tripwatch-smoke-owner";
const CLEANUP_LEASE_NAME = ".tripwatch-cleanup-lease";

function isInside(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("../") && !path.startsWith("..\\");
}

async function assertOwner(evidence: OwnerEvidence): Promise<void> {
  const directory = await realpath(evidence.directory);
  const tempRoot = await realpath(TEMP_ROOT);
  if (!isInside(tempRoot, directory)) throw new Error("OWNED_TEMP_DB_OUTSIDE_TEMP_ROOT");
  const marker = join(directory, MARKER_NAME);
  if (marker !== evidence.marker) throw new Error("OWNED_TEMP_DB_MARKER_PATH_CHANGED");
  const stat = await lstat(marker);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("OWNED_TEMP_DB_MARKER_INVALID");
  if (
    evidence.device === undefined ||
    evidence.inode === undefined ||
    evidence.mode === undefined ||
    stat.dev !== evidence.device ||
    stat.ino !== evidence.inode ||
    stat.mode !== evidence.mode
  ) {
    throw new Error("OWNED_TEMP_DB_MARKER_IDENTITY_CHANGED");
  }
  if (await readFile(marker, "utf8") !== `${evidence.nonce}\n`) throw new Error("OWNED_TEMP_DB_MARKER_MISMATCH");
}
function assertOwnedDatabaseUrl(directory: string, databaseUrl: string): void {
  if (!databaseUrl.startsWith("file:") || !isInside(directory, resolve(databaseUrl.slice("file:".length)))) {
    throw new Error("OWNED_TEMP_DB_URL_OUTSIDE_OWNED_DIRECTORY");
  }
}
async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}


function migrate(databaseUrl: string): void {
  const prismaCli = join(ROOT, "node_modules", "prisma", "build", "index.js");
  const migrationEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
  delete migrationEnv.TRIPWATCH_SMOKE_ALLOW_DB_MUTATION;
  const outcome = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: ROOT,
    env: migrationEnv,
    shell: false,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true
  });
  if (outcome.error || outcome.status !== 0) throw new Error("OWNED_TEMP_DB_MIGRATION_FAILED");
}

async function assertDatabase(databaseUrl: string): Promise<void> {
  const sqlite = await import("better-sqlite3");
  const filename = databaseUrl.slice("file:".length);
  const database = new sqlite.default(filename, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").pluck().get();
    if (integrity !== "ok") throw new Error("OWNED_TEMP_DB_INTEGRITY_FAILED");
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[];
    for (const table of ["WatchItem", "QueryResult", "AlertRule", "_prisma_migrations"]) {
      if (!tables.includes(table)) throw new Error("OWNED_TEMP_DB_SCHEMA_FAILED");
    }
    const migrationCount = database.prepare("SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL").pluck().get();
    if (migrationCount !== 2) throw new Error("OWNED_TEMP_DB_MIGRATION_COUNT_FAILED");
  } finally {
    database.close();
  }
}

export async function withOwnedTempDb<T>(
  callback: (owned: OwnedTempDb) => Promise<T>,
  seams: OwnedTempDbSeams = {}
): Promise<T> {
  const directory = await mkdtemp(join(TEMP_ROOT, "tripwatch-smoke-"));
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const evidence: OwnerEvidence = { directory, marker: join(directory, MARKER_NAME), nonce };
  const cleanupLease = join(directory, CLEANUP_LEASE_NAME);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    await writeFile(evidence.marker, `${nonce}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const markerStat = await lstat(evidence.marker);
    evidence.device = markerStat.dev;
    evidence.inode = markerStat.ino;
    evidence.mode = markerStat.mode;
    if (seams.assertOwner) await seams.assertOwner();
    else await assertOwner(evidence);
    const canonicalDirectory = await realpath(directory);
    const databaseUrl = seams.createDatabaseUrl?.(canonicalDirectory) ?? `file:${join(canonicalDirectory, "smoke.db").replaceAll("\\", "/")}`;
    assertOwnedDatabaseUrl(canonicalDirectory, databaseUrl);
    if (seams.migrate) seams.migrate(databaseUrl);
    else migrate(databaseUrl);
    if (seams.assertOwner) await seams.assertOwner();
    else await assertOwner(evidence);
    if (seams.assertDatabase) await seams.assertDatabase(databaseUrl);
    else await assertDatabase(databaseUrl);
    const acquireCleanupLease = async (): Promise<() => Promise<void>> => {
      await writeFile(cleanupLease, `${nonce}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      let released = false;
      return async () => {
        if (released) throw new Error("OWNED_TEMP_DB_CLEANUP_LEASE_ALREADY_RELEASED");
        if (await readFile(cleanupLease, "utf8") !== `${nonce}\n`) {
          throw new Error("OWNED_TEMP_DB_CLEANUP_LEASE_MISMATCH");
        }
        await rm(cleanupLease, { force: false });
        released = true;
      };
    };
    const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, TRIPWATCH_SMOKE_ALLOW_DB_MUTATION: "true" };
    delete childEnv.TELEGRAM_BOT_TOKEN;
    delete childEnv.TELEGRAM_CHAT_ID;
    outcome = { ok: true, value: await callback({ databaseUrl, childEnv, acquireCleanupLease }) };
  } catch (error) {
    outcome = { ok: false, error };
  }

  if (await pathExists(cleanupLease)) throw new Error("OWNED_TEMP_DB_CLEANUP_UNPROVEN");
  if (seams.assertOwner) await seams.assertOwner();
  else await assertOwner(evidence);
  await rm(directory, { recursive: true, force: false });

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

export function resolveShellFreeCommand(command: string, args: string[]): { executable: string; args: string[] } {
  if (process.platform === "win32" && (command === "npm" || command === "npx")) {
    const cli = join(dirname(process.execPath), "node_modules", "npm", "bin", `${command}-cli.js`);
    return { executable: process.execPath, args: [cli, ...args] };
  }
  return { executable: command, args };
}

export async function runOwnedCommand(argv: string[], seams: OwnedCommandSeams = {}): Promise<number> {
  if (argv[0] !== "--" || argv.length < 2 || !argv[1]) {
    throw new Error("OWNED_TEMP_DB_COMMAND_REQUIRED");
  }

  const [command, ...args] = argv.slice(1);
  const invocation = resolveShellFreeCommand(command, args);
  return withOwnedTempDb(
    ({ childEnv }) =>
      new Promise<number>((resolveChild, rejectChild) => {
        const child = (seams.spawnChild ?? spawn)(invocation.executable, invocation.args, {
          cwd: ROOT,
          env: childEnv,
          shell: false,
          stdio: "inherit",
          windowsHide: true
        });
        child.once("error", () => rejectChild(new Error("OWNED_TEMP_DB_CHILD_START_FAILED")));
        child.once("close", (code, signal) => resolveChild(signal === null && code !== null ? code : 1));
      }),
    seams
  );
}

if (process.argv[1]?.endsWith("with-owned-temp-db.ts")) {
  void runOwnedCommand(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.exitCode = 1;
      console.error("OWNED_TEMP_DB_WRAPPER_FAILED");
    });
}
