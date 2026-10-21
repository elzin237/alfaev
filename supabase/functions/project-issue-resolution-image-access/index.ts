import { createClient } from "@supabase/supabase-js";

import {
  handleResolutionImageAccessRequest,
  type ResolutionImageAccessActorClient,
  type ResolutionImageAccessPrivilegedClient,
  resolutionImageAccessCorsHeaders,
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
const clientOptions = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } } as const;

deno.serve((request) => {
  try {
    const url = requiredEnvironment("SUPABASE_URL");
    const anon = requiredEnvironment("SUPABASE_ANON_KEY");
    const service = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
    return handleResolutionImageAccessRequest(request, {
      createActorClient: (token) => createClient(url, anon, {
        ...clientOptions,
        global: { headers: { Authorization: `Bearer ${token}` } },
      }) as unknown as ResolutionImageAccessActorClient,
      createPrivilegedClient: () => createClient(url, service, clientOptions) as unknown as ResolutionImageAccessPrivilegedClient,
    });
  } catch {
    return Response.json(
      { code: "configuration_error", message: "The resolution image service is unavailable." },
      { status: 500, headers: resolutionImageAccessCorsHeaders },
    );
  }
});
