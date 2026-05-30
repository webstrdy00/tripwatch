import { z } from "zod";

import { ticketPlatformSchema } from "@/lib/validation/common-schema";

const ticketPlatformIdSchema = z
  .string()
  .regex(/^(interpark|yes24):[A-Za-z0-9_-]+$/, "공연 ID는 interpark:id 또는 yes24:id 형식이어야 합니다.");

const officialTicketUrlSchema = z.string().url().refine(
  (value) => {
    const hostname = new URL(value).hostname;
    return hostname.includes("interpark.com") || hostname.includes("yes24.com");
  },
  { message: "공연 URL은 인터파크 또는 YES24 URL이어야 합니다." }
);

export const ticketInputSchema = z.union([ticketPlatformIdSchema, officialTicketUrlSchema]);

export const ticketLookupSchema = z.object({
  input: ticketInputSchema,
  mode: z.enum(["schedule", "seats"]).default("seats")
});

export function parseTicketPlatform(input: string) {
  const match = /^(interpark|yes24):([A-Za-z0-9_-]+)$/.exec(input);

  if (match) {
    return {
      platform: ticketPlatformSchema.parse(match[1]),
      id: match[2]
    };
  }

  const url = new URL(input);
  const platform = url.hostname.includes("interpark.com") ? "interpark" : "yes24";
  const id = url.pathname.split("/").filter(Boolean).at(-1);

  return {
    platform: ticketPlatformSchema.parse(platform),
    id
  };
}

export type TicketLookupInput = z.infer<typeof ticketLookupSchema>;
