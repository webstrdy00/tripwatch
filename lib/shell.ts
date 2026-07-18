import { spawn } from "node:child_process";

import { TripWatchError } from "@/lib/errors";
import { maskSecrets } from "@/lib/secrets";

const DEFAULT_STDOUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_STDERR_LIMIT_BYTES = 64 * 1024;

export type HelperCommandOptions = {
  timeoutMs: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
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
  const next = current + chunk;

  if (byteLength(next) <= limit) {
    return { value: next, exceeded: false };
  }

  return {
    value: Buffer.from(next, "utf8").subarray(0, limit).toString("utf8"),
    exceeded: true
  };
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

  const childEnv = options.env ?? process.env;

  return new Promise<HelperCommandResult<T>>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutExceeded = false;
    let stderrExceeded = false;
    let settled = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: childEnv,
      shell: false,
      windowsHide: true
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      reject(new TripWatchError("HELPER_TIMEOUT", `helper가 ${options.timeoutMs}ms 안에 응답하지 않았습니다.`));
    }, options.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      if (settled) {
        return;
      }

      const appended = appendWithLimit(stdout, chunk, stdoutLimitBytes);
      stdout = appended.value;

      if (appended.exceeded) {
        stdoutExceeded = true;
        settled = true;
        child.kill("SIGTERM");
        clearTimeout(timeout);
        reject(new TripWatchError("HELPER_FAILED", `helper stdout이 ${stdoutLimitBytes}바이트 제한을 초과했습니다.`));
      }
    });

    child.stderr.on("data", (chunk: string) => {
      const appended = appendWithLimit(stderr, chunk, stderrLimitBytes);
      stderr = appended.value;
      stderrExceeded ||= appended.exceeded;
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new TripWatchError("HELPER_FAILED", "helper 실행을 시작하지 못했습니다.", { cause: error }));
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const maskedStderr = maskSecrets(stderr, { env: childEnv });
      const stderrTruncated = stderrExceeded || maskedStderr.length > 500;
      const stderrSummary = maskedStderr
        ? `${maskedStderr.slice(0, 500)}${stderrTruncated ? "\n[stderr truncated]" : ""}`
        : undefined;

      if (stdoutExceeded) {
        reject(new TripWatchError("HELPER_FAILED", `helper stdout이 ${stdoutLimitBytes}바이트 제한을 초과했습니다.`));
        return;
      }

      if (code !== 0) {
        reject(
          new TripWatchError("HELPER_FAILED", `helper가 exit code ${code ?? "unknown"}로 종료되었습니다.`, {
            raw: stderrSummary
          })
        );
        return;
      }

      try {
        resolve({
          data: JSON.parse(stdout) as T,
          stdout,
          stderrSummary,
          exitCode: code ?? 0
        });
      } catch (error) {
        reject(
          new TripWatchError("PARSE_ERROR", "helper stdout을 JSON으로 파싱하지 못했습니다.", {
            raw: stderrSummary,
            cause: error
          })
        );
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
