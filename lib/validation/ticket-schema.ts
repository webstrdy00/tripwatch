import { z } from "zod";

import { ticketPlatformSchema, type TicketPlatform } from "@/lib/validation/common-schema";

export type ParsedTicketInput = {
  platform: TicketPlatform;
  id: string;
  normalizedInput: string;
};

const ticketPlatformIdSchema = z.string().regex(/^(interpark|yes24):[A-Za-z0-9_-]+$/, "공연 ID는 interpark:id 또는 yes24:id 형식이어야 합니다.");

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseTicketInput(input: string): ParsedTicketInput | undefined {
  const trimmed = input.trim();
  const platformId = /^(interpark|yes24):([A-Za-z0-9_-]+)$/.exec(trimmed);

  if (platformId) {
    const platform = ticketPlatformSchema.parse(platformId[1]);
    const id = platformId[2];
    return {
      platform,
      id,
      normalizedInput: `${platform}:${id}`
    };
  }

  const parsedUrl = z.string().url().safeParse(trimmed);

  if (!parsedUrl.success) {
    return undefined;
  }

  const url = new URL(parsedUrl.data);
  const hostname = url.hostname.toLowerCase();

  if (hostname.includes("tickets.interpark.com")) {
    const match = /\/goods\/([A-Za-z0-9_-]+)/i.exec(url.pathname);

    if (!match) {
      return undefined;
    }

    return {
      platform: "interpark",
      id: match[1],
      normalizedInput: `interpark:${match[1]}`
    };
  }

  if (hostname.includes("ticket.yes24.com")) {
    const match = /\/(?:New\/)?Perf\/(?:Detail\/)?(?:View\/)?([A-Za-z0-9_-]+)/i.exec(url.pathname);

    if (!match) {
      return undefined;
    }

    return {
      platform: "yes24",
      id: match[1],
      normalizedInput: `yes24:${match[1]}`
    };
  }

  return undefined;
}

export const ticketInputSchema = z.string().trim().min(1, "공연 URL 또는 platform:id가 필요합니다.").superRefine((value, ctx) => {
  if (!ticketPlatformIdSchema.safeParse(value).success && !parseTicketInput(value)) {
    ctx.addIssue({
      code: "custom",
      message: "URL 또는 platform:id 형식을 확인하세요. 예: interpark:26000541, yes24:58026"
    });
  }
});

export const ticketLookupSchema = z.object({
  input: ticketInputSchema,
  mode: z.enum(["schedule", "seats"]).default("seats")
});

export const ticketScheduleRequestSchema = z.object({
  input: ticketInputSchema,
  mode: z.literal("schedule").default("schedule"),
  watchItemId: z.preprocess(normalizeOptionalString, z.string().min(1).optional())
});

export const ticketSeatsRequestSchema = z.object({
  input: ticketInputSchema,
  mode: z.literal("seats").default("seats"),
  watchItemId: z.preprocess(normalizeOptionalString, z.string().min(1).optional())
});

export type TicketLookupInput = z.infer<typeof ticketLookupSchema>;
export type TicketScheduleRequestInput = z.infer<typeof ticketScheduleRequestSchema>;
export type TicketSeatsRequestInput = z.infer<typeof ticketSeatsRequestSchema>;
