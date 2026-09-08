import { supabase } from "../../lib/supabase/client";

export interface PermissionRealtimeSubscription {
  unsubscribe: () => void;
}

export function subscribeToUserPermissionChanges(
  profileId: string,
  onPermissionChange: () => void,
): PermissionRealtimeSubscription {
  const signalConfiguration = {
    schema: "public",
    table: "user_permission_revisions",
    filter: `user_id=eq.${profileId}`,
  } as const;
  const channel = supabase
    .channel(`user-permission-revisions:${profileId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        ...signalConfiguration,
      },
      () => onPermissionChange(),
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        ...signalConfiguration,
      },
      () => onPermissionChange(),
    )
    .subscribe();

  return {
    unsubscribe: () => {
      void supabase.removeChannel(channel);
    },
  };
}
