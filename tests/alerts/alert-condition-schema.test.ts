import assert from "node:assert/strict";
import test from "node:test";

import {
  AlertConditionValidationError,
  parseAlertCondition
} from "../../lib/validation/alert-rule-schema";

test("condition schemas accept only the exact contract for each alert mode", () => {
  assert.deepEqual(
    parseAlertCondition("flight", "flight_search", {
      kind: "displayed_price_at_or_below",
      maxDisplayedPriceKrw: 1
    }),
    { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 1 }
  );
  assert.deepEqual(
    parseAlertCondition("flight", "flight_compare_month", {
      kind: "date_displayed_price_at_or_below",
      maxDisplayedPriceKrw: 100_000_000
    }),
    { kind: "date_displayed_price_at_or_below", maxDisplayedPriceKrw: 100_000_000 }
  );
  assert.deepEqual(
    parseAlertCondition("express_bus", "express_bus_search", {
      kind: "seats_at_or_above",
      minSeats: 1
    }),
    { kind: "seats_at_or_above", minSeats: 1 }
  );
  assert.deepEqual(
    parseAlertCondition("intercity_bus", "intercity_bus_search", {
      kind: "seats_at_or_above",
      minSeats: 99
    }),
    { kind: "seats_at_or_above", minSeats: 99 }
  );
  assert.deepEqual(parseAlertCondition("ticket", "ticket_seats", { kind: "availability" }), {
    kind: "availability"
  });
  assert.deepEqual(parseAlertCondition("foresttrip", "foresttrip_search", { kind: "availability" }), {
    kind: "availability"
  });
});

test("condition schemas reject extra keys, wrong modes, and invalid thresholds", () => {
  for (const value of [
    { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 0 },
    { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 100_000_001 },
    { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 1.5 },
    { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 1, version: 1 }
  ]) {
    assert.throws(
      () => parseAlertCondition("flight", "flight_search", value),
      (error: unknown) =>
        error instanceof AlertConditionValidationError && error.code === "ALERT_CONDITION_UNSUPPORTED"
    );
  }

  assert.throws(
    () => parseAlertCondition("express_bus", "express_bus_search", { kind: "seats_at_or_above", minSeats: 100 }),
    (error: unknown) =>
      error instanceof AlertConditionValidationError && error.code === "ALERT_CONDITION_UNSUPPORTED"
  );
  assert.throws(
    () => parseAlertCondition("flight", "flight_search", { kind: "availability" }),
    (error: unknown) =>
      error instanceof AlertConditionValidationError && error.code === "ALERT_CONDITION_UNSUPPORTED"
  );
  assert.throws(
    () => parseAlertCondition("ticket", "schedule", { kind: "availability" }),
    (error: unknown) =>
      error instanceof AlertConditionValidationError && error.code === "ALERT_SUBTYPE_UNSUPPORTED"
  );
});
