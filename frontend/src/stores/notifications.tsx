import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/stores/auth-context";
import { notify } from "@/lib/notify";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  tone: NotificationTone;
  time: number;
  read: boolean;
  taskId?: string;
  progress?: number;
}

type StreamStatus = "connecting" | "online" | "offline";

interface NotificationsContextType {
  items: AppNotification[];
  unread: number;
  status: StreamStatus;
  desktopPermission: NotificationPermission | "unsupported";
  soundEnabled: boolean;
  soundReady: boolean;
  requestDesktopNotifications: () => Promise<void>;
  toggleNotificationSound: () => Promise<void>;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

const NotificationsContext =
  React.createContext<NotificationsContextType | null>(null);

const STREAM_URL = `${import.meta.env.VITE_API_BASE_URL || "/api/v1"}/sse/notifications`;

interface SyncEvent {
  task_id?: string;
  mode?: string;
  trigger?: string;
  status?: string;
  stage?: string;
  phase?: string;
  completed?: number;
  processed?: number;
  total?: number;
  created?: number;
  updated?: number;
  disabled?: number;
  failed?: number;
  message_code?: string;
}

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [items, setItems] = React.useState<AppNotification[]>([]);
  const [status, setStatus] = React.useState<StreamStatus>("offline");
  const [desktopPermission, setDesktopPermission] = React.useState<
    NotificationPermission | "unsupported"
  >(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported",
  );
  const [soundEnabled, setSoundEnabled] = React.useState(() => {
    try {
      return (
        window.localStorage.getItem("infranexus:notification-sound") ===
        "enabled"
      );
    } catch {
      return false;
    }
  });
  const [soundReady, setSoundReady] = React.useState(false);
  const identityRef = React.useRef(userId);
  const identityGenerationRef = React.useRef(0);
  const soundEnabledRef = React.useRef(soundEnabled);
  const audioContextRef = React.useRef<AudioContext | null>(null);
  identityRef.current = userId;
  soundEnabledRef.current = soundEnabled;

