"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { TripWatchApiResponse } from "@/lib/api-response";

type BatchRequest = {
  type?: "flight" | "express_bus" | "intercity_bus" | "ticket";
  failedOnly?: boolean;
  includeTickets?: boolean;
  limit?: number;
};

type BatchResponseData = {
  executedCount: number;
  skippedCount: number;
  results?: unknown[];
};

type Notice = {
  tone: "success" | "partial" | "failed";
  message: string;
};

const BUTTONS: {
  id: string;
  label: string;
  body: BatchRequest | BatchRequest[];
  confirmMessage?: string;
}[] = [
  {
    id: "all",
    label: "전체 다시 조회",
    body: {}
  },
  {
    id: "flight",
    label: "항공권만",
    body: {
      type: "flight"
    }
  },
  {
    id: "bus",
    label: "버스만",
    body: [
      {
        type: "express_bus",
        limit: 10
      },
      {
        type: "intercity_bus",
        limit: 10
      }
    ]
  },
  {
    id: "ticket",
    label: "공연만",
    body: {
      type: "ticket",
      includeTickets: true
    },
    confirmMessage: "공연은 기본 전체 다시 조회에서 제외됩니다. 이 요청에만 공연을 포함해 다시 조회할까요?"
  },
  {
    id: "failed",
    label: "실패만",
    body: {
      failedOnly: true
    }
  }
];

function responseMessage(payload: TripWatchApiResponse<BatchResponseData>): string {
  if (payload.summary) {
    return payload.summary;
  }

  const base = payload.error?.message ?? "다시 조회 요청을 처리하지 못했습니다.";
  const detail = payload.data ? ` 실행 ${payload.data.executedCount}개, 건너뜀 ${payload.data.skippedCount}개.` : "";

  return `${base}${detail}`;
}

function mergeTone(current: Notice["tone"], next: Notice["tone"]): Notice["tone"] {
  if (current === "failed" || next === "failed") {
    return current === "success" || next === "success" || current === "partial" || next === "partial" ? "partial" : "failed";
  }

  if (current === "partial" || next === "partial") {
    return "partial";
  }

  return "success";
}

export function RunBatchButtons() {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();

  async function runBatch(button: (typeof BUTTONS)[number]) {
    if (button.confirmMessage && !window.confirm(button.confirmMessage)) {
      return;
    }

    setBusyId(button.id);
    setNotice(undefined);

    try {
      const requests = Array.isArray(button.body) ? button.body : [button.body];
      let tone: Notice["tone"] = "success";
      let executedCount = 0;
      let skippedCount = 0;
      let usedCount = 0;
      const messages: string[] = [];

      for (const requestBody of requests) {
        const remainingLimit = Math.max(0, 10 - usedCount);

        if (remainingLimit === 0) {
          break;
        }

        const response = await fetch("/api/watchlist/run-batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...requestBody,
            limit: Math.min(requestBody.limit ?? 10, remainingLimit)
          })
        });
        const payload = (await response.json()) as TripWatchApiResponse<BatchResponseData>;

        tone = mergeTone(tone, payload.status);
        executedCount += payload.data?.executedCount ?? 0;
        skippedCount += payload.data?.skippedCount ?? 0;
        usedCount += payload.data?.results?.length ?? 0;
        messages.push(responseMessage(payload));
      }

      setNotice({
        tone,
        message:
          requests.length === 1
            ? (messages[0] ?? "다시 조회 요청을 처리했습니다.")
            : `버스 다시 조회 요청을 처리했습니다. 실행 ${executedCount}개, 건너뜀 ${skippedCount}개.`
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-ink">수동 다시 조회</h2>
        <div className="flex flex-wrap gap-2">
          {BUTTONS.map((button) => (
            <button
              key={button.id}
              type="button"
              disabled={Boolean(busyId)}
              onClick={() => {
                void runBatch(button);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyId === button.id ? "조회 중" : button.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs font-bold text-slate-500">
        전체 다시 조회와 실패만 조회는 공연을 제외합니다. 공연은 공연만 버튼에서 확인 후 실행합니다.
      </p>

      {notice ? (
        <div
          className={`mt-3 rounded-md border p-3 text-sm font-bold ${
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
    </section>
  );
}
