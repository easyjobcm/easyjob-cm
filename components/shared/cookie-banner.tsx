"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cookie,
  Shield,
  Sparkles,
  BarChart3,
  Megaphone,
  Settings2,
  Lock,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n";

const CONSENT_KEY = "ej_cookie_consent";
const CONSENT_COOKIE = "ej_consent";
const CONSENT_VERSION = "1.0";

interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  timestamp: number;
  version: string;
}

function setConsentCookie(consent: ConsentState) {
  const value = encodeURIComponent(
    JSON.stringify({
      v: consent.version,
      a: consent.analytics,
      m: consent.marketing,
      p: consent.preferences,
    }),
  );
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  document.cookie = `${CONSENT_COOKIE}=${value}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

function persistConsent(opts: {
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}): ConsentState {
  const consent: ConsentState = {
    necessary: true,
    analytics: opts.analytics,
    marketing: opts.marketing,
    preferences: opts.preferences,
    timestamp: Date.now(),
    version: CONSENT_VERSION,
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch {
    /* storage unavailable */
  }
  setConsentCookie(consent);
  return consent;
}

function loadConsent(): ConsentState | null {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ConsentState;
    if (parsed.version !== CONSENT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Modern toggle switch ────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
}

function ToggleRow({
  label,
  desc,
  value,
  onChange,
  Icon,
  color,
}: ToggleRowProps) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      className="mb-2.5 p-3.5 rounded-2xl border bg-white transition-colors"
      style={{ borderColor: value ? `${color}40` : "#E5E7EB" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
          style={{ background: value ? `${color}15` : "#F3F4F6" }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#111827]">{label}</p>
          <p className="text-[11.5px] text-[#6B7280] mt-0.5 leading-relaxed">
            {desc}
          </p>
        </div>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => onChange(!value)}
          aria-checked={value}
          role="switch"
          className="shrink-0 mt-0.5 w-11 h-6.5 rounded-full flex items-center px-0.75 transition-colors duration-300"
          style={{ background: value ? color : "#D1D5DB" }}
        >
          <motion.div
            layout
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            className="w-5 h-5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)]"
            style={{ marginLeft: value ? "auto" : 0 }}
          />
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CookieBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // RGPD: opt-in par défaut = tous les non-essentiels à false
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [preferences, setPreferences] = useState(false);

  useEffect(() => {
    const existing = loadConsent();
    if (!existing) {
      const timer = setTimeout(() => setVisible(true), 1400);
      return () => clearTimeout(timer);
    }
  }, []);

  function acceptAll() {
    persistConsent({ analytics: true, marketing: true, preferences: true });
    setVisible(false);
  }

  function declineNonEssential() {
    persistConsent({ analytics: false, marketing: false, preferences: false });
    setVisible(false);
  }

  function saveChoices() {
    persistConsent({ analytics, marketing, preferences });
    setVisible(false);
  }

  const cardVariants = {
    hidden: { y: 80, opacity: 0, scale: 0.96 },
    visible: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: { type: "spring" as const, damping: 24, stiffness: 280 },
    },
    exit: {
      y: 80,
      opacity: 0,
      scale: 0.96,
      transition: { duration: 0.22, ease: "easeIn" as const },
    },
  };

  const sheetVariants = {
    hidden: { y: "100%" },
    visible: {
      y: 0,
      transition: { type: "spring" as const, damping: 28, stiffness: 320 },
    },
    exit: {
      y: "100%",
      transition: { duration: 0.22, ease: "easeIn" as const },
    },
  };

  return (
    <AnimatePresence>
      {visible && !showDetails && (
        /* ══════════════ Compact floating card (non-blocking) ══════════════ */
        <motion.div
          key="cookie-card"
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="fixed z-50 left-3 right-3 sm:left-auto sm:right-6 sm:w-100"
          style={{
            bottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {/* Outer glow */}
          <div
            className="absolute inset-0 rounded-[28px] blur-2xl opacity-40 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 30% 50%, #7C3AED 0%, transparent 60%)",
            }}
          />

          {/* Card */}
          <div
            className="relative bg-white rounded-3xl overflow-hidden border border-[#E5E7EB]"
            style={{
              boxShadow:
                "0 24px 64px rgba(91,33,182,0.22), 0 8px 24px rgba(0,0,0,0.08)",
            }}
          >
            {/* Gradient accent strip */}
            <div
              className="h-1 w-full"
              style={{
                background:
                  "linear-gradient(90deg, #7C3AED 0%, #A78BFA 50%, #7C3AED 100%)",
              }}
            />

            <div className="p-5">
              <div className="flex items-start gap-3.5 mb-4">
                {/* Animated cookie icon */}
                <div className="relative shrink-0">
                  <motion.div
                    animate={{ rotate: [0, -8, 8, -4, 0] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      repeatDelay: 1.8,
                      ease: "easeInOut",
                    }}
                    className="relative w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{
                      background:
                        "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.8), 0 4px 12px rgba(124,58,237,0.18)",
                    }}
                  >
                    <Cookie className="w-6 h-6 text-[#5B21B6]" />
                  </motion.div>
                  <motion.div
                    animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0, 0.7] }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                    className="absolute -top-1 -right-1"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#A78BFA]" />
                  </motion.div>
                </div>

                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-[14px] font-bold text-[#111827] mb-1 leading-tight">
                    {t("cookie.title")}
                  </p>
                  <p className="text-[12px] text-[#6B7280] leading-relaxed">
                    {t("cookie.desc")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowDetails(true)}
                  className="h-11 rounded-full border border-[#E5E7EB] text-[12px] font-semibold text-[#6B7280] hover:border-[#7C3AED] hover:text-[#7C3AED] hover:bg-[#F5F3FF] transition-colors flex items-center justify-center gap-1"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  {t("cookie.manage")}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={declineNonEssential}
                  className="h-11 rounded-full border border-[#E5E7EB] text-[12px] font-semibold text-[#6B7280] hover:border-[#9CA3AF] hover:text-[#374151] hover:bg-[#F9FAFB] transition-colors flex items-center justify-center"
                >
                  {t("cookie.decline")}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={acceptAll}
                  className="h-11 rounded-full text-white text-[12px] font-bold flex items-center justify-center"
                  style={{
                    background:
                      "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
                    boxShadow:
                      "0 4px 16px rgba(124,58,237,0.4), 0 2px 4px rgba(91,33,182,0.2)",
                  }}
                >
                  {t("cookie.accept")}
                </motion.button>
              </div>

              {/* Trust footer */}
              <div className="mt-3 pt-3 border-t border-[#F3F4F6] flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-[#9CA3AF]" />
                <p className="text-[10.5px] text-[#9CA3AF] font-medium">
                  {t("cookie.gdprNote")}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {visible && showDetails && (
        /* ══════════════ Detailed bottom sheet (dismissable backdrop) ══════════════ */
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={() => setShowDetails(false)}
            className="fixed inset-0 z-40 backdrop-blur-sm cursor-pointer"
            style={{ background: "rgba(15, 10, 30, 0.45)" }}
          />

          <motion.div
            key="cookie-sheet"
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-[28px] overflow-hidden"
            style={{
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
              boxShadow: "0 -16px 48px rgba(0,0,0,0.18)",
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1.5 rounded-full bg-[#E5E7EB]" />
            </div>

            {/* Gradient accent strip */}
            <div
              className="h-1 w-full"
              style={{
                background:
                  "linear-gradient(90deg, #7C3AED 0%, #A78BFA 50%, #7C3AED 100%)",
              }}
            />

            <div className="px-5 pt-5 pb-4 max-w-2xl mx-auto max-h-[78vh] overflow-y-auto">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#EDE9FE] flex items-center justify-center">
                    <Shield className="w-4 h-4 text-[#7C3AED]" />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-bold text-[#111827] leading-tight">
                      {t("cookie.title")}
                    </h3>
                    <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                      {t("cookie.subtitle")}
                    </p>
                  </div>
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowDetails(false)}
                  className="text-[12px] font-semibold text-[#7C3AED] hover:text-[#5B21B6] transition-colors px-3 py-1.5 rounded-full hover:bg-[#F5F3FF]"
                >
                  {t("cookie.back")}
                </motion.button>
              </div>

              {/* Necessary — always on */}
              <div
                className="mb-2.5 p-3.5 rounded-2xl border"
                style={{
                  borderColor: "#DDD6FE",
                  background:
                    "linear-gradient(135deg, #F5F3FF 0%, #FAF5FF 100%)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-9 h-9 rounded-xl bg-[#7C3AED]/15 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-[#7C3AED]" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[13px] font-semibold text-[#111827]">
                        {t("cookie.necessary")}
                      </p>
                      <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#7C3AED] text-white">
                        {t("cookie.alwaysOn")}
                      </span>
                    </div>
                    <p className="text-[11.5px] text-[#6B7280] mt-1">
                      {t("cookie.necessaryDesc")}
                    </p>
                  </div>
                  <div className="shrink-0 mt-0.5 w-11 h-6.5 rounded-full bg-[#7C3AED] flex items-center justify-end px-0.75 opacity-60">
                    <div className="w-5 h-5 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)]" />
                  </div>
                </div>
              </div>

              <ToggleRow
                label={t("cookie.analytics")}
                desc={t("cookie.analyticsDesc")}
                value={analytics}
                onChange={setAnalytics}
                Icon={({ className }) => (
                  <BarChart3
                    className={className}
                    style={{ color: analytics ? "#2563EB" : "#9CA3AF" }}
                  />
                )}
                color="#2563EB"
              />
              <ToggleRow
                label={t("cookie.marketing")}
                desc={t("cookie.marketingDesc")}
                value={marketing}
                onChange={setMarketing}
                Icon={({ className }) => (
                  <Megaphone
                    className={className}
                    style={{ color: marketing ? "#DC2626" : "#9CA3AF" }}
                  />
                )}
                color="#DC2626"
              />
              <ToggleRow
                label={t("cookie.preferences")}
                desc={t("cookie.preferencesDesc")}
                value={preferences}
                onChange={setPreferences}
                Icon={({ className }) => (
                  <Settings2
                    className={className}
                    style={{ color: preferences ? "#059669" : "#9CA3AF" }}
                  />
                )}
                color="#059669"
              />

              <div className="flex gap-2 mt-5 pt-4 border-t border-[#F3F4F6]">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={declineNonEssential}
                  className="flex-1 h-11 rounded-full border border-[#E5E7EB] text-[13px] font-semibold text-[#6B7280] hover:border-[#9CA3AF] hover:text-[#374151] transition-colors"
                >
                  {t("cookie.declineNonEssential")}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={saveChoices}
                  className="flex-1 h-11 rounded-full text-white text-[13px] font-bold"
                  style={{
                    background:
                      "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)",
                    boxShadow:
                      "0 4px 16px rgba(124,58,237,0.4), 0 2px 4px rgba(91,33,182,0.2)",
                  }}
                >
                  {t("cookie.save")}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
