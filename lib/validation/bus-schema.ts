import { z } from "zod";

import { busTimeSchema, isoDateSchema } from "@/lib/validation/common-schema";

export const busSearchSchema = z.object({
  departName: z.string().trim().min(1, "출발 터미널을 입력해야 합니다.").max(80),
  arriveName: z.string().trim().min(1, "도착 터미널을 입력해야 합니다.").max(80),
  date: isoDateSchema,
  time: busTimeSchema,
  passengers: z.number().int().min(1).max(9).default(1)
});

export const expressBusSearchSchema = busSearchSchema;
export const intercityBusSearchSchema = busSearchSchema;

export type BusSearchInput = z.infer<typeof busSearchSchema>;
