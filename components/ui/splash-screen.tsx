"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface SplashScreenProps {
  minDuration?: number;
}

export function SplashScreen({ minDuration = 2000 }: SplashScreenProps) {
  const { t } = useTranslation();
  // Caché par défaut → évite le double-loading (loading.tsx + splash) et
  // l'hydration mismatch sur les traductions. Activé uniquement à la
  // toute première visite de la session via sessionStorage.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = sessionStorage.getItem("easyjob_splash_seen");
    if (seen) return;
    sessionStorage.setItem("easyjob_splash_seen", "1");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), minDuration);
    return () => clearTimeout(timer);
  }, [minDuration]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }}
          transition={{ duration: 0.55, ease: [0.65, 0, 0.35, 1] }}
          className="fixed inset-0 z-100 flex flex-col items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse at 30% 20%, #2D1B69 0%, #1A0A2E 45%, #0D0618 100%)",
          }}
        >
          {/* Ambient violet orbs */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.45 }}
            transition={{ duration: 1.4, ease: "easeOut" }}
            className="absolute -top-1/4 -right-1/4 w-[60vw] h-[60vw] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #7C3AED 0%, transparent 70%)",
            }}
          />
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.35 }}
            transition={{ duration: 1.6, ease: "easeOut", delay: 0.15 }}
            className="absolute -bottom-1/4 -left-1/4 w-[55vw] h-[55vw] rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, #A855F7 0%, transparent 70%)",
            }}
          />

          {/* Floating particles */}
          {[...Array(8)].map((_, i) => (
            <motion.span
              key={i}
              className="absolute w-1 h-1 rounded-full bg-white/70"
              style={{
                left: `${15 + ((i * 11) % 70)}%`,
                top: `${20 + ((i * 17) % 60)}%`,
              }}
              animate={{
                y: [0, -18, 0],
                opacity: [0.2, 0.9, 0.2],
              }}
              transition={{
                duration: 2.4 + (i % 3) * 0.6,
                repeat: Infinity,
                delay: i * 0.25,
                ease: "easeInOut",
              }}
            />
          ))}

          {/* Logo block */}
          <div className="relative z-10 flex flex-col items-center">
            <motion.div
              initial={{ scale: 0, rotate: -180, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 18,
                delay: 0.1,
              }}
              className="relative mb-7"
            >
              {/* Pulsing rings */}
              <motion.div
                animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 rounded-[28px] border-2 border-[#A78BFA]"
              />
              <motion.div
                animate={{ scale: [1, 1.4], opacity: [0.4, 0] }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.5,
                }}
                className="absolute inset-0 rounded-[28px] border-2 border-[#7C3AED]"
              />

              {/* Logo tile */}
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="relative w-28 h-28 rounded-[28px] flex items-center justify-center overflow-hidden"
                style={{
                  background:
                    "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
                  boxShadow:
                    "0 20px 60px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -2px 8px rgba(0,0,0,0.2)",
                }}
              >
                {/* Specular highlight */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 45%)",
                  }}
                />

                <Image
                  src="/icons/manifest-icon-192.maskable.png"
                  alt="Easyjob CM"
                  width={112}
                  height={112}
                  priority
                  className="relative z-10 w-full h-full object-cover"
                />

                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  className="absolute -top-2 -right-2 z-20"
                >
                  <Sparkles className="w-5 h-5 text-[#FCD34D] drop-shadow-[0_0_8px_rgba(252,211,77,0.6)]" />
                </motion.div>
              </motion.div>
            </motion.div>

            {/* Brand name */}
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
              className="text-[34px] font-black tracking-tight mb-1.5"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, #FFFFFF 0%, #DDD6FE 50%, #A78BFA 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Easyjob{" "}
              <span
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, #A78BFA 0%, #7C3AED 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                CM
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
              className="text-[13px] text-[#C4B5FD]/80 font-medium tracking-wide"
            >
              {t("splash.tagline")}
            </motion.p>

            {/* Loader bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9, duration: 0.4 }}
              className="mt-10 w-44 h-1 rounded-full overflow-hidden bg-white/10"
            >
              <motion.div
                initial={{ x: "-100%" }}
                animate={{ x: "100%" }}
                transition={{
                  duration: 1.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="w-1/2 h-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, transparent 0%, #A78BFA 50%, transparent 100%)",
                }}
              />
            </motion.div>
          </div>

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.5 }}
            className="absolute bottom-8 flex flex-col items-center gap-1"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-[#A78BFA]" />
              <p className="text-[11px] text-white/50 font-medium tracking-wider uppercase">
                {t("splash.madeIn")}
              </p>
              <span className="w-1 h-1 rounded-full bg-[#A78BFA]" />
            </div>
            <p className="text-[10px] text-white/30">{t("splash.version")}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
