import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { normalizeForesttripPayload } from "../lib/normalize/normalize-foresttrip";
import { foresttripSearchSchema, type ForesttripSearchInput } from "../lib/validation/foresttrip-schema";

const SKILL_ROOT = join(process.env.HOME ?? "/home/donghwi", ".agents", "skills");
const FORESTTRIP_SCRIPT = "/home/donghwi/.agents/skills/foresttrip-vacancy/scripts/run_foresttrip_vacancy.py";
const FORESTTRIP_SKILL = "/home/donghwi/.agents/skills/foresttrip-vacancy/SKILL.md";
const FORESTTRIP_SHA256 = "4717975a0921775b635bb852a390fefffa7c4c54ab7b6277e21cb4b8e03b7e48";
const PYTHON = "python3";
const WORK_DIR = process.cwd();
const FORESTTRIP_COMMAND = process.platform === "win32" ? "wsl.exe" : PYTHON;

const STDOUT_LIMIT_BYTES = 256 * 1024;
const STDERR_LIMIT_BYTES = 64 * 1024;

const SAMPLE_VALUES = {
  flight: {
    from: "ICN",
    to: "NRT",
    date: "2026-07-11",
    returnDate: "2026-07-15",
    adults: "1",
    seat: "economy"
  },
  expressBus: {
    departCode: "010",
    arriveCode: "700",
    date: "20260613",
    timeNote: "helper has no time filter; service should filter >= 09:00 after normalization"
  },
  intercityBus: {
    departCode: "0511601",
    arriveCode: "2482701",
    departName: "동서울",
    arriveName: "속초",
    date: "20260613",
    time: "080000"
  },
  ticket: {
    // Search result observed on 2026-05-30. If this expires, keep the failure as evidence and update this constant.
    normalInput: "interpark:26006476",
    invalidInput: "bad-platform:000000"
  }
} as const;

type SmokeCase = {
  id: string;
  helper: "flight-ticket-search" | "express-bus-booking" | "intercity-bus-booking" | "ticket-availability" | "foresttrip-vacancy";
  kind: "usage" | "normal" | "failure" | "dependency" | "credential";
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
  expectJson: boolean;
  mayCallExternal: boolean;
  omitCredentials?: boolean;
  live?: boolean;
  expectedStatus?: "PASS" | "BLOCKED";
};

type RunResult = {
  id: string;
  helper: SmokeCase["helper"];
  kind: SmokeCase["kind"];
  description: string;
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutPreview: string;
  stderrPreview: string;
  jsonParse: "ok" | "failed" | "skipped";
  parsedJsonSummary?: unknown;
  parsedJson?: unknown;
  startedKstDate: string;
  endedKstDate: string;
  attemptedExternalLookup: boolean;
  status?: "PASS" | "BLOCKED" | "FAILED";
};

const HELPERS = {
  flight: join(SKILL_ROOT, "flight-ticket-search", "scripts", "flight_ticket_search.py"),
  expressBus: join(SKILL_ROOT, "express-bus-booking", "scripts", "kobus_express_booking.py"),
  intercityBus: join(SKILL_ROOT, "intercity-bus-booking", "scripts", "intercity_bus_search.py"),
  ticket: join(SKILL_ROOT, "ticket-availability", "scripts", "ticket_availability.py")
} as const;

