import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SAFETY_NOTICE } from "@/lib/constants";

export default function WatchlistPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="관심 조건" description="저장 조건 목록 placeholder입니다. 외부 조회와 DB 저장은 다음 Phase에서 연결합니다." />
      <section className="rounded-md border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusBadge status="needs_check" />
          <StatusBadge status="failed" />
        </div>
        <EmptyState
          title="저장된 관심 조건이 없습니다."
          description="항공권, 버스, 공연 조건 저장 UI와 조회 결과 저장은 다음 Phase의 작업입니다."
        />
        <LoadingNotice message="관심 조건 CRUD와 다시 조회 버튼은 아직 placeholder입니다." />
        <p className="mt-3 text-sm font-semibold text-slate-700">{SAFETY_NOTICE}</p>
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
