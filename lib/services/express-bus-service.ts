import { existsSync } from "node:fs";
import { join } from "node:path";

import { failedResponse, partialResponse, successResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import {
  formatKrw,
  normalizeExpressBusPayload,
  type BusSchedule,
  type BusSearchData,
  type NormalizedBusResult
} from "@/lib/normalize/normalize-bus";
import { buildExpressBusOfficialUrl } from "@/lib/official-urls";
import { runHelperCommand } from "@/lib/shell";
import type { BusSearchInput } from "@/lib/validation/bus-schema";

const SEARCH_TIMEOUT_MS = 20_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

export const EXPRESS_BUS_LIVE_SOURCE = "express-bus-booking";

const EXPRESS_HELPER = {
  id: EXPRESS_BUS_LIVE_SOURCE,
  command: "python3",
  scriptPath: join(process.env.HOME ?? "/home/donghwi", ".agents", "skills", "express-bus-booking", "scripts", "kobus_express_booking.py")
} as const;

type ExpressBusResponseSource = typeof EXPRESS_BUS_LIVE_SOURCE | "mock-express-bus-helper" | "kobus-link";

type Terminal = {
  code: string;
  name: string;
};

const EXPRESS_TERMINALS: Record<string, Terminal> = {
  서울경부: { code: "010", name: "서울경부" },
  서울고속버스터미널: { code: "010", name: "서울경부" },
  부산: { code: "700", name: "부산" },
  부산고속버스터미널: { code: "700", name: "부산" },
  센트럴시티: { code: "021", name: "센트럴시티(서울)" },
  "센트럴시티(서울)": { code: "021", name: "센트럴시티(서울)" },
  광주: { code: "500", name: "광주(유·스퀘어)" },
  "광주(유·스퀘어)": { code: "500", name: "광주(유·스퀘어)" }
};

function useMockHelpers(): boolean {
  return process.env.TRIPWATCH_USE_MOCK_HELPERS === "true";
}

function normalizeTerminalName(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function resolveTerminal(value: string): Terminal | undefined {
  return EXPRESS_TERMINALS[normalizeTerminalName(value)];
}

function helperUnavailableError(): TripWatchError | undefined {
  if (!existsSync(EXPRESS_HELPER.scriptPath)) {
    return new TripWatchError("HELPER_FAILED", "express-bus-booking helper script를 찾을 수 없습니다.");
  }

  return undefined;
}

function toYyyymmdd(date: string): string {
  return date.replaceAll("-", "");
}

function argsForSearch(input: BusSearchInput, depart: Terminal, arrive: Terminal): string[] {
  return [
    EXPRESS_HELPER.scriptPath,
    "--depart-code",
    depart.code,
    "--arrive-code",
    arrive.code,
    "--date",
    toYyyymmdd(input.date),
    "--limit",
    "20",
    "--timeout",
    "20"
  ];
}

async function runExpressHelper<T>(args: string[]): Promise<T> {
  const result = await runHelperCommand<T>(EXPRESS_HELPER.command, args, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    stdoutLimitBytes: STDOUT_LIMIT_BYTES,
    stderrLimitBytes: STDERR_LIMIT_BYTES
  });

  return result.data;
}

function responseFromNormalized(normalized: NormalizedBusResult, source: ExpressBusResponseSource): TripWatchApiResponse<BusSearchData> {
  const options = {
    checkedAt: normalized.checkedAt,
    source,
    officialUrl: normalized.officialUrl,
    summary: normalized.summary,
    data: normalized.data
  };

  return normalized.status === "success" ? successResponse(options) : partialResponse(options);
}

function failedExpressBusResponse(
  error: unknown,
  officialUrl: string,
  source: ExpressBusResponseSource = EXPRESS_BUS_LIVE_SOURCE
): TripWatchApiResponse<BusSearchData> {
  const apiError = toApiError(error);
  const publicError =
    apiError.code === "HELPER_FAILED" || apiError.code === "HELPER_TIMEOUT" || apiError.code === "PARSE_ERROR"
      ? {
          code: apiError.code,
          message: apiError.message
        }
      : apiError;

  return failedResponse({
    source,
    officialUrl,
    summary: publicError.message,
    error: publicError
  });
}

function terminalNotFoundResponse(input: BusSearchInput, officialUrl: string): TripWatchApiResponse<BusSearchData> {
  return failedExpressBusResponse(
    new TripWatchError("TERMINAL_NOT_FOUND", `${input.departName} 또는 ${input.arriveName} 터미널을 고속버스 helper allowlist에서 찾을 수 없습니다.`),
    officialUrl,
    "kobus-link"
  );
}

function noResultsResponse(input: BusSearchInput, officialUrl: string): TripWatchApiResponse<BusSearchData> {
  return failedExpressBusResponse(
    new TripWatchError("NO_RESULTS", `${input.departName} → ${input.arriveName} / ${input.date} ${input.time} 이후 배차를 찾지 못했습니다.`),
    officialUrl
  );
}

function mockSchedules(input: BusSearchInput): BusSchedule[] {
  const base: BusSchedule[] = [
    {
      departTime: "09:20",
      arriveTime: "13:20",
      grade: "우등",
      remainSeats: 12,
      totalSeats: 28,
      fare: 39800,
      fareText: formatKrw(39800),
      operator: "천일고속",
      quality: "complete"
    },
    {
      departTime: "10:00",
      arriveTime: "14:10",
      grade: "프리미엄",
      remainSeats: 3,
      totalSeats: 21,
      fare: 49100,
      fareText: formatKrw(49100),
      operator: "동양고속",
      quality: "complete"
    },
    {
      departTime: "10:40",
      arriveTime: "14:40",
      grade: "고속",
      remainSeats: 18,
      totalSeats: 45,
      fare: 27000,
      fareText: formatKrw(27000),
      operator: "중앙고속",
      quality: "complete"
    }
  ];
  const minimum = Number.parseInt(input.time.slice(0, 2), 10) * 60 + Number.parseInt(input.time.slice(3, 5), 10);

  return base.filter((schedule) => {
    const minutes = Number.parseInt(schedule.departTime.slice(0, 2), 10) * 60 + Number.parseInt(schedule.departTime.slice(3, 5), 10);
    return minutes >= minimum;
  });
}

function mockSearchResponse(input: BusSearchInput, officialUrl: string, reason?: string): TripWatchApiResponse<BusSearchData> {
  const schedules = mockSchedules(input);

  return successResponse({
    source: "mock-express-bus-helper",
    officialUrl,
    summary: `고속버스 ${input.departName} → ${input.arriveName} mock 배차 ${schedules.length}개입니다.${reason ? ` (${reason})` : ""}`,
    data: {
      query: input,
      schedules,
      officialUrl
    }
  });
}

export async function searchExpressBuses(input: BusSearchInput): Promise<TripWatchApiResponse<BusSearchData>> {
  const officialUrl = buildExpressBusOfficialUrl(input);
  const depart = resolveTerminal(input.departName);
  const arrive = resolveTerminal(input.arriveName);

  if (!depart || !arrive) {
    return terminalNotFoundResponse(input, officialUrl);
  }

  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers() ? mockSearchResponse(input, officialUrl, "helper script 없음") : failedExpressBusResponse(unavailable, officialUrl, "kobus-link");
  }

  try {
    const payload = await runExpressHelper<unknown>(argsForSearch(input, depart, arrive));
    const response = responseFromNormalized(normalizeExpressBusPayload(payload, input, officialUrl), EXPRESS_BUS_LIVE_SOURCE);

    if (response.data?.schedules.length === 0) {
      return noResultsResponse(input, officialUrl);
    }

    return response;
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockSearchResponse(input, officialUrl, "helper 실패 fallback");
    }

    return failedExpressBusResponse(error, officialUrl);
  }
}
