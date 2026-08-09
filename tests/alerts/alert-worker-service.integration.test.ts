import assert from "node:assert/strict";
import test from "node:test";

import { runAlertWorker } from "@/lib/services/alert-worker-service";
import type { StoredWatchItemRunResult } from "@/lib/services/watchlist-run-service";

type Row = Record<string, any>;

const fixedNow = new Date("2026-07-18T00:00:00.000Z");

function makeRule(index: number): Row {
  const createdAt = new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
  return {
    id: `rule-${index}`, watchItemId: `watch-${index}`, channel: "telegram",
    conditionJson: JSON.stringify({ kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 50000 }),
    enabled: true, outboundOptIn: true, configVersion: 1, latestOutcome: "never", latestOutcomeAt: null,
    latestOutcomeCode: null, baselineState: "never", baselineFingerprint: null, baselineTransitionSeq: 0,
    baselineAt: null, deliveryState: "never", attemptId: null, attemptRunId: null, attemptFingerprint: null,
    attemptTransitionSeq: null, attemptResultId: null, attemptResultType: null, lastAttemptAt: null,
    terminalAt: null, deliveryCode: null, lastProviderRunAt: index < 6 ? null : new Date(`2026-06-${String(index - 5).padStart(2, "0")}T00:00:00.000Z`),
    createdAt, updatedAt: createdAt,
    watchItem: {
      id: `watch-${index}`, type: "flight", title: `Trip ${index}`,
      paramsJson: JSON.stringify({ from: "ICN", to: "CJU", date: "2026-08-01", passengers: 1 }),
      enabled: true, updatedAt: createdAt, results: [] as Row[]
    }
  };
}

type FakeHooks = {
  beforeFindUnique?: (call: number, row: Row | undefined, rows: Row[]) => void;
  failUpdate?: (call: number, row: Row | undefined, data: Row) => boolean;
};

function fakeClient(rows: Row[], hooks: FakeHooks = {}) {
  const scalarMatch = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    if (key === "watchItem") return true;
    if (key === "deliveryState") {
      return typeof value === "string" ? row.deliveryState === value : !value?.notIn?.includes(row.deliveryState);
    }
    if (value && typeof value === "object") return true;
    return row[key] === value;
  });
  let findUniqueCalls = 0;
  let updateManyCalls = 0;
  const client: any = {
    alertRule: {
      findMany: async ({ where }: { where: Row }) => rows.filter((row) => {
        const state = where.deliveryState?.in as string[] | undefined;
        return state ? state.includes(row.deliveryState) : row.enabled && row.outboundOptIn && row.channel === "telegram";
      }).map((row) => structuredClone(row)),
      findUnique: async ({ where }: { where: Row }) => {
        findUniqueCalls += 1;
        const row = rows.find((candidate) => candidate.id === where.id);
        hooks.beforeFindUnique?.(findUniqueCalls, row, rows);
        return row ? structuredClone(row) : null;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        updateManyCalls += 1;
        const row = rows.find((candidate) => scalarMatch(candidate, where));
        if (!row || hooks.failUpdate?.(updateManyCalls, row, data)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    },
    $transaction: async <T>(callback: (transaction: any) => Promise<T>) => callback(client)
  };
  return client;
}

function resultFor(index: number): Row & StoredWatchItemRunResult {
  return {
    id: `result-${index}`, type: "flight", status: "success", source: "flight-ticket-search",
    checkedAt: fixedNow, createdAt: fixedNow, officialUrl: "https://www.google.com/travel/flights",
    resultJson: JSON.stringify({
      query: { from: "ICN", to: "CJU", date: "2026-08-01" }, priceSummary: { currency: "KRW" },
      flights: [{ quality: "complete", airlineName: "Air", departureTime: "08:00", arrivalTime: "09:00", price: 50000 }]
    })
  };
}
function newerResult(index: number, type = "flight"): Row & StoredWatchItemRunResult {
  return {
    ...resultFor(index),
    id: `newer-${index}-${type}`,
    type,
    checkedAt: new Date(fixedNow.getTime() + 1),
    createdAt: new Date(fixedNow.getTime() + 1)
  };
}

test("worker rejects an invalid dispatch cap before any external effect", async () => {
  await assert.rejects(runAlertWorker({ limit: 0, credentials: { botToken: "test", chatId: "test" } }), /limit must be an integer from 1 to 10/);
  await assert.rejects(runAlertWorker({ limit: 11, credentials: { botToken: "test", chatId: "test" } }), /limit must be an integer from 1 to 10/);
});

test("twelve-rule null-first fair rotation stops at five actual sequential dispatches", async () => {
  const rows = Array.from({ length: 12 }, (_, index) => makeRule(index));
  const dispatched: string[] = [];
  let active = 0;
  let maximum = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never,
    credentials: { botToken: "test", chatId: "1" }, now: () => fixedNow, runId: "run-fixed",
    runWatchItem: async (watchItemId) => {
      active += 1;
      maximum = Math.max(maximum, active);
      dispatched.push(watchItemId);
      const index = Number(watchItemId.slice("watch-".length));
      const row = rows[index];
      const stored = resultFor(index);
      row.watchItem.results = [stored];
      active -= 1;
      return { providerDispatched: true, alertMode: "flight_search", storedResult: stored, response: {} as never };
    },
    sendTelegram: async () => ({ outcome: "sent", code: "TELEGRAM_SENT" })
  });

  assert.equal(result.providerDispatches, 5);
  assert.equal(maximum, 1);
  assert.deepEqual(dispatched, ["watch-0", "watch-1", "watch-2", "watch-3", "watch-4"]);
  assert.equal(rows.filter((row) => row.deliveryState === "sent").length, 5);
});
test("a provider cooldown skip leaves rule state untouched and an immediate second run has no external effect", async () => {
  const rows = [makeRule(0)];
  let providerCalls = 0;
  let telegramCalls = 0;
  const worker = () => runAlertWorker({
    db: fakeClient(rows) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      providerCalls += 1;
      const stored = resultFor(0);
      rows[0].watchItem.results = [stored];
      return { providerDispatched: true, alertMode: "flight_search", storedResult: stored, response: {} as never };
    },
    sendTelegram: async () => {
      telegramCalls += 1;
      return { outcome: "sent", code: "TELEGRAM_SENT" };
    }
  });
  const first = await worker();
  const baseline = structuredClone(rows[0]);
  const second = await worker();

  assert.equal(first.providerDispatches, 1);
  assert.equal(second.providerDispatches, 0);
  assert.equal(second.providerCooldownSkipped, 1);
  assert.equal(providerCalls, 1);
  assert.equal(telegramCalls, 1);
  assert.deepEqual(rows[0], baseline);
});

