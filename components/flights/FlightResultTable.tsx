import { EmptyState } from "@/components/ui/EmptyState";
import { formatKrw, type FlightOption } from "@/lib/normalize/normalize-flight";

function stopsLabel(stops: number | undefined): string {
  if (stops === undefined) {
    return "확인 필요";
  }

  return stops === 0 ? "직항" : `${stops}회 경유`;
}

export function FlightResultTable({ flights }: { flights: FlightOption[] }) {
  if (flights.length === 0) {
    return <EmptyState title="항공편 후보가 없습니다." description="공식 Google Flights 링크에서 직접 확인하세요." />;
  }

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-black text-ink">항공편 후보</h2>
      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>항공사</th>
              <th>출발</th>
              <th>도착</th>
              <th>소요시간</th>
              <th>경유</th>
              <th>가격</th>
              <th>품질</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((flight, index) => (
              <tr key={`${flight.airlineName ?? "flight"}-${flight.departureTime ?? index}-${index}`}>
                <td className="font-bold text-ink">{flight.airlineName ?? "항공편 상세 확인 불가"}</td>
                <td>{flight.departureTime ?? "-"}</td>
                <td>{flight.arrivalTime ?? "-"}</td>
                <td>{flight.duration ?? "-"}</td>
                <td>{stopsLabel(flight.stops)}</td>
                <td className="font-black text-ink">{flight.priceText ?? formatKrw(flight.price)}</td>
                <td>
                  <span
                    className={`inline-flex rounded-md border px-2 py-1 text-xs font-bold ${
                      flight.quality === "complete"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {flight.quality === "complete" ? "완전" : "일부"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
