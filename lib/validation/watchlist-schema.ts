import { z } from "zod";

import { busSearchSchema } from "@/lib/validation/bus-schema";
import { watchItemTypeSchema } from "@/lib/validation/common-schema";
import { flightWatchItemSchema } from "@/lib/validation/flight-schema";
import { ticketLookupSchema } from "@/lib/validation/ticket-schema";
import { foresttripSearchSchema } from "@/lib/validation/foresttrip-schema";

const baseWatchItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  memo: z.string().trim().max(1000).optional(),
  enabled: z.boolean().default(true)
});

export const watchItemParamsByType = {
  flight: flightWatchItemSchema,
  express_bus: busSearchSchema,
  intercity_bus: busSearchSchema,
  ticket: ticketLookupSchema,
  foresttrip: foresttripSearchSchema
} as const;

function parseParamsJson(value: string, ctx: z.RefinementCtx): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "paramsJson은 올바른 JSON 문자열이어야 합니다.",
      path: ["paramsJson"]
    });
    return z.NEVER;
  }
}

export const watchItemCreateSchema = baseWatchItemSchema
  .extend({
    type: watchItemTypeSchema,
    params: z.unknown().optional(),
    paramsJson: z.string().optional()
  })
  .transform((value, ctx) => {
    if (value.params === undefined && value.paramsJson === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "params 또는 paramsJson 중 하나가 필요합니다.",
        path: ["params"]
      });
      return z.NEVER;
    }

    const rawParams = value.params === undefined && value.paramsJson ? parseParamsJson(value.paramsJson, ctx) : value.params;
    const schema = watchItemParamsByType[value.type];
    const parsed = schema.safeParse(rawParams);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          ...issue,
          path: ["params", ...issue.path]
        });
      }
      return z.NEVER;
    }

    return {
      type: value.type,
      title: value.title,
      memo: value.memo,
      enabled: value.enabled,
      params: parsed.data,
      paramsJson: JSON.stringify(parsed.data)
    };
  });

export const watchItemUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  memo: z.string().trim().max(1000).nullable().optional(),
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "수정할 값이 필요합니다."
});

export const watchItemListQuerySchema = z.object({
  enabled: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  type: watchItemTypeSchema.optional()
});

export const watchItemTypeParamSchema = z.object({
  type: watchItemTypeSchema
});

export type WatchItemCreateInput = z.infer<typeof watchItemCreateSchema>;
export type WatchItemUpdateInput = z.infer<typeof watchItemUpdateSchema>;
export type WatchItemListQueryInput = z.infer<typeof watchItemListQuerySchema>;