test("same-type due rules dispatch sequentially up to the invocation cap", async () => {
  const rows = [makeRule(0), makeRule(1)];
  const dispatched: string[] = [];
  const result = await runAlertWorker({
    db: fakeClient(rows) as never,
    limit: 2,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async (watchItemId) => {
      dispatched.push(watchItemId);
      const index = Number(watchItemId.slice("watch-".length));
      const stored = resultFor(index);
      rows[index].watchItem.results = [stored];
      return { providerDispatched: true, alertMode: "flight_search", storedResult: stored, response: {} as never };
    },
    sendTelegram: async () => ({ outcome: "sent", code: "TELEGRAM_SENT" })
  });

  assert.equal(result.providerDispatches, 2);
  assert.deepEqual(dispatched, ["watch-0", "watch-1"]);
});

test("a concurrent same-rule runner loses without a second provider or Telegram effect", async () => {
  const rows = [makeRule(0)];
  const client = fakeClient(rows);
  let releaseFirst: (() => void) | undefined;
  const firstClaimed = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let providerCalls = 0;
  let telegramCalls = 0;
  const first = runAlertWorker({
    db: client as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      providerCalls += 1;
      releaseFirst?.();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      const stored = resultFor(0);
      rows[0].watchItem.results = [stored];
      return { providerDispatched: true, alertMode: "flight_search", storedResult: stored, response: {} as never };
    },
    sendTelegram: async () => {
      telegramCalls += 1;
      return { outcome: "sent", code: "TELEGRAM_SENT" };
    }
  });
  await firstClaimed;
  const second = await runAlertWorker({
    db: client as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      providerCalls += 1;
      throw new Error("second provider call");
    },
    sendTelegram: async () => {
      telegramCalls += 1;
      throw new Error("second telegram call");
    }
  });
  releaseFirst?.();
  const firstResult = await first;

  assert.equal(firstResult.providerDispatches, 1);
  assert.equal(second.providerDispatches, 0);
  assert.equal(providerCalls, 1);
  assert.equal(telegramCalls, 1);
});

