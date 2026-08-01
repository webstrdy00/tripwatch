import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBusCondition } from "../../lib/alerts/conditions/bus";
import { evaluateFlightCondition } from "../../lib/alerts/conditions/flight";
import { evaluateForesttripCondition } from "../../lib/alerts/conditions/foresttrip";
import { evaluateTicketCondition } from "../../lib/alerts/conditions/ticket";

const availability = { kind: "availability" };
const belowFlight = { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 100_000 };
const belowMonth = { kind: "date_displayed_price_at_or_below", maxDisplayedPriceKrw: 100_000 };
const seats = { kind: "seats_at_or_above", minSeats: 2 };
const unsupported = { outcome: "unsupported_shape", code: "ALERT_RESULT_UNSUPPORTED_SHAPE" } as const;
const blocked = { outcome: "blocked_source", code: "ALERT_SOURCE_BLOCKED" } as const;

const flightParams = { from: "ICN", to: "NRT", date: "2026-08-01", adults: 1, seat: "economy", mode: "oneway", limit: 5 };
const flightData = (price: number) => ({
  query: { from: "ICN", to: "NRT", date: "2026-08-01" },
  priceSummary: { currency: "KRW" },
  flights: [{ quality: "complete", airlineName: "Jari Air", departureTime: "09:00", arrivalTime: "11:20", price }]
});
const busParams = { departName: "Seoul", arriveName: "Busan", date: "2026-08-01", time: "09:00", passengers: 2 };
const busData = (remainSeats: number, extra: Record<string, unknown> = {}) => ({
  query: { ...busParams },
  schedules: [{ quality: "complete", departTime: "10:00", arriveTime: null, grade: "Premium", operator: null, remainSeats, ...extra }]
});
const ticketData = (remain: number, status: "available" | "sold_out" = remain > 0 ? "available" : "sold_out") => ({
  platform: "interpark",
  id: "show-1",
  seats: [{ date: "2026-08-01", time: "19:30", playSeq: null, grades: [{ grade: "R", remain, status }] }]
});
const ticketParams = { input: "interpark:show-1", mode: "seats" };
const forestParams = { forestName: "Jari Forest", date: "2026-08-01", category: "CABIN" };
const forestData = (capacity: number | null) => ({
  query: { ...forestParams },
  rooms: [{ id: "room-1", roomName: "Pine", date: "2026-08-01", categoryCode: "CABIN", categoryLabel: "Cabin", availability: "available", capacity }]
});

test("flight ordinary uses the exact displayed-price threshold and DTO tuple", () => {
  const equal = evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: flightData(100_000), params: flightParams, condition: belowFlight });
  assert.deepEqual(equal, { outcome: "success_matched", matches: [{ airlineName: "Jari Air", arrivalTime: "11:20", departureTime: "09:00", displayedPriceKrw: 100_000, from: "ICN", to: "NRT" }] });
  assert.deepEqual(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: flightData(100_001), params: flightParams, condition: belowFlight }), { outcome: "success_no_match", matches: [] });
  assert.equal(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: flightData(99_999), params: flightParams, condition: belowFlight }).outcome, "success_matched");
  assert.deepEqual(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: { ...flightData(99_999), flights: [] }, params: flightParams, condition: belowFlight }), { outcome: "success_no_match", matches: [] });
});

test("flight compare-month accepts only successful real dates at the exact threshold", () => {
  const params = { ...flightParams, yearMonth: "2026-08", sample: "weekly" };
  const data = { query: { from: "ICN", to: "NRT", yearMonth: "2026-08" }, priceSummary: { currency: "KRW" }, cheapestDates: [{ status: "success", date: "2026-08-02", minPrice: 100_000 }] };
  assert.deepEqual(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data, params, condition: belowMonth }), { outcome: "success_matched", matches: [{ date: "2026-08-02", displayedPriceKrw: 100_000, from: "ICN", to: "NRT" }] });
  assert.deepEqual(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: { ...data, cheapestDates: [{ status: "failed", date: "2026-08-02", minPrice: 1 }] }, params, condition: belowMonth }), unsupported);
});

