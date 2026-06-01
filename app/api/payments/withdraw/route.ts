import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const WithdrawSchema = z.object({
  amount: z.number().min(1000),
  payment_method: z.enum(["mtn_momo", "orange_money"]),
  phone_number: z.string().min(8),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!userRow || userRow.role !== "candidate") {
      return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = WithdrawSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Donnees invalides" }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: "Retrait indisponible en MVP: paiement par mission uniquement.",
        details: {
          accepted_payload: parsed.data,
        },
      },
      { status: 410 },
    );
  } catch (error) {
    console.error("[v0] Withdrawal error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!userRow || userRow.role !== "candidate") {
      return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
    }

    return NextResponse.json({
      withdrawals: [],
      message: "Retrait indisponible en MVP",
    });
  } catch (error) {
    console.error("[v0] Get withdrawals error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
