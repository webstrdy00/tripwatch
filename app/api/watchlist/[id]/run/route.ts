import { NextResponse } from "next/server";

import { failedResponse } from "@/lib/api-response";
import { db } from "@/lib/db";
import { toApiError, TripWatchError } from "@/lib/errors";

const SOURCE = "tripwatch:watchlist-run";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function errorStatus(error: unknown): number {
  if (error instanceof TripWatchError && error.code === "NOT_FOUND") {
    return 404;
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

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const item = await db.watchItem.findUnique({
      where: {
        id
      }
    });

    if (!item) {
      throw new TripWatchError("NOT_FOUND", "관심 조건을 찾을 수 없습니다.");
    }

    if (!item.enabled) {
      return NextResponse.json(
        failedResponse({
          source: SOURCE,
          summary: "비활성 관심 조건은 다시 조회할 수 없습니다.",
          error: {
            code: "DISABLED_WATCH_ITEM",
            message: "비활성 관심 조건은 다시 조회할 수 없습니다."
          }
        }),
        { status: 409 }
      );
    }

    return NextResponse.json(
      failedResponse({
        source: SOURCE,
        summary: "이 관심 조건의 다시 조회는 해당 service 구현 후 사용할 수 있습니다.",
        error: {
          code: "NOT_IMPLEMENTED",
          message: "이 관심 조건의 다시 조회는 해당 service 구현 후 사용할 수 있습니다."
        }
      }),
      { status: 501 }
    );
  } catch (error) {
    return jsonError(error);
  }
}
