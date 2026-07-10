import type { TripWatchStatus } from "@/lib/api-response";
import type { FlightCompareMonthInput, FlightSearchInput } from "@/lib/validation/flight-schema";

export type FlightPriceBand = "low" | "medium" | "high" | "unknown";
export type FlightQuality = "complete" | "partial";

export type FlightQuery = {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  adults: number;
  seat: FlightSearchInput["seat"];
  mode: FlightSearchInput["mode"];
  limit: number;
  yearMonth?: string;
  sample?: "weekly" | "daily";
};

export type FlightOption = {
  airlineName?: string;
  departureTime?: string;
  arrivalTime?: string;
  duration?: string;
  stops?: number;
  priceText?: string;
  price?: number;
  quality: FlightQuality;
};

export type FlightCheapestDate = {
  date: string;
  minPrice?: number;
  avgPrice?: number;
  priceBand?: FlightPriceBand;
  bookingSearchUrl?: string;
  status: "success" | "failed";
  summary?: string;
  error?: string;
};

export type FlightPriceSummary = {
  minPrice?: number;
  avgPrice?: number;
  priceBand: FlightPriceBand;
  cheapestDate?: string;
  currency?: string;
};

export type FlightSearchData = {
  query: FlightQuery;
  priceSummary: FlightPriceSummary;
  flights: FlightOption[];
  bookingSearchUrl: string;
  cheapestDates?: FlightCheapestDate[];
};

export type NormalizedFlightResult = {
  status: Exclude<TripWatchStatus, "failed">;
  checkedAt?: string;
  officialUrl: string;
  summary: string;
  data: FlightSearchData;
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
    return Math.round(value);
  }

  if (typeof value === "string") {
    const digits = value.replace(/[^0-9]/g, "");
    return digits ? Number.parseInt(digits, 10) : undefined;
  }

  return undefined;
}

function normalizePriceBand(value: unknown): FlightPriceBand {
  const band = stringValue(value)?.toLowerCase();

  if (band === "low") {
    return "low";
  }

  if (band === "medium" || band === "typical") {
    return "medium";
  }

  if (band === "high") {
    return "high";
  }

  return "unknown";
}

function normalizeStops(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  const text = stringValue(value)?.toLowerCase();

  if (!text) {
    return undefined;
  }

  if (text.includes("non") || text.includes("direct") || text.includes("직항")) {
    return 0;
  }

  const matched = /\d+/.exec(text);
  return matched ? Number.parseInt(matched[0], 10) : undefined;
}

export function formatKrw(value: number | undefined): string {
  return typeof value === "number" ? `₩${value.toLocaleString("ko-KR")}` : "확인 불가";
}

export function buildFlightQuery(input: FlightSearchInput | FlightCompareMonthInput): FlightQuery {
  return {
    from: input.from,
    to: input.to,
    date: input.date,
    returnDate: input.returnDate,
    adults: input.adults,
    seat: input.seat,
    mode: input.mode,
    limit: input.limit,
    yearMonth: "yearMonth" in input ? input.yearMonth : undefined,
    sample: "sample" in input ? input.sample : undefined
  };
}

function normalizeFlightOption(value: unknown): FlightOption {
  const row = asRecord(value);
  const price = numberValue(row.price_value ?? row.price);
  const airlineName = stringValue(row.name ?? row.airline_name ?? row.airlineName);
  const departureTime = stringValue(row.departure ?? row.departure_time ?? row.departureTime);
  const arrivalTime = stringValue(row.arrival ?? row.arrival_time ?? row.arrivalTime);
  const duration = stringValue(row.duration);
  const quality = stringValue(row.quality) === "complete" && airlineName && departureTime && arrivalTime ? "complete" : "partial";

  return {
    airlineName,
    departureTime,
    arrivalTime,
    duration,
    stops: normalizeStops(row.stops),
    priceText: stringValue(row.price_text ?? row.priceText ?? row.price) ?? formatKrw(price),
    price,
    quality
  };
}

