import { createClient } from "@supabase/supabase-js";

interface DenoRuntime {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

interface InviteRequest {
  fullName: string;
  email: string;
  birthday: string;
  isAdmin: boolean;
}

interface FunctionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

const deno = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

function jsonResponse(
  status: number,
  code: string,
  message: string,
  data?: Record<string, string>,
): Response {
  return Response.json(
    data ? { code, message, data } : { code, message },
    {
      status,
      headers: corsHeaders,
    },
  );
}

function requireEnvironmentValue(name: string): string {
  const value = deno.env.get(name)?.trim();

  if (!value) {
    throw new Error(`Missing Edge Function environment variable: ${name}`);
  }

  return value;
}

function loadEnvironment(): FunctionEnvironment {
  return {
    supabaseUrl: requireEnvironmentValue("SUPABASE_URL"),
    supabaseAnonKey: requireEnvironmentValue("SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: requireEnvironmentValue("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function parseInviteRequest(value: unknown): InviteRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const allowedKeys = new Set(["fullName", "email", "birthday", "isAdmin"]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  const fullName =
    typeof value.fullName === "string"
      ? value.fullName.trim().replace(/\s+/g, " ")
      : "";
  const email =
    typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const birthday =
    typeof value.birthday === "string" ? value.birthday.trim() : "";

  if (
    fullName.length === 0 ||
    fullName.length > 200 ||
    email.length === 0 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !isValidCalendarDate(birthday) ||
    typeof value.isAdmin !== "boolean"
  ) {
    return null;
  }

  return {
    fullName,
    email,
    birthday,
    isAdmin: value.isAdmin,
  };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");

  return match?.[1] ?? null;
}

function isDuplicateUserError(code: string | undefined): boolean {
  return code === "email_exists" || code === "user_already_exists";
}

deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, "method_not_allowed", "Only POST is supported.");
  }

  const accessToken = readBearerToken(request);

  if (!accessToken) {
    return jsonResponse(401, "unauthenticated", "Authentication is required.");
  }

  let environment: FunctionEnvironment;

  try {
    environment = loadEnvironment();
  } catch {
    return jsonResponse(
      500,
      "configuration_error",
      "The user invitation service is unavailable.",
    );
  }

  const actorClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );
  const { data: actorData, error: actorError } =
    await actorClient.auth.getUser(accessToken);

  if (actorError || !actorData.user) {
    return jsonResponse(401, "unauthenticated", "Authentication is required.");
  }

  const { data: isAdmin, error: adminError } = await actorClient.rpc(
    "current_user_is_admin",
  );

  if (adminError || isAdmin !== true) {
    return jsonResponse(
      403,
      "access_denied",
      "Only an active AlfaEV administrator may invite users.",
    );
  }

  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse(400, "invalid_request", "Valid user details are required.");
  }

  const inviteRequest = parseInviteRequest(requestBody);

  if (!inviteRequest) {
    return jsonResponse(400, "invalid_request", "Valid user details are required.");
  }

  const serviceClient = createClient(
    environment.supabaseUrl,
    environment.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const { data: inviteData, error: inviteError } =
    await serviceClient.auth.admin.inviteUserByEmail(inviteRequest.email);

  if (inviteError || !inviteData.user) {
    if (isDuplicateUserError(inviteError?.code)) {
      return jsonResponse(
        409,
        "user_exists",
        "An AlfaEV user with this email already exists.",
      );
    }

    return jsonResponse(
      502,
      "invite_failed",
      "The user invitation could not be sent.",
    );
  }

  const invitedAuthUserId = inviteData.user.id;
  const { data: profileId, error: profileError } = await actorClient.rpc(
    "create_user_profile_admin",
    {
      p_auth_user_id: invitedAuthUserId,
      p_full_name: inviteRequest.fullName,
      p_email: inviteRequest.email,
      p_birthday: inviteRequest.birthday,
      p_is_admin: inviteRequest.isAdmin,
    },
  );

  if (profileError || typeof profileId !== "string") {
    const { error: rollbackError } =
      await serviceClient.auth.admin.deleteUser(invitedAuthUserId);

    if (rollbackError) {
      return jsonResponse(
        500,
        "invite_rollback_failed",
        "The invitation could not be completed. Contact an administrator.",
      );
    }

    if (profileError?.code === "23505") {
      return jsonResponse(
        409,
        "user_exists",
        "An AlfaEV user with this email already exists.",
      );
    }

    return jsonResponse(
      500,
      "profile_creation_failed",
      "The AlfaEV user profile could not be created.",
    );
  }

  return jsonResponse(
    201,
    "user_invited",
    "The AlfaEV user invitation was created.",
    { profileId },
  );
});
