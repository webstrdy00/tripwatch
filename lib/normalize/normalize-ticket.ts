import type { TripWatchStatus } from "@/lib/api-response";
import type { TicketPlatform } from "@/lib/validation/common-schema";
import type { ParsedTicketInput } from "@/lib/validation/ticket-schema";

export type TicketPerformance = {
  date: string;
  time: string;
  playSeq?: string;
  title?: string;
  rawLabel?: string;
};

export type TicketScheduleData = {
  platform: TicketPlatform;
  id: string;
  performances: TicketPerformance[];
  checkedAt: string;
};

export type TicketSeatGrade = {
  grade: string;
  remain: number;
  status?: "available" | "sold_out" | "unknown";
};

export type TicketSeatPerformance = {
  date: string;
  time: string;
  playSeq?: string;
  grades: TicketSeatGrade[];
};

export type TicketSeatsData = {
  platform: TicketPlatform;
  id: string;
  seats: TicketSeatPerformance[];
  checkedAt: string;
};

export type NormalizedTicketResult<T> = {
  status: Exclude<TripWatchStatus, "failed">;
  checkedAt: string;
  officialUrl: string;
  summary: string;
  data: T;
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

function normalizeDate(value: unknown): string | undefined {
  const text = stringValue(value);

  if (!text) {
    return undefined;
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  return text;
}

function normalizeTime(value: unknown): string | undefined {
  const text = stringValue(value);

  if (!text) {
    return undefined;
  }

  if (/^\d{4}$/.test(text)) {
    return `${text.slice(0, 2)}:${text.slice(2, 4)}`;
  }

  return text;
}

function checkedAtNow(): string {
  return new Date().toISOString();
}

function statusForGrades(remain: number | undefined): TicketSeatGrade["status"] {
  if (typeof remain !== "number") {
    return "unknown";
  }

  return remain > 0 ? "available" : "sold_out";
}

function normalizePerformance(value: unknown): TicketPerformance | undefined {
  const row = asRecord(value);
  const date = normalizeDate(row.date ?? row.playDate);
  const time = normalizeTime(row.time ?? row.time_label ?? row.timeLabel ?? row.label);

  if (!date || !time) {
    return undefined;
  }

  return {
    date,
    time,
    playSeq: stringValue(row.play_seq ?? row.playSeq ?? row.id_time ?? row.idTime),
    title: stringValue(row.title ?? row.name),
    rawLabel: stringValue(row.time_label ?? row.timeLabel ?? row.label)
  };
}

function normalizeGrade(value: unknown): TicketSeatGrade | undefined {
  const row = asRecord(value);
  const grade = stringValue(row.grade ?? row.seatGradeName ?? row.seatGrade);
  const remain = numberValue(row.remain ?? row.remainCnt);

  if (!grade || typeof remain !== "number") {
    return undefined;
  }

  return {
    grade,
    remain,
    status: statusForGrades(remain)
  };
}

function normalizeSeatPerformance(value: unknown): TicketSeatPerformance | undefined {
  const row = asRecord(value);
  const date = normalizeDate(row.date ?? row.playDate);
  const time = normalizeTime(row.time ?? row.time_label ?? row.timeLabel ?? row.label);
  const grades = asArray(row.seats ?? row.grades).map(normalizeGrade).filter((grade): grade is TicketSeatGrade => Boolean(grade));

  if (!date || !time) {
    return undefined;
  }

  return {
    date,
    time,
    playSeq: stringValue(row.play_seq ?? row.playSeq ?? row.id_time ?? row.idTime),
    grades
  };
}

function normalizeSeatEntries(value: unknown): TicketSeatPerformance[] {
  if (Array.isArray(value)) {
    return value.map(normalizeSeatPerformance).filter((row): row is TicketSeatPerformance => Boolean(row));
  }

  const record = asRecord(value);
  return Object.values(record).map(normalizeSeatPerformance).filter((row): row is TicketSeatPerformance => Boolean(row));
}

export function normalizeTicketSchedulePayload(
  payload: unknown,
  target: ParsedTicketInput,
  officialUrl: string
): NormalizedTicketResult<TicketScheduleData> {
  const record = asRecord(payload);

  if (!Array.isArray(record.schedule)) {
    throw new Error("ticket schedule payload에 schedule 배열이 없습니다.");
  }

  const checkedAt = checkedAtNow();
  const performances = asArray(record.schedule).map(normalizePerformance).filter((row): row is TicketPerformance => Boolean(row));
  const data: TicketScheduleData = {
    platform: target.platform,
    id: target.id,
    performances,
    checkedAt
  };
  const status: NormalizedTicketResult<TicketScheduleData>["status"] =
    performances.length !== asArray(record.schedule).length ? "partial" : "success";

  return {
    status,
    checkedAt,
    officialUrl,
    summary: `${target.normalizedInput} 일정 ${performances.length}개`,
    data
  };
}

export function normalizeTicketSeatsPayload(
  payload: unknown,
  target: ParsedTicketInput,
  officialUrl: string
): NormalizedTicketResult<TicketSeatsData> {
  const record = asRecord(payload);

  if (record.seats === undefined) {
    throw new Error("ticket seats payload에 seats 필드가 없습니다.");
  }

  const checkedAt = checkedAtNow();
  const seats = normalizeSeatEntries(record.seats);
  const hasEmptyGrades = seats.some((row) => row.grades.length === 0);
  const data: TicketSeatsData = {
    platform: target.platform,
    id: target.id,
    seats,
    checkedAt
  };

  return {
    status: hasEmptyGrades ? "partial" : "success",
    checkedAt,
    officialUrl,
    summary: `${target.normalizedInput} 잔여석 회차 ${seats.length}개`,
    data
  };
}
