import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { updateRequestSchema } from "@/lib/validations/profile";

/**
 * Demande de mise à jour de profil initiée par l'admin (SRS §5.1) :
 * déverrouille temporairement les champs vérifiés du candidat (identité et/ou
 * documents CNI) le temps qu'ils soient resoumis, puis re-vérifiés.
 *
 * - Crée la demande `profile_update_requests` (status `pending`) — c'est elle
 *   qui déverrouille côté serveur (PUT /api/profile/identity,
 *   POST /api/profile/documents) ET qui se matérialise en Tâche (page /tasks)
 *   côté candidat.
 * - Crée une notification `document_status` pour que la demande s'affiche
 *   aussi dans le centre de notifications.
 * - Récupère le `user_id` du candidat pour la notification ; si l'admin est
 *   service-role (pas connecté), aucun `user_id` n'est résolu.
 *
 * UI admin (bouton « demander une mise à jour ») : T8 — l'endpoint existe dès
 * T2, le bouton vient avec la refonte du dashboard admin.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  // Demande de mise à jour : réservé à admin_ops / admin_founder (US-ADMIN-05)
  // — admin_support garde un accès lecture seule, jamais de mutation ici.
  if (
    !userData?.role ||
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { candidate_id, fields, reason } = parsed.data;

  // Le candidat doit exister et être un candidat (jamais d'entreprise/admin).
  const { data: candidate } = await supabase
    .from("candidate_profiles")
    .select("id, user_id")
    .eq("id", candidate_id)
    .single();
  if (!candidate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("profile_update_requests")
    .insert({
      candidate_id,
      fields,
      status: "pending",
      reason,
      requested_by: user.id,
    })
    .select("id")
    .single();

  // La policy RLS `profile_update_requests_insert_ops_admin` est le vrai
  // garde-fou : même si le rôle n'était pas checké plus haut, l'insert serait
  // refusé pour tout compte non-admin_ops/admin_founder.
  if (insertError || !inserted) {
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  // Audit : traçabilité (qui a demandé quoi, quand, pour quel motif).
  // La table n'a que `actor_id` (pas de `user_id`) — un champ inconnu
  // ferait échouer SILENCIEUSEMENT l'insert PostgREST (résultat non
  // inspecté) : aucune ligne n'aurait été tracée.
  const { error: auditError } = await supabase.from("audit_logs").insert({
    actor_id: user.id,
    actor_role: userData.role,
    action: "request_profile_update",
    resource_type: "profile_update_requests",
    resource_id: inserted.id,
    metadata: { candidate_id, fields, reason },
  });
  if (auditError) {
    // L'audit est traçabilité, pas business : on ne casse pas la demande
    // créée, on loggue l'échec pour qu'il soit remonté.
    console.error(
      "[admin-profile-update] audit insert failed:",
      auditError.message,
    );
  }

  // Notification centre de notifications (Tâche /tasks utilise la table).
  const notificationTitle = "Mise à jour de profil requise";
  const notificationBody = reason;
  await supabase.from("notifications").insert({
    user_id: candidate.user_id,
    notification_type: "document_status",
    title: notificationTitle,
    body: notificationBody,
    data: { profile_update_request_id: inserted.id, fields, reason },
  });

  return NextResponse.json({ ok: true, request_id: inserted.id });
}
