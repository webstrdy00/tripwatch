import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { failedResponse, parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { db } from "@/lib/db";
import { toApiError, TripWatchError } from "@/lib/errors";
import { serializeWatchItems } from "@/lib/watchlist";
import { watchItemCreateSchema, watchItemListQuerySchema } from "@/lib/validation/watchlist-schema";

const SOURCE = "tripwatch:watchlist";

export const dynamic = "force-dynamic";

const watchItemInclude = {
  results: {
    orderBy: [
      {
        checkedAt: "desc" as const
      },
      {
        createdAt: "desc" as const
      },
      {
        id: "desc" as const
      }
    ],
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

function parseListQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = watchItemListQuerySchema.safeParse({
    enabled: searchParams.get("enabled") ?? undefined,
    type: searchParams.get("type") ?? undefined
  });

  if (!parsed.success) {
    throw new TripWatchError("VALIDATION_ERROR", "watchlist query param이 올바르지 않습니다.", {
      raw: parsed.error.issues.map((issue) => issue.message).join("; ")
    });
  }

  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const query = parseListQuery(request);
    const items = await db.watchItem.findMany({
      where: {
        enabled: query.enabled,
        type: query.type
      },
      orderBy: {
        updatedAt: "desc"
      },
      include: watchItemInclude
    });

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: `${items.length}개 관심 조건`,
        data: {
          items: serializeWatchItems(items)
        }
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonBodyWithSchema(request, watchItemCreateSchema);
    const item = await db.watchItem.create({
      data: {
        type: input.type,
        title: input.title,
        paramsJson: input.paramsJson,
        memo: input.memo || null,
        enabled: input.enabled
      },
      include: watchItemInclude
    });

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "관심 조건을 저장했습니다.",
        data: {
          item: serializeWatchItems([item])[0]
        }
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonError(
        new TripWatchError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {
          raw: error.issues.map((issue) => issue.message).join("; "),
          cause: error
        })
      );
    }

    return jsonError(error);
  }
}
