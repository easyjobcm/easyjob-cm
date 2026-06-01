"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MapPin, Briefcase } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfilePageHeader } from "@/components/profile/profile-page-header";
import { ProfileCompletionWidget } from "@/components/profile/profile-completion-widget";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { type Criterion } from "@/lib/utils/profile-completion";
import { useI18n } from "@/lib/i18n";

interface CompanyProfileClientProps {
  user: {
    role: string;
    phone?: string | null;
    email?: string | null;
  };
  profile: {
    company_name?: string | null;
    average_rating?: number | null;
    city?: string | null;
    sector?: string | null;
    logo_url?: string | null;
  } | null;
  completionPct: number;
  criteria: Criterion[];
  totalMissionsPosted: number;
}

export function CompanyProfileClient({
  user,
  profile,
  completionPct,
  criteria,
  totalMissionsPosted,
}: CompanyProfileClientProps) {
  const { t } = useI18n();

  const displayName = profile?.company_name || user.phone || "—";
  const initial = profile?.company_name?.[0] || user.phone?.[0] || "E";
  const contactInfo = user.phone || user.email || "";
  const averageRating = profile?.average_rating ?? 0;

  return (
    <AppShell hideNav>
      <Header
        title={t.profile.myProfile}
        showBack
        rightAction={
          <div className="flex items-center gap-2">
            <LangSwitch variant="light" />
            <ThemeToggle variant="light" />
          </div>
        }
      />

      <div className="space-y-6 px-4 py-6">
        {/* Header */}
        <ProfilePageHeader
          initial={initial}
          displayName={displayName}
          contactInfo={contactInfo}
          averageRating={averageRating}
          totalMissions={totalMissionsPosted}
          missionsLabel={t.profile.missionsPosted}
          editHref="/profile/company/edit"
        />

        {/* Complétion */}
        <ProfileCompletionWidget
          role={user.role}
          completionPct={completionPct}
          criteria={criteria}
        />

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-2 gap-3"
        >
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-primary">
                {totalMissionsPosted}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.statMissions}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-success">
                {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.statScore}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Infos entreprise */}
        {(profile?.city || profile?.sector) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-3"
          >
            {profile?.sector && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Briefcase className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">
                        <Badge variant="secondary">{profile.sector}</Badge>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Secteur d&apos;activité
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {profile?.city && (
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">
                        {profile.city}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t.profile.locationLabel}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </motion.div>
        )}

        {/* Menu */}
        <ProfileMenu isCandidate={false} />
      </div>
    </AppShell>
  );
}
