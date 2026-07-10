import { NextResponse } from "next/server";

import { failedResponse } from "@/lib/api-response";
import {
  httpStatusForRunResponse,
  runWatchItemById
} from "@/lib/services/watchlist-run-service";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { response } = await runWatchItemById(id);

    return NextResponse.json(response, {
      status: httpStatusForRunResponse(response)
    });
  } catch {
    return NextResponse.json(
      failedResponse({
        source: "tripwatch:watchlist-run",
        summary: "관심 조건 다시 조회를 완료하지 못했습니다.",
        error: {
          code: "UNKNOWN_ERROR",
          message: "관심 조건 다시 조회를 완료하지 못했습니다."
        }
      }),
      {
        status: 500
      }
    );
  }
}
