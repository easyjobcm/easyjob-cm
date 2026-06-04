"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Briefcase, Edit2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LangSwitch } from "@/components/ui/lang-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ProfileAvatar3D } from "@/components/profile/profile-avatar-3d";
import { ProfileCompletionRing } from "@/components/profile/profile-completion-ring";
import { ProfileMenu } from "@/components/profile/profile-menu";
import { PlanBadge } from "@/components/company/profile/plan-badge";
import { UpgradeBanner } from "@/components/company/profile/upgrade-banner";
import { ActiveJobsCounter } from "@/components/company/profile/active-jobs-counter";
import { PremiumCompanyBenefits } from "@/components/company/profile/premium-company-benefits";
import { StatusPill } from "@/components/candidate/profile/status-pill";
import { type Criterion } from "@/lib/utils/profile-completion";
import { type CompanyPlan, getPlanLimits } from "@/lib/utils/profile-status";
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
    city?: string | null;
    sector?: string | null;
    logo_url?: string | null;
  } | null;
  completionPct: number;
  criteria: Criterion[];
  plan: CompanyPlan;
  activeJobsCount: number;
  subscriptionExpiresAt: string | null;
  hasUsedTrial: boolean;
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
  plan,
  activeJobsCount,
  subscriptionExpiresAt,
  hasUsedTrial,
}: CompanyProfileClientProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  // SRS v1.2 : la source de vérité est company_profiles.subscription_plan, jamais role.
  const isPaidPlan = plan !== "free";
  const premium = isPaidPlan; // alias visuel pour orbes/glow
  const limits = getPlanLimits(plan);

  const displayName = profile?.company_name || user.phone || "—";
  const initial = profile?.company_name?.[0] || user.phone?.[0] || "E";
  const contactInfo = user.phone || user.email || "";

  // Hero gradient aligné palette SRS v1.2
  const heroGradient =
    plan === "business"
      ? "bg-linear-to-br from-[#1F2937] via-[#92400E] to-[#D97706]" // doré
      : plan === "pro"
        ? "bg-linear-to-br from-[#1A0A2E] via-[#3B0764] to-[#7C3AED]" // violet
        : plan === "starter"
          ? "bg-linear-to-br from-[#0F172A] via-[#1E3A8A] to-[#2563EB]" // bleu
          : "bg-linear-to-br from-[#1F2937] via-[#374151] to-[#6B7280]"; // gris (free)

  // Libellé du badge plan
  const planLabel = (() => {
    switch (plan) {
      case "starter":
        return t.profile.plan.starter;
      case "pro":
        return t.profile.plan.pro;
      case "business":
        return t.profile.plan.business;
      case "free":
      default:
        return t.profile.plan.free;
    }
  })();

  // Couleur d'accent alignée sur le plan
  const planAccentColor =
    plan === "business"
      ? "#D97706"
      : plan === "pro"
        ? "#7C3AED"
        : plan === "starter"
          ? "#2563EB"
          : "#6B7280"; // free → gris

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
                color={`${limits.accent}55`}
                x="-15%"
                y="-25%"
                delay={0}
              />
              <HeroOrb
                size={110}
                color={`${limits.accent}66`}
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
                href="/profile/company/edit"
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
                  style={{ background: `${limits.accent}99` }}
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
                  sandboxBadge={null}
                  size={100}
                  accentColor={planAccentColor}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              {plan === "free" ? (
                <StatusPill
                  label={planLabel}
                  Icon={Briefcase}
                  variant="neutral"
                />
              ) : (
                <PlanBadge plan={plan} label={planLabel} />
              )}

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

          {/* Compteur d'offres actives — limites visibles si standard */}
          <ActiveJobsCounter used={activeJobsCount} limit={limits.jobsLimit} />

          {/* Avantages du plan — affichés pour TOUS les plans (free inclus) */}
          <PremiumCompanyBenefits
            plan={plan}
            limits={limits}
            expiresAt={subscriptionExpiresAt}
            locale={locale}
          />

          {/* Bannière upgrade — uniquement free/starter */}
          {plan === "free" || plan === "starter" ? (
            <UpgradeBanner currentPlan={plan} hasUsedTrial={hasUsedTrial} />
          ) : null}

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
