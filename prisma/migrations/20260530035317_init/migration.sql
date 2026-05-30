-- CreateTable
CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "memo" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QueryResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchItemId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "officialUrl" TEXT,
    "resultJson" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorText" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QueryResult_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WatchItem_type_idx" ON "WatchItem"("type");

-- CreateIndex
CREATE INDEX "WatchItem_enabled_idx" ON "WatchItem"("enabled");

-- CreateIndex
CREATE INDEX "QueryResult_watchItemId_idx" ON "QueryResult"("watchItemId");

-- CreateIndex
CREATE INDEX "QueryResult_type_idx" ON "QueryResult"("type");

-- CreateIndex
CREATE INDEX "QueryResult_status_idx" ON "QueryResult"("status");

-- CreateIndex
CREATE INDEX "QueryResult_checkedAt_idx" ON "QueryResult"("checkedAt");
