import assert from "node:assert/strict";
import test from "node:test";

import { CanonicalizationError, canonicalizeAlertFingerprint, compareCanonicalTuples } from "@/lib/alerts/canonicalize";

type FingerprintInput = Parameters<typeof canonicalizeAlertFingerprint>[0];

const GOLDENS = [
  {
    input: { fingerprintVersion: "v1", type: "flight", mode: "flight_search", condition: { kind: "displayed_price_at_or_below", maxDisplayedPriceKrw: 123456 }, matches: [{ airlineName: "A \"line\"\\\ne\u0301", arrivalTime: "12:30", departureTime: "09:00", displayedPriceKrw: 12345, from: "가", to: "가나다" }] },
    json: "{\"condition\":{\"kind\":\"displayed_price_at_or_below\",\"maxDisplayedPriceKrw\":123456},\"fingerprintVersion\":\"v1\",\"matches\":[{\"airlineName\":\"A \\\"line\\\"\\\\\\né\",\"arrivalTime\":\"12:30\",\"departureTime\":\"09:00\",\"displayedPriceKrw\":12345,\"from\":\"가\",\"to\":\"가나다\"}],\"mode\":\"flight_search\",\"type\":\"flight\"}",
    hex: [
      "7b22636f6e646974696f6e223a7b226b696e64223a22646973706c617965645f70726963655f6174",
      "5f6f725f62656c6f77222c226d6178446973706c6179656450726963654b7277223a313233343536",
      "7d2c2266696e6765727072696e7456657273696f6e223a227631222c226d617463686573223a5b7b",
      "226169726c696e654e616d65223a2241205c226c696e655c225c5c5c6ec3a9222c22617272697661",
      "6c54696d65223a2231323a3330222c2264657061727475726554696d65223a2230393a3030222c22",
      "646973706c6179656450726963654b7277223a31323334352c2266726f6d223a22eab080222c2274",
      "6f223a22eab080eb8298eb8ba4227d5d2c226d6f6465223a22666c696768745f736561726368222c",
      "2274797065223a22666c69676874227d"
    ].join(""),
    fingerprint: "v1:984d1178b3ee9a75bddbf60d453b3a7d53062a9154cbc8cebf0298fb10d68aae"
  },
  {
    input: { fingerprintVersion: "v1", type: "flight", mode: "flight_compare_month", condition: { kind: "date_displayed_price_at_or_below", maxDisplayedPriceKrw: 200000 }, matches: [{ date: "2026-08-01", displayedPriceKrw: 100, from: "ICN", to: "NRT" }] },
    json: "{\"condition\":{\"kind\":\"date_displayed_price_at_or_below\",\"maxDisplayedPriceKrw\":200000},\"fingerprintVersion\":\"v1\",\"matches\":[{\"date\":\"2026-08-01\",\"displayedPriceKrw\":100,\"from\":\"ICN\",\"to\":\"NRT\"}],\"mode\":\"flight_compare_month\",\"type\":\"flight\"}",
    hex: "7b22636f6e646974696f6e223a7b226b696e64223a22646174655f646973706c617965645f70726963655f61745f6f725f62656c6f77222c226d6178446973706c6179656450726963654b7277223a3230303030307d2c2266696e6765727072696e7456657273696f6e223a227631222c226d617463686573223a5b7b2264617465223a22323032362d30382d3031222c22646973706c6179656450726963654b7277223a3130302c2266726f6d223a2249434e222c22746f223a224e5254227d5d2c226d6f6465223a22666c696768745f636f6d706172655f6d6f6e7468222c2274797065223a22666c69676874227d",
    fingerprint: "v1:51ab69ae98b239b7881ffc25bbe7ef9963821a25ad9aa22c7704cf045639a408"
  },
  {
    input: { fingerprintVersion: "v1", type: "express_bus", mode: "express_bus_search", condition: { kind: "seats_at_or_above", minSeats: 2 }, matches: [{ arriveName: "부산", arriveTime: null, date: "2026-08-01", departName: "서울", departTime: "08:00", grade: "우등", operator: null, remainSeats: 10 }] },
    json: "{\"condition\":{\"kind\":\"seats_at_or_above\",\"minSeats\":2},\"fingerprintVersion\":\"v1\",\"matches\":[{\"arriveName\":\"부산\",\"arriveTime\":null,\"date\":\"2026-08-01\",\"departName\":\"서울\",\"departTime\":\"08:00\",\"grade\":\"우등\",\"operator\":null,\"remainSeats\":10}],\"mode\":\"express_bus_search\",\"type\":\"express_bus\"}",
    hex: "7b22636f6e646974696f6e223a7b226b696e64223a2273656174735f61745f6f725f61626f7665222c226d696e5365617473223a327d2c2266696e6765727072696e7456657273696f6e223a227631222c226d617463686573223a5b7b226172726976654e616d65223a22ebb680ec82b0222c2261727269766554696d65223a6e756c6c2c2264617465223a22323032362d30382d3031222c226465706172744e616d65223a22ec849cec9ab8222c2264657061727454696d65223a2230383a3030222c226772616465223a22ec9ab0eb93b1222c226f70657261746f72223a6e756c6c2c2272656d61696e5365617473223a31307d5d2c226d6f6465223a22657870726573735f6275735f736561726368222c2274797065223a22657870726573735f627573227d",
    fingerprint: "v1:370166afc82ff041ad26f96ded1f302d8e108c056257390b579dfe475408935d"
  },
  {
    input: { fingerprintVersion: "v1", type: "intercity_bus", mode: "intercity_bus_search", condition: { kind: "seats_at_or_above", minSeats: 3 }, matches: [{ arriveName: "춘천", arriveTime: "10:00", date: "2026-08-02", departName: "서울", departTime: "08:30", grade: "일반", operator: "시외", remainSeats: 2 }] },
    json: "{\"condition\":{\"kind\":\"seats_at_or_above\",\"minSeats\":3},\"fingerprintVersion\":\"v1\",\"matches\":[{\"arriveName\":\"춘천\",\"arriveTime\":\"10:00\",\"date\":\"2026-08-02\",\"departName\":\"서울\",\"departTime\":\"08:30\",\"grade\":\"일반\",\"operator\":\"시외\",\"remainSeats\":2}],\"mode\":\"intercity_bus_search\",\"type\":\"intercity_bus\"}",
    hex: [
      "7b22636f6e646974696f6e223a7b226b696e64223a2273656174735f61745f6f725f61626f766522",
      "2c226d696e5365617473223a337d2c2266696e6765727072696e7456657273696f6e223a22763122",
      "2c226d617463686573223a5b7b226172726976654e616d65223a22ecb698ecb29c222c2261727269",
      "766554696d65223a2231303a3030222c2264617465223a22323032362d30382d3032222c22646570",
      "6172744e616d65223a22ec849cec9ab8222c2264657061727454696d65223a2230383a3330222c22",
      "6772616465223a22ec9dbcebb098222c226f70657261746f72223a22ec8b9cec99b8222c2272656d",
      "61696e5365617473223a327d5d2c226d6f6465223a22696e746572636974795f6275735f73656172",
      "6368222c2274797065223a22696e746572636974795f627573227d"
    ].join(""),
    fingerprint: "v1:0b8d89da2d5e4da684aa5a8ec3e8c260df3e513b243781f3b25065863bf0b537"
  },
  {
    input: { fingerprintVersion: "v1", type: "ticket", mode: "ticket_seats", condition: { kind: "availability" }, matches: [{ date: "2026-08-03", eventId: "공연", grade: "R", platform: "yes24", playSeq: null, remain: 10, time: "19:00" }] },
    json: "{\"condition\":{\"kind\":\"availability\"},\"fingerprintVersion\":\"v1\",\"matches\":[{\"date\":\"2026-08-03\",\"eventId\":\"공연\",\"grade\":\"R\",\"platform\":\"yes24\",\"playSeq\":null,\"remain\":10,\"time\":\"19:00\"}],\"mode\":\"ticket_seats\",\"type\":\"ticket\"}",
    hex: "7b22636f6e646974696f6e223a7b226b696e64223a22617661696c6162696c697479227d2c2266696e6765727072696e7456657273696f6e223a227631222c226d617463686573223a5b7b2264617465223a22323032362d30382d3033222c226576656e744964223a22eab3b5ec97b0222c226772616465223a2252222c22706c6174666f726d223a227965733234222c22706c6179536571223a6e756c6c2c2272656d61696e223a31302c2274696d65223a2231393a3030227d5d2c226d6f6465223a227469636b65745f7365617473222c2274797065223a227469636b6574227d",
    fingerprint: "v1:3afbd35dc2b15987a2a239781c58ee7b2cc761950d506b05a4f412529e0394be"
  },
  {
    input: { fingerprintVersion: "v1", type: "foresttrip", mode: "foresttrip_search", condition: { kind: "availability" }, matches: [{ capacity: null, categoryCode: "C", categoryLabel: "숲", date: "2026-08-04", forestName: "국립", id: "room-1", roomName: "솔" }] },
    json: "{\"condition\":{\"kind\":\"availability\"},\"fingerprintVersion\":\"v1\",\"matches\":[{\"capacity\":null,\"categoryCode\":\"C\",\"categoryLabel\":\"숲\",\"date\":\"2026-08-04\",\"forestName\":\"국립\",\"id\":\"room-1\",\"roomName\":\"솔\"}],\"mode\":\"foresttrip_search\",\"type\":\"foresttrip\"}",
    hex: [
      "7b22636f6e646974696f6e223a7b226b696e64223a22617661696c6162696c697479227d2c226669",
      "6e6765727072696e7456657273696f6e223a227631222c226d617463686573223a5b7b2263617061",
      "63697479223a6e756c6c2c2263617465676f7279436f6465223a2243222c2263617465676f72794c",
      "6162656c223a22ec88b2222c2264617465223a22323032362d30382d3034222c22666f726573744e",
      "616d65223a22eab5adeba6bd222c226964223a22726f6f6d2d31222c22726f6f6d4e616d65223a22",
      "ec8694227d5d2c226d6f6465223a22666f72657374747269705f736561726368222c227479706522",
      "3a22666f7265737474726970227d"
    ].join(""),
    fingerprint: "v1:d6bd77bf957b9ddc9e92aa33afbddfa8b161cb54299ea9ed4641f9f03633271c"
  }
] as const;

