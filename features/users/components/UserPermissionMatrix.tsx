import type { PermissionKey } from "../../../app/auth/permissions";
import type {
  UserPermissionMatrixItem,
  UserPermissionModule,
} from "../services/userPermissionsService";

const PERMISSION_GROUPS: ReadonlyArray<{
  module: UserPermissionModule;
  label: string;
}> = [
  { module: "dashboard", label: "Dashboard" },
  { module: "projects", label: "Projects" },
  { module: "procurement", label: "Nabavka" },
  { module: "suppliers", label: "Dobavljači" },
  { module: "inventory", label: "Skladište" },
  { module: "pcb", label: "PCB Cards" },
  { module: "work_orders", label: "Radni Nalozi" },
  { module: "archive", label: "Archive" },
];

export interface UserPermissionMatrixProps {
  permissions: readonly UserPermissionMatrixItem[];
  isAdminTarget: boolean;
  onPermissionChange?: (permissionKey: PermissionKey, granted: boolean) => void;
}

function UserPermissionMatrix({
  permissions,
  isAdminTarget,
  onPermissionChange,
}: UserPermissionMatrixProps) {
  const isReadOnly = isAdminTarget || !onPermissionChange;

  return (
    <section
      aria-labelledby="user-permissions-heading"
      className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <div className="border-b border-zinc-200 pb-5">
        <h2
          id="user-permissions-heading"
          className="text-xl font-bold text-zinc-900"
        >
          Permissions
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          {isAdminTarget
            ? "This Admin has full access through Admin bypass. Preserved explicit grants are shown read-only and become relevant again after demotion."
            : "Current explicit module permissions for this AlfaEV user."}
        </p>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {PERMISSION_GROUPS.map((group) => {
          const groupPermissions = permissions.filter(
            (permission) => permission.module === group.module,
          );

          if (groupPermissions.length === 0) {
            return null;
          }

          return (
            <fieldset
              key={group.module}
              className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5"
            >
              <legend className="px-1 text-sm font-bold text-zinc-900">
                {group.label}
              </legend>
              <div className="mt-2 space-y-4">
                {groupPermissions.map((permission) => (
                  <label
                    key={permission.permissionKey}
                    className="flex items-start gap-3"
                  >
                    <input
                      type="checkbox"
                      aria-label={permission.label}
                      checked={permission.granted}
                      disabled={isReadOnly}
                      onChange={(event) => {
                        onPermissionChange?.(
                          permission.permissionKey,
                          event.currentTarget.checked,
                        );
                      }}
                      className="mt-1 h-4 w-4 rounded border-zinc-300 text-red-600 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-zinc-800">
                        {permission.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                        {permission.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

export default UserPermissionMatrix;
