import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { interventionRead } from "@/lib/api/intervention-route";

/**
 * Lot 17d-3 (SAN-08) — constats d'absence de la session (candidat ou
 * entreprise). L'entreprise ne reçoit ni la version, ni les pièces, ni la
 * note de décision du candidat.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("mission_id");
  const mission = raw === null ? null : z.string().uuid().safeParse(raw);
  if (mission && !mission.success) {
    return NextResponse.json(
      { error: "mission_not_found", code: "mission_not_found" },
      { status: 404 },
    );
  }
  return interventionRead(request, null, "absence_findings.mine", (s) =>
    s.rpc("my_absence_findings", {
      // null : tous les constats de la session.
      p_mission_id: (mission?.data ?? null) as string,
    }),
  );
}
