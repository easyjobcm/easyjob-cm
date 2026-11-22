/**
 * Recalage du calendrier d'une mission pour les fixtures de preuve.
 *
 * Depuis le lot 17d-2 (ECH-02), les horaires d'une mission ou d'une journée
 * de mission ne se modifient plus après leur création, pour aucun auteur
 * applicatif, clé service comprise (`protect_mission_writes`,
 * `protect_mission_day_writes`). Les preuves qui ont besoin d'une journée
 * « terminée hier » ou « dans dix minutes » passent donc par la voie de
 * maintenance : connexion Postgres directe à la pile dédiée (`DB_URL` locale
 * imposée par `readLocalDbUrl`), session `postgres`, comme `purgeProofJobs`.
 * Aucune voie n'est ouverte à l'application. Les déclencheurs restent actifs :
 * `starts_at` et `ends_at` sont recalculés, les signaux temps réel émis.
 */
import { runSupabaseQuery } from "./db-query";
import { readLocalDbUrl } from "./local-supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

type ScheduleFields = {
  scheduled_date?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
};

export async function rescheduleFixture(
  table: "missions" | "mission_days",
  column: "id" | "mission_id",
  value: string,
  fields: ScheduleFields,
  proof: string,
): Promise<{ error: { message: string } | null }> {
  if (!UUID.test(value)) {
    return { error: { message: "rescheduleFixture : identifiant invalide" } };
  }
  if (table === "missions" && column !== "id") {
    return { error: { message: "rescheduleFixture : filtre invalide" } };
  }
  const sets: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const ok = k === "scheduled_date" ? DATE.test(v) : TIME.test(v);
    if (!ok || !k.startsWith("scheduled_")) {
      return { error: { message: `rescheduleFixture : ${k} invalide` } };
    }
    sets.push(`${k} = '${v}'`);
  }
  if (sets.length === 0) {
    return { error: { message: "rescheduleFixture : aucun champ" } };
  }
  const r = runSupabaseQuery(
    readLocalDbUrl(),
    `update public.${table} set ${sets.join(", ")} where ${column} = '${value}'`,
    { proof },
  );
  return r.status === 0
    ? { error: null }
    : { error: { message: r.out.slice(0, 300) } };
}
