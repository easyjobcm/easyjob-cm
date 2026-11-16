import { parseContractTerms } from "@/lib/contracts/terms";
import { renderPdf, type PdfBlock } from "@/lib/contracts/pdf";
import { crossesMidnight } from "@/lib/jobs/schedule";
import { formatXaf } from "@/lib/utils";
import { plural } from "@/lib/i18n/plural";
import type { TranslationKeys } from "@/lib/i18n/fr";

/** Champs de `get_contract` utilisés par le PDF (lecture de la partie). */
export type ContractPdfSource = {
  contract_id: string;
  contract_template: string;
  terms: unknown;
  terms_hash: string;
  company_name: string | null;
  candidate_name: string | null;
  viewer_signed: boolean;
  needs_review: boolean;
  can_sign: boolean;
};

const tag = (locale: string) => (locale === "en" ? "en-GB" : "fr-FR");

/** « lundi 23 novembre 2026 » : date de journée (sans fuseau). */
function longDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));
}

/**
 * Blocs du contrat PDF (lot 13), depuis les conditions et clauses figées
 * du contrat et la seule mention propre au lecteur (sa signature). Aucun
 * horodatage, IP ni état de la signature de l'autre partie.
 */
export function contractPdfBlocks(
  contract: ContractPdfSource,
  locale: "fr" | "en",
  t: TranslationKeys,
  generatedAt: Date,
): PdfBlock[] {
  const tc = t.contract;
  const tp = tc.pdf;
  const parsed = parseContractTerms(contract.terms, locale);
  const { terms, clauses, clausesVersion, days, pay } = parsed;
  const blocks: PdfBlock[] = [];
  const text = (value: string, extra: Partial<PdfBlock> = {}) =>
    blocks.push({ kind: "text", text: value, ...extra } as PdfBlock);
  // Ponctuation de chaque langue : « Lieu : » / « Location: ».
  const field = (label: string, value: string) =>
    `${label}${locale === "en" ? ":" : " :"} ${value}`;

  blocks.push({ kind: "title", text: tc.title });
  text(
    tc.reference.replace(
      "{ref}",
      contract.contract_id.slice(0, 8).toUpperCase(),
    ),
    { muted: true },
  );
  text(
    contract.contract_template === "formal"
      ? tc.template.formal
      : tc.template.simple,
    { muted: true },
  );

  blocks.push({ kind: "heading", text: tc.parties });
  text(field(tc.company, contract.company_name ?? "—"));
  text(field(tc.candidate, contract.candidate_name ?? "—"));

  blocks.push({ kind: "heading", text: tc.terms });
  text(tc.termsNotice, { muted: true });
  text(field(tc.job, terms.job_title ?? "—"), { bold: true });
  const format =
    terms.schedule_format === "per_day"
      ? t.schedule.formats.per_day.title
      : t.schedule.formats.full_period.title;
  text(
    field(
      tp.format,
      `${format} · ${plural(days.length || 1, t.schedule.dayCount, locale)}`,
    ),
  );
  if (days.length > 0) {
    text(field(tp.days, "").trimEnd());
    for (const d of days) {
      const hours = `${d.start_time.slice(0, 5)} – ${d.end_time.slice(0, 5)}`;
      blocks.push({
        kind: "bullet",
        text: field(
          longDate(d.date, locale),
          `${hours}${crossesMidnight(d) ? ` (${t.schedule.nextDay})` : ""}`,
        ),
      });
    }
    text(tp.timeZone, { muted: true });
  } else {
    text(field(tc.dates, "—"));
  }
  if (terms.break_minutes) {
    text(tc.breakMinutes.replace("{min}", String(terms.break_minutes)));
  }
  text(
    field(
      tc.place,
      [terms.address, terms.city].filter(Boolean).join(", ") || "—",
    ),
  );
  text(
    field(
      tc.pay,
      pay !== null ? `${formatXaf(pay, locale)} ${t.pay.forMission}` : "—",
    ),
    { bold: true },
  );
  text(t.pay.contractBasis, { muted: true });

  blocks.push({ kind: "heading", text: tc.clausesTitle });
  if (clauses) {
    text(clauses.intro);
    text(clauses.candidate_title, { bold: true });
    for (const line of clauses.candidate)
      blocks.push({ kind: "bullet", text: line });
    text(clauses.company_title, { bold: true });
    for (const line of clauses.company)
      blocks.push({ kind: "bullet", text: line });
    text(clauses.consent, { muted: true });
    text(tc.clausesVersion.replace("{version}", clausesVersion ?? ""), {
      muted: true,
    });
  } else {
    text(tc.clausesMissing);
  }

  blocks.push({ kind: "heading", text: tc.yourSignature });
  const viewerState = contract.viewer_signed
    ? "signed"
    : contract.needs_review
      ? "review"
      : contract.can_sign
        ? "toSign"
        : "closed";
  text(tc.viewerState[viewerState]);
  if (contract.needs_review) text(tc.needsReview);
  text(tc.fingerprint.replace("{hash}", contract.terms_hash), { muted: true });

  blocks.push({ kind: "spacer" });
  text(
    tp.generatedAt.replace(
      "{date}",
      new Intl.DateTimeFormat(tag(locale), {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Douala",
      }).format(generatedAt),
    ),
    { muted: true },
  );
  return blocks;
}

export function contractPdf(
  contract: ContractPdfSource,
  locale: "fr" | "en",
  t: TranslationKeys,
  generatedAt = new Date(),
): Uint8Array {
  return renderPdf(contractPdfBlocks(contract, locale, t, generatedAt), {
    title: `${t.contract.title} ${contract.contract_id.slice(0, 8).toUpperCase()}`,
    footer: `EasyJob CM · ${t.contract.reference.replace(
      "{ref}",
      contract.contract_id.slice(0, 8).toUpperCase(),
    )}`,
  });
}
