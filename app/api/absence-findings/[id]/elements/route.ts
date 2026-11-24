import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingElementSchema } from "@/lib/validations/support-intervention";

/**
 * Lot 17d-3 (SAN-08, décision du 2026-11-24) — nouvel élément transmis au
 * support par une partie, à tout moment : ni infirmation, ni réouverture,
 * ni nouveau délai.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingElementSchema,
    "absence_findings.element",
    (s, id, b) =>
      s.rpc("submit_absence_finding_element", {
        p_finding_id: id!,
        p_text: b.text,
      }),
    "finding_not_found",
  );
}
