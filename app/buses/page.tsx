import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingNotice } from "@/components/ui/LoadingNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SAFETY_NOTICE } from "@/lib/constants";

export default function BusesPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="버스" description="고속버스/시외버스 탭 placeholder입니다. 외부 조회는 아직 구현하지 않았습니다." />
      <section className="rounded-md border border-line bg-white p-4">
        <div className="mb-4 grid max-w-md grid-cols-2 rounded-md border border-line bg-panel p-1">
          <div className="rounded bg-white px-3 py-2 text-center text-sm font-black text-accent shadow-sm">고속버스</div>
          <div className="px-3 py-2 text-center text-sm font-black text-slate-600">시외버스</div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3">
            <PlaceholderField label="출발 터미널" value="서울경부 / 동서울" />
            <PlaceholderField label="도착 터미널" value="부산 / 속초" />
            <PlaceholderField label="날짜" value="YYYY-MM-DD" />
            <PlaceholderField label="희망 시간" value="HH:mm" />
          </div>
          <div className="grid content-start gap-3">
            <LoadingNotice />
            <EmptyState title="배차 결과 없음" description="다음 Phase에서 배차, 등급, 잔여석, 요금 표시를 연결합니다." />
            <div className="text-sm font-semibold text-slate-700">{SAFETY_NOTICE}</div>
            <StatusBadge status="needs_check" />
          </div>
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
