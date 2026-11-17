"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import {
  IncidentList,
  useMissionIncidents,
} from "@/components/missions/incident-list";
import {
  IncidentReportDialog,
  type IncidentDay,
} from "@/components/missions/incident-report-dialog";

/**
 * Signalements d'une mission vus par l'entreprise (lot 14), dans le bloc
 * des journées du candidat sélectionné : signaler un retard ou une absence
 * sur une journée, lire et compléter le dossier.
 */
export function CompanyMissionIncidents({
  missionId,
  jobTitle,
  days,
  disabled,
}: {
  missionId: string;
  jobTitle: string;
  days: IncidentDay[];
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { incidents, reload } = useMissionIncidents(missionId);
  const [open, setOpen] = useState(false);
  // Heure locale lue au clic (la base revérifie la disponibilité).
  const [openedAt, setOpenedAt] = useState(0);
  return (
    <div className="space-y-2" data-testid="company-mission-incidents">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">{t.incidents.title}</p>
        <motion.div whileTap={{ scale: 0.97 }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpenedAt(Date.now());
              setOpen(true);
            }}
            disabled={disabled}
            data-testid="company-report-incident"
          >
            <Flag className="mr-1 h-4 w-4" aria-hidden />
            {t.incidents.report}
          </Button>
        </motion.div>
      </div>
      <IncidentList
        incidents={incidents ?? []}
        onChanged={() => void reload()}
      />
      <IncidentReportDialog
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          void reload();
        }}
        missionId={missionId}
        jobTitle={jobTitle}
        party="company"
        days={days}
        initialDayId={days.find((d) => !d.confirmed)?.id ?? days[0]?.id}
        serverNow={openedAt}
      />
    </div>
  );
}
