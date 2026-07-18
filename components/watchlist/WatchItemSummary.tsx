import { StatusBadge } from "@/components/ui/StatusBadge";
import { summarizeLatestResult, summarizeWatchItemParams, type WatchItemListItem } from "@/lib/watchlist";

const TYPE_LABELS: Record<WatchItemListItem["type"], string> = {
  flight: "항공권",
  express_bus: "고속버스",
  intercity_bus: "시외버스",
  ticket: "공연",
  foresttrip: "자연휴양림"
};
function summarizeForesttripParams(paramsJson: string): string {
  try {
    const params = JSON.parse(paramsJson) as Record<string, unknown>;
    const forestName = typeof params.forestName === "string" && params.forestName.trim() ? params.forestName : "?";
    const date = typeof params.date === "string" && params.date.trim() ? params.date : "?";
    const category = params.category === "01" ? "숙박" : params.category === "02" ? "야영" : "?";

    return `휴양림명: ${forestName} / 날짜: ${date} / 카테고리: ${category}`;
  } catch {
    return "휴양림명: ? / 날짜: ? / 카테고리: ?";
  }
}


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
      <div className="max-w-2xl text-sm font-medium text-slate-600">
        {item.type === "foresttrip" ? summarizeForesttripParams(item.paramsJson) : summarizeWatchItemParams(item)}
      </div>
    </div>
  );
}

export function WatchItemResultSummary({ item }: { item: WatchItemListItem }) {
  return <span>{summarizeLatestResult(item.latestResult)}</span>;
}
