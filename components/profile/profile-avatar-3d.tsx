"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useSpring,
  animate,
} from "framer-motion";
import { type LucideIcon } from "lucide-react";

interface ProfileAvatar3DProps {
  initial: string;
  sandboxBadge?: { icon: LucideIcon; label: string; color: string } | null;
  size?: number;
}

export function ProfileAvatar3D({
  initial,
  sandboxBadge,
  size = 96,
}: ProfileAvatar3DProps) {
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Motion values for 3D tilt
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const springX = useSpring(rawX, { stiffness: 200, damping: 20 });
  const springY = useSpring(rawY, { stiffness: 200, damping: 20 });

  const rotateX = useTransform(springY, [-0.5, 0.5], [12, -12]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-12, 12]);
  const glowX = useTransform(springX, [-0.5, 0.5], ["0%", "100%"]);
  const glowY = useTransform(springY, [-0.5, 0.5], ["0%", "100%"]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    rawX.set((e.clientX - rect.left) / rect.width - 0.5);
    rawY.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const handlePointerLeave = () => {
    animate(rawX, 0, { type: "spring", stiffness: 200, damping: 25 });
    animate(rawY, 0, { type: "spring", stiffness: 200, damping: 25 });
  };

  const color = sandboxBadge?.color ?? "#7C3AED";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ perspective: 600, width: size + 32, height: size + 32 }}
    >
      {/* Outer glow ring — animates continuously */}
      <motion.div
        className="absolute inset-0 rounded-3xl"
        style={{ background: `${color}30` }}
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.6, 1, 0.6],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* 3D Card */}
      <motion.div
        ref={cardRef}
        className="relative cursor-pointer select-none"
        style={{
          width: size,
          height: size,
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        animate={{
          y: [0, -6, 0],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        whileTap={{ scale: 0.95 }}
      >
        {/* Avatar face */}
        <div
          className="flex h-full w-full items-center justify-center rounded-2xl text-white"
          style={{
            background: `linear-gradient(135deg, ${color}dd 0%, ${color} 60%, ${color}99 100%)`,
            boxShadow: `0 20px 40px ${color}55, 0 8px 16px ${color}33, inset 0 1px 0 rgba(255,255,255,0.25)`,
            fontSize: size * 0.35,
            fontWeight: 700,
            transform: "translateZ(16px)",
          }}
        >
          {/* Dynamic specular highlight */}
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl opacity-30"
            style={{
              background: `radial-gradient(circle at ${glowX} ${glowY}, rgba(255,255,255,0.6) 0%, transparent 60%)`,
            }}
          />
          {initial.toUpperCase()}
        </div>

        {/* Bottom depth shadow */}
        <div
          className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full blur-xl"
          style={{
            width: size * 0.75,
            height: 12,
            background: `${color}55`,
            transform: "translateZ(-8px)",
          }}
        />
      </motion.div>

      {/* Sandbox badge */}
      {sandboxBadge && (
        <motion.div
          initial={{ scale: 0, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{
            delay: 0.5,
            type: "spring",
            stiffness: 400,
            damping: 15,
          }}
          className="absolute -bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5"
          style={{
            background: `linear-gradient(135deg, ${color}cc, ${color})`,
            boxShadow: `0 6px 16px ${color}55, inset 0 1px 0 rgba(255,255,255,0.22)`,
          }}
        >
          {(() => {
            const Icon = sandboxBadge.icon;
            return <Icon className="h-3.5 w-3.5 text-white" />;
          })()}
          <span className="text-[10px] font-bold tracking-wide text-white">
            {sandboxBadge.label}
          </span>
        </motion.div>
      )}
    </div>
  );
}
