import type { TicketPerformance } from "@/lib/normalize/normalize-ticket";

function display(value: string | undefined): string {
  return value && value.trim() ? value : "-";
}

export function TicketScheduleTable({ performances }: { performances: TicketPerformance[] }) {
  if (performances.length === 0) {
    return null;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            <th>날짜</th>
            <th>시간</th>
            <th>회차</th>
            <th>제목</th>
            <th>원본 표시</th>
          </tr>
        </thead>
        <tbody>
          {performances.map((performance, index) => (
            <tr key={`${performance.date}-${performance.time}-${performance.playSeq ?? index}`}>
              <td className="font-black text-ink">{performance.date}</td>
              <td>{performance.time}</td>
              <td>{display(performance.playSeq)}</td>
              <td>{display(performance.title)}</td>
              <td>{display(performance.rawLabel)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
