"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Globe, Info } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LangSwitch } from "@/components/ui/lang-switch";
import { useI18n } from "@/lib/i18n";
import packageJson from "@/package.json";

export function SettingsClient() {
  const router = useRouter();
  const { t } = useI18n();
  const ts = t.profile.settingsPage;

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
          <h1 className="text-lg font-semibold text-foreground">{ts.title}</h1>
        </div>

        <div className="space-y-5 px-4 pb-10 pt-6">
          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {ts.languageSection}
            </h3>
            <Card>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {ts.languageHint}
                  </p>
                </div>
                <LangSwitch labelMode="name" variant="light" />
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {ts.systemSection}
            </h3>
            <Card>
              <CardContent className="flex items-center justify-between p-4">
                <span className="text-sm text-foreground">{ts.appVersion}</span>
                <span className="text-sm text-muted-foreground">
                  v{packageJson.version}
                </span>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {ts.contractSection}
            </h3>
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
              <CardContent className="flex items-start gap-3 p-4">
                <Info className="h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-800 dark:text-amber-400">
                  {ts.contractUnavailable}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
              {ts.deleteSection}
            </h3>
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="space-y-3 p-4">
                <p className="text-sm text-foreground">
                  {ts.deleteUnavailable}
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/help">{ts.contactSupport}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
