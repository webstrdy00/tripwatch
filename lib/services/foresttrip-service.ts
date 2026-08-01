import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { failedResponse, successResponse, type TripWatchApiResponse } from "@/lib/api-response";
import { getKstCalendarDate, isoDateToCompact } from "@/lib/dates";
import { toApiError, TripWatchError } from "@/lib/errors";
import type { ForesttripSearchData } from "@/lib/normalize/normalize-foresttrip";
import { normalizeForesttripPayload } from "@/lib/normalize/normalize-foresttrip";
import { getOfficialUrl } from "@/lib/official-urls";
import { runHelperCommand } from "@/lib/shell";
import type { ForesttripHelperPayload, ForesttripSearchInput } from "@/lib/validation/foresttrip-schema";

export const FORESTTRIP_LIVE_SOURCE = "foresttrip-vacancy";
const MOCK_SOURCE = "mock-foresttrip-helper";
const PRE_SPAWN_SOURCE = "foresttrip-official-link";
const TIMEOUT_MS = 60_000;
const STDOUT_LIMIT_BYTES = 1024 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;
const CREDENTIAL_NAMES = ["KSKILL_FORESTTRIP_ID", "KSKILL_FORESTTRIP_PASSWORD"] as const;

type ForesttripResponseSource = typeof FORESTTRIP_LIVE_SOURCE | typeof MOCK_SOURCE | typeof PRE_SPAWN_SOURCE;

type RuntimeConfiguration = {
  scriptPath: string;
  env: NodeJS.ProcessEnv;
};

function useMockHelpers(): boolean {
  return process.env.TRIPWATCH_USE_MOCK_HELPERS === "true";
}

function helperArgs(input: ForesttripSearchInput, scriptPath: string): string[] {
  return [
    scriptPath,
    "--forest-name",
    input.forestName,
    "--json",
    "--dates",
    isoDateToCompact(input.date),
    "--categories",
    input.category,
    "--concurrency",
    "1"
  ];
}

function missingEnvironmentError(names: string[]): TripWatchError {
  return new TripWatchError("HELPER_FAILED", `필수 환경변수가 없습니다: ${names.join(", ")}`);
}

function runtimeConfiguration(): RuntimeConfiguration {
  if (process.platform !== "linux") {
    throw new TripWatchError("HELPER_FAILED", "Foresttrip helper는 Linux 환경에서만 실행할 수 있습니다.");
  }

  const home = process.env.HOME;
  const path = process.env.PATH;
  const missingNames = [
    ...(home && isAbsolute(home) ? [] : ["HOME"]),
    ...(path ? [] : ["PATH"]),
    ...CREDENTIAL_NAMES.filter((name) => !process.env[name])
  ];

  if (missingNames.length > 0) {
    throw missingEnvironmentError(missingNames);
  }
  if (!home || !path) {
    throw missingEnvironmentError(["HOME", "PATH"]);
  }

  const scriptPath = join(home, ".agents", "skills", FORESTTRIP_LIVE_SOURCE, "scripts", "run_foresttrip_vacancy.py");
  try {
    accessSync(scriptPath, constants.R_OK);
    if (!statSync(scriptPath).isFile()) {
      throw new Error("Foresttrip helper script is not a file.");
    }
  } catch {
    throw new TripWatchError("HELPER_FAILED", "Foresttrip helper를 실행할 수 없습니다.");
  }

  const env = {} as NodeJS.ProcessEnv;
  env.PATH = path;
  env.HOME = home;
  env.PYTHONIOENCODING = "utf-8";
  env.TZ = "Asia/Seoul";
  env.KSKILL_FORESTTRIP_ID = process.env.KSKILL_FORESTTRIP_ID;
  env.KSKILL_FORESTTRIP_PASSWORD = process.env.KSKILL_FORESTTRIP_PASSWORD;
  if (process.env.LANG) {
    env.LANG = process.env.LANG;
  }
  if (process.env.LC_ALL) {
    env.LC_ALL = process.env.LC_ALL;
  }

  return { scriptPath, env };
}

function mockPayload(input: ForesttripSearchInput, currentKstDate: string): ForesttripHelperPayload {
  const compactDate = isoDateToCompact(input.date);
  return {
    forests_scanned: 1,
    filter_hits: 1,
    fetch_failures: 0,
    failures: [],
    concurrency: 1,
    date_range: { from: isoDateToCompact(currentKstDate), to: compactDate },
    results: [{
      forest: input.forestName,
      dates: [{
        use_dt: compactDate,
        rooms: [{
          forest_id: "mock-foresttrip-001",
          forest: input.forestName,
          use_dt: compactDate,
          day: null,
          name: input.category === "01" ? "Mock 숲속의 집" : "Mock 야영장",
          area: input.category === "01" ? "39.6" : "20",
          capacity: input.category === "01" ? "4" : "6",
          category: input.category === "01" ? "숙박" : "야영",
          region: null,
          waiting_possible: null
        }]
      }]
    }]
  };
}

function failedForesttripResponse(error: unknown, source: ForesttripResponseSource): TripWatchApiResponse<ForesttripSearchData> {
  const apiError = toApiError(error);
  return failedResponse({
    source,
    officialUrl: getOfficialUrl("foresttrip"),
    summary: apiError.message,
    error: { code: apiError.code, message: apiError.message }
  });
}

function normalizeRuntimePayload(payload: unknown, input: ForesttripSearchInput, startedKstDate: string, endedKstDate: string): ForesttripSearchData {
  try {
    return normalizeForesttripPayload(payload, input, { startedKstDate, endedKstDate });
  } catch (error) {
    if (error instanceof TripWatchError) {
      throw error;
    }
    throw new TripWatchError("PARSE_ERROR", "Foresttrip helper 응답을 검증하지 못했습니다.", { cause: error });
  }
}

export async function searchForesttrip(input: ForesttripSearchInput): Promise<TripWatchApiResponse<ForesttripSearchData>> {
  if (useMockHelpers()) {
    try {
      const startedKstDate = getKstCalendarDate();
      const data = normalizeRuntimePayload(mockPayload(input, startedKstDate), input, startedKstDate, getKstCalendarDate());
      return successResponse({
        source: MOCK_SOURCE,
        officialUrl: getOfficialUrl("foresttrip"),
        summary: "Mock 자연휴양림 조회 결과입니다.",
        data
      });
    } catch (error) {
      return failedForesttripResponse(error, MOCK_SOURCE);
    }
  }

  let configuration: RuntimeConfiguration;
  try {
    configuration = runtimeConfiguration();
  } catch (error) {
    return failedForesttripResponse(error, PRE_SPAWN_SOURCE);
  }

  const startedKstDate = getKstCalendarDate();
  try {
    const result = await runHelperCommand<unknown>("python3", helperArgs(input, configuration.scriptPath), {
      timeoutMs: TIMEOUT_MS,
      stdoutLimitBytes: STDOUT_LIMIT_BYTES,
      stderrLimitBytes: STDERR_LIMIT_BYTES,
      env: configuration.env
    });
    const data = normalizeRuntimePayload(result.data, input, startedKstDate, getKstCalendarDate());
    return successResponse({
      source: FORESTTRIP_LIVE_SOURCE,
      officialUrl: getOfficialUrl("foresttrip"),
      summary: "자연휴양림 조회 결과입니다.",
      data
    });
  } catch (error) {
    return failedForesttripResponse(error, FORESTTRIP_LIVE_SOURCE);
  }
}
