import { existsSync } from "node:fs";
import { join } from "node:path";

import { failedResponse, partialResponse, successResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import {
  formatKrw,
  normalizeIntercityBusPayload,
  type BusSchedule,
  type BusSearchData,
  type NormalizedBusResult
} from "@/lib/normalize/normalize-bus";
import { buildIntercityBusOfficialUrl } from "@/lib/official-urls";
import { runHelperCommand } from "@/lib/shell";
import type { BusSearchInput } from "@/lib/validation/bus-schema";

const SEARCH_TIMEOUT_MS = 20_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

const INTERCITY_HELPER = {
  id: "intercity-bus-booking",
  command: "python3",
  scriptPath: join(process.env.HOME ?? "/home/donghwi", ".agents", "skills", "intercity-bus-booking", "scripts", "intercity_bus_search.py")
} as const;

type IntercityBusResponseSource = "intercity-bus-booking" | "mock-intercity-bus-helper" | "tmoney-link";

type Terminal = {
  code: string;
  name: string;
};

const INTERCITY_TERMINALS: Record<string, Terminal> = {
  동서울: { code: "0511601", name: "동서울" },
  동서울터미널: { code: "0511601", name: "동서울" },
  속초: { code: "2482701", name: "속초" },
  속초시외버스터미널: { code: "2482701", name: "속초" }
};

function useMockHelpers(): boolean {
  return process.env.TRIPWATCH_USE_MOCK_HELPERS === "true";
}

function normalizeTerminalName(value: string): string {
  return value.trim().replace(/\s+/g, "");
}

function resolveTerminal(value: string): Terminal | undefined {
  return INTERCITY_TERMINALS[normalizeTerminalName(value)];
}

function helperUnavailableError(): TripWatchError | undefined {
  if (!existsSync(INTERCITY_HELPER.scriptPath)) {
    return new TripWatchError("HELPER_FAILED", "intercity-bus-booking helper script를 찾을 수 없습니다.");
  }

  return undefined;
}

function toYyyymmdd(date: string): string {
  return date.replaceAll("-", "");
}

function toHhmmss(time: string): string {
  return `${time.slice(0, 2)}${time.slice(3, 5)}00`;
}

function argsForSearch(input: BusSearchInput, depart: Terminal, arrive: Terminal): string[] {
  return [
    INTERCITY_HELPER.scriptPath,
    "--depart-code",
    depart.code,
    "--arrive-code",
    arrive.code,
    "--depart-name",
    depart.name,
    "--arrive-name",
    arrive.name,
    "--date",
    toYyyymmdd(input.date),
    "--time",
    toHhmmss(input.time),
    "--adults",
    String(input.passengers),
    "--limit",
    "20",
    "--timeout",
    "20"
  ];
}

async function runIntercityHelper<T>(args: string[]): Promise<T> {
  const result = await runHelperCommand<T>(INTERCITY_HELPER.command, args, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    stdoutLimitBytes: STDOUT_LIMIT_BYTES,
    stderrLimitBytes: STDERR_LIMIT_BYTES
  });

  return result.data;
}

function responseFromNormalized(normalized: NormalizedBusResult, source: IntercityBusResponseSource): TripWatchApiResponse<BusSearchData> {
  const options = {
    checkedAt: normalized.checkedAt,
    source,
    officialUrl: normalized.officialUrl,
    summary: normalized.summary,
    data: normalized.data
  };

  return normalized.status === "success" ? successResponse(options) : partialResponse(options);
}

function failedIntercityBusResponse(
  error: unknown,
  officialUrl: string,
  source: IntercityBusResponseSource = "intercity-bus-booking"
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
  return failedIntercityBusResponse(
    new TripWatchError("TERMINAL_NOT_FOUND", `${input.departName} 또는 ${input.arriveName} 터미널을 시외버스 helper allowlist에서 찾을 수 없습니다.`),
    officialUrl,
    "tmoney-link"
  );
}

function noResultsResponse(input: BusSearchInput, officialUrl: string): TripWatchApiResponse<BusSearchData> {
  return failedIntercityBusResponse(
    new TripWatchError("NO_RESULTS", `${input.departName} → ${input.arriveName} / ${input.date} ${input.time} 이후 배차를 찾지 못했습니다.`),
    officialUrl
  );
}

function mockSchedules(input: BusSearchInput): BusSchedule[] {
  const base: BusSchedule[] = [
    {
      departTime: "08:30",
      operator: "금강고속",
      grade: "일반",
      remainSeats: 8,
      totalSeats: 45,
      fare: 19700,
      fareText: formatKrw(19700),
      quality: "complete"
    },
    {
      departTime: "09:10",
      operator: "동부고속",
      grade: "우등",
      remainSeats: 2,
      totalSeats: 28,
      fare: 24500,
      fareText: formatKrw(24500),
      quality: "complete"
    },
    {
      departTime: "10:20",
      operator: "금강고속",
      grade: "우등",
      remainSeats: 16,
      totalSeats: 28,
      fare: 24500,
      fareText: formatKrw(24500),
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
    source: "mock-intercity-bus-helper",
    officialUrl,
    summary: `시외버스 ${input.departName} → ${input.arriveName} mock 배차 ${schedules.length}개입니다.${reason ? ` (${reason})` : ""}`,
    data: {
      query: input,
      schedules,
      officialUrl
    }
  });
}

export async function searchIntercityBuses(input: BusSearchInput): Promise<TripWatchApiResponse<BusSearchData>> {
  const officialUrl = buildIntercityBusOfficialUrl(input);
  const depart = resolveTerminal(input.departName);
  const arrive = resolveTerminal(input.arriveName);

  if (!depart || !arrive) {
    return terminalNotFoundResponse(input, officialUrl);
  }

  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers()
      ? mockSearchResponse(input, officialUrl, "helper script 없음")
      : failedIntercityBusResponse(unavailable, officialUrl, "tmoney-link");
  }

  try {
    const payload = await runIntercityHelper<unknown>(argsForSearch(input, depart, arrive));
    const response = responseFromNormalized(normalizeIntercityBusPayload(payload, input, officialUrl), "intercity-bus-booking");

    if (response.data?.schedules.length === 0) {
      return noResultsResponse(input, officialUrl);
    }

    return response;
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockSearchResponse(input, officialUrl, "helper 실패 fallback");
    }

    return failedIntercityBusResponse(error, officialUrl);
  }
}
