"use client";

import { useState } from "react";

import type { TripWatchApiResponse } from "@/lib/api-response";
import type { BusKind, BusQuery } from "@/lib/normalize/normalize-bus";
import type { WatchItemType } from "@/lib/validation/common-schema";

type Notice = {
  tone: "success" | "failed";
  message: string;
};

function responseMessage<T>(payload: TripWatchApiResponse<T>): string {
  return payload.error?.message ?? payload.summary ?? "요청을 처리하지 못했습니다.";
}

function typeForKind(kind: BusKind): Extract<WatchItemType, "express_bus" | "intercity_bus"> {
  return kind === "express" ? "express_bus" : "intercity_bus";
}

function labelForKind(kind: BusKind): string {
  return kind === "express" ? "고속버스" : "시외버스";
}

function buildWatchParams(query: BusQuery) {
  return {
    departName: query.departName,
    arriveName: query.arriveName,
    date: query.date,
    time: query.time,
    passengers: query.passengers
  };
}

export function SaveBusWatchButton({ kind, query, disabled = false }: { kind: BusKind; query: BusQuery; disabled?: boolean }) {
  const [memo, setMemo] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>();
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setNotice(undefined);

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          type: typeForKind(kind),
          title: `${query.departName} → ${query.arriveName} ${labelForKind(kind)}`,
          params: buildWatchParams(query),
          memo: memo.trim() ? memo.trim() : undefined
        })
      });
      const payload = (await response.json()) as TripWatchApiResponse<unknown>;

      if (payload.status === "success") {
        setNotice({ tone: "success", message: "관심 조건에 저장했습니다" });
        return;
      }

      setNotice({ tone: "failed", message: responseMessage(payload) });
    } catch {
      setNotice({ tone: "failed", message: "관심 조건 저장 요청을 완료하지 못했습니다." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-md border border-line bg-white p-4">
      <label className="form-field">
        <span className="form-label">관심 메모</span>
        <input className="form-input" value={memo} maxLength={1000} disabled={saving} onChange={(event) => setMemo(event.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="secondary-button" type="button" disabled={disabled || saving} onClick={handleSave}>
          {saving ? "저장 중" : "관심 저장"}
        </button>
        {notice ? (
          <span className={`text-sm font-bold ${notice.tone === "success" ? "text-emerald-700" : "text-red-700"}`}>{notice.message}</span>
        ) : null}
      </div>
    </div>
  );
}
