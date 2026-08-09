import { NextResponse } from "next/server";

import { successResponse } from "@/lib/api-response";
import { buildApiRouteError } from "@/lib/api-route-error";
import { getDashboardSummary } from "@/lib/dashboard";
import { assertLocalOperatorRequest } from "@/lib/security/local-operator";

const SOURCE = "tripwatch:dashboard-summary";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalOperatorRequest(request);
    const summary = await getDashboardSummary();

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "대시보드 요약을 불러왔습니다.",
        data: summary
      })
    );
  } catch (error) {
    const routeError = buildApiRouteError(error, SOURCE);
    return NextResponse.json(routeError.body, { status: routeError.status });
  }
}
