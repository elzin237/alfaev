import { beforeEach, describe, expect, it, vi } from "vitest";

const realtimeServiceMocks = vi.hoisted(() => ({
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
  },
  createChannel: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("../../lib/supabase/client", () => ({
  supabase: {
    channel: realtimeServiceMocks.createChannel,
    removeChannel: realtimeServiceMocks.removeChannel,
  },
}));

import { subscribeToUserPermissionChanges } from "./permissionRealtimeService";

const profileId = "00000000-0000-0000-0000-000000000201";

beforeEach(() => {
  vi.resetAllMocks();
  realtimeServiceMocks.channel.on.mockReturnValue(
    realtimeServiceMocks.channel,
  );
  realtimeServiceMocks.channel.subscribe.mockReturnValue(
    realtimeServiceMocks.channel,
  );
  realtimeServiceMocks.createChannel.mockReturnValue(
    realtimeServiceMocks.channel,
  );
  realtimeServiceMocks.removeChannel.mockResolvedValue("ok");
});

describe("permissionRealtimeService", () => {
  it("subscribes to only INSERT and UPDATE revision signals for the current profile", () => {
    const onPermissionChange = vi.fn();

    subscribeToUserPermissionChanges(profileId, onPermissionChange);

    expect(realtimeServiceMocks.createChannel).toHaveBeenCalledWith(
      `user-permission-revisions:${profileId}`,
    );
    expect(realtimeServiceMocks.channel.on).toHaveBeenNthCalledWith(
      1,
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "user_permission_revisions",
        filter: `user_id=eq.${profileId}`,
      },
      expect.any(Function),
    );
    expect(realtimeServiceMocks.channel.on).toHaveBeenNthCalledWith(
      2,
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "user_permission_revisions",
        filter: `user_id=eq.${profileId}`,
      },
      expect.any(Function),
    );
    expect(realtimeServiceMocks.channel.on).not.toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({ event: "DELETE" }),
      expect.any(Function),
    );
    expect(realtimeServiceMocks.channel.subscribe).toHaveBeenCalledOnce();

    const insertHandler = realtimeServiceMocks.channel.on.mock.calls[0]?.[2];
    const updateHandler = realtimeServiceMocks.channel.on.mock.calls[1]?.[2];

    if (
      typeof insertHandler !== "function" ||
      typeof updateHandler !== "function"
    ) {
      throw new Error("Realtime permission revision handlers were not registered");
    }

    insertHandler({ forgedAuthorizationState: true });
    updateHandler({ forgedAuthorizationState: false });

    expect(onPermissionChange).toHaveBeenCalledTimes(2);
    expect(onPermissionChange).toHaveBeenNthCalledWith(1);
    expect(onPermissionChange).toHaveBeenNthCalledWith(2);
  });

  it("removes the exact channel during cleanup", () => {
    const subscription = subscribeToUserPermissionChanges(
      profileId,
      vi.fn(),
    );

    subscription.unsubscribe();

    expect(realtimeServiceMocks.removeChannel).toHaveBeenCalledWith(
      realtimeServiceMocks.channel,
    );
  });
});
