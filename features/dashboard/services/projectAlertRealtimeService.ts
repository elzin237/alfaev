import { supabase } from "../../../lib/supabase/client";

export type ProjectAlertRealtimeStatus =
  | "connecting"
  | "subscribed"
  | "channel_error"
  | "timed_out"
  | "closed";

interface SubscribeToProjectAlertInvalidationsOptions {
  profileId: string;
  accessToken: string;
  onInvalidate: () => void;
  onStatusChange?: (status: ProjectAlertRealtimeStatus) => void;
}

export interface ProjectAlertRealtimeSubscription {
  getStatus: () => ProjectAlertRealtimeStatus;
  unsubscribe: () => void;
}

const pendingChannelRemovalByTopic = new Map<string, Promise<unknown>>();

export function projectAlertRealtimeTopic(profileId: string): string {
  return `project-alert-notifications:${profileId}`;
}

export function subscribeToProjectAlertInvalidations({
  profileId,
  accessToken,
  onInvalidate,
  onStatusChange,
}: SubscribeToProjectAlertInvalidationsOptions): ProjectAlertRealtimeSubscription {
  const topic = projectAlertRealtimeTopic(profileId);
  let status: ProjectAlertRealtimeStatus = "connecting";
  let disposed = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;

  const setStatus = (nextStatus: ProjectAlertRealtimeStatus) => {
    status = nextStatus;
    onStatusChange?.(nextStatus);
  };

  setStatus("connecting");

  void (async () => {
    try {
      await supabase.realtime.setAuth(accessToken);
      await pendingChannelRemovalByTopic.get(topic);
      if (disposed) return;

      channel = supabase
        .channel(topic, { config: { private: true } })
        .on("broadcast", { event: "invalidate" }, () => {
          if (!disposed) onInvalidate();
        })
        .subscribe((nextStatus) => {
          if (disposed) return;
          if (nextStatus === "SUBSCRIBED") {
            setStatus("subscribed");
          } else if (nextStatus === "CHANNEL_ERROR") {
            setStatus("channel_error");
          } else if (nextStatus === "TIMED_OUT") {
            setStatus("timed_out");
          } else if (nextStatus === "CLOSED") {
            setStatus("closed");
          }
        });
    } catch {
      if (!disposed) setStatus("channel_error");
    }
  })();

  return {
    getStatus: () => status,
    unsubscribe: () => {
      if (disposed) return;
      disposed = true;
      setStatus("closed");
      if (!channel) return;

      const channelToRemove = channel;
      const removal = supabase.removeChannel(channelToRemove).catch(() => undefined);
      pendingChannelRemovalByTopic.set(topic, removal);
      void removal.finally(() => {
        if (pendingChannelRemovalByTopic.get(topic) === removal) {
          pendingChannelRemovalByTopic.delete(topic);
        }
      });
    },
  };
}