test("startup recovery cancels reserved attempts, marks sending ambiguous, and performs no dispatch", async () => {
  const rows = [makeRule(0), makeRule(1)];
  for (const [index, state] of ["reserved", "sending"].entries()) {
    Object.assign(rows[index], {
      deliveryState: state, attemptId: `attempt-${index}`, attemptRunId: "old-run", attemptFingerprint: "v1:test",
      attemptTransitionSeq: 1, attemptResultId: `result-${index}`, attemptResultType: "flight", lastAttemptAt: fixedNow
    });
  }
  let calls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never, credentials: { botToken: "test", chatId: "1" }, now: () => fixedNow,
    runWatchItem: async () => { calls += 1; throw new Error("must not run"); },
    sendTelegram: async () => { calls += 1; return { outcome: "sent", code: "TELEGRAM_SENT" }; }
  });

  assert.equal(result.exitCode, 6);
  assert.equal(result.recoveredReserved, 1);
  assert.equal(result.recoveredSending, 1);
  assert.equal(calls, 0);
  assert.equal(rows[0].deliveryState, "cancelled");
  assert.equal(rows[1].deliveryState, "ambiguous");
});
test("initial latest type mismatch is recorded before claim and never dispatches", async () => {
  const rows = [makeRule(0)];
  rows[0].watchItem.results = [{
    id: "wrong-type", type: "ticket", status: "success", source: "ticket-availability",
    checkedAt: fixedNow, createdAt: fixedNow, resultJson: "{}"
  }];
  let calls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never, credentials: { botToken: "test", chatId: "1" }, now: () => fixedNow,
    runWatchItem: async () => { calls += 1; return { providerDispatched: false, response: {} as never }; },
    sendTelegram: async () => { calls += 1; return { outcome: "sent", code: "TELEGRAM_SENT" }; }
  });

  assert.equal(result.exitCode, 4);
  assert.equal(result.providerDispatches, 0);
  assert.equal(calls, 0);
  assert.equal(rows[0].latestOutcome, "result_type_mismatch");
});
test("a pre-provider skip restores its claimed cursor and does not consume the dispatch cap", async () => {
  const rows = [makeRule(7)];
  const prior = rows[0].lastProviderRunAt;
  let calls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never, credentials: { botToken: "test", chatId: "1" }, now: () => fixedNow,
    runWatchItem: async () => {
      calls += 1;
      return { providerDispatched: false, response: {} as never };
    },
    sendTelegram: async () => {
      throw new Error("must not send");
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.providerDispatches, 0);
  assert.equal(result.skipped, 1);
  assert.equal(rows[0].lastProviderRunAt?.getTime(), prior?.getTime());
});
test("a pre-provider exception restores its claimed cursor without consuming dispatch capacity", async () => {
  const rows = [makeRule(7)];
  const prior = rows[0].lastProviderRunAt;
  let calls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      calls += 1;
      throw new Error("pre-provider failure");
    },
    sendTelegram: async () => {
      throw new Error("must not send");
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.exitCode, 4);
  assert.equal(result.providerDispatches, 0);
  assert.equal(result.skipped, 1);
  assert.equal(rows[0].lastProviderRunAt?.getTime(), prior?.getTime());
  assert.equal(rows[0].latestOutcomeCode, "PROVIDER_DISPATCH_FAILED");
});

test("a signalled post-provider exception retains cadence and consumes one dispatch without retry", async () => {
  const rows = [makeRule(7)];
  let calls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async (_watchItemId, signal) => {
      calls += 1;
      signal.providerDispatchStarted();
      throw new Error("post-provider failure");
    },
    sendTelegram: async () => {
      throw new Error("must not send");
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.exitCode, 4);
  assert.equal(result.providerDispatches, 1);
  assert.equal(result.skipped, 0);
  assert.equal(rows[0].lastProviderRunAt?.getTime(), fixedNow.getTime());
  assert.equal(rows[0].latestOutcomeCode, "PROVIDER_DISPATCH_FAILED");
});

test("scan-to-claim latest-result races block provider work without advancing the cursor", async () => {
  for (const type of ["flight", "ticket"]) {
    const rows = [makeRule(0)];
    const initial = resultFor(0);
    rows[0].watchItem.results = [initial];
    const priorCursor = rows[0].lastProviderRunAt;
    let providerCalls = 0;
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows, {
        beforeFindUnique(call, row) {
          if (call === 1 && row) row.watchItem.results = [newerResult(0, type), initial];
        }
      }) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async () => {
        providerCalls += 1;
        return { providerDispatched: false, response: {} as never };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      }
    });

    assert.equal(result.exitCode, 4);
    assert.equal(providerCalls, 0);
    assert.equal(telegramCalls, 0);
    assert.equal(rows[0].lastProviderRunAt, priorCursor);
    assert.equal(rows[0].latestOutcome, type === "flight" ? "result_superseded" : "result_type_mismatch");
  }
});

