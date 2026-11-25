import { createClient } from "@/lib/supabase/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  replacementInterestSchema,
  replacementRefusal,
} from "@/lib/validations/replacement";

/**
 * Lot 17d-4a (ANN-14, ANN-20) — confirmation d'intérêt explicite pour un
 * cycle de remplacement. La RPC `confirm_replacement_interest` (session du
 * candidat, RLS et SECURITY DEFINER) revérifie la fenêtre du cycle (H−2),
 * les places libérées, l'offre, le dossier de l'entreprise, le profil, la
 * CNI, les documents, la disponibilité avec la marge de 3 h et l'exclusion
 * du candidat à l'origine du désistement. Elle crée une nouvelle candidature
 * liée au cycle ; l'ancienne reste inchangée. Une relance renvoie la même
 * confirmation (`already_confirmed`). La route ne fait que valider et
 * traduire les codes.
 */
export async function POST(
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
        { error: "not_authenticated", code: "not_authenticated" },
        { status: 401 },
      );
    }

    const cycleId = z.string().uuid().safeParse(id);
    if (!cycleId.success) {
      return NextResponse.json(
        { error: "replacement_not_found", code: "replacement_not_found" },
        { status: 404 },
      );
    }

    const body = replacementInterestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!body.success) {
      return NextResponse.json(
        { error: "consent_required", code: "consent_required" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc("confirm_replacement_interest", {
      p_cycle_id: cycleId.data,
      p_consent: body.data.consent,
    });
    if (error) {
      const refusal = replacementRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      return internalErrorResponse("replacement.interest", error, {
        code: "replacement_failed",
        request,
      });
    }

    const row = data?.[0];
    if (!row?.application_id) {
      return internalErrorResponse("replacement.interest", null, {
        code: "replacement_failed",
        request,
      });
    }
    return NextResponse.json({
      success: true,
      application_id: row.application_id,
      already_confirmed: row.already_confirmed,
    });
  } catch (error) {
    return internalErrorResponse("replacement.interest", error, {
      code: "replacement_failed",
      request,
    });
  }
}
