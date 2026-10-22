import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../../../app/auth/AuthProvider";
import { hasPermission } from "../../../app/auth/permissionService";
import { permissionQueryKey } from "../../../app/auth/permissionQueryKeys";
import { brandListQueryKey } from "../brandQueryKeys";
import {
  archiveBrand,
  createBrand,
  listBrands,
  updateBrand,
} from "../services/brandService";

export function useBrandManagement(enabled = true) {
  const { session, profile, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const listQueryKey = brandListQueryKey(profile?.id);
  const brandsQuery = useQuery({
    queryKey: listQueryKey,
    queryFn: listBrands,
    enabled: Boolean(enabled && profile?.id),
    staleTime: 60_000,
  });
  const managementPermissionQuery = useQuery({
    queryKey: permissionQueryKey(
      session?.user.id,
      profile?.id,
      "inventory.brands.manage",
    ),
    queryFn: () => hasPermission("inventory.brands.manage"),
    enabled: Boolean(session && profile?.isActive && !isAdmin),
    staleTime: 60_000,
  });

  const canManage = isAdmin || (
    managementPermissionQuery.data?.ok === true &&
    managementPermissionQuery.data.value
  );

  async function invalidateBrandList(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: listQueryKey, exact: true });
  }

  async function create(name: string) {
    const result = await createBrand(name);
    if (result.ok) await invalidateBrandList();
    return result;
  }

  async function update(brandId: string, name: string) {
    const result = await updateBrand(brandId, name);
    if (result.ok) await invalidateBrandList();
    return result;
  }

  async function archive(brandId: string) {
    const result = await archiveBrand(brandId);
    if (result.ok) await invalidateBrandList();
    return result;
  }

  return {
    brandsQuery,
    canManage,
    create,
    update,
    archive,
  };
}
