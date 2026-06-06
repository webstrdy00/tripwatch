import { NextResponse } from "next/server";

import { failedResponse } from "@/lib/api-response";
import { db } from "@/lib/db";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { BusSearchData } from "@/lib/normalize/normalize-bus";
import type { FlightSearchData } from "@/lib/normalize/normalize-flight";
import { buildExpressBusOfficialUrl, buildIntercityBusOfficialUrl, getOfficialUrl } from "@/lib/official-urls";
import { createQueryResultFromResponse } from "@/lib/result-store";
import { searchExpressBuses } from "@/lib/services/express-bus-service";
import { searchFlights } from "@/lib/services/flight-service";
import { searchIntercityBuses } from "@/lib/services/intercity-bus-service";
import { expressBusSearchSchema, intercityBusSearchSchema } from "@/lib/validation/bus-schema";
import { flightSearchSchema } from "@/lib/validation/flight-schema";

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

function httpStatus(errorCode: string | undefined): number {
  if (errorCode === "VALIDATION_ERROR") {
    return 400;
  }

  if (errorCode === "TERMINAL_NOT_FOUND" || errorCode === "NO_RESULTS") {
    return 404;
  }

  if (errorCode === "HELPER_TIMEOUT") {
    return 504;
  }

  if (errorCode === "HELPER_FAILED" || errorCode === "PARSE_ERROR") {
    return 502;
  }

  return 500;
}

function parseParamsJson(paramsJson: string): unknown {
  try {
    return JSON.parse(paramsJson) as unknown;
  } catch (error) {
    throw new TripWatchError("VALIDATION_ERROR", "관심 조건 JSON이 올바르지 않습니다.", {
      cause: error
    });
  }
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

    if (item.type === "flight") {
      const parsed = flightSearchSchema.safeParse(parseParamsJson(item.paramsJson));

      if (!parsed.success) {
        const response = failedResponse<FlightSearchData>({
          source: "google-flights-link",
          officialUrl: getOfficialUrl("flight"),
          summary: "저장된 항공권 조건이 올바르지 않습니다.",
          error: {
            code: "VALIDATION_ERROR",
            message: "저장된 항공권 조건이 올바르지 않습니다.",
            raw: parsed.error.issues.map((issue) => issue.message).join("; ")
          }
        });
        await createQueryResultFromResponse({
          type: "flight",
          response,
          watchItemId: item.id
        });

        return NextResponse.json(response, { status: 400 });
      }

      const response = await searchFlights(parsed.data);
      await createQueryResultFromResponse({
        type: "flight",
        response,
        watchItemId: item.id
      });

      return NextResponse.json(response, {
        status: response.status === "failed" ? httpStatus(response.error?.code) : 200
      });
    }

    if (item.type === "express_bus") {
      const parsed = expressBusSearchSchema.safeParse(parseParamsJson(item.paramsJson));

      if (!parsed.success) {
        const response = failedResponse<BusSearchData>({
          source: "kobus-link",
          officialUrl: buildExpressBusOfficialUrl(),
          summary: "저장된 고속버스 조건이 올바르지 않습니다.",
          error: {
            code: "VALIDATION_ERROR",
            message: "저장된 고속버스 조건이 올바르지 않습니다.",
            raw: parsed.error.issues.map((issue) => issue.message).join("; ")
          }
        });
        await createQueryResultFromResponse({
          type: "express_bus",
          response,
          watchItemId: item.id
        });

        return NextResponse.json(response, { status: 400 });
      }

      const response = await searchExpressBuses(parsed.data);
      await createQueryResultFromResponse({
        type: "express_bus",
        response,
        watchItemId: item.id
      });

      return NextResponse.json(response, {
        status: response.status === "failed" ? httpStatus(response.error?.code) : 200
      });
    }

    if (item.type === "intercity_bus") {
      const parsed = intercityBusSearchSchema.safeParse(parseParamsJson(item.paramsJson));

      if (!parsed.success) {
        const response = failedResponse<BusSearchData>({
          source: "tmoney-link",
          officialUrl: buildIntercityBusOfficialUrl(),
          summary: "저장된 시외버스 조건이 올바르지 않습니다.",
          error: {
            code: "VALIDATION_ERROR",
            message: "저장된 시외버스 조건이 올바르지 않습니다.",
            raw: parsed.error.issues.map((issue) => issue.message).join("; ")
          }
        });
        await createQueryResultFromResponse({
          type: "intercity_bus",
          response,
          watchItemId: item.id
        });

        return NextResponse.json(response, { status: 400 });
      }

      const response = await searchIntercityBuses(parsed.data);
      await createQueryResultFromResponse({
        type: "intercity_bus",
        response,
        watchItemId: item.id
      });

      return NextResponse.json(response, {
        status: response.status === "failed" ? httpStatus(response.error?.code) : 200
      });
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
