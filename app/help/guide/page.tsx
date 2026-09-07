"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronDown } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

export default function GuidePage() {
  const router = useRouter();
  const { t } = useI18n();
  const tg = t.profile.guidePage;

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
          <h1 className="text-lg font-semibold text-foreground">{tg.title}</h1>
        </div>

        <div className="space-y-2 px-4 pb-10 pt-6">
          {tg.items.map((item) => (
            <Card key={item.q}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium text-foreground marker:content-none">
                  <span>{item.q}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm text-muted-foreground">
                  {item.a}
                </p>
              </details>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
