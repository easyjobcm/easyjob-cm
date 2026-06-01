"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Star, Edit2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfileAvatar3D } from "@/components/profile/profile-avatar-3d";
import { ProfileCompletionRing } from "@/components/profile/profile-completion-ring";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { SANDBOX_LEVELS, type Criterion } from "@/lib/utils/profile-completion";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "next/navigation";

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

// Animated floating orb for hero background
function HeroOrb({
  size,
  color,
  x,
  y,
  delay,
}: {
  size: number;
  color: string;
  x: string;
  y: string;
  delay: number;
}) {
  return (
    <motion.div
      className="pointer-events-none absolute rounded-full blur-3xl"
      style={{ width: size, height: size, background: color, left: x, top: y }}
      animate={{
        x: [0, 20, -10, 0],
        y: [0, -15, 10, 0],
        scale: [1, 1.1, 0.95, 1],
        opacity: [0.35, 0.55, 0.35, 0.35],
      }}
      transition={{
        duration: 8 + delay * 2,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

export function CandidateProfileClient({
  user,
  profile,
  skills,
  completionPct,
  sandboxLevel,
  criteria: _criteria,
  totalMissions,
}: CandidateProfileClientProps) {
  const { t } = useI18n();
  const router = useRouter();

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
  const starsCount = Math.min(5, Math.round(averageRating));

  const stats = [
    {
      value: totalMissions,
      label: t.profile.statMissions,
      color: "#7C3AED",
    },
    {
      value: averageRating > 0 ? averageRating.toFixed(1) : "0.0",
      label: t.profile.statScore,
      color: "#22C55E",
    },
    {
      value: skills.length,
      label: t.profile.statSkills,
      color: "#F59E0B",
    },
  ];

  return (
    <AppShell hideNav>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        {/* ── HERO ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden pb-10 pt-safe-top">
          {/* Gradient background */}
          <div className="absolute inset-0 bg-linear-to-br from-[#1A0A2E] via-[#3B0764] to-[#7C3AED]" />

          {/* Floating orbs */}
          <HeroOrb size={180} color="#A78BFA55" x="-10%" y="-20%" delay={0} />
          <HeroOrb size={120} color="#7C3AED66" x="70%" y="10%" delay={1.5} />
          <HeroOrb size={90} color="#C4B5FD44" x="30%" y="60%" delay={3} />

          {/* Top bar */}
          <div className="relative z-10 flex items-center justify-between px-4 pb-2 pt-4">
            <motion.button
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
              onClick={() => router.back()}
              whileTap={{ scale: 0.9 }}
            >
              ←
            </motion.button>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center gap-2"
            >
              <LangSwitch variant="light" />
              <ThemeToggle variant="light" />
              <Link href="/profile/candidate/edit">
                <motion.div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
                  whileTap={{ scale: 0.9 }}
                >
                  <Edit2 className="h-4 w-4" />
                </motion.div>
              </Link>
            </motion.div>
          </div>

          {/* Avatar + name */}
          <div className="relative z-10 flex flex-col items-center gap-6 px-4 pt-4">
            <ProfileAvatar3D
              initial={initial}
              sandboxBadge={sandboxBadge}
              size={100}
            />

            <div className="mt-4 flex flex-col items-center gap-1 text-center">
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-2xl font-bold text-white"
              >
                {displayName}
              </motion.h1>

              {/* Stars */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex items-center gap-1"
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{
                      delay: 0.45 + i * 0.07,
                      type: "spring",
                      stiffness: 500,
                    }}
                  >
                    <Star
                      className="h-4 w-4"
                      style={{
                        color:
                          i < starsCount ? "#EAB308" : "rgba(255,255,255,0.25)",
                        fill: i < starsCount ? "#EAB308" : "none",
                        filter:
                          i < starsCount
                            ? "drop-shadow(0 1px 4px #EAB30880)"
                            : "none",
                      }}
                    />
                  </motion.div>
                ))}
                {averageRating > 0 && (
                  <span className="ml-1 text-sm font-semibold text-white/80">
                    {averageRating.toFixed(1)}
                  </span>
                )}
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-sm text-white/60"
              >
                {contactInfo}
              </motion.p>
            </div>

            {/* Stats bar */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="flex w-full max-w-xs divide-x divide-white/10 overflow-hidden rounded-2xl bg-white/10 backdrop-blur-md"
            >
              {stats.map((stat, i) => (
                <div
                  key={i}
                  className="flex flex-1 flex-col items-center gap-0.5 py-3"
                >
                  <span
                    className="text-xl font-bold text-white"
                    style={{ textShadow: `0 0 12px ${stat.color}99` }}
                  >
                    {stat.value}
                  </span>
                  <span className="text-[10px] text-white/55">
                    {stat.label}
                  </span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>

        {/* ── CONTENT ─────────────────────────────────────────── */}
        <div className="space-y-5 px-4 pb-10 pt-6">
          {/* Completion ring */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Card className="overflow-hidden border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
              <CardContent className="flex flex-col items-center gap-2 p-6">
                <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                  {t.profile.completion.title}
                </p>
                <ProfileCompletionRing
                  pct={completionPct}
                  label={t.profile.completion.progress}
                  ctaLabel={
                    completionPct < 100 ? t.profile.completion.cta : undefined
                  }
                  onCta={() => router.push("/onboarding/candidate")}
                />
                {completionPct < 60 && (
                  <p className="text-center text-xs text-amber-500 dark:text-amber-400">
                    {t.profile.completion.required60}
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Skills */}
          {skills.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
                <CardContent className="p-4">
                  <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                    {t.profile.mySkills}
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill, i) => (
                      <motion.div
                        key={skill.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.25 + i * 0.05 }}
                      >
                        <Badge
                          variant="secondary"
                          className="dark:bg-[#7C3AED]/20 dark:text-[#C4B5FD]"
                        >
                          {skill.skill_name}
                        </Badge>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Location */}
          {(profile?.city || profile?.quartier) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#7C3AED]/10 dark:bg-[#7C3AED]/20">
                      <MapPin className="h-5 w-5 text-[#7C3AED]" />
                    </div>
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
      </div>
    </AppShell>
  );
}
