import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
type SqliteStatement = {
  get<Result>(): Result;
  all<Result>(): Result[];
  run(...parameters: unknown[]): unknown;
};

type SqliteDatabase = {
  close(): void;
  pragma(statement: string, options?: { simple: boolean }): unknown;
  prepare(statement: string): SqliteStatement;
  transaction(callback: () => void): () => void;
};

type SqliteDatabaseConstructor = new (filename: string) => SqliteDatabase;

async function loadDatabaseConstructor(): Promise<SqliteDatabaseConstructor> {
  const module: unknown = await import(pathToFileURL(join(ROOT, "node_modules", "better-sqlite3", "lib", "index.js")).href);

  if (
    !module ||
    typeof module !== "object" ||
    !("default" in module) ||
    typeof module.default !== "function"
  ) {
    throw new Error("better-sqlite3 default export is unavailable");
  }

  return module.default as SqliteDatabaseConstructor;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PRISMA_CLI = join(ROOT, "node_modules", "prisma", "build", "index.js");
const SCHEMA = join(ROOT, "prisma", "schema.prisma");
const INIT_MIGRATION = join(ROOT, "prisma", "migrations", "20260530035317_init", "migration.sql");
const ALERT_MIGRATION = join(ROOT, "prisma", "migrations", "20260718000000_add_alert_rule", "migration.sql");
const MIGRATION_LOCK = join(ROOT, "prisma", "migrations", "migration_lock.toml");
const OWNER_MARKER = ".jaridash-alert-rule-migration-test-owner";

const alertRuleColumns = [
  ["id", "TEXT", 1, null, 1],
  ["watchItemId", "TEXT", 1, null, 0],
  ["channel", "TEXT", 1, "'telegram'", 0],
  ["conditionJson", "TEXT", 1, null, 0],
  ["enabled", "BOOLEAN", 1, "false", 0],
  ["outboundOptIn", "BOOLEAN", 1, "false", 0],
  ["configVersion", "INTEGER", 1, "1", 0],
  ["createdAt", "DATETIME", 1, "CURRENT_TIMESTAMP", 0],
  ["updatedAt", "DATETIME", 1, null, 0],
  ["lastProviderRunAt", "DATETIME", 0, null, 0],
  ["latestOutcome", "TEXT", 1, "'never'", 0],
  ["latestOutcomeAt", "DATETIME", 0, null, 0],
  ["latestOutcomeCode", "TEXT", 0, null, 0],
  ["baselineState", "TEXT", 1, "'never'", 0],
  ["baselineFingerprint", "TEXT", 0, null, 0],
  ["baselineTransitionSeq", "INTEGER", 1, "0", 0],
  ["baselineAt", "DATETIME", 0, null, 0],
  ["deliveryState", "TEXT", 1, "'never'", 0],
  ["attemptId", "TEXT", 0, null, 0],
  ["attemptRunId", "TEXT", 0, null, 0],
  ["attemptFingerprint", "TEXT", 0, null, 0],
  ["attemptTransitionSeq", "INTEGER", 0, null, 0],
  ["attemptResultId", "TEXT", 0, null, 0],
  ["attemptResultType", "TEXT", 0, null, 0],
  ["lastAttemptAt", "DATETIME", 0, null, 0],
  ["terminalAt", "DATETIME", 0, null, 0],
  ["deliveryCode", "TEXT", 0, null, 0],
] as const;

function createOwnedTemp(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(directory, OWNER_MARKER), "owned by migration.integration.test\n", "utf8");
  return directory;
}

function removeOwnedTemp(directory: string): void {
  const resolvedDirectory = resolve(directory);
  const tempRoot = resolve(tmpdir());
  assert.ok(
    resolvedDirectory.startsWith(`${tempRoot}${sep}`),
    "test cleanup may only remove an OS-temp child",
  );
  assert.equal(
    readFileSync(join(resolvedDirectory, OWNER_MARKER), "utf8"),
    "owned by migration.integration.test\n",
    "test cleanup requires its ownership marker",
  );
  rmSync(resolvedDirectory, { recursive: true, force: false });
}

function databaseUrl(databasePath: string): string {
  return `file:${databasePath.replaceAll("\\", "/")}`;
}

