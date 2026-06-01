"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

interface WelcomeModalProps {
  open: boolean;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
}

export function WelcomeModal({
  open,
  title,
  subtitle,
  ctaLabel,
  ctaHref,
}: WelcomeModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-100 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
        >
          <motion.div
            initial={{ y: 60, scale: 0.95, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 280 }}
            className="w-full max-w-md rounded-t-[28px] bg-white dark:bg-[#1A0F2E] p-8 text-center shadow-xl sm:rounded-4xl"
            style={{
              paddingBottom: "calc(2rem + env(safe-area-inset-bottom))",
            }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                delay: 0.15,
                type: "spring",
                damping: 14,
                stiffness: 240,
              }}
              className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-[#7C3AED] to-[#5B21B6] shadow-lg"
            >
              <CheckCircle2
                className="h-10 w-10 text-white"
                strokeWidth={2.5}
              />
            </motion.div>

            <h2
              id="welcome-title"
              className="text-2xl font-bold text-[#1A0A2E] dark:text-white"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-white/60">
              {subtitle}
            </p>

            <Link
              href={ctaHref}
              className="mt-6 flex h-14 w-full items-center justify-center rounded-full bg-[#5B21B6] text-base font-semibold text-white shadow-lg shadow-[#7C3AED]/30 transition-transform active:scale-[0.98]"
            >
              {ctaLabel}
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
