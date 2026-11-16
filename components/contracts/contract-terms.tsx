"use client";

import { Briefcase, Calendar, Clock, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MissionPay } from "@/components/jobs/mission-pay";
import { useI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/plural";
import { formatDate, formatTime } from "@/lib/utils";
import { formatDayDate, formatDayHours } from "@/lib/jobs/schedule";
import type { ParsedContract } from "@/lib/contracts/terms";

/**
 * Conditions figées d'un contrat, ou proposées avant « Signer et
 * sélectionner » (lot 13) : intitulé, journées, horaires, lieu, montant en
 * XAF. Texte enregistré uniquement.
 */
export function ContractTermsCard({
  contract,
  notice,
}: {
  contract: ParsedContract;
  notice: string;
}) {
  const { t, locale } = useI18n();
  const tc = t.contract;
  const { terms, days, pay } = contract;
  const multi = days.length > 1;
  const sameDay = !terms.end_date || terms.end_date === terms.start_date;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{tc.terms}</CardTitle>
        <p className="text-xs text-muted-foreground">{notice}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Briefcase
            className="h-4 w-4 text-muted-foreground shrink-0"
            aria-label={tc.job}
          />
          <span className="font-medium" data-testid="contract-job">
            {terms.job_title ?? "—"}
          </span>
        </div>
        {multi ? (
          <div className="flex items-start gap-2" data-testid="contract-days">
            <Calendar
              className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0"
              aria-label={tc.dates}
            />
            <div className="min-w-0">
              <p className="font-medium">
                {terms.schedule_format === "per_day"
                  ? t.schedule.formats.per_day.title
                  : t.schedule.formats.full_period.title}
                {" · "}
                {plural(days.length, t.schedule.dayCount, locale)}
              </p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {days.map((d) => (
                  <li key={d.date} data-testid="contract-day">
                    {formatDayDate(d.date, locale)} ·{" "}
                    {formatDayHours(d, t.schedule.nextDay)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Calendar
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-label={tc.dates}
              />
              <span data-testid="contract-date">
                {terms.start_date ? formatDate(terms.start_date, locale) : "—"}
                {!sameDay && terms.end_date
                  ? ` – ${formatDate(terms.end_date, locale)}`
                  : ""}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Clock
                className="h-4 w-4 text-muted-foreground shrink-0"
                aria-label={tc.hours}
              />
              <span>
                {formatTime(terms.start_time, locale)} –{" "}
                {formatTime(terms.end_time, locale)}
              </span>
            </div>
          </>
        )}
        {terms.break_minutes ? (
          <p className="text-sm text-muted-foreground">
            {tc.breakMinutes.replace("{min}", String(terms.break_minutes))}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <MapPin
            className="h-4 w-4 text-muted-foreground shrink-0"
            aria-label={tc.place}
          />
          <span>
            {[terms.address, terms.city].filter(Boolean).join(", ") || "—"}
          </span>
        </div>
        <div className="pt-2 border-t space-y-0.5">
          <p className="text-sm text-muted-foreground">{tc.pay}</p>
          {/* Seules les conditions forfaitaires en XAF sont affichées :
              sans ces trois valeurs figées, « — ». */}
          <MissionPay
            amount={pay}
            amountClassName="text-lg text-primary"
            testId="contract-pay"
          />
          <p className="text-xs text-muted-foreground">{t.pay.contractBasis}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Clauses générales figées (version immuable, lot 7b). */
export function ContractClausesCard({
  contract,
}: {
  contract: ParsedContract;
}) {
  const { t } = useI18n();
  const tc = t.contract;
  const { clauses, clausesVersion } = contract;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{tc.clausesTitle}</CardTitle>
      </CardHeader>
      <CardContent
        className="text-sm text-muted-foreground space-y-3"
        data-testid="contract-clauses"
      >
        {clauses ? (
          <>
            <p>{clauses.intro}</p>
            <div>
              <p className="text-foreground font-medium">
                {clauses.candidate_title}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {clauses.candidate.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-foreground font-medium">
                {clauses.company_title}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {clauses.company.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs" data-testid="contract-clauses-version">
              {tc.clausesVersion.replace("{version}", clausesVersion ?? "")}
            </p>
          </>
        ) : (
          <p role="note">{tc.clausesMissing}</p>
        )}
      </CardContent>
    </Card>
  );
}
