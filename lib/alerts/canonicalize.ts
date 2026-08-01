import { createHash } from "node:crypto";

import type { AlertCondition, AlertFingerprintInput, AlertMatch, AlertMode, CanonicalAlertFingerprint } from "@/lib/alerts/types";

type CanonicalScalar = string | number | boolean | null;
type CanonicalValue = CanonicalScalar | CanonicalValue[] | { [key: string]: CanonicalValue };
type Tuple = readonly CanonicalScalar[];

type MatchScalarKind = "string" | "number" | "nullableString" | "nullableNumber";
type MatchSpec = Readonly<{
  keys: readonly string[];
  kinds: Readonly<Record<string, MatchScalarKind>>;
  identity: readonly string[];
  value: readonly string[];
}>;

const MATCH_SPECS: Readonly<Record<AlertMode, MatchSpec>> = {
  flight_search: {
    keys: ["airlineName", "arrivalTime", "departureTime", "displayedPriceKrw", "from", "to"],
    kinds: { airlineName: "string", arrivalTime: "string", departureTime: "string", displayedPriceKrw: "number", from: "string", to: "string" },
    identity: ["from", "to", "departureTime", "arrivalTime", "airlineName"],
    value: ["displayedPriceKrw"]
  },
  flight_compare_month: {
    keys: ["date", "displayedPriceKrw", "from", "to"],
    kinds: { date: "string", displayedPriceKrw: "number", from: "string", to: "string" },
    identity: ["from", "to", "date"],
    value: ["displayedPriceKrw"]
  },
  express_bus_search: {
    keys: ["arriveName", "arriveTime", "date", "departName", "departTime", "grade", "operator", "remainSeats"],
    kinds: { arriveName: "string", arriveTime: "nullableString", date: "string", departName: "string", departTime: "string", grade: "string", operator: "nullableString", remainSeats: "number" },
    identity: ["departName", "arriveName", "date", "departTime", "arriveTime", "grade", "operator"],
    value: ["remainSeats"]
  },
  intercity_bus_search: {
    keys: ["arriveName", "arriveTime", "date", "departName", "departTime", "grade", "operator", "remainSeats"],
    kinds: { arriveName: "string", arriveTime: "nullableString", date: "string", departName: "string", departTime: "string", grade: "string", operator: "nullableString", remainSeats: "number" },
    identity: ["departName", "arriveName", "date", "departTime", "arriveTime", "grade", "operator"],
    value: ["remainSeats"]
  },
  ticket_seats: {
    keys: ["date", "eventId", "grade", "platform", "playSeq", "remain", "time"],
    kinds: { date: "string", eventId: "string", grade: "string", platform: "string", playSeq: "nullableString", remain: "number", time: "string" },
    identity: ["platform", "eventId", "date", "time", "playSeq", "grade"],
    value: ["remain"]
  },
  foresttrip_search: {
    keys: ["capacity", "categoryCode", "categoryLabel", "date", "forestName", "id", "roomName"],
    kinds: { capacity: "nullableNumber", categoryCode: "string", categoryLabel: "string", date: "string", forestName: "string", id: "string", roomName: "string" },
    identity: ["forestName", "date", "categoryCode", "id"],
    value: ["roomName", "categoryLabel", "capacity"]
  }
};

const CONDITION_KEYS: Readonly<Record<AlertCondition["kind"], readonly string[]>> = {
  displayed_price_at_or_below: ["kind", "maxDisplayedPriceKrw"],
  date_displayed_price_at_or_below: ["kind", "maxDisplayedPriceKrw"],
  seats_at_or_above: ["kind", "minSeats"],
  availability: ["kind"]
};

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function reject(message: string): never {
  throw new CanonicalizationError(message);
}

