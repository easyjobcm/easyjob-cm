import { describe, expect, it } from "vitest";
import {
  classifySupabaseUrl,
  describeTarget,
} from "@/scripts/lib/supabase-target";

describe("pnpm env:target : base visée", () => {
  it("distingue développement, preuve, autre pile locale et distant", () => {
    expect(classifySupabaseUrl("http://127.0.0.1:54321").kind).toBe("dev");
    expect(classifySupabaseUrl("http://localhost:54421/").kind).toBe("proof");
    expect(classifySupabaseUrl("http://127.0.0.1:54521").kind).toBe("local");
    expect(
      classifySupabaseUrl("https://abcdefghijklmnopqrst.supabase.co"),
    ).toEqual({
      kind: "remote",
      url: "https://abcdefghijklmnopqrst.supabase.co",
      projectRef: "abcdefghijklmnopqrst",
    });
    // Sous-chaîne « localhost » : distant, pas local.
    expect(classifySupabaseUrl("https://localhost.evil.example").kind).toBe(
      "remote",
    );
  });

  it("signale l'exemple, l'absence et une URL invalide", () => {
    expect(
      classifySupabaseUrl("https://YOUR_PROJECT_REF.supabase.co").kind,
    ).toBe("placeholder");
    expect(classifySupabaseUrl(undefined).kind).toBe("missing");
    expect(classifySupabaseUrl("pas une url").kind).toBe("invalid");
    expect(
      describeTarget(classifySupabaseUrl("http://127.0.0.1:54421")),
    ).toContain("easyjob-proof");
  });
});
