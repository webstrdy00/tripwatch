import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { successResponse } from "../../lib/api-response";
import { db } from "../../lib/db";
import { TripWatchError } from "../../lib/errors";
import {
  createQueryResultFromResponse,
  preflightWatchItemAssociation
} from "../../lib/result-store";

beforeEach(async () => {
  await db.queryResult.deleteMany();
  await db.alertRule.deleteMany();
  await db.watchItem.deleteMany();
});

function response() {
  return successResponse({
    source: "mock-provider",
    summary: "ok",
    data: { value: true }
  });
}

async function createWatchItem(type: string) {
  return db.watchItem.create({
    data: {
      type,
      title: `${type} item`,
      paramsJson: "{}",
      enabled: true
    }
  });
}
async function runAssociatedProvider({
  watchItemId,
  type,
  provider
}: {
  watchItemId: string | null | undefined;
  type: string;
  provider: () => Promise<ReturnType<typeof response>>;
}) {
  const association = await preflightWatchItemAssociation(watchItemId, type);
  const providerResponse = await provider();
  return createQueryResultFromResponse({ type, response: providerResponse, association });
}


test("same-type association invokes the provider after preflight and commits atomically", async () => {
  const item = await createWatchItem("flight");
  const providerAttempts: string[] = [];

  const stored = await runAssociatedProvider({
    watchItemId: item.id,
    type: "flight",
    provider: async () => {
      providerAttempts.push("flight");
      return response();
    }
  });

  assert.equal(providerAttempts.length, 1);
  assert.equal(stored.watchItemId, item.id);
  assert.equal(await db.queryResult.count(), 1);
});

test("missing and mismatched parents reject before the provider and persist no row", async () => {
  const bus = await createWatchItem("express_bus");
  const providerAttempts: string[] = [];

  await assert.rejects(
    runAssociatedProvider({
      watchItemId: "missing-watch-item",
      type: "flight",
      provider: async () => {
        providerAttempts.push("missing");
        return response();
      }
    }),
    (error: unknown) => error instanceof TripWatchError && error.code === "WATCH_ITEM_NOT_FOUND"
  );
  await assert.rejects(
    runAssociatedProvider({
      watchItemId: bus.id,
      type: "flight",
      provider: async () => {
        providerAttempts.push("mismatch");
        return response();
      }
    }),
    (error: unknown) => error instanceof TripWatchError && error.code === "WATCH_ITEM_TYPE_MISMATCH"
  );

  assert.equal(providerAttempts.length, 0);
  assert.equal(await db.queryResult.count(), 0);
});

test("post-preflight type, deletion, and update races invoke the provider once without a row or retry", async () => {
  const typeChanged = await createWatchItem("flight");
  const deleted = await createWatchItem("ticket");
  const updated = await createWatchItem("express_bus");
  const providerAttempts: string[] = [];

  await assert.rejects(
    runAssociatedProvider({
      watchItemId: typeChanged.id,
      type: "flight",
      provider: async () => {
        providerAttempts.push("type");
        await db.watchItem.update({ where: { id: typeChanged.id }, data: { type: "ticket" } });
        return response();
      }
    }),
    (error: unknown) => error instanceof TripWatchError && error.code === "WATCH_ITEM_TYPE_MISMATCH"
  );
  await assert.rejects(
    runAssociatedProvider({
      watchItemId: deleted.id,
      type: "ticket",
      provider: async () => {
        providerAttempts.push("delete");
        await db.watchItem.delete({ where: { id: deleted.id } });
        return response();
      }
    }),
    (error: unknown) => error instanceof TripWatchError && error.code === "WATCH_ITEM_NOT_FOUND"
  );
  await assert.rejects(
    runAssociatedProvider({
      watchItemId: updated.id,
      type: "express_bus",
      provider: async () => {
        providerAttempts.push("update");
        const preflight = await db.watchItem.findUniqueOrThrow({ where: { id: updated.id } });
        await db.watchItem.update({
          where: { id: updated.id },
          data: { title: "updated item", updatedAt: new Date(preflight.updatedAt.getTime() + 1_000) }
        });
        return response();
      }
    }),
    (error: unknown) => error instanceof TripWatchError && error.code === "WATCH_ITEM_TYPE_MISMATCH"
  );

  assert.deepEqual(providerAttempts, ["type", "delete", "update"]);
  assert.equal(await db.queryResult.count(), 0);
});

test("ad-hoc response without association keeps the nullable result behavior", async () => {
  const stored = await createQueryResultFromResponse({ type: "flight", response: response() });
  assert.equal(stored.watchItemId, null);
  assert.equal(await db.queryResult.count(), 1);
});
