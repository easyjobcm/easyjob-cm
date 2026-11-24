import { NextRequest } from "next/server";
import { interventionAction } from "@/lib/api/intervention-route";
import { findingAnswerSchema } from "@/lib/validations/support-intervention";

/** Lot 17d-3 (SAN-08) — version du candidat, jusqu'à l'échéance de 72 h incluse. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return interventionAction(
    request,
    params,
    findingAnswerSchema,
    "absence_findings.answer",
    (s, id, b) =>
      s.rpc("answer_absence_finding", {
        p_finding_id: id!,
        p_statement: b.statement,
      }),
    "finding_not_found",
  );
}
