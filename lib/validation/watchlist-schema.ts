import { z } from "zod";

import { busSearchSchema } from "@/lib/validation/bus-schema";
import { watchItemTypeSchema } from "@/lib/validation/common-schema";
import { flightSearchSchema } from "@/lib/validation/flight-schema";
import { ticketLookupSchema } from "@/lib/validation/ticket-schema";

const baseWatchItemSchema = z.object({
  title: z.string().trim().min(1).max(120),
  memo: z.string().trim().max(1000).optional(),
  enabled: z.boolean().default(true)
});

export const watchItemParamsByType = {
  flight: flightSearchSchema,
  express_bus: busSearchSchema,
  intercity_bus: busSearchSchema,
  ticket: ticketLookupSchema
} as const;

export const watchItemCreateSchema = z.discriminatedUnion("type", [
  baseWatchItemSchema.extend({
    type: z.literal("flight"),
    params: flightSearchSchema
  }),
  baseWatchItemSchema.extend({
    type: z.literal("express_bus"),
    params: busSearchSchema
  }),
  baseWatchItemSchema.extend({
    type: z.literal("intercity_bus"),
    params: busSearchSchema
  }),
  baseWatchItemSchema.extend({
    type: z.literal("ticket"),
    params: ticketLookupSchema
  })
]);

export const watchItemUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  memo: z.string().trim().max(1000).nullable().optional(),
  enabled: z.boolean().optional()
});

export const watchItemTypeParamSchema = z.object({
  type: watchItemTypeSchema
});

export type WatchItemCreateInput = z.infer<typeof watchItemCreateSchema>;
export type WatchItemUpdateInput = z.infer<typeof watchItemUpdateSchema>;
