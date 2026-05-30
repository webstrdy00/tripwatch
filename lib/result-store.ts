import { db } from "@/lib/db";
import { summarizeError } from "@/lib/errors";
import type { TripWatchApiResponse } from "@/lib/api-response";

type CreateQueryResultInput<T> = {
  type: string;
  response: TripWatchApiResponse<T>;
  watchItemId?: string;
};

function toCheckedAtDate(value: string): Date {
  const checkedAt = new Date(value);
  return Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt;
}

export async function createQueryResultFromResponse<T>({
  type,
  response,
  watchItemId
}: CreateQueryResultInput<T>) {
  return db.queryResult.create({
    data: {
      watchItemId,
      type,
      status: response.status,
      source: response.source,
      checkedAt: toCheckedAtDate(response.checkedAt),
      summary: response.summary,
      officialUrl: response.officialUrl,
      resultJson: JSON.stringify(response.data ?? {}),
      errorCode: response.error?.code,
      errorText: response.error ? summarizeError(response.error.message) : undefined
    }
  });
}
