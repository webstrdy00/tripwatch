import type { BusKind, BusSchedule } from "@/lib/normalize/normalize-bus";

function display(value: string | number | undefined): string {
  if (value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function seatText(schedule: BusSchedule, kind: BusKind): string {
  if (kind === "intercity") {
    if (typeof schedule.remainSeats === "number" && typeof schedule.totalSeats === "number") {
      return `${schedule.remainSeats}/${schedule.totalSeats}`;
    }

    return display(schedule.remainSeats);
  }

  if (typeof schedule.remainSeats === "number" && typeof schedule.totalSeats === "number") {
    return `${schedule.remainSeats}석 / ${schedule.totalSeats}석`;
  }

  return typeof schedule.remainSeats === "number" ? `${schedule.remainSeats}석` : "-";
}

export function BusScheduleTable({ kind, schedules }: { kind: BusKind; schedules: BusSchedule[] }) {
  if (schedules.length === 0) {
    return null;
  }

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          {kind === "express" ? (
            <tr>
              <th>출발 시간</th>
              <th>도착 시간</th>
              <th>등급</th>
              <th>잔여석</th>
              <th>요금</th>
              <th>운수사</th>
            </tr>
          ) : (
            <tr>
              <th>출발 시간</th>
              <th>운수사</th>
              <th>등급</th>
              <th>잔여석/총좌석</th>
              <th>요금</th>
            </tr>
          )}
        </thead>
        <tbody>
          {schedules.map((schedule, index) =>
            kind === "express" ? (
              <tr key={`${schedule.departTime}-${index}`}>
                <td className="font-black text-ink">{schedule.departTime}</td>
                <td>{display(schedule.arriveTime)}</td>
                <td>{display(schedule.grade)}</td>
                <td>{seatText(schedule, kind)}</td>
                <td>{display(schedule.fareText)}</td>
                <td>{display(schedule.operator)}</td>
              </tr>
            ) : (
              <tr key={`${schedule.departTime}-${index}`}>
                <td className="font-black text-ink">{schedule.departTime}</td>
                <td>{display(schedule.operator)}</td>
                <td>{display(schedule.grade)}</td>
                <td>{seatText(schedule, kind)}</td>
                <td>{display(schedule.fareText)}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
