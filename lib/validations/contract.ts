import { z } from "zod";

/**
 * Signature d'un contrat (RPC `sign_contract`, lot 7b).
 *
 * `terms_hash` est l'empreinte affichée à l'utilisateur au moment où il
 * consent. La base la compare à l'empreinte enregistrée ; elle ne sert jamais
 * à la calculer. `consent` matérialise la case cochée (SRS §6.7, §11.8).
 */
export const contractSignSchema = z.object({
  terms_hash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, "terms_hash_invalid"),
  consent: z.literal(true, { message: "consent_required" }),
});

export type ContractSignInput = z.infer<typeof contractSignSchema>;

/** Statut HTTP de chaque refus levé par `get_contract` / `sign_contract`. */
export const CONTRACT_RPC_REFUSALS = {
  not_authenticated: 401,
  account_suspended: 403,
  contract_not_found: 404,
  contract_not_signable: 409,
  contract_needs_review: 409,
  terms_mismatch: 409,
} as const;

export type ContractRpcRefusal = keyof typeof CONTRACT_RPC_REFUSALS;

export function contractRefusal(
  message: string | undefined,
): { code: ContractRpcRefusal; status: number } | null {
  if (message && message in CONTRACT_RPC_REFUSALS) {
    const code = message as ContractRpcRefusal;
    return { code, status: CONTRACT_RPC_REFUSALS[code] };
  }
  return null;
}
