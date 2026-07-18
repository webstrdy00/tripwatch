import { StatusBadge } from "@/components/ui/StatusBadge";
import type { DashboardResultItem } from "@/lib/dashboard";
import { formatDateTime } from "@/lib/dates";

const TYPE_LABELS: Record<DashboardResultItem["type"], string> = {
  flight: "항공권",
  express_bus: "고속버스",
  intercity_bus: "시외버스",
  ticket: "공연",
  foresttrip: "자연휴양림"
};


export function RecentResultsPanel({ results }: { results: DashboardResultItem[] }) {
  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h2 className="mb-3 text-base font-black text-ink">최근 조회</h2>
      {results.length === 0 ? (
        <p className="text-sm font-medium text-slate-600">아직 조회 결과가 없습니다.</p>
      ) : (
        <div className="divide-y divide-line">
          {results.map((result) => (
            <div key={result.id} className="grid gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-black text-slate-700">
                  {TYPE_LABELS[result.type]}
                </span>
                <StatusBadge status={result.status} />
                <span className="text-xs font-bold text-slate-500">{formatDateTime(result.checkedAt)}</span>
              </div>
              <div className="text-sm font-black text-ink">{result.watchItemTitle ?? "직접 조회"}</div>
              <div className="text-sm font-medium text-slate-600">{result.summary ?? result.errorText ?? result.status}</div>
              {result.officialUrl ? (
                <a
                  href={result.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-black text-slate-600 underline-offset-4 hover:underline"
                >
                  공식 페이지
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