test("post-persist latest-result races are classified before evaluation or delivery", async () => {
  for (const type of ["flight", "ticket"]) {
    const rows = [makeRule(0)];
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async () => {
        const stored = resultFor(0);
        rows[0].watchItem.results = [newerResult(0, type), stored];
        return {
          providerDispatched: true,
          alertMode: "flight_search",
          storedResult: stored as never,
          response: {} as never
        };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      }
    });

    assert.equal(result.providerDispatches, 1);
    assert.equal(result.exitCode, 4);
    assert.equal(telegramCalls, 0);
    assert.equal(rows[0].baselineState, "never");
    assert.equal(rows[0].latestOutcome, type === "flight" ? "result_superseded" : "result_type_mismatch");
  }
});

test("reservation rechecks exact latest and never advances a stale baseline", async () => {
  for (const type of ["flight", "ticket"]) {
    const rows = [makeRule(0)];
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows, {
        beforeFindUnique(call, row) {
          if (call === 3 && row) {
            const stored = row.watchItem.results.find((candidate: Row) => candidate.id === "result-0");
            row.watchItem.results = [newerResult(0, type), stored];
          }
        }
      }) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async () => {
        const stored = resultFor(0);
        rows[0].watchItem.results = [stored];
        return {
          providerDispatched: true,
          alertMode: "flight_search",
          storedResult: stored as never,
          response: {} as never
        };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      }
    });

    assert.equal(result.exitCode, 4);
    assert.equal(telegramCalls, 0);
    assert.equal(rows[0].baselineState, "never");
    assert.equal(rows[0].baselineTransitionSeq, 0);
    assert.equal(rows[0].deliveryState, "never");
  }
});

test("sending fence cancels stale or disabled reservations before any fetch", async () => {
  for (const scenario of ["superseded", "type_mismatch", "disabled"] as const) {
    const rows = [makeRule(0)];
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows, {
        beforeFindUnique(call, row) {
          if (call !== 4 || !row) return;
          if (scenario === "disabled") row.enabled = false;
          else {
            const stored = row.watchItem.results.find((candidate: Row) => candidate.id === "result-0");
            row.watchItem.results = [
              newerResult(0, scenario === "type_mismatch" ? "ticket" : "flight"),
              stored
            ];
          }
        }
      }) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async () => {
        const stored = resultFor(0);
        rows[0].watchItem.results = [stored];
        return {
          providerDispatched: true,
          alertMode: "flight_search",
          storedResult: stored as never,
          response: {} as never
        };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      }
    });

    assert.equal(result.exitCode, 4, `${scenario}: ${JSON.stringify({ deliveryState: rows[0].deliveryState, attemptId: rows[0].attemptId, attemptRunId: rows[0].attemptRunId, attemptFingerprint: rows[0].attemptFingerprint, attemptTransitionSeq: rows[0].attemptTransitionSeq, attemptResultId: rows[0].attemptResultId, attemptResultType: rows[0].attemptResultType, terminalAt: rows[0].terminalAt })}`);
    assert.equal(result.cancelled, 1);
    assert.equal(telegramCalls, 0);
    assert.equal(rows[0].deliveryState, "cancelled");
    assert.equal(rows[0].baselineState, "matched");
    assert.equal(
      rows[0].deliveryCode,
      scenario === "superseded"
        ? "QUERY_RESULT_SUPERSEDED"
        : scenario === "type_mismatch"
          ? "QUERY_RESULT_TYPE_MISMATCH"
          : "ALERT_DISABLED"
    );
  }
});

test("reservation CAS loss causes no fetch and no committed baseline", async () => {
  const rows = [makeRule(0)];
  let telegramCalls = 0;
  const result = await runAlertWorker({
    db: fakeClient(rows, {
      failUpdate(_call, _row, data) {
        return data.deliveryState === "reserved";
      }
    }) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      const stored = resultFor(0);
      rows[0].watchItem.results = [stored];
      return {
        providerDispatched: true,
        alertMode: "flight_search",
        storedResult: stored as never,
        response: {} as never
      };
    },
    sendTelegram: async () => {
      telegramCalls += 1;
      return { outcome: "sent", code: "TELEGRAM_SENT" };
    }
  });

  assert.equal(result.skipped, 1);
  assert.equal(telegramCalls, 0);
  assert.equal(rows[0].baselineState, "never");
  assert.equal(rows[0].deliveryState, "never");
});

