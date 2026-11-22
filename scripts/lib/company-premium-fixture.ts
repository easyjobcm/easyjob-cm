/**
 * Fixture Premium entreprise par le parcours autorisé (ABO-07).
 *
 * Depuis `trg_company_plan_write_guard`, le plan d'une entreprise ne
 * s'écrit plus directement, clé service comprise. Les preuves qui ont besoin
 * d'une entreprise Premium appellent donc la vraie RPC
 * `admin_manage_company_premium`, sous l'identité d'un admin_ops ou
 * admin_founder actif de la preuve : historique, audit et notification sont
 * produits comme en production. Connexion directe à la pile de preuve
 * (`DB_URL` locale imposée par `readLocalDbUrl`) : un seul bloc `do`, car la
 * CLI n'exécute qu'une commande.
 */
import { runSupabaseQuery } from "./db-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function grantCompanyPremium(
  dbUrl: string,
  opts: {
    companyId: string;
    adminUserId: string;
    endsAt: string;
    proof: string;
    reason?: string;
  },
): void {
  const { companyId, adminUserId, endsAt, proof } = opts;
  if (!UUID.test(companyId) || !UUID.test(adminUserId)) {
    throw new Error("grantCompanyPremium : identifiant invalide");
  }
  if (!Number.isFinite(Date.parse(endsAt))) {
    throw new Error("grantCompanyPremium : date de fin invalide");
  }
  const reason = (opts.reason ?? `Fixture de preuve ${proof} : Premium.`)
    .replace(/'/g, "''")
    .slice(0, 500);
  const sql = `do $grant$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', '${adminUserId}', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '${adminUserId}', true);
  perform public.admin_manage_company_premium(
    gen_random_uuid(), '${companyId}', 'activate', '${new Date(endsAt).toISOString()}'::timestamptz,
    (select cp.subscription_expires_at from public.company_profiles cp where cp.id = '${companyId}'),
    '${reason}');
end
$grant$`;
  const r = runSupabaseQuery(dbUrl, sql, { proof });
  if (r.status !== 0) {
    throw new Error(`grantCompanyPremium : ${r.out.slice(0, 300)}`);
  }
}
