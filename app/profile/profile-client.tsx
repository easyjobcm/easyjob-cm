"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AppShell } from "@/components/layout/app-shell";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfileCompletionWidget } from "@/components/profile/profile-completion-widget";
import {
  SANDBOX_LEVELS,
  type Criterion,
  type SandboxLevelConfig,
} from "@/lib/utils/profile-completion";
import {
  MapPin,
  Star,
  Clock,
  ChevronRight,
  Edit2,
  CreditCard,
  Bell,
  Shield,
  LogOut,
  HelpCircle,
  FileText,
} from "lucide-react";

interface ProfileClientProps {
  user: {
    role: string;
    phone?: string | null;
    email?: string | null;
  };
  profile: {
    first_name?: string;
    last_name?: string;
    company_name?: string;
    average_rating?: number;
    city?: string;
    quartier?: string;
  } | null;
  totalMissions: number;
  skills: Array<{
    id: string;
    skill_name: string;
  }>;
  completionPct: number;
  sandboxLevel: number;
  criteria: Criterion[];
}

export function ProfileClient({
  user,
  profile,
  skills,
  completionPct,
  sandboxLevel,
  criteria,
  totalMissions,
}: ProfileClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = createClient();
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const reliabilityScore = profile?.average_rating ?? 0;

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const isCandidate =
    user.role === "candidate" || user.role === "candidate_premium";

  const currentLevelConfig: SandboxLevelConfig =
    SANDBOX_LEVELS[Math.min(sandboxLevel, 3)];
  const starsCount = Math.min(5, Math.round(reliabilityScore));
  const sandboxNames = t.profile.completion.sandbox;
  const levelNameMap: Record<
    "level0" | "level1" | "level2" | "level3",
    string
  > = {
    level0: sandboxNames.level0,
    level1: sandboxNames.level1,
    level2: sandboxNames.level2,
    level3: sandboxNames.level3,
  };
  const levelName = levelNameMap[currentLevelConfig.nameKey];

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

      <div className="px-4 py-6 space-y-6">
        {/* Profile Header */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <div
              className="w-20 h-20 rounded-2xl bg-linear-to-br from-primary to-primary/60 flex items-center justify-center text-white text-2xl font-bold"
              style={{
                boxShadow: isCandidate
                  ? `0 8px 24px ${currentLevelConfig.color}40, 0 3px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)`
                  : "0 4px 16px rgba(0,0,0,0.12)",
              }}
            >
              {profile?.first_name?.[0] ||
                profile?.company_name?.[0] ||
                user.phone?.[0] ||
                "U"}
            </div>
            {isCandidate && (
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  delay: 0.4,
                  type: "spring",
                  stiffness: 400,
                  damping: 15,
                }}
                className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1"
                style={{
                  background: `linear-gradient(135deg, ${currentLevelConfig.color}cc 0%, ${currentLevelConfig.color} 100%)`,
                  boxShadow: `0 6px 16px ${currentLevelConfig.color}55, 0 2px 6px ${currentLevelConfig.color}35, inset 0 1px 0 rgba(255,255,255,0.22)`,
                }}
              >
                <span className="text-[11px] leading-none">
                  {currentLevelConfig.icon}
                </span>
                <span className="text-[10px] font-bold tracking-wide text-white">
                  {levelName}
                </span>
              </motion.div>
            )}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">
              {isCandidate
                ? `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
                  user.phone
                : profile?.company_name || user.phone}
            </h1>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="mt-1 mb-0.5 flex items-center gap-1.5"
            >
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => {
                  const filled = i < starsCount;
                  return (
                    <motion.div
                      key={i}
                      className="inline-flex"
                      initial={{ scale: 0, rotate: -20 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{
                        delay: 0.35 + i * 0.09,
                        type: "spring",
                        stiffness: 500,
                        damping: 18,
                      }}
                    >
                      <Star
                        className="h-4 w-4"
                        style={{
                          color: filled ? "#EAB308" : "#D1D5DB",
                          fill: filled ? "#EAB308" : "none",
                          filter: filled
                            ? "drop-shadow(0 1px 4px #EAB30875)"
                            : "none",
                        }}
                      />
                    </motion.div>
                  );
                })}
              </div>
              {reliabilityScore > 0 && (
                <span className="text-[11px] font-medium text-muted-foreground">
                  {reliabilityScore.toFixed(1)}
                </span>
              )}
              {totalMissions > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  · {totalMissions}{" "}
                  {isCandidate
                    ? t.profile.missionsCompleted
                    : t.profile.missionsPosted}
                </span>
              )}
            </motion.div>
            <p className="text-sm text-muted-foreground">
              {user.phone || user.email}
            </p>
          </div>
          <Link href="/profile/edit">
            <Button variant="outline" size="icon">
              <Edit2 className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Profile Completion Widget */}
        <ProfileCompletionWidget
          role={user.role}
          completionPct={completionPct}
          criteria={criteria}
          sandboxLevel={sandboxLevel}
        />

        {/* Quick Stats for Candidates */}
        {isCandidate && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">
                  {totalMissions}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.profile.statMissions}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-success">
                  {profile?.average_rating?.toFixed(1) || "0.0"}
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
          </div>
        )}

        {/* Skills */}
        {isCandidate && skills.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium text-foreground mb-3">
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
        )}

        {/* Location */}
        {(profile?.city || profile?.quartier) && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">
                    {profile.quartier && `${profile.quartier}, `}
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

        {/* Menu Items */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {t.profile.settings}
          </h3>

          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {isCandidate && (
                <Link
                  href="/profile/availability"
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {t.profile.availability}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </Link>
              )}

              <Link
                href="/profile/payment"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {t.profile.mobileMoney}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/profile/notifications"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {t.profile.notifications}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/profile/security"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {t.profile.security}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Support */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {t.profile.support}
          </h3>

          <Card>
            <CardContent className="p-0 divide-y divide-border">
              <Link
                href="/help"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {t.profile.helpCenter}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/terms"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {t.profile.terms}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Logout */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setShowLogoutModal(true)}
        >
          <LogOut className="w-4 h-4 mr-2" />
          {t.profile.logout}
        </Button>

        {/* Version */}
        <p className="text-center text-xs text-muted-foreground">
          EasyJob v1.0.0
        </p>
      </div>

      {/* Logout Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title={t.profile.logoutTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t.profile.logoutDesc}</p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowLogoutModal(false)}
            >
              {t.profile.cancel}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? <LoadingSpinner size="sm" /> : t.profile.logout}
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
