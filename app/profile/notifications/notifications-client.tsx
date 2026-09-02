"use client";

import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, Info } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

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

export function NotificationsClient() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const tn = t.profile.notificationCenter;

  const { data, error, mutate } = useSWR<{ notifications: NotificationItem[] }>(
    "/api/notifications",
    fetcher,
  );

  const markRead = async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void mutate();
  };

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 pb-4 pt-safe-top dark:border-white/10 dark:bg-[#1A0F2E]">
          <button
            type="button"
            onClick={() => router.push("/profile/candidate")}
            aria-label={t.common.back}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground transition-transform active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-foreground">{tn.title}</h1>
        </div>

        <div className="space-y-3 px-4 pb-10 pt-6">
          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3">
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{tn.channelsNote}</p>
          </div>

          {error && <p className="text-sm text-destructive">{tn.loadError}</p>}
          {data && data.notifications.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tn.empty}
            </p>
          )}
          {data?.notifications.map((n) => (
            <Card
              key={n.id}
              className={
                n.is_read ? undefined : "border-primary/30 bg-primary/5"
              }
            >
              <CardContent
                role="button"
                tabIndex={0}
                onClick={() => !n.is_read && markRead(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !n.is_read) markRead(n.id);
                }}
                className="cursor-pointer p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {n.title}
                  </p>
                  {!n.is_read && (
                    <span
                      aria-hidden
                      className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(n.created_at, locale)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
