import { z } from "zod";

import { ticketPlatformSchema, type TicketPlatform } from "@/lib/validation/common-schema";
import type { FlightCompareMonthInput, FlightSearchInput } from "@/lib/validation/flight-schema";

export const OFFICIAL_URLS = {
  flight: "https://www.google.com/travel/flights",
  express_bus: "https://www.kobus.co.kr",
  intercity_bus: "https://intercitybus.tmoney.co.kr",
  ticket: {
    interpark: "https://tickets.interpark.com",
    yes24: "https://ticket.yes24.com"
  }
} as const;

export type OfficialUrlType = "flight" | "express_bus" | "intercity_bus" | "ticket";

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

export function getTicketOfficialUrl(platform: TicketPlatform, id?: string): string {
  if (platform === "interpark" && id) {
    return `${OFFICIAL_URLS.ticket.interpark}/goods/${encodeURIComponent(id)}`;
  }

  if (platform === "yes24" && id) {
    return `${OFFICIAL_URLS.ticket.yes24}/Perf/${encodeURIComponent(id)}`;
  }

  return OFFICIAL_URLS.ticket[platform];
}

export function getTicketOfficialUrlFromInput(input: string): string | undefined {
  const platformId = /^(interpark|yes24):([A-Za-z0-9_-]+)$/.exec(input);

  if (platformId) {
    const platform = ticketPlatformSchema.parse(platformId[1]);
    return getTicketOfficialUrl(platform, platformId[2]);
  }

  const url = z.string().url().safeParse(input);

  if (!url.success) {
    return undefined;
  }

  const parsed = new URL(url.data);

  if (parsed.hostname.includes("interpark.com")) {
    return input;
  }

  if (parsed.hostname.includes("yes24.com")) {
    return input;
  }

  return undefined;
}
