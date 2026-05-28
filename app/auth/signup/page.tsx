"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Briefcase, Building2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { HeroIllustration } from "@/components/auth/hero-illustration";

export default function SignupChoosePage() {
  const { t } = useI18n();

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAFAFA]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#7C3AED]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#F472B6]/10 blur-3xl"
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 pt-10 pb-8">
        <Link
          href="/"
          className="text-sm font-semibold text-[#7C3AED] transition-opacity hover:opacity-80"
        >
          ← EasyJob
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-8 text-center"
        >
          <h1 className="text-3xl font-bold text-[#1A0A2E] sm:text-4xl">
            {t.signup.chooseRole.title}
          </h1>
          <p className="mt-3 text-base text-gray-600">
            {t.signup.chooseRole.subtitle}
          </p>
        </motion.div>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RoleCard
            href="/auth/signup/candidate"
            title={t.signup.chooseRole.candidateTitle}
            description={t.signup.chooseRole.candidateDesc}
            icon={<Briefcase className="h-6 w-6" />}
            variant="candidate"
            delay={0.1}
          />
          <RoleCard
            href="/auth/signup/company"
            title={t.signup.chooseRole.companyTitle}
            description={t.signup.chooseRole.companyDesc}
            icon={<Building2 className="h-6 w-6" />}
            variant="company"
            delay={0.2}
          />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-auto pt-10 text-center text-sm text-gray-600"
        >
          {t.signup.chooseRole.alreadyAccount}{" "}
          <Link
            href="/auth/login"
            className="font-semibold text-[#5B21B6] hover:underline"
          >
            {t.auth.signIn}
          </Link>
        </motion.div>
      </main>
    </div>
  );
}

interface RoleCardProps {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  variant: "candidate" | "company";
  delay: number;
}

function RoleCard({
  href,
  title,
  description,
  icon,
  variant,
  delay,
}: RoleCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
    >
      <Link
        href={href}
        className="group relative block overflow-hidden rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-[#7C3AED] hover:shadow-lg"
      >
        {/* Mini illustration qui dépasse en haut-droite */}
        <div className="pointer-events-none absolute -top-6 -right-6 h-32 w-32 opacity-90">
          <HeroIllustration variant={variant} className="h-full w-full" />
        </div>

        <div className="relative">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F3E8FF] text-[#5B21B6]">
            {icon}
          </div>
          <h2 className="mt-12 text-lg font-bold text-[#1A0A2E]">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">{description}</p>
          <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#7C3AED] transition-transform group-hover:translate-x-1">
            {variant === "candidate" ? "Commencer" : "Recruter"}
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
