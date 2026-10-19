import { createClient } from "@supabase/supabase-js";

import {
  handleProjectActivityImageAccessRequest,
  type ProjectActivityImageAccessActorClient,
  type ProjectActivityImageAccessPrivilegedClient,
  projectActivityImageAccessCorsHeaders,
} from "./handler";

interface DenoRuntime {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

const deno = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

function requiredEnvironment(name: string): string {
  const value = deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function environment value: ${name}`);
  return value;
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
} as const;

deno.serve((request) => {
  try {
    const supabaseUrl = requiredEnvironment("SUPABASE_URL");
    const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    return handleProjectActivityImageAccessRequest(request, {
      createActorClient: (accessToken) => createClient(
        supabaseUrl,
        anonKey,
        {
          ...clientOptions,
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        },
      ) as unknown as ProjectActivityImageAccessActorClient,
      createPrivilegedClient: () => createClient(
        supabaseUrl,
        serviceRoleKey,
        clientOptions,
      ) as unknown as ProjectActivityImageAccessPrivilegedClient,
    });
  } catch {
    return Response.json(
      {
        code: "configuration_error",
        message: "The Project Activity image service is unavailable.",
      },
      { status: 500, headers: projectActivityImageAccessCorsHeaders },
    );
  }
});
