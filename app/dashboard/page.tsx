import { FailedResultsPanel } from "@/components/dashboard/FailedResultsPanel";
import { RecentResultsPanel } from "@/components/dashboard/RecentResultsPanel";
import { RunBatchButtons } from "@/components/dashboard/RunBatchButtons";
import { SummaryCards } from "@/components/dashboard/SummaryCards";
import { WatchItemsPanel } from "@/components/dashboard/WatchItemsPanel";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { SAFETY_NOTICE } from "@/lib/constants";
import { getDashboardSummary, type DashboardSummaryData } from "@/lib/dashboard";
import { summarizeError } from "@/lib/errors";

export const dynamic = "force-dynamic";

async function loadDashboardSummary(): Promise<{ summary?: DashboardSummaryData; error?: string }> {
  try {
    return {
      summary: await getDashboardSummary()
    };
  } catch (error) {
    return {
      error: summarizeError(error)
    };
  }
}

export default async function DashboardPage() {
  const { summary, error } = await loadDashboardSummary();

  return (
    <div className="grid gap-5">
      <PageTitle title="대시보드" description="관심 조건, 최근 조회, 실패 조회를 한 곳에서 확인합니다." />
      {error ? <ErrorCard title="대시보드를 불러오지 못했습니다." message={error} /> : null}
      {summary ? (
        <>
          <SummaryCards summary={summary} />
          <RunBatchButtons />
          <section className="grid gap-5 xl:grid-cols-3">
            <WatchItemsPanel items={summary.watchItems} />
            <RecentResultsPanel results={summary.recentResults} />
            <FailedResultsPanel results={summary.failedResults} />
          </section>
          <p className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE}</p>
        </>
      ) : null}
    </div>
  );
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-line pb-4">
      <h1 className="text-2xl font-black tracking-normal text-ink">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm font-medium text-slate-600">{description}</p>
    </div>
  );
}
