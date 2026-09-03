import { projects } from "../data/dashboardMockData";

function DashboardProjects() {
  return (
    <section className="rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-5">
        <h2 className="text-lg font-bold text-zinc-900">AKTIVNI PROJEKTI</h2>

        <button className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white">
          Novi projekat
        </button>
      </div>

      <div className="hidden grid-cols-[2.5fr_1.3fr_1.3fr_1.3fr_1.5fr] border-b border-zinc-200 px-6 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500 lg:grid">
        <span>Projekat</span>
        <span>Klijent</span>
        <span>Rok isporuke</span>
        <span>Status</span>
        <span>Napredak</span>
      </div>

      <div>
        {projects.map((project) => (
          <article
            key={project.id}
            className="border-b border-zinc-200 last:border-b-0"
          >
            <div className="hidden grid-cols-[2.5fr_1.3fr_1.3fr_1.3fr_1.5fr] items-center px-6 py-5 lg:grid">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-lg bg-zinc-200" />

                <div>
                  <h3 className="font-semibold text-zinc-900">
                    {project.name}
                  </h3>

                  <p className="mt-1 text-sm text-zinc-500">{project.id}</p>
                </div>
              </div>

              <p className="text-zinc-700">{project.client}</p>

              <p className="text-zinc-700">20.06.2026.</p>

              <span className="w-fit rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-sm text-red-600">
                {project.status}
              </span>

              <div className="flex items-center gap-3">
                <span className="w-10 text-sm font-medium">
                  {project.progress}%
                </span>

                <div className="h-2 flex-1 rounded-full bg-zinc-200">
                  <div
                    className="h-2 rounded-full bg-red-600"
                    style={{
                      width: `${project.progress}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 p-5 lg:hidden">
              <h3 className="font-semibold text-zinc-900">{project.name}</h3>

              <p className="text-sm text-zinc-500">{project.id}</p>

              <p className="text-sm">{project.client}</p>

              <div className="flex items-center justify-between">
                <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-1 text-xs text-red-600">
                  {project.status}
                </span>

                <span className="text-sm font-medium">{project.progress}%</span>
              </div>

              <div className="h-2 rounded-full bg-zinc-200">
                <div
                  className="h-2 rounded-full bg-red-600"
                  style={{
                    width: `${project.progress}%`,
                  }}
                />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default DashboardProjects;
