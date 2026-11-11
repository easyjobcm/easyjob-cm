/**
 * Synchronisation explicite des courses dans les preuves (lot 11).
 *
 * Pour imposer « A puis B », une preuve ralentit A dans un trigger
 * temporaire (`pg_sleep`) pendant qu'A tient ses verrous, attend que la base
 * montre réellement A en attente dans ce trigger, puis seulement lance B.
 * Aucun délai fixe côté client : si A n'atteint pas le trigger, l'attente
 * échoue au lieu de laisser B partir au hasard.
 *
 * L'observation passe par une fonction de preuve temporaire,
 * `proof_sleeping_backends()`, exécutable par la seule clé service et lue
 * dans pg_stat_activity (connexions en `PgSleep`). Pile de preuve
 * uniquement ; la fonction est créée puis supprimée par la preuve.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type ExecSql = (sql: string) => void;
// Client typé ou non : la fonction de preuve n'est pas dans les types générés.
type AnyClient = Pick<SupabaseClient, "rpc">;

const CREATE = `
create or replace function public.proof_sleeping_backends()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from pg_stat_activity where wait_event = 'PgSleep';
$$
`;

export async function installBarrier(
  execSql: ExecSql,
  service: AnyClient,
): Promise<void> {
  execSql(CREATE);
  execSql(
    "revoke all on function public.proof_sleeping_backends() from public, anon, authenticated",
  );
  execSql(
    "grant execute on function public.proof_sleeping_backends() to service_role",
  );
  execSql("notify pgrst, 'reload schema'");
  // Attente du rechargement du cache de schéma de PostgREST (borne : 15 s).
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    const { error } = await service.rpc("proof_sleeping_backends");
    if (!error) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("proof_sleeping_backends indisponible après 15 s");
}

/**
 * Attend qu'au moins `count` connexions soient en `pg_sleep` (l'opération
 * engagée en premier tient ses verrous). Échoue au-delà de `timeoutMs`.
 */
export async function waitSleeping(
  service: AnyClient,
  count = 1,
  timeoutMs = 10_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { data, error } = await service.rpc("proof_sleeping_backends");
    if (!error && typeof data === "number" && data >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `aucune opération en attente dans le trigger de preuve après ${timeoutMs} ms`,
  );
}

export function dropBarrier(execSql: ExecSql): void {
  execSql("drop function if exists public.proof_sleeping_backends()");
}
