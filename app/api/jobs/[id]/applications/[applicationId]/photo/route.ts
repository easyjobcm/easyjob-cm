import { createAdminClient, createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BUCKET = "candidate-documents";

/**
 * Photo d'un candidat ayant postulé à une offre de l'entreprise connectée.
 *
 * L'autorisation vient de la RPC `company_job_applicants` (offre de
 * l'appelant, candidature de cette offre, photo présente). La clé service ne
 * sert ensuite qu'à lire ce seul objet du bucket privé ; ni son chemin ni
 * une URL signée ne sont transmis au navigateur.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; applicationId: string }> },
) {
  const notFound = () => new NextResponse(null, { status: 404 });
  try {
    const { id, applicationId } = await params;
    const ids = z
      .object({ jobId: z.string().uuid(), applicationId: z.string().uuid() })
      .safeParse({ jobId: id, applicationId });
    if (!ids.success) return notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new NextResponse(null, { status: 401 });

    const { data: rows, error } = await supabase.rpc("company_job_applicants", {
      p_job_id: ids.data.jobId,
    });
    const allowed = rows?.some(
      (r) => r.application_id === ids.data.applicationId && r.has_photo,
    );
    if (error || !allowed) return notFound();

    const admin = createAdminClient();
    const { data: row } = await admin
      .from("job_applications")
      .select("candidate:candidate_profiles(user_id, profile_photo_url)")
      .eq("id", ids.data.applicationId)
      .single();
    const path = row?.candidate?.profile_photo_url;
    // Chemin attendu : `<candidateUserId>/…` ; tout autre objet est refusé.
    if (!path || !path.startsWith(`${row?.candidate?.user_id}/`)) {
      return notFound();
    }

    const { data: file } = await admin.storage.from(BUCKET).download(path);
    if (!file) return notFound();

    return new NextResponse(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Applicant photo error:", error);
    return new NextResponse(null, { status: 500 });
  }
}
