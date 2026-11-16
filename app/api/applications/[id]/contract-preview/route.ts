import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobRefusal } from "@/lib/validations/job";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Contrat proposé pour une candidature, avant « Signer et sélectionner »
 * (RPC `contract_selection_preview`, lot 13).
 *
 * Lecture seule : la base refait tous les contrôles de la sélection sans
 * rien écrire ni verrouiller. Fermer l'aperçu laisse la candidature en
 * attente et la place libre. L'empreinte renvoyée est celle que l'entreprise
 * présentera en signant ; la base la recompare à la sélection.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "not_authenticated" },
        { status: 401 },
      );
    }

    const applicationId = z.string().uuid().safeParse(id);
    if (!applicationId.success) {
      return NextResponse.json(
        { error: "application_not_found", code: "application_not_found" },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.rpc("contract_selection_preview", {
      p_application_id: applicationId.data,
    });
    if (error) {
      const refusal = jobRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      return internalErrorResponse("applications.contract_preview", error, {
        code: "preview_failed",
        request,
      });
    }

    const preview = data[0];
    if (!preview || !/^[0-9a-f]{64}$/.test(preview.terms_hash ?? "")) {
      return internalErrorResponse("applications.contract_preview", null, {
        code: "preview_failed",
        request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json(
      { preview },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return internalErrorResponse("applications.contract_preview", error, {
      code: "preview_failed",
      request,
    });
  }
}
