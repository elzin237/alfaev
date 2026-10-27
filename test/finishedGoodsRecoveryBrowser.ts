// Connection-free Web Locks simulation. Each test starts with isolated browser
// storage; restart tests deliberately retain storage while replacing app clients.
export function installRecoveryBrowser(clearStorage = true) {
  if (clearStorage) localStorage.clear();
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    async request(name: string, _options: unknown, callback: (lock: { name: string; mode: string } | null) => unknown) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name, mode: "exclusive" }); }
      finally { held.delete(name); }
    },
  } });
}
