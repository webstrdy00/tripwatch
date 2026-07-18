import type { TicketPlatform } from "@/lib/validation/common-schema";
import type { BusSearchInput } from "@/lib/validation/bus-schema";
import type { FlightCompareMonthInput, FlightSearchInput } from "@/lib/validation/flight-schema";
import { parseTicketInput } from "@/lib/validation/ticket-schema";

export const OFFICIAL_URLS = {
  flight: "https://www.google.com/travel/flights",
  express_bus: "https://www.kobus.co.kr",
  intercity_bus: "https://intercitybus.tmoney.co.kr",
  ticket: {
    interpark: "https://tickets.interpark.com",
    yes24: "https://ticket.yes24.com"
  },
  foresttrip: "https://foresttrip.go.kr/index.jsp"
} as const;

export type OfficialUrlType = "flight" | "express_bus" | "intercity_bus" | "ticket" | "foresttrip";
const OFFICIAL_HOSTS: Record<OfficialUrlType, readonly string[]> = {
  flight: ["google.com"],
  express_bus: ["kobus.co.kr"],
  intercity_bus: ["tmoney.co.kr"],
  ticket: ["tickets.interpark.com", "ticket.yes24.com"],
  foresttrip: ["foresttrip.go.kr"]
};

function isOfficialUrlType(value: string): value is OfficialUrlType {
  return value === "flight" || value === "express_bus" || value === "intercity_bus" || value === "ticket" || value === "foresttrip";
}

function defaultOfficialUrl(type: OfficialUrlType): string | undefined {
  if (type === "flight") {
    return OFFICIAL_URLS.flight;
  }

  if (type === "express_bus") {
    return buildExpressBusOfficialUrl();
  }

  if (type === "intercity_bus") {
    return buildIntercityBusOfficialUrl();
  }

  if (type === "foresttrip") {
    return OFFICIAL_URLS.foresttrip;
  }

  return undefined;
}

function isAllowedOfficialUrl(type: OfficialUrlType, value: string): boolean {
  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username || url.password) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return OFFICIAL_HOSTS[type].some((allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`));
  } catch {
    return false;
  }
}

export function getSafeOfficialUrl(type: string, candidate?: string, fallback?: string): string | undefined {
  if (!isOfficialUrlType(type)) {
    return undefined;
  }
  if (type === "foresttrip") {
    return OFFICIAL_URLS.foresttrip;
  }

  if (candidate && isAllowedOfficialUrl(type, candidate)) {
    return candidate;
  }

  if (fallback && isAllowedOfficialUrl(type, fallback)) {
    return fallback;
  }

  return defaultOfficialUrl(type);
}

export function getOfficialUrl(type: Exclude<OfficialUrlType, "ticket">): string {
  return OFFICIAL_URLS[type];
}

export function buildGoogleFlightsSearchUrl(
  input: Pick<FlightSearchInput, "from" | "to" | "date" | "returnDate" | "adults" | "seat" | "mode"> | Pick<FlightCompareMonthInput, "from" | "to" | "date" | "returnDate" | "adults" | "seat" | "mode" | "yearMonth">
): string {
  const params = new URLSearchParams({
    hl: "ko",
    curr: "KRW"
  });
  const tripText =
    "yearMonth" in input
      ? `${input.from} to ${input.to} ${input.yearMonth}`
      : input.mode === "roundtrip" && input.returnDate
        ? `${input.from} to ${input.to} ${input.date} return ${input.returnDate}`
        : `${input.from} to ${input.to} ${input.date}`;

  params.set("q", `${tripText} ${input.adults} adult ${input.seat}`);

  return `${OFFICIAL_URLS.flight}?${params.toString()}`;
}

export function buildExpressBusOfficialUrl(_input?: Partial<BusSearchInput>): string {
  return `${OFFICIAL_URLS.express_bus}/mrs/rotinf.do`;
}

export function buildIntercityBusOfficialUrl(_input?: Partial<BusSearchInput>): string {
  return `${OFFICIAL_URLS.intercity_bus}/otck/trmlInfEnty.do`;
}

export function getTicketOfficialUrl(platform: TicketPlatform, id?: string): string {
  if (platform === "interpark" && id) {
    return `${OFFICIAL_URLS.ticket.interpark}/goods/${encodeURIComponent(id)}`;
  }

  if (platform === "yes24" && id) {
    return `${OFFICIAL_URLS.ticket.yes24}/Perf/${encodeURIComponent(id)}`;
  }

  return OFFICIAL_URLS.ticket[platform];
}

export function buildTicketOfficialUrl(platform: TicketPlatform, id?: string): string {
  return getTicketOfficialUrl(platform, id);
}

export function getTicketOfficialUrlFromInput(input: string): string | undefined {
  const parsedInput = parseTicketInput(input);

  return parsedInput ? getTicketOfficialUrl(parsedInput.platform, parsedInput.id) : undefined;
}
