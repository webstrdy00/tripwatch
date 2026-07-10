"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { TripWatchApiResponse } from "@/lib/api-response";
import type { DashboardResultItem } from "@/lib/dashboard";

const TYPE_LABELS: Record<DashboardResultItem["type"], string> = {
  flight: "항공권",
  express_bus: "고속버스",
  intercity_bus: "시외버스",
  ticket: "공연"
};

type Notice = {
  tone: "success" | "partial" | "failed";
  message: string;
};

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString().replace("T", " ").slice(0, 16);
}

function responseMessage(payload: TripWatchApiResponse<unknown>): string {
  return payload.summary ?? payload.error?.message ?? "다시 조회 요청을 처리하지 못했습니다.";
}

function isRetryCooldownActive(value: string): boolean {
  const checkedAt = new Date(value);

  if (Number.isNaN(checkedAt.getTime())) {
    return false;
  }

  return Date.now() - checkedAt.getTime() < 60_000;
}

export function FailedResultsPanel({ results }: { results: DashboardResultItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();

  async function retryResult(result: DashboardResultItem) {
    if (!result.watchItemId) {
      return;
    }

    setBusyId(result.id);
    setNotice(undefined);

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(result.watchItemId)}/run`, {
        method: "POST"
      });
      const payload = (await response.json()) as TripWatchApiResponse<unknown>;

      setNotice({
        tone: payload.status,
        message: responseMessage(payload)
      });
      router.refresh();
    } catch {
      setNotice({
        tone: "failed",
        message: "다시 조회 요청을 완료하지 못했습니다."
      });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h2 className="mb-3 text-base font-black text-ink">실패 조회</h2>
      {notice ? (
        <div
          className={`mb-3 rounded-md border p-3 text-sm font-bold ${
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : notice.tone === "partial"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {notice.message}
        </div>
      ) : null}
      {results.length === 0 ? (
        <p className="text-sm font-medium text-slate-600">최근 실패 결과가 없습니다.</p>
      ) : (
        <div className="divide-y divide-line">
          {results.map((result) => {
            const cooldownActive = isRetryCooldownActive(result.checkedAt);

            return (
              <div key={result.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-700">
                    {TYPE_LABELS[result.type]}
                  </span>
                  <StatusBadge status="failed" />
                  <span className="text-xs font-bold text-slate-500">{formatDateTime(result.checkedAt)}</span>
                </div>
                <div className="text-sm font-black text-ink">{result.watchItemTitle ?? "직접 조회"}</div>
                <div className="text-sm font-medium text-red-900">{result.errorText ?? result.summary ?? "실패했습니다."}</div>
                {result.errorCode ? <div className="text-xs font-bold text-slate-500">{result.errorCode}</div> : null}
                <div className="flex flex-wrap gap-2">
                  {result.watchItemId ? (
                    <button
                      type="button"
                      disabled={Boolean(busyId) || cooldownActive}
                      onClick={() => {
                        void retryResult(result);
                      }}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyId === result.id ? "조회 중" : cooldownActive ? "1분 대기" : "다시 조회"}
                    </button>
                  ) : null}
                  {result.officialUrl ? (
                    <a
                      href={result.officialUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50"
                    >
                      공식 페이지
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
