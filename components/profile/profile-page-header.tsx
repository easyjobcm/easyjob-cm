"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Star, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SandboxBadge {
  icon: string;
  label: string;
  color: string;
}

interface ProfilePageHeaderProps {
  initial: string;
  displayName: string;
  contactInfo: string;
  averageRating?: number;
  totalMissions?: number;
  missionsLabel?: string;
  sandboxBadge?: SandboxBadge | null;
  editHref?: string;
}

export function ProfilePageHeader({
  initial,
  displayName,
  contactInfo,
  averageRating = 0,
  totalMissions,
  missionsLabel,
  sandboxBadge,
  editHref = "/profile/edit",
}: ProfilePageHeaderProps) {
  const starsCount = Math.min(5, Math.round(averageRating));

  return (
    <div className="flex items-center gap-4">
      {/* Avatar */}
      <div className="relative">
        <div
          className="flex h-20 w-20 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-primary/60 text-2xl font-bold text-white"
          style={{
            boxShadow: sandboxBadge
              ? `0 8px 24px ${sandboxBadge.color}40, 0 3px 10px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.18)`
              : "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {initial}
        </div>

        {sandboxBadge && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              delay: 0.4,
              type: "spring",
              stiffness: 400,
              damping: 15,
            }}
            className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1"
            style={{
              background: `linear-gradient(135deg, ${sandboxBadge.color}cc 0%, ${sandboxBadge.color} 100%)`,
              boxShadow: `0 6px 16px ${sandboxBadge.color}55, 0 2px 6px ${sandboxBadge.color}35, inset 0 1px 0 rgba(255,255,255,0.22)`,
            }}
          >
            <span className="text-[11px] leading-none">
              {sandboxBadge.icon}
            </span>
            <span className="text-[10px] font-bold tracking-wide text-white">
              {sandboxBadge.label}
            </span>
          </motion.div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h1 className="text-xl font-bold text-foreground">{displayName}</h1>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="mb-0.5 mt-1 flex items-center gap-1.5"
        >
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => {
              const filled = i < starsCount;
              return (
                <motion.div
                  key={i}
                  className="inline-flex"
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{
                    delay: 0.35 + i * 0.09,
                    type: "spring",
                    stiffness: 500,
                    damping: 18,
                  }}
                >
                  <Star
                    className="h-4 w-4"
                    style={{
                      color: filled ? "#EAB308" : "#D1D5DB",
                      fill: filled ? "#EAB308" : "none",
                      filter: filled
                        ? "drop-shadow(0 1px 4px #EAB30875)"
                        : "none",
                    }}
                  />
                </motion.div>
              );
            })}
          </div>

          {averageRating > 0 && (
            <span className="text-[11px] font-medium text-muted-foreground">
              {averageRating.toFixed(1)}
            </span>
          )}

          {totalMissions !== undefined &&
            totalMissions > 0 &&
            missionsLabel && (
              <span className="text-[11px] text-muted-foreground">
                · {totalMissions} {missionsLabel}
              </span>
            )}
        </motion.div>

        <p className="text-sm text-muted-foreground">{contactInfo}</p>
      </div>

      {/* Edit */}
      <Link href={editHref}>
        <Button variant="outline" size="icon">
          <Edit2 className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}
