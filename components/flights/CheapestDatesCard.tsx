import { formatKrw, type FlightCheapestDate } from "@/lib/normalize/normalize-flight";

export function CheapestDatesCard({ dates }: { dates: FlightCheapestDate[] | undefined }) {
  if (!dates || dates.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-black text-ink">가장 싼 날짜 후보</h2>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {dates.slice(0, 6).map((item) => (
          <div
            key={item.date}
            className={`rounded-md border bg-white p-3 ${
              item.status === "success" ? "border-line" : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-black text-ink">{item.date}</div>
              <div className="text-sm font-black text-ink">{formatKrw(item.minPrice)}</div>
            </div>
            <div className="mt-1 text-sm font-medium text-slate-600">평균 {formatKrw(item.avgPrice)}</div>
            {item.bookingSearchUrl ? (
              <a
                className="mt-3 inline-flex text-sm font-black text-accent underline-offset-4 hover:underline"
                href={item.bookingSearchUrl}
                target="_blank"
                rel="noreferrer"
              >
                Google Flights에서 보기
              </a>
            ) : null}
            {item.error ? <div className="mt-2 text-xs font-bold text-red-800">{item.error}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
