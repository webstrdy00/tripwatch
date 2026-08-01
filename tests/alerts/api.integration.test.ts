import assert from "node:assert/strict";
import test from "node:test";

import { buildApiRouteError } from "../../lib/api-route-error";
import { TripWatchError } from "../../lib/errors";
import { DELETE as deleteWatchItem, PATCH as patchWatchItem } from "../../app/api/watchlist/[id]/route";
import { GET as getWatchlist, POST as createWatchItem } from "../../app/api/watchlist/route";
import { DELETE as deleteAlertRule, PATCH as patchAlertRule } from "../../app/api/alert-rules/[id]/route";
import { GET as getAlertRules, POST as createAlertRule } from "../../app/api/alert-rules/route";

const localHeaders = {
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  "sec-fetch-site": "same-origin"
};

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = localHeaders): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const itemContext = { params: Promise.resolve({ id: "watch-item" }) };
const ruleContext = { params: Promise.resolve({ id: "alert-rule" }) };

test("alert and watchlist routes reject forged loopback and forwarded headers before body parsing or persistence", async () => {
  const forwardedLoopbackHeaders = {
    host: "localhost:3000",
    origin: "http://localhost:3000",
    "sec-fetch-site": "cross-site",
    "x-forwarded-host": "127.0.0.1:3000",
    "x-forwarded-proto": "http",
    "x-forwarded-for": "127.0.0.1"
  };
  const responses = await Promise.all([
    getAlertRules(request("/api/alert-rules", "GET", undefined, forwardedLoopbackHeaders)),
    createAlertRule(request("/api/alert-rules", "POST", "not-an-alert-rule", forwardedLoopbackHeaders)),
    patchAlertRule(request("/api/alert-rules/alert-rule", "PATCH", { invalid: true }, forwardedLoopbackHeaders), ruleContext),
    deleteAlertRule(request("/api/alert-rules/alert-rule", "DELETE", { ignored: true }, forwardedLoopbackHeaders), ruleContext),
    getWatchlist(request("/api/watchlist", "GET", undefined, forwardedLoopbackHeaders)),
    createWatchItem(request("/api/watchlist", "POST", "not-a-watch-item", forwardedLoopbackHeaders)),
    patchWatchItem(request("/api/watchlist/watch-item", "PATCH", { invalid: true }, forwardedLoopbackHeaders), itemContext),
    deleteWatchItem(request("/api/watchlist/watch-item", "DELETE", undefined, forwardedLoopbackHeaders), itemContext)
  ]);

  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ALERT_LOCAL_OPERATOR_REQUIRED");
  }
});

test("mutating alert routes require every exact same-origin header before parsing bodies", async () => {
  const missingOrigin = { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" };
  const missingFetchSite = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" };
  const wrongOrigin = { ...localHeaders, origin: "http://127.0.0.1:3001" };
  const responses = await Promise.all([
    createAlertRule(request("/api/alert-rules", "POST", "invalid", missingOrigin)),
    patchAlertRule(request("/api/alert-rules/alert-rule", "PATCH", "invalid", missingFetchSite), ruleContext),
    deleteAlertRule(request("/api/alert-rules/alert-rule", "DELETE", { ignored: true }, wrongOrigin), ruleContext)
  ]);

  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "ALERT_LOCAL_OPERATOR_REQUIRED");
  }
});

test("local mutation bodies use strict create, update, enable, disable, and delete contracts", async () => {
  const responses = await Promise.all([
    createAlertRule(request("/api/alert-rules", "POST", {
      watchItemId: "watch-item",
      condition: { kind: "availability" },
      unexpected: true
    })),
    patchAlertRule(
      request("/api/alert-rules/alert-rule", "PATCH", {
        configVersion: 1,
        enabled: true,
        outboundOptIn: false,
        channel: "telegram"
      }),
      ruleContext
    ),
    patchAlertRule(
      request("/api/alert-rules/alert-rule", "PATCH", {
        configVersion: 1,
        enabled: false
      }),
      ruleContext
    ),
    patchAlertRule(
      request("/api/alert-rules/alert-rule", "PATCH", {
        configVersion: 1,
        condition: { kind: "availability" },
        outboundOptIn: false
      }),
      ruleContext
    ),
    deleteAlertRule(request("/api/alert-rules/alert-rule", "DELETE", { ignored: true }, localHeaders),
    ruleContext),
    getAlertRules(request("/api/alert-rules?limit=101", "GET"))
  ]);

  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "ALERT_VALIDATION_ERROR");
  }
});

test("alert route errors retain exact lifecycle status classes and bounded envelopes", () => {
  for (const [code, status] of [
    ["ALERT_VALIDATION_ERROR", 400],
    ["ALERT_LOCAL_OPERATOR_REQUIRED", 403],
    ["WATCH_ITEM_NOT_FOUND", 404],
    ["ALERT_RULE_NOT_FOUND", 404],
    ["ALERT_RULE_EXISTS", 409],
    ["ALERT_CONFIG_VERSION_CONFLICT", 409],
    ["ALERT_DELIVERY_IN_FLIGHT", 409],
    ["ALERT_STATE_RETAINED", 409],
    ["ALERT_SUBTYPE_UNSUPPORTED", 422],
    ["ALERT_CONDITION_INVALID", 422],
    ["ALERT_OUTBOUND_OPT_IN_REQUIRED", 422]
  ] as const) {
    const result = buildApiRouteError(new TripWatchError(code, "private detail"), "tripwatch:alert-rules");
    assert.equal(result.status, status);
    assert.deepEqual(result.body, {
      status: "failed",
      checkedAt: result.body.checkedAt,
      source: "tripwatch:alert-rules",
      officialUrl: undefined,
      summary: result.body.summary,
      data: undefined,
      error: result.body.error
    });
  }
});

