"use client";

import { useRef, useState } from "react";

import { WatchItemActions, type WatchItemPatchPayload } from "@/components/watchlist/WatchItemActions";
import { WatchItemForm, type WatchItemCreatePayload } from "@/components/watchlist/WatchItemForm";
import { WatchItemResultSummary, WatchItemSummary, formatDateTime } from "@/components/watchlist/WatchItemSummary";
import { EmptyState } from "@/components/ui/EmptyState";
import type { TripWatchApiResponse } from "@/lib/api-response";
import type { WatchItemListItem } from "@/lib/watchlist";

type Notice = {
  tone: "success" | "partial" | "failed";
  message: string;
};

async function readApiResponse<T>(response: Response): Promise<TripWatchApiResponse<T>> {
  const payload = (await response.json()) as TripWatchApiResponse<T>;
  return payload;
}

function responseMessage<T>(payload: TripWatchApiResponse<T>): string {
  return payload.error?.message ?? payload.summary ?? "요청을 처리하지 못했습니다.";
}

export function WatchlistTable({ initialItems }: { initialItems: WatchItemListItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [runningId, setRunningId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const itemOperationLock = useRef(false);

  function beginItemOperation(id: string): boolean {
    if (itemOperationLock.current) {
      return false;
    }

    itemOperationLock.current = true;
    setBusyId(id);
    setNotice(undefined);
    return true;
  }

  function endItemOperation() {
    itemOperationLock.current = false;
    setBusyId(undefined);
  }

  async function refreshItems() {
    const response = await fetch("/api/watchlist");
    const result = await readApiResponse<{ items: WatchItemListItem[] }>(response);

    if (result.status !== "success" || !result.data?.items) {
      throw new Error(responseMessage(result));
    }

    setItems(result.data.items);
  }

  async function createItem(payload: WatchItemCreatePayload) {
    setCreating(true);
    setNotice(undefined);

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = await readApiResponse<{ item: WatchItemListItem }>(response);
      const createdItem = result.data?.item;

      if (result.status === "success" && createdItem) {
        setItems((current) => [createdItem, ...current]);
        setNotice({ tone: "success", message: result.summary ?? "관심 조건을 저장했습니다." });
        return;
      }

      setNotice({ tone: "failed", message: responseMessage(result) });
    } catch {
      setNotice({ tone: "failed", message: "관심 조건 저장 요청을 완료하지 못했습니다." });
    } finally {
      setCreating(false);
    }
  }

  async function patchItem(id: string, payload: WatchItemPatchPayload) {
    if (!beginItemOperation(id)) {
      return;
    }

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = await readApiResponse<{ item: WatchItemListItem }>(response);
      const updatedItem = result.data?.item;

      if (result.status === "success" && updatedItem) {
        setItems((current) => current.map((item) => (item.id === id ? updatedItem : item)));
        setNotice({ tone: "success", message: result.summary ?? "관심 조건을 수정했습니다." });
        return;
      }

      setNotice({ tone: "failed", message: responseMessage(result) });
    } catch {
      setNotice({ tone: "failed", message: "관심 조건 수정 요청을 완료하지 못했습니다." });
    } finally {
      endItemOperation();
    }
  }

  async function deleteItem(id: string) {
    if (!window.confirm("이 관심 조건을 삭제할까요?")) {
      return;
    }

    if (!beginItemOperation(id)) {
      return;
    }

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      const result = await readApiResponse<{ id: string }>(response);

      if (result.status === "success") {
        setItems((current) => current.filter((item) => item.id !== id));
        setNotice({ tone: "success", message: result.summary ?? "관심 조건을 삭제했습니다." });
        return;
      }

      setNotice({ tone: "failed", message: responseMessage(result) });
    } catch {
      setNotice({ tone: "failed", message: "관심 조건 삭제 요청을 완료하지 못했습니다." });
    } finally {
      endItemOperation();
    }
  }

  async function runItem(id: string) {
    if (!beginItemOperation(id)) {
      return;
    }

    setRunningId(id);

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(id)}/run`, {
        method: "POST"
      });
      const result = await readApiResponse<unknown>(response);
      let refreshFailed = false;

      try {
        await refreshItems();
      } catch {
        refreshFailed = true;
      }

      const message = responseMessage(result);
      setNotice({
        tone: refreshFailed && result.status !== "failed" ? "partial" : result.status,
        message: refreshFailed
          ? `${message} 최신 결과 목록을 갱신하지 못했습니다. 페이지를 새로고침하세요.`
          : message
      });
    } catch {
      setNotice({ tone: "failed", message: "다시 조회 요청을 완료하지 못했습니다." });
    } finally {
      setRunningId(undefined);
      endItemOperation();
    }
  }

  return (
    <div className="grid gap-5">
      <WatchItemForm busy={creating} onCreate={createItem} />

      {notice ? (
        <div
          className={`rounded-md border p-4 text-sm font-bold ${
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

      {items.length === 0 ? (
        <EmptyState title="저장된 관심 조건이 없습니다." description="항공권, 버스, 공연 조건을 저장하면 이곳에 표시됩니다." />
      ) : (
        <div className="table-shell">
          <table className="data-table min-w-[1120px]">
            <thead>
              <tr>
                <th>조건</th>
                <th>메모</th>
                <th>활성 여부</th>
                <th>마지막 결과</th>
                <th>마지막 조회</th>
                <th>액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <WatchItemSummary item={item} />
                  </td>
                  <td className="max-w-xs text-sm font-medium text-slate-700">{item.memo || "-"}</td>
                  <td className="font-bold text-slate-700">{item.enabled ? "활성" : "비활성"}</td>
                  <td className="max-w-sm text-sm font-medium text-slate-700">
                    <WatchItemResultSummary item={item} />
                    {item.latestResult?.officialUrl ? (
                      <a
                        href={item.latestResult.officialUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs font-black text-slate-600 underline-offset-4 hover:underline"
                      >
                        공식 페이지
                      </a>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap text-sm font-medium text-slate-700">{formatDateTime(item.latestResult?.checkedAt)}</td>
                  <td>
                    <WatchItemActions
                      item={item}
                      busy={Boolean(busyId)}
                      running={runningId === item.id}
                      onPatch={patchItem}
                      onDelete={deleteItem}
                      onRun={runItem}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
