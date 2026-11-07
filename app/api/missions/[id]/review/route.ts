import { NextRequest, NextResponse } from "next/server";
import { missionRouteContext, missionRpcError } from "@/lib/api/mission-route";
import { missionReviewSchema } from "@/lib/validations/mission";

/**
 * Évaluation après réalisation (RPC `submit_mission_review`). La base déduit
 * le sens de la session (candidat → entreprise, entreprise → candidat),
 * n'accepte qu'une évaluation par auteur, mission et sens, et met à jour les
 * étoiles du profil évalué. Une relance renvoie l'évaluation d'origine.
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
      const code =
        parsed.error.issues[0]?.message === "comment_too_long"
          ? "comment_too_long"
          : "rating_invalid";
      return NextResponse.json({ error: code, code }, { status: 400 });
    }

    const { data, error } = await ctx.supabase.rpc("submit_mission_review", {
      p_mission_id: ctx.missionId,
      p_rating: parsed.data.rating,
      p_comment: parsed.data.comment ?? undefined,
    });
    if (error)
      return missionRpcError(error, "Mission review error", "review_failed");

    const review = data[0];
    if (!review?.review_id) {
      console.error("Mission review mismatch");
      return NextResponse.json(
        { error: "Internal server error", code: "review_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ review });
  } catch (error) {
    console.error("Mission review error:", (error as Error).message);
    return NextResponse.json(
      { error: "Internal server error", code: "review_failed" },
      { status: 500 },
    );
  }
}
