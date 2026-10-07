import { describe, expect, it } from "vitest";

import { assertBackendTestTargetIsNotProduction } from "./backend/env";

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
});
