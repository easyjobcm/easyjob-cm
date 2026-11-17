import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Préambule des routes admin d'un signalement (lots 14 et 15) : session
 * vérifiée et identifiant valide. Le grade est revérifié par chaque RPC en
 * base (`is_admin_user`, `is_ops_admin_user` : compte actif exigé).
 */
export async function adminIncidentContext(
  params: Promise<{ id: string }>,
): Promise<
  | { error: NextResponse }
  | { error: null; supabase: ServerClient; incidentId: string }
> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      ),
    };
  }
  const incidentId = z.string().uuid().safeParse(id);
  if (!incidentId.success) {
    return {
      error: NextResponse.json(
        { error: "incident_not_found", code: "incident_not_found" },
        { status: 404 },
      ),
    };
  }
  return { error: null, supabase, incidentId: incidentId.data };
}
