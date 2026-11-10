import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext, missionRpcError } from "@/lib/api/mission-route";
import { missionReviewSchema } from "@/lib/validations/mission";
import { internalErrorResponse } from "@/lib/api/errors";

/**
 * Évaluation après réalisation (RPC `submit_mission_review`). La base déduit
 * le sens de la session (candidat → entreprise, entreprise → candidat),
 * n'accepte qu'une évaluation par auteur, mission et sens, vérifie les motifs
 * (obligatoires sous 3) et met à jour la réputation du profil évalué. Une
 * relance renvoie l'évaluation d'origine. La réponse ne contient ni motifs ni
 * commentaire.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await missionRouteContext(params);
    if (ctx.error) return ctx.error;

    const parsed = missionReviewSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message;
      const code =
        message === "comment_too_long" ||
        message === "reasons_required" ||
        message === "reasons_invalid"
          ? message
          : "rating_invalid";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }

    const { data, error } = await ctx.supabase.rpc("submit_mission_review", {
      p_mission_id: ctx.missionId,
      p_rating: parsed.data.rating,
      p_comment: parsed.data.comment ?? undefined,
      p_reasons: parsed.data.reasons,
    });
    if (error)
      return missionRpcError(
        error,
        "missions.review",
        "review_failed",
        request,
      );

    const review = data[0];
    if (!review?.review_id) {
      return internalErrorResponse("missions.review", null, {
        code: "review_failed",
        request,
        reason: "result_mismatch",
      });
    }
    return NextResponse.json({ review });
  } catch (error) {
    return internalErrorResponse("missions.review", error, {
      code: "review_failed",
      request,
    });
  }
}
