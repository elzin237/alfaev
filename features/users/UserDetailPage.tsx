import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";

import { useAuth } from "../../app/auth/AuthProvider";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import UserActiveStateControl from "./components/UserActiveStateControl";
import UserProfileForm from "./components/UserProfileForm";
import { getUserAdmin } from "./services/userDetailService";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function UserDetailPage() {
  const { userId = "" } = useParams<{ userId: string }>();
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const detailQueryKey = ["users", "detail", profile?.id, userId] as const;
  const usersListQueryKey = ["users", "list", profile?.id] as const;
  const userQuery = useQuery({
    queryKey: detailQueryKey,
    queryFn: () => getUserAdmin(userId),
    enabled: Boolean(profile?.id && userId),
    staleTime: 60_000,
  });

  let content: ReactNode;

  if (!userId) {
    content = (
      <ErrorState
        title="User not found"
        message="The AlfaEV user could not be found."
      />
    );
  } else if (userQuery.isPending) {
    content = <LoadingState message="Loading AlfaEV user profile..." />;
  } else if (userQuery.isError || !userQuery.data?.ok) {
    content = (
      <ErrorState
        title={
          userQuery.data?.ok === false &&
          userQuery.data.error.code === "user_not_found"
            ? "User not found"
            : "Unable to load user"
        }
        message={
          userQuery.data?.ok === false
            ? userQuery.data.error.message
            : "The AlfaEV user profile could not be loaded."
        }
        onRetry={() => void userQuery.refetch()}
      />
    );
  } else {
    const user = userQuery.data.value;

    content = (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <UserProfileForm
          key={`${user.id}:${user.fullName}:${user.email}:${user.birthday}`}
          user={user}
          onUpdated={() => {
            setSuccessMessage("User profile updated.");
            void queryClient.invalidateQueries({
              queryKey: detailQueryKey,
              exact: true,
            });
            void queryClient.invalidateQueries({
              queryKey: usersListQueryKey,
              exact: true,
            });
          }}
        />

        <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-zinc-900">Account status</h2>
          <dl className="mt-5 space-y-5">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Active status</dt>
              <dd className="mt-2">
                <StatusBadge
                  label={user.isActive ? "Active" : "Inactive"}
                  tone={user.isActive ? "success" : "neutral"}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Admin status</dt>
              <dd className="mt-2">
                <StatusBadge
                  label={user.isAdmin ? "Admin" : "Non-admin"}
                  tone={user.isAdmin ? "info" : "neutral"}
                />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Created Date</dt>
              <dd className="mt-1 text-sm font-medium text-zinc-900">{formatDate(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Last Login</dt>
              <dd className="mt-1 text-sm font-medium text-zinc-900">
                {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
              </dd>
            </div>
          </dl>
          {profile && (
            <UserActiveStateControl
              user={user}
              currentProfileId={profile.id}
              onChanged={(message) => {
                setSuccessMessage(message);
                void queryClient.invalidateQueries({
                  queryKey: detailQueryKey,
                  exact: true,
                });
                void queryClient.invalidateQueries({
                  queryKey: usersListQueryKey,
                  exact: true,
                });
              }}
            />
          )}
        </aside>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="User Profile"
        description="View and edit this AlfaEV user's profile details."
        actions={
          <Link
            to="/users"
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-300 focus:ring-offset-2"
          >
            Back to Users
          </Link>
        }
      />
      {successMessage && (
        <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </p>
      )}
      {content}
    </section>
  );
}

export default UserDetailPage;
