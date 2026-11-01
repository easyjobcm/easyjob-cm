// SERVER ONLY — appelé par lib/actions/auth.ts avec un client service_role.
// Volontairement hors du fichier "use server" : ce n'est pas une action
// appelable depuis le navigateur.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { normalizeSignupLocale, normalizeSignupRole } from "./signup-role";

type UserRole = Database["public"]["Enums"]["user_role"];

export type FinalizeSignupResult =
  | { ok: true; data: { role: UserRole } }
  | { ok: false; errorCode: string };

/**
 * Marque le téléphone comme vérifié et crée le profil métier
 * (candidate_profiles ou company_profiles) UNIQUEMENT à ce stade,
 * pour éviter d'avoir des profils orphelins en cas d'abandon avant OTP.
 *
 * Règles de rôle (audit F-03) :
 *  - le rôle initial vient de `user_metadata` normalisé (candidate|company) ;
 *  - il n'est écrit QUE si la ligne public.users n'existe pas encore
 *    (INSERT … ON CONFLICT DO NOTHING, atomique : deux finalisations
 *    concurrentes ne peuvent pas se réécrire) ;
 *  - un rôle existant (admin, premium, ou choix initial) n'est jamais
 *    remplacé ; `app_metadata.role` est recopié depuis la ligne en base.
 */
export async function finalizeSignup(
  admin: SupabaseClient<Database>,
  user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  },
  e164: string,
): Promise<FinalizeSignupResult> {
  const meta = user.user_metadata ?? {};

  // 1. Création de la ligne si absente — jamais de réécriture du rôle.
  //    (Le trigger handle_new_user n'est pas garanti d'être attaché à
  //    auth.users, notamment en local, donc on le fait ici.)
  const { error: insertErr } = await admin.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? "",
      phone: e164,
      phone_verified: true,
      role: normalizeSignupRole(meta.role),
      locale: normalizeSignupLocale(meta.locale),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (insertErr) {
    console.error("[signup] users insert failed:", insertErr);
    return { ok: false, errorCode: "generic" };
  }

  // 2. Vérification téléphone : seuls ces champs sont mis à jour.
  const { data: row, error: updateErr } = await admin
    .from("users")
    .update({ phone: e164, phone_verified: true })
    .eq("id", user.id)
    .select("role, email")
    .single();
  if (updateErr || !row) {
    console.error("[signup] users phone update failed:", updateErr);
    return { ok: false, errorCode: "generic" };
  }
  const role = row.role;

  // Stocker phone_verified + role dans app_metadata pour que le middleware
  // puisse le lire depuis le JWT sans requête DB supplémentaire. Source :
  // la ligne public.users, jamais user_metadata.
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { phone_verified: true, role },
  });
  if (metaErr) {
    // Non-fatal : le fallback DB du middleware prend le relais.
    console.error("[signup] app_metadata update failed:", metaErr);
  }

  if (role === "candidate") {
    const { error } = await admin
      .from("candidate_profiles")
      .upsert({ user_id: user.id }, { onConflict: "user_id" });
    if (error) {
      console.error("[signup] candidate_profiles upsert failed:", error);
      return { ok: false, errorCode: "generic" };
    }
  } else if (role === "company") {
    const companyName =
      typeof meta.company_name === "string" ? meta.company_name : "";
    const niu = typeof meta.niu === "string" ? meta.niu : "";
    if (!companyName || !niu) {
      console.error("[signup] company metadata missing", { companyName, niu });
      return { ok: false, errorCode: "generic" };
    }
    const { error } = await admin.from("company_profiles").upsert(
      {
        user_id: user.id,
        company_name: companyName,
        niu,
        contact_email: row.email ?? user.email ?? "",
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error("[signup] company_profiles upsert failed:", error);
      return { ok: false, errorCode: "generic" };
    }
  }

  return { ok: true, data: { role } };
}
