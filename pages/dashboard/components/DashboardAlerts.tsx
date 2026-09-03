import { AlertTriangle, ClipboardList, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AlertLevel } from "../../../lib/types/domain";
import { alerts } from "../data/dashboardMockData";

const iconMap: Record<AlertLevel, LucideIcon> = {
  critical: AlertTriangle,
  document: FileText,
  task: ClipboardList,
};

const iconStyles: Record<AlertLevel, string> = {
  critical: "bg-red-600 text-white",
  document: "bg-zinc-900 text-white",
  task: "bg-zinc-900 text-white",
};

function DashboardAlerts() {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-5">
        <h2 className="text-lg font-bold text-zinc-900">
          KRITIČNA OBAVJEŠTENJA
        </h2>

        <button className="text-sm font-medium text-red-600 transition hover:text-red-700">
          Pogledaj sve →
        </button>
      </div>

      <div className="space-y-3 p-4">
        {alerts.map((alert) => {
          const Icon = iconMap[alert.level];

          return (
            <article
              key={alert.id}
              className="rounded-2xl border border-zinc-200 p-5 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex gap-4">
                <div
                  className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${
                    iconStyles[alert.level]
                  }`}
                >
                  <Icon size={30} strokeWidth={2.2} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base font-semibold leading-tight text-zinc-900">
                      {alert.title}
                    </h3>

                    <span className="shrink-0 text-sm text-zinc-500">
                      {alert.time}
                    </span>
                  </div>

                  <p className="mt-3 text-base leading-relaxed text-zinc-600">
                    {alert.description}
                  </p>

                  {alert.meta && (
                    <p
                      className={`mt-3 text-sm font-medium ${
                        alert.level === "critical"
                          ? "text-red-600"
                          : "text-zinc-500"
                      }`}
                    >
                      {alert.meta}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default DashboardAlerts;
