import { NextRequest } from "next/server";
import { interventionRead } from "@/lib/api/intervention-route";

/**
 * Lot 17d-3 — file du support : retraits ciblés, tâches de suspension,
 * demandes des candidats suspendus. Lecture : tout admin actif (grade
 * revérifié en base, compte actif exigé).
 */
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get("status");
  return interventionRead(request, null, "admin.engagement_requests", (s) =>
    s.rpc("admin_engagement_requests", {
      p_status: (status === "pending" ||
      status === "accepted" ||
      status === "refused"
        ? status
        : null) as string,
    }),
  );
}
