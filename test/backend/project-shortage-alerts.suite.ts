import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import type { SecurityActor, SecurityFixtureHarness } from "./security-fixtures";
import { createTestSerialNumber } from "./helpers/serial";

interface NotificationRow extends QueryResultRow {
  notification_id: string;
  event_id: string;
  notification_kind: string;
  project_id: string;
  project_name: string;
  activity_id: string | null;
  activity_title: string | null;
  activity_author_full_name: string | null;
  resolution_id: string | null;
  resolver_full_name: string | null;
  resolved_at: Date | null;
  created_at: Date;
  read_at: Date | null;
  has_more: boolean;
  product_id: string | null;
  product_serial_number: string | null;
  product_name: string | null;
  shortage_event_type: string | null;
  shortage_quantity: string | null;
  is_baseline_detection: boolean | null;
}

const listNotificationsSql = `select * from public.list_project_notifications(
  $1::integer, $2::timestamptz, $3::uuid
)`;

async function setActor(database: PoolClient, actor: SecurityActor | null) {
  await database.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', $1::text, true)",
    [actor?.authUserId ?? ""],
  );
  await database.query(actor ? "set local role authenticated" : "set local role anon");
}

async function callAs<Row extends QueryResultRow>(
  database: PoolClient,
  actor: SecurityActor,
  sql: string,
  values: unknown[] = [],
): Promise<Row[]> {
  await setActor(database, actor);
  try {
    return (await database.query<Row>(sql, values)).rows;
  } finally {
    await database.query("reset role");
  }
}

async function expectRejectedAs(
  database: PoolClient,
  actor: SecurityActor | null,
  sql: string,
  values: unknown[],
  code: string,
) {
  await database.query("savepoint rejected_shortage_notification_read");
  await setActor(database, actor);
  try {
    await expect(database.query(sql, values)).rejects.toMatchObject({ code });
  } finally {
    await database.query("rollback to savepoint rejected_shortage_notification_read");
    await database.query("release savepoint rejected_shortage_notification_read");
    await database.query("reset role");
  }
}

async function flush(database: PoolClient) {
  await database.query(
    "set constraints project_shortage_reconciliation_queue_process immediate",
  );
  await database.query(
    "set constraints project_shortage_reconciliation_queue_process deferred",
  );
}

async function fixture(
  database: PoolClient,
  actorId: string,
  requiredQuantity = 10,
  flushAfterCreate = true,
) {
  const productId = randomUUID();
  const projectId = randomUUID();
  const projectProductId = randomUUID();
  await database.query(
    `insert into public.products (
       id, serial_number, name, category, product_kind,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Shortage Product', 'Component', 'component', $3, $3)`,
    [productId, createTestSerialNumber(), actorId],
  );
  await database.query(
    `insert into public.projects (
       id, name, customer_name, status, start_date, delivery_date,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Shortage Customer', 'planned',
       '2026-10-21', '2026-11-21', $3, $3)`,
    [projectId, `Shortage ${projectId}`, actorId],
  );
  await database.query(
    `insert into public.project_products (
       id, project_id, name, created_by_user_id, updated_by_user_id
     ) values ($1, $2, 'Assembly', $3, $3)`,
    [projectProductId, projectId, actorId],
  );
  await database.query(
    `insert into public.project_product_components (
       project_product_id, product_id, required_quantity,
       created_by_user_id, updated_by_user_id
     ) values ($1, $2, $3, $4, $4)`,
    [projectProductId, productId, requiredQuantity, actorId],
  );
  if (flushAfterCreate) await flush(database);
  return { productId, projectId, projectProductId };
}

