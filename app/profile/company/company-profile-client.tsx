"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Briefcase, Crown, Edit2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfileAvatar3D } from "@/components/profile/profile-avatar-3d";
import { ProfileCompletionRing } from "@/components/profile/profile-completion-ring";
import { ReputationProgressCard } from "@/components/reputation/reputation-progress-card";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { ActiveJobsCounter } from "@/components/company/profile/active-jobs-counter";
import { CompanyPlanCard } from "@/components/company/profile/company-plan-card";
import { StatusPill } from "@/components/candidate/profile/status-pill";
import { type Criterion } from "@/lib/utils/profile-completion";
import { useI18n } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { useAccountState } from "@/lib/realtime/provider";
import {
  normalizeCompanyPlan,
  type CompanyPlan,
} from "@/lib/utils/company-plan";
import { CompanyVerificationCard } from "@/components/company/company-verification-card";
import type { MyCompanyVerification } from "@/lib/utils/company-verification";

interface CompanyProfileClientProps {
  user: {
    role: string;
    phone?: string | null;
    email?: string | null;
  };
  profile: {
    company_name?: string | null;
    city?: string | null;
    sector?: string | null;
    logo_url?: string | null;
  } | null;
  completionPct: number;
  criteria: Criterion[];
  /** ABO-07 : plan effectif lu dans my_account_state au rendu serveur. */
  plan: CompanyPlan;
  premiumUntil: string | null;
  premiumStartedAt: string | null;
  activeJobsCount: number;
  /** Lot 11 : état du dossier entreprise (revue EasyJob). */
  verification: MyCompanyVerification | null;
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
  criteria: _criteria,
  plan: initialPlan,
  premiumUntil: initialPremiumUntil,
  premiumStartedAt: initialPremiumStartedAt,
  activeJobsCount,
  verification,
}: CompanyProfileClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  // ABO-07 : plan effectif relu en direct (attribution, arrêt, échéance sur
  // l'heure du serveur) ; rendu serveur en attendant. Jamais le rôle.
  const account = useAccountState();
  const company = account?.company ?? null;
  const plan: CompanyPlan = company
    ? normalizeCompanyPlan(company.effective_plan)
    : initialPlan;
  const premiumUntil = company ? company.expires_at : initialPremiumUntil;
  const premiumStartedAt = company
    ? (company.premium_started_at ?? null)
    : initialPremiumStartedAt;
  const premium = plan === "premium";
  const accent = premium ? "#7C3AED" : "#6B7280";

  const displayName = profile?.company_name || user.phone || "—";
  const initial = profile?.company_name?.[0] || user.phone?.[0] || "E";
  const contactInfo = user.phone || user.email || "";

  const heroGradient = premium
    ? "bg-linear-to-br from-[#1A0A2E] via-[#3B0764] to-[#7C3AED]"
    : "bg-linear-to-br from-[#1F2937] via-[#374151] to-[#6B7280]";
  const planLabel = premium
    ? t.profile.companyPlan.premium
    : t.profile.companyPlan.free;

  return (
    <AppShell hideNav>
      <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0D0618]">
        {/* ── HERO ────────────────────────────────────────────── */}
        <div className="relative overflow-hidden pb-10 pt-safe-top">
          <div className={`absolute inset-0 ${heroGradient}`} />

          {premium ? (
            <>
              <HeroOrb
                size={200}
                color={`${accent}55`}
                x="-15%"
                y="-25%"
                delay={0}
              />
              <HeroOrb
                size={110}
                color={`${accent}66`}
                x="65%"
                y="5%"
                delay={2}
              />
              <HeroOrb size={80} color="#A5B4FC44" x="25%" y="55%" delay={4} />
            </>
          ) : (
            <>
              <HeroOrb
                size={180}
                color="#3B82F655"
                x="-15%"
                y="-25%"
                delay={0}
              />
              <HeroOrb size={120} color="#1D4ED844" x="65%" y="5%" delay={2} />
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
              <LangSwitch variant="light" />
              <ThemeToggle variant="light" />
              <Link
                href="/onboarding/company"
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

          {/* Avatar + glow plan */}
          <div className="relative z-10 flex flex-col items-center gap-6 px-4 pt-4">
            <div className="relative">
              {premium && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute -inset-5 rounded-full blur-2xl"
                  style={{ background: `${accent}99` }}
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
                  size={100}
                  accentColor={accent}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <div data-testid="company-plan" data-plan={plan}>
                <StatusPill
                  label={planLabel}
                  Icon={premium ? Crown : Briefcase}
                  variant={premium ? "premium" : "neutral"}
                />
              </div>

              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-1 text-2xl font-bold text-white"
              >
                {displayName}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-sm text-white/60"
              >
                {contactInfo}
              </motion.p>
            </div>
          </div>
        </div>

        {/* ── CONTENT ─────────────────────────────────────────── */}
        <div className="space-y-5 px-4 pb-10 pt-6">
          {verification && <CompanyVerificationCard dossier={verification} />}

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

          {/* Réputation EasyJob (lot 9c), visible par le seul titulaire */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
          >
            <ReputationProgressCard />
          </motion.div>

          {/* Plan effectif (ABO-07) et fonction liée (ABO-08) */}
          <CompanyPlanCard
            plan={plan}
            premiumUntil={premiumUntil}
            premiumStartedAt={premiumStartedAt}
          />

          {/* Offres actives illimitées pour les deux plans (ABO-10) */}
          <ActiveJobsCounter used={activeJobsCount} />

          {/* Infos entreprise */}
          {(profile?.sector || profile?.city) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
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
