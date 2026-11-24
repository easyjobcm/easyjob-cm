import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingReviewRequestSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — recours d'une partie, 7 jours après la décision. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingReviewRequestSchema,
    "absence_findings.review",
    (s, id, b) =>
      s.rpc("request_absence_finding_review", {
        p_finding_id: id!,
        p_note: b.statement,
      }),
    "finding_not_found",
  );
}
