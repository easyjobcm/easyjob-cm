"use client";

import { Star } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatStars, toHalfStars } from "@/lib/reputation/progress";

type Props = {
  /** Réputation EasyJob, 0 à 5 par demi-étoiles. */
  stars: number | null | undefined;
  size?: "sm" | "md" | "lg";
  /** Couleur des étoiles vides (fond sombre : "light"). */
  tone?: "default" | "light";
  className?: string;
  testId?: string;
};

const SIZES = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-6 w-6" } as const;

/**
 * Réputation EasyJob affichée en étoiles graphiques (lot 9c). Seul indicateur
 * montré à un tiers : ni moyenne, ni nombre d'avis, ni motifs. Le nombre
 * d'étoiles est donné aux lecteurs d'écran (role="img").
 */
export function ReputationStars({
  stars,
  size = "md",
  tone = "default",
  className,
  testId = "reputation-stars",
}: Props) {
  const { t, locale } = useI18n();
  const value = toHalfStars(stars);
  const label = t.reputation.starsAria.replace(
    "{stars}",
    formatStars(value, locale, t.reputation.stars),
  );
  const empty = tone === "light" ? "rgba(255,255,255,0.3)" : "#D1D5DB";
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      data-stars={value}
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} aria-hidden className={`relative ${SIZES[size]}`}>
            <Star
              className={`absolute inset-0 ${SIZES[size]}`}
              style={{ color: empty }}
            />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fill * 100}%` }}
              >
                <Star
                  className={SIZES[size]}
                  style={{ color: "#EAB308", fill: "#EAB308" }}
                />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
