import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { guardRollbackQueries } from "./backend/helpers/rollback-query-guard";

describe("rollback-only query facade", () => {
  it("delegates active transaction queries with their parameters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const guard = guardRollbackQueries({ query } as unknown as PoolClient);
    await guard.client.query("select $1", [1]);
    expect(query).toHaveBeenCalledWith("select $1", [1]);
  });
  it("rejects late work before it reaches the PostgreSQL client", async () => {
    const query = vi.fn();
    const guard = guardRollbackQueries({ query } as unknown as PoolClient);
    guard.close();
    await expect(guard.client.query("insert into fixture values (1)"))
      .rejects.toThrow("closed or aborted");
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects an aborted test even before cleanup begins", async () => {
    const controller = new AbortController(), query = vi.fn();
    const guard = guardRollbackQueries({ query } as unknown as PoolClient, controller.signal);
    controller.abort();
    await expect(guard.client.query("select 1")).rejects.toThrow("closed or aborted");
    expect(query).not.toHaveBeenCalled();
  });
  it("blocks a timed-out continuation after an in-flight query resolves", async () => {
    let finish!: () => void;
    const query = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const guard = guardRollbackQueries({ query } as unknown as PoolClient);
    const continuation = (async () => {
      await guard.client.query("select slow_fixture_precondition()");
      await guard.client.query("insert into fixture values (1)");
    })();
    guard.close();
    finish();
    await expect(continuation).rejects.toThrow("closed or aborted");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
