import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { updateRequestSchema } from "@/lib/validations/profile";

/**
 * T8.5 — GET liste des demandes de mise à jour de profil (vue
 * centralisée /admin/update-requests). Les 3 grades admin (admin_support =
 * lecture seule) — la lecture passe par la session admin car
 * `profile_update_requests` a une policy `select_own_or_admin` (contrairement
 * à `users`, ici l'admin session lit bien).
 *
 * Filtres optionnels : `?status=pending|done|cancelled`,
 * `?candidate_id=<profile_id>` (la page profil T8.4b n'affiche que la
 * demande de CE candidat). Tri `created_at` dec (les plus récentes en tête).
 *
 * Jamais de path de fichier (les docs CNI n'entrent jamais dans la réponse —
 * leur URL signée passe par les flux existants).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !userData?.role ||
    !["admin_support", "admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const candidateId = searchParams.get("candidate_id");

  let query = supabase
    .from("profile_update_requests")
    .select(
      `id, candidate_id, fields, status, reason, requested_by,
       created_at, completed_at,
       candidate:candidate_profiles!inner ( id, first_name, last_name )`,
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (status) {
    query = query.eq("status", status);
  }
  if (candidateId) {
    query = query.eq("candidate_id", candidateId);
  }

  // L'embed `candidate:candidate_profiles!inner` est sûr : la FK
  // `candidate_id → candidate_profiles.id` est unique (pas de
  // multi-relationship comme users↔candidate_profiles) et ON DELETE
  // CASCADE garantit qu'une demande ne survit jamais à son profil.
  const { data: rows, error } = await query;
  if (error) {
    console.error("[admin-profile-updates] list query:", error.message);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  // L'initiateur (admin) : `requested_by` → `users.id`. La session admin
  // peut pas lire les autres lignes de `users` (RLS « propre profil ») →
  // on résout les e-mails en service_role (lecture agrégée sans audit).
  const requesterIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.requested_by)
        .filter((id): id is string => !!id),
    ),
  );
  const requesterEmailById = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: reqUsers } = await createAdminClient()
      .from("users")
      .select("id, email")
      .in("id", requesterIds);
    for (const u of (reqUsers ?? []) as Array<{
      id: string;
      email: string | null;
    }>) {
      requesterEmailById.set(u.id, u.email ?? "");
    }
  }

  const requests = (rows ?? []).map((r) => {
    const candidate = Array.isArray(r.candidate) ? r.candidate[0] : r.candidate;
    return {
      id: r.id,
      candidate_id: r.candidate_id,
      fields: r.fields,
      status: r.status,
      reason: r.reason,
      requested_by: r.requested_by,
      created_at: r.created_at,
      completed_at: r.completed_at,
      requester_email: r.requested_by
        ? (requesterEmailById.get(r.requested_by) ?? null)
        : null,
      candidate: candidate
        ? {
            first_name: candidate.first_name,
            last_name: candidate.last_name,
          }
        : null,
    };
  });

  return NextResponse.json({ requests });
}

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
 * UI admin d'initiation (T8.5) : bouton sur le profil candidat
 * (`/admin/candidates/[id]`) + bouton rapide sur la page
 * `/admin/update-requests` — cet endpoint existe dès T2.
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
