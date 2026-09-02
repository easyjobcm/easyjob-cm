"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { useI18n } from "@/lib/i18n";
import { ChevronLeft, Lock } from "lucide-react";

export default function PrivacyPage() {
  const router = useRouter();
  const { t } = useI18n();
  const tp = t.profile.privacyPage;

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
          <h1 className="text-lg font-semibold text-foreground">{tp.title}</h1>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 pb-10 pt-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">{tp.pending}</p>
        </div>
      </div>
    </AppShell>
  );
}