test("bus modes preserve nullable optionals and enforce passenger/min-seat relation", () => {
  assert.deepEqual(evaluateBusCondition({ source: "express-bus-booking", status: "success", data: busData(2), params: busParams, condition: seats }), { outcome: "success_matched", matches: [{ arriveName: "Busan", arriveTime: null, date: "2026-08-01", departName: "Seoul", departTime: "10:00", grade: "Premium", operator: null, remainSeats: 2 }] });
  assert.deepEqual(evaluateBusCondition({ source: "express-bus-booking", status: "success", data: busData(1), params: busParams, condition: seats }), { outcome: "success_no_match", matches: [] });
  assert.deepEqual(evaluateBusCondition({ source: "express-bus-booking", status: "success", data: busData(2), params: busParams, condition: { kind: "seats_at_or_above", minSeats: 1 } }), unsupported);
  assert.deepEqual(evaluateBusCondition({ source: "intercity-bus-booking", status: "success", data: busData(2, { operator: "Intercity", totalSeats: 40, fare: 25_000 }), params: busParams, condition: seats }), { outcome: "success_matched", matches: [{ arriveName: "Busan", arriveTime: null, date: "2026-08-01", departName: "Seoul", departTime: "10:00", grade: "Premium", operator: "Intercity", remainSeats: 2 }] });
  assert.deepEqual(evaluateBusCondition({ source: "intercity-bus-booking", status: "success", data: busData(2, { operator: "Intercity", totalSeats: 40 }), params: busParams, condition: seats }), unsupported);
});

test("ticket seats validates availability consistency and rejects schedule mode", () => {
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability", status: "success", data: ticketData(1), params: ticketParams, condition: availability }), { outcome: "success_matched", matches: [{ date: "2026-08-01", eventId: "show-1", grade: "R", platform: "interpark", playSeq: null, remain: 1, time: "19:30" }] });
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability", status: "success", data: ticketData(0), params: ticketParams, condition: availability }), { outcome: "success_no_match", matches: [] });
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability", status: "success", data: ticketData(0, "available"), params: ticketParams, condition: availability }), unsupported);
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability", status: "success", data: ticketData(1), params: { ...ticketParams, mode: "schedule" }, condition: availability }), unsupported);
});

test("Foresttrip availability preserves null capacity and its exact DTO tuple", () => {
  assert.deepEqual(evaluateForesttripCondition({ source: "foresttrip-vacancy", status: "success", data: forestData(null), params: forestParams, condition: availability }), { outcome: "success_matched", matches: [{ capacity: null, categoryCode: "CABIN", categoryLabel: "Cabin", date: "2026-08-01", forestName: "Jari Forest", id: "room-1", roomName: "Pine" }] });
  assert.deepEqual(evaluateForesttripCondition({ source: "foresttrip-vacancy", status: "success", data: { ...forestData(2), rooms: [] }, params: forestParams, condition: availability }), { outcome: "success_no_match", matches: [] });
});

test("nonempty malformed rows and conflicting duplicates reject rather than filtering", () => {
  assert.deepEqual(evaluateFlightCondition({ source: "flight-ticket-search", status: "success", data: { ...flightData(1), flights: [{ quality: "partial" }] }, params: flightParams, condition: belowFlight }), unsupported);
  assert.deepEqual(evaluateBusCondition({ source: "express-bus-booking", status: "success", data: busData(2, { arriveTime: undefined }), params: busParams, condition: seats }), unsupported);
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability", status: "success", data: { ...ticketData(1), seats: [{ date: "2026-08-01", time: "19:30", playSeq: null, grades: [] }] }, params: ticketParams, condition: availability }), unsupported);
  assert.deepEqual(evaluateForesttripCondition({ source: "foresttrip-vacancy", status: "success", data: { ...forestData(2), rooms: [...forestData(2).rooms, { ...forestData(2).rooms[0], capacity: 3 }] }, params: forestParams, condition: availability }), unsupported);
  const duplicate = { ...ticketData(1), seats: [ticketData(1).seats[0], ticketData(1).seats[0]] };
  const equal = evaluateTicketCondition({ source: "ticket-availability", status: "success", data: duplicate, params: ticketParams, condition: availability });
  assert.equal(equal.outcome, "success_matched");
  if (equal.outcome === "success_matched") assert.equal(equal.matches.length, 2);
});

test("only exact sources are eligible", () => {
  assert.deepEqual(evaluateFlightCondition({ source: "Flight-ticket-search", status: "success", data: flightData(1), params: flightParams, condition: belowFlight }), blocked);
  assert.deepEqual(evaluateBusCondition({ source: "mock-express-bus-booking", status: "success", data: busData(2), params: busParams, condition: seats }), blocked);
  assert.deepEqual(evaluateTicketCondition({ source: "ticket-availability-fixture", status: "success", data: ticketData(1), params: ticketParams, condition: availability }), blocked);
  assert.deepEqual(evaluateForesttripCondition({ source: "unknown", status: "success", data: forestData(1), params: forestParams, condition: availability }), blocked);
});
