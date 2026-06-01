"use client";

import * as React from "react";
import { motion } from "framer-motion";

interface HeroIllustrationProps {
  variant: "candidate" | "company";
  className?: string;
}

/**
 * Illustration 3D "cartoon" inline (SVG) qui déborde du cadre.
 * Placeholder MVP — à remplacer par un PNG/Lottie 3D (Spline, Blender) :
 *   <Image src={`/illustrations/signup-${variant}.png`} ... />
 */
export function HeroIllustration({
  variant,
  className,
}: HeroIllustrationProps) {
  return (
    <div
      className={
        "pointer-events-none relative isolate overflow-visible " +
        (className ?? "")
      }
      aria-hidden
    >
      {/* Blob d'arrière-plan */}
      <motion.div
        className="absolute -inset-8 -z-10"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <div className="h-full w-full rounded-[40%] bg-linear-to-br from-[#7C3AED] via-[#A78BFA] to-[#F0ABFC] opacity-30 blur-2xl" />
      </motion.div>

      {variant === "candidate" ? <CandidateScene /> : <CompanyScene />}
    </div>
  );
}

/* ───────────────────── Candidate scene ───────────────────── */
function CandidateScene() {
  return (
    <motion.svg
      viewBox="0 0 320 320"
      className="h-full w-full overflow-visible"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <defs>
        <linearGradient id="cand-card" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3E8FF" />
        </linearGradient>
        <linearGradient id="cand-violet" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>
        <linearGradient id="cand-pink" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#FBCFE8" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>
        <radialGradient id="cand-shine" cx="0.3" cy="0.3">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Carte mission flottante */}
      <motion.g
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect
          x="40"
          y="60"
          width="200"
          height="120"
          rx="24"
          fill="url(#cand-card)"
          stroke="#E9D5FF"
          strokeWidth="2"
        />
        <circle cx="70" cy="90" r="14" fill="url(#cand-violet)" />
        <rect x="92" y="82" width="80" height="8" rx="4" fill="#7C3AED" />
        <rect x="92" y="96" width="60" height="6" rx="3" fill="#C4B5FD" />
        <rect x="56" y="120" width="140" height="6" rx="3" fill="#E9D5FF" />
        <rect x="56" y="134" width="100" height="6" rx="3" fill="#E9D5FF" />
        <rect
          x="56"
          y="152"
          width="80"
          height="20"
          rx="10"
          fill="url(#cand-violet)"
        />
      </motion.g>

      {/* Badge XP (déborde du cadre en haut-droite) */}
      <motion.g
        animate={{ rotate: [-6, 6, -6] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "260px 60px" }}
      >
        <circle cx="260" cy="60" r="38" fill="url(#cand-pink)" />
        <circle cx="252" cy="52" r="20" fill="url(#cand-shine)" />
        <text
          x="260"
          y="68"
          textAnchor="middle"
          fontFamily="system-ui"
          fontWeight="800"
          fontSize="22"
          fill="#FFFFFF"
        >
          ★
        </text>
      </motion.g>

      {/* Bulle Mobile Money en bas-gauche */}
      <motion.g
        animate={{ y: [0, 6, 0] }}
        transition={{
          duration: 3.5,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.3,
        }}
      >
        <rect
          x="20"
          y="210"
          width="120"
          height="56"
          rx="20"
          fill="url(#cand-violet)"
        />
        <circle cx="48" cy="238" r="14" fill="#FFFFFF" />
        <text
          x="48"
          y="244"
          textAnchor="middle"
          fontFamily="system-ui"
          fontWeight="800"
          fontSize="16"
          fill="#7C3AED"
        >
          ₣
        </text>
        <rect x="70" y="226" width="60" height="8" rx="4" fill="#FFFFFF" />
        <rect
          x="70"
          y="240"
          width="44"
          height="6"
          rx="3"
          fill="#FFFFFF"
          opacity="0.6"
        />
      </motion.g>

      {/* Étincelles */}
      <motion.g
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <circle cx="190" cy="40" r="4" fill="#FBCFE8" />
        <circle cx="30" cy="160" r="3" fill="#A78BFA" />
        <circle cx="290" cy="200" r="5" fill="#F472B6" />
      </motion.g>
    </motion.svg>
  );
}

/* ───────────────────── Company scene ───────────────────── */
function CompanyScene() {
  return (
    <motion.svg
      viewBox="0 0 320 320"
      className="h-full w-full overflow-visible"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <defs>
        <linearGradient id="comp-building" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>
        <linearGradient id="comp-card" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#F3E8FF" />
        </linearGradient>
        <radialGradient id="comp-shine" cx="0.3" cy="0.3">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Building 3D */}
      <motion.g
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect
          x="80"
          y="80"
          width="160"
          height="180"
          rx="20"
          fill="url(#comp-building)"
        />
        <rect x="80" y="80" width="160" height="40" rx="20" fill="#7C3AED" />
        {/* Fenêtres */}
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={100 + col * 42}
              y={140 + row * 28}
              width="28"
              height="18"
              rx="4"
              fill="#FBBF24"
              opacity={row === 1 && col === 1 ? 1 : 0.7}
            />
          )),
        )}
        <ellipse cx="120" cy="100" rx="40" ry="14" fill="url(#comp-shine)" />
      </motion.g>

      {/* Badge "vérifié" qui déborde */}
      <motion.g
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "260px 100px" }}
      >
        <circle cx="260" cy="100" r="34" fill="#10B981" />
        <circle cx="252" cy="92" r="16" fill="url(#comp-shine)" />
        <path
          d="M248 100 l8 8 l16 -16"
          stroke="#FFFFFF"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </motion.g>

      {/* Carte candidat flottante en bas-gauche */}
      <motion.g
        animate={{ y: [0, 5, 0] }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5,
        }}
      >
        <rect
          x="20"
          y="220"
          width="140"
          height="60"
          rx="18"
          fill="url(#comp-card)"
          stroke="#E9D5FF"
          strokeWidth="2"
        />
        <circle cx="50" cy="250" r="16" fill="#7C3AED" />
        <text
          x="50"
          y="256"
          textAnchor="middle"
          fontFamily="system-ui"
          fontWeight="800"
          fontSize="16"
          fill="#FFFFFF"
        >
          A
        </text>
        <rect x="76" y="240" width="70" height="8" rx="4" fill="#7C3AED" />
        <rect x="76" y="254" width="50" height="6" rx="3" fill="#C4B5FD" />
      </motion.g>

      {/* Étincelles */}
      <motion.g
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <circle cx="50" cy="100" r="4" fill="#FBCFE8" />
        <circle cx="290" cy="50" r="3" fill="#A78BFA" />
        <circle cx="280" cy="270" r="5" fill="#F472B6" />
      </motion.g>
    </motion.svg>
  );
}
