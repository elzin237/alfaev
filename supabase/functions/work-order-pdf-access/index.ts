import { createClient } from "@supabase/supabase-js";

import {
  handleWorkOrderPdfAccessRequest,
  type WorkOrderPdfAccessActorClient,
  workOrderPdfAccessCorsHeaders,
  type WorkOrderPdfAccessStorageClient,
} from "./handler";

interface DenoRuntime {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

interface FunctionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

const deno = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

function requireEnvironmentValue(name: string): string {
  const value = deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing Edge Function environment value: ${name}`);
  return value;
}

function loadEnvironment(): FunctionEnvironment {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL"),
    supabaseAnonKey: requireEnvironmentValue("SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY"),
  };
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
    const environment = loadEnvironment();
    return handleWorkOrderPdfAccessRequest(request, {
      createActorClient: (accessToken) => createClient(
        environment.supabaseUrl,
        environment.supabaseAnonKey,
        {
          ...clientOptions,
          global: { headers: { Authorization: `Bearer ${accessToken}` } },
        },
      ) as unknown as WorkOrderPdfAccessActorClient,
      createStorageClient: () => createClient(
        environment.supabaseUrl,
        environment.supabaseServiceRoleKey,
        clientOptions,
      ) as unknown as WorkOrderPdfAccessStorageClient,
    });
  } catch {
    return Response.json(
      {
        code: "configuration_error",
        message: "The Work Order PDF service is unavailable.",
      },
      { status: 500, headers: workOrderPdfAccessCorsHeaders },
    );
  }
});
