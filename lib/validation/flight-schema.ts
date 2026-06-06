import { z } from "zod";

import { seatSchema } from "@/lib/validation/common-schema";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const yearMonthPattern = /^\d{4}-\d{2}$/;

function normalizeAirport(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toUpperCase() : value;
}

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

export const flightIataCodeSchema = z.preprocess(
  normalizeAirport,
  z.string().regex(/^[A-Z]{3}$/, "IATA 코드는 대문자 3자리여야 합니다.")
);

export const flightIsoDateSchema = z
  .string()
  .regex(isoDatePattern, "날짜는 YYYY-MM-DD 형식이어야 합니다.")
  .refine(isRealIsoDate, "실제 존재하는 날짜를 입력해야 합니다.");

export const flightYearMonthSchema = z.string().regex(yearMonthPattern, "월별 비교는 YYYY-MM 형식이어야 합니다.");

const flightAdultCountSchema = z.preprocess(normalizeInteger, z.number().int().min(1).max(9).default(1));
const flightLimitSchema = z.preprocess(normalizeInteger, z.number().int().min(1).max(20).default(5));

const flightSearchObjectSchema = z.object({
  from: flightIataCodeSchema,
  to: flightIataCodeSchema,
  date: flightIsoDateSchema,
  returnDate: z.preprocess(normalizeOptionalString, flightIsoDateSchema.optional()),
  adults: flightAdultCountSchema,
  seat: seatSchema.default("economy"),
  mode: z.enum(["oneway", "roundtrip"]).default("roundtrip"),
  limit: flightLimitSchema
});

type FlightSearchRuleValue = z.output<typeof flightSearchObjectSchema>;

function withFlightSearchRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((value) => {
      const flight = value as FlightSearchRuleValue;
      return flight.from !== flight.to;
    }, {
      message: "출발지와 도착지는 달라야 합니다.",
      path: ["to"]
    })
    .refine((value) => {
      const flight = value as FlightSearchRuleValue;
      return flight.mode !== "roundtrip" || Boolean(flight.returnDate);
    }, {
      message: "왕복 검색에는 귀국일이 필요합니다.",
      path: ["returnDate"]
    })
    .refine((value) => {
      const flight = value as FlightSearchRuleValue;
      return !flight.returnDate || flight.returnDate >= flight.date;
    }, {
      message: "귀국일은 출발일보다 빠를 수 없습니다.",
      path: ["returnDate"]
    });
}

export const flightSearchSchema = withFlightSearchRules(flightSearchObjectSchema);

export const flightSearchRequestSchema = withFlightSearchRules(flightSearchObjectSchema.extend({
  watchItemId: z.preprocess(normalizeOptionalString, z.string().min(1).optional())
}));

const flightCompareMonthObjectSchema = flightSearchObjectSchema.extend({
  yearMonth: z.preprocess(normalizeOptionalString, flightYearMonthSchema.optional()),
  month: z.preprocess(normalizeOptionalString, flightYearMonthSchema.optional()),
  sample: z.enum(["weekly", "daily"]).default("weekly"),
  watchItemId: z.preprocess(normalizeOptionalString, z.string().min(1).optional())
});

export const flightCompareMonthSchema = withFlightSearchRules(flightCompareMonthObjectSchema)
  .transform((value, ctx) => {
    const yearMonth = value.yearMonth ?? value.month ?? value.date.slice(0, 7);

    if (!yearMonthPattern.test(yearMonth)) {
      ctx.addIssue({
        code: "custom",
        message: "yearMonth는 YYYY-MM 형식이어야 합니다.",
        path: ["yearMonth"]
      });
      return z.NEVER;
    }

    return {
      ...value,
      yearMonth
    };
  });

export type FlightSearchInput = z.infer<typeof flightSearchSchema>;
export type FlightSearchRequestInput = z.infer<typeof flightSearchRequestSchema>;
export type FlightCompareMonthInput = z.infer<typeof flightCompareMonthSchema>;
