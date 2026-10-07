import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface VercelConfig {
  framework?: unknown;
  buildCommand?: unknown;
  outputDirectory?: unknown;
  rewrites?: unknown;
}

const forbiddenBrowserEnvironmentNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "JWT_SECRET",
  "SMTP_PASSWORD",
] as const;

describe("production frontend deployment configuration", () => {
  it("builds the Vite SPA into dist and routes direct URLs through index.html", () => {
    const config = JSON.parse(
      readFileSync("vercel.json", "utf8"),
    ) as VercelConfig;

    expect(config).toMatchObject({
      framework: "vite",
      buildCommand: "npm run build",
      outputDirectory: "dist",
      rewrites: [{ source: "/(.*)", destination: "/index.html" }],
    });
  });

  it("keeps the browser environment contract narrow and public-only", () => {
    const environmentSource = readFileSync(
      "lib/config/env.ts",
      "utf8",
    );

    expect(environmentSource).toContain('"VITE_SUPABASE_URL"');
    expect(environmentSource).toContain('"VITE_SUPABASE_PUBLISHABLE_KEY"');

    for (const forbiddenName of forbiddenBrowserEnvironmentNames) {
      expect(environmentSource).not.toContain(forbiddenName);
    }
  });
});
