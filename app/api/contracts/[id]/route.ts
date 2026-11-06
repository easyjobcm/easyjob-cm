import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { contractRefusal } from "@/lib/validations/contract";

/**
 * Contrat vu par l'une de ses parties (RPC `get_contract`, lot 7b).
 *
 * La base déduit la partie de la session, renvoie les conditions figées à la
 * sélection, leur empreinte et l'état des deux signatures. Ni IP, ni
 * identifiant de signataire, ni donnée sensible du candidat (F-16).
 */
export async function GET(
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

    const contractId = z.string().uuid().safeParse(id);
    if (!contractId.success) {
      return NextResponse.json(
        { error: "contract_not_found", code: "contract_not_found" },
        { status: 404 },
      );
    }

    const { data, error } = await supabase.rpc("get_contract", {
      p_contract_id: contractId.data,
    });
    if (error) {
      const refusal = contractRefusal(error.message);
      if (refusal) {
        return NextResponse.json(
          { error: refusal.code, code: refusal.code },
          { status: refusal.status },
        );
      }
      console.error("Contract read error:", error.code);
      return NextResponse.json(
        { error: "Internal server error", code: "contract_failed" },
        { status: 500 },
      );
    }

    const contract = data[0];
    if (!contract) {
      return NextResponse.json(
        { error: "contract_not_found", code: "contract_not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { contract },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Contract read error:", (error as Error).message);
    return NextResponse.json(
      { error: "Internal server error", code: "contract_failed" },
      { status: 500 },
    );
  }
}
