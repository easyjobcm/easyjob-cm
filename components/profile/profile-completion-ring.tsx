"use client";

import * as React from "react";
import { motion, useInView } from "framer-motion";

interface ProfileCompletionRingProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function ProfileCompletionRing({
  pct,
  size = 140,
  strokeWidth = 10,
  label,
  ctaLabel,
  onCta,
}: ProfileCompletionRingProps) {
  const ref = React.useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  const clamp = Math.min(100, Math.max(0, pct));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - clamp / 100);

  // Color based on completion
  const color =
    clamp >= 80
      ? "#22C55E"
      : clamp >= 60
        ? "#7C3AED"
        : clamp >= 40
          ? "#F59E0B"
          : "#EF4444";

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          ref={ref}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(-90deg)" }}
        >
          {/* Gradient def */}
          <defs>
            <linearGradient
              id="ring-gradient"
              x1="0%"
              y1="0%"
              x2="100%"
              y2="0%"
            >
              <stop offset="0%" stopColor={color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>

          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-border"
            strokeOpacity={0.2}
          />

          {/* Progress */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="url(#ring-gradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={
              inView
                ? { strokeDashoffset: offset }
                : { strokeDashoffset: circumference }
            }
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.2 }}
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.p
            className="text-3xl font-bold"
            style={{ color }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
          >
            {clamp}%
          </motion.p>
          {label && (
            <p className="mt-0.5 max-w-20 text-center text-[10px] leading-tight text-muted-foreground">
              {label}
            </p>
          )}
        </div>
      </div>

      {ctaLabel && clamp < 100 && (
        <motion.button
          initial={{ opacity: 0, y: 6 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.7 }}
          onClick={onCta}
          className="rounded-full px-5 py-2 text-sm font-semibold text-white"
          style={{
            background: `linear-gradient(135deg, ${color}cc, ${color})`,
            boxShadow: `0 4px 14px ${color}44`,
          }}
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.03 }}
        >
          {ctaLabel}
        </motion.button>
      )}
    </div>
  );
}
