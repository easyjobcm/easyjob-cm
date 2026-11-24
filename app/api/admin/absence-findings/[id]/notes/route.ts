import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingNoteSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — note d'instruction : tout admin actif, support compris, sans pouvoir de décision. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingNoteSchema,
    "admin.absence_findings.note",
    (s, id, b) =>
      s.rpc("admin_add_absence_finding_note", {
        p_finding_id: id!,
        p_note: b.note,
      }),
    "finding_not_found",
  );
}
