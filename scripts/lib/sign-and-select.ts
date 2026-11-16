/**
 * Sélection par le parcours du lot 13 pour les preuves : aperçu du contrat
 * proposé, puis « Signer et sélectionner » sur son empreinte, avec le
 * consentement. Depuis ce lot, select_candidate n'existe plus : une
 * sélection est toujours signée par l'entreprise.
 *
 * - `signAndSelectHttp` : routes de l'application (GET contract-preview,
 *   POST select), session par cookie. Un refus de l'aperçu est renvoyé tel
 *   quel (mêmes codes que la sélection).
 * - `signAndSelectRpc` : RPC en session (contract_selection_preview puis
 *   sign_and_select), même forme de réponse que l'ancien select_candidate.
 * - `signAndSelectSql(cible)` : instruction PL/pgSQL pour les fonctions de
 *   preuve à temps simulé (identité posée par request.jwt.claims).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { appFetch } from "./app-fetch";

export type SelectHttpResult = {
  status: number;
  body: Record<string, unknown>;
  text: string;
  /** Alias de `text` (nom utilisé par certaines preuves). */
  raw: string;
  /** Empreinte présentée (null si l'aperçu a été refusé). */
  termsHash: string | null;
};

async function call(
  url: string,
  init: RequestInit,
): Promise<{
  status: number;
  body: Record<string, unknown>;
  text: string;
  raw: string;
}> {
  const res = await appFetch(url, { ...init, redirect: "manual" });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, text, raw: text };
}

export async function previewHttp(
  appUrl: string,
  applicationId: string,
  cookie: string | null,
) {
  return call(`${appUrl}/api/applications/${applicationId}/contract-preview`, {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

export async function postSelectHttp(
  appUrl: string,
  applicationId: string,
  cookie: string | null,
  body: unknown,
) {
  return call(`${appUrl}/api/applications/${applicationId}/select`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function signAndSelectHttp(
  appUrl: string,
  applicationId: string,
  cookie: string | null,
): Promise<SelectHttpResult> {
  const preview = await previewHttp(appUrl, applicationId, cookie);
  const hash = (preview.body.preview as { terms_hash?: string } | undefined)
    ?.terms_hash;
  if (preview.status !== 200 || !hash) {
    // Candidature déjà sélectionnée : la relance passe par la sélection
    // (résultat d'origine), avec une empreinte quelconque.
    if (preview.body.code !== "application_not_selectable") {
      return { ...preview, termsHash: null };
    }
  }
  const termsHash = hash ?? "0".repeat(64);
  const sel = await postSelectHttp(appUrl, applicationId, cookie, {
    terms_hash: termsHash,
    consent: true,
  });
  return { ...sel, termsHash: hash ?? null };
}

export async function signAndSelectRpc(
  client: SupabaseClient<Database>,
  applicationId: string,
) {
  const preview = await client.rpc("contract_selection_preview", {
    p_application_id: applicationId,
  });
  const hash = preview.data?.[0]?.terms_hash;
  if (preview.error && preview.error.message !== "application_not_selectable") {
    return { data: null, error: preview.error };
  }
  return client.rpc("sign_and_select", {
    p_application_id: applicationId,
    p_terms_hash: hash ?? "0".repeat(64),
  });
}

export const signAndSelectSql = (target: string) =>
  `perform * from public.sign_and_select(${target}, ` +
  `coalesce((select p.terms_hash from public.contract_selection_preview(${target}) p), ''));`;
