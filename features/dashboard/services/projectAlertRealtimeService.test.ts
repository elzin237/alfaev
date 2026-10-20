import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  return {
    channel,
    channelFactory: vi.fn(),
    removeChannel: vi.fn(),
    setAuth: vi.fn(),
  };
});

vi.mock("../../../lib/supabase/client", () => ({
  supabase: {
    realtime: { setAuth: mocks.setAuth },
    channel: mocks.channelFactory,
    removeChannel: mocks.removeChannel,
  },
}));

import {
  projectAlertRealtimeTopic,
  subscribeToProjectAlertInvalidations,
} from "./projectAlertRealtimeService";

const profileId = "00000000-0000-4000-8000-000000000101";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.channel.on.mockReturnValue(mocks.channel);
  mocks.channel.subscribe.mockReturnValue(mocks.channel);
  mocks.channelFactory.mockReturnValue(mocks.channel);
  mocks.removeChannel.mockResolvedValue("ok");
  mocks.setAuth.mockResolvedValue(undefined);
});

describe("projectAlertRealtimeService", () => {
  it("joins the exact private profile topic with current auth and ignores payload", async () => {
    const onInvalidate = vi.fn();
    const onStatusChange = vi.fn();
    const subscription = subscribeToProjectAlertInvalidations({
      profileId,
      accessToken: "current-jwt",
      onInvalidate,
      onStatusChange,
    });

    expect(projectAlertRealtimeTopic(profileId)).toBe(
      `project-alert-notifications:${profileId}`,
    );
    expect(subscription.getStatus()).toBe("connecting");
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith("connecting");
    await waitFor(() => expect(mocks.channelFactory).toHaveBeenCalledOnce());
    expect(mocks.setAuth).toHaveBeenCalledExactlyOnceWith("current-jwt");
    expect(mocks.channelFactory).toHaveBeenCalledExactlyOnceWith(
      `project-alert-notifications:${profileId}`,
      { config: { private: true } },
    );
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "invalidate" },
      expect.any(Function),
    );

    const statusHandler = mocks.channel.subscribe.mock.calls[0]?.[0];
    statusHandler?.("SUBSCRIBED");
    expect(subscription.getStatus()).toBe("subscribed");
    expect(onStatusChange).toHaveBeenLastCalledWith("subscribed");

    const broadcastHandler = mocks.channel.on.mock.calls[0]?.[2];
    const transportMessage = {} as { payload: unknown };
    Object.defineProperty(transportMessage, "payload", {
      get: () => {
        throw new Error("Realtime payload must not be read");
      },
    });
    expect(() => broadcastHandler?.(transportMessage)).not.toThrow();
    expect(onInvalidate).toHaveBeenCalledOnce();

    subscription.unsubscribe();
    expect(subscription.getStatus()).toBe("closed");
    await waitFor(() => {
      expect(mocks.removeChannel).toHaveBeenCalledExactlyOnceWith(mocks.channel);
    });
  });

  it("surfaces channel lifecycle failures without reading data or sending Broadcasts", async () => {
    const onInvalidate = vi.fn();
    const onStatusChange = vi.fn();
    subscribeToProjectAlertInvalidations({
      profileId: "00000000-0000-4000-8000-000000000102",
      accessToken: "current-jwt",
      onInvalidate,
      onStatusChange,
    });
    await waitFor(() => expect(mocks.channel.subscribe).toHaveBeenCalledOnce());
    const statusHandler = mocks.channel.subscribe.mock.calls[0]?.[0];

    statusHandler?.("CHANNEL_ERROR");
    statusHandler?.("TIMED_OUT");
    expect(onStatusChange).toHaveBeenNthCalledWith(2, "channel_error");
    expect(onStatusChange).toHaveBeenNthCalledWith(3, "timed_out");
    expect(onInvalidate).not.toHaveBeenCalled();

    const source = readFileSync(
      "features/dashboard/services/projectAlertRealtimeService.ts",
      "utf8",
    );
    expect(source).not.toMatch(/\.send\s*\(/);
    expect(source).not.toMatch(/\.from\s*\(/);
    expect(source).not.toContain("project_activity_alert_recipients");
  });

  it("does not create a channel when cleanup wins the async auth race", async () => {
    let resolveAuth: (() => void) | undefined;
    mocks.setAuth.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveAuth = resolve;
    }));
    const onInvalidate = vi.fn();
    const subscription = subscribeToProjectAlertInvalidations({
      profileId: "00000000-0000-4000-8000-000000000103",
      accessToken: "current-jwt",
      onInvalidate,
    });

    subscription.unsubscribe();
    resolveAuth?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.channelFactory).not.toHaveBeenCalled();
    expect(onInvalidate).not.toHaveBeenCalled();
  });
});
