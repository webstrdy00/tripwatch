import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { lstat, rm } from "node:fs/promises";
import test from "node:test";
import { dirname, join, resolve } from "node:path";

import { runOwnedCommand, withOwnedTempDb } from "../../scripts/with-owned-temp-db";

const ROOT = resolve(process.cwd());
const SENTINEL_DB_PATH = join(ROOT, "dev.db");
const DEFAULT_DB_PATHS = [SENTINEL_DB_PATH, join(ROOT, "prisma", "dev.db")];

type DatabaseMetadata = {
  exists: boolean;
  size?: number;
  mtimeMs?: number;
};

async function snapshotDatabaseMetadata(): Promise<DatabaseMetadata[]> {
  return Promise.all(
    DEFAULT_DB_PATHS.map(async (path) => {
      try {
        const metadata = await lstat(path);
        return { exists: true, size: metadata.size, mtimeMs: metadata.mtimeMs };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
        throw error;
      }
    })
  );
}

function observingChildFactory(observations: NodeJS.ProcessEnv[]): typeof spawn {
  return ((_: string, __: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
    observations.push(options?.env ?? process.env);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
}

test("owned temp DB grants child mutation authority only after an owned URL is validated", async () => {
  const before = await snapshotDatabaseMetadata();
  const inherited = process.env.DATABASE_URL;
  const sentinel = `file:${SENTINEL_DB_PATH.replaceAll("\\", "/")}`;
  const childEnvironments: NodeJS.ProcessEnv[] = [];
  process.env.DATABASE_URL = sentinel;

  try {
    assert.equal(
      await runOwnedCommand(["--", "test-command"], {
        migrate: () => undefined,
        assertDatabase: async () => undefined,
        spawnChild: observingChildFactory(childEnvironments)
      }),
      0
    );
  } finally {
    if (inherited === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = inherited;
  }

  assert.equal(childEnvironments.length, 1);
  assert.notEqual(childEnvironments[0].DATABASE_URL, sentinel);
  assert.equal(childEnvironments[0].TRIPWATCH_SMOKE_ALLOW_DB_MUTATION, "true");
  assert.deepEqual(await snapshotDatabaseMetadata(), before);
});

test("malformed, ownership, forced-URL, and migration failures cannot create a child", async () => {
  const before = await snapshotDatabaseMetadata();
  const childEnvironments: NodeJS.ProcessEnv[] = [];
  const spawnChild = observingChildFactory(childEnvironments);
  let ownerChecks = 0;

  await assert.rejects(() => runOwnedCommand([], { spawnChild }), /OWNED_TEMP_DB_COMMAND_REQUIRED/);
  await assert.rejects(
    () =>
      runOwnedCommand(["--", "test-command"], {
        assertOwner: async () => {
          ownerChecks += 1;
          if (ownerChecks === 1) throw new Error("OWNED_TEMP_DB_OWNER_REJECTED");
        },
        spawnChild
      }),
    /OWNED_TEMP_DB_OWNER_REJECTED/
  );
  await assert.rejects(
    () =>
      runOwnedCommand(["--", "test-command"], {
        createDatabaseUrl: () => `file:${SENTINEL_DB_PATH.replaceAll("\\", "/")}`,
        spawnChild
      }),
    /OWNED_TEMP_DB_URL_OUTSIDE_OWNED_DIRECTORY/
  );
  await assert.rejects(
    () =>
      runOwnedCommand(["--", "test-command"], {
        migrate: () => {
          throw new Error("OWNED_TEMP_DB_MIGRATION_FAILED");
        },
        spawnChild
      }),
    /OWNED_TEMP_DB_MIGRATION_FAILED/
  );

  assert.equal(childEnvironments.length, 0);
  assert.deepEqual(await snapshotDatabaseMetadata(), before);
});
test("an unreleased cleanup lease preserves the owned DB directory", async () => {
  let ownedDirectory = "";

  await assert.rejects(
    withOwnedTempDb(
      async (owned) => {
        ownedDirectory = dirname(owned.databaseUrl.slice("file:".length));
        await owned.acquireCleanupLease();
        throw new Error("managed cleanup failed");
      },
      {
        migrate: () => undefined,
        assertDatabase: async () => undefined
      }
    ),
    /OWNED_TEMP_DB_CLEANUP_UNPROVEN/
  );

  assert.ok(ownedDirectory);
  assert.ok((await lstat(ownedDirectory)).isDirectory());
  await rm(ownedDirectory, { recursive: true, force: false });
});
