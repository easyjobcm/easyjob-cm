"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatDayDate, formatDayHours } from "@/lib/jobs/schedule";
import { dayState, type CandidateJobDay } from "@/lib/jobs/day-state";

/**
 * Journées d'une offre, en heure de Douala. Format « journées au choix » :
 * montant et état de chaque journée, case à cocher pour les journées encore
 * accessibles ; seules les possibilités déjà utilisées sont retirées du
 * choix. Période complète : liste des journées engagées ensemble.
 *
 * Journée incompatible avec un engagement déjà sélectionné du candidat
 * (verdict de la base, `schedule_compatible`) : elle reste visible, sa case
 * est désactivée et le motif est écrit sous la journée (lisible sans survol,
 * relié à la case pour les lecteurs d'écran).
 */
export function JobDaysList({
  days,
  perDay,
  now,
  selected,
  onToggle,
  canChoose,
  unverified = false,
  onWithdraw,
  withdrawDisabled,
}: {
  days: readonly CandidateJobDay[];
  perDay: boolean;
  now: number;
  selected: readonly string[];
  onToggle: (dayId: string) => void;
  /** Faux : session absente, compte suspendu ou candidature bloquée. */
  canChoose: boolean;
  /**
   * Dernière lecture en échec : les journées affichées ne sont plus
   * vérifiées. Aucune n'est cochable ni présentée comme « ouverte ».
   */
  unverified?: boolean;
  onWithdraw: (applicationId: string) => void;
  withdrawDisabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const ts = t.schedule;
  return (
    <ul className="divide-y divide-border" data-testid="job-days">
      {days.map((day, index) => {
        const state = dayState(day, now);
        const conflict = state === "conflict";
        // Période complète : seule l'incompatibilité est signalée par
        // journée (candidature et échéance portent sur l'ensemble).
        const badge = perDay ? state : conflict ? state : null;
        const open = perDay && state === "open" && !!day.day_id;
        const choosable = open && canChoose && !unverified;
        // Case visible mais désactivée : journée incompatible, ou journée
        // ouverte dont la dernière lecture n'a pas abouti.
        const blockedBox = perDay && canChoose && conflict;
        const frozenBox = open && canChoose && unverified;
        const checked = !!day.day_id && selected.includes(day.day_id);
        const key = day.day_id ?? `${day.day_date}-${index}`;
        const inputId = `job-day-${key}`;
        const reasonId = `job-day-reason-${key}`;
        return (
          <li
            key={key}
            className="py-3 first:pt-0 last:pb-0"
            data-testid="job-day"
            data-date={day.day_date}
            data-state={badge ?? undefined}
          >
            <div className="flex items-start gap-3">
              {perDay && (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                  {choosable ? (
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() => day.day_id && onToggle(day.day_id)}
                      className="h-5 w-5 accent-primary"
                      data-testid="job-day-choose"
                    />
                  ) : blockedBox ? (
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={false}
                      disabled
                      readOnly
                      aria-describedby={reasonId}
                      className="h-5 w-5 cursor-not-allowed opacity-50"
                      data-testid="job-day-blocked"
                    />
                  ) : frozenBox ? (
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      disabled
                      readOnly
                      className="h-5 w-5 cursor-not-allowed opacity-50"
                      data-testid="job-day-choose"
                    />
                  ) : state === "pending" || state === "selected" ? (
                    <Check className="h-4 w-4 text-success" aria-hidden />
                  ) : null}
                </span>
              )}
              <label
                htmlFor={
                  choosable || blockedBox || frozenBox ? inputId : undefined
                }
                className={cn("min-w-0 flex-1", choosable && "cursor-pointer")}
              >
                <span className="block font-medium text-foreground">
                  {formatDayDate(day.day_date, locale)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {formatDayHours(day, ts.nextDay)}
                </span>
                {perDay && (
                  <MissionPay
                    amount={day.mission_pay_per_candidate}
                    className="mt-1 block text-sm"
                    amountClassName="text-primary"
                  />
                )}
              </label>
              {badge && !(unverified && badge === "open") && (
                <Badge
                  variant={
                    badge === "open"
                      ? "secondary"
                      : badge === "selected"
                        ? "default"
                        : badge === "conflict"
                          ? "warning"
                          : "outline"
                  }
                  className="shrink-0 whitespace-nowrap"
                  data-testid="job-day-state"
                >
                  {ts.dayState[badge]}
                </Badge>
              )}
            </div>
            {conflict && (
              <p
                id={reasonId}
                className={cn("mt-1 text-xs text-foreground", perDay && "ml-8")}
                data-testid="job-day-conflict-reason"
              >
                {ts.conflictDay}
              </p>
            )}
            {perDay && state === "pending" && day.my_application_id && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 ml-8 h-8 px-2 text-muted-foreground"
                disabled={withdrawDisabled}
                onClick={() =>
                  day.my_application_id && onWithdraw(day.my_application_id)
                }
                data-testid="job-day-withdraw"
              >
                {ts.withdrawDay}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
