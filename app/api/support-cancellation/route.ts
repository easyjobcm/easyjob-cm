import { NextRequest } from "next/server";
import {
  interventionAction,
  interventionRead,
} from "@/lib/api/intervention-route";
import { supportCancellationSchema } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 (ANN-18) — candidat suspendu : « Demander l'annulation au
 * support ». GET : journées couvertes par la suspension et demandes. POST :
 * demande tracée ; aucune annulation ni manquement avant la décision d'un
 * ops ou fondateur actif.
 */
export async function GET(request: NextRequest) {
  return interventionRead(request, null, "support_cancellation.preview", (s) =>
    s.rpc("support_cancellation_preview"),
  );
}

export async function POST(request: NextRequest) {
  return interventionAction(
    request,
    null,
    supportCancellationSchema,
    "support_cancellation.request",
    (s, _id, b) =>
      s.rpc("request_support_cancellation", {
        p_request_id: b.request_id,
        p_day_ids: b.day_ids,
        // null accepté par la RPC : types générés sans nullabilité.
        p_message: b.message as string,
      }),
  );
}
