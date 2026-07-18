export const APP_NAME = "TripWatch";
export const SERVICE_NAME = "JariDash";

export const SAFETY_NOTICE = "예약/결제는 공식 페이지에서 사용자가 직접 진행합니다.";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/flights", label: "항공권" },
  { href: "/buses", label: "버스" },
  { href: "/tickets", label: "공연" },
  { href: "/foresttrip", label: "자연휴양림" },
  { href: "/watchlist", label: "관심 조건" }
] as const;

export const STATUS_LABELS = {
  success: "성공",
  partial: "부분 성공",
  failed: "실패",
  needs_check: "확인 필요"
} as const;

export type TripWatchDisplayStatus = keyof typeof STATUS_LABELS;