const CASES: SmokeCase[] = [
  {
    id: "flight-help",
    helper: "flight-ticket-search",
    kind: "usage",
    description: "flight helper top-level usage",
    command: PYTHON,
    args: [HELPERS.flight, "--help"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "flight-normal",
    helper: "flight-ticket-search",
    kind: "normal",
    description: "ICN -> NRT round-trip Google Flights lookup",
    command: PYTHON,
    args: [
      HELPERS.flight,
      "search",
      "--from",
      SAMPLE_VALUES.flight.from,
      "--to",
      SAMPLE_VALUES.flight.to,
      "--date",
      SAMPLE_VALUES.flight.date,
      "--return-date",
      SAMPLE_VALUES.flight.returnDate,
      "--adults",
      SAMPLE_VALUES.flight.adults,
      "--seat",
      SAMPLE_VALUES.flight.seat,
      "--limit",
      "3",
      "--format",
      "json"
    ],
    timeoutMs: 60_000,
    expectJson: true,
    mayCallExternal: true
  },
  {
    id: "flight-failure",
    helper: "flight-ticket-search",
    kind: "failure",
    description: "invalid IATA validation failure before external lookup",
    command: PYTHON,
    args: [
      HELPERS.flight,
      "search",
      "--from",
      "I",
      "--to",
      SAMPLE_VALUES.flight.to,
      "--date",
      SAMPLE_VALUES.flight.date,
      "--adults",
      "1",
      "--seat",
      "economy",
      "--format",
      "json"
    ],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "express-help",
    helper: "express-bus-booking",
    kind: "usage",
    description: "KOBUS helper usage",
    command: PYTHON,
    args: [HELPERS.expressBus, "--help"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "express-normal",
    helper: "express-bus-booking",
    kind: "normal",
    description: "서울경부(010) -> 부산(700) read-only timetable lookup",
    command: PYTHON,
    args: [
      HELPERS.expressBus,
      "--depart-code",
      SAMPLE_VALUES.expressBus.departCode,
      "--arrive-code",
      SAMPLE_VALUES.expressBus.arriveCode,
      "--date",
      SAMPLE_VALUES.expressBus.date,
      "--limit",
      "3",
      "--timeout",
      "10"
    ],
    timeoutMs: 20_000,
    expectJson: true,
    mayCallExternal: true
  },
  {
    id: "express-failure",
    helper: "express-bus-booking",
    kind: "failure",
    description: "argparse failure with missing required arrive-code",
    command: PYTHON,
    args: [HELPERS.expressBus, "--depart-code", SAMPLE_VALUES.expressBus.departCode, "--date", SAMPLE_VALUES.expressBus.date],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "intercity-help",
    helper: "intercity-bus-booking",
    kind: "usage",
    description: "Tmoney intercity helper usage",
    command: PYTHON,
    args: [HELPERS.intercityBus, "--help"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "intercity-normal",
    helper: "intercity-bus-booking",
    kind: "normal",
    description: "동서울(0511601) -> 속초(2482701) read-only timetable lookup",
    command: PYTHON,
    args: [
      HELPERS.intercityBus,
      "--depart-code",
      SAMPLE_VALUES.intercityBus.departCode,
      "--arrive-code",
      SAMPLE_VALUES.intercityBus.arriveCode,
      "--depart-name",
      SAMPLE_VALUES.intercityBus.departName,
      "--arrive-name",
      SAMPLE_VALUES.intercityBus.arriveName,
      "--date",
      SAMPLE_VALUES.intercityBus.date,
      "--time",
      SAMPLE_VALUES.intercityBus.time,
      "--limit",
      "3",
      "--timeout",
      "10"
    ],
    timeoutMs: 20_000,
    expectJson: true,
    mayCallExternal: true
  },
  {
    id: "intercity-failure",
    helper: "intercity-bus-booking",
    kind: "failure",
    description: "date format validation failure before external lookup",
    command: PYTHON,
    args: [
      HELPERS.intercityBus,
      "--depart-code",
      SAMPLE_VALUES.intercityBus.departCode,
      "--arrive-code",
      SAMPLE_VALUES.intercityBus.arriveCode,
      "--depart-name",
      SAMPLE_VALUES.intercityBus.departName,
      "--arrive-name",
      SAMPLE_VALUES.intercityBus.arriveName,
      "--date",
      "2026-06-13"
    ],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "ticket-help",
    helper: "ticket-availability",
    kind: "usage",
    description: "ticket availability usage",
    command: PYTHON,
    args: [HELPERS.ticket, "--help"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  },
  {
    id: "ticket-normal",
    helper: "ticket-availability",
    kind: "normal",
    description: "Interpark schedule lookup for a current candidate URL/id",
    command: PYTHON,
    args: [HELPERS.ticket, "schedule", SAMPLE_VALUES.ticket.normalInput, "--compact"],
    timeoutMs: 20_000,
    expectJson: true,
    mayCallExternal: true
  },
  {
    id: "ticket-failure",
    helper: "ticket-availability",
    kind: "failure",
    description: "invalid platform:id validation failure before external lookup",
    command: PYTHON,
    args: [HELPERS.ticket, "schedule", SAMPLE_VALUES.ticket.invalidInput, "--compact"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false
  }
];
const FORESTTRIP_CASES: SmokeCase[] = [
  {
    id: "foresttrip-pinned-artifact",
    helper: "foresttrip-vacancy",
    kind: "usage",
    description: "pinned v1.5 skill, installed script path, and SHA-256 proof",
    command: FORESTTRIP_COMMAND,
    args: ["-c", "import hashlib, pathlib, sys; script=pathlib.Path(sys.argv[1]); skill=pathlib.Path(sys.argv[2]); version='phase: v1.5' in skill.read_text(); sha=hashlib.sha256(script.read_bytes()).hexdigest(); print('v1.5' if version else 'missing'); print(sha); raise SystemExit(0 if version and sha == sys.argv[3] else 1)", FORESTTRIP_SCRIPT, FORESTTRIP_SKILL, FORESTTRIP_SHA256],
    timeoutMs: 30_000,
    expectJson: false,
    mayCallExternal: false,
    expectedStatus: "PASS"
  },
  {
    id: "foresttrip-help",
    helper: "foresttrip-vacancy",
    kind: "usage",
    description: "pinned ForestTrip helper usage without provider access",
    command: FORESTTRIP_COMMAND,
    args: [FORESTTRIP_SCRIPT, "--help"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false,
    expectedStatus: "PASS"
  },
  {
    id: "foresttrip-invalid-date",
    helper: "foresttrip-vacancy",
    kind: "failure",
    description: "argparse rejects an invalid YYYYMMDD before provider access",
    command: FORESTTRIP_COMMAND,
    args: [FORESTTRIP_SCRIPT, "--dates", "20260732"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false,
    expectedStatus: "PASS"
  },
  {
    id: "foresttrip-invalid-category",
    helper: "foresttrip-vacancy",
    kind: "failure",
    description: "argparse rejects an unknown category before provider access",
    command: FORESTTRIP_COMMAND,
    args: [FORESTTRIP_SCRIPT, "--categories", "99"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false,
    expectedStatus: "PASS"
  },
  {
    id: "foresttrip-missing-credential",
    helper: "foresttrip-vacancy",
    kind: "credential",
    description: "isolated require_env probe with both credentials omitted",
    command: FORESTTRIP_COMMAND,
    args: ["-c", "import runpy, sys; runpy.run_path(sys.argv[1])['require_env'](sys.argv[2])", FORESTTRIP_SCRIPT, "KSKILL_FORESTTRIP_ID"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false,
    omitCredentials: true,
    expectedStatus: "PASS"
  },
  {
    id: "foresttrip-check-deps",
    helper: "foresttrip-vacancy",
    kind: "dependency",
    description: "dependency-only probe; no credentials, session, or provider access",
    command: FORESTTRIP_COMMAND,
    args: [FORESTTRIP_SCRIPT, "--check-deps"],
    timeoutMs: 10_000,
    expectJson: false,
    mayCallExternal: false,
    omitCredentials: true,
    expectedStatus: "BLOCKED"
  }
];

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function maskSecrets(input: string): string {
  let output = input;
  const secretKeyPattern = /(secret|token|password|passwd|pwd|api[_-]?key|credential|auth|session|cookie)/i;

  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 4 && secretKeyPattern.test(key)) {
      output = output.split(value).join("[REDACTED]");
    }
  }

  return output.replace(
    /((?:secret|token|password|passwd|pwd|api[_-]?key|credential|auth|session|cookie)[\w.-]*\s*[:=]\s*)(["']?)[^"'\s]+(\2)/gi,
    "$1$2[REDACTED]$3"
  );
}

function appendLimited(current: string, chunk: string, limit: number): { value: string; truncated: boolean } {
  const next = current + chunk;

  if (byteLength(next) <= limit) {
    return { value: next, truncated: false };
  }

  return {
    value: Buffer.from(next, "utf8").subarray(0, limit).toString("utf8"),
    truncated: true
  };
}

function summarizeJson(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;

  if ("flights" in record || "stats" in record) {
    return {
      query: record.query,
      stats: record.stats,
      flightCount: Array.isArray(record.flights) ? record.flights.length : undefined
    };
  }

  if ("items" in record || "count" in record) {
    return {
      route: record.route,
      count: record.count,
      firstItem: Array.isArray(record.items) ? record.items[0] : undefined,
      failureMode: record.failure_mode
    };
  }

  if ("schedule" in record || "seats" in record) {
    return {
      platform: record.platform,
      id: record.id,
      scheduleCount: Array.isArray(record.schedule) ? record.schedule.length : undefined,
      seatKeys: record.seats && typeof record.seats === "object" ? Object.keys(record.seats as Record<string, unknown>).slice(0, 3) : undefined
    };
  }

  return record;
}
function foresttripStatus(smokeCase: SmokeCase, exitCode: number | null, timedOut: boolean, stderr: string): RunResult["status"] {
  if (smokeCase.helper !== "foresttrip-vacancy") {
    return undefined;
  }
  if (timedOut) {
    return "FAILED";
  }
  if (smokeCase.id === "foresttrip-check-deps") {
    return /playwright (is required|chromium browser is required)/i.test(stderr) ? "BLOCKED" : exitCode === 0 ? "PASS" : "FAILED";
  }
  if (smokeCase.id === "foresttrip-missing-credential") {
    return exitCode !== 0 && stderr.includes("missing required environment variable: KSKILL_FORESTTRIP_ID") ? "PASS" : "FAILED";
  }
  if (smokeCase.id === "foresttrip-pinned-artifact") {
    return exitCode === 0 && stderr === "" ? "PASS" : "FAILED";
  }
  return smokeCase.kind === "failure" ? (exitCode === 2 ? "PASS" : "FAILED") : exitCode === 0 ? "PASS" : "FAILED";
}
function foresttripChildEnv(smokeCase: SmokeCase, runHome: string): NodeJS.ProcessEnv {
  if (smokeCase.helper !== "foresttrip-vacancy") {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !smokeCase.omitCredentials || !["KSKILL_FORESTTRIP_ID", "KSKILL_FORESTTRIP_PASSWORD"].includes(key))
    ) as NodeJS.ProcessEnv;
    env.HOME = runHome;
    env.XDG_CACHE_HOME = join(runHome, ".cache");
    return env;
  }

  if (process.platform === "win32") {
    return process.env;
  }

  const env = {} as NodeJS.ProcessEnv;
  env.PATH = process.env.PATH ?? "";
  env.HOME = runHome;
  env.XDG_CACHE_HOME = join(runHome, ".cache");
  env.PYTHONIOENCODING = "utf-8";
  env.TZ = "Asia/Seoul";

  for (const key of ["LANG", "LC_ALL"] as const) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }

  if (smokeCase.live) {
    env.KSKILL_FORESTTRIP_ID = process.env.KSKILL_FORESTTRIP_ID;
    env.KSKILL_FORESTTRIP_PASSWORD = process.env.KSKILL_FORESTTRIP_PASSWORD;
  }

  return env;
}

function foresttripExecution(smokeCase: SmokeCase, wslHome?: string): Pick<SmokeCase, "command" | "args"> {
  if (smokeCase.helper !== "foresttrip-vacancy" || process.platform !== "win32") {
    return smokeCase;
  }

  if (!wslHome) {
    throw new Error("WSL HOME path is required for ForestTrip smoke cases");
  }

  return {
    command: FORESTTRIP_COMMAND,
    args: [
      "--",
      "/usr/bin/env",
      "-i",
      `HOME=${wslHome}`,
      `XDG_CACHE_HOME=${posix.join(wslHome, ".cache")}`,
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "PYTHONIOENCODING=utf-8",
      "TZ=Asia/Seoul",
      "LANG=C.UTF-8",
      "/usr/bin/python3",
      ...smokeCase.args
    ]
  };
}

async function resolveWslPath(windowsPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("wsl.exe", ["--exec", "/usr/bin/wslpath", "-a", windowsPath], {
      shell: false,
      stdio: "pipe",
      windowsHide: true
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const wslPath = stdout.trim();
      if (exitCode !== 0 || !wslPath.startsWith("/")) {
        reject(new Error(`wslpath failed (${exitCode}): ${maskSecrets(stderr.trim())}`));
        return;
      }
      resolve(wslPath);
    });
  });
}


async function runCase(smokeCase: SmokeCase, runHome: string, wslHome?: string): Promise<RunResult> {
  mkdirSync(runHome, { recursive: true });
  mkdirSync(join(runHome, ".cache"), { recursive: true });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const startedKstDate = seoulToday();
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const childEnv = foresttripChildEnv(smokeCase, runHome);
    const execution = foresttripExecution(smokeCase, wslHome);
    const child: ChildProcessWithoutNullStreams = spawn(execution.command, execution.args, {
      cwd: WORK_DIR,
      env: childEnv,
      shell: false,
      stdio: "pipe",
      windowsHide: true
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, smokeCase.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      const appended = appendLimited(stdout, chunk, STDOUT_LIMIT_BYTES);
      stdout = appended.value;
      stdoutTruncated ||= appended.truncated;
    });

    child.stderr.on("data", (chunk: string) => {
      const appended = appendLimited(stderr, chunk, STDERR_LIMIT_BYTES);
      stderr = appended.value;
      stderrTruncated ||= appended.truncated;
    });

    child.on("error", (error) => {
      stderr = appendLimited(stderr, `${error.name}: ${error.message}`, STDERR_LIMIT_BYTES).value;
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const rawStdout = stdout.trim();
      const maskedStdout = maskSecrets(rawStdout);
      const maskedStderr = maskSecrets(stderr.trim());
      let jsonParse: RunResult["jsonParse"] = smokeCase.expectJson ? "failed" : "skipped";
      let parsedJson: unknown;
      let parsedJsonSummary: unknown;

      if (smokeCase.expectJson && rawStdout) {
        try {
          parsedJson = JSON.parse(rawStdout) as unknown;
          parsedJsonSummary = summarizeJson(parsedJson);
          jsonParse = "ok";
        } catch {
          jsonParse = "failed";
        }
      }

      resolve({
        id: smokeCase.id,
        helper: smokeCase.helper,
        kind: smokeCase.kind,
        description: smokeCase.description,
        command: execution.command,
        args: execution.args,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdoutBytes: byteLength(maskedStdout),
        stderrBytes: byteLength(maskedStderr),
        stdoutTruncated,
        stderrTruncated,
        stdoutPreview: maskedStdout.slice(0, 1800),
        stderrPreview: maskedStderr.slice(0, 1800),
        jsonParse,
        parsedJson,
        startedKstDate,
        endedKstDate: seoulToday(),
        attemptedExternalLookup: smokeCase.live === true && smokeCase.mayCallExternal,
        parsedJsonSummary,
        status: foresttripStatus(smokeCase, exitCode, timedOut, maskedStderr)
      });
    });
  });
}
async function runIsolatedCase(smokeCase: SmokeCase, runRoot: string, wslRunRoot?: string): Promise<RunResult> {
  const caseHome = mkdtempSync(join(runRoot, `${smokeCase.id}-`));
  const wslCaseHome = wslRunRoot ? posix.join(wslRunRoot, basename(caseHome)) : undefined;

  try {
    return await runCase(smokeCase, caseHome, wslCaseHome);
  } finally {
    rmSync(caseHome, { recursive: true, force: true });
  }
}

function printResult(result: RunResult): void {
  console.log(`\n## ${result.id}`);
  console.log(`helper: ${result.helper}`);
  console.log(`kind: ${result.kind}`);
  console.log(`description: ${result.description}`);
  console.log(`command: ${result.command}`);
  console.log(`args: ${JSON.stringify(result.args)}`);
  console.log(`exitCode: ${result.exitCode}`);
  console.log(`timedOut: ${result.timedOut}`);
  console.log(`durationMs: ${result.durationMs}`);
  console.log(`jsonParse: ${result.jsonParse}`);
  if (result.status) {
    console.log(`status: ${result.status}`);
  }

  if (result.parsedJsonSummary !== undefined) {
    console.log(`jsonSummary: ${JSON.stringify(result.parsedJsonSummary, null, 2)}`);
  }

  if (result.stdoutPreview) {
    if (result.id === "foresttrip-help") {
      console.log(`stdoutSummary: helper usage verified (${result.stdoutBytes} bytes)`);
    } else {
      console.log("stdoutPreview:");
      console.log(result.stdoutPreview);
    }
  }

  if (result.stderrPreview) {
    if (result.helper === "foresttrip-vacancy") {
      console.log(`stderrSummary: masked output omitted (${result.stderrBytes} bytes)`);
    } else {
      console.log("stderrPreview:");
      console.log(result.stderrPreview);
    }
  }
}

function selectedCases(): SmokeCase[] {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const usageOnly = process.argv.includes("--usage-only");

  if (usageOnly) {
    return CASES.filter((item) => item.kind === "usage");
  }

  if (!onlyArg) {
    return [...CASES, ...FORESTTRIP_CASES];
  }

  const wanted = new Set(onlyArg.slice("--only=".length).split(",").map((value) => value.trim()).filter(Boolean));
  return [...CASES, ...FORESTTRIP_CASES].filter((item) => wanted.has(item.id) || wanted.has(item.helper));
}

type LiveStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

type LiveRequest = {
  smokeCase?: SmokeCase;
  input?: ForesttripSearchInput;
  classification: LiveStatus;
  reason: string;
};

function seoulToday(): string {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((value) => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function validLiveDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && value >= seoulToday();
}

function requestedLiveCase(): LiveRequest {
  if (!process.argv.includes("--live")) {
    return { classification: "NOT_RUN", reason: "--live was not supplied" };
  }
  if (process.env.TRIPWATCH_SMOKE_REAL_HELPERS !== "true") {
    return { classification: "BLOCKED", reason: "TRIPWATCH_SMOKE_REAL_HELPERS must equal true" };
  }
  if (process.platform !== "linux") {
    return { classification: "BLOCKED", reason: "live lookup requires a Linux or WSL runtime" };
  }
  if (!existsSync(FORESTTRIP_SCRIPT) || !existsSync(FORESTTRIP_SKILL)) {
    return { classification: "BLOCKED", reason: "pinned ForestTrip artifact is unavailable" };
  }
  if (!process.env.KSKILL_FORESTTRIP_ID || !process.env.KSKILL_FORESTTRIP_PASSWORD) {
    return { classification: "BLOCKED", reason: "ForestTrip credentials are unavailable" };
  }

  const name = process.env.TRIPWATCH_SMOKE_FORESTTRIP_NAME?.trim();
  const date = process.env.TRIPWATCH_SMOKE_FORESTTRIP_DATE?.trim();
  const category = process.env.TRIPWATCH_SMOKE_FORESTTRIP_CATEGORY?.trim();
  if (!name) {
    return { classification: "BLOCKED", reason: "TRIPWATCH_SMOKE_FORESTTRIP_NAME must be a nonempty official full name" };
  }
  if (!date || !validLiveDate(date)) {
    return { classification: "BLOCKED", reason: "TRIPWATCH_SMOKE_FORESTTRIP_DATE must be a real non-past YYYY-MM-DD date" };
  }
  if (!category || !/^(01|02)$/.test(category)) {
    return { classification: "BLOCKED", reason: "TRIPWATCH_SMOKE_FORESTTRIP_CATEGORY must be 01 or 02" };
  }

  const input = foresttripSearchSchema.safeParse({ forestName: name, date, category });
  if (!input.success) {
    return { classification: "BLOCKED", reason: "ForestTrip live request does not satisfy the approved request contract" };
  }

  return {
    classification: "NOT_RUN",
    reason: "awaiting pinned artifact and dependency checks",
    input: input.data,
    smokeCase: {
      id: "foresttrip-live",
      helper: "foresttrip-vacancy",
      kind: "normal",
      description: "single explicit read-only ForestTrip provider lookup",
      command: FORESTTRIP_COMMAND,
      args: [FORESTTRIP_SCRIPT, "--forest-name", name, "--json", "--dates", date.replaceAll("-", ""), "--categories", category, "--concurrency", "1"],
      timeoutMs: 60_000,
      expectJson: true,
      mayCallExternal: true,
      live: true
    }
  };
}

function classifyLiveResult(result: RunResult, input: ForesttripSearchInput): Pick<LiveRequest, "classification" | "reason"> {
  if (result.exitCode !== 0) {
    return { classification: "FAIL", reason: "live helper exited unsuccessfully" };
  }
  if (result.timedOut) {
    return { classification: "FAIL", reason: "live helper timed out" };
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    return { classification: "FAIL", reason: "live helper output was truncated" };
  }
  if (result.jsonParse !== "ok") {
    return { classification: "FAIL", reason: "live helper did not emit valid JSON" };
  }

  try {
    const normalized = normalizeForesttripPayload(result.parsedJson, input, {
      startedKstDate: result.startedKstDate,
      endedKstDate: result.endedKstDate
    });
    const hasMatchingCategory = normalized.query.category === input.category
      && normalized.rooms.every((room) => room.categoryCode === input.category);

    return hasMatchingCategory
      ? { classification: "PASS", reason: "strict ForestTrip envelope and request invariants normalized successfully" }
      : { classification: "FAIL", reason: "normalized ForestTrip category did not match the request" };
  } catch {
    return { classification: "FAIL", reason: "live ForestTrip envelope or request invariants failed normalization" };
  }
}
function runLiveClassificationChecks(): void {
  const input = foresttripSearchSchema.parse({ forestName: "국립 용화산자연휴양림", date: "2099-01-01", category: "01" });
  const validEnvelope = {
    forests_scanned: 1,
    filter_hits: 0,
    fetch_failures: 0,
    failures: [],
    concurrency: 1,
    date_range: { from: "20990101", to: "20990101" },
    results: []
  };
  const baseResult: RunResult = {
    id: "foresttrip-live",
    helper: "foresttrip-vacancy",
    kind: "normal",
    description: "fake live classification result",
    command: PYTHON,
    args: [],
    exitCode: 0,
    timedOut: false,
    durationMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutPreview: "",
    stderrPreview: "",
    jsonParse: "ok",
    parsedJson: validEnvelope,
    parsedJsonSummary: validEnvelope,
    startedKstDate: "2099-01-01",
    endedKstDate: "2099-01-01",
    attemptedExternalLookup: true
  };

  if (classifyLiveResult(baseResult, input).classification !== "PASS"
    || classifyLiveResult({ ...baseResult, jsonParse: "failed" }, input).classification !== "FAIL"
    || classifyLiveResult({ ...baseResult, parsedJson: { ...validEnvelope, forests_scanned: 0 } }, input).classification !== "FAIL"
    || classifyLiveResult({ ...baseResult, parsedJson: { ...validEnvelope, date_range: { from: "20990101", to: "20990102" } } }, input).classification !== "FAIL"
    || classifyLiveResult({ ...baseResult, stdoutTruncated: true }, input).classification !== "FAIL") {
    throw new Error("live classification checks failed");
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test-live-classification")) {
    runLiveClassificationChecks();
    console.log("liveClassificationChecks: PASS");
    return;
  }
  const cases = selectedCases();
  const runHome = mkdtempSync(join(tmpdir(), "tripwatch-helper-smoke-"));
  let wslRunHome: string | undefined;
  const results: RunResult[] = [];

  console.log(`# TripWatch helper smoke`);
  console.log(`startedAt: ${new Date().toISOString()}`);
  console.log(`caseCount: ${cases.length}`);
  console.log(`stdoutLimitBytes: ${STDOUT_LIMIT_BYTES}`);
  console.log(`stderrLimitBytes: ${STDERR_LIMIT_BYTES}`);
  console.log(`runHome: owned OS-temp directory`);

  try {
    wslRunHome = process.platform === "win32" && cases.some((smokeCase) => smokeCase.helper === "foresttrip-vacancy")
      ? await resolveWslPath(runHome)
      : undefined;
    console.log(`wslHome: ${wslRunHome ? "owned WSL-visible OS-temp directory" : "not used"}`);


    for (const smokeCase of cases) {
      const result = await runIsolatedCase(smokeCase, runHome, wslRunHome);
      results.push(result);
      printResult(result);
    }

    const liveRequest = requestedLiveCase();
    if (cases.some((smokeCase) => smokeCase.helper === "foresttrip-vacancy")) {
      const pinnedPassed = results.find((result) => result.id === "foresttrip-pinned-artifact")?.status === "PASS";
      const dependenciesPassed = results.find((result) => result.id === "foresttrip-check-deps")?.status === "PASS";

      if (liveRequest.smokeCase && liveRequest.input && pinnedPassed && dependenciesPassed) {
        const result = await runIsolatedCase(liveRequest.smokeCase, runHome, wslRunHome);
        results.push(result);
        const classification = classifyLiveResult(result, liveRequest.input);
        liveRequest.classification = classification.classification;
        liveRequest.reason = classification.reason;
        result.status = classification.classification === "PASS" ? "PASS" : "FAILED";
        printResult(result);
      } else if (liveRequest.smokeCase) {
        liveRequest.classification = "BLOCKED";
        liveRequest.reason = !pinnedPassed ? "pinned artifact verification did not pass" : "dependency check did not pass";
      }

      console.log(`foresttripLiveStatus: ${liveRequest.classification}`);
      console.log(`foresttripLiveReason: ${liveRequest.reason}`);
    }

    const helperSubprocesses = results.length;
    const infrastructureSubprocesses = wslRunHome ? 1 : 0;
    const liveLookupSubprocesses = results.filter((result) => result.id === "foresttrip-live").length;
    const attemptedExternalLookups = results.filter((result) => result.attemptedExternalLookup).length;
    const providerLookupSuccesses = liveRequest.classification === "PASS" ? 1 : 0;
    const subprocesses = helperSubprocesses + infrastructureSubprocesses;
    console.log(`\nsubprocessCount: ${subprocesses}`);
    console.log(`helperSubprocessCount: ${helperSubprocesses}`);
    console.log(`infrastructureSubprocessCount: ${infrastructureSubprocesses}`);
    console.log(`liveLookupSubprocessCount: ${liveLookupSubprocesses}`);
    console.log(`attemptedExternalLookupCount: ${attemptedExternalLookups}`);
    console.log(`providerLookupCount: ${providerLookupSuccesses}`);
    if (liveRequest.classification === "FAIL") {
      process.exitCode = 1;
    }
    if (results.some((result) => result.helper === "foresttrip-vacancy" && result.status === "FAILED")) {
      process.exitCode = 1;
      console.log("foresttripSafeSuiteStatus: FAILED");
    } else if (cases.some((smokeCase) => smokeCase.helper === "foresttrip-vacancy")) {
      console.log("foresttripSafeSuiteStatus: PASS");
    }
  } finally {
    rmSync(runHome, { recursive: true, force: true });
    console.log("runHomeCleanup: removed");
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(maskSecrets(message));
  process.exitCode = 1;
});
