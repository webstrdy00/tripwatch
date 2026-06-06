import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateTime } from "@/components/watchlist/WatchItemSummary";
import { formatKrw, type FlightPriceBand, type FlightSearchData } from "@/lib/normalize/normalize-flight";
import type { TripWatchStatus } from "@/lib/api-response";

const PRICE_BAND_LABELS: Record<FlightPriceBand, string> = {
  low: "낮음",
  medium: "보통",
  high: "높음",
  unknown: "확인 필요"
};

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-black text-ink">{value}</div>
    </div>
  );
}

export function FlightResultSummary({
  data,
  status,
  checkedAt
}: {
  data: FlightSearchData;
  status: TripWatchStatus;
  checkedAt: string;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-ink">조회 요약</h2>
          <p className="text-sm font-medium text-slate-600">
            {data.query.from} → {data.query.to} / {data.query.yearMonth ?? data.query.date}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryMetric label="최저가" value={formatKrw(data.priceSummary.minPrice)} />
        <SummaryMetric label="평균가" value={formatKrw(data.priceSummary.avgPrice)} />
        <SummaryMetric label="가격대" value={PRICE_BAND_LABELS[data.priceSummary.priceBand]} />
        <SummaryMetric label="가장 싼 날짜" value={data.priceSummary.cheapestDate ?? "-"} />
        <SummaryMetric label="조회 시각" value={formatDateTime(checkedAt)} />
      </div>
    </section>
  );
}
