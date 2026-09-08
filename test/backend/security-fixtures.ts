import { randomUUID } from "node:crypto";

import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  Pool,
  type PoolClient,
} from "pg";

import type { BackendTestEnvironment } from "./env";

export interface SecurityActor {
  authUserId: string;
  profileId: string;
  client: SupabaseClient;
}

export interface CleanupVerification {
  auditLogsRemaining: number;
  authUsersRemaining: number;
  profilesRemaining: number;
  permissionsRemaining: number;
  postgresClosed: boolean;
}

export interface TemporaryAuthUser {
  authUserId: string;
  email: string;
}

export interface TemporaryProfileFixture extends TemporaryAuthUser {
  profileId: string;
  profileEmail: string;
}

export interface SecurityFixtureHarness {
  anonymousClient: SupabaseClient;
  actors: {
    admin: SecurityActor;
    permitted: SecurityActor;
    unpermitted: SecurityActor;
    inactive: SecurityActor;
  };
  permissionDefinitionIds: {
    granted: string;
    ungranted: string;
  };
  countAuthUsersByEmail: (email: string) => Promise<number>;
  createTemporaryAuthUser: (label: string) => Promise<TemporaryAuthUser>;
  createTemporaryProfile: (
    label: string,
    profileEmail: string | undefined,
    createdByUserId: string,
  ) => Promise<TemporaryProfileFixture>;
  getAuthUserEmail: (authUserId: string) => Promise<string>;
  updateAuthUserEmail: (authUserId: string, email: string) => Promise<void>;
  withRollbackDatabaseTransaction: <Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ) => Promise<Result>;
  cleanup: () => Promise<CleanupVerification>;
}

interface ActorOptions {
  label: string;
  isAdmin: boolean;
  isActive: boolean;
  createdByUserId: string | null;
}

interface FixtureState {
  authUserIds: string[];
  profileIds: string[];
  actorClients: SupabaseClient[];
}

interface ErrorWithMessage {
  message: string;
}

interface IdRow {
  id: string;
}

interface PermissionDefinitionRow extends IdRow {
  key: string;
}

interface CountRow {
  count: string;
}

function throwIfError(
  operation: string,
  error: ErrorWithMessage | null,
): void {
  if (error) {
    throw new Error(`${operation} failed: ${error.message}`);
  }
}

function createClientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  } as const;
}

function parseCount(row: CountRow | undefined): number {
  const count = Number(row?.count);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Fixture cleanup verification returned an invalid count");
  }

  return count;
}

