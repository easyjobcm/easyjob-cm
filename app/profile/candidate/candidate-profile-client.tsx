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
import { ProfileCompletionWidget } from "@/components/profile/profile-completion-widget";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { NotificationBell } from "@/components/layout/notification-bell";
import { PremiumBadge } from "@/components/candidate/profile/premium-badge";
import { PremiumBanner } from "@/components/candidate/profile/premium-banner";
import { PremiumBenefits } from "@/components/candidate/profile/premium-benefits";
import { PaymentDelayInfo } from "@/components/candidate/profile/payment-delay-info";
import { SANDBOX_LEVELS, type Criterion } from "@/lib/utils/profile-completion";
import { isCandidatePremium } from "@/lib/utils/profile-status";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "next/navigation";

// Ordre d'affichage lundi→dimanche du résumé de disponibilité ; value =
// day_of_week Postgres (0=dimanche), même convention que /profile/availability.
type WeekDayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
const WEEK_DAY_ORDER: { value: number; key: WeekDayKey }[] = [
  { value: 1, key: "monday" },
  { value: 2, key: "tuesday" },
  { value: 3, key: "wednesday" },
  { value: 4, key: "thursday" },
  { value: 5, key: "friday" },
  { value: 6, key: "saturday" },
  { value: 0, key: "sunday" },
];

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
    premium_until?: string | null;
  } | null;
  skills: Array<{ id: string; skill_name: string }>;
  completionPct: number;
  sandboxLevel: number;
  criteria: Criterion[];
  availableDays: number[];
  totalMissions: number;
}

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
  criteria,
  availableDays,
  totalMissions,
}: CandidateProfileClientProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const premium = isCandidatePremium(user.role);

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
    color: premium ? "#7C3AED" : currentLevelConfig.color,
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
      color: premium ? "#7C3AED" : "#A78BFA",
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

  // Différenciation visuelle Hero selon statut
  const heroGradient = premium
    ? "bg-linear-to-br from-[#1A0A2E] via-[#3B0764] to-[#7C3AED]"
    : "bg-linear-to-br from-[#1F2937] via-[#374151] to-[#4B5563]";

  return (
    <AppShell>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        {/* ── HERO ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden pb-10 pt-safe-top">
          <div className={`absolute inset-0 ${heroGradient}`} />

          {premium ? (
            <>
              <HeroOrb
                size={180}
                color="#A78BFA55"
                x="-10%"
                y="-20%"
                delay={0}
              />
              <HeroOrb
                size={120}
                color="#7C3AED66"
                x="70%"
                y="10%"
                delay={1.5}
              />
              <HeroOrb size={90} color="#C4B5FD55" x="30%" y="60%" delay={3} />
            </>
          ) : (
            <>
              <HeroOrb
                size={160}
                color="#6B728044"
                x="-10%"
                y="-20%"
                delay={0}
              />
              <HeroOrb
                size={100}
                color="#9CA3AF33"
                x="70%"
                y="10%"
                delay={1.5}
              />
            </>
          )}

          {/* Top bar */}
          <div className="relative z-10 flex items-center justify-between px-4 pb-2 pt-4">
            <motion.button
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
              onClick={() => router.back()}
              whileTap={{ scale: 0.9 }}
              aria-label={t.common.back}
            >
              ←
            </motion.button>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center gap-2"
            >
              <NotificationBell className="text-white" />
              <LangSwitch variant="light" />
              <ThemeToggle variant="light" />
              <Link
                href="/profile/candidate/edit"
                aria-label={t.profile.editProfile}
              >
                <motion.div
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
                  whileTap={{ scale: 0.9 }}
                >
                  <Edit2 className="h-4 w-4" />
                </motion.div>
              </Link>
            </motion.div>
          </div>

          {/* Avatar + glow premium */}
          <div className="z-10 flex flex-col items-center gap-6 px-4 pt-4">
            <div className="relative">
              {premium && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute -inset-5 rounded-full blur-2xl"
                  style={{ background: "#7C3AED99" }}
                  animate={{ scale: [1, 1.15, 1], opacity: [0.6, 0.9, 0.6] }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              )}
              <div className="relative">
                <ProfileAvatar3D
                  initial={initial}
                  sandboxBadge={sandboxBadge}
                  size={100}
                />
              </div>
            </div>

            <div className="relative mt-4 flex flex-col items-center gap-2 text-center">
              {/* Pill statut uniquement pour Premium — pour Standard,
                  le badge Sandbox est déjà visible sur l'avatar 3D. */}
              {premium && (
                <PremiumBadge label={t.profile.status.candidatePremium} />
              )}

              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-1 text-2xl font-bold text-white"
              >
                {displayName}
              </motion.h1>

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
            <ProfileCompletionWidget
              role={user.role}
              completionPct={completionPct}
              criteria={criteria}
              sandboxLevel={sandboxLevel}
            />
          </motion.div>

          {/* Disponibilité */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
                    {t.profile.availability}
                  </h3>
                  <Link
                    href="/profile/availability"
                    className="text-xs font-medium text-[#7C3AED]"
                  >
                    {t.profile.availabilityEdit}
                  </Link>
                </div>
                {availableDays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t.profile.availabilityPage.summaryEmpty}
                  </p>
                ) : (
                  <div className="flex gap-1.5">
                    {WEEK_DAY_ORDER.map(({ value, key }) => {
                      const isAvailable = availableDays.includes(value);
                      return (
                        <span
                          key={value}
                          aria-label={t.profile.availabilityPage.days[key]}
                          title={t.profile.availabilityPage.days[key]}
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                            isAvailable
                              ? "bg-[#7C3AED] text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {t.profile.availabilityPage.daysShort[key]}
                        </span>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Skills */}
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
                {skills.length === 0 ? (
                  <Link
                    href="/profile/candidate/edit"
                    className="inline-flex h-10 items-center rounded-full bg-[#7C3AED]/10 px-4 text-sm font-medium text-[#7C3AED]"
                  >
                    {t.profile.edit.addSkills}
                  </Link>
                ) : (
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
                )}
              </CardContent>
            </Card>
          </motion.div>

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

          {/* Délai de paiement (contenu adapté au statut) */}
          <PaymentDelayInfo role={user.role} averageRating={averageRating} />

          {/* Différenciation Premium ↔ Standard */}
          {premium ? (
            <PremiumBenefits
              averageRating={averageRating}
              premiumUntil={profile?.premium_until ?? null}
              locale={locale}
            />
          ) : (
            <PremiumBanner />
          )}

          {/* Menu */}
          <ProfileMenu isCandidate />
        </div>
      </div>
    </AppShell>
  );
}
