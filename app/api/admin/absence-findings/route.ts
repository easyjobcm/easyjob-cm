import { NextRequest } from "next/server";
import {
  interventionAction,
  interventionRead,
} from "@/lib/api/intervention-route";
import { findingOpenSchema } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 (SAN-08) — constats d'absence. GET : constats et signalements
 * d'absence sans constat (tout admin actif). POST : ouverture de
 * l'instruction (tout admin actif), en parallèle du lot 16.
 */
export async function GET(request: NextRequest) {
  return interventionRead(request, null, "admin.absence_findings", (s) =>
    s.rpc("admin_absence_findings", {}),
  );
}

export async function POST(request: NextRequest) {
  return interventionAction(
    request,
    null,
    findingOpenSchema,
    "admin.absence_findings.open",
    (s, _id, b) =>
      s.rpc("admin_open_absence_finding", { p_incident_id: b.incident_id }),
  );
}
