"use client";

import { useState } from "react";

import type { TripWatchApiResponse } from "@/lib/api-response";

type Notice = {
  tone: "success" | "failed";
  message: string;
};

function responseMessage<T>(payload: TripWatchApiResponse<T>): string {
  return payload.error?.message ?? payload.summary ?? "요청을 처리하지 못했습니다.";
}

export function SaveTicketWatchButton({ input, disabled = false }: { input: string; disabled?: boolean }) {
  const [memo, setMemo] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>();
  const [saving, setSaving] = useState(false);
  const watchInput = input.trim();

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
          type: "ticket",
          title: `${watchInput} 공연`,
          params: {
            input: watchInput,
            mode: "seats"
          },
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
        <button className="secondary-button" type="button" disabled={disabled || saving || !watchInput} onClick={handleSave}>
          {saving ? "저장 중" : "관심 저장"}
        </button>
        {notice ? (
          <span className={`text-sm font-bold ${notice.tone === "success" ? "text-emerald-700" : "text-red-700"}`}>{notice.message}</span>
        ) : null}
      </div>
    </div>
  );
}
