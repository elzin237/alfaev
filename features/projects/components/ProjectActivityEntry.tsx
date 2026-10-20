import type { ProjectActivityItem } from "../services/projectActivityService";
import ProjectActivityImage from "./ProjectActivityImage";

const activityTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ProjectActivityEntryProps {
  projectId: string;
  item: ProjectActivityItem;
}

export function ProjectActivityEntry({
  projectId,
  item,
}: ProjectActivityEntryProps) {
  return (
    <>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-base font-bold text-zinc-900">
            {item.title}
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500">
            {item.authorFullName} ·{" "}
            <time dateTime={item.createdAt}>
              {activityTimestampFormatter.format(new Date(item.createdAt))}
            </time>
          </p>
        </div>
        {item.alertSent && (
          <span className="w-fit shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
            Alert sent
          </span>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
        {item.description}
      </p>
      {item.attachment && (
        <ProjectActivityImage
          projectId={projectId}
          activityId={item.activityId}
          title={item.title}
          altText={item.attachment.altText}
        />
      )}
    </>
  );
}
