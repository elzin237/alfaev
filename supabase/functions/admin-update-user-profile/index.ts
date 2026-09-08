import { createClient } from "@supabase/supabase-js";

interface DenoRuntime {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

interface UpdateUserProfileRequest {
  userId: string;
  fullName: string;
  email: string;
  birthday: string;
}

interface FunctionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

interface ResolvedUserIdentity {
  auth_user_id: string;
  email: string;
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
    { status, headers: corsHeaders },
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

function parseUpdateRequest(value: unknown): UpdateUserProfileRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const allowedKeys = new Set(["userId", "fullName", "email", "birthday"]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  const userId = typeof value.userId === "string" ? value.userId.trim() : "";
  const fullName =
    typeof value.fullName === "string"
      ? value.fullName.trim().replace(/\s+/g, " ")
      : "";
  const email =
    typeof value.email === "string" ? value.email.trim().toLowerCase() : "";
  const birthday =
    typeof value.birthday === "string" ? value.birthday.trim() : "";

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    ) ||
    fullName.length === 0 ||
    fullName.length > 200 ||
    email.length === 0 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !isValidCalendarDate(birthday)
  ) {
    return null;
  }

  return { userId, fullName, email, birthday };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");

  return match?.[1] ?? null;
}

function isResolvedIdentity(value: unknown): value is ResolvedUserIdentity {
  return (
    isRecord(value) &&
    typeof value.auth_user_id === "string" &&
    typeof value.email === "string"
  );
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
      "The user profile service is unavailable.",
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
        headers: { Authorization: `Bearer ${accessToken}` },
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
      "Only an active AlfaEV administrator may update users.",
    );
  }

  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse(400, "invalid_request", "Valid user details are required.");
  }

  const updateRequest = parseUpdateRequest(requestBody);

  if (!updateRequest) {
    return jsonResponse(400, "invalid_request", "Valid user details are required.");
  }

  const { data: identityData, error: identityError } = await actorClient.rpc(
    "resolve_user_auth_identity_admin",
    { p_user_id: updateRequest.userId },
  );
  const resolvedIdentity = Array.isArray(identityData) ? identityData[0] : null;

  if (identityError || !isResolvedIdentity(resolvedIdentity)) {
    return jsonResponse(
      identityError?.code === "P0002" ? 404 : 500,
      identityError?.code === "P0002" ? "user_not_found" : "identity_lookup_failed",
      identityError?.code === "P0002"
        ? "The AlfaEV user could not be found."
        : "The user identity could not be verified.",
    );
  }

  const previousProfileEmail = resolvedIdentity.email.trim().toLowerCase();
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
  const { data: authData, error: authLookupError } =
    await serviceClient.auth.admin.getUserById(resolvedIdentity.auth_user_id);
  const previousAuthEmail = authData.user?.email?.trim().toLowerCase();

  if (
    authLookupError ||
    !previousAuthEmail ||
    previousAuthEmail !== previousProfileEmail
  ) {
    return jsonResponse(
      409,
      "identity_mismatch",
      "The user identity could not be safely updated. Contact an administrator.",
    );
  }

  const emailChanged = updateRequest.email !== previousProfileEmail;

  if (emailChanged) {
    const { data: updatedAuthData, error: authUpdateError } =
      await serviceClient.auth.admin.updateUserById(
        resolvedIdentity.auth_user_id,
        { email: updateRequest.email },
      );
    const updatedAuthEmail = updatedAuthData.user?.email?.trim().toLowerCase();

    if (authUpdateError || updatedAuthEmail !== updateRequest.email) {
      if (isDuplicateUserError(authUpdateError?.code)) {
        return jsonResponse(
          409,
          "user_exists",
          "An AlfaEV user with this email already exists.",
        );
      }

      const { data: rollbackData, error: rollbackError } =
        await serviceClient.auth.admin.updateUserById(
          resolvedIdentity.auth_user_id,
          { email: previousAuthEmail },
        );
      const rollbackEmail = rollbackData.user?.email?.trim().toLowerCase();

      if (rollbackError || rollbackEmail !== previousAuthEmail) {
        return jsonResponse(
          500,
          "update_rollback_failed",
          "The user profile could not be updated safely. Contact an administrator.",
        );
      }

      return jsonResponse(
        502,
        "auth_update_failed",
        "The user email could not be updated.",
      );
    }
  }

  const { data: profileId, error: profileError } = await actorClient.rpc(
    "update_user_profile_admin",
    {
      p_user_id: updateRequest.userId,
      p_full_name: updateRequest.fullName,
      p_email: updateRequest.email,
      p_birthday: updateRequest.birthday,
    },
  );

  if (profileError || profileId !== updateRequest.userId) {
    if (emailChanged) {
      const { data: rollbackData, error: rollbackError } =
        await serviceClient.auth.admin.updateUserById(
          resolvedIdentity.auth_user_id,
          { email: previousAuthEmail },
        );
      const rollbackEmail = rollbackData.user?.email?.trim().toLowerCase();

      if (rollbackError || rollbackEmail !== previousAuthEmail) {
        return jsonResponse(
          500,
          "update_rollback_failed",
          "The user profile could not be updated safely. Contact an administrator.",
        );
      }
    }

    if (profileError?.code === "23505") {
      return jsonResponse(
        409,
        "user_exists",
        "An AlfaEV user with this email already exists.",
      );
    }

    if (profileError?.code === "P0002") {
      return jsonResponse(404, "user_not_found", "The AlfaEV user could not be found.");
    }

    return jsonResponse(
      500,
      "profile_update_failed",
      "The AlfaEV user profile could not be updated.",
    );
  }

  return jsonResponse(
    200,
    "user_updated",
    "The AlfaEV user profile was updated.",
    { profileId },
  );
});
