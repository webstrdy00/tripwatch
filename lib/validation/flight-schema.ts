import { z } from "zod";

import { iataCodeSchema, isoDateSchema, seatSchema } from "@/lib/validation/common-schema";

export const flightSearchSchema = z
  .object({
    from: iataCodeSchema,
    to: iataCodeSchema,
    date: isoDateSchema,
    returnDate: isoDateSchema.optional(),
    adults: z.number().int().min(1).max(9).default(1),
    seat: seatSchema.default("economy"),
    mode: z.enum(["oneway", "roundtrip"]).default("roundtrip"),
    limit: z.number().int().min(1).max(20).default(5)
  })
  .refine((value) => value.from !== value.to, {
    message: "출발지와 도착지는 달라야 합니다.",
    path: ["to"]
  });

export const flightCompareMonthSchema = flightSearchSchema.extend({
  month: z.string().regex(/^\d{4}-\d{2}$/, "월별 비교는 YYYY-MM 형식이어야 합니다.")
});

export type FlightSearchInput = z.infer<typeof flightSearchSchema>;
export type FlightCompareMonthInput = z.infer<typeof flightCompareMonthSchema>;
