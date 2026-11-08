import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { safeInternalPath, signupRoleFromPath } from "@/lib/auth/safe-redirect";
import { logServerError, requestIdFrom } from "@/lib/observability/server-log";

/** Page d'erreur OAuth : propose de reprendre la connexion. */
const ERROR_PATH = "/auth/error";

/**
 * Retour OAuth (PKCE). `next` est lu une seule fois, déjà décodé par
 * `URLSearchParams`, puis réduit à un chemin interne par `safeInternalPath`
 * (F-13) : la redirection finale est toujours construite sur l'origine de
 * l'application, jamais par concaténation.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const requestId = requestIdFrom(request.headers);
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"));
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, origin));

  // Erreur renvoyée par le fournisseur (`error`, `error_description`) ou
  // lien incomplet : jamais de reprise du message du fournisseur.
  if (!code) return redirectTo(ERROR_PATH);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logServerError("auth.oauth_callback.exchange", error, {
      category: "auth",
      requestId,
    });
    return redirectTo(ERROR_PATH);
  }

  // Si la cible est une étape signup, on crée la row public.users avec le
  // rôle d'inscription choisi — UNIQUEMENT si elle n'existe pas encore
  // (F-03c) : un compte existant (admin, entreprise, candidat) garde son
  // rôle, et `app_metadata` n'est pas touché ici (il n'est écrit que par
  // finalizeSignup depuis la ligne en base). Le profil métier n'est créé
  // qu'après vérification du téléphone.
  const role = signupRoleFromPath(next);
  if (role) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const admin = createAdminClient();
      const locale =
        (user.user_metadata?.locale as "fr" | "en" | undefined) ?? "fr";
      const { error: insertError } = await admin.from("users").upsert(
        {
          id: user.id,
          email: user.email ?? null,
          role,
          locale,
        },
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (insertError) {
        logServerError("auth.oauth_callback.users_insert", insertError, {
          requestId,
        });
      }
    }
  }

  return redirectTo(next);
}
