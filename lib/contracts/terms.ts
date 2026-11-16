import { z } from "zod";

/**
 * Conditions figées d'un contrat (`contract_data`, lots 7a, 7b et 12) et de
 * l'aperçu proposé avant « Signer et sélectionner » (lot 13). Lues par
 * l'écran du contrat, l'aperçu de l'entreprise et le PDF : tous affichent le
 * texte enregistré, jamais celui du dictionnaire courant.
 */
export const contractTermsSchema = z
  .object({
    job_title: z.string().nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    start_time: z.string().nullish(),
    end_time: z.string().nullish(),
    break_minutes: z.number().nullish(),
    address: z.string().nullish(),
    city: z.string().nullish(),
    mission_pay_per_candidate: z.number().nullish(),
    currency: z.string().nullish(),
    pay_basis: z.string().nullish(),
    // Lot 12 : format et journées figés à la sélection.
    schedule_format: z.string().nullish(),
    days: z
      .array(
        z.object({
          date: z.string(),
          start_time: z.string(),
          end_time: z.string(),
        }),
      )
      .nullish(),
  })
  .partial();

export type ContractTerms = z.infer<typeof contractTermsSchema>;

const clauseTextSchema = z.object({
  intro: z.string(),
  candidate_title: z.string(),
  candidate: z.array(z.string()),
  company_title: z.string(),
  company: z.array(z.string()),
  consent: z.string(),
});

const clausesSchema = z.object({
  version: z.string(),
  fr: clauseTextSchema,
  en: clauseTextSchema,
});

export type ContractClauseText = z.infer<typeof clauseTextSchema>;

export type ParsedContract = {
  terms: ContractTerms;
  /** Null : contrat ancien sans clauses figées (jamais reconstituées). */
  clauses: ContractClauseText | null;
  clausesVersion: string | null;
  /** Journées figées, ou la journée unique déduite des dates et horaires. */
  days: { date: string; start_time: string; end_time: string }[];
  /** Montant affichable : forfait par mission en XAF, entier positif. */
  pay: number | null;
};

export function parseContractTerms(
  raw: unknown,
  locale: string,
): ParsedContract {
  const parsedTerms = contractTermsSchema.safeParse(raw);
  const terms = parsedTerms.success ? parsedTerms.data : {};
  const parsedClauses = clausesSchema.safeParse(
    (raw as Record<string, unknown> | null)?.clauses,
  );
  const clauses = parsedClauses.success
    ? parsedClauses.data[locale === "en" ? "en" : "fr"]
    : null;
  const days =
    terms.days && terms.days.length > 0
      ? terms.days
      : terms.start_date && terms.start_time && terms.end_time
        ? [
            {
              date: terms.start_date,
              start_time: terms.start_time,
              end_time: terms.end_time,
            },
          ]
        : [];
  const pay =
    terms.pay_basis === "per_mission" &&
    terms.currency === "XAF" &&
    Number.isInteger(terms.mission_pay_per_candidate) &&
    (terms.mission_pay_per_candidate ?? 0) > 0
      ? (terms.mission_pay_per_candidate ?? null)
      : null;
  return {
    terms,
    clauses,
    clausesVersion: parsedClauses.success ? parsedClauses.data.version : null,
    days,
    pay,
  };
}
