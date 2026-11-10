import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - manifest.webmanifest (PWA manifest, fetched pre-auth)
     * - api/csp-report (rapports CSP du navigateur, sans session)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|api/csp-report|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