export async function createSecurityFixtureHarness(
  environment: BackendTestEnvironment,
): Promise<SecurityFixtureHarness> {
  const authAdminClient = createClient(
    environment.supabaseUrl,
    environment.supabaseSecretKey,
    createClientOptions(),
  );
  const anonymousClient = createClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
    createClientOptions(),
  );
  const database = new Pool({
    connectionString: environment.supabaseTestDatabaseUrl,
    max: 1,
    ssl: {
      rejectUnauthorized: false,
    },
  });
  const state: FixtureState = {
    authUserIds: [],
    profileIds: [],
    actorClients: [],
  };
  const runId = randomUUID();
  const fixtureIdentityPrefix = "alfaev.security.";
  const fixtureEmailPrefix = `${fixtureIdentityPrefix}${runId}.`;
  let cleanupPromise: Promise<CleanupVerification> | undefined;

  const listTemporaryAuthUsers = async () => {
    const pageSize = 1_000;
    let page = 1;
    const users: User[] = [];

    for (;;) {
      const { data, error } = await authAdminClient.auth.admin.listUsers({
        page,
        perPage: pageSize,
      });

      throwIfError("Auth fixture lookup", error);
      users.push(...data.users);

      if (data.users.length < pageSize) {
        return users;
      }

      page += 1;
    }
  };

  const countTemporaryAuthUsers = async (): Promise<number> => {
    const users = await listTemporaryAuthUsers();

    return users.filter((user) =>
      user.email?.startsWith(fixtureIdentityPrefix),
    ).length;
  };

  const countAuthUsersByEmail = async (email: string): Promise<number> => {
    const users = await listTemporaryAuthUsers();

    return users.filter((user) => user.email === email).length;
  };

  const createTemporaryAuthUser = async (
    label: string,
  ): Promise<TemporaryAuthUser> => {
    const email = `${fixtureEmailPrefix}${label}.${randomUUID()}@example.com`;
    const password = `AlfaEV-${randomUUID()}-Aa1!`;
    const { data, error } = await authAdminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    throwIfError("Temporary Auth user creation", error);

    if (!data.user) {
      throw new Error("Temporary Auth user creation returned no user");
    }

    state.authUserIds.push(data.user.id);

    return {
      authUserId: data.user.id,
      email,
    };
  };

  const getAuthUserEmail = async (authUserId: string): Promise<string> => {
    const { data, error } = await authAdminClient.auth.admin.getUserById(
      authUserId,
    );

    throwIfError("Auth fixture email lookup", error);

    const email = data.user?.email?.trim().toLowerCase();

    if (!email) {
      throw new Error("Auth fixture email lookup returned no email");
    }

    return email;
  };

  const createTemporaryProfile = async (
    label: string,
    profileEmail: string | undefined,
    createdByUserId: string,
  ): Promise<TemporaryProfileFixture> => {
    const authUser = await createTemporaryAuthUser(label);
    const normalizedProfileEmail = (profileEmail ?? authUser.email)
      .trim()
      .toLowerCase();
    const profile = await database.query<IdRow>(
      `insert into public.user_profiles (
         auth_user_id,
         full_name,
         email,
         birthday,
         is_admin,
         is_active,
         created_by_user_id
       )
       values ($1::uuid, $2::text, $3::text, $4::date, false, true, $5::uuid)
       returning id`,
      [
        authUser.authUserId,
        `Security fixture ${label}`,
        normalizedProfileEmail,
        "1990-01-01",
        createdByUserId,
      ],
    );
    const profileId = profile.rows[0]?.id;

    if (!profileId) {
      throw new Error("Temporary profile fixture creation returned no profile ID");
    }

    state.profileIds.push(profileId);

    return {
      ...authUser,
      profileId,
      profileEmail: normalizedProfileEmail,
    };
  };

  const updateAuthUserEmail = async (
    authUserId: string,
    email: string,
  ): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await authAdminClient.auth.admin.updateUserById(
      authUserId,
      { email: normalizedEmail },
    );

    throwIfError("Auth fixture email update", error);

    if (data.user?.email?.trim().toLowerCase() !== normalizedEmail) {
      throw new Error("Auth fixture email update returned an unexpected email");
    }
  };

  const withRollbackDatabaseTransaction = async <Result>(
    operation: (client: PoolClient) => Promise<Result>,
  ): Promise<Result> => {
    const client = await database.connect();

    try {
      await client.query("begin");
      const result = await operation(client);
      await client.query("rollback");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  };

  const performCleanup = async (): Promise<CleanupVerification> => {
    const cleanupErrors: string[] = [];
    let auditLogsRemaining = 0;
    let permissionsRemaining = 0;
    let profilesRemaining = 0;
    let authUsersRemaining = 0;
    let postgresClosed = false;

    try {
      if (state.profileIds.length > 0) {
        const auditCount = await database.query<CountRow>(
          `select count(*)::text as count
           from public.audit_logs
           where actor_user_id = any($1::uuid[])
              or entity_id = any($1::uuid[])`,
          [state.profileIds],
        );

        auditLogsRemaining = parseCount(auditCount.rows[0]);
      }
    } catch {
      cleanupErrors.push("audit cleanup could not be verified");
    }

    try {
      if (state.profileIds.length > 0) {
        await database.query(
          `delete from public.user_permissions
           where user_id = any($1::uuid[])
              or granted_by_user_id = any($1::uuid[])`,
          [state.profileIds],
        );
      }
    } catch {
      cleanupErrors.push("permission rows could not be deleted");
    }

    for (const profileId of [...state.profileIds].reverse()) {
      try {
        await database.query(
          "delete from public.user_profiles where id = $1::uuid",
          [profileId],
        );
      } catch {
        cleanupErrors.push("a profile row could not be deleted");
      }
    }

    try {
      const emailPattern = `${fixtureIdentityPrefix}%`;
      const permissionCount = await database.query<CountRow>(
        `select count(*)::text as count
         from public.user_permissions as fixture_permission
         where exists (
           select 1
           from public.user_profiles as fixture_profile
           where fixture_profile.email like $1::text
             and fixture_profile.id in (
               fixture_permission.user_id,
               fixture_permission.granted_by_user_id
             )
         )`,
        [emailPattern],
      );
      const profileCount = await database.query<CountRow>(
        `select count(*)::text as count
         from public.user_profiles
         where email like $1::text`,
        [emailPattern],
      );

      permissionsRemaining = parseCount(permissionCount.rows[0]);
      profilesRemaining = parseCount(profileCount.rows[0]);
    } catch {
      cleanupErrors.push("database cleanup could not be verified");
    }

    for (const client of state.actorClients) {
      const { error } = await client.auth.signOut();

      if (error) {
        cleanupErrors.push("an actor session could not be signed out");
      }
    }

    for (const authUserId of [...state.authUserIds].reverse()) {
      const { error } = await authAdminClient.auth.admin.deleteUser(authUserId);

      if (error) {
        cleanupErrors.push("an Auth user could not be deleted");
      }
    }

    try {
      authUsersRemaining = await countTemporaryAuthUsers();
    } catch {
      cleanupErrors.push("Auth cleanup could not be verified");
    }

    try {
      await database.end();
      postgresClosed = true;
    } catch {
      cleanupErrors.push("the PostgreSQL connection could not be closed");
    }

    if (
      auditLogsRemaining !== 0 ||
      permissionsRemaining !== 0 ||
      profilesRemaining !== 0 ||
      authUsersRemaining !== 0
    ) {
      cleanupErrors.push("temporary backend security fixtures remain");
    }

    if (cleanupErrors.length > 0) {
      throw new Error(`Backend fixture cleanup failed: ${cleanupErrors.join("; ")}`);
    }

    return {
      auditLogsRemaining,
      authUsersRemaining,
      profilesRemaining,
      permissionsRemaining,
      postgresClosed,
    };
  };

  const cleanup = (): Promise<CleanupVerification> => {
    cleanupPromise ??= performCleanup();
    return cleanupPromise;
  };

  const createActor = async (options: ActorOptions): Promise<SecurityActor> => {
    const email = `${fixtureEmailPrefix}${options.label}@example.com`;
    const password = `AlfaEV-${randomUUID()}-Aa1!`;
    const { data: authData, error: authError } =
      await authAdminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    throwIfError("Auth fixture creation", authError);

    if (!authData.user) {
      throw new Error("Auth fixture creation returned no user");
    }

    state.authUserIds.push(authData.user.id);

    const profileResult = await database.query<IdRow>(
      `insert into public.user_profiles (
         auth_user_id,
         full_name,
         email,
         birthday,
         is_admin,
         is_active,
         created_by_user_id
       )
       values ($1::uuid, $2::text, $3::text, $4::date, $5::boolean, $6::boolean, $7::uuid)
       returning id`,
      [
        authData.user.id,
        `Security fixture ${options.label}`,
        email,
        "1990-01-01",
        options.isAdmin,
        options.isActive,
        options.createdByUserId,
      ],
    );
    const profileId = profileResult.rows[0]?.id;

    if (!profileId) {
      throw new Error("Profile fixture creation returned no profile ID");
    }

    state.profileIds.push(profileId);

    const actorClient = createClient(
      environment.supabaseUrl,
      environment.supabasePublishableKey,
      createClientOptions(),
    );
    const { error: signInError } = await actorClient.auth.signInWithPassword({
      email,
      password,
    });

    throwIfError("Actor fixture sign-in", signInError);
    state.actorClients.push(actorClient);

    return {
      authUserId: authData.user.id,
      profileId,
      client: actorClient,
    };
  };

  try {
    const permissionResult = await database.query<PermissionDefinitionRow>(
      `select id, key
       from public.permission_definitions
       where key in ($1::text, $2::text)`,
      ["projects.view", "projects.create"],
    );
    const grantedPermission = permissionResult.rows.find(
      (permission) => permission.key === "projects.view",
    );
    const ungrantedPermission = permissionResult.rows.find(
      (permission) => permission.key === "projects.create",
    );

    if (!grantedPermission?.id || !ungrantedPermission?.id) {
      throw new Error("Canonical fixture permissions are missing");
    }

    const admin = await createActor({
      label: "admin",
      isAdmin: true,
      isActive: true,
      createdByUserId: null,
    });
    const permitted = await createActor({
      label: "permitted",
      isAdmin: false,
      isActive: true,
      createdByUserId: admin.profileId,
    });
    const unpermitted = await createActor({
      label: "unpermitted",
      isAdmin: false,
      isActive: true,
      createdByUserId: admin.profileId,
    });
    const inactive = await createActor({
      label: "inactive",
      isAdmin: true,
      isActive: false,
      createdByUserId: admin.profileId,
    });

    await database.query(
      `insert into public.user_permissions (
         user_id,
         permission_definition_id,
         granted_by_user_id
       )
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [permitted.profileId, grantedPermission.id, admin.profileId],
    );
    await database.query(
      `insert into public.user_permissions (
         user_id,
         permission_definition_id,
         granted_by_user_id
       )
       values ($1::uuid, $2::uuid, $3::uuid)`,
      [inactive.profileId, grantedPermission.id, admin.profileId],
    );

    return {
      anonymousClient,
      actors: {
        admin,
        permitted,
        unpermitted,
        inactive,
      },
      permissionDefinitionIds: {
        granted: grantedPermission.id,
        ungranted: ungrantedPermission.id,
      },
      countAuthUsersByEmail,
      createTemporaryAuthUser,
      createTemporaryProfile,
      getAuthUserEmail,
      updateAuthUserEmail,
      withRollbackDatabaseTransaction,
      cleanup,
    };
  } catch (setupError) {
    try {
      await cleanup();
    } catch (cleanupError) {
      const setupMessage =
        setupError instanceof Error ? setupError.message : "Unknown setup error";
      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : "Unknown cleanup error";

      throw new Error(
        `Backend fixture setup failed (${setupMessage}) and cleanup also failed (${cleanupMessage})`,
      );
    }

    throw setupError;
  }
}
