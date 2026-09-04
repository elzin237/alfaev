import { Check, Clock3 } from "lucide-react";
import type {
  PhaseStatus,
  Project,
  ProjectPhase,
} from "../../../../lib/types/domain";

const phases: ProjectPhase[] = [
  "Projektovanje",
  "Nabavka",
  "Izrada",
  "Montaža",
  "Testiranje",
  "Isporuka",
];

interface PhaseNodeProps {
  state: PhaseStatus;
}

function PhaseNode({ state }: PhaseNodeProps) {
  if (state === "completed") {
    return (
      <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#ba0000] text-white shadow-sm">
        <Check size={14} strokeWidth={3} />
      </div>
    );
  }

  if (state === "active") {
    return (
      <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-[#d70812] text-white shadow-sm">
        <Clock3 size={14} strokeWidth={2.5} />
      </div>
    );
  }

  return (
    <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-300" />
  );
}

interface ProjectProgressRowProps {
  project: Project;
}

function ProjectProgressRow({ project }: ProjectProgressRowProps) {
  return (
    <div className="grid grid-cols-[260px_repeat(6,1fr)] items-center border-b border-zinc-200 px-8 py-5 last:border-b-0">
      <div className="font-semibold text-zinc-900">{project.name}</div>

      {phases.map((_, index) => {
        const completed = index < project.step;
        const active = index === project.step;

        return (
          <div
            key={index}
            className="relative flex h-10 items-center justify-center"
          >
            {index !== phases.length - 1 && (
              <div
                className={`absolute left-1/2 top-1/2 h-px w-full -translate-y-1/2 ${
                  completed || active ? "bg-[#de0707]" : "bg-zinc-300"
                }`}
              />
            )}

            <PhaseNode
              state={completed ? "completed" : active ? "active" : "pending"}
            />
          </div>
        );
      })}
    </div>
  );
}

export default ProjectProgressRow;