test("cooldown suppresses a new transition until the inclusive boundary", async () => {
  for (const elapsed of [21_599_999, 21_600_000]) {
    const rows = [makeRule(0)];
    Object.assign(rows[0], {
      baselineState: "no_match",
      baselineTransitionSeq: 1,
      baselineAt: new Date(fixedNow.getTime() - elapsed),
      lastAttemptAt: new Date(fixedNow.getTime() - elapsed),
      deliveryState: "sent"
    });
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async () => {
        const stored = resultFor(0);
        rows[0].watchItem.results = [stored];
        return {
          providerDispatched: true,
          alertMode: "flight_search",
          storedResult: stored as never,
          response: {} as never
        };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return { outcome: "sent", code: "TELEGRAM_SENT" };
      }
    });

    if (elapsed === 21_599_999) {
      assert.equal(result.suppressed, 1);
      assert.equal(telegramCalls, 0);
      assert.equal(rows[0].deliveryState, "suppressed");
    } else {
      assert.equal(result.sent, 1);
      assert.equal(telegramCalls, 1);
      assert.equal(rows[0].deliveryState, "sent");
    }
  }
});

test("rejected and ambiguous sends are single-attempt fail-fast terminal outcomes", async () => {
  for (const outcome of ["rejected", "ambiguous"] as const) {
    const rows = [makeRule(0), makeRule(1)];
    let telegramCalls = 0;
    const result = await runAlertWorker({
      db: fakeClient(rows) as never,
      credentials: { botToken: "test", chatId: "1" },
      now: () => fixedNow,
      runWatchItem: async (watchItemId) => {
        const index = Number(watchItemId.slice("watch-".length));
        const stored = resultFor(index);
        rows[index].watchItem.results = [stored];
        return {
          providerDispatched: true,
          alertMode: "flight_search",
          storedResult: stored as never,
          response: {} as never
        };
      },
      sendTelegram: async () => {
        telegramCalls += 1;
        return outcome === "rejected"
          ? { outcome: "rejected", code: "TELEGRAM_4XX" }
          : { outcome: "ambiguous", code: "TELEGRAM_AMBIGUOUS" };
      }
    });

    assert.equal(result.providerDispatches, 1);
    assert.equal(telegramCalls, 1);
    assert.equal(result.exitCode, outcome === "rejected" ? 5 : 6);
    assert.equal(result.rejected, outcome === "rejected" ? 1 : 0);
    assert.equal(result.ambiguous, outcome === "ambiguous" ? 1 : 0);
    assert.equal(rows[1].lastProviderRunAt, null);
  }
});

test("post-fence disable preserves ownership and terminal CAS loss is invariant failure", async () => {
  const sentRows = [makeRule(0)];
  const sentResult = await runAlertWorker({
    db: fakeClient(sentRows) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      const stored = resultFor(0);
      sentRows[0].watchItem.results = [stored];
      return {
        providerDispatched: true,
        alertMode: "flight_search",
        storedResult: stored as never,
        response: {} as never
      };
    },
    sendTelegram: async () => {
      sentRows[0].enabled = false;
      sentRows[0].outboundOptIn = false;
      return { outcome: "sent", code: "TELEGRAM_SENT" };
    }
  });
  assert.equal(sentResult.exitCode, 0);
  assert.equal(sentRows[0].deliveryState, "sent");

  const lostRows = [makeRule(0)];
  let telegramCalls = 0;
  const lostResult = await runAlertWorker({
    db: fakeClient(lostRows, {
      failUpdate(_call, _row, data) {
        return data.deliveryState === "sent";
      }
    }) as never,
    credentials: { botToken: "test", chatId: "1" },
    now: () => fixedNow,
    runWatchItem: async () => {
      const stored = resultFor(0);
      lostRows[0].watchItem.results = [stored];
      return {
        providerDispatched: true,
        alertMode: "flight_search",
        storedResult: stored as never,
        response: {} as never
      };
    },
    sendTelegram: async () => {
      telegramCalls += 1;
      return { outcome: "sent", code: "TELEGRAM_SENT" };
    }
  });

  assert.equal(telegramCalls, 1);
  assert.equal(lostResult.exitCode, 7);
  assert.equal(lostRows[0].deliveryState, "sending");
});
