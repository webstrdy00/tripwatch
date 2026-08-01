-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchItemId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "conditionJson" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundOptIn" BOOLEAN NOT NULL DEFAULT false,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastProviderRunAt" DATETIME,
    "latestOutcome" TEXT NOT NULL DEFAULT 'never',
    "latestOutcomeAt" DATETIME,
    "latestOutcomeCode" TEXT,
    "baselineState" TEXT NOT NULL DEFAULT 'never',
    "baselineFingerprint" TEXT,
    "baselineTransitionSeq" INTEGER NOT NULL DEFAULT 0,
    "baselineAt" DATETIME,
    "deliveryState" TEXT NOT NULL DEFAULT 'never',
    "attemptId" TEXT,
    "attemptRunId" TEXT,
    "attemptFingerprint" TEXT,
    "attemptTransitionSeq" INTEGER,
    "attemptResultId" TEXT,
    "attemptResultType" TEXT,
    "lastAttemptAt" DATETIME,
    "terminalAt" DATETIME,
    "deliveryCode" TEXT,
    CONSTRAINT "AlertRule_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_watchItemId_key" ON "AlertRule"("watchItemId");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_lastProviderRunAt_createdAt_id_idx" ON "AlertRule"("enabled", "lastProviderRunAt", "createdAt", "id");
