import { STATUS_LABELS, type TripWatchDisplayStatus } from "@/lib/constants";

const STATUS_STYLES: Record<TripWatchDisplayStatus, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  needs_check: "border-slate-300 bg-slate-100 text-slate-700"
};

export function StatusBadge({ status }: { status: TripWatchDisplayStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-bold ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
