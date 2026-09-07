"use client";

import * as React from "react";
import useSWR from "swr";
import { Bell } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { cn, formatDate } from "@/lib/utils";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("failed");
  return res.json();
};

/**
 * Icône de notification réutilisable pour le header authentifié. Le badge
 * n'affiche qu'un compteur réel (jamais de valeur fictive) et ne s'affiche
 * que si le compteur est supérieur à zéro.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const tn = t.profile.notificationCenter;
  const [open, setOpen] = React.useState(false);

  const { data: countData, mutate: mutateCount } = useSWR<{ count: number }>(
    "/api/notifications/unread-count",
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );
  const unreadCount = countData?.count ?? 0;

  const { data: listData, error: listError } = useSWR<{
    notifications: NotificationItem[];
  }>(open ? "/api/notifications" : null, fetcher);

  const markRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void mutateCount();
  };

  const ariaLabel =
    unreadCount > 0
      ? tn.openLabel.replace("{count}", String(unreadCount))
      : tn.openLabelEmpty;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-current backdrop-blur-sm transition-transform active:scale-95",
          className,
        )}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={tn.title}>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {listError && (
            <p className="text-sm text-destructive">{tn.loadError}</p>
          )}
          {listData && listData.notifications.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tn.empty}
            </p>
          )}
          {listData?.notifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.is_read && markRead(n.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                n.is_read
                  ? "border-border bg-card"
                  : "border-primary/30 bg-primary/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                {!n.is_read && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDate(n.created_at, locale)}
              </p>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
