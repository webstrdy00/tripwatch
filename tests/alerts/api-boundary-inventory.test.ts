import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { z } from "zod";

import {
  MAX_JSON_BODY_BYTES,
  assertNoRequestBody,
  parseJsonBodyWithSchema
} from "../../lib/api-response";
import { TripWatchError } from "../../lib/errors";
import {
  assertLocalOperatorRequest,
  withLocalOperatorRequest
} from "../../lib/security/local-operator";

export const API_BOUNDARY_EXPECTED_METHODS = {
  "app/api/alert-rules/[id]/route.ts": ["PATCH", "DELETE"],
  "app/api/alert-rules/route.ts": ["GET", "POST"],
  "app/api/watchlist/[id]/route.ts": ["PATCH", "DELETE"],
  "app/api/watchlist/route.ts": ["GET", "POST"],
  "app/api/watchlist/run-batch/route.ts": ["POST"],
  "app/api/foresttrip/search/route.ts": ["POST"],
  "app/api/watchlist/[id]/run/route.ts": ["POST"],
  "app/api/dashboard/summary/route.ts": ["GET"],
  "app/api/tickets/seats/route.ts": ["POST"],
  "app/api/tickets/schedule/route.ts": ["POST"],
  "app/api/buses/intercity/search/route.ts": ["POST"],
  "app/api/buses/express/search/route.ts": ["POST"],
  "app/api/flights/compare-month/route.ts": ["POST"],
  "app/api/flights/search/route.ts": ["POST"]
} as const;

export const API_BOUNDARY_ALLOWED_AUTHORITIES = ["127.0.0.1", "localhost"] as const;
export const API_BOUNDARY_MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
export const API_BOUNDARY_HANDLER_EFFECTS = {
  "app/api/alert-rules/[id]/route.ts": {
    PATCH: ["parseDatabaseId", "parseJsonBodyWithSchema", "disableAlertRule", "updateAlertRule", "reloadWatchItem"],
    DELETE: ["assertNoRequestBody", "parseDatabaseId", "deleteAlertRuleDraft"]
  },
  "app/api/alert-rules/route.ts": {
    GET: ["alertRuleListQuerySchema.safeParse", "listAlertRules"],
    POST: ["parseJsonBodyWithSchema", "createAlertRule", "reloadWatchItem"]
  },
  "app/api/watchlist/[id]/route.ts": {
    PATCH: ["parseDatabaseId", "parseJsonBodyWithSchema", "updateWatchItemWithAlertRuleLifecycle"],
    DELETE: ["assertNoRequestBody", "parseDatabaseId", "deleteWatchItemWithAlertRuleLifecycle"]
  },
  "app/api/watchlist/route.ts": {
    GET: ["parseListQuery", "db.watchItem.findMany"],
    POST: ["parseJsonBodyWithSchema", "db.watchItem.create"]
  },
  "app/api/watchlist/run-batch/route.ts": {
    POST: ["parseJsonBodyWithSchema", "targetTypes", "db.watchItem.findMany", "isFailedRerunCooldownActive", "runWatchItem"]
  },
  "app/api/foresttrip/search/route.ts": {
    POST: ["parseJsonBodyWithSchema", "searchForesttrip", "storeResponse"]
  },
  "app/api/watchlist/[id]/run/route.ts": {
    POST: ["assertNoRequestBody", "parseDatabaseId", "runWatchItemById"]
  },
  "app/api/dashboard/summary/route.ts": {
    GET: ["getDashboardSummary"]
  },
  "app/api/tickets/seats/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "getTicketSeats", "createQueryResultFromResponse"]
  },
  "app/api/tickets/schedule/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "getTicketSchedule", "createQueryResultFromResponse"]
  },
  "app/api/buses/intercity/search/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "searchIntercityBuses", "createQueryResultFromResponse"]
  },
  "app/api/buses/express/search/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "searchExpressBuses", "createQueryResultFromResponse"]
  },
  "app/api/flights/compare-month/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "compareFlightMonth", "createQueryResultFromResponse"]
  },
  "app/api/flights/search/route.ts": {
    POST: ["parseJsonBodyWithSchema", "preflightWatchItemAssociation", "searchFlights", "createQueryResultFromResponse"]
  }
} as const;

