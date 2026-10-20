const activityHashPrefix = "#activity-";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProjectActivityHash =
  | { kind: "none" }
  | { kind: "unrelated" }
  | { kind: "invalid" }
  | { kind: "activity"; activityId: string };

export function parseProjectActivityHash(hash: string): ProjectActivityHash {
  if (hash === "") return { kind: "none" };
  if (!hash.startsWith(activityHashPrefix)) {
    return { kind: "unrelated" };
  }

  const activityId = hash.slice(activityHashPrefix.length);
  return uuidPattern.test(activityId)
    ? { kind: "activity", activityId: activityId.toLowerCase() }
    : { kind: "invalid" };
}

export function projectActivityDomId(
  projectId: string,
  activityId: string,
): string {
  return `project-${projectId.toLowerCase()}-activity-${activityId.toLowerCase()}`;
}
