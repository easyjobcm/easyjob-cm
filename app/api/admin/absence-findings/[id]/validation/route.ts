import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingValidationSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — Seconde validation par un autre ops ou fondateur actif. Aucun effet sur la réputation, les sanctions ni les montants. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingValidationSchema,
    "admin.absence_findings.validation",
    (s, id, b) =>
      s.rpc("admin_validate_absence_finding", {
        p_finding_id: id!,
        p_approve: b.approve,
        p_note: b.note,
        p_expected_revision: b.expected_revision,
      }),
    "finding_not_found",
  );
}
