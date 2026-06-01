"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfilePageHeader } from "@/components/profile/profile-page-header";
import { ProfileCompletionWidget } from "@/components/profile/profile-completion-widget";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { SANDBOX_LEVELS, type Criterion } from "@/lib/utils/profile-completion";
import { useI18n } from "@/lib/i18n";

interface CandidateProfileClientProps {
  user: {
    role: string;
    phone?: string | null;
    email?: string | null;
  };
  profile: {
    first_name?: string | null;
    last_name?: string | null;
    average_rating?: number | null;
    city?: string | null;
    quartier?: string | null;
  } | null;
  skills: Array<{ id: string; skill_name: string }>;
  completionPct: number;
  sandboxLevel: number;
  criteria: Criterion[];
  totalMissions: number;
}

export function CandidateProfileClient({
  user,
  profile,
  skills,
  completionPct,
  sandboxLevel,
  criteria,
  totalMissions,
}: CandidateProfileClientProps) {
  const { t } = useI18n();

  const currentLevelConfig = SANDBOX_LEVELS[Math.min(sandboxLevel, 3)];
  const sandboxNames = t.profile.completion.sandbox;
  const levelNameMap: Record<string, string> = {
    level0: sandboxNames.level0,
    level1: sandboxNames.level1,
    level2: sandboxNames.level2,
    level3: sandboxNames.level3,
  };
  const sandboxBadge = {
    icon: currentLevelConfig.icon,
    label: levelNameMap[currentLevelConfig.nameKey],
    color: currentLevelConfig.color,
  };

  const displayName =
    `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
    user.phone ||
    "—";
  const initial = profile?.first_name?.[0] || user.phone?.[0] || "U";
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
          totalMissions={totalMissions}
          missionsLabel={t.profile.missionsCompleted}
          sandboxBadge={sandboxBadge}
          editHref="/profile/candidate/edit"
        />

        {/* Complétion */}
        <ProfileCompletionWidget
          role={user.role}
          completionPct={completionPct}
          criteria={criteria}
          sandboxLevel={sandboxLevel}
        />

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-3 gap-3"
        >
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-primary">{totalMissions}</p>
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
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-foreground">
                {skills.length}
              </p>
              <p className="text-xs text-muted-foreground">
                {t.profile.statSkills}
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Compétences */}
        {skills.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-3 font-medium text-foreground">
                  {t.profile.mySkills}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {skills.map((skill) => (
                    <Badge key={skill.id} variant="secondary">
                      {skill.skill_name}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Localisation */}
        {(profile?.city || profile?.quartier) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">
                      {profile.quartier ? `${profile.quartier}, ` : ""}
                      {profile.city}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t.profile.locationLabel}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Menu */}
        <ProfileMenu isCandidate />
      </div>
    </AppShell>
  );
}
