"use client";

import { useEffect, useState } from "react";

import type { WatchItemListItem } from "@/lib/watchlist";

export type WatchItemPatchPayload = {
  title?: string;
  memo?: string | null;
  enabled?: boolean;
};

export function WatchItemActions({
  item,
  busy,
  running,
  onPatch,
  onDelete,
  onRun
}: {
  item: WatchItemListItem;
  busy: boolean;
  running: boolean;
  onPatch: (id: string, payload: WatchItemPatchPayload) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRun: (id: string) => Promise<void>;
}) {
  const [memo, setMemo] = useState(item.memo ?? "");

  useEffect(() => {
    setMemo(item.memo ?? "");
  }, [item.id, item.memo]);

  const memoChanged = memo !== (item.memo ?? "");

  return (
    <div className="grid min-w-60 gap-2">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
        <input
          type="checkbox"
          checked={item.enabled}
          disabled={busy}
          onChange={(event) => {
            void onPatch(item.id, {
              enabled: event.currentTarget.checked
            });
          }}
        />
        활성
      </label>

      <label className="form-field">
        <span className="form-label">메모</span>
        <textarea className="form-input min-h-20 resize-y" value={memo} maxLength={1000} onChange={(event) => setMemo(event.target.value)} />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          className="secondary-button"
          type="button"
          disabled={busy || !memoChanged}
          onClick={() => {
            void onPatch(item.id, {
              memo: memo.trim() ? memo.trim() : null
            });
          }}
        >
          메모 저장
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => {
            void onRun(item.id);
          }}
        >
          {running ? "조회 중" : "다시 조회"}
        </button>
        <button
          className="danger-button"
          type="button"
          disabled={busy}
          onClick={() => {
            void onDelete(item.id);
          }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}
