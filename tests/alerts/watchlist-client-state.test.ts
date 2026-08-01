import assert from "node:assert/strict";
import test from "node:test";

import { replaceWatchItemById } from "@/lib/watchlist-client-state";
import type { WatchItemListItem } from "@/lib/watchlist";

function item(id: string, title = id): WatchItemListItem {
  return {
    id,
    type: "flight",
    title,
    paramsJson: "{}",
    enabled: true,
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    alertRule: null
  };
}

test("replaces exactly one watch item without changing order or untouched references", () => {
  const first = item("first");
  const second = item("second");
  const replacement = item("second", "Updated");

  const original = [first, second];
  const result = replaceWatchItemById(original, replacement);

  assert.notEqual(result, original);
  assert.deepEqual(result.map((entry) => entry.id), ["first", "second"]);
  assert.equal(result[0], first);
  assert.equal(result[1], replacement);
  assert.equal(second.title, "second");
});

test("rejects missing and duplicate replacement IDs", () => {
  assert.throws(() => replaceWatchItemById([item("one")], item("missing")), /found 0/);
  assert.throws(() => replaceWatchItemById([item("one"), item("one")], item("one")), /found 2/);
});
