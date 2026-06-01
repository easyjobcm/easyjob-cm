import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Chemins accessibles sans authentification ni vérification téléphone. */
const PUBLIC_PREFIXES = ["/auth/", "/api/", "/"];
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => prefix !== "/" && pathname.startsWith(prefix),
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!isPublicPath(pathname)) {
    // ── 1. Authentification requise ──────────────────────────────
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // ── 2. Vérification téléphone requise ────────────────────────
    // On préfère app_metadata (dans le JWT, sans requête DB).
    // Fallback DB pour les comptes créés avant cette règle.
    const adminRoles = ["admin_support", "admin_ops", "admin_founder"];
    const userRole = user.app_metadata?.role as string | undefined;
    const isAdmin = adminRoles.includes(userRole ?? "");

    if (!isAdmin) {
      let phoneVerified: boolean =
        user.app_metadata?.phone_verified === true;

      if (!phoneVerified) {
        // Fallback : vérifier en DB (accounts sans app_metadata mis à jour)
        const { data: row } = await supabase
          .from("users")
          .select("phone_verified, role")
          .eq("id", user.id)
          .single();

        phoneVerified = row?.phone_verified === true;
        // Si l'utilisateur est admin dans la DB, on le laisse passer
        if (adminRoles.includes(row?.role ?? "")) {
          return supabaseResponse;
        }
      }

      if (!phoneVerified) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/verify-phone";
        return NextResponse.redirect(url);
      }
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse;
}

