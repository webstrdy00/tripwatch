import { isoDateToCompact, isRealIsoDate } from "@/lib/dates";
import {
  foresttripHelperPayloadSchema,
  type ForesttripHelperPayload,
  type ForesttripSearchInput
} from "@/lib/validation/foresttrip-schema";

export type ForesttripRoom = {
  id: string;
  roomName: string;
  date: string;
  categoryCode: ForesttripSearchInput["category"];
  categoryLabel: string;
  capacity: number | null;
  availability: "available";
};

export type ForesttripSearchData = {
  query: ForesttripSearchInput;
  rooms: ForesttripRoom[];
};

export type ForesttripNormalizationTiming = {
  startedKstDate: string;
  endedKstDate: string;
};

type HelperRoom = ForesttripHelperPayload["results"][number]["dates"][number]["rooms"][number];

export class ForesttripPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForesttripPayloadError";
  }
}

function normalizeForestName(value: string): string {
  return value.trim().normalize("NFC");
}

function normalizeCapacity(value: HelperRoom["capacity"]): number | null {
  return value === null ? null : Number(value);
}

function encodedRoomId(room: HelperRoom, category: ForesttripSearchInput["category"]): string {
  const tuple = [room.forest_id, room.use_dt, category, room.name, room.area];
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

function assertTiming(value: string, name: string): void {
  if (!isRealIsoDate(value)) {
    throw new ForesttripPayloadError(`${name}에는 실제 KST YYYY-MM-DD 날짜가 필요합니다.`);
  }
}

function assertPayloadInvariants(payload: ForesttripHelperPayload, input: ForesttripSearchInput, timing: ForesttripNormalizationTiming): void {
  const requestedCompactDate = isoDateToCompact(input.date);
  const { from, to } = payload.date_range;
  const capturedDates = [timing.startedKstDate, timing.endedKstDate];

  assertTiming(timing.startedKstDate, "시작 시각");
  assertTiming(timing.endedKstDate, "종료 시각");

  if (!capturedDates.includes(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6, 8)}`)) {
    throw new ForesttripPayloadError("helper date_range.from은 시작 또는 종료 KST 날짜와 일치해야 합니다.");
  }
  if (to !== requestedCompactDate || from > requestedCompactDate || requestedCompactDate > to) {
    throw new ForesttripPayloadError("helper date_range는 요청 날짜를 정확히 포함해야 합니다.");
  }

  const rooms = payload.results.flatMap((result) => result.dates.flatMap((date) => date.rooms));
  if (payload.filter_hits !== rooms.length) {
    throw new ForesttripPayloadError("filter_hits는 정규화 대상 객실 수와 일치해야 합니다.");
  }

  if (payload.results.length === 0) {
    return;
  }

  const [result] = payload.results;
  if (normalizeForestName(result.forest) !== input.forestName || result.dates[0].use_dt !== requestedCompactDate) {
    throw new ForesttripPayloadError("helper 결과는 요청한 휴양림과 날짜에 정확히 일치해야 합니다.");
  }

  for (const room of rooms) {
    if (normalizeForestName(room.forest) !== input.forestName || room.use_dt !== requestedCompactDate) {
      throw new ForesttripPayloadError("객실은 요청한 휴양림과 날짜에 정확히 일치해야 합니다.");
    }
  }
}

export function normalizeForesttripPayload(
  payload: unknown,
  input: ForesttripSearchInput,
  timing: ForesttripNormalizationTiming
): ForesttripSearchData {
  const validation = foresttripHelperPayloadSchema.safeParse(payload);
  if (!validation.success) {
    throw new ForesttripPayloadError("Foresttrip helper payload is invalid.");
  }
  const parsedPayload = validation.data;
  assertPayloadInvariants(parsedPayload, input, timing);

  const seen = new Set<string>();
  const rooms = parsedPayload.results.flatMap((result) => result.dates.flatMap((date) => date.rooms)).map((room) => {
    const id = encodedRoomId(room, input.category);
    if (seen.has(id)) {
      throw new ForesttripPayloadError("중복된 Foresttrip 객실 결과가 포함되어 있습니다.");
    }
    seen.add(id);

    return {
      id,
      roomName: room.name,
      date: input.date,
      categoryCode: input.category,
      categoryLabel: room.category,
      capacity: normalizeCapacity(room.capacity),
      availability: "available" as const
    };
  });

  return {
    query: input,
    rooms
  };
}