const ticketInput = (): FingerprintInput => ({
  fingerprintVersion: "v1",
  type: "ticket",
  mode: "ticket_seats",
  condition: { kind: "availability" },
  matches: [{ date: "2026-08-01", eventId: "event", grade: "R", platform: "yes24", playSeq: null, remain: 2, time: "19:00" }]
});

test("canonical v1 has independent JSON, UTF-8 hex, and SHA-256 goldens for every mode", () => {
  for (const golden of GOLDENS) {
    const result = canonicalizeAlertFingerprint(golden.input as FingerprintInput);
    assert.equal(result.canonicalJson, golden.json);
    assert.equal(Buffer.from(result.canonicalBytes).toString("hex"), golden.hex);
    assert.equal(result.fingerprint, golden.fingerprint);
  }
});

test("canonicalization orders UTF-8 strings, nulls, and numeric values; it deduplicates only equivalent rows", () => {
  assert.ok(compareCanonicalTuples(["가"], ["가나다"]) < 0);
  assert.ok(compareCanonicalTuples(["é"], ["z"]) > 0);
  assert.ok(compareCanonicalTuples([null], ["a"]) < 0);
  assert.ok(compareCanonicalTuples([2], [10]) < 0);
  assert.ok(compareCanonicalTuples([10], [100]) < 0);

  const input = ticketInput();
  input.matches = [
    { ...input.matches[0], grade: "z", remain: 100 },
    { ...input.matches[0], grade: "e\u0301", remain: 10 },
    { ...input.matches[0], grade: "aa", remain: 2 },
    { ...input.matches[0] }
  ];
  const result = canonicalizeAlertFingerprint(input);
  assert.deepEqual(result.matches.map((match) => (match as { grade: string }).grade), ["R", "aa", "z", "é"]);

  const conflicting = ticketInput();
  conflicting.matches.push({ ...conflicting.matches[0], remain: 3 });
  assert.throws(() => canonicalizeAlertFingerprint(conflicting), CanonicalizationError);
});

