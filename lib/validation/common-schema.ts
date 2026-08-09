import { z } from "zod";
import { TripWatchError } from "@/lib/errors";

export const tripWatchStatusSchema = z.enum(["success", "partial", "failed"]);
export const iataCodeSchema = z.string().regex(/^[A-Z]{3}$/, "IATA 코드는 대문자 3자리여야 합니다.");
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식이어야 합니다.");
export const busTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시간은 HH:mm 형식이어야 합니다.");
export const seatSchema = z.enum(["economy", "premium-economy", "business", "first"]);
export const ticketPlatformSchema = z.enum(["interpark", "yes24"]);
export const watchItemTypeSchema = z.enum(["flight", "express_bus", "intercity_bus", "ticket", "foresttrip"]);
export const databaseIdSchema = z.string().trim().min(1).max(128);
export function parseDatabaseId(value: unknown): string {
  const parsed = databaseIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new TripWatchError("VALIDATION_ERROR", "식별자가 올바르지 않습니다.");
  }

  return parsed.data;
}

export type TripWatchStatus = z.infer<typeof tripWatchStatusSchema>;
export type Seat = z.infer<typeof seatSchema>;
export type TicketPlatform = z.infer<typeof ticketPlatformSchema>;
export type WatchItemType = z.infer<typeof watchItemTypeSchema>;

// 문서상 후보지만 현재 API 생성 스키마에서는 허용하지 않는다.
export const futureWatchItemTypes = ["srt", "ktx"] as const;

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(50).optional()
});
