import { z } from "zod";

import { isKstTodayOrFuture, isRealIsoDate } from "@/lib/dates";

const compactDatePattern = /^\d{8}$/;
const asciiDecimalPattern = /^[0-9]+(?:\.[0-9]+)?$/;
const asciiDigitsPattern = /^[0-9]+$/;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function normalizeForestName(value: unknown): unknown {
  return typeof value === "string" ? value.trim().normalize("NFC") : value;
}

function boundedString(minimum: number, maximum: number) {
  return z.string().superRefine((value, ctx) => {
    const length = codePointLength(value);

    if (length < minimum || length > maximum) {
      ctx.addIssue({
        code: "custom",
        message: `${minimum}~${maximum}자여야 합니다.`
      });
    }
  });
}

function realCompactDate(value: string): boolean {
  if (!compactDatePattern.test(value)) {
    return false;
  }

  return isRealIsoDate(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
}

const forestNameSchema = z.preprocess(
  normalizeForestName,
  boundedString(1, 100).refine((value) => !hasControlCharacter(value), "제어 문자를 포함할 수 없습니다.")
);
const helperForestNameSchema = boundedString(1, 100);
const compactDateSchema = z.string().refine(realCompactDate, "실제 존재하는 YYYYMMDD 날짜여야 합니다.");
const categorySchema = z.enum(["01", "02"]);

export const foresttripSearchSchema = z.object({
  forestName: forestNameSchema,
  date: z.string().refine(isRealIsoDate, "실제 존재하는 YYYY-MM-DD 날짜여야 합니다.").refine(isKstTodayOrFuture, "오늘 또는 미래의 KST 날짜여야 합니다."),
  category: categorySchema
}).strict();

export const foresttripRequestSchema = foresttripSearchSchema;

const helperFailureSchema = z.object({
  forest_id: boundedString(0, 100),
  category: categorySchema,
  error: boundedString(0, 500)
}).strict();

const areaSchema = z.union([
  z.null(),
  z.number().finite().min(0).max(1_000_000),
  z.string().refine((value) => value.length >= 1 && value.length <= 20 && asciiDecimalPattern.test(value), "0~1000000 범위의 ASCII 십진수여야 합니다.")
]);

const capacitySchema = z.union([
  z.null(),
  z.number().int().min(0).max(100_000),
  z.string().refine((value) => {
    if (!asciiDigitsPattern.test(value)) {
      return false;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= 100_000;
  }, "0~100000 정수여야 합니다.")
]);

const roomSchema = z.object({
  forest_id: boundedString(1, 100),
  forest: helperForestNameSchema,
  use_dt: compactDateSchema,
  day: z.union([z.null(), boundedString(0, 20)]),
  name: boundedString(1, 200),
  area: areaSchema,
  capacity: capacitySchema,
  category: boundedString(1, 100),
  region: z.union([z.null(), boundedString(0, 100)]),
  waiting_possible: z.union([
    z.null(),
    z.boolean(),
    z.number().finite().min(-1_000_000).max(1_000_000),
    boundedString(0, 100)
  ])
}).strict();

const resultSchema = z.object({
  forest: helperForestNameSchema,
  dates: z.array(z.object({
    use_dt: compactDateSchema,
    rooms: z.array(roomSchema).min(1).max(500)
  }).strict()).min(1).max(1)
}).strict();

export const foresttripHelperPayloadSchema = z.object({
  forests_scanned: z.number().int().min(0).max(1_000),
  filter_hits: z.number().int().min(0).max(1_000),
  fetch_failures: z.number().int().min(0).max(1_000),
  failures: z.array(helperFailureSchema).max(20),
  concurrency: z.number().int().min(0).max(1_000),
  date_range: z.object({
    from: compactDateSchema,
    to: compactDateSchema
  }).strict(),
  results: z.array(resultSchema).max(1)
}).strict().superRefine((payload, ctx) => {
  if (payload.forests_scanned !== 1) {
    ctx.addIssue({ code: "custom", message: "forests_scanned는 1이어야 합니다.", path: ["forests_scanned"] });
  }
  if (payload.fetch_failures !== 0) {
    ctx.addIssue({ code: "custom", message: "fetch_failures는 0이어야 합니다.", path: ["fetch_failures"] });
  }
  if (payload.concurrency !== 1) {
    ctx.addIssue({ code: "custom", message: "concurrency는 1이어야 합니다.", path: ["concurrency"] });
  }
  if (payload.failures.length !== 0) {
    ctx.addIssue({ code: "custom", message: "failures는 비어 있어야 합니다.", path: ["failures"] });
  }
  if (payload.results.length === 0 && payload.filter_hits !== 0) {
    ctx.addIssue({ code: "custom", message: "빈 결과의 filter_hits는 0이어야 합니다.", path: ["filter_hits"] });
  }
});

export type ForesttripSearchInput = z.infer<typeof foresttripSearchSchema>;
export type ForesttripHelperPayload = z.infer<typeof foresttripHelperPayloadSchema>;
