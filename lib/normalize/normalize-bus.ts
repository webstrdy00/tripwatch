import type { TripWatchStatus } from "@/lib/api-response";
import type { BusSearchInput } from "@/lib/validation/bus-schema";

export type BusKind = "express" | "intercity";
export type BusScheduleQuality = "complete" | "partial";

export type BusQuery = {
  departName: string;
  arriveName: string;
  date: string;
  time: string;
  passengers: number;
};

export type BusSchedule = {
  departTime: string;
  arriveTime?: string;
  grade?: string;
  remainSeats?: number;
  totalSeats?: number;
  fare?: number;
  fareText?: string;
  operator?: string;
  quality: BusScheduleQuality;
};

export type BusSearchData = {
  query: BusQuery;
  schedules: BusSchedule[];
  officialUrl: string;
};

export type NormalizedBusResult = {
  status: Exclude<TripWatchStatus, "failed">;
  checkedAt?: string;
  officialUrl: string;
  summary: string;
  data: BusSearchData;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const digits = value.replace(/[^0-9]/g, "");
    return digits ? Number.parseInt(digits, 10) : undefined;
  }

  return undefined;
}

function normalizeTime(value: unknown): string | undefined {
  const text = stringValue(value);

  if (!text) {
    return undefined;
  }

  const compact = text.replace(/[^0-9]/g, "");

  if (compact.length >= 4) {
    const hour = compact.slice(0, 2);
    const minute = compact.slice(2, 4);

    if (/^([01]\d|2[0-3])$/.test(hour) && /^[0-5]\d$/.test(minute)) {
      return `${hour}:${minute}`;
    }
  }

  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : undefined;
}

function minutesSinceMidnight(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
}

function parseSeatText(value: unknown): Pick<BusSchedule, "remainSeats" | "totalSeats"> {
  const text = stringValue(value);

  if (!text) {
    return {};
  }

  const pair = /(\d+)\s*\/\s*(\d+)/.exec(text);

  if (pair) {
    return {
      remainSeats: Number.parseInt(pair[1], 10),
      totalSeats: Number.parseInt(pair[2], 10)
    };
  }

  const remain = /잔여\s*(\d+)\s*석?/.exec(text) ?? /(\d+)\s*석/.exec(text);

  return remain
    ? {
        remainSeats: Number.parseInt(remain[1], 10)
      }
    : {};
}

function buildBusQuery(input: BusSearchInput): BusQuery {
  return {
    departName: input.departName,
    arriveName: input.arriveName,
    date: input.date,
    time: input.time,
    passengers: input.passengers
  };
}

function qualityFor(schedule: Omit<BusSchedule, "quality">, requiredKeys: Array<keyof Omit<BusSchedule, "quality">>): BusScheduleQuality {
  return requiredKeys.every((key) => schedule[key] !== undefined && schedule[key] !== "") ? "complete" : "partial";
}

function normalizeExpressSchedule(value: unknown): BusSchedule | undefined {
  const row = asRecord(value);
  const departTime = normalizeTime(row.departure_time ?? row.departureTime ?? row.departTime);

  if (!departTime) {
    return undefined;
  }

  const seats = parseSeatText(row.remaining_text ?? row.remainingText);
  const fare = numberValue(row.fare ?? row.adult_fare ?? row.adultFare ?? row.fare_value);
  const schedule: Omit<BusSchedule, "quality"> = {
    departTime,
    arriveTime: normalizeTime(row.arrival_time ?? row.arrivalTime ?? row.arriveTime),
    operator: stringValue(row.company ?? row.operator),
    grade: stringValue(row.bus_class ?? row.busClass ?? row.grade),
    remainSeats: numberValue(row.remaining_seats ?? row.remainingSeats ?? row.remainSeats) ?? seats.remainSeats,
    totalSeats: numberValue(row.total_seats ?? row.totalSeats) ?? seats.totalSeats,
    fare,
    fareText: stringValue(row.fare_text ?? row.fareText ?? row.adult_fare ?? row.adultFare) ?? formatKrw(fare)
  };

  return {
    ...schedule,
    quality: qualityFor(schedule, ["departTime", "grade", "remainSeats"])
  };
}

function normalizeIntercitySchedule(value: unknown): BusSchedule | undefined {
  const row = asRecord(value);
  const departTime = normalizeTime(row.departure_time ?? row.departureTime ?? row.departTime);

  if (!departTime) {
    return undefined;
  }

  const fare = numberValue(row.adult_fare ?? row.adultFare ?? row.fare);
  const schedule: Omit<BusSchedule, "quality"> = {
    departTime,
    arriveTime: normalizeTime(row.arrival_time ?? row.arrivalTime ?? row.arriveTime),
    operator: stringValue(row.company ?? row.operator),
    grade: stringValue(row.bus_class ?? row.busClass ?? row.grade),
    remainSeats: numberValue(row.remaining_seats ?? row.remainingSeats ?? row.remainSeats),
    totalSeats: numberValue(row.total_seats ?? row.totalSeats),
    fare,
    fareText: stringValue(row.adult_fare ?? row.adultFare ?? row.fare_text ?? row.fareText) ?? formatKrw(fare)
  };

  return {
    ...schedule,
    quality: qualityFor(schedule, ["departTime", "operator", "grade", "remainSeats", "totalSeats", "fare"])
  };
}

function schedulesAfterTime(schedules: BusSchedule[], time: string): BusSchedule[] {
  const minimum = minutesSinceMidnight(time);

  return schedules.filter((schedule) => minutesSinceMidnight(schedule.departTime) >= minimum);
}

function isBusSchedule(value: BusSchedule | undefined): value is BusSchedule {
  return Boolean(value);
}

function buildSummary(kind: BusKind, query: BusQuery, schedules: BusSchedule[]): string {
  const label = kind === "express" ? "고속버스" : "시외버스";
  return `${label} ${query.departName} → ${query.arriveName} / ${query.date} ${query.time} 이후 / 배차 ${schedules.length}개`;
}

export function formatKrw(value: number | undefined): string | undefined {
  return typeof value === "number" ? `₩${value.toLocaleString("ko-KR")}` : undefined;
}

export function normalizeExpressBusPayload(payload: unknown, input: BusSearchInput, officialUrl: string): NormalizedBusResult {
  const record = asRecord(payload);
  const schedules = schedulesAfterTime(asArray(record.items).map(normalizeExpressSchedule).filter(isBusSchedule), input.time);
  const data: BusSearchData = {
    query: buildBusQuery(input),
    schedules,
    officialUrl
  };
  const status: NormalizedBusResult["status"] =
    schedules.length === 0 || schedules.some((schedule) => schedule.quality === "partial") ? "partial" : "success";

  return {
    status,
    officialUrl,
    summary: buildSummary("express", data.query, schedules),
    data
  };
}

export function normalizeIntercityBusPayload(payload: unknown, input: BusSearchInput, officialUrl: string): NormalizedBusResult {
  const record = asRecord(payload);
  const schedules = schedulesAfterTime(asArray(record.items).map(normalizeIntercitySchedule).filter(isBusSchedule), input.time);
  const data: BusSearchData = {
    query: buildBusQuery(input),
    schedules,
    officialUrl
  };
  const status: NormalizedBusResult["status"] =
    schedules.length === 0 || schedules.some((schedule) => schedule.quality === "partial") ? "partial" : "success";

  return {
    status,
    officialUrl,
    summary: buildSummary("intercity", data.query, schedules),
    data
  };
}