const strictBodySchema = z.object({ value: z.string() }).strict();

function trustedHeaders(authority: string, method: string): HeadersInit {
  return API_BOUNDARY_MUTATING_METHODS.includes(method as (typeof API_BOUNDARY_MUTATING_METHODS)[number])
    ? {
        host: authority,
        origin: `http://${authority}`,
        "sec-fetch-site": "same-origin"
      }
    : { host: authority };
}

function localRequest(method: string, authority: string, headers: HeadersInit): Request {
  return new Request(`http://${authority}/api/test`, { method, headers });
}

function isLocalOperatorError(error: unknown): boolean {
  return error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED";
}

function isValidationError(error: unknown): boolean {
  return error instanceof TripWatchError && error.code === "VALIDATION_ERROR";
}

test("API inventory is the exact 14-file, 18-method contract and every handler guards before its pinned effects", () => {
  let methodCount = 0;

  for (const [path, expectedMethods] of Object.entries(API_BOUNDARY_EXPECTED_METHODS)) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    const actualMethods = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\s*\(request/g)]
      .map((match) => match[1]);
    assert.deepEqual(actualMethods.sort(), [...expectedMethods].sort(), path);
    methodCount += actualMethods.length;

    for (const method of expectedMethods) {
      const start = source.search(new RegExp(`export async function ${method}\\s*\\(request`));
      assert.ok(start >= 0, `${path} ${method} export`);
      const next = source.slice(start + 1).search(/\nexport async function (?:GET|POST|PUT|PATCH|DELETE)\s*\(/);
      const body = source.slice(start, next < 0 ? undefined : start + 1 + next);
      const guardIndex = body.indexOf("assertLocalOperatorRequest(request)");
      const routeEffects = API_BOUNDARY_HANDLER_EFFECTS[
        path as keyof typeof API_BOUNDARY_HANDLER_EFFECTS
      ] as Record<string, readonly string[]>;
      const effectSymbols = routeEffects[method];
      assert.ok(guardIndex >= 0, `${path} ${method} guard`);
      assert.ok(effectSymbols?.length, `${path} ${method} pinned effects`);

      const effectIndexes = effectSymbols.map((symbol) => {
        const index = body.indexOf(symbol);
        assert.ok(index >= 0, `${path} ${method} includes ${symbol}`);
        return index;
      });
      assert.equal(effectIndexes[0], Math.min(...effectIndexes), `${path} ${method} first pinned effect`);
      assert.ok(guardIndex < effectIndexes[0], `${path} ${method} guard precedes first pinned effect`);
    }
  }

  assert.deepEqual(Object.keys(API_BOUNDARY_HANDLER_EFFECTS).sort(), Object.keys(API_BOUNDARY_EXPECTED_METHODS).sort());
  assert.equal(Object.keys(API_BOUNDARY_EXPECTED_METHODS).length, 14);
  assert.equal(methodCount, 18);
});

test("local guard admits every inventory method and authority tuple without invoking route handlers", async () => {
  let guardCallbacks = 0;

  for (const methods of Object.values(API_BOUNDARY_EXPECTED_METHODS)) {
    for (const method of methods) {
      for (const authority of ["127.0.0.1:3000", "localhost:3000", "127.0.0.1:43127", "localhost:43127"]) {
        await withLocalOperatorRequest(
          localRequest(method, authority, trustedHeaders(authority, method)),
          () => {
            guardCallbacks += 1;
          }
        );
      }
    }
  }

  assert.equal(guardCallbacks, 18 * 4);
});

test("mixed authorities, other hosts, wrong fetch-site, and forwarded rescue reject before effects", async () => {
  const invalid = [
    localRequest("POST", "127.0.0.1:3000", {
      host: "localhost:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin"
    }),
    localRequest("POST", "localhost:3000", {
      host: "localhost:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin"
    }),
    localRequest("POST", "127.0.0.1:3000", {
      host: "127.0.0.1:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin"
    }),
    localRequest("POST", "localhost:3000", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "cross-site"
    }),
    new Request("http://attacker.example:3000/api/test", {
      method: "POST",
      headers: {
        host: "attacker.example:3000",
        origin: "http://attacker.example:3000",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-proto": "http"
      }
    })
  ];
  let effects = 0;

  for (const request of invalid) {
    await assert.rejects(withLocalOperatorRequest(request, () => ++effects), isLocalOperatorError);
  }

  assert.equal(effects, 0);
});

