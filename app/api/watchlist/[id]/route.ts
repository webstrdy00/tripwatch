import { NextResponse } from "next/server";

import { failedResponse, parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { db } from "@/lib/db";
import { toApiError, TripWatchError } from "@/lib/errors";
import { serializeWatchItem } from "@/lib/watchlist";
import { watchItemUpdateSchema } from "@/lib/validation/watchlist-schema";

const SOURCE = "tripwatch:watchlist";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const watchItemInclude = {
  results: {
    orderBy: {
      checkedAt: "desc" as const
    },
    take: 1
  }
};

function errorStatus(error: unknown): number {
  if (error instanceof TripWatchError) {
    if (error.code === "VALIDATION_ERROR") {
      return 400;
    }

    if (error.code === "NOT_FOUND") {
      return 404;
    }
  }

  return 500;
}

function jsonError(error: unknown) {
  const apiError = toApiError(error);

  return NextResponse.json(
    failedResponse({
      source: SOURCE,
      summary: apiError.message,
      error: apiError
    }),
    { status: errorStatus(error) }
  );
}

async function assertWatchItemExists(id: string) {
  const item = await db.watchItem.findUnique({
    where: {
      id
    }
  });

  if (!item) {
    throw new TripWatchError("NOT_FOUND", "관심 조건을 찾을 수 없습니다.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await assertWatchItemExists(id);

    const input = await parseJsonBodyWithSchema(request, watchItemUpdateSchema);
    const item = await db.watchItem.update({
      where: {
        id
      },
      data: {
        title: input.title,
        memo: input.memo === undefined ? undefined : input.memo || null,
        enabled: input.enabled
      },
      include: watchItemInclude
    });

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "관심 조건을 수정했습니다.",
        data: {
          item: serializeWatchItem(item)
        }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await assertWatchItemExists(id);
    await db.watchItem.delete({
      where: {
        id
      }
    });

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "관심 조건을 삭제했습니다.",
        data: {
          id
        }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
