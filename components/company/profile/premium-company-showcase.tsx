"use client";

import * as React from "react";
import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import Link from "next/link";
import {
  Shield,
  Sparkles,
  Star,
  BarChart3,
  HeadphonesIcon,
  Palette,
  Users,
  Settings2,
  Crown,
  Building2,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  type CompanyPlan,
  type PlanLimits,
  formatDateShort,
} from "@/lib/utils/profile-status";

interface PremiumCompanyShowcaseProps {
  plan: CompanyPlan;
  limits: PlanLimits;
  expiresAt: string | null;
  locale?: "fr" | "en";
}

// ── Carte 3D centrale (couronne animée selon plan) ───────────
function HeroTrophy({ plan, accent }: { plan: CompanyPlan; accent: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 120, damping: 18 });
  const sy = useSpring(y, { stiffness: 120, damping: 18 });
  const rotateX = useTransform(sy, [-0.5, 0.5], [12, -12]);
  const rotateY = useTransform(sx, [-0.5, 0.5], [-15, 15]);

  const Icon: LucideIcon =
    plan === "business" ? Crown : plan === "pro" ? Sparkles : Rocket;

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    x.set((e.clientX - r.left) / r.width - 0.5);
    y.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <div
      ref={ref}
      onPointerMove={handleMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
      className="relative mx-auto mb-5 h-28 w-28"
      style={{ perspective: 800 }}
    >
      {/* Halo pulsant */}
      <motion.div
        aria-hidden
        className="absolute inset-[-20%] rounded-full blur-3xl"
        style={{ background: `${accent}66` }}
        animate={{ opacity: [0.5, 0.85, 0.5], scale: [1, 1.12, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Carte 3D */}
      <motion.div
        className="relative flex h-full w-full items-center justify-center rounded-3xl"
        style={{
          background: `linear-gradient(135deg, ${accent}EE 0%, ${accent}AA 60%, ${accent}88 100%)`,
          boxShadow: `0 16px 40px ${accent}66, inset 0 1px 0 rgba(255,255,255,0.35)`,
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
      >
        {/* Sheen balayage */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{
            background:
              "linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
            mixBlendMode: "overlay",
          }}
          animate={{ x: ["-120%", "120%"] }}
          transition={{
            duration: 2.8,
            repeat: Infinity,
            repeatDelay: 2,
            ease: "easeInOut",
          }}
        />
        {/* Particules */}
        {Array.from({ length: 6 }).map((_, i) => (
          <motion.div
            key={i}
            aria-hidden
            className="absolute h-1 w-1 rounded-full bg-white"
            style={{
              top: `${20 + ((i * 13) % 60)}%`,
              left: `${15 + ((i * 17) % 70)}%`,
            }}
            animate={{
              y: [0, -8, 0],
              opacity: [0, 0.9, 0],
            }}
            transition={{
              duration: 2.5 + i * 0.2,
              repeat: Infinity,
              delay: i * 0.35,
              ease: "easeInOut",
            }}
          />
        ))}
        <Icon
          className="relative z-10 h-12 w-12 text-white drop-shadow-lg"
          style={{ transform: "translateZ(20px)" }}
        />
      </motion.div>
    </div>
  );
}

// ── Liste des piliers selon plan ─────────────────────────────
type PillarKey =
  | "control"
  | "security"
  | "aiTalent"
  | "priorityPool"
  | "reporting"
  | "accountManager"
  | "branding"
  | "team";

const PILLAR_ICONS: Record<PillarKey, LucideIcon> = {
  control: Settings2,
  security: Shield,
  aiTalent: Sparkles,
  priorityPool: Star,
  reporting: BarChart3,
  accountManager: HeadphonesIcon,
  branding: Palette,
  team: Users,
};

function pillarsForPlan(plan: CompanyPlan): PillarKey[] {
  switch (plan) {
    case "starter":
      return ["control", "security", "priorityPool"];
    case "pro":
      return ["control", "security", "priorityPool", "aiTalent", "reporting"];
    case "business":
      return [
        "control",
        "security",
        "priorityPool",
        "aiTalent",
        "reporting",
        "accountManager",
        "branding",
        "team",
      ];
    default:
      return [];
  }
}

export function PremiumCompanyShowcase({
  plan,
  limits,
  expiresAt,
  locale = "fr",
}: PremiumCompanyShowcaseProps) {
  const { t } = useI18n();
  const tr = t.profile.premiumCompany;
  const planTr = t.profile.plan;

  const headline =
    plan === "business"
      ? tr.headlineBusiness
      : plan === "pro"
        ? tr.headlinePro
        : tr.headlineStarter;
  const tagline =
    plan === "business"
      ? tr.taglineBusiness
      : plan === "pro"
        ? tr.taglinePro
        : tr.taglineStarter;

  const pillars = pillarsForPlan(plan);
  const accent = limits.accent;

  const metrics =
    plan === "business"
      ? [tr.metrics.timeToHire, tr.metrics.compliance, tr.metrics.retention]
      : plan === "pro"
        ? [tr.metrics.timeToHire, tr.metrics.retention]
        : [tr.metrics.timeToHire];

  // CTA d'évolution selon plan actuel
  const nextPlan: CompanyPlan | null =
    plan === "starter" ? "pro" : plan === "pro" ? "business" : null;
  const nextPlanLabel = nextPlan
    ? nextPlan === "pro"
      ? planTr.pro
      : planTr.business
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, type: "spring", stiffness: 220, damping: 26 }}
      className="relative overflow-hidden rounded-3xl border bg-linear-to-br p-6 shadow-xl"
      style={{
        borderColor: `${accent}33`,
        backgroundImage: `linear-gradient(135deg, ${accent}10 0%, ${accent}05 50%, transparent 100%)`,
        boxShadow: `0 20px 50px ${accent}22, inset 0 1px 0 rgba(255,255,255,0.4)`,
      }}
    >
      {/* Décor : losanges flottants en arrière-plan */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{
              top: `${10 + i * 22}%`,
              left: `${5 + i * 24}%`,
              width: 8,
              height: 8,
              background: accent,
              opacity: 0.12,
              transform: "rotate(45deg)",
            }}
            animate={{
              y: [0, -10, 0],
              opacity: [0.08, 0.2, 0.08],
            }}
            transition={{
              duration: 4 + i,
              delay: i * 0.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* En-tête */}
      <div className="relative z-10">
        <div className="mb-1 flex items-center justify-between gap-3">
          <p
            className="text-[11px] font-bold uppercase tracking-[1.6px]"
            style={{ color: accent }}
          >
            {tr.sectionLabel}
          </p>
          {expiresAt && (
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: `${accent}1A`, color: accent }}
            >
              {planTr.expiresOn.replace(
                "{date}",
                formatDateShort(expiresAt, locale),
              )}
            </span>
          )}
        </div>

        {/* Trophée 3D */}
        <HeroTrophy plan={plan} accent={accent} />

        {/* Headline */}
        <h2 className="text-center text-2xl font-extrabold leading-tight text-foreground">
          {headline}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
          {tagline}
        </p>

        {/* Métriques chiffrées (preuve sociale quantitative) */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mt-5 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${metrics.length}, 1fr)` }}
        >
          {metrics.map((m, i) => (
            <div
              key={i}
              className="flex flex-col items-center rounded-2xl bg-white/70 py-3 backdrop-blur-sm dark:bg-white/5"
            >
              <span
                className="text-xl font-extrabold"
                style={{ color: accent, textShadow: `0 0 14px ${accent}55` }}
              >
                {m.value}
              </span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {m.label}
              </span>
            </div>
          ))}
        </motion.div>

        {/* Piliers de valeur */}
        <div className="mt-6 space-y-2.5">
          {pillars.map((key, i) => {
            const Icon = PILLAR_ICONS[key];
            const p = tr.pillars[key];
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.06 }}
                className="flex items-start gap-3 rounded-2xl bg-white/60 p-3 backdrop-blur-sm dark:bg-white/5"
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${accent}1F` }}
                >
                  <Icon className="h-5 w-5" style={{ color: accent }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{p.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {p.desc}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Account manager card pour Business */}
        {limits.prioritySupport && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-4 flex items-center gap-3 overflow-hidden rounded-2xl p-3"
            style={{
              background: `linear-gradient(135deg, ${accent}DD 0%, ${accent}AA 100%)`,
              boxShadow: `0 8px 24px ${accent}55`,
            }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/25">
              <HeadphonesIcon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-white/90">
                {planTr.prioritySupport}
              </p>
              <p className="text-[11px] text-white/80">
                {tr.pillars.accountManager.desc}
              </p>
            </div>
          </motion.div>
        )}

        {/* Social proof */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-5 text-center text-[11px] font-medium"
          style={{ color: accent }}
        >
          <Building2 className="mr-1 inline h-3 w-3" />
          {tr.socialProof}
        </motion.p>

        {/* CTA : upgrade vers plan supérieur, ou gérer abonnement */}
        <div className="mt-4 flex flex-col gap-2">
          {nextPlan && nextPlanLabel && (
            <Link href="/upgrade/company" className="block">
              <motion.div
                whileTap={{ scale: 0.98 }}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full font-bold text-white shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${accent} 0%, ${accent}CC 100%)`,
                  boxShadow: `0 8px 20px ${accent}66`,
                }}
              >
                <Sparkles className="h-4 w-4" />
                <span>{tr.upgradePlan.replace("{plan}", nextPlanLabel)}</span>
              </motion.div>
            </Link>
          )}
          <Link href="/profile/company/subscription" className="block">
            <motion.div
              whileTap={{ scale: 0.98 }}
              className="flex h-11 w-full items-center justify-center rounded-full border bg-white/70 text-sm font-semibold backdrop-blur-sm dark:bg-white/5"
              style={{ borderColor: `${accent}40`, color: accent }}
            >
              {tr.manageButton}
            </motion.div>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}
