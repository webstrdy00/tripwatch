import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SAFETY_NOTICE } from "@/lib/constants";

export default function FlightsPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="항공권" description="항공권 검색 화면 placeholder입니다. 외부 조회는 아직 구현하지 않았습니다." />
      <section className="grid gap-4 rounded-md border border-line bg-white p-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <PlaceholderField label="출발 공항" value="ICN" />
          <PlaceholderField label="도착 공항" value="NRT" />
          <PlaceholderField label="출발일" value="YYYY-MM-DD" />
          <PlaceholderField label="귀국일" value="YYYY-MM-DD" />
          <PlaceholderField label="좌석 등급" value="economy" />
        </div>
        <div className="grid content-start gap-3">
          <LoadingNotice />
          <EmptyState title="항공권 결과 없음" description="다음 Phase에서 단일 검색과 월별 비교 결과 영역을 연결합니다." />
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
