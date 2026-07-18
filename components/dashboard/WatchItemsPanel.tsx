import Link from "next/link";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateTime } from "@/lib/dates";
import { summarizeLatestResult, summarizeWatchItemParams, type WatchItemListItem } from "@/lib/watchlist";

const TYPE_LABELS: Record<WatchItemListItem["type"], string> = {
  flight: "항공권",
  express_bus: "고속버스",
  intercity_bus: "시외버스",
  ticket: "공연",
  foresttrip: "자연휴양림"
};


export function WatchItemsPanel({ items }: { items: WatchItemListItem[] }) {
  return (
    <section className="rounded-md border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-ink">관심 조건</h2>
        <Link href="/watchlist" className="text-xs font-black text-slate-600 underline-offset-4 hover:underline">
          관리
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-sm font-medium text-slate-600">저장된 관심 조건이 없습니다.</p>
      ) : (
        <div className="divide-y divide-line">
          {items.map((item) => (
            <div key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-700">
                  {TYPE_LABELS[item.type]}
                </span>
                {item.latestResult ? <StatusBadge status={item.latestResult.status} /> : null}
                <span className="text-xs font-bold text-slate-500">{item.enabled ? "활성" : "비활성"}</span>
              </div>
              <div className="text-sm font-black text-ink">{item.title}</div>
              <div className="text-sm font-medium text-slate-600">{summarizeWatchItemParams(item)}</div>
              <div className="text-xs font-bold text-slate-500">
                {formatDateTime(item.latestResult?.checkedAt)} · {summarizeLatestResult(item.latestResult)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
