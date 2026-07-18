import { db } from "@/lib/db";
import { summarizeError, TripWatchError } from "@/lib/errors";
import { getSafeOfficialUrl } from "@/lib/official-urls";
import type { TripWatchApiResponse } from "@/lib/api-response";

type CreateQueryResultInput<T> = {
  type: string;
  response: TripWatchApiResponse<T>;
  watchItemId?: string | null;
};

function toCheckedAtDate(value: string): Date {
  const checkedAt = new Date(value);

  if (Number.isNaN(checkedAt.getTime())) {
    throw new TripWatchError("UNKNOWN_ERROR", "조회 시각이 올바르지 않아 결과를 저장할 수 없습니다.");
  }

  return checkedAt;
}

export async function createQueryResultFromResponse<T>({
  type,
  response,
  watchItemId
}: CreateQueryResultInput<T>) {
  return db.queryResult.create({
    data: {
      watchItemId: watchItemId ?? null,
      type,
      status: response.status,
      source: response.source,
      checkedAt: toCheckedAtDate(response.checkedAt),
      summary: response.summary,
      officialUrl: type === "foresttrip" ? getSafeOfficialUrl("foresttrip") : getSafeOfficialUrl(type, response.officialUrl),
      resultJson: JSON.stringify(response.data ?? {}),
      errorCode: response.error?.code,
      errorText: response.error ? summarizeError(response.error.message) : undefined
    }
  });
}
