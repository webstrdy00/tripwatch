const KOREA_TIME_ZONE = "Asia/Seoul";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toValidDate(value: string | Date | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  return Number.isNaN(date.getTime()) ? undefined : date;
}
function getKstDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number.parseInt(values.year, 10),
    month: Number.parseInt(values.month, 10),
    day: Number.parseInt(values.day, 10)
  };
}

export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function getKstCalendarDate(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("유효한 현재 시각이 필요합니다.");
  }

  const { year, month, day } = getKstDateParts(now);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function isKstTodayOrFuture(value: string, now: Date = new Date()): boolean {
  return isRealIsoDate(value) && value >= getKstCalendarDate(now);
}

export function isoDateToCompact(value: string): string {
  if (!isRealIsoDate(value)) {
    throw new RangeError("실제 존재하는 YYYY-MM-DD 날짜가 필요합니다.");
  }

  return value.replaceAll("-", "");
}

export function formatDateTime(value: string | Date | undefined): string {
  const date = toValidDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: KOREA_TIME_ZONE
  }).format(date);
}

export function formatDate(value: string | Date | undefined): string {
  const date = toValidDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeZone: KOREA_TIME_ZONE
  }).format(date);
}

export function todayLabel(): string {
  return formatDate(new Date());
}
