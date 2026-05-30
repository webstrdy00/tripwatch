import { StatusBadge } from "@/components/ui/StatusBadge";
import { summarizeLatestResult, summarizeWatchItemParams, type WatchItemListItem } from "@/lib/watchlist";

const TYPE_LABELS: Record<WatchItemListItem["type"], string> = {
  flight: "항공권",
  express_bus: "고속버스",
  intercity_bus: "시외버스",
  ticket: "공연"
};

export function formatDateTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString().replace("T", " ").slice(0, 16);
}

export function WatchItemSummary({ item }: { item: WatchItemListItem }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-700">
          {TYPE_LABELS[item.type]}
        </span>
        {item.latestResult ? <StatusBadge status={item.latestResult.status} /> : null}
      </div>
      <div className="font-black text-ink">{item.title}</div>
      <div className="max-w-2xl text-sm font-medium text-slate-600">{summarizeWatchItemParams(item)}</div>
    </div>
  );
}

export function WatchItemResultSummary({ item }: { item: WatchItemListItem }) {
  return <span>{summarizeLatestResult(item.latestResult)}</span>;
}
