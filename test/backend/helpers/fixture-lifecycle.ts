import { afterAll, beforeAll, expect } from "vitest";

import { loadBackendTestEnvironment } from "../env";
import {
  createSecurityFixtureHarness,
  type SecurityFixtureHarness,
} from "../security-fixtures";

export function registerSecurityFixture(): () => SecurityFixtureHarness {
  const environment = loadBackendTestEnvironment();
  let harness: SecurityFixtureHarness | undefined;

  beforeAll(async () => {
    harness = await createSecurityFixtureHarness(environment);
  });

  afterAll(async () => {
    if (!harness) return;

    expect(await harness.cleanup()).toEqual({
      auditLogsRemaining: 0,
      authUsersRemaining: 0,
      permissionRevisionsRemaining: 0,
      profilesRemaining: 0,
      permissionsRemaining: 0,
      postgresClosed: true,
    });
  });

  return () => {
    if (!harness) {
      throw new Error("Backend security fixture harness is not initialized");
    }
    return harness;
  };
}
