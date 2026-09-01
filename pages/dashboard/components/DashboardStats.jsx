import { stats } from "../data/dashboardMockData";

function DashboardStats() {
  return (
    <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-5">
      {stats.map((item) => {
        const Icon = item.icon;

        return (
          <article
            key={item.id}
            className={
              item.variant === "dark"
                ? "rounded-2xl bg-linear-to-br from-zinc-900 via-slate-900 to-slate-800 p-6 text-white shadow-sm"
                : "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            }
          >
            <div className="mb-6 flex items-start justify-between">
              <Icon
                size={44}
                className={
                  item.variant === "dark" ? "text-white" : "text-red-600"
                }
              />

              <h3
                className={
                  item.variant === "dark"
                    ? "text-5xl font-bold text-white"
                    : "text-5xl font-bold text-red-600"
                }
              >
                {item.value}
              </h3>
            </div>

            <p
              className={`mb-8 text-lg font-medium ${
                item.variant === "dark" ? "text-white" : "text-zinc-900"
              }`}
            >
              {item.title}
            </p>

            <button
              className={`text-sm font-medium ${
                item.variant === "dark" ? "text-white" : "text-red-600"
              }`}
            >
              Pogledaj sve →
            </button>
          </article>
        );
      })}
    </section>
  );
}

export default DashboardStats;
