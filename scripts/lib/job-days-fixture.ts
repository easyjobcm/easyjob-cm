/**
 * Fixture de preuve (lot 12) : offre publiée avec un calendrier explicite.
 *
 * Depuis la migration 20261113120000, le calendrier (job_days) est figé dès
 * la première publication, pour tout auteur. Une offre de plusieurs
 * journées est donc insérée en brouillon, ses journées ajoutées, puis elle
 * passe à « active » : le trigger de publication fixe alors le régime et
 * l'échéance (lot 11b), comme une approbation réelle. Pile locale
 * uniquement (client de service reçu de readLocalProofEnv()).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

export type FixtureDay = {
  date: string;
  start_time: string;
  end_time: string;
  /** Format per_day uniquement. */
  pay?: number;
  positions?: number;
};

/** Date ISO (YYYY-MM-DD) décalée de `days` jours (calendrier, sans fuseau). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function insertJobWithDays(
  service: SupabaseClient<Database>,
  job: Omit<JobInsert, "start_date" | "start_time" | "end_time" | "status"> & {
    status?: JobInsert["status"];
  },
  days: FixtureDay[],
  format: "full_period" | "per_day" = "full_period",
): Promise<{ jobId: string; dayIds: string[] }> {
  if (days.length === 0) throw new Error("insertJobWithDays: aucune journée");
  const sorted = [...days].sort((a, b) =>
    `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`),
  );
  const first = sorted[0];
  const finalStatus = job.status ?? "active";
  const { data: created, error } = await service
    .from("jobs")
    .insert({
      ...job,
      schedule_format: format,
      status: "draft",
      start_date: first.date,
      start_time: first.start_time,
      end_time: first.end_time,
      end_date: sorted[sorted.length - 1].date,
      ...(format === "per_day"
        ? {
            mission_pay_per_candidate: Math.min(
              ...sorted.map((d) => d.pay ?? 1),
            ),
            positions_available: sorted.reduce(
              (n, d) => n + (d.positions ?? 1),
              0,
            ),
          }
        : {}),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(`job seed: ${error?.message}`);

  const { data: rows, error: daysError } = await service
    .from("job_days")
    .insert(
      sorted.map((d) => ({
        job_id: created.id,
        day_date: d.date,
        start_time: d.start_time,
        end_time: d.end_time,
        // Recalculées par le trigger de la table (heure de Douala).
        starts_at: new Date().toISOString(),
        ends_at: new Date(Date.now() + 1000).toISOString(),
        mission_pay_per_candidate: format === "per_day" ? (d.pay ?? 1) : null,
        positions_available: format === "per_day" ? (d.positions ?? 1) : null,
      })),
    )
    .select("id, day_date");
  if (daysError || !rows) {
    throw new Error(`job_days seed: ${daysError?.message}`);
  }

  if (finalStatus !== "draft") {
    const { error: pubError } = await service
      .from("jobs")
      .update({ status: finalStatus })
      .eq("id", created.id);
    if (pubError) throw new Error(`job publish: ${pubError.message}`);
  }
  const byDate = new Map(rows.map((r) => [r.day_date, r.id]));
  return {
    jobId: created.id,
    dayIds: sorted.map((d) => byDate.get(d.date) as string),
  };
}
