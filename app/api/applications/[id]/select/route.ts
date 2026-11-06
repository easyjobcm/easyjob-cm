import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobRefusal } from "@/lib/validations/job";

/**
 * Sélection d'un candidat par l'entreprise (RPC `select_candidate`).
 *
 * La base contrôle l'offre, la candidature et les places, puis crée la
 * mission, le contrat et la notification dans la même transaction. Une
 * relance sur une candidature déjà sélectionnée renvoie les mêmes liens sans
 * nouvelle écriture (`already_selected`).
 */
export async function POST(
  _request: NextRequest,
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
        { error: "Application not found", code: "application_not_found" },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.rpc("select_candidate", {
      p_application_id: applicationId.data,
    });
    if (error) {
      const refusal = jobRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      console.error("Selection error:", error);
      return NextResponse.json(
        { error: "Internal server error", code: "selection_failed" },
        { status: 500 },
      );
    }

    const selection = data[0];
    if (
      !selection ||
      selection.status !== "selected" ||
      !selection.mission_id ||
      !selection.contract_id
    ) {
      console.error("Selection mismatch:", selection);
      return NextResponse.json(
        { error: "Internal server error", code: "selection_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({ selection });
  } catch (error) {
    console.error("Selection error:", error);
    return NextResponse.json(
      { error: "Internal server error", code: "selection_failed" },
      { status: 500 },
    );
  }
}
