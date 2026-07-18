import { ForesttripSearchForm } from "@/components/foresttrip/ForesttripSearchForm";

export default function ForesttripPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="자연휴양림" description="자연휴양림 객실과 야영 시설의 예약 가능 여부를 조회합니다." />
      <ForesttripSearchForm />
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
