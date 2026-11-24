import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingReviewDecisionSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — Recours tranché par un agent distinct des deux validateurs. Aucun effet sur la réputation, les sanctions ni les montants. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingReviewDecisionSchema,
    "admin.absence_findings.review",
    (s, id, b) =>
      s.rpc("admin_decide_absence_finding_review", {
        p_finding_id: id!,
        p_outcome: b.outcome,
        p_note: b.note,
      }),
    "finding_not_found",
  );
}
