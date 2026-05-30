import { ZodError, type ZodSchema } from "zod";

import { toApiError, TripWatchError } from "@/lib/errors";

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
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    throw new TripWatchError("VALIDATION_ERROR", "요청 본문은 올바른 JSON이어야 합니다.", {
      cause: error
    });
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
