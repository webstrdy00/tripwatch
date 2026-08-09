import { z } from "zod";

import { busTimeSchema, databaseIdSchema, isoDateSchema } from "@/lib/validation/common-schema";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function normalizeOptionalString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeInteger(value: unknown): unknown {
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }

  return value;
}

function isRealIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const busDateSchema = isoDateSchema.refine(isRealIsoDate, "실제 존재하는 날짜를 입력해야 합니다.");
const passengerCountSchema = z.preprocess(normalizeInteger, z.number().int().min(1).max(9).default(1));

export const busSearchSchema = z.object({
  departName: z.string().trim().min(1, "출발 터미널을 입력해야 합니다.").max(80),
  arriveName: z.string().trim().min(1, "도착 터미널을 입력해야 합니다.").max(80),
  date: busDateSchema,
  time: busTimeSchema,
  passengers: passengerCountSchema
});

export const expressBusSearchSchema = busSearchSchema;
export const intercityBusSearchSchema = busSearchSchema;

export const expressBusSearchRequestSchema = busSearchSchema.extend({
  watchItemId: z.preprocess(normalizeOptionalString, databaseIdSchema.optional())
}).strict();

export const intercityBusSearchRequestSchema = busSearchSchema.extend({
  watchItemId: z.preprocess(normalizeOptionalString, databaseIdSchema.optional())
}).strict();

export type BusSearchInput = z.infer<typeof busSearchSchema>;
export type BusSearchRequestInput = z.infer<typeof expressBusSearchRequestSchema>;
