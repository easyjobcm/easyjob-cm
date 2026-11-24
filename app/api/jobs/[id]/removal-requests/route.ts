import { NextRequest } from "next/server";
import {
  interventionAction,
  interventionRead,
} from "@/lib/api/intervention-route";
import { targetedRemovalSchema } from "@/lib/validations/support-intervention";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Lot 17d-3 (ANN-16, ANN-17) — retrait ciblé d'un candidat, demandé par
 * l'entreprise et décidé par le support (ops ou fondateur actif) avant le
 * début. GET : demandes de l'offre (motif, décision). POST : demande tracée,
 * motif obligatoire ; rien ne change avant la décision.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  return interventionRead(
    request,
    params,
    "removal_requests.list",
    (s, id) => s.rpc("my_targeted_removals", { p_job_id: id! }),
    "job_not_found",
  );
}

export async function POST(request: NextRequest, { params }: Ctx) {
  return interventionAction(
    request,
    params,
    targetedRemovalSchema,
    "removal_requests.create",
    (s, id, b) =>
      s.rpc("request_targeted_removal", {
        p_request_id: b.request_id,
        p_job_id: id!,
        p_day_ids: b.day_ids,
        p_reason: b.reason,
      }),
    "job_not_found",
  );
}
