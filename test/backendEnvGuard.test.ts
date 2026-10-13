import { describe, expect, it } from "vitest";

import {
  assertBackendTestTargetIsNotProduction,
  assertCommittedConcurrencyTarget,
  isDisposableOrLocalBackendTarget,
  SHARED_DEVELOPMENT_PROJECT_REF,
  TASK148_DISPOSABLE_PROJECT_REF,
} from "./backend/env";

describe("backend test target guard", () => {
  it("rejects the AlfaEV production project explicitly", () => {
    expect(() =>
      assertBackendTestTargetIsNotProduction("nhajjfhvlxeiwryfhofa")
    ).toThrow("Backend tests must never target the production project");
  });

  it("does not replace the existing development and disposable target checks", () => {
    expect(() =>
      assertBackendTestTargetIsNotProduction("yzysgbrpbhiapalgetau")
    ).not.toThrow();
    expect(() =>
      assertBackendTestTargetIsNotProduction("hipkoxienlffgyofcbzq")
    ).not.toThrow();
    expect(() =>
      assertBackendTestTargetIsNotProduction("tkzlbxyjbnntrgohpedd")
    ).not.toThrow();
  });

  it("rejects production and shared development for committed concurrency", () => {
    expect(() =>
      assertCommittedConcurrencyTarget("nhajjfhvlxeiwryfhofa", [
        TASK148_DISPOSABLE_PROJECT_REF,
      ])
    ).toThrow("Backend tests must never target the production project");
    expect(() =>
      assertCommittedConcurrencyTarget(SHARED_DEVELOPMENT_PROJECT_REF, [
        TASK148_DISPOSABLE_PROJECT_REF,
      ])
    ).toThrow(
      "Committed concurrency tests must never target the shared development project",
    );
  });

  it("accepts only local or an explicitly approved disposable committed target", () => {
    expect(() =>
      assertCommittedConcurrencyTarget("local", [TASK148_DISPOSABLE_PROJECT_REF])
    ).not.toThrow();
    expect(() =>
      assertCommittedConcurrencyTarget(TASK148_DISPOSABLE_PROJECT_REF, [
        TASK148_DISPOSABLE_PROJECT_REF,
      ])
    ).not.toThrow();
    expect(() =>
      assertCommittedConcurrencyTarget("aaaaaaaaaaaaaaaaaaaa", [
        TASK148_DISPOSABLE_PROJECT_REF,
      ])
    ).toThrow(
      "Committed concurrency tests require local Supabase or an explicitly approved disposable project",
    );
    expect(isDisposableOrLocalBackendTarget("local")).toBe(true);
    expect(isDisposableOrLocalBackendTarget(TASK148_DISPOSABLE_PROJECT_REF)).toBe(true);
    expect(isDisposableOrLocalBackendTarget(SHARED_DEVELOPMENT_PROJECT_REF)).toBe(false);
  });
});
