import { db } from "@/lib/db";
import { summarizeError, TripWatchError } from "@/lib/errors";
import { getSafeOfficialUrl } from "@/lib/official-urls";
import type { TripWatchApiResponse } from "@/lib/api-response";

export type WatchItemAssociationSnapshot = {
  id: string;
  type: string;
  updatedAt: Date;
};

export async function preflightWatchItemAssociation(
  watchItemId: string | null | undefined,
  expectedType: string
): Promise<WatchItemAssociationSnapshot | null> {
  if (!watchItemId) {
    return null;
  }

  const item = await db.watchItem.findUnique({
    where: { id: watchItemId },
    select: { id: true, type: true, updatedAt: true }
  });

  if (!item) {
    throw new TripWatchError("WATCH_ITEM_NOT_FOUND", "관심 조건을 찾을 수 없습니다.");
  }

  if (item.type !== expectedType) {
    throw new TripWatchError("WATCH_ITEM_TYPE_MISMATCH", "관심 조건 유형이 조회 유형과 일치하지 않습니다.");
  }

  return item;
}

type CreateQueryResultInput<T> = {
  type: string;
  response: TripWatchApiResponse<T>;
  watchItemId?: string | null;
  association?: WatchItemAssociationSnapshot | null;
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
  watchItemId,
  association
}: CreateQueryResultInput<T>) {
  const associatedWatchItemId = association?.id ?? watchItemId ?? null;
  const data = {
    watchItemId: associatedWatchItemId,
    type,
    status: response.status,
    source: response.source,
    checkedAt: toCheckedAtDate(response.checkedAt),
    summary: response.summary,
    officialUrl: type === "foresttrip" ? getSafeOfficialUrl("foresttrip") : getSafeOfficialUrl(type, response.officialUrl),
    resultJson: JSON.stringify(response.data ?? {}),
    errorCode: response.error?.code,
    errorText: response.error ? summarizeError(response.error.message) : undefined
  };

  if (!associatedWatchItemId) {
    return db.queryResult.create({ data });
  }

  return db.$transaction(async (transaction) => {
    const item = await transaction.watchItem.findUnique({
      where: { id: associatedWatchItemId },
      select: { type: true, updatedAt: true }
    });

    if (!item) {
      throw new TripWatchError("WATCH_ITEM_NOT_FOUND", "관심 조건을 찾을 수 없습니다.");
    }

    if (
      item.type !== type ||
      (association !== undefined &&
        association !== null &&
        item.updatedAt.getTime() !== association.updatedAt.getTime())
    ) {
      throw new TripWatchError("WATCH_ITEM_TYPE_MISMATCH", "관심 조건이 조회 중 변경되었습니다.");
    }

    return transaction.queryResult.create({ data });
  });
}
