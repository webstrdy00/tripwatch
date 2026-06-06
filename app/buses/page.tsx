import { BusTabs } from "@/components/buses/BusTabs";

export default function BusesPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="버스" description="고속버스와 시외버스 배차, 잔여석, 요금을 조회합니다." />
      <BusTabs />
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
