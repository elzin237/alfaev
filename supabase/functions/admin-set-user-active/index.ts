import { createClient, type User } from "@supabase/supabase-js";

interface DenoRuntime {
  env: {
    get: (name: string) => string | undefined;
  };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

interface ActiveStateRequest {
  userId: string;
  isActive: boolean;
}

interface FunctionEnvironment {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

interface ActiveStatePreflight {
  target_auth_user_id: string;
  current_is_active: boolean;
  current_is_admin: boolean;
}

const deno = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;
const deactivationBanDuration = "876000h";
const reactivationBanDuration = "none";

function jsonResponse(
  status: number,
  code: string,
  message: string,
  data?: Record<string, string | boolean>,
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

function parseRequest(value: unknown): ActiveStateRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const allowedKeys = new Set(["userId", "isActive"]);

  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  const userId = typeof value.userId === "string" ? value.userId.trim() : "";

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    ) ||
    typeof value.isActive !== "boolean"
  ) {
    return null;
  }

  return { userId, isActive: value.isActive };
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");

  return match?.[1] ?? null;
}

function isPreflight(value: unknown): value is ActiveStatePreflight {
  return (
    isRecord(value) &&
    typeof value.target_auth_user_id === "string" &&
    typeof value.current_is_active === "boolean" &&
    typeof value.current_is_admin === "boolean"
  );
}

function isUserBanned(user: User | null): boolean | null {
  if (!user) {
    return null;
  }

  if (!user.banned_until) {
    return false;
  }

  const bannedUntil = Date.parse(user.banned_until);

  return Number.isFinite(bannedUntil) ? bannedUntil > Date.now() : null;
}

function domainErrorResponse(code: string | undefined): Response | null {
  switch (code) {
    case "AUE01":
      return jsonResponse(
        409,
        "self_deactivation",
        "Administrators cannot deactivate their own account.",
      );
    case "AUE02":
      return jsonResponse(
        409,
        "last_active_admin",
        "The last active administrator cannot be deactivated.",
      );
    case "P0002":
      return jsonResponse(404, "user_not_found", "The AlfaEV user could not be found.");
    case "42501":
      return jsonResponse(
        403,
        "access_denied",
        "Only an active AlfaEV administrator may change account state.",
      );
    default:
      return null;
  }
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
      "The account-state service is unavailable.",
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
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
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
      "Only an active AlfaEV administrator may change account state.",
    );
  }

  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse(400, "invalid_request", "A valid account-state request is required.");
  }

  const activeStateRequest = parseRequest(requestBody);

  if (!activeStateRequest) {
    return jsonResponse(400, "invalid_request", "A valid account-state request is required.");
  }

  const { data: preflightData, error: preflightError } = await actorClient.rpc(
    "preflight_user_active_state_admin",
    {
      p_user_id: activeStateRequest.userId,
      p_is_active: activeStateRequest.isActive,
    },
  );
  const preflight = Array.isArray(preflightData) ? preflightData[0] : null;

  if (preflightError || !isPreflight(preflight)) {
    const domainResponse = domainErrorResponse(preflightError?.code);

    return domainResponse ?? jsonResponse(
      500,
      "state_preflight_failed",
      "The account state could not be verified.",
    );
  }

  if (
    !activeStateRequest.isActive &&
    preflight.target_auth_user_id === actorData.user.id
  ) {
    return jsonResponse(
      409,
      "self_deactivation",
      "Administrators cannot deactivate their own account.",
    );
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
  const { data: authData, error: authLookupError } =
    await serviceClient.auth.admin.getUserById(preflight.target_auth_user_id);
  const previousAuthBanned = isUserBanned(authData.user);

  if (
    authLookupError ||
    previousAuthBanned === null ||
    previousAuthBanned !== !preflight.current_is_active
  ) {
    return jsonResponse(
      409,
      "state_mismatch",
      "The account state could not be safely changed. Contact an administrator.",
    );
  }

  if (preflight.current_is_active === activeStateRequest.isActive) {
    return jsonResponse(
      200,
      "user_active_state_unchanged",
      "The AlfaEV user already has the requested account state.",
      {
        profileId: activeStateRequest.userId,
        isActive: activeStateRequest.isActive,
        changed: false,
      },
    );
  }

  const requestedBanDuration = activeStateRequest.isActive
    ? reactivationBanDuration
    : deactivationBanDuration;
  const requestedAuthBanned = !activeStateRequest.isActive;
  const restorePreviousAuthState = async (): Promise<boolean> => {
    const rollbackBanDuration = previousAuthBanned
      ? deactivationBanDuration
      : reactivationBanDuration;
    const { error: rollbackError } =
      await serviceClient.auth.admin.updateUserById(
        preflight.target_auth_user_id,
        { ban_duration: rollbackBanDuration },
      );

    if (rollbackError) {
      return false;
    }

    const { data: rollbackData, error: rollbackLookupError } =
      await serviceClient.auth.admin.getUserById(
        preflight.target_auth_user_id,
      );

    return (
      !rollbackLookupError &&
      isUserBanned(rollbackData.user) === previousAuthBanned
    );
  };
  const { error: authUpdateError } =
    await serviceClient.auth.admin.updateUserById(
      preflight.target_auth_user_id,
      { ban_duration: requestedBanDuration },
    );
  const { data: changedAuthData, error: authVerificationError } =
    await serviceClient.auth.admin.getUserById(preflight.target_auth_user_id);
  const changedAuthBanned = isUserBanned(changedAuthData.user);

  if (
    authUpdateError ||
    authVerificationError ||
    changedAuthBanned === null ||
    changedAuthBanned !== requestedAuthBanned
  ) {
    if (changedAuthBanned !== previousAuthBanned) {
      const rollbackSucceeded = await restorePreviousAuthState();

      if (!rollbackSucceeded) {
        return jsonResponse(
          500,
          "state_rollback_failed",
          "The account state could not be restored. Contact an administrator.",
        );
      }
    }

    return jsonResponse(
      502,
      "auth_state_update_failed",
      "The account sign-in state could not be changed.",
    );
  }

  const { data: profileId, error: stateError } = await actorClient.rpc(
    "set_user_active_state_admin",
    {
      p_user_id: activeStateRequest.userId,
      p_is_active: activeStateRequest.isActive,
    },
  );

  if (stateError || profileId !== activeStateRequest.userId) {
    const rollbackSucceeded = await restorePreviousAuthState();

    if (!rollbackSucceeded) {
      return jsonResponse(
        500,
        "state_rollback_failed",
        "The account state could not be restored. Contact an administrator.",
      );
    }

    const domainResponse = domainErrorResponse(stateError?.code);

    return domainResponse ?? jsonResponse(
      500,
      "state_update_failed",
      "The AlfaEV account state could not be changed.",
    );
  }

  return jsonResponse(
    200,
    activeStateRequest.isActive ? "user_reactivated" : "user_deactivated",
    activeStateRequest.isActive
      ? "The AlfaEV user was reactivated."
      : "The AlfaEV user was deactivated.",
    {
      profileId,
      isActive: activeStateRequest.isActive,
      changed: true,
    },
  );
});
