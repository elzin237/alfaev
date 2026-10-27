import type { PoolClient } from "pg";

// A test timeout does not stop its async JavaScript. Invalidate the facade BEFORE
// ROLLBACK so late continuations cannot enqueue writes after transaction cleanup.
export function guardRollbackQueries(raw: PoolClient, signal?: AbortSignal) {
  let active = true;
  const client = new Proxy(raw, {
    get(target, property) {
      if (property === "query") return (...args: unknown[]) => {
        if (!active || signal?.aborted) {
          return Promise.reject(new Error("Rollback-only test transaction is closed or aborted"));
        }
        return Reflect.apply(target.query, target, args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { raw, client, close: () => { active = false; } };
}
