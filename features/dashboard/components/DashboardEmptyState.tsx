import type { LucideIcon } from "lucide-react";

export default function DashboardEmptyState({ icon: Icon, title, description }: {
  icon: LucideIcon; title: string; description: string;
}) {
  return (
    <div className="flex items-start gap-3 px-2 py-3 text-left">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-zinc-300">
        <Icon size={20} strokeWidth={1.5} />
      </span>
      <div className="min-w-0"><p className="text-xs font-semibold text-zinc-800">{title}</p>
      <p className="mt-1 max-w-xs text-xs leading-4 text-zinc-500">{description}</p>
      </div>
    </div>
  );
}
