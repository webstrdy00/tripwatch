import { NextResponse } from "next/server";

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
  const { id } = await context.params;
  const { response } = await runWatchItemById(id);

  return NextResponse.json(response, {
    status: httpStatusForRunResponse(response)
  });
}
