"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missionId: string;
  /** candidate : le candidat note l'entreprise (obligatoire) ; company : l'inverse (facultatif). */
  reviewer: "candidate" | "company";
  /** Nom affiché de la partie évaluée. */
  name: string;
  onReviewed: () => void;
};

/**
 * Évaluation après réalisation (lot 7c), reprise du dialogue d'étoiles de
 * l'écran mission. La base n'accepte qu'une évaluation par auteur, mission
 * et sens ; après une erreur réseau, l'état enregistré est relu.
 */
export function ReviewDialog({
  open,
  onOpenChange,
  missionId,
  reviewer,
  name,
  onReviewed,
}: Props) {
  const { t } = useI18n();
  const tr = t.mission.review;
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  async function alreadyReviewed(): Promise<boolean> {
    const res = await fetch(`/api/missions/${missionId}`, {
      cache: "no-store",
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      mission?: { candidate_reviewed?: boolean; company_reviewed?: boolean };
    };
    return reviewer === "candidate"
      ? body.mission?.candidate_reviewed === true
      : body.mission?.company_reviewed === true;
  }

  async function send() {
    if (sendingRef.current || rating === 0) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/missions/${missionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, comment: comment.trim() || null }),
    }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
    };
    if (res?.ok || (await alreadyReviewed())) {
      setRating(0);
      setComment("");
      onReviewed();
    } else {
      const errors = t.mission.errors;
      setError(
        body.code && body.code in errors
          ? errors[body.code as keyof typeof errors]
          : errors.generic,
      );
    }
    sendingRef.current = false;
    setSending(false);
  }

  const title = reviewer === "candidate" ? tr.companyTitle : tr.candidateTitle;
  const description = (
    reviewer === "candidate" ? tr.companyDescription : tr.candidateDescription
  ).replace("{name}", name);

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent
        role="dialog"
        aria-modal="true"
        aria-labelledby="mission-review-title"
      >
        <DialogHeader>
          <DialogTitle id="mission-review-title">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <div className="flex justify-center gap-2" role="radiogroup">
            {[1, 2, 3, 4, 5].map((star) => (
              <motion.button
                key={star}
                type="button"
                role="radio"
                aria-checked={rating === star}
                aria-label={tr.star.replace("{count}", String(star))}
                data-testid={`review-star-${star}`}
                whileTap={{ scale: 0.9 }}
                onClick={() => setRating(star)}
                className="focus:outline-none"
              >
                <Star
                  className={`h-10 w-10 ${
                    star <= rating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-gray-300"
                  }`}
                />
              </motion.button>
            ))}
          </div>
          <Textarea
            placeholder={tr.placeholder}
            value={comment}
            maxLength={1000}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && (
            <div
              className="flex items-start gap-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {reviewer === "company" && (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              {tr.later}
            </Button>
          )}
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button
              onClick={() => void send()}
              disabled={sending || rating === 0}
              data-testid="review-submit"
            >
              {sending ? tr.sending : tr.send}
            </Button>
          </motion.div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
