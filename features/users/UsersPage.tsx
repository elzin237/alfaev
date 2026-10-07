import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { useAuth } from "../../app/auth/AuthProvider";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import CreateUserDialog from "./components/CreateUserDialog";
import { listUsersAdmin } from "./services/usersService";
import { userListQueryKey } from "./userQueryKeys";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function UsersPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const usersListKey = userListQueryKey(profile?.id);
  const usersQuery = useQuery({
    queryKey: usersListKey,
    queryFn: listUsersAdmin,
    enabled: Boolean(profile?.id),
    staleTime: 60_000,
  });

  let content: ReactNode;

  if (usersQuery.isPending) {
    content = <LoadingState message="Loading AlfaEV users..." />;
  } else if (usersQuery.isError || !usersQuery.data?.ok) {
    content = (
      <ErrorState
        title="Unable to load users"
        message={
          usersQuery.data?.ok === false
            ? usersQuery.data.error.message
            : "The AlfaEV users list could not be loaded."
        }
        onRetry={() => void usersQuery.refetch()}
      />
    );
  } else if (usersQuery.data.value.length === 0) {
    content = (
      <EmptyState
        title="No users found"
        description="There are no AlfaEV user profiles to display."
      />
    );
  } else {
    content = (
      <div className="overflow-x-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-zinc-200 text-left">
          <thead className="bg-zinc-50">
            <tr>
              {[
                "Full Name",
                "Email",
                "Status",
                "Admin",
                "Created Date",
                "Last Login",
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="whitespace-nowrap px-5 py-4 text-xs font-semibold uppercase tracking-wide text-zinc-500"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-zinc-100">
            {usersQuery.data.value.map((user) => (
              <tr key={user.id} className="text-sm text-zinc-700">
                <td className="whitespace-nowrap px-5 py-4 font-semibold text-zinc-900">
                  <Link
                    to={`/users/${user.id}`}
                    className="transition hover:text-red-600 hover:underline focus:outline-none focus:ring-2 focus:ring-red-200"
                  >
                    {user.fullName}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-5 py-4">{user.email}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={user.isActive ? "Active" : "Inactive"}
                    tone={user.isActive ? "success" : "neutral"}
                  />
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  <StatusBadge
                    label={user.isAdmin ? "Admin" : "Non-admin"}
                    tone={user.isAdmin ? "info" : "neutral"}
                  />
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  {formatDate(user.createdAt)}
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Users"
        description="View AlfaEV user accounts and their current status."
        actions={
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              setIsCreateDialogOpen(true);
            }}
            className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          >
            Create User
          </button>
        }
      />
      {successMessage && (
        <p
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800"
        >
          {successMessage}
        </p>
      )}
      {content}
      <CreateUserDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={() => {
          setSuccessMessage("User invitation sent.");
          void queryClient.invalidateQueries({
            queryKey: usersListKey,
            exact: true,
          });
        }}
      />
    </section>
  );
}

export default UsersPage;
