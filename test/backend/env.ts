import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnv } from "vite";

export interface BackendTestEnvironment {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  supabaseTestDatabaseUrl: string;
  projectRef: string;
}

interface DatabaseTarget {
  connectionType: "direct" | "pooler";
  url: URL;
}

const PRODUCTION_PROJECT_REFS = new Set([
  "nhajjfhvlxeiwryfhofa",
]);

export function assertBackendTestTargetIsNotProduction(projectRef: string): void {
  if (PRODUCTION_PROJECT_REFS.has(projectRef)) {
    throw new Error("Backend tests must never target the production project");
  }
}

function requireValue(name: string, value: string | undefined): string {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    throw new Error(`Missing required backend test environment variable: ${name}`);
  }

  return normalizedValue;
}

function deriveProjectRef(supabaseUrl: string): string {
  const parsedUrl = new URL(supabaseUrl);
  const hostnameSuffix = ".supabase.co";

  if (
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname.endsWith(hostnameSuffix)
  ) {
    throw new Error("Backend tests require a standard HTTPS Supabase project URL");
  }

  const projectRef = parsedUrl.hostname.slice(0, -hostnameSuffix.length);

  if (!/^[a-z0-9]{20}$/.test(projectRef)) {
    throw new Error("Could not derive a valid Supabase project ref from the test URL");
  }

  return projectRef;
}

function parseDatabaseTarget(
  databaseUrl: string,
  projectRef: string,
  requirePassword: boolean,
  allowTemporaryLoginRole = false,
): DatabaseTarget {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("SUPABASE_TEST_DATABASE_URL is not a valid URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("Backend tests require a PostgreSQL connection URL");
  }

  if (requirePassword && !parsedUrl.password) {
    throw new Error("The backend test database URL must include a password");
  }

  const directTarget =
    parsedUrl.hostname === `db.${projectRef}.supabase.co` &&
    parsedUrl.username === "postgres" &&
    ["", "5432"].includes(parsedUrl.port);
  const poolerTarget =
    parsedUrl.hostname.endsWith(".pooler.supabase.com") &&
    (
      parsedUrl.username === `postgres.${projectRef}` ||
      (
        allowTemporaryLoginRole &&
        parsedUrl.username.endsWith(`.${projectRef}`) &&
        parsedUrl.username.startsWith("cli_login_")
      )
    ) &&
    ["5432", "6543"].includes(parsedUrl.port);

  if (
    (!directTarget && !poolerTarget) ||
    parsedUrl.pathname !== "/postgres"
  ) {
    throw new Error(
      "Backend test database URL does not identify the linked development project",
    );
  }

  return {
    connectionType: directTarget ? "direct" : "pooler",
    url: parsedUrl,
  };
}

function resolveDatabaseConnectionUrl(
  databaseUrl: string,
  projectRef: string,
  rootDirectory: string,
  allowTemporaryLoginRole = false,
): string {
  const configuredTarget = parseDatabaseTarget(
    databaseUrl,
    projectRef,
    true,
    allowTemporaryLoginRole,
  );

  if (configuredTarget.connectionType === "pooler") {
    return configuredTarget.url.toString();
  }

  const linkedPoolerUrl = requireValue(
    "linked Supabase development pooler URL",
    readFileSync(resolve(rootDirectory, "supabase/.temp/pooler-url"), "utf8"),
  );
  const linkedPoolerTarget = parseDatabaseTarget(
    linkedPoolerUrl,
    projectRef,
    false,
  );

  if (linkedPoolerTarget.connectionType !== "pooler") {
    throw new Error("Linked development database metadata has no pooler target");
  }

  linkedPoolerTarget.url.password = configuredTarget.url.password;
  return linkedPoolerTarget.url.toString();
}

export function loadBackendTestEnvironment(
  rootDirectory = process.cwd(),
): BackendTestEnvironment {
  const loadedEnvironment = loadEnv("test", rootDirectory, "");
  const environmentValue = (name: string): string | undefined =>
    process.env[name] ?? loadedEnvironment[name];

  const supabaseUrl = requireValue(
    "VITE_SUPABASE_URL",
    environmentValue("VITE_SUPABASE_URL"),
  );
  const supabasePublishableKey = requireValue(
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    environmentValue("VITE_SUPABASE_PUBLISHABLE_KEY"),
  );
  const supabaseSecretKey = requireValue(
    "SUPABASE_SECRET_KEY",
    environmentValue("SUPABASE_SECRET_KEY"),
  );
  const supabaseTestDatabaseUrl = requireValue(
    "SUPABASE_TEST_DATABASE_URL",
    environmentValue("SUPABASE_TEST_DATABASE_URL"),
  );

  if (!supabasePublishableKey.startsWith("sb_publishable_")) {
    throw new Error("Backend tests require a Supabase publishable key");
  }

  if (!supabaseSecretKey.startsWith("sb_secret_")) {
    throw new Error("Backend tests require a Supabase secret key");
  }

  const projectRef = deriveProjectRef(supabaseUrl);
  assertBackendTestTargetIsNotProduction(projectRef);
  const linkedProjectRef = requireValue(
    "linked Supabase development project ref",
    readFileSync(
      resolve(rootDirectory, "supabase/.temp/project-ref"),
      "utf8",
    ),
  );
  const task147DisposableTarget =
    process.env.TASK147_COMMITTED_CONCURRENCY === "1";
  const task148DisposableTarget =
    process.env.TASK148_COMMITTED_CONCURRENCY === "1";
  if (task147DisposableTarget && task148DisposableTarget) {
    throw new Error("Only one disposable concurrency target may be enabled");
  }
  const expectedProjectRef = task147DisposableTarget
    ? "hipkoxienlffgyofcbzq"
    : task148DisposableTarget
      ? "tkzlbxyjbnntrgohpedd"
      : linkedProjectRef;

  if (projectRef !== expectedProjectRef) {
    throw new Error(
      task147DisposableTarget
        ? "Task 147 backend test URL does not match the approved disposable project"
        : task148DisposableTarget
          ? "Task 148 backend test URL does not match the approved disposable project"
          : "Backend test URL does not match the repository's linked development project",
    );
  }

  const resolvedDatabaseUrl = resolveDatabaseConnectionUrl(
    supabaseTestDatabaseUrl,
    projectRef,
    rootDirectory,
    task148DisposableTarget,
  );

  return {
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    supabaseTestDatabaseUrl: resolvedDatabaseUrl,
    projectRef,
  };
}
