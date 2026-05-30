import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SAFETY_NOTICE } from "@/lib/constants";

export default function TicketsPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="공연" description="공연 일정/잔여석 조회 placeholder입니다. 외부 조회는 아직 구현하지 않았습니다." />
      <section className="grid gap-4 rounded-md border border-line bg-white p-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <PlaceholderField label="공연 URL" value="https://tickets.interpark.com/goods/{id}" />
          <PlaceholderField label="platform:id" value="interpark:{id} / yes24:{id}" />
          <PlaceholderField label="조회 모드" value="일정 조회 / 잔여석 조회" />
        </div>
        <div className="grid content-start gap-3">
          <LoadingNotice />
          <EmptyState title="공연 결과 없음" description="다음 Phase에서 회차별 일정과 등급별 잔여석 영역을 연결합니다." />
          <div className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE}</div>
          <StatusBadge status="needs_check" />
        </div>
      </section>
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

function PlaceholderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 font-black text-ink">{value}</div>
    </div>
  );
}
