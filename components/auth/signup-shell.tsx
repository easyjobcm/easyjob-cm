"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { HeroIllustration } from "./hero-illustration";

interface SignupShellProps {
  variant: "candidate" | "company";
  heroTitle: string;
  heroSubtitle: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
}

/**
 * Layout des wizards d'inscription : illustration 3D + carte formulaire.
 * Mobile : illustration en haut (haute, débordante).
 * Desktop : 2 colonnes (illustration à gauche).
 */
export function SignupShell({
  variant,
  heroTitle,
  heroSubtitle,
  backHref = "/auth/signup",
  backLabel,
  children,
}: SignupShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FAFAFA]">
      {/* Blobs décoratifs en fond */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-[#7C3AED]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 -right-32 h-96 w-96 rounded-full bg-[#F472B6]/10 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-screen w-full max-w-6xl grid-cols-1 lg:grid-cols-2">
        {/* Colonne illustration */}
        <section className="relative flex flex-col justify-between overflow-visible px-6 pt-8 pb-4 lg:px-12 lg:py-16">
          <Link
            href={backHref}
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#5B21B6] transition-colors hover:text-[#7C3AED]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {backLabel ?? "Retour"}
          </Link>

          <div className="relative my-8 h-72 lg:my-0 lg:h-[400px]">
            <HeroIllustration variant={variant} className="h-full w-full" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="max-w-md"
          >
            <h1 className="text-2xl font-bold text-[#1A0A2E] lg:text-3xl">
              {heroTitle}
            </h1>
            <p className="mt-2 text-sm text-gray-600 lg:text-base">
              {heroSubtitle}
            </p>
          </motion.div>
        </section>

        {/* Colonne formulaire */}
        <section className="relative flex items-start justify-center px-4 pb-12 lg:items-center lg:px-12 lg:py-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-md rounded-3xl border border-[#E5E7EB] bg-white p-6 shadow-sm lg:p-8"
          >
            {children}
          </motion.div>
        </section>
      </div>
    </div>
  );
}
