import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingProposalSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — Proposition du premier validateur (ops ou fondateur actif). Aucun effet sur la réputation, les sanctions ni les montants. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingProposalSchema,
    "admin.absence_findings.proposal",
    (s, id, b) =>
      s.rpc("admin_propose_absence_finding", {
        p_finding_id: id!,
        p_outcome: b.outcome,
        p_note: b.note,
        p_expected_revision: b.expected_revision,
      }),
    "finding_not_found",
  );
}
