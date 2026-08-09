import { ZodError, type ZodSchema } from "zod";

import { toApiError, TripWatchError } from "@/lib/errors";
export const MAX_JSON_BODY_BYTES = 65_536;

function validationError(message: string, cause?: unknown): TripWatchError {
  return new TripWatchError("VALIDATION_ERROR", message, { cause });
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw validationError("Content-Type은 application/json이어야 합니다.");
  }

  const parts = contentType.split(";").map((part) => part.trim());
  if (parts.length > 2 || parts[0]?.toLowerCase() !== "application/json") {
    throw validationError("Content-Type은 application/json이어야 합니다.");
  }

  if (parts.length === 2) {
    const parameter = parts[1].split("=").map((part) => part.trim());
    if (
      parameter.length !== 2 ||
      parameter[0]?.toLowerCase() !== "charset" ||
      parameter[1]?.toLowerCase() !== "utf-8"
    ) {
      throw validationError("JSON 문자 인코딩은 UTF-8만 허용됩니다.");
    }
  }
}

function readDeclaredLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) {
    return undefined;
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw validationError("Content-Length가 올바르지 않습니다.");
  }

  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_JSON_BODY_BYTES) {
    throw validationError("요청 본문이 허용 크기를 초과했습니다.");
  }

  return length;
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    let result = await reader.read();
    while (!result.done) {
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw validationError("요청 본문이 허용 크기를 초과했습니다.");
      }

      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export async function assertNoRequestBody(request: Request): Promise<void> {
  const declaredLength = readDeclaredLength(request);
  if (declaredLength !== undefined && declaredLength > 0) {
    throw validationError("이 요청에는 본문을 보낼 수 없습니다.");
  }

  const body = await readBoundedBody(request, 0);
  if (body.byteLength > 0) {
    throw validationError("이 요청에는 본문을 보낼 수 없습니다.");
  }
}

export type TripWatchStatus = "success" | "partial" | "failed";

export type TripWatchApiError = {
  code: string;
  message: string;
  raw?: string;
};

export type TripWatchApiResponse<T> = {
  status: TripWatchStatus;
  checkedAt: string;
  source: string;
  officialUrl?: string;
  summary?: string;
  data?: T;
  error?: TripWatchApiError;
};

type ResponseOptions<T> = {
  checkedAt?: Date | string;
  source: string;
  officialUrl?: string;
  summary?: string;
  data?: T;
  error?: TripWatchApiError;
};

function normalizeCheckedAt(value?: Date | string): string {
  if (!value) {
    return new Date().toISOString();
  }

  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function baseResponse<T>(status: TripWatchStatus, options: ResponseOptions<T>): TripWatchApiResponse<T> {
  return {
    status,
    checkedAt: normalizeCheckedAt(options.checkedAt),
    source: options.source,
    officialUrl: options.officialUrl,
    summary: options.summary,
    data: options.data,
    error: options.error
  };
}

export function successResponse<T>(options: ResponseOptions<T>): TripWatchApiResponse<T> {
  return baseResponse("success", options);
}

export function partialResponse<T>(options: ResponseOptions<T>): TripWatchApiResponse<T> {
  return baseResponse("partial", options);
}

export function failedResponse<T = never>(options: Omit<ResponseOptions<T>, "data">): TripWatchApiResponse<T> {
  return baseResponse("failed", options);
}

export async function parseJsonBodyWithSchema<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  assertJsonContentType(request);
  readDeclaredLength(request);

  let body: unknown;

  try {
    const bytes = await readBoundedBody(request, MAX_JSON_BODY_BYTES);
    if (bytes.byteLength === 0) {
      throw validationError("요청 본문은 비어 있을 수 없습니다.");
    }

    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    body = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof TripWatchError) {
      throw error;
    }

    throw validationError("요청 본문은 올바른 JSON이어야 합니다.", error);
  }

  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new TripWatchError("VALIDATION_ERROR", "요청 값이 올바르지 않습니다.", {
        raw: error.issues.map((issue) => issue.message).join("; "),
        cause: error
      });
    }

    throw error;
  }
}

export function failedResponseFromError(error: unknown, options: Omit<ResponseOptions<never>, "error" | "data">) {
  return failedResponse({
    ...options,
    error: toApiError(error)
  });
}
