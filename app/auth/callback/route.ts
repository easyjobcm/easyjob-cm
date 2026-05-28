import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { NextRequest, NextResponse } from "next/server";

type UserRole = Database["public"]["Enums"]["user_role"];

function extractRole(next: string): UserRole | null {
  if (next.includes("/signup/company")) return "company";
  if (next.includes("/signup/candidate")) return "candidate";
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/auth/error`);
  }

  // Si la cible est une étape signup, on s'assure que la row public.users
  // contient le bon rôle. Le profil métier (candidate_profiles / company_profiles)
  // n'est créé qu'après vérification du téléphone — pas ici.
  const role = extractRole(next);
  if (role) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const admin = createAdminClient();
      const locale =
        (user.user_metadata?.locale as "fr" | "en" | undefined) ?? "fr";
      await admin.from("users").upsert(
        {
          id: user.id,
          email: user.email ?? null,
          role,
          locale,
        },
        { onConflict: "id" },
      );
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