test("canonicalization is independent of insertion order and locale APIs", () => {
  const input = ticketInput();
  input.matches = [
    { remain: 2, time: "19:00", platform: "yes24", grade: "R", eventId: "event", playSeq: null, date: "2026-08-01" },
    { time: "18:00", remain: 10, playSeq: "2", grade: "A", date: "2026-08-01", eventId: "event", platform: "yes24" }
  ];
  const localeCompare = String.prototype.localeCompare;
  const collator = Intl.Collator;
  Object.defineProperty(String.prototype, "localeCompare", { configurable: true, value: () => -1 });
  Object.defineProperty(Intl, "Collator", { configurable: true, value: class { compare = () => -1; } });
  try {
    assert.deepEqual(canonicalizeAlertFingerprint(input).matches.map((match) => (match as { grade: string }).grade), ["A", "R"]);
  } finally {
    Object.defineProperty(String.prototype, "localeCompare", { configurable: true, value: localeCompare });
    Object.defineProperty(Intl, "Collator", { configurable: true, value: collator });
  }
});

test("canonicalization preserves declared null optionals and fails closed on unsupported properties", () => {
  const nfd = ticketInput();
  nfd.matches[0].grade = "e\u0301";
  assert.equal((canonicalizeAlertFingerprint(nfd).matches[0] as { grade: string }).grade, "é");

  const invalidKey = ticketInput() as unknown as { matches: Array<Record<string, unknown>> };
  invalidKey.matches[0]["e\u0301"] = "x";
  assert.throws(() => canonicalizeAlertFingerprint(invalidKey as FingerprintInput), CanonicalizationError);

  for (const mutate of [
    (input: FingerprintInput) => { (input.matches[0] as Record<string, unknown>).grade = undefined; },
    (input: FingerprintInput) => { Object.defineProperty(input.matches[0], Symbol("hidden"), { enumerable: true, value: "x" }); },
    (input: FingerprintInput) => { Object.defineProperty(input.matches[0], "hidden", { enumerable: false, value: "x" }); },
    (input: FingerprintInput) => { Object.defineProperty(input.matches, "extra", { enumerable: true, value: "x" }); },
    (input: FingerprintInput) => { input.matches = new Array(1) as typeof input.matches; },
    (input: FingerprintInput) => { Object.defineProperty(input.matches, "0", { enumerable: true, get: () => input.matches[0] }); },
    (input: FingerprintInput) => { (input.matches[0] as Record<string, unknown>).grade = { nested: [null] }; },
    (input: FingerprintInput) => { (input.matches[0] as Record<string, unknown>).grade = "\uD800"; },
    (input: FingerprintInput) => { const match = input.matches[0] as Record<string, unknown>; match.grade = match; },
    (input: FingerprintInput) => { (input.condition as Record<string, unknown>).version = "v1"; }
  ]) {
    const input = ticketInput();
    mutate(input);
    assert.throws(() => canonicalizeAlertFingerprint(input), CanonicalizationError);
  }
});

test("canonicalization rejects accessors without reading them and descriptor-instability proxies", () => {
  let getterRead = false;
  const accessor = ticketInput();
  Object.defineProperty(accessor.matches[0], "grade", { enumerable: true, get() { getterRead = true; return "R"; } });
  assert.throws(() => canonicalizeAlertFingerprint(accessor), CanonicalizationError);
  assert.equal(getterRead, false);

  const target = ticketInput();
  let inspected = false;
  const unstable = new Proxy(target, {
    ownKeys(value) {
      inspected = true;
      return Reflect.ownKeys(value);
    },
    getOwnPropertyDescriptor(value, key) {
      if (inspected && key === "mode") return undefined;
      return Reflect.getOwnPropertyDescriptor(value, key);
    }
  });
  assert.throws(() => canonicalizeAlertFingerprint(unstable), CanonicalizationError);
});