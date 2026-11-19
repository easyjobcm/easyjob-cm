/**
 * Nettoyage des fixtures d'offres des preuves (lot 17d-1).
 *
 * Depuis la migration 20261124120000, l'historique d'une offre publiée
 * (offre, candidatures, clôture) ne s'efface plus par l'application, clé
 * service et cascades comprises (`job_history_protected`). Seule une
 * maintenance directe de la base le peut (session_user postgres).
 *
 * Les preuves purgent donc leurs propres offres par une connexion Postgres
 * directe à la pile dédiée (`readLocalDbUrl` refuse tout hôte non local),
 * jamais par PostgREST : aucun contournement n'est ouvert à l'application.
 * Purge au mieux, offre par offre : une offre qui résiste est signalée et
 * le nettoyage continue, comme les suppressions en clé service d'avant.
 */
import { readLocalDbUrl } from "./local-supabase";
import { runSupabaseQuery } from "./db-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidArray(values: readonly string[] | undefined): string {
  const ids = (values ?? []).filter((v) => UUID.test(v));
  return `array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`;
}

export function purgeProofJobs(
  proof: string,
  target: {
    /** Comptes de la preuve : offres de leurs entreprises, candidatures de leurs profils. */
    userIds?: readonly string[];
    jobIds?: readonly string[];
    applicationIds?: readonly string[];
  },
): void {
  const users = uuidArray(target.userIds);
  const jobs = uuidArray(target.jobIds);
  const apps = uuidArray(target.applicationIds);
  const sql = `
do $$
declare
  v_job uuid;
begin
  for v_job in
    select j.id from public.jobs j
    left join public.company_profiles cp on cp.id = j.company_id
    where j.id = any (${jobs}) or cp.user_id = any (${users})
  loop
    begin
      delete from public.contracts c where c.job_id = v_job;
      delete from public.jobs j where j.id = v_job;
    exception when others then
      raise warning 'purge de preuve, offre % : %', v_job, sqlerrm;
    end;
  end loop;
  delete from public.job_applications a
  where a.id = any (${apps})
     or a.candidate_id in (select cp.id from public.candidate_profiles cp
                           where cp.user_id = any (${users}));
end $$`;
  const r = runSupabaseQuery(readLocalDbUrl(), sql, { proof });
  if (r.status !== 0) {
    console.warn(
      `⚠️ purge des offres de preuve (${proof}) : ${r.out.slice(0, 200)}`,
    );
  }
}
