import { describe, expect, it } from "vitest";

import {
  parseProjectActivityHash,
  projectActivityDomId,
} from "./projectActivityDeepLink";

const activityId = "123e4567-e89b-42d3-a456-426614174000";

describe("parseProjectActivityHash", () => {
  it("accepts the exact lowercase Activity UUID hash", () => {
    expect(parseProjectActivityHash(`#activity-${activityId}`)).toEqual({
      kind: "activity",
      activityId,
    });
  });

  it("accepts uppercase UUID hex and normalizes it to lowercase", () => {
    expect(parseProjectActivityHash(
      "#activity-123E4567-E89B-42D3-A456-426614174000",
    )).toEqual({ kind: "activity", activityId });
  });

  it.each([
    "#activity-not-a-uuid",
    `#activity-${activityId}-trailing`,
    `#activity-${activityId}/private`,
    "#activity-",
  ])("rejects malformed Activity hash %s", (hash) => {
    expect(parseProjectActivityHash(hash)).toEqual({ kind: "invalid" });
  });

  it("distinguishes unrelated and empty hashes without treating them as errors", () => {
    expect(parseProjectActivityHash("#overview")).toEqual({ kind: "unrelated" });
    expect(parseProjectActivityHash(`#ACTIVITY-${activityId}`)).toEqual({
      kind: "unrelated",
    });
    expect(parseProjectActivityHash("")).toEqual({ kind: "none" });
    expect(parseProjectActivityHash(activityId)).toEqual({ kind: "unrelated" });
  });

  it("builds a stable Project-and-Activity-specific DOM ID", () => {
    expect(projectActivityDomId(
      "00000000-0000-4000-8000-000000000001",
      "123E4567-E89B-42D3-A456-426614174000",
    )).toBe(
      "project-00000000-0000-4000-8000-000000000001-activity-123e4567-e89b-42d3-a456-426614174000",
    );
  });
});