function isUnicodeScalarString(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

function normalizeString(value: string): string {
  if (!isUnicodeScalarString(value)) {
    return reject("Strings must contain only Unicode scalar values.");
  }
  return value.normalize("NFC");
}

function compareStrings(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareScalar(left: CanonicalScalar, right: CanonicalScalar): number {
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? -1 : 1;
  }
  if (typeof left !== typeof right) {
    return reject("Tuple slots cannot contain mixed non-null types.");
  }
  if (typeof left === "string" && typeof right === "string") return compareStrings(normalizeString(left), normalizeString(right));
  if (typeof left === "number" && typeof right === "number") {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return reject("Tuple numbers must be safe integers.");
    return (Object.is(left, -0) ? 0 : left) - (Object.is(right, -0) ? 0 : right);
  }
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return reject("Unsupported tuple scalar.");
}

export function compareCanonicalTuples(left: Tuple, right: Tuple): number {
  if (left.length !== right.length) return reject("Tuples must have equal length.");
  for (let index = 0; index < left.length; index += 1) {
    const comparison = compareScalar(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function ownDataKeys(value: object): string[] {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return reject("Unable to inspect object keys.");
  }
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== "string") return reject("Symbol properties are not canonical.");
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return reject("Unable to inspect object descriptors.");
    }
    if (!descriptor || !descriptor.enumerable) return reject("Non-enumerable properties are not canonical.");
    if (!("value" in descriptor)) return reject("Accessor properties are not canonical.");
    if (!isUnicodeScalarString(key) || key !== key.normalize("NFC")) return reject("Object keys must already be NFC Unicode scalar strings.");
    stringKeys.push(key);
  }
  return stringKeys;
}

function requireExactKeys(value: object, expected: readonly string[]): void {
  const actual = ownDataKeys(value).sort(compareStrings);
  const wanted = [...expected].sort(compareStrings);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    reject("Object shape is not canonical for this alert mode.");
  }
}

function admit(value: unknown, stack: Set<object>): CanonicalValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return reject("Only safe integer numbers are canonical.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") return reject("Unsupported canonical value.");
  if (stack.has(value)) return reject("Cycles are not canonical.");

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return reject("Unsupported array prototype.");
    stack.add(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lengthDescriptor ||
      lengthDescriptor.enumerable ||
      !lengthDescriptor.writable ||
      lengthDescriptor.configurable ||
      !("value" in lengthDescriptor) ||
      lengthDescriptor.value !== value.length
    ) {
      return reject("Array length must be standard.");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) return reject("Arrays must be dense and have no extra properties.");
    const result: CanonicalValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return reject("Arrays must contain enumerable data elements.");
      result.push(admit(descriptor.value, stack));
    }
    stack.delete(value);
    return result;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) return reject("Unsupported object prototype.");
  stack.add(value);
  const keys = ownDataKeys(value).sort(compareStrings);
  const result: { [key: string]: CanonicalValue } = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return reject("Object descriptor changed during admission.");
    result[key] = admit(descriptor.value, stack);
  }
  stack.delete(value);
  return result;
}

function admittedMatch(value: AlertMatch, spec: MatchSpec): { match: AlertMatch; identity: Tuple; value: Tuple; order: Tuple } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("Matches must be ordinary objects.");
  requireExactKeys(value, spec.keys);
  const admitted = admit(value, new Set<object>());
  if (!admitted || Array.isArray(admitted) || typeof admitted !== "object") return reject("Invalid canonical match.");
  const match = admitted as AlertMatch;
  for (const key of spec.keys) {
    const scalar = (match as Record<string, CanonicalScalar>)[key];
    const kind = spec.kinds[key];
    const isValid =
      (kind === "string" && typeof scalar === "string") ||
      (kind === "number" && typeof scalar === "number") ||
      (kind === "nullableString" && (scalar === null || typeof scalar === "string")) ||
      (kind === "nullableNumber" && (scalar === null || typeof scalar === "number"));
    if (!isValid) return reject("Match field type is invalid.");
  }
  const tupleFor = (keys: readonly string[]): Tuple => keys.map((key) => {
    const scalar = (match as Record<string, CanonicalScalar>)[key];
    if (scalar === undefined || (typeof scalar === "object" && scalar !== null)) return reject("Match tuple values must be scalar.");
    return scalar;
  });
  return { match, identity: tupleFor(spec.identity), value: tupleFor(spec.value), order: tupleFor([...spec.identity, ...spec.value]) };
}

