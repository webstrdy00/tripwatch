import { FlightSearchForm } from "@/components/flights/FlightSearchForm";

export default function FlightsPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="항공권" description="편도ㆍ왕복 항공권 검색과 월별 가격 비교를 조회합니다." />
      <FlightSearchForm />
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