function deploy(schemaPath: string, url: string): void {
  execFileSync(
    process.execPath,
    [PRISMA_CLI, "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    },
  );
}

function migrationCount(database: SqliteDatabase): number {
  return database.prepare('SELECT COUNT(*) AS count FROM "_prisma_migrations"').get<{ count: number }>().count;
}

function logicalRowsHash(database: SqliteDatabase): string {
  const watchItems = database
    .prepare('SELECT "id", "type", "title", "paramsJson", "memo", "enabled", "createdAt", "updatedAt" FROM "WatchItem" ORDER BY "id"')
    .all();
  const queryResults = database
    .prepare('SELECT "id", "watchItemId", "type", "status", "source", "checkedAt", "summary", "officialUrl", "resultJson", "errorCode", "errorText", "createdAt" FROM "QueryResult" ORDER BY "id"')
    .all();
  return createHash("sha256").update(JSON.stringify({ watchItems, queryResults })).digest("hex");
}

function assertAlertRuleStructure(database: SqliteDatabase): void {
  database.pragma("foreign_keys = ON");
  assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
  assert.deepEqual(
    database.prepare('PRAGMA table_info("AlertRule")').all<Record<string, unknown>>().map((column) => [column.name, column.type, column.notnull, column.dflt_value, column.pk]),
    alertRuleColumns,
  );
  assert.deepEqual(database.prepare('PRAGMA foreign_key_list("AlertRule")').all(), [
    { id: 0, seq: 0, table: "WatchItem", from: "watchItemId", to: "id", on_update: "CASCADE", on_delete: "RESTRICT", match: "NONE" },
  ]);

  const indexes = database.prepare('PRAGMA index_list("AlertRule")').all<Record<string, unknown>>().map((index) => index.name).sort();
  assert.deepEqual(indexes, [
    "AlertRule_enabled_lastProviderRunAt_createdAt_id_idx",
    "AlertRule_watchItemId_key",
    "sqlite_autoindex_AlertRule_1",
  ]);
  assert.deepEqual(
    database.prepare('PRAGMA index_info("AlertRule_enabled_lastProviderRunAt_createdAt_id_idx")').all<Record<string, unknown>>().map((index) => index.name),
    ["enabled", "lastProviderRunAt", "createdAt", "id"],
  );
  assert.deepEqual(
    database.prepare('PRAGMA index_info("AlertRule_watchItemId_key")').all<Record<string, unknown>>().map((index) => index.name),
    ["watchItemId"],
  );
  assert.deepEqual(database.pragma("integrity_check"), [{ integrity_check: "ok" }]);
  assert.deepEqual(database.pragma("foreign_key_check"), []);

  assert.throws(
    () => database.prepare('INSERT INTO "AlertRule" ("id", "watchItemId", "conditionJson", "updatedAt") VALUES (?, ?, ?, ?)').run("invalid-rule", "missing-watch-item", "{}", "2026-07-18 00:00:00"),
    /FOREIGN KEY constraint failed/,
  );
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM "AlertRule"').get<{ count: number }>().count, 0);
}

function seedPreAlertDatabase(database: SqliteDatabase): void {
  const insertWatchItem = database.prepare(
    'INSERT INTO "WatchItem" ("id", "type", "title", "paramsJson", "memo", "enabled", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertQueryResult = database.prepare(
    'INSERT INTO "QueryResult" ("id", "watchItemId", "type", "status", "source", "checkedAt", "summary", "officialUrl", "resultJson", "errorCode", "errorText", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const seed = database.transaction(() => {
    insertWatchItem.run("watch-flight", "flight", "Fixed flight", '{"from":"ICN","to":"CJU"}', null, 1, "2026-07-01 00:00:00", "2026-07-01 00:00:00");
    insertWatchItem.run("watch-ticket", "ticket", "Fixed ticket", '{"platform":"interpark"}', "keep nulls", 0, "2026-07-02 00:00:00", "2026-07-02 00:00:00");
    insertQueryResult.run("result-success", "watch-flight", "flight", "success", "flight-ticket-search", "2026-07-03 00:00:00", "ok", "https://example.test/flight", '{"currency":"KRW","flights":[]}', null, null, "2026-07-03 00:00:00");
    insertQueryResult.run("result-partial", "watch-flight", "flight", "partial", "flight-ticket-search", "2026-07-04 00:00:00", null, null, '{"flights":null}', "PARTIAL", "fixed partial", "2026-07-04 00:00:00");
    insertQueryResult.run("result-failed", "watch-ticket", "ticket", "failed", null, "2026-07-05 00:00:00", null, null, '{"seats":null}', "UPSTREAM", "fixed failure", "2026-07-05 00:00:00");
  });
  seed();
}

