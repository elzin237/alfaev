import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAuth } from "../../app/auth/AuthProvider";
import EmptyState from "../../shared/components/EmptyState";
import ErrorState from "../../shared/components/ErrorState";
import LoadingState from "../../shared/components/LoadingState";
import PageHeader from "../../shared/components/PageHeader";
import StatusBadge from "../../shared/components/StatusBadge";
import { listUsersAdmin } from "./services/usersService";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function UsersPage() {
  const { profile } = useAuth();
  const usersQuery = useQuery({
    queryKey: ["users", "list", profile?.id],
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
                  {user.fullName}
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
      />
      {content}
    </section>
  );
}

export default UsersPage;
