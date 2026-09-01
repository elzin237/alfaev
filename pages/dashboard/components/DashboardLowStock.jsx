import { TriangleAlert } from "lucide-react";
import { inventory } from "../data/dashboardMockData";

function DashboardLowStock() {
  return (
    <section className="h-full rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-5">
        <h2 className="text-lg font-bold text-zinc-900">
          MATERIJALI ISPOD MINIMUMA
        </h2>

        <button className="text-sm font-medium text-red-600 transition hover:text-red-700">
          Pogledaj sve →
        </button>
      </div>

      <div className="space-y-3 p-4">
        {inventory.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border border-zinc-200 p-4 transition hover:border-zinc-300 hover:bg-zinc-50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-semibold text-zinc-900">
                  {item.item}
                </h3>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Na stanju
                    </p>

                    <p className="mt-1 text-xl font-bold text-zinc-900">
                      {item.stock}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Minimum
                    </p>

                    <p className="mt-1 text-xl font-bold text-zinc-900">
                      {item.minimum}
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                  item.status === "Kritično"
                    ? "bg-red-100 text-red-600"
                    : item.status === "Nedovoljno"
                      ? "bg-amber-100 text-amber-600"
                      : "bg-emerald-100 text-emerald-600"
                }`}
              >
                <TriangleAlert size={14} />
                {item.status}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default DashboardLowStock;
