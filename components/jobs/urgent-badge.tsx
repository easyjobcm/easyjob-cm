"use client";

import { Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { useJobUrgent } from "@/lib/jobs/use-job-urgency";
import type { UrgencyJob } from "@/lib/jobs/urgency";

/**
 * Badge « Urgente » calculé (lot 9d) : offre ouverte dont le début est
 * strictement futur et à 24 h ou moins (heure de Douala). L'ancien
 * indicateur manuel `jobs.urgency` n'est plus lu. Bascule sur un écran
 * ouvert (minuterie sur l'heure du serveur).
 */
export function UrgentBadge({
  job,
  className,
}: {
  job: UrgencyJob;
  className?: string;
}) {
  const { t } = useI18n();
  const urgent = useJobUrgent(job);
  if (!urgent) return null;
  return (
    <Badge
      variant="destructive"
      className={className}
      title={t.jobs.urgentLabel}
      data-testid="job-urgent-badge"
    >
      <Zap className="mr-1 h-3 w-3" aria-hidden />
      {t.jobs.urgentBadge}
    </Badge>
  );
}
