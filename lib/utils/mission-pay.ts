import type { Json } from "@/lib/database.types";

/**
 * Montant par candidat figé dans un contrat (`contract_data`, écrit par
 * `select_candidate`) : entier XAF > 0, sinon null. Une mission affiche ce
 * montant accepté, jamais celui de l'offre relu après coup.
 */
export function frozenMissionPay(contractData: Json | null | undefined) {
  if (
    !contractData ||
    typeof contractData !== "object" ||
    Array.isArray(contractData)
  ) {
    return null;
  }
  const amount = contractData.mission_pay_per_candidate;
  return typeof amount === "number" && Number.isInteger(amount) && amount > 0
    ? amount
    : null;
}

/** Montants figés indexés par candidature (`contracts.application_id`). */
export function frozenPayByApplication(
  contracts:
    | { application_id: string; contract_data: Json | null }[]
    | null
    | undefined,
): Map<string, number | null> {
  return new Map(
    (contracts ?? []).map((c) => [
      c.application_id,
      frozenMissionPay(c.contract_data),
    ]),
  );
}