test("invalid authority is rejected without pulling the request body", () => {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode('{"value":"ok"}'));
      controller.close();
    }
  });
  const request = new Request("http://attacker.example/api/test", {
    method: "POST",
    headers: {
      host: "attacker.example",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json"
    },
    body,
    duplex: "half"
  } as RequestInit & { duplex: "half" });

  assert.throws(() => assertLocalOperatorRequest(request), isLocalOperatorError);
  assert.equal(pulls, 0);
});

test("bounded JSON accepts only JSON with optional UTF-8 charset and a strict schema", async () => {
  for (const authority of ["127.0.0.1:3000", "localhost:43127"]) {
    for (const contentType of ["application/json", "Application/JSON; Charset=UTF-8"]) {
      const request = new Request(`http://${authority}/api/test`, {
        method: "POST",
        headers: { ...trustedHeaders(authority, "POST"), "content-type": contentType },
        body: JSON.stringify({ value: "ok" })
      });
      assertLocalOperatorRequest(request);
      assert.deepEqual(await parseJsonBodyWithSchema(request, strictBodySchema), { value: "ok" });
    }
  }

  for (const body of [
    JSON.stringify({ value: "ok", unknown: true }),
    "",
    "{",
    '{"value":"ok"} trailing'
  ]) {
    const request = new Request("http://127.0.0.1:3000/api/test", {
      method: "POST",
      headers: { ...trustedHeaders("127.0.0.1:3000", "POST"), "content-type": "application/json" },
      body
    });
    await assert.rejects(parseJsonBodyWithSchema(request, strictBodySchema), isValidationError);
  }

  for (const contentType of [
    "text/plain",
    "application/json; charset=utf-16",
    "application/json; charset=utf-8; profile=test",
    "application/json; charset=utf-8; charset=utf-8"
  ]) {
    const request = new Request("http://127.0.0.1:3000/api/test", {
      method: "POST",
      headers: { ...trustedHeaders("127.0.0.1:3000", "POST"), "content-type": contentType },
      body: JSON.stringify({ value: "ok" })
    });
    await assert.rejects(parseJsonBodyWithSchema(request, strictBodySchema), isValidationError);
  }
});

test("declared and streaming overflow reject with a bounded error and streaming overflow cancels", async () => {
  const declaredRequest = new Request("http://127.0.0.1:3000/api/test", {
    method: "POST",
    headers: {
      ...trustedHeaders("127.0.0.1:3000", "POST"),
      "content-type": "application/json",
      "content-length": String(MAX_JSON_BODY_BYTES + 1)
    },
    body: "{}"
  });
  await assert.rejects(parseJsonBodyWithSchema(declaredRequest, strictBodySchema), isValidationError);

  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_JSON_BODY_BYTES));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled += 1;
    }
  });
  const streamingRequest = new Request("http://localhost:43127/api/test", {
    method: "POST",
    headers: {
      ...trustedHeaders("localhost:43127", "POST"),
      "content-type": "application/json"
    },
    body: stream,
    duplex: "half"
  } as RequestInit & { duplex: "half" });
  await assert.rejects(parseJsonBodyWithSchema(streamingRequest, strictBodySchema), isValidationError);
  assert.equal(cancelled, 1);
});

test("bodyless requests reject any non-empty declared or streamed body", async () => {
  const empty = localRequest("DELETE", "127.0.0.1:3000", trustedHeaders("127.0.0.1:3000", "DELETE"));
  await assertNoRequestBody(empty);

  const body = new Request("http://127.0.0.1:3000/api/test", {
    method: "DELETE",
    headers: trustedHeaders("127.0.0.1:3000", "DELETE"),
    body: "{}"
  });
  await assert.rejects(assertNoRequestBody(body), isValidationError);
});
