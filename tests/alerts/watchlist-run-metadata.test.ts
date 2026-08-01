import assert from "node:assert/strict";
import { before, mock, test } from "node:test";
import type { QueryResult, WatchItem } from "@prisma/client";

const persistedAt = new Date("2026-07-18T12:00:00.000Z");
const persistedResult = {
  id: "result-1",
  type: "flight",
  checkedAt: persistedAt,
  createdAt: persistedAt
};
const createQueryResultFromResponse = mock.fn(async () => persistedResult);
type WatchItemRunLookup = Pick<WatchItem, "id" | "type" | "title" | "paramsJson" | "enabled"> & {
  results: Array<Pick<QueryResult, "status" | "checkedAt">>;
};

type FindWatchItemForRun = (args: {
  where: { id: string };
  include: {
    results: {
      orderBy: readonly unknown[];
      take: number;
      select: { status: true; checkedAt: true };
    };
  };
}) => Promise<WatchItemRunLookup | null>;

const findUnique = mock.fn<FindWatchItemForRun>();
const searchFlights = mock.fn(async () => ({
  status: "success" as const,
  checkedAt: "2026-07-18T12:00:00.000Z",
  source: "flight-ticket-search"
}));
const getTicketSchedule = mock.fn(async () => ({
  status: "success" as const,
  checkedAt: "2026-07-18T12:00:00.000Z",
  source: "ticket-availability"
}));

mock.module("@/lib/db", {
  namedExports: {
    db: { watchItem: { findUnique } }
  }
});
mock.module("@/lib/result-store", {
  namedExports: { createQueryResultFromResponse }
});
mock.module("@/lib/services/flight-service", {
  namedExports: {
    compareFlightMonth: mock.fn(),
    searchFlights
  }
});
mock.module("@/lib/services/express-bus-service", {
  namedExports: { searchExpressBuses: mock.fn() }
});
mock.module("@/lib/services/intercity-bus-service", {
  namedExports: { searchIntercityBuses: mock.fn() }
});
mock.module("@/lib/services/ticket-service", {
  namedExports: {
    getTicketSchedule,
    getTicketSeats: mock.fn()
  }
});
mock.module("@/lib/services/foresttrip-service", {
  namedExports: { searchForesttrip: mock.fn() }
});

let watchlistRunService: typeof import("../../lib/services/watchlist-run-service");

before(async () => {
  watchlistRunService = await import("../../lib/services/watchlist-run-service");
});

function flightItem(overrides: Partial<{ enabled: boolean; paramsJson: string }> = {}) {
  return {
    id: "watch-1",
    type: "flight",
    title: "Flight",
    enabled: true,
    paramsJson: JSON.stringify({
      from: "ICN",
      to: "NRT",
      date: "2026-08-01",
      mode: "oneway"
    }),
    ...overrides
  };
}

test("run metadata records provider linearization and persisted result identity", async () => {
  const result = await watchlistRunService.runWatchItem(flightItem());

  assert.equal(result.alertMode, "flight_search");
  assert.equal(result.providerDispatched, true);
  assert.deepEqual(result.storedResult, persistedResult);
  assert.equal(searchFlights.mock.callCount(), 1);
  assert.equal(createQueryResultFromResponse.mock.callCount(), 1);
});

test("pre-provider disabled and validation paths do not report provider dispatch", async () => {
  const disabled = await watchlistRunService.runWatchItem(flightItem({ enabled: false }));
  const invalid = await watchlistRunService.runWatchItem(flightItem({ paramsJson: "{}" }));

  assert.equal(disabled.providerDispatched, false);
  assert.equal(invalid.providerDispatched, false);
  assert.equal(disabled.alertMode, "flight_search");
  assert.equal(invalid.alertMode, "flight_search");
  assert.ok(disabled.storedResult);
  assert.ok(invalid.storedResult);
  assert.equal(searchFlights.mock.callCount(), 1);
});

test("ticket schedule runs manually but has no alert mode", async () => {
  const result = await watchlistRunService.runWatchItem({
    id: "watch-ticket",
    type: "ticket",
    title: "Ticket schedule",
    enabled: true,
    paramsJson: JSON.stringify({ mode: "schedule", input: "interpark:123" })
  });

  assert.equal(result.alertMode, undefined);
  assert.equal(result.providerDispatched, true);
  assert.ok(result.storedResult);
  assert.equal(getTicketSchedule.mock.callCount(), 1);
});
test("a thrown provider call remains dispatched after it is converted to a failed response", async () => {
  searchFlights.mock.mockImplementationOnce(async () => {
    throw new Error("provider failed");
  });

  const result = await watchlistRunService.runWatchItem(flightItem());

  assert.equal(result.providerDispatched, true);
  assert.equal(result.response.status, "failed");
  assert.deepEqual(result.storedResult, persistedResult);
});

test("missing and cooldown lookups do not report provider dispatch", async () => {
  findUnique.mock.mockImplementationOnce(async () => null);
  const missing = await watchlistRunService.runWatchItemById("missing");

  findUnique.mock.mockImplementationOnce(async () => ({
    ...flightItem(),
    results: [{ status: "failed", checkedAt: new Date() }]
  }));
  const cooldown = await watchlistRunService.runWatchItemById("watch-1");

  assert.equal(missing.providerDispatched, false);
  assert.equal(cooldown.providerDispatched, false);
  assert.equal(cooldown.alertMode, "flight_search");
});
