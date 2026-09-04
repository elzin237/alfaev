export type StatusBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
}

const toneStyles: Record<StatusBadgeTone, string> = {
  neutral: "border-zinc-200 bg-zinc-100 text-zinc-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-red-200 bg-red-50 text-red-700",
};

function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-lg border px-3 py-1 text-sm font-medium ${toneStyles[tone]}`}
    >
      {label}
    </span>
  );
}

export default StatusBadge;
