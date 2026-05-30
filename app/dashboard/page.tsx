import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorCard } from "@/components/ui/ErrorCard";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { todayLabel } from "@/lib/dates";

export default function DashboardPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="대시보드" description="관심 조건, 최근 조회, 실패 조회 영역을 준비한 v0.1 skeleton입니다." />

      <section className="grid gap-3 md:grid-cols-4">
        <SummaryCell label="관심 조건" value="0" />
        <SummaryCell label="최근 조회" value="0" />
        <SummaryCell label="실패 조회" value="0" />
        <SummaryCell label="기준 시각" value={todayLabel()} compact />
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <Panel title="관심 조건">
          <EmptyState title="저장된 관심 조건이 없습니다." description="다음 Phase에서 조건 저장과 재조회 흐름을 연결합니다." />
        </Panel>
        <Panel title="최근 조회">
          <LoadingNotice message="최근 조회 데이터는 아직 외부 조회와 DB 저장을 연결하지 않은 placeholder입니다." />
        </Panel>
        <Panel title="실패 조회">
          <ErrorCard message="실패 조회 영역은 실패를 숨기지 않고 표시하기 위한 placeholder입니다." />
        </Panel>
      </section>

      <div className="flex flex-wrap gap-2">
        <StatusBadge status="success" />
        <StatusBadge status="partial" />
        <StatusBadge status="failed" />
        <StatusBadge status="needs_check" />
      </div>
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

function SummaryCell({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className={`mt-1 font-black text-ink ${compact ? "text-base" : "text-2xl"}`}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-white p-4">
      <h2 className="mb-3 text-base font-black">{title}</h2>
      {children}
    </section>
  );
}
