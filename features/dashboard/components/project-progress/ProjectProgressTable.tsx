import { projects } from "../../data/dashboardMockData";
import type { ProjectPhase } from "../../data/dashboardMockTypes";
import ProjectProgressRow from "./ProjectProgressRow";

const phases: ProjectPhase[] = [
  "Projektovanje",
  "Nabavka",
  "Izrada",
  "Montaža",
  "Testiranje",
  "Isporuka",
];

function ProjectProgressTable() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1100px]">
        <div className="grid grid-cols-[260px_repeat(6,1fr)] border-b border-zinc-200 px-8 py-5">
          <div className="font-bold uppercase text-zinc-700">Projekat</div>

          {phases.map((phase) => (
            <div
              key={phase}
              className="text-center font-bold uppercase text-zinc-700"
            >
              {phase}
            </div>
          ))}
        </div>

        {projects.map((project) => (
          <ProjectProgressRow key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}

export default ProjectProgressTable;