function validateCondition(condition: AlertCondition, mode: AlertMode): AlertCondition {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return reject("Condition must be an ordinary object.");
  const kindDescriptor = Object.getOwnPropertyDescriptor(condition, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor) || typeof kindDescriptor.value !== "string") return reject("Condition kind is invalid.");
  const keys = CONDITION_KEYS[kindDescriptor.value as AlertCondition["kind"]];
  if (!keys) return reject("Condition kind is invalid.");
  requireExactKeys(condition, keys);
  const admitted = admit(condition, new Set<object>());
  if (!admitted || Array.isArray(admitted) || typeof admitted !== "object") return reject("Invalid condition.");
  const result = admitted as AlertCondition;
  const threshold = "maxDisplayedPriceKrw" in result ? result.maxDisplayedPriceKrw : "minSeats" in result ? result.minSeats : undefined;
  if (
    threshold !== undefined &&
    (!Number.isSafeInteger(threshold) ||
      threshold < 1 ||
      threshold > (result.kind === "seats_at_or_above" ? 99 : 100000000))
  ) {
    reject("Condition threshold is invalid.");
  }
  if ((mode === "flight_search" && result.kind !== "displayed_price_at_or_below") ||
      (mode === "flight_compare_month" && result.kind !== "date_displayed_price_at_or_below") ||
      ((mode === "express_bus_search" || mode === "intercity_bus_search") && result.kind !== "seats_at_or_above") ||
      ((mode === "ticket_seats" || mode === "foresttrip_search") && result.kind !== "availability")) {
    reject("Condition kind is invalid for alert mode.");
  }
  return result;
}

function validateTypeAndMode(input: AlertFingerprintInput): void {
  const expectedType: Record<AlertMode, AlertFingerprintInput["type"]> = {
    flight_search: "flight",
    flight_compare_month: "flight",
    express_bus_search: "express_bus",
    intercity_bus_search: "intercity_bus",
    ticket_seats: "ticket",
    foresttrip_search: "foresttrip"
  };
  if (expectedType[input.mode] !== input.type) reject("Alert type is invalid for alert mode.");
}

export function canonicalizeAlertFingerprint(input: AlertFingerprintInput): CanonicalAlertFingerprint {
  if (!input || typeof input !== "object" || Array.isArray(input)) return reject("Fingerprint input must be an ordinary object.");
  requireExactKeys(input, ["fingerprintVersion", "type", "mode", "condition", "matches"]);
  const admittedInput = admit(input, new Set<object>()) as AlertFingerprintInput;
  if (admittedInput.fingerprintVersion !== "v1" || !(admittedInput.mode in MATCH_SPECS)) {
    return reject("Fingerprint version or mode is invalid.");
  }
  validateTypeAndMode(admittedInput);
  const condition = validateCondition(admittedInput.condition, admittedInput.mode);
  if (!Array.isArray(admittedInput.matches)) return reject("Matches must be an array.");

  const spec = MATCH_SPECS[admittedInput.mode];
  const entries = admittedInput.matches.map((match) => admittedMatch(match, spec));
  entries.sort((left, right) => compareCanonicalTuples(left.order, right.order));
  const matches: AlertMatch[] = [];
  for (const entry of entries) {
    const previous = matches.length === 0 ? undefined : admittedMatch(matches[matches.length - 1], spec);
    if (previous && compareCanonicalTuples(previous.identity, entry.identity) === 0) {
      if (compareCanonicalTuples(previous.value, entry.value) !== 0) reject("Conflicting duplicate match identity.");
      continue;
    }
    matches.push(entry.match);
  }

  const admittedEnvelope = admit(
    { fingerprintVersion: "v1", type: admittedInput.type, mode: admittedInput.mode, condition, matches },
    new Set<object>()
  );
  const canonicalJson = JSON.stringify(admittedEnvelope);
  const canonicalBytes = new Uint8Array(Buffer.from(canonicalJson, "utf8"));
  const fingerprint = `v1:${createHash("sha256").update(canonicalBytes).digest("hex")}` as const;
  return { canonicalJson, canonicalBytes, fingerprint, matches };
}
