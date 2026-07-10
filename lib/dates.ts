const KOREA_TIME_ZONE = "Asia/Seoul";

function toValidDate(value: string | Date | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = typeof value === "string" ? new Date(value) : value;

  return Number.isNaN(date.getTime()) ? undefined : date;
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