test("AlertRule migration is additive for fresh and seeded upgrade databases", { concurrency: false }, async () => {
  const workspace = createOwnedTemp("jaridash-alert-rule-migration-");
  const Database = await loadDatabaseConstructor();
  const sentinelDirectory = createOwnedTemp("jaridash-alert-rule-sentinel-");
  const sentinel = join(sentinelDirectory, "outside-sentinel.txt");
  writeFileSync(sentinel, "must survive workspace cleanup\n", "utf8");

  try {
    const freshPath = join(workspace, "fresh.db");
    deploy(SCHEMA, databaseUrl(freshPath));
    const fresh = new Database(freshPath);
    let freshHash: string;
    try {
      assertAlertRuleStructure(fresh);
      assert.equal(migrationCount(fresh), 2);
      freshHash = logicalRowsHash(fresh);
    } finally {
      fresh.close();
    }
    deploy(SCHEMA, databaseUrl(freshPath));
    const freshAfterSecondDeploy = new Database(freshPath);
    try {
      assert.equal(migrationCount(freshAfterSecondDeploy), 2);
      assert.equal(logicalRowsHash(freshAfterSecondDeploy), freshHash!);
      assertAlertRuleStructure(freshAfterSecondDeploy);
    } finally {
      freshAfterSecondDeploy.close();
    }

    const upgradePrisma = join(workspace, "upgrade-prisma");
    const upgradeMigrations = join(upgradePrisma, "migrations");
    const upgradeInitDirectory = join(upgradeMigrations, "20260530035317_init");
    const upgradeAlertDirectory = join(upgradeMigrations, "20260718000000_add_alert_rule");
    mkdirSync(upgradeInitDirectory, { recursive: true });
    copyFileSync(SCHEMA, join(upgradePrisma, "schema.prisma"));
    copyFileSync(MIGRATION_LOCK, join(upgradeMigrations, "migration_lock.toml"));
    copyFileSync(INIT_MIGRATION, join(upgradeInitDirectory, "migration.sql"));

    const upgradePath = join(workspace, "upgrade.db");
    const upgradeSchema = join(upgradePrisma, "schema.prisma");
    deploy(upgradeSchema, databaseUrl(upgradePath));
    const preUpgrade = new Database(upgradePath);
    let beforeUpgradeHash: string;
    try {
      seedPreAlertDatabase(preUpgrade);
      beforeUpgradeHash = logicalRowsHash(preUpgrade);
      assert.equal(migrationCount(preUpgrade), 1);
    } finally {
      preUpgrade.close();
    }

    mkdirSync(upgradeAlertDirectory, { recursive: true });
    copyFileSync(ALERT_MIGRATION, join(upgradeAlertDirectory, "migration.sql"));
    deploy(upgradeSchema, databaseUrl(upgradePath));
    const upgrade = new Database(upgradePath);
    let upgradeHash: string;
    try {
      assert.equal(migrationCount(upgrade), 2);
      assert.equal(logicalRowsHash(upgrade), beforeUpgradeHash!);
      assert.equal((upgrade.prepare('SELECT COUNT(*) AS count FROM "WatchItem"').get() as { count: number }).count, 2);
      assert.equal((upgrade.prepare('SELECT COUNT(*) AS count FROM "QueryResult"').get() as { count: number }).count, 3);
      assertAlertRuleStructure(upgrade);
      upgradeHash = logicalRowsHash(upgrade);
    } finally {
      upgrade.close();
    }
    deploy(upgradeSchema, databaseUrl(upgradePath));
    const upgradeAfterSecondDeploy = new Database(upgradePath);
    try {
      assert.equal(migrationCount(upgradeAfterSecondDeploy), 2);
      assert.equal(logicalRowsHash(upgradeAfterSecondDeploy), upgradeHash!);
      assertAlertRuleStructure(upgradeAfterSecondDeploy);
    } finally {
      upgradeAfterSecondDeploy.close();
    }
  } finally {
    removeOwnedTemp(workspace);
    assert.equal(readFileSync(sentinel, "utf8"), "must survive workspace cleanup\n");
    assert.ok(existsSync(sentinel));
    removeOwnedTemp(sentinelDirectory);
  }
});
