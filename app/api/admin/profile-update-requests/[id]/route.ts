import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { updateRequestActionSchema } from "@/lib/validations/profile";

/**
 * T8.5 — Actions admin sur une demande de mise à jour de profil
 * (SRS §5.1.1) : `PATCH` = annuler / `DELETE` = purge physique.
 *
 * Modèle T2 : l'ADMIN initie (POST ../route.ts, depuis T2), le CANDIDAT
 * exécute et la ligne clot automatiquement en `done` (
 * `completePendingRequests` au serveur, pas par cette route). Le verrou
 * n'a pas de « approuver/refuser » côté admin — le seul verbe d'annulation
 * est donc `cancelled` (pas de `rejected` : le candidat n'a pas « soumis »,
 * il EXECUTE la demande).
 *
 * - PATCH `/api/admin/profile-update-requests/[id]` : `status=cancelled`,
 *   transition autorisée UNIQUEMENT `pending → cancelled`. La RLS autorise
 *   l'admin à écrire N'IMPORTE QUEL statut (policy permissive), la route est
 *   donc la source de vérité des transitions — jamais de
 *   `done → pending`, jamais de `cancelled → *` (idem-potente si même état,
 *   sinon 409). Rôles : admin_ops/admin_founder (admin_support = RO).
 * - DELETE : purge physique de la ligne `done`/`cancelled` (l'historique
 *   clôturé — le candidat a déjà exécuté ou l'admin a annulé ; plus rien ne
 *   tourne derrière la ligne ni dans le lock). Décision produit T8.5 :
 *   JAMAIS de DELETE `pending` — supprimer une ligne en cours déverrouille
 *   silencieusement les champs du candidat en plein milieu de l'édition
 *   (l'unlock disparaît). L'audit écriture par `audit_logs` (action
 *   `delete_profile_update_request`) est conservé (l'audit ne référence pas
 *   la ligne supprimée, il porte `resource_id`).
 *
 * Mutation en SESSION admin (jamais `createAdminClient`) : la RLS
 * `profile_update_requests_update_admin_or_own_done` /
 * `profile_update_requests_delete_ops_admin` est le vrai garde-fou.
 */

type RouteContext = { params: Promise<{ id: string }> };

async function readRequest(id: string) {
  const supabase = await createClient();
  return supabase
    .from("profile_update_requests")
    .select("id, status, candidate_id, fields, reason")
    .eq("id", id)
    .maybeSingle();
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateRequestActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const nextStatus = parsed.data.status;

  const { data: row, error: readErr } = await readRequest(id);
  if (readErr) {
    console.error("[admin-profile-updates] read:", readErr.message);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { code: "not_found", error: "Not found" },
      { status: 404 },
    );
  }

  // Transition `pending → cancelled` uniquement. RLS est permissive
  // (l'admin peut écrire n'importe quel statut) — la route est l'unique
  // source de vérité des transitions. Idempotente si already `cancelled`.
  if (row.status === "cancelled") {
    return NextResponse.json({ ok: true, status: "cancelled" });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      {
        code: "invalid_transition",
        error: `Cannot cancel a ${row.status} request`,
      },
      { status: 409 },
    );
  }

  const { error: updateErr } = await supabase
    .from("profile_update_requests")
    .update({ status: nextStatus })
    .eq("id", id);
  if (updateErr) {
    console.error("[admin-profile-updates] cancel update:", updateErr.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // L'annulation déverrouille immédiatement (les champs restent verrouillés
  // car la demande `pending` qui les ouvrait n'existe plus — le candidat
  // revoit les champs verrouillés côté edit, pas de re-soumission). Audit +
  // notification au candidat.
  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    actor_role: userData.role,
    action: "cancel_profile_update_request",
    resource_type: "profile_update_requests",
    resource_id: id,
    metadata: { before: row.status, after: nextStatus },
  });

  const { data: candidate } = await supabase
    .from("candidate_profiles")
    .select("user_id")
    .eq("id", row.candidate_id)
    .maybeSingle();
  if (candidate) {
    await supabase.from("notifications").insert({
      user_id: candidate.user_id,
      notification_type: "document_status",
      title: "Mise à jour de profil annulée",
      body: "La demande de mise à jour de votre profil a été annulée par l'administration. Les champs concernés restent verrouillés.",
      data: {
        profile_update_request_id: id,
        fields: row.fields,
        reason: row.reason ?? null,
      },
    });
  }

  return NextResponse.json({ ok: true, status: nextStatus });
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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
    !["admin_ops", "admin_founder"].includes(userData.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: row, error: readErr } = await readRequest(id);
  if (readErr) {
    console.error("[admin-profile-updates] read:", readErr.message);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { code: "not_found", error: "Not found" },
      { status: 404 },
    );
  }

  // Décision produit T8.5 : purge UNIQUEMENT des lignes clôturées
  // (`done`/`cancelled`). Un `pending` est actif (le candidat est peut-être
  // en plein milieu de l'édition des champs déverrouillés) → on refuse.
  if (row.status === "pending") {
    return NextResponse.json(
      {
        code: "request_pending",
        error:
          "Cannot delete a pending request — cancel it first (PATCH status=cancelled).",
      },
      { status: 409 },
    );
  }

  // L'audit précède la suppression (la ligne porte `resource_id`, l'audit
  // est indépendant — il reste après le DELETE).
  await supabase.from("audit_logs").insert({
    actor_id: user.id,
    actor_role: userData.role,
    action: "delete_profile_update_request",
    resource_type: "profile_update_requests",
    resource_id: id,
    metadata: { status: row.status, candidate_id: row.candidate_id },
  });

  const { error: deleteErr } = await supabase
    .from("profile_update_requests")
    .delete()
    .eq("id", id);
  if (deleteErr) {
    console.error("[admin-profile-updates] delete:", deleteErr.message);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
