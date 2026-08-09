import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { apiErrorStatus } from "../../lib/api-error-status";
import { buildApiRouteError, toBoundedApiError } from "../../lib/api-route-error";
import { TripWatchError } from "../../lib/errors";
import { assertLocalOperatorRequest, withLocalOperatorRequest } from "../../lib/security/local-operator";

function request(method: string, authority: string, headers: HeadersInit): Request {
  return new Request(`http://${authority}/api/alerts`, { method, headers });
}

function trustedHeaders(authority: string): HeadersInit {
  return {
    host: authority,
    origin: `http://${authority}`,
    "sec-fetch-site": "same-origin"
  };
}

test("local operator guard accepts self-consistent 127 and localhost authorities on any port", () => {
  for (const authority of ["127.0.0.1:3000", "localhost:3000", "127.0.0.1:43127", "localhost:43127"]) {
    assert.doesNotThrow(() => assertLocalOperatorRequest(request("GET", authority, { host: authority })));
    assert.doesNotThrow(() =>
      assertLocalOperatorRequest(
        request("GET", authority, { host: authority, "x-forwarded-host": "attacker.example" })
      )
    );
  }
});

test("local operator guard rejects mixed, non-http, and non-allowlisted authorities", () => {
  const invalidRequests = [
    request("GET", "127.0.0.1:3000", { host: "localhost:3000" }),
    request("GET", "localhost:3000", { host: "127.0.0.1:3000" }),
    request("GET", "127.0.0.1:3000", { host: "127.0.0.1" }),
    request("GET", "127.0.0.1:3000", {
      host: "attacker.example",
      "x-forwarded-host": "127.0.0.1:3000"
    }),
    new Request("https://127.0.0.1:3000/api/alerts", { headers: { host: "127.0.0.1:3000" } }),
    new Request("http://127.0.0.2:3000/api/alerts", { headers: { host: "127.0.0.2:3000" } }),
    new Request("http://localhost.:3000/api/alerts", { headers: { host: "localhost.:3000" } }),
    new Request("http://sub.localhost:3000/api/alerts", { headers: { host: "sub.localhost:3000" } })
  ];

  for (const invalidRequest of invalidRequests) {
    assert.throws(
      () => assertLocalOperatorRequest(invalidRequest),
      (error: unknown) => error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED"
    );
  }
});
test("local operator guard rejects a plain Request with a forged Next.js nextUrl property", () => {
  const forgedRequest = Object.assign(
    request("GET", "localhost:43127", { host: "127.0.0.1:43127" }),
    { nextUrl: new URL("http://localhost:43127/api/alerts") }
  );

  assert.throws(
    () => assertLocalOperatorRequest(forgedRequest),
    (error: unknown) => error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED"
  );
});

test("local operator guard accepts only genuine bounded NextRequest localhost reconstruction", () => {
  for (const method of ["GET", "POST"]) {
    const headers = method === "POST"
      ? trustedHeaders("127.0.0.1:43127")
      : { host: "127.0.0.1:43127" };
    const reconstructedRequest = new NextRequest("http://localhost:43127/api/alerts", { method, headers });

    assert.doesNotThrow(() => assertLocalOperatorRequest(reconstructedRequest));
  }
});

test("mutating local operator requests require exact self-origin before callbacks", async () => {
  let callbacks = 0;

  for (const authority of ["127.0.0.1:3000", "localhost:3000", "127.0.0.1:43127", "localhost:43127"]) {
    const expected = callbacks + 1;
    assert.equal(
      await withLocalOperatorRequest(request("POST", authority, trustedHeaders(authority)), () => ++callbacks),
      expected
    );
  }

  const invalidRequests = [
    request("POST", "127.0.0.1:3000", {
      host: "127.0.0.1:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin"
    }),
    request("POST", "localhost:3000", {
      host: "localhost:3000",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin"
    }),
    request("POST", "127.0.0.1:3000", {
      host: "127.0.0.1:3000",
      "sec-fetch-site": "same-origin"
    }),
    request("POST", "localhost:3000", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "cross-site"
    }),
    request("POST", "127.0.0.1:3000", {
      host: "attacker.example",
      origin: "http://127.0.0.1:3000",
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "127.0.0.1:3000"
    })
  ];

  for (const invalidRequest of invalidRequests) {
    await assert.rejects(
      withLocalOperatorRequest(invalidRequest, () => ++callbacks),
      (error: unknown) => error instanceof TripWatchError && error.code === "ALERT_LOCAL_OPERATOR_REQUIRED"
    );
  }

  assert.equal(callbacks, 4);
});

test("shared error statuses cover the stable HTTP taxonomy", () => {
  assert.equal(apiErrorStatus(new TripWatchError("ALERT_VALIDATION_ERROR", "invalid")), 400);
  assert.equal(apiErrorStatus(new TripWatchError("ALERT_LOCAL_OPERATOR_REQUIRED", "denied")), 403);
  assert.equal(apiErrorStatus({ code: "WATCH_ITEM_NOT_FOUND" }), 404);
  assert.equal(apiErrorStatus({ code: "WATCH_ITEM_TYPE_MISMATCH" }), 409);
  assert.equal(apiErrorStatus({ code: "ALERT_CONFIG_VERSION_CONFLICT" }), 409);
  assert.equal(apiErrorStatus({ code: "ALERT_SUBTYPE_UNSUPPORTED" }), 422);
  assert.equal(apiErrorStatus({ code: "FAILED_RERUN_COOLDOWN" }), 429);
  assert.equal(apiErrorStatus(new TripWatchError("HELPER_FAILED", "provider failed")), 502);
  assert.equal(apiErrorStatus(new TripWatchError("HELPER_TIMEOUT", "provider timeout")), 504);
  assert.equal(apiErrorStatus(new TripWatchError("NOT_IMPLEMENTED", "not implemented")), 501);
  assert.equal(apiErrorStatus(new TripWatchError("HELPER_TERMINATION_FAILED", "cleanup failed")), 500);
});

test("route errors expose a bounded failed envelope without causes, raw output, or secrets", () => {
  const error = new TripWatchError("ALERT_TRANSPORT_FAILED", "stderr: token=super-secret", {
    raw: "stderr: token=super-secret",
    cause: new Error("super-secret")
  });
  const routeError = buildApiRouteError(error, "alerts");

  assert.equal(routeError.status, 502);
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
