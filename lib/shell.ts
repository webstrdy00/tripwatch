import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import { TripWatchError } from "@/lib/errors";
import { maskSecrets } from "@/lib/secrets";

const DEFAULT_STDOUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;
const TERMINATION_GRACE_MS = 50;
const TERMINATION_FINAL_DEADLINE_MS = 200;
const TERMINATION_PROBE_MS = 10;

export type HelperSpawnedProcess = {
  pid?: number;
  stdout: Pick<NodeJS.ReadableStream, "setEncoding" | "on">;
  stderr: Pick<NodeJS.ReadableStream, "setEncoding" | "on">;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
};

export type HelperSpawnImplementation = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio
) => HelperSpawnedProcess;
export type HelperCommandOptions = {
  timeoutMs: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  spawnImplementation?: HelperSpawnImplementation;
};

export type HelperCommandResult<T> = {
  data: T;
  stdout: string;
  stderrSummary?: string;
  exitCode: number;
};

function getDefaultStdoutLimit(): number {
  const configured = Number.parseInt(process.env.TRIPWATCH_HELPER_STDOUT_LIMIT_BYTES ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_STDOUT_LIMIT_BYTES;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function appendWithLimit(current: string, chunk: string, limit: number): { value: string; exceeded: boolean } {
  const remaining = limit - byteLength(current);
  if (byteLength(chunk) <= remaining) {
    return { value: current + chunk, exceeded: false };
  }

  let suffix = Buffer.from(chunk, "utf8").subarray(0, Math.max(remaining, 0)).toString("utf8");
  while (byteLength(suffix) > remaining) {
    suffix = Array.from(suffix).slice(0, -1).join("");
  }

  return { value: current + suffix, exceeded: true };
}

function isProcessGroupGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

export async function runHelperCommand<T = unknown>(
  command: string,
  args: readonly string[],
  options: HelperCommandOptions
): Promise<HelperCommandResult<T>> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TripWatchError("VALIDATION_ERROR", "helper timeoutMs는 양수여야 합니다.");
  }

  const stdoutLimitBytes = options.stdoutLimitBytes ?? getDefaultStdoutLimit();
  const stderrLimitBytes = options.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES;
  if (!Number.isFinite(stdoutLimitBytes) || !Number.isInteger(stdoutLimitBytes) || stdoutLimitBytes <= 0) {
    throw new TripWatchError("VALIDATION_ERROR", "helper stdoutLimitBytes는 양의 정수여야 합니다.");
  }

  if (!Number.isFinite(stderrLimitBytes) || !Number.isInteger(stderrLimitBytes) || stderrLimitBytes <= 0) {
    throw new TripWatchError("VALIDATION_ERROR", "helper stderrLimitBytes는 양의 정수여야 합니다.");
  }

  const selectedEnv = options.env ?? process.env;

  return new Promise<HelperCommandResult<T>>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stderrExceeded = false;
    let settled = false;
    let terminationError: TripWatchError | undefined;
    let closeObserved = false;
    const childEnv = { ...selectedEnv };
    delete childEnv.TELEGRAM_BOT_TOKEN;
    delete childEnv.TELEGRAM_CHAT_ID;

    const child = (options.spawnImplementation ?? spawn)(command, [...args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: childEnv,
      shell: false,
      windowsHide: true
    });
    const ownsProcessGroup =
      process.platform !== "win32" && options.spawnImplementation === undefined && typeof child.pid === "number" && child.pid > 0;
    let processGroupGone = !ownsProcessGroup;

    let terminationGrace: NodeJS.Timeout | undefined;
    let terminationDeadline: NodeJS.Timeout | undefined;
    let terminationProbe: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (terminationGrace) clearTimeout(terminationGrace);
      if (terminationDeadline) clearTimeout(terminationDeadline);
      if (terminationProbe) clearTimeout(terminationProbe);
    };

    const settle = (result: { value: HelperCommandResult<T> } | { error: TripWatchError }) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if ("error" in result) reject(result.error);
      else resolve(result.value);
    };

    const signalOwnedProcess = (signal: NodeJS.Signals): boolean => {
      if (ownsProcessGroup) {
        try {
          process.kill(-child.pid!, signal);
          return true;
        } catch {
          return false;
        }
      }

      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    };

    const completeTerminationIfProven = () => {
      if (!terminationError || !closeObserved) return;
      if (ownsProcessGroup) processGroupGone = isProcessGroupGone(child.pid!);
      if (processGroupGone) settle({ error: terminationError });
    };

    const beginTermination = (error: TripWatchError) => {
      if (terminationError || settled) return;
      terminationError = error;
      signalOwnedProcess("SIGTERM");

      terminationGrace = setTimeout(() => {
        if (!settled) {
          signalOwnedProcess("SIGKILL");
          completeTerminationIfProven();
        }
      }, TERMINATION_GRACE_MS);

      terminationDeadline = setTimeout(() => {
        settle({
          error: new TripWatchError("HELPER_TERMINATION_FAILED", "helper 종료를 제한 시간 안에 확인하지 못했습니다.")
        });
      }, TERMINATION_FINAL_DEADLINE_MS);

      if (ownsProcessGroup) {
        const probeTermination = () => {
          completeTerminationIfProven();
          if (!settled) {
            terminationProbe = setTimeout(probeTermination, TERMINATION_PROBE_MS);
          }
        };
        terminationProbe = setTimeout(probeTermination, TERMINATION_PROBE_MS);
      }
    };

    const timeout = setTimeout(() => {
      beginTermination(new TripWatchError("HELPER_TIMEOUT", `helper가 ${options.timeoutMs}ms 안에 응답하지 않았습니다.`));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (settled || terminationError) return;

      const appended = appendWithLimit(stdout, chunk, stdoutLimitBytes);
      stdout = appended.value;
      if (appended.exceeded) {
        beginTermination(new TripWatchError("HELPER_FAILED", `helper stdout이 ${stdoutLimitBytes}바이트 제한을 초과했습니다.`));
      }
    });

    child.stderr.on("data", (chunk: string) => {
      const appended = appendWithLimit(stderr, chunk, stderrLimitBytes);
      stderr = appended.value;
      stderrExceeded ||= appended.exceeded;
    });

    child.on("error", (error) => {
      if (settled || terminationError) return;
      settle({ error: new TripWatchError("HELPER_FAILED", "helper 실행을 시작하지 못했습니다.", { cause: error }) });
    });

    child.on("close", (code) => {
      if (settled) return;

      if (terminationError) {
        closeObserved = true;
        completeTerminationIfProven();
        return;
      }

      const maskedStderr = maskSecrets(stderr, { env: childEnv });
      const stderrTruncated = stderrExceeded || maskedStderr.length > 500;
      const stderrSummary = maskedStderr
        ? `${maskedStderr.slice(0, 500)}${stderrTruncated ? "\n[stderr truncated]" : ""}`
        : undefined;

      if (code !== 0) {
        settle({
          error: new TripWatchError(`HELPER_FAILED`, `helper가 exit code ${code ?? "unknown"}로 종료되었습니다.`, {
            raw: stderrSummary
          })
        });
        return;
      }

      try {
        settle({
          value: {
            data: JSON.parse(stdout) as T,
            stdout,
            stderrSummary,
            exitCode: code ?? 0
          }
        });
      } catch (error) {
        settle({
          error: new TripWatchError("PARSE_ERROR", "helper stdout을 JSON으로 파싱하지 못했습니다.", {
            raw: stderrSummary,
            cause: error
          })
        });
      }
    });
  }).catch((error: unknown) => {
    if (error instanceof TripWatchError) {
      throw error;
    }

    throw new TripWatchError("UNKNOWN_ERROR", "helper 실행 중 알 수 없는 오류가 발생했습니다.", {
      cause: error
    });
  });
}
