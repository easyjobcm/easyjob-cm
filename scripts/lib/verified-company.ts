/**
 * Fixture de preuve (lot 11) : dossier entreprise fictif vérifié.
 *
 * Depuis la migration 20261111120000, create_job, update_job et moderate_job
 * exigent un dossier complet dont les trois contrôles (RCCM, NIU,
 * représentant) sont approuvés sur la version courante : poser
 * `verification_status = 'verified'` ne suffit plus. Les preuves qui ont
 * besoin d'une entreprise autorisée à publier complètent donc le dossier en
 * clé service, avec des valeurs fictives, comme le ferait le parcours réel
 * (pièces déposées, contrôles enregistrés, décision finale).
 *
 * Pile locale uniquement : le client reçu vient de readLocalProofEnv().
 * Les chemins de fichiers sont fictifs (aucun objet Storage créé) ; les
 * preuves qui lisent les pièces passent par le parcours réel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const SOURCES = {
  rccm: "official_registry",
  niu: "dgi_online",
  representative: "rccm_extract",
} as const;

export async function approveCompanyDossier(
  service: SupabaseClient<Database>,
  companyId: string,
): Promise<void> {
  const { data: company, error } = await service
    .from("company_profiles")
    .select("user_id, rccm, niu, documents_url")
    .eq("id", companyId)
    .single();
  if (error || !company) {
    throw new Error(`dossier fixture: ${error?.message}`);
  }
  const folder = company.user_id;
  const { error: fillError } = await service
    .from("company_profiles")
    .update({
      rccm: company.rccm ?? "RC/DLA/2026/B/PREUVE",
      niu: company.niu ?? `M0PREUVE${folder.slice(0, 6).toUpperCase()}`,
      documents_url:
        (company.documents_url ?? []).length > 0
          ? company.documents_url
          : [`${folder}/rccm-fixture.pdf`],
      niu_document_path: `${folder}/niu-fixture.pdf`,
      representative_name: "Représentant fictif",
      representative_title: "Gérant",
      representative_authority: "listed_officer",
      representative_id_document_path: `${folder}/rep-id-fixture.pdf`,
    })
    .eq("id", companyId);
  if (fillError) throw new Error(`dossier fixture: ${fillError.message}`);

  const { data: row } = await service
    .from("company_profiles")
    .select(
      "rccm_revision, niu_revision, representative_revision, verification_revision",
    )
    .eq("id", companyId)
    .single();
  if (!row) throw new Error("dossier fixture: profil introuvable");
  const revisionOf = {
    rccm: row.rccm_revision,
    niu: row.niu_revision,
    representative: row.representative_revision,
  };
  const { error: checksError } = await service
    .from("company_verification_checks")
    .insert(
      (Object.keys(SOURCES) as (keyof typeof SOURCES)[]).map((check) => ({
        company_id: companyId,
        check_type: check,
        decision: "approved",
        check_revision: revisionOf[check],
        dossier_revision: row.verification_revision,
        source: SOURCES[check],
        reference_note: "fixture de preuve (données fictives)",
        decided_by_role: "proof_fixture",
      })),
    );
  if (checksError) throw new Error(`dossier fixture: ${checksError.message}`);

  const { error: statusError } = await service
    .from("company_profiles")
    .update({
      verification_status: "verified",
      niu_verified: true,
      verification_submitted_at: new Date().toISOString(),
      verification_reviewed_at: new Date().toISOString(),
      verification_reviewed_revision: row.verification_revision,
    })
    .eq("id", companyId);
  if (statusError) throw new Error(`dossier fixture: ${statusError.message}`);
}