function getCheckedAt(meta: UnknownRecord): string | undefined {
  const checkedAt = stringValue(meta.queried_at ?? meta.checkedAt);

  if (!checkedAt) {
    return undefined;
  }

  const parsed = new Date(checkedAt);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function buildSearchSummary(query: FlightQuery, priceSummary: FlightPriceSummary, flights: FlightOption[]): string {
  const route = `${query.from} → ${query.to}`;
  const trip = query.mode === "roundtrip" && query.returnDate ? `${query.date} ~ ${query.returnDate}` : query.date;
  const minPrice = formatKrw(priceSummary.minPrice);
  const avgPrice = formatKrw(priceSummary.avgPrice);

  return `${route} / ${trip} / 최저 ${minPrice}, 평균 ${avgPrice}, 후보 ${flights.length}개`;
}
function safeGoogleFlightsUrl(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (hostname === "google.com" || hostname.endsWith(".google.com"))
    ) {
      return value;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function normalizeFlightSearchPayload(
  payload: unknown,
  input: FlightSearchInput,
  fallbackOfficialUrl: string
): NormalizedFlightResult {
  const record = asRecord(payload);
  const meta = asRecord(record.meta);
  const stats = asRecord(record.stats);
  const flights = asArray(record.flights).map(normalizeFlightOption);
  const officialUrl = safeGoogleFlightsUrl(stringValue(meta.booking_search_url), fallbackOfficialUrl);
  const priceSummary: FlightPriceSummary = {
    minPrice: numberValue(stats.min_price),
    avgPrice: numberValue(stats.avg_price),
    priceBand: normalizePriceBand(meta.price_band),
    currency: stringValue(meta.currency) ?? "KRW"
  };
  const data: FlightSearchData = {
    query: buildFlightQuery(input),
    priceSummary,
    flights,
    bookingSearchUrl: officialUrl
  };
  const status: NormalizedFlightResult["status"] =
    flights.length === 0 || flights.some((flight) => flight.quality === "partial") ? "partial" : "success";

  return {
    status,
    checkedAt: getCheckedAt(meta),
    officialUrl,
    summary: buildSearchSummary(data.query, priceSummary, flights),
    data
  };
}

function normalizeCheapestDate(value: unknown, fallbackOfficialUrl: string): FlightCheapestDate {
  const row = asRecord(value);
  const ok = row.ok !== false;
  const minPrice = numberValue(row.min_price ?? row.minPrice);
  const avgPrice = numberValue(row.avg_price ?? row.avgPrice);
  const date = stringValue(row.date) ?? "unknown";
  const summary = ok ? `${date} / 최저 ${formatKrw(minPrice)}` : `${date} / 조회 실패`;
  const rowError = stringValue(row.error);

  return {
    date,
    minPrice,
    avgPrice,
    priceBand: normalizePriceBand(row.price_band ?? row.priceBand),
    bookingSearchUrl: safeGoogleFlightsUrl(
      stringValue(row.booking_search_url ?? row.bookingSearchUrl),
      fallbackOfficialUrl
    ),
    status: ok ? "success" : "failed",
    summary,
    error: rowError ? "해당 날짜 조회에 실패했습니다." : undefined
  };
}

function buildCompareSummary(query: FlightQuery, priceSummary: FlightPriceSummary, sampledDates?: number, successfulDates?: number): string {
  const route = `${query.from} → ${query.to}`;
  const sampleText =
    typeof sampledDates === "number" && typeof successfulDates === "number" ? ` / 샘플 ${sampledDates}개 중 ${successfulDates}개 성공` : "";
  return `${route} / ${query.yearMonth ?? query.date} 월별 비교 / 최저 ${formatKrw(priceSummary.minPrice)}${sampleText}`;
}

export function normalizeFlightCompareMonthPayload(
  payload: unknown,
  input: FlightCompareMonthInput,
  fallbackOfficialUrl: string
): NormalizedFlightResult {
  const record = asRecord(payload);
  const meta = asRecord(record.meta);
  const stats = asRecord(record.stats);
  const rows = asArray(record.rows);
  const cheapestDates = asArray(record.cheapest_dates ?? record.cheapestDates).map((value) =>
    normalizeCheapestDate(value, fallbackOfficialUrl)
  );
  const firstCheapest = cheapestDates.find((row) => row.status === "success");
  const topFlights = asArray(asRecord(asArray(record.cheapest_dates ?? record.cheapestDates)[0]).top).map(normalizeFlightOption);
  const officialUrl = safeGoogleFlightsUrl(firstCheapest?.bookingSearchUrl, fallbackOfficialUrl);
  const sampledDates = numberValue(meta.sampled_dates ?? meta.sampledDates);
  const successfulDates = numberValue(meta.successful_dates ?? meta.successfulDates);
  const priceSummary: FlightPriceSummary = {
    minPrice: numberValue(stats.min_price),
    avgPrice: numberValue(stats.avg_of_daily_min ?? stats.avgPrice),
    priceBand: firstCheapest?.priceBand ?? "unknown",
    cheapestDate: firstCheapest?.date,
    currency: stringValue(meta.currency) ?? "KRW"
  };
  const data: FlightSearchData = {
    query: buildFlightQuery(input),
    priceSummary,
    flights: topFlights,
    bookingSearchUrl: officialUrl,
    cheapestDates
  };
  const hasFailedRows = rows.some((row) => asRecord(row).ok === false);
  const status: NormalizedFlightResult["status"] =
    !firstCheapest || hasFailedRows || topFlights.some((flight) => flight.quality === "partial") ? "partial" : "success";

  return {
    status,
    checkedAt: getCheckedAt(meta),
    officialUrl,
    summary: buildCompareSummary(data.query, priceSummary, sampledDates, successfulDates),
    data
  };
}
