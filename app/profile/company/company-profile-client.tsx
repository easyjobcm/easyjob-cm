"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Briefcase, Edit2, Star } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfileAvatar3D } from "@/components/profile/profile-avatar-3d";
import { ProfileCompletionRing } from "@/components/profile/profile-completion-ring";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { type Criterion } from "@/lib/utils/profile-completion";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "next/navigation";

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
        x: [0, 18, -12, 0],
        y: [0, -12, 8, 0],
        scale: [1, 1.08, 0.96, 1],
        opacity: [0.3, 0.5, 0.3, 0.3],
      }}
      transition={{
        duration: 9 + delay * 2,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

export function CompanyProfileClient({
  user,
  profile,
  completionPct,
  criteria,
  totalMissionsPosted,
}: CompanyProfileClientProps) {
  const { t } = useI18n();
  const router = useRouter();

  const displayName = profile?.company_name || user.phone || "—";
  const initial = profile?.company_name?.[0] || user.phone?.[0] || "E";
  const contactInfo = user.phone || user.email || "";
  const averageRating = profile?.average_rating ?? 0;
  const starsCount = Math.min(5, Math.round(averageRating));

  const stats = [
    {
      value: totalMissionsPosted,
      label: t.profile.missionsPosted,
      color: "#7C3AED",
    },
    {
      value: averageRating > 0 ? averageRating.toFixed(1) : "0.0",
      label: t.profile.statScore,
      color: "#22C55E",
    },
  ];

  return (
    <AppShell hideNav>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        {/* ── HERO ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden pb-10 pt-safe-top">
          {/* Gradient — shifted toward teal for companies */}
          <div className="absolute inset-0 bg-linear-to-br from-[#0F172A] via-[#1E1B4B] to-[#5B21B6]" />

          {/* Floating orbs */}
          <HeroOrb size={200} color="#818CF855" x="-15%" y="-25%" delay={0} />
          <HeroOrb size={110} color="#6D28D966" x="65%" y="5%" delay={2} />
          <HeroOrb size={80} color="#A5B4FC44" x="25%" y="55%" delay={4} />

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
              <Link href="/profile/company/edit">
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
            <ProfileAvatar3D initial={initial} sandboxBadge={null} size={100} />

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
                  onCta={() => router.push("/onboarding/company")}
                />
              </CardContent>
            </Card>
          </motion.div>

          {/* Infos entreprise */}
          {(profile?.sector || profile?.city) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="space-y-3"
            >
              {profile?.sector && (
                <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5B21B6]/10 dark:bg-[#5B21B6]/20">
                        <Briefcase className="h-5 w-5 text-[#5B21B6] dark:text-[#A78BFA]" />
                      </div>
                      <div>
                        <Badge
                          variant="secondary"
                          className="dark:bg-[#7C3AED]/20 dark:text-[#C4B5FD]"
                        >
                          {profile.sector}
                        </Badge>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t.profile.sectorLabel}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {profile?.city && (
                <Card className="border border-[#E5E7EB] dark:border-white/10 dark:bg-[#1A0F2E]">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#7C3AED]/10 dark:bg-[#7C3AED]/20">
                        <MapPin className="h-5 w-5 text-[#7C3AED]" />
                      </div>
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
      </div>
    </AppShell>
  );
}
