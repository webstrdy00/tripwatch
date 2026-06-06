import { TicketSearchForm } from "@/components/tickets/TicketSearchForm";

export default function TicketsPage() {
  return (
    <div className="grid gap-5">
      <PageTitle title="공연" description="YES24ㆍ인터파크 공연 일정과 등급별 잔여석을 조회합니다." />
      <TicketSearchForm />
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