  const announce = React.useCallback(
    (
      notification: Pick<AppNotification, "title" | "description" | "taskId">,
    ) => {
      if (typeof window === "undefined") return;
      if (
        "Notification" in window &&
        window.Notification.permission === "granted"
      ) {
        try {
          new window.Notification(notification.title, {
            body: notification.description,
            tag: notification.taskId,
          });
        } catch {
          // Desktop notifications can be unavailable in private or restricted browser contexts.
        }
      }
      const audio = audioContextRef.current;
      if (!soundEnabledRef.current || !audio || audio.state !== "running")
        return;
      try {
        const oscillator = audio.createOscillator();
        const volume = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(740, audio.currentTime);
        volume.gain.setValueAtTime(0.0001, audio.currentTime);
        volume.gain.exponentialRampToValueAtTime(
          0.035,
          audio.currentTime + 0.015,
        );
        volume.gain.exponentialRampToValueAtTime(
          0.0001,
          audio.currentTime + 0.12,
        );
        oscillator.connect(volume);
        volume.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.13);
      } catch {
        // Audio feedback is optional; notification delivery must not depend on it.
      }
    },
    [],
  );

  const requestDesktopNotifications = React.useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setDesktopPermission("unsupported");
      return;
    }
    try {
      setDesktopPermission(await window.Notification.requestPermission());
    } catch {
      setDesktopPermission(window.Notification.permission);
    }
  }, []);

  const toggleNotificationSound = React.useCallback(async () => {
    if (typeof window === "undefined" || !("AudioContext" in window)) return;
    if (soundEnabledRef.current && soundReady) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      setSoundReady(false);
      try {
        window.localStorage.removeItem("infranexus:notification-sound");
      } catch {
        /* Preference storage is optional. */
      }
      return;
    }
    try {
      const audio = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = audio;
      await audio.resume();
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      setSoundReady(true);
      try {
        window.localStorage.setItem("infranexus:notification-sound", "enabled");
      } catch {
        /* Preference storage is optional. */
      }
    } catch {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      setSoundReady(false);
    }
  }, [soundReady]);

  const push = React.useCallback(
    (n: Omit<AppNotification, "id" | "time" | "read">) => {
      announce(n);
      setItems((prev) =>
        [
          { ...n, id: crypto.randomUUID(), time: Date.now(), read: false },
          ...prev,
        ].slice(0, 30),
      );
    },
    [announce],
  );

  React.useEffect(() => {
    setItems([]);
    if (!userId) {
      setStatus("offline");
      return;
    }
    const ownerId = userId;
    const ownerGeneration = ++identityGenerationRef.current;
    const isCurrentIdentity = () =>
      identityRef.current === ownerId &&
      identityGenerationRef.current === ownerGeneration;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    let lastEventId = "";
    let connectionDropped = false;
    let disposed = false;

    const invalidateWorkspace = () => {
      for (const queryKey of [
        ["ldap"],
        ["users"],
        ["departments"],
        ["options"],
        ["dashboard"],
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    };

    const rememberEvent = (event: Event) => {
      const id = (event as MessageEvent).lastEventId;
      if (id) lastEventId = id;
    };

    setStatus("connecting");
    const parse = (event: MessageEvent) => {
      try {
        return JSON.parse(event.data) as SyncEvent;
      } catch {
        return undefined;
      }
    };

    const connect = () => {
      if (!isCurrentIdentity() || disposed) return;
      const url = new URL(STREAM_URL, window.location.href);
      if (lastEventId) url.searchParams.set("lastEventId", lastEventId);
      const activeSource = new EventSource(url.toString(), {
        withCredentials: true,
      });
      source = activeSource;
      activeSource.addEventListener("connected", () => {
        if (!isCurrentIdentity()) return;
        if (connectionDropped) {
          push({
            title: "实时通道已恢复",
            description: "后台事件连接已恢复，工作台正在保持实时更新。",
            tone: "success",
          });
          connectionDropped = false;
        }
        retryAttempt = 0;
        setStatus("online");
      });
      activeSource.addEventListener("snapshot.required", (event) => {
        if (!isCurrentIdentity()) return;
        rememberEvent(event);
        invalidateWorkspace();
        push({
          title: "实时数据已重新校准",
          description: "连接期间有事件未送达，已刷新工作台数据。",
          tone: "info",
        });
      });
      activeSource.addEventListener("auth.expired", () => {
        if (!isCurrentIdentity()) return;
        activeSource.close();
        source = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = undefined;
        setStatus("offline");
      });
      activeSource.addEventListener("ldap.sync.started", (event) => {
        if (!isCurrentIdentity()) return;
        rememberEvent(event);
        const data = parse(event as MessageEvent);
        if (!data) return;
        push({
          title: "目录同步已开始",
          description: `${data.mode === "incremental" ? "增量" : "全量"}同步（${data.trigger === "schedule" ? "定时触发" : "手动触发"}），正在读取目录并生成计划…`,
          tone: "info",
          taskId: data.task_id,
        });
      });
      activeSource.addEventListener("ldap.sync.progress", (event) => {
        if (!isCurrentIdentity()) return;
        rememberEvent(event);
        const data = parse(event as MessageEvent);
        if (!data?.task_id) return;
        const processed = data.processed ?? data.completed ?? 0;
        const progress = data.total
          ? Math.min(100, Math.floor((processed / data.total) * 100))
          : undefined;
        const stage =
          data.phase === "finalizing" || data.stage === "completed"
            ? "同步收尾中"
            : data.phase === "preparing"
              ? "正在准备任务"
              : data.phase === "planning"
                ? "正在校验计划"
                : "正在应用变更";
        setItems((prev) =>
          prev.map((item) =>
            item.taskId === data.task_id
              ? {
                  ...item,
                  progress,
                  description:
                    progress === undefined
                      ? stage
                      : `${stage} · ${processed} / ${data.total}（${progress}%）`,
                }
              : item,
          ),
        );
        void queryClient.invalidateQueries({ queryKey: ["ldap"] });
      });
      activeSource.addEventListener("ldap.sync.finished", (event) => {
        if (!isCurrentIdentity()) return;
        rememberEvent(event);
        const data = parse(event as MessageEvent);
        if (!data) return;
        const summary = `新增 ${data.created ?? 0} · 更新 ${data.updated ?? 0} · 停用 ${data.disabled ?? 0} · 失败 ${data.failed ?? 0}`;
        const tone: NotificationTone =
          data.status === "success"
            ? "success"
            : data.status === "partial"
              ? "warning"
              : "error";
        const title =
          data.status === "failed" ? "目录同步失败" : "目录同步完成";
        const description =
          data.status === "failed" && data.message_code
            ? `${summary} · 错误代码 ${data.message_code}`
            : summary;
        const finishedNotification: Omit<
          AppNotification,
          "id" | "time" | "read"
        > = {
          title,
          description,
          tone,
          taskId: data.task_id,
          progress: 100,
        };
        announce(finishedNotification);
        setItems((prev) => {
          const existing = data.task_id
            ? prev.find((item) => item.taskId === data.task_id)
            : undefined;
          if (!existing)
            return [
              {
                ...finishedNotification,
                id: crypto.randomUUID(),
                time: Date.now(),
                read: false,
              },
              ...prev,
            ].slice(0, 30);
          return prev.map((item) =>
            data.task_id && item.taskId === data.task_id
              ? {
                  ...item,
                  ...finishedNotification,
                  time: Date.now(),
                  read: false,
                }
              : item,
          );
        });
        if (tone === "error") notify.error(title, description);
        else if (tone === "warning") notify.warning(title, summary);
        else notify.success(title, summary);
        invalidateWorkspace();
      });
      activeSource.onopen = () => {
        if (isCurrentIdentity()) setStatus("online");
      };
      activeSource.onerror = () => {
        if (!isCurrentIdentity()) return;
        connectionDropped = true;
        setStatus("connecting");
        activeSource.close();
        if (source === activeSource) source = null;
        if (retryTimer) clearTimeout(retryTimer);
        const ceiling = Math.min(30_000, 500 * 2 ** Math.min(retryAttempt, 6));
        const delay = Math.round(ceiling * (0.8 + Math.random() * 0.4));
        retryAttempt += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, [userId, push, announce, queryClient]);

  const value = React.useMemo<NotificationsContextType>(
    () => ({
      items,
      unread: items.filter((n) => !n.read).length,
      status,
      desktopPermission,
      soundEnabled,
      soundReady,
      requestDesktopNotifications,
      toggleNotificationSound,
      markRead: (id) =>
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
        ),
      markAllRead: () =>
        setItems((prev) => prev.map((n) => ({ ...n, read: true }))),
      clear: () => setItems([]),
    }),
    [
      items,
      status,
      desktopPermission,
      soundEnabled,
      soundReady,
      requestDesktopNotifications,
      toggleNotificationSound,
    ],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx)
    throw new Error(
      "useNotifications must be used within NotificationsProvider",
    );
  return ctx;
}
