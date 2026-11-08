import { NextResponse } from "next/server";
import { jobRefusal } from "@/lib/validations/job";
import { internalErrorResponse } from "@/lib/api/errors";

// Messages historiques conservés : l'interface traduit `code`.
const REFUSAL_MESSAGES: Partial<Record<string, string>> = {
  not_authenticated: "Unauthorized",
  account_suspended: "Votre compte est suspendu",
  company_not_found: "Company profile not found",
  company_not_verified: "Company must be verified to post jobs",
  not_a_company: "Only companies can post jobs",
  invalid_job_data: "Données invalides",
};

/**
 * Réponse d'erreur commune à la création et à la modification. Les règles
 * (session, rôle, compte actif, entreprise vérifiée, statut imposé) sont
 * appliquées par les RPC `create_job` et `update_job` : un appel PostgREST
 * direct rencontre les mêmes refus.
 */
export function jobWriteErrorResponse(
  error: {
    message: string;
    details?: string | null;
    code?: string;
  },
  op: string,
  request?: { headers: Pick<Headers, "get"> } | null,
) {
  const refusal = jobRefusal(error.message);
  if (!refusal) {
    return internalErrorResponse(op, error, {
      code: "job_write_failed",
      request,
    });
  }
  return NextResponse.json(
    {
      error: REFUSAL_MESSAGES[refusal.code] ?? refusal.code,
      code: refusal.code,
      ...(refusal.code === "invalid_job_data" && error.details
        ? { field: error.details }
        : {}),
    },
    { status: refusal.status },
  );
}
