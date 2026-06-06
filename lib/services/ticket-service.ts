import { existsSync } from "node:fs";
import { join } from "node:path";

import { failedResponse, partialResponse, successResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import {
  normalizeTicketSchedulePayload,
  normalizeTicketSeatsPayload,
  type NormalizedTicketResult,
  type TicketScheduleData,
  type TicketSeatPerformance,
  type TicketSeatsData
} from "@/lib/normalize/normalize-ticket";
import { buildTicketOfficialUrl, getTicketOfficialUrl } from "@/lib/official-urls";
import { runHelperCommand } from "@/lib/shell";
import { parseTicketInput, type ParsedTicketInput, type TicketLookupInput } from "@/lib/validation/ticket-schema";

const SCHEDULE_TIMEOUT_MS = 20_000;
const SEATS_TIMEOUT_MS = 60_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

const TICKET_HELPER = {
  id: "ticket-availability",
  command: "python3",
  scriptPath: join(process.env.HOME ?? "/home/donghwi", ".agents", "skills", "ticket-availability", "scripts", "ticket_availability.py")
} as const;

type TicketResponseSource = "ticket-availability" | "mock-ticket-helper" | "ticket-official-link";

function useMockHelpers(): boolean {
  return process.env.TRIPWATCH_USE_MOCK_HELPERS === "true";
}

function helperUnavailableError(): TripWatchError | undefined {
  if (!existsSync(TICKET_HELPER.scriptPath)) {
    return new TripWatchError("HELPER_FAILED", "ticket-availability helper script를 찾을 수 없습니다.");
  }

  return undefined;
}

function resolveTarget(input: TicketLookupInput): ParsedTicketInput {
  const target = parseTicketInput(input.input);

  if (!target) {
    throw new TripWatchError("VALIDATION_ERROR", "URL 또는 platform:id 형식을 확인하세요.");
  }

  return target;
}

function argsForSchedule(target: ParsedTicketInput): string[] {
  return [TICKET_HELPER.scriptPath, "schedule", target.normalizedInput, "--compact"];
}

function argsForSeats(target: ParsedTicketInput): string[] {
  return [TICKET_HELPER.scriptPath, "seats", target.normalizedInput, "--compact"];
}

async function runTicketHelper<T>(args: string[], timeoutMs: number): Promise<T> {
  const result = await runHelperCommand<T>(TICKET_HELPER.command, args, {
    timeoutMs,
    stdoutLimitBytes: STDOUT_LIMIT_BYTES,
    stderrLimitBytes: STDERR_LIMIT_BYTES
  });

  return result.data;
}

function responseFromNormalized<T>(
  normalized: NormalizedTicketResult<T>,
  source: TicketResponseSource
): TripWatchApiResponse<T> {
  const options = {
    checkedAt: normalized.checkedAt,
    source,
    officialUrl: normalized.officialUrl,
    summary: normalized.summary,
    data: normalized.data
  };

  return normalized.status === "success" ? successResponse(options) : partialResponse(options);
}

function failedTicketResponse<T>(
  error: unknown,
  officialUrl: string,
  source: TicketResponseSource = "ticket-availability"
): TripWatchApiResponse<T> {
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

function noScheduleResponse(target: ParsedTicketInput, officialUrl: string): TripWatchApiResponse<TicketScheduleData> {
  return failedTicketResponse(
    new TripWatchError("NO_SCHEDULE", `${target.normalizedInput} 공연 일정을 찾지 못했습니다. URL 또는 platform:id 형식을 확인하세요.`),
    officialUrl
  );
}

function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function mockScheduleResponse(target: ParsedTicketInput, officialUrl: string, reason?: string): TripWatchApiResponse<TicketScheduleData> {
  const checkedAt = new Date().toISOString();
  const data: TicketScheduleData = {
    platform: target.platform,
    id: target.id,
    checkedAt,
    performances: [
      {
        date: futureDate(14),
        time: "14:30",
        playSeq: target.platform === "interpark" ? "001" : "1432397",
        title: "낮 공연"
      },
      {
        date: futureDate(15),
        time: "19:30",
        playSeq: target.platform === "interpark" ? "002" : "1432398",
        title: "저녁 공연"
      }
    ]
  };

  return successResponse({
    checkedAt,
    source: "mock-ticket-helper",
    officialUrl,
    summary: `${target.normalizedInput} mock 일정 ${data.performances.length}개입니다.${reason ? ` (${reason})` : ""}`,
    data
  });
}

function mockSeatRows(target: ParsedTicketInput): TicketSeatPerformance[] {
  return [
    {
      date: futureDate(14),
      time: "14:30",
      playSeq: target.platform === "interpark" ? "001" : "1432397",
      grades: [
        { grade: "VIP석", remain: 12, status: "available" },
        { grade: "R석", remain: 34, status: "available" },
        { grade: "S석", remain: 0, status: "sold_out" }
      ]
    },
    {
      date: futureDate(15),
      time: "19:30",
      playSeq: target.platform === "interpark" ? "002" : "1432398",
      grades: [
        { grade: "VIP석", remain: 4, status: "available" },
        { grade: "R석", remain: 18, status: "available" },
        { grade: "S석", remain: 23, status: "available" }
      ]
    }
  ];
}

function mockSeatsResponse(target: ParsedTicketInput, officialUrl: string, reason?: string): TripWatchApiResponse<TicketSeatsData> {
  const checkedAt = new Date().toISOString();
  const seats = mockSeatRows(target);

  return successResponse({
    checkedAt,
    source: "mock-ticket-helper",
    officialUrl,
    summary: `${target.normalizedInput} mock 잔여석 회차 ${seats.length}개입니다.${reason ? ` (${reason})` : ""}`,
    data: {
      platform: target.platform,
      id: target.id,
      checkedAt,
      seats
    }
  });
}

function normalizeSchedule(payload: unknown, target: ParsedTicketInput, officialUrl: string): NormalizedTicketResult<TicketScheduleData> {
  try {
    return normalizeTicketSchedulePayload(payload, target, officialUrl);
  } catch (error) {
    throw new TripWatchError("PARSE_ERROR", "ticket-availability schedule 응답 형식이 예상과 다릅니다.", {
      cause: error
    });
  }
}

function normalizeSeats(payload: unknown, target: ParsedTicketInput, officialUrl: string): NormalizedTicketResult<TicketSeatsData> {
  try {
    return normalizeTicketSeatsPayload(payload, target, officialUrl);
  } catch (error) {
    throw new TripWatchError("PARSE_ERROR", "ticket-availability seats 응답 형식이 예상과 다릅니다.", {
      cause: error
    });
  }
}

export async function getTicketSchedule(input: TicketLookupInput): Promise<TripWatchApiResponse<TicketScheduleData>> {
  const target = resolveTarget(input);
  const officialUrl = buildTicketOfficialUrl(target.platform, target.id);
  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers()
      ? mockScheduleResponse(target, officialUrl, "helper script 없음")
      : failedTicketResponse(unavailable, officialUrl, "ticket-official-link");
  }

  try {
    const payload = await runTicketHelper<unknown>(argsForSchedule(target), SCHEDULE_TIMEOUT_MS);
    const response = responseFromNormalized(normalizeSchedule(payload, target, officialUrl), "ticket-availability");

    if (response.data?.performances.length === 0) {
      return noScheduleResponse(target, officialUrl);
    }

    return response;
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockScheduleResponse(target, officialUrl, "helper 실패 fallback");
    }

    return failedTicketResponse(error, officialUrl);
  }
}

export async function getTicketSeats(input: TicketLookupInput): Promise<TripWatchApiResponse<TicketSeatsData>> {
  const target = resolveTarget(input);
  const officialUrl = getTicketOfficialUrl(target.platform, target.id);
  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers()
      ? mockSeatsResponse(target, officialUrl, "helper script 없음")
      : failedTicketResponse(unavailable, officialUrl, "ticket-official-link");
  }

  try {
    const payload = await runTicketHelper<unknown>(argsForSeats(target), SEATS_TIMEOUT_MS);
    return responseFromNormalized(normalizeSeats(payload, target, officialUrl), "ticket-availability");
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockSeatsResponse(target, officialUrl, "helper 실패 fallback");
    }

    return failedTicketResponse(error, officialUrl);
  }
}
