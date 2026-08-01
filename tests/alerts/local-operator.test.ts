import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorStatus } from "../../lib/api-error-status";
import { buildApiRouteError, toBoundedApiError } from "../../lib/api-route-error";
import { TripWatchError } from "../../lib/errors";
import { assertLocalOperatorRequest, withLocalOperatorRequest } from "../../lib/security/local-operator";

function request(method: string, headers: HeadersInit): Request {
  return new Request("http://127.0.0.1:3000/api/alerts", { method, headers });
}

test("local operator guard accepts only the exact loopback host for GET", () => {
  assert.doesNotThrow(() => assertLocalOperatorRequest(request("GET", { host: "127.0.0.1:3000" })));
  assert.doesNotThrow(() =>
    assertLocalOperatorRequest(
      request("GET", { host: "127.0.0.1:3000", "x-forwarded-host": "attacker.example" })
    )
  );

  const invalidHeaders: HeadersInit[] = [
    { host: "localhost:3000" },
    { host: "127.0.0.1" },
    { host: "attacker.example", "x-forwarded-host": "127.0.0.1:3000" }
  ];
  for (const headers of invalidHeaders) {
    assert.throws(
      () => assertLocalOperatorRequest(request("GET", headers)),
      (error: unknown) => error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED"
    );
  }
});

test("mutating local operator requests require exact origin and fetch site before callbacks", async () => {
  const trustedHeaders = {
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    "sec-fetch-site": "same-origin"
  };
  let callbacks = 0;

  assert.equal(await withLocalOperatorRequest(request("POST", trustedHeaders), () => ++callbacks), 1);
  const invalidHeaders: HeadersInit[] = [
    { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" },
    { host: "127.0.0.1:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" }
  ];
  for (const headers of invalidHeaders) {
    await assert.rejects(
      withLocalOperatorRequest(request("POST", headers), () => ++callbacks),
      (error: unknown) => error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED"
    );
  }
  assert.equal(
    await withLocalOperatorRequest(
      request("POST", { ...trustedHeaders, "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" }),
      () => ++callbacks
    ),
    2
  );
  assert.equal(callbacks, 2);
});

test("alert error statuses classify the shared stable codes", () => {
  assert.equal(apiErrorStatus(new TripWatchError("ALERT_VALIDATION_ERROR", "invalid")), 400);
  assert.equal(apiErrorStatus(new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "denied")), 403);
  assert.equal(apiErrorStatus({ code: "ALERT_RULE_NOT_FOUND" }), 404);
  assert.equal(apiErrorStatus({ code: "ALERT_CONFIG_VERSION_CONFLICT" }), 409);
  assert.equal(apiErrorStatus({ code: "ALERT_DELIVERY_IN_FLIGHT" }), 409);
  assert.equal(apiErrorStatus({ code: "ALERT_STATE_RETAINED" }), 409);
  assert.equal(apiErrorStatus({ code: "ALERT_SUBTYPE_UNSUPPORTED" }), 422);
  assert.equal(apiErrorStatus({ code: "ALERT_CONDITION_INVALID" }), 422);
  assert.equal(apiErrorStatus(new TripWatchError("HELPER_TIMEOUT", "provider timeout")), 500);
});

test("route errors expose a bounded failed envelope without causes, raw output, or secrets", () => {
  const error = new TripWatchError("ALERT_TRANSPORT_FAILED", "stderr: token=super-secret", {
    raw: "stderr: token=super-secret",
    cause: new Error("super-secret")
  });
  const routeError = buildApiRouteError(error, "alerts");

  assert.equal(routeError.status, 500);
  assert.equal(routeError.body.status, "failed");
  assert.deepEqual(routeError.body.error, {
    code: "ALERT_TRANSPORT_FAILED",
    message: "요청을 처리하지 못했습니다."
  });
  assert.equal(JSON.stringify(routeError.body).includes("super-secret"), false);
  assert.deepEqual(toBoundedApiError(new Error("stderr: super-secret")), {
    code: "UNKNOWN_ERROR",
    message: "요청을 처리하지 못했습니다."
  });
  assert.deepEqual(toBoundedApiError({ code: "stderr: super-secret" }), {
    code: "UNKNOWN_ERROR",
    message: "요청을 처리하지 못했습니다."
  });
});
