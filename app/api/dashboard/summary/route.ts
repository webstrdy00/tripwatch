import { NextResponse } from "next/server";

import { failedResponse, successResponse } from "@/lib/api-response";
import { getDashboardSummary } from "@/lib/dashboard";
import { summarizeError } from "@/lib/errors";

const SOURCE = "tripwatch:dashboard-summary";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getDashboardSummary();

    return NextResponse.json(
      successResponse({
        source: SOURCE,
        summary: "대시보드 요약을 불러왔습니다.",
        data: summary
      })
    );
  } catch (error) {
    const message = summarizeError(error);

    return NextResponse.json(
      failedResponse({
        source: SOURCE,
        summary: message,
        error: {
          code: "UNKNOWN_ERROR",
          message
        }
      }),
      { status: 500 }
    );
  }
}
