import type { DashboardSummaryData } from "@/lib/dashboard";
import { formatDate, formatDateTime } from "@/lib/dates";


function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function SummaryCards({ summary }: { summary: DashboardSummaryData }) {
  const cards = [
    {
      label: "항공권 관심 조건",
      value: formatNumber(summary.counts.flights),
      detail: `전체 활성 ${formatNumber(summary.counts.enabledWatchItems)}개`
    },
    {
      label: "버스 관심 조건",
      value: formatNumber(summary.counts.buses),
      detail: "고속버스 + 시외버스"
    },
    {
      label: "공연 관심 조건",
      value: formatNumber(summary.counts.tickets),
      detail: "전체 다시 조회 기본 제외"
    },
    {
      label: "실패한 최근 조회",
      value: formatNumber(summary.failedResults.length),
      detail: `누적 실패 ${formatNumber(summary.counts.failedResults)}개`
    }
  ];

  return (
    <section className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-md border border-line bg-white p-4">
            <div className="text-xs font-bold text-slate-500">{card.label}</div>
            <div className="mt-1 text-2xl font-black text-ink">{card.value}</div>
            <div className="mt-2 text-xs font-bold text-slate-500">{card.detail}</div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-line bg-white px-4 py-3 text-sm font-bold text-slate-600">
        오늘 {formatDate(summary.generatedAt)} · 최근 조회 {formatDateTime(summary.lastCheckedAt)}
      </div>
    </section>
  );
}