export function registerProjectShortageAlertTests(
  requireHarness: () => SecurityFixtureHarness,
) {
  describe.skipIf(process.env.PROJECT_SHORTAGE_ALERTS !== "1")(
    "automatic Project shortage alerts",
    () => {
      it("opens, changes, resolves, and recurs without duplicate notifications", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const admin = harness.actors.admin;
          const created = await fixture(database, admin.profileId);

          const opened = await database.query<{
            id: string; current_shortage_quantity: string;
          }>(
            `select id, current_shortage_quantity::text
             from public.project_shortage_episodes
             where project_id = $1 and product_id = $2 and resolved_at is null`,
            [created.projectId, created.productId],
          );
          expect(opened.rows).toHaveLength(1);
          expect(opened.rows[0]?.current_shortage_quantity).toBe("10");

          const openingCounts = await database.query<{
            events: string; notifications: string;
          }>(
            `select
               (select count(*)::text from public.project_shortage_events
                where episode_id = $1) as events,
               (select count(*)::text from public.project_activity_alerts
                where project_shortage_event_id in (
                  select id from public.project_shortage_events where episode_id = $1
                )) as notifications`,
            [opened.rows[0]?.id],
          );
          expect(openingCounts.rows[0]).toEqual({ events: "1", notifications: "1" });

          await database.query(
            `update public.inventory_balances set quantity = 4
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          await database.query(
            `update public.inventory_balances set quantity = 4
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          const changedEvents = (await database.query<{
            event_type: string; shortage_quantity: string;
          }>(
            `select event_type, shortage_quantity::text
             from public.project_shortage_events where episode_id = $1`,
            [opened.rows[0]?.id],
          )).rows;
          expect(changedEvents).toHaveLength(2);
          expect(changedEvents).toEqual(expect.arrayContaining([
            { event_type: "opened", shortage_quantity: "10" },
            { event_type: "decreased", shortage_quantity: "6" },
          ]));

          await database.query(
            `update public.inventory_balances set quantity = 0
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          await database.query(
            `update public.inventory_balances set quantity = 10
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          const resolved = await database.query(
            `select event_type, shortage_quantity::text
             from public.project_shortage_events where episode_id = $1
             order by created_at, id`,
            [opened.rows[0]?.id],
          );
          expect(resolved.rows).toHaveLength(4);
          expect(resolved.rows).toEqual(expect.arrayContaining([
            { event_type: "opened", shortage_quantity: "10" },
            { event_type: "decreased", shortage_quantity: "6" },
            { event_type: "increased", shortage_quantity: "10" },
            { event_type: "resolved", shortage_quantity: "0" },
          ]));
          expect((await database.query(
            `select count(*)::text as count from public.project_activity_alerts
             where project_shortage_event_id in (
               select id from public.project_shortage_events where episode_id = $1
             )`,
            [opened.rows[0]?.id],
          )).rows[0]?.count).toBe("2");

          await database.query(
            `update public.inventory_balances set quantity = 0
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          expect((await database.query(
            `select count(*)::text as count from public.project_shortage_episodes
             where project_id = $1 and product_id = $2`,
            [created.projectId, created.productId],
          )).rows[0]?.count).toBe("2");
        });
      });

      it("returns exact trusted opening/resolution context with recipient isolation and read state", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const admin = harness.actors.admin;
          const permitted = harness.actors.permitted;
          await database.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             )
             select $1::uuid, definition.id, $2::uuid
             from public.permission_definitions as definition
             where definition.key = any($3::text[])
             on conflict do nothing`,
            [permitted.profileId, admin.profileId, ["dashboard.view", "projects.view"]],
          );

          const unreadBefore = BigInt((await callAs<{ count: string }>(
            database,
            admin,
            "select public.get_project_alert_unread_count()::text as count",
          ))[0]!.count);
          const created = await fixture(database, admin.profileId);
          const product = (await database.query<{
            name: string; serial_number: string;
          }>(
            "select name, serial_number from public.products where id = $1",
            [created.productId],
          )).rows[0]!;
          const alert = (await database.query<{ id: string }>(
            `select id from public.project_activity_alerts
             where project_id = $1 and product_id = $2
               and notification_kind = 'shortage'`,
            [created.projectId, created.productId],
          )).rows[0]!;
          const adminRecipient = (await database.query<{ id: string }>(
            `select id from public.project_activity_alert_recipients
             where alert_id = $1 and recipient_user_id = $2`,
            [alert.id, admin.profileId],
          )).rows[0]!;
          const permittedRecipient = (await database.query<{ id: string }>(
            `select id from public.project_activity_alert_recipients
             where alert_id = $1 and recipient_user_id = $2`,
            [alert.id, permitted.profileId],
          )).rows[0]!;

          const adminRows = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [20, null, null],
          );
          const opening = adminRows.find((row) => row.event_id === alert.id)!;
          expect(opening).toMatchObject({
            notification_id: adminRecipient.id,
            notification_kind: "shortage",
            project_id: created.projectId,
            activity_id: null,
            activity_title: null,
            activity_author_full_name: null,
            resolution_id: null,
            resolver_full_name: null,
            resolved_at: null,
            read_at: null,
            product_id: created.productId,
            product_serial_number: product.serial_number,
            product_name: product.name,
            shortage_event_type: "opened",
            shortage_quantity: "10",
            is_baseline_detection: false,
          });
          expect(Object.keys(opening).sort()).toEqual([
            "activity_author_full_name", "activity_id", "activity_title", "created_at",
            "event_id", "has_more", "is_baseline_detection", "notification_id",
            "notification_kind", "product_id", "product_name", "product_serial_number",
            "project_id", "project_name", "read_at", "resolution_id", "resolved_at",
            "resolver_full_name", "shortage_event_type", "shortage_quantity",
          ].sort());
          expect(opening).not.toHaveProperty("recipient_user_id");
          expect(opening).not.toHaveProperty("inventory_balance");
          expect(opening).not.toHaveProperty("storage_path");

          const permittedRows = await callAs<NotificationRow>(
            database,
            permitted,
            listNotificationsSql,
            [20, null, null],
          );
          expect(permittedRows.find((row) => row.event_id === alert.id)?.notification_id)
            .toBe(permittedRecipient.id);
          expect(adminRows.some((row) => row.notification_id === permittedRecipient.id))
            .toBe(false);
          expect(permittedRows.some((row) => row.notification_id === adminRecipient.id))
            .toBe(false);

          await expectRejectedAs(
            database,
            harness.actors.unpermitted,
            listNotificationsSql,
            [20, null, null],
            "42501",
          );
          await expectRejectedAs(
            database,
            harness.actors.inactive,
            listNotificationsSql,
            [20, null, null],
            "42501",
          );
          await expectRejectedAs(database, null, listNotificationsSql, [20, null, null], "42501");

          const unreadAfterOpen = BigInt((await callAs<{ count: string }>(
            database,
            admin,
            "select public.get_project_alert_unread_count()::text as count",
          ))[0]!.count);
          expect(unreadAfterOpen).toBe(unreadBefore + 1n);
          await callAs(
            database,
            admin,
            "select * from public.mark_project_alert_read($1::uuid)",
            [adminRecipient.id],
          );
          const unreadAfterRead = BigInt((await callAs<{ count: string }>(
            database,
            admin,
            "select public.get_project_alert_unread_count()::text as count",
          ))[0]!.count);
          expect(unreadAfterRead).toBe(unreadBefore);

          await database.query(
            `update public.inventory_balances set quantity = 10
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          );
          await flush(database);
          const resolvedRows = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [20, null, null],
          );
          const resolution = resolvedRows.find((row) =>
            row.product_id === created.productId && row.shortage_event_type === "resolved"
          );
          expect(resolution).toMatchObject({
            notification_kind: "shortage",
            shortage_quantity: "0",
            is_baseline_detection: false,
          });
          expect(resolvedRows.filter((row) => row.product_id === created.productId))
            .toHaveLength(2);

          await callAs(
            database,
            admin,
            "select * from public.dismiss_project_alert_notification($1::uuid)",
            [adminRecipient.id],
          );
          const afterDismiss = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [20, null, null],
          );
          expect(afterDismiss.some((row) => row.notification_id === adminRecipient.id))
            .toBe(false);
        });
      });

      it("projects baseline detection and preserves tied keyset pagination and legacy null fields", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const admin = harness.actors.admin;
          const baseline = await fixture(database, admin.profileId, 7, false);
          await database.query("select public.initialize_project_shortage_alerts()");
          await flush(database);

          const baselineRows = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [20, null, null],
          );
          expect(baselineRows.find((row) => row.product_id === baseline.productId))
            .toMatchObject({
              notification_kind: "shortage",
              shortage_event_type: "opened",
              shortage_quantity: "7",
              is_baseline_detection: true,
            });

          const tiedCreatedAt = "2099-10-21T12:00:00Z";
          const tiedRecipientIds: string[] = [];
          for (const title of ["Legacy activity A", "Legacy activity B"]) {
            const activityId = randomUUID();
            const alertId = randomUUID();
            const recipientId = randomUUID();
            tiedRecipientIds.push(recipientId);
            await database.query(
              `insert into public.project_activity_updates (
                 id, project_id, author_user_id, request_id, title, description, created_at
               ) values ($1, $2, $3, $4, $5, 'Legacy Activity body', $6)`,
              [activityId, baseline.projectId, admin.profileId, randomUUID(), title, tiedCreatedAt],
            );
            await database.query(
              `insert into public.project_activity_alerts (
                 id, project_activity_id, sent_by_user_id, notification_kind, sent_at
               ) values ($1, $2, $3, 'activity', $4)`,
              [alertId, activityId, admin.profileId, tiedCreatedAt],
            );
            await database.query(
              `insert into public.project_activity_alert_recipients (
                 id, alert_id, recipient_user_id, created_at
               ) values ($1, $2, $3, $4)`,
              [recipientId, alertId, admin.profileId, tiedCreatedAt],
            );
          }

          const firstPage = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [1, null, null],
          );
          expect(firstPage).toHaveLength(1);
          expect(firstPage[0]?.has_more).toBe(true);
          expect(firstPage[0]).toMatchObject({
            notification_kind: "activity",
            product_id: null,
            product_serial_number: null,
            product_name: null,
            shortage_event_type: null,
            shortage_quantity: null,
            is_baseline_detection: null,
          });
          const secondPage = await callAs<NotificationRow>(
            database,
            admin,
            listNotificationsSql,
            [1, firstPage[0]!.created_at, firstPage[0]!.notification_id],
          );
          expect(secondPage).toHaveLength(1);
          expect(secondPage[0]?.notification_id).not.toBe(firstPage[0]?.notification_id);
          expect(new Set([
            firstPage[0]!.notification_id,
            secondPage[0]!.notification_id,
          ])).toEqual(new Set(tiedRecipientIds));

          await database.query("savepoint malformed_shortage_alert");
          await expect(database.query(
            `insert into public.project_activity_alerts (
               notification_kind, project_id, project_shortage_event_id,
               product_id, shortage_event_type, shortage_quantity
             ) values ('shortage', $1, $2, $3, 'opened', 1)`,
            [baseline.projectId, randomUUID(), baseline.productId],
          )).rejects.toMatchObject({ code: "23503" });
          await database.query("rollback to savepoint malformed_shortage_alert");
          await database.query("release savepoint malformed_shortage_alert");
        });
      });

      it("keeps the unified notification function identity, metadata, and ACL boundary", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const metadata = (await database.query<{
            arguments: string;
            authenticated_execute: boolean;
            anon_execute: boolean;
            public_execute: boolean;
            result_type: string;
            security_definer: boolean;
            settings: string[];
            volatility: string;
          }>(
            `select
               pg_catalog.pg_get_function_identity_arguments(routine.oid) as arguments,
               pg_catalog.pg_get_function_result(routine.oid) as result_type,
               routine.prosecdef as security_definer,
               routine.provolatile as volatility,
               routine.proconfig as settings,
               pg_catalog.has_function_privilege('public', routine.oid, 'execute') as public_execute,
               pg_catalog.has_function_privilege('anon', routine.oid, 'execute') as anon_execute,
               pg_catalog.has_function_privilege('authenticated', routine.oid, 'execute')
                 as authenticated_execute
             from pg_catalog.pg_proc as routine
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = routine.pronamespace
             where namespace.nspname = 'public'
               and routine.proname = 'list_project_notifications'`,
          )).rows;
          expect(metadata).toEqual([{
            arguments: "p_limit integer, p_before_created_at timestamp with time zone, p_before_recipient_id uuid",
            authenticated_execute: true,
            anon_execute: false,
            public_execute: false,
            result_type: "TABLE(notification_id uuid, event_id uuid, notification_kind text, project_id uuid, project_name text, activity_id uuid, activity_title text, activity_author_full_name text, resolution_id uuid, resolver_full_name text, resolved_at timestamp with time zone, created_at timestamp with time zone, read_at timestamp with time zone, has_more boolean, product_id uuid, product_serial_number text, product_name text, shortage_event_type text, shortage_quantity text, is_baseline_detection boolean)",
            security_definer: true,
            settings: ['search_path=""'],
            volatility: "s",
          }]);
        });
      });

      it("uses senderless notifications, canonical recipients, RLS, and private helpers", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          await database.query(
            `insert into public.user_permissions (
               user_id, permission_definition_id, granted_by_user_id
             )
             select $1::uuid, definition.id, $2::uuid
             from public.permission_definitions as definition
             where definition.key = 'dashboard.view'
             on conflict do nothing`,
            [harness.actors.permitted.profileId, harness.actors.admin.profileId],
          );
          const created = await fixture(database, harness.actors.admin.profileId);
          const notification = await database.query<{
            id: string; sent_by_user_id: string | null; notification_kind: string;
          }>(
            `select id, sent_by_user_id, notification_kind
             from public.project_activity_alerts
             where project_id = $1 and product_id = $2`,
            [created.projectId, created.productId],
          );
          expect(notification.rows).toHaveLength(1);
          expect(notification.rows[0]).toMatchObject({
            sent_by_user_id: null,
            notification_kind: "shortage",
          });

          const recipients = await database.query<{ recipient_user_id: string }>(
            `select recipient_user_id
             from public.project_activity_alert_recipients
             where alert_id = $1`,
            [notification.rows[0]?.id],
          );
          const eligibleRecipients = await database.query<{ id: string }>(
            `select profile.id
             from public.user_profiles as profile
             where profile.is_active
               and (
                 profile.is_admin
                 or (
                   not profile.is_admin
                   and exists (
                     select 1
                     from public.user_permissions as permission
                     join public.permission_definitions as definition
                       on definition.id = permission.permission_definition_id
                     where permission.user_id = profile.id
                       and definition.key = 'dashboard.view'
                       and definition.is_delegable
                   )
                   and exists (
                     select 1
                     from public.user_permissions as permission
                     join public.permission_definitions as definition
                       on definition.id = permission.permission_definition_id
                     where permission.user_id = profile.id
                       and definition.key = 'projects.view'
                       and definition.is_delegable
                   )
                 )
               )`,
          );
          expect(new Set(recipients.rows.map((row) => row.recipient_user_id))).toEqual(
            new Set(eligibleRecipients.rows.map((row) => row.id)),
          );
          expect(recipients.rows.map((row) => row.recipient_user_id)).toContain(
            harness.actors.admin.profileId,
          );
          expect(recipients.rows.map((row) => row.recipient_user_id)).toContain(
            harness.actors.permitted.profileId,
          );
          expect(recipients.rows.map((row) => row.recipient_user_id)).not.toContain(
            harness.actors.inactive.profileId,
          );
          expect(recipients.rows.map((row) => row.recipient_user_id)).not.toContain(
            harness.actors.unpermitted.profileId,
          );

          await database.query(
            `delete from public.user_permissions
             where user_id = $1::uuid
               and permission_definition_id = (
                 select id from public.permission_definitions
                 where key = 'dashboard.view'
               )`,
            [harness.actors.permitted.profileId],
          );
          expect((await database.query(
            `select count(*)::integer as count
             from public.project_activity_alert_recipients
             where alert_id = $1`,
            [notification.rows[0]?.id],
          )).rows[0]?.count).toBe(recipients.rows.length);

          const eventId = (await database.query<{ id: string }>(
            `select id from public.project_shortage_events
             where project_id = $1 and product_id = $2`,
            [created.projectId, created.productId],
          )).rows[0]?.id;
          await database.query("savepoint immutable_event_update");
          await expect(database.query(
            `update public.project_shortage_events
             set shortage_quantity = shortage_quantity + 1
             where id = $1`,
            [eventId],
          )).rejects.toMatchObject({ code: "55000" });
          await database.query("rollback to savepoint immutable_event_update");
          await database.query("savepoint duplicate_active_episode");
          await expect(database.query(
            `insert into public.project_shortage_episodes (
               project_id, product_id, current_shortage_quantity
             ) values ($1, $2, 1)`,
            [created.projectId, created.productId],
          )).rejects.toMatchObject({ code: "23505" });
          await database.query("rollback to savepoint duplicate_active_episode");

          const metadata = await database.query<{
            relname: string; relrowsecurity: boolean; authenticated_select: boolean;
          }>(
            `select relation.relname, relation.relrowsecurity,
               pg_catalog.has_table_privilege('authenticated', relation.oid, 'select')
                 as authenticated_select
             from pg_catalog.pg_class as relation
             join pg_catalog.pg_namespace as namespace
               on namespace.oid = relation.relnamespace
             where namespace.nspname = 'public'
               and relation.relname = any($1::text[])
             order by relation.relname`,
            [[
              "project_shortage_episodes",
              "project_shortage_events",
              "project_shortage_reconciliation_queue",
            ]],
          );
          expect(metadata.rows).toHaveLength(3);
          expect(metadata.rows.every((row) => row.relrowsecurity && !row.authenticated_select))
            .toBe(true);
        });
      });

      it("rolls back source changes and all derived shortage history after a late failure", async () => {
        const harness = requireHarness();
        await harness.withDatabaseClients(1, async ([database]) => {
          if (!database) throw new Error("Rollback test database client is missing");
          await database.query("begin");
          const created = await fixture(database, harness.actors.admin.profileId);
          expect((await database.query(
            `select count(*)::integer as count
             from public.project_shortage_events
             where project_id = $1 and product_id = $2`,
            [created.projectId, created.productId],
          )).rows[0]?.count).toBe(1);

          await expect(database.query(
            "do $block$ begin raise exception 'forced Task 003A rollback'; end $block$",
          )).rejects.toMatchObject({ code: "P0001" });
          await database.query("rollback");

          const after = await database.query<{
            alerts: number; episodes: number; events: number;
            products: number; projects: number;
          }>(
            `select
               (select count(*)::integer from public.products
                where id = $1) as products,
               (select count(*)::integer from public.projects
                where id = $2) as projects,
               (select count(*)::integer from public.project_shortage_episodes
                where project_id = $2 and product_id = $1) as episodes,
               (select count(*)::integer from public.project_shortage_events
                where project_id = $2 and product_id = $1) as events,
               (select count(*)::integer from public.project_activity_alerts
                where project_id = $2 and product_id = $1) as alerts`,
            [created.productId, created.projectId],
          );
          expect(after.rows[0]).toEqual({
            alerts: 0,
            episodes: 0,
            events: 0,
            products: 0,
            projects: 0,
          });
        });
      });

      it("serializes concurrent same-Product changes without duplicate episodes or opening alerts", async () => {
        const harness = requireHarness();
        await harness.withDatabaseClients(2, async ([first, second]) => {
          if (!first || !second) {
            throw new Error("Concurrency test database clients are missing");
          }

          await first.query("begin");
          const created = await fixture(first, harness.actors.admin.profileId);
          await first.query("commit");

          await first.query("begin");
          await second.query("begin");
          await first.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
            [harness.actors.admin.authUserId],
          );
          await second.query(
            "select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
            [harness.actors.admin.authUserId],
          );
          await first.query(
            `select * from public.apply_inventory_delta(
               $1, 4, 'task_003a_concurrency', 'Task 003A concurrency',
               'pcb_production_output', $2, null, null, null,
               'internal_production'
             )`,
            [created.productId, created.projectId],
          );

          let secondCompleted = false;
          const secondUpdate = second.query(
            `select * from public.apply_inventory_delta(
               $1, 4, 'task_003a_concurrency', 'Task 003A concurrency',
               'pcb_production_output', $2, null, null, null,
               'internal_production'
             )`,
            [created.productId, created.projectId],
          ).then(() => {
            secondCompleted = true;
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          expect(secondCompleted).toBe(false);

          await first.query("commit");
          await secondUpdate;
          await second.query("commit");

          const result = await first.query<{
            alerts: number; episodes: number; events: number; quantity: string;
          }>(
            `select
               (select quantity::text from public.inventory_balances
                where product_id = $1
                  and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid) as quantity,
               (select count(*)::integer from public.project_shortage_episodes
                where project_id = $2 and product_id = $1
                  and resolved_at is null) as episodes,
               (select count(*)::integer from public.project_shortage_events
                where project_id = $2 and product_id = $1) as events,
               (select count(*)::integer from public.project_activity_alerts
                where project_id = $2 and product_id = $1) as alerts`,
            [created.productId, created.projectId],
          );
          expect(result.rows[0]).toEqual({
            alerts: 1,
            episodes: 1,
            events: 3,
            quantity: "8",
          });
          expect((await first.query(
            `select pg_catalog.sum(remaining_quantity)::text as remaining
             from public.inventory_source_lots
             where product_id = $1
               and warehouse_id = '10000000-0000-4000-8000-000000000001'::uuid`,
            [created.productId],
          )).rows[0]?.remaining).toBe("8");
        });
      });

      it("keeps baseline initialization idempotent", async () => {
        const harness = requireHarness();
        await harness.withRollbackDatabaseTransaction(async (database) => {
          const created = await fixture(database, harness.actors.admin.profileId);
          const before = await database.query(
            `select
               (select count(*)::text from public.project_shortage_episodes
                where project_id = $1 and product_id = $2) as episodes,
               (select count(*)::text from public.project_shortage_events
                where project_id = $1 and product_id = $2) as events`,
            [created.projectId, created.productId],
          );
          await database.query("select public.initialize_project_shortage_alerts()");
          await database.query("select public.initialize_project_shortage_alerts()");
          const after = await database.query(
            `select
               (select count(*)::text from public.project_shortage_episodes
                where project_id = $1 and product_id = $2) as episodes,
               (select count(*)::text from public.project_shortage_events
                where project_id = $1 and product_id = $2) as events`,
            [created.projectId, created.productId],
          );
          expect(after.rows[0]).toEqual(before.rows[0]);
        });
      });
    },
  );
}
