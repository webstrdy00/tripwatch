import { existsSync } from "node:fs";
import { join } from "node:path";

import { failedResponse, partialResponse, successResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { toApiError, TripWatchError } from "@/lib/errors";
import {
  buildFlightQuery,
  formatKrw,
  normalizeFlightCompareMonthPayload,
  normalizeFlightSearchPayload,
  type FlightCheapestDate,
  type FlightOption,
  type FlightPriceBand,
  type FlightSearchData,
  type NormalizedFlightResult
} from "@/lib/normalize/normalize-flight";
import { buildGoogleFlightsSearchUrl } from "@/lib/official-urls";
import { runHelperCommand } from "@/lib/shell";
import type { FlightCompareMonthInput, FlightSearchInput } from "@/lib/validation/flight-schema";

const SEARCH_TIMEOUT_MS = 20_000;
const COMPARE_MONTH_TIMEOUT_MS = 60_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

export const FLIGHT_LIVE_SOURCE = "flight-ticket-search";

const FLIGHT_HELPER = {
  id: FLIGHT_LIVE_SOURCE,
  command: "python3",
  scriptPath: join(process.env.HOME ?? "/home/donghwi", ".agents", "skills", "flight-ticket-search", "scripts", "flight_ticket_search.py")
} as const;

export type FlightResponseSource = typeof FLIGHT_LIVE_SOURCE | "mock-flight-helper" | "google-flights-link";

function useMockHelpers(): boolean {
  return process.env.TRIPWATCH_USE_MOCK_HELPERS === "true";
}

function helperUnavailableError(): TripWatchError | undefined {
  if (!existsSync(FLIGHT_HELPER.scriptPath)) {
    return new TripWatchError("HELPER_FAILED", "flight-ticket-search helper script를 찾을 수 없습니다.");
  }

  return undefined;
}

function argsForSearch(input: FlightSearchInput): string[] {
  const args = [
    FLIGHT_HELPER.scriptPath,
    "search",
    "--from",
    input.from,
    "--to",
    input.to,
    "--date",
    input.date,
    "--adults",
    String(input.adults),
    "--seat",
    input.seat,
    "--limit",
    String(input.limit),
    "--format",
    "json"
  ];

  if (input.mode === "roundtrip" && input.returnDate) {
    args.push("--return-date", input.returnDate);
  }

  return args;
}

function argsForCompareMonth(input: FlightCompareMonthInput): string[] {
  return [
    FLIGHT_HELPER.scriptPath,
    "compare-month",
    "--from",
    input.from,
    "--to",
    input.to,
    "--month",
    input.yearMonth,
    "--sample",
    input.sample,
    "--adults",
    String(input.adults),
    "--seat",
    input.seat,
    "--limit",
    String(input.limit),
    "--format",
    "json"
  ];
}

async function runFlightHelper<T>(args: string[], timeoutMs: number): Promise<T> {
  const result = await runHelperCommand<T>(FLIGHT_HELPER.command, args, {
    timeoutMs,
    stdoutLimitBytes: STDOUT_LIMIT_BYTES,
    stderrLimitBytes: STDERR_LIMIT_BYTES
  });

  return result.data;
}

function responseFromNormalized(
  normalized: NormalizedFlightResult,
  source: FlightResponseSource
): TripWatchApiResponse<FlightSearchData> {
  const options = {
    checkedAt: normalized.checkedAt,
    source,
    officialUrl: normalized.officialUrl,
    summary: normalized.summary,
    data: normalized.data
  };

  return normalized.status === "success" ? successResponse(options) : partialResponse(options);
}

function failedFlightResponse(
  error: unknown,
  officialUrl: string,
  source: FlightResponseSource = FLIGHT_LIVE_SOURCE
): TripWatchApiResponse<FlightSearchData> {
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

function priceBandFor(value: number): FlightPriceBand {
  if (value <= 180_000) {
    return "low";
  }

  if (value <= 340_000) {
    return "medium";
  }

  return "high";
}

function dateSeed(value: string): number {
  return value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildMockFlights(input: FlightSearchInput | FlightCompareMonthInput, basePrice: number): FlightOption[] {
  const airlines = ["Jeju Air", "Korean Air", "Air Seoul", "Jin Air", "T'way Air"];
  const count = Math.min(input.limit, airlines.length);

  return airlines.slice(0, count).map((airlineName, index) => {
    const price = basePrice + index * 24_000;

    return {
      airlineName,
      departureTime: `${String(8 + index).padStart(2, "0")}:20`,
      arrivalTime: `${String(10 + index).padStart(2, "0")}:45`,
      duration: "2h25m",
      stops: index === 0 ? 0 : index % 2,
      priceText: formatKrw(price),
      price,
      quality: "complete"
    };
  });
}

function mockSearchResponse(input: FlightSearchInput, officialUrl: string, reason?: string): TripWatchApiResponse<FlightSearchData> {
  const basePrice = 150_000 + (dateSeed(input.date) % 7) * 12_000;
  const flights = buildMockFlights(input, basePrice);
  const prices = flights.map((flight) => flight.price).filter((price): price is number => typeof price === "number");
  const minPrice = Math.min(...prices);
  const avgPrice = Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length);
  const data: FlightSearchData = {
    query: buildFlightQuery(input),
    priceSummary: {
      minPrice,
      avgPrice,
      priceBand: priceBandFor(minPrice),
      cheapestDate: input.date,
      currency: "KRW"
    },
    flights,
    bookingSearchUrl: officialUrl
  };

  return successResponse({
    source: "mock-flight-helper",
    officialUrl,
    summary: `${input.from} → ${input.to} mock 항공권 결과입니다.${reason ? ` (${reason})` : ""}`,
    data
  });
}

function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function mockCompareMonthResponse(
  input: FlightCompareMonthInput,
  officialUrl: string,
  reason?: string
): TripWatchApiResponse<FlightSearchData> {
  const [year, month] = input.yearMonth.split("-").map((part) => Number.parseInt(part, 10));
  const step = input.sample === "daily" ? 1 : 7;
  const maxRows = input.sample === "daily" ? Math.min(20, daysInMonth(input.yearMonth)) : daysInMonth(input.yearMonth);
  const cheapestDates: FlightCheapestDate[] = [];

  for (let day = 1; day <= maxRows; day += step) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const minPrice = 145_000 + ((dateSeed(date) + day) % 9) * 11_000;
    cheapestDates.push({
      date,
      minPrice,
      avgPrice: minPrice + 38_000,
      priceBand: priceBandFor(minPrice),
      bookingSearchUrl: buildGoogleFlightsSearchUrl({
        from: input.from,
        to: input.to,
        date,
        adults: input.adults,
        seat: input.seat,
        mode: "oneway"
      }),
      status: "success",
      summary: `${date} / 최저 ${formatKrw(minPrice)}`
    });
  }

  const sortedDates = [...cheapestDates].sort((left, right) => (left.minPrice ?? 0) - (right.minPrice ?? 0)).slice(0, input.limit);
  const first = sortedDates[0];
  const minPrice = first?.minPrice;
  const avgPrice = sortedDates.length
    ? Math.round(sortedDates.reduce((sum, row) => sum + (row.minPrice ?? 0), 0) / sortedDates.length)
    : undefined;
  const flights = buildMockFlights(input, minPrice ?? 170_000);
  const data: FlightSearchData = {
    query: buildFlightQuery(input),
    priceSummary: {
      minPrice,
      avgPrice,
      priceBand: minPrice ? priceBandFor(minPrice) : "unknown",
      cheapestDate: first?.date,
      currency: "KRW"
    },
    flights,
    bookingSearchUrl: first?.bookingSearchUrl ?? officialUrl,
    cheapestDates: sortedDates
  };

  return successResponse({
    source: "mock-flight-helper",
    officialUrl: data.bookingSearchUrl,
    summary: `${input.from} → ${input.to} / ${input.yearMonth} mock 월별 비교 결과입니다.${reason ? ` (${reason})` : ""}`,
    data
  });
}

export async function searchFlights(input: FlightSearchInput): Promise<TripWatchApiResponse<FlightSearchData>> {
  const officialUrl = buildGoogleFlightsSearchUrl(input);
  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers()
      ? mockSearchResponse(input, officialUrl, "helper script 없음")
      : failedFlightResponse(unavailable, officialUrl, "google-flights-link");
  }

  try {
    const payload = await runFlightHelper<unknown>(argsForSearch(input), SEARCH_TIMEOUT_MS);
    return responseFromNormalized(normalizeFlightSearchPayload(payload, input, officialUrl), FLIGHT_LIVE_SOURCE);
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockSearchResponse(input, officialUrl, "helper 실패 fallback");
    }

    return failedFlightResponse(error, officialUrl);
  }
}

export async function compareFlightMonth(input: FlightCompareMonthInput): Promise<TripWatchApiResponse<FlightSearchData>> {
  const officialUrl = buildGoogleFlightsSearchUrl(input);
  const unavailable = helperUnavailableError();

  if (unavailable) {
    return useMockHelpers()
      ? mockCompareMonthResponse(input, officialUrl, "helper script 없음")
      : failedFlightResponse(unavailable, officialUrl, "google-flights-link");
  }

  try {
    const payload = await runFlightHelper<unknown>(argsForCompareMonth(input), COMPARE_MONTH_TIMEOUT_MS);
    return responseFromNormalized(normalizeFlightCompareMonthPayload(payload, input, officialUrl), FLIGHT_LIVE_SOURCE);
  } catch (error) {
    if (useMockHelpers() && error instanceof TripWatchError && error.code === "HELPER_FAILED") {
      return mockCompareMonthResponse(input, officialUrl, "helper 실패 fallback");
    }

    return failedFlightResponse(error, officialUrl);
  }
}
