import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SKILL_ROOT = join(process.env.HOME ?? "/home/donghwi", ".agents", "skills");
const PYTHON = "python3";
const WORK_DIR = process.cwd();
const RUN_HOME = "/tmp/tripwatch-helper-smoke-home";
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
  helper: "flight-ticket-search" | "express-bus-booking" | "intercity-bus-booking" | "ticket-availability";
  kind: "usage" | "normal" | "failure";
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
  expectJson: boolean;
  mayCallExternal: boolean;
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

async function runCase(smokeCase: SmokeCase): Promise<RunResult> {
  mkdirSync(RUN_HOME, { recursive: true });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(smokeCase.command, smokeCase.args, {
      cwd: WORK_DIR,
      env: {
        ...process.env,
        HOME: RUN_HOME,
        XDG_CACHE_HOME: join(RUN_HOME, ".cache"),
        PIP_DISABLE_PIP_VERSION_CHECK: "1"
      },
      shell: false,
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

      const maskedStdout = maskSecrets(stdout.trim());
      const maskedStderr = maskSecrets(stderr.trim());
      let jsonParse: RunResult["jsonParse"] = smokeCase.expectJson ? "failed" : "skipped";
      let parsedJsonSummary: unknown;

      if (smokeCase.expectJson && maskedStdout) {
        try {
          parsedJsonSummary = summarizeJson(JSON.parse(maskedStdout) as unknown);
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
        command: smokeCase.command,
        args: smokeCase.args,
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
        parsedJsonSummary
      });
    });
  });
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

  if (result.parsedJsonSummary !== undefined) {
    console.log(`jsonSummary: ${JSON.stringify(result.parsedJsonSummary, null, 2)}`);
  }

  if (result.stdoutPreview) {
    console.log("stdoutPreview:");
    console.log(result.stdoutPreview);
  }

  if (result.stderrPreview) {
    console.log("stderrPreview:");
    console.log(result.stderrPreview);
  }
}

function selectedCases(): SmokeCase[] {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const usageOnly = process.argv.includes("--usage-only");

  if (usageOnly) {
    return CASES.filter((item) => item.kind === "usage");
  }

  if (!onlyArg) {
    return CASES;
  }

  const wanted = new Set(onlyArg.slice("--only=".length).split(",").map((value) => value.trim()).filter(Boolean));
  return CASES.filter((item) => wanted.has(item.id) || wanted.has(item.helper));
}

async function main(): Promise<void> {
  const cases = selectedCases();
  console.log(`# TripWatch helper smoke`);
  console.log(`startedAt: ${new Date().toISOString()}`);
  console.log(`caseCount: ${cases.length}`);
  console.log(`stdoutLimitBytes: ${STDOUT_LIMIT_BYTES}`);
  console.log(`stderrLimitBytes: ${STDERR_LIMIT_BYTES}`);
  console.log(`runHome: ${RUN_HOME}`);

  for (const smokeCase of cases) {
    const result = await runCase(smokeCase);
    printResult(result);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(maskSecrets(message));
  process.exitCode = 1;
});
