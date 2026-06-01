"use client";

import * as React from "react";
import { motion } from "framer-motion";

interface SignupProgressProps {
  steps: readonly string[];
  current: number;
}

export function SignupProgress({ steps, current }: SignupProgressProps) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        {steps.map((_, i) => {
          const reached = i <= current;
          return (
            <div
              key={i}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-white/10"
            >
              <motion.div
                className="absolute inset-y-0 left-0 bg-linear-to-r from-[#7C3AED] to-[#A78BFA]"
                initial={{ width: 0 }}
                animate={{ width: reached ? "100%" : "0%" }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-[#7C3AED] text-[11px] font-semibold uppercase tracking-[1.2px]">
        {steps[current]} · {current + 1}/{steps.length}
      </p>
    </div>
  );
}
