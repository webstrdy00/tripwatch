import { NextResponse } from "next/server";

import { parseJsonBodyWithSchema, successResponse } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { db } from "@/lib/db";
import { TripWatchError } from "@/lib/errors";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";
import { serializeWatchItems, watchItemInclude } from "@/lib/watchlist";
import { watchItemCreateSchema, watchItemListQuerySchema } from "@/lib/validation/watchlist-schema";

const SOURCE = "tripwatch:watchlist";

export const dynamic = "force-dynamic";

function jsonError(error: unknown) {
  const routeError = buildApiRouteError(error, SOURCE);

  return NextResponse.json(routeError.body, { status: routeError.status });
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
    assertLocalOperatorRequest(request);
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
    assertLocalOperatorRequest(request);
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
    return jsonError(error);
  }
}
