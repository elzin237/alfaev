import { useState } from "react";

import type {
  ProjectActivityItem,
  ProjectIssueResolutionInput,
  ProjectIssueResolutionResult,
} from "../services/projectActivityService";
import ProjectActivityImage from "./ProjectActivityImage";
import ProjectIssueResolutionDialog from "./ProjectIssueResolutionDialog";

const activityTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface ProjectActivityEntryProps {
  projectId: string;
  item: ProjectActivityItem;
  canResolveIssue?: boolean;
  onResolveIssue?: (
    input: ProjectIssueResolutionInput,
  ) => Promise<ProjectIssueResolutionResult>;
  onResolutionImageAttached?: (activityId: string) => Promise<unknown> | unknown;
}

export function ProjectActivityEntry({
  projectId,
  item,
  canResolveIssue = false,
  onResolveIssue,
  onResolutionImageAttached,
}: ProjectActivityEntryProps) {
  const [resolutionOpen, setResolutionOpen] = useState(false);

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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {item.activityKind === "issue" && (
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
              item.resolution
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}>
              {item.resolution ? "Resolved" : "Open"}
            </span>
          )}
          {item.alertSent && (
            <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              Alert sent
            </span>
          )}
        </div>
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
      {item.activityKind === "issue" && item.resolution && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
            Resolution
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
            {item.resolution.description}
          </p>
          <p className="mt-2 text-xs text-zinc-600">
            Resolved by <span className="font-semibold text-zinc-800">{item.resolution.resolverFullName}</span>
            {" · "}
            <time dateTime={item.resolution.resolvedAt}>
              {activityTimestampFormatter.format(new Date(item.resolution.resolvedAt))}
            </time>
          </p>
          {item.resolution.attachment && (
            <ProjectActivityImage
              projectId={projectId}
              activityId={item.activityId}
              resolutionId={item.resolution.resolutionId}
              title={`Resolution evidence for ${item.title}`}
              altText={item.resolution.attachment.altText}
            />
          )}
        </div>
      )}
      {item.activityKind === "issue" && canResolveIssue && onResolveIssue && (
        <div className={item.resolution ? "" : "mt-4"}>
          {!item.resolution && (
          <button
            type="button"
            onClick={() => setResolutionOpen(true)}
            className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            Resolve issue
          </button>
          )}
          <ProjectIssueResolutionDialog
            issue={item}
            open={resolutionOpen}
            onCancel={() => setResolutionOpen(false)}
            onResolve={onResolveIssue}
            onImageAttached={onResolutionImageAttached}
          />
        </div>
      )}
    </>
  );
}
