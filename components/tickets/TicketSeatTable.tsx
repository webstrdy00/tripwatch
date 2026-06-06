import { EmptyState } from "@/components/ui/EmptyState";
import type { TicketSeatPerformance } from "@/lib/normalize/normalize-ticket";

function display(value: string | undefined): string {
  return value && value.trim() ? value : "-";
}

function statusLabel(value: string | undefined): string {
  if (value === "available") {
    return "잔여";
  }

  if (value === "sold_out") {
    return "매진";
  }

  return "확인 필요";
}

export function TicketSeatTable({ seats }: { seats: TicketSeatPerformance[] }) {
  const rows = seats.flatMap((performance) =>
    performance.grades.map((grade) => ({
      performance,
      grade
    }))
  );

  if (rows.length === 0) {
    return <EmptyState title="표시할 잔여석 정보가 없습니다" description="공식 예매 페이지에서 최신 좌석 상태를 직접 확인하세요." />;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>시간</th>
            <th>회차</th>
            <th>등급</th>
            <th>잔여 수</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ performance, grade }, index) => (
            <tr key={`${performance.date}-${performance.time}-${performance.playSeq ?? "seq"}-${grade.grade}-${index}`}>
              <td className="font-black text-ink">{performance.date}</td>
              <td>{performance.time}</td>
              <td>{display(performance.playSeq)}</td>
              <td>{grade.grade}</td>
              <td>{grade.remain}</td>
              <td>{statusLabel(grade.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
