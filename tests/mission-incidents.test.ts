import { describe, expect, it } from "vitest";
import {
  INCIDENT_KINDS_BY_PARTY,
  INCIDENT_RPC_REFUSALS,
  incidentBodyRefusal,
  incidentDecisionSchema,
  incidentRefusal,
  incidentReportSchema,
} from "@/lib/validations/incident";
import { DOMAINS, parseSignal } from "@/lib/realtime/signals";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

const DAY = "6f1c0b9e-6a4e-4f7b-9a43-0e6f1e2b3c4d";

describe("signalement d'incident (lot 14)", () => {
  it("accepte un retard avec sa durée, refuse une durée hors retard", () => {
    expect(
      incidentReportSchema.safeParse({
        mission_day_id: DAY,
        kind: "late",
        statement: "Arrivé avec 30 minutes de retard.",
        late_minutes: 30,
      }).success,
    ).toBe(true);
    const r = incidentReportSchema.safeParse({
      mission_day_id: DAY,
      kind: "absence",
      statement: "Absent toute la journée.",
      late_minutes: 30,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("late_minutes_invalid");
  });

  it("exige une déclaration de 10 à 2000 caractères", () => {
    const r = incidentReportSchema.safeParse({
      mission_day_id: DAY,
      kind: "absence",
      statement: "court",
    });
    expect(r.error?.issues[0]?.message).toBe("statement_invalid");
  });

  it("réserve « code non remis » au candidat", () => {
    expect(INCIDENT_KINDS_BY_PARTY.candidate).toContain("code_not_received");
    expect(INCIDENT_KINDS_BY_PARTY.company).not.toContain(
      "code_not_received" as never,
    );
  });

  it("décision : résultat connu et motif obligatoire", () => {
    expect(
      incidentDecisionSchema.safeParse({ outcome: "established", note: "x" })
        .error?.issues[0]?.message,
    ).toBe("note_invalid");
    expect(
      incidentDecisionSchema.safeParse({
        outcome: "sanction",
        note: "Motif suffisamment long.",
      }).success,
    ).toBe(false);
  });

  it("traduit chaque code de refus en FR et EN, avec son statut HTTP", () => {
    for (const code of Object.keys(INCIDENT_RPC_REFUSALS)) {
      expect(
        fr.incidents.errors[code as keyof typeof fr.incidents.errors],
      ).toBeTruthy();
      expect(
        en.incidents.errors[code as keyof typeof en.incidents.errors],
      ).toBeTruthy();
    }
    expect(incidentRefusal("day_already_confirmed")).toEqual({
      code: "day_already_confirmed",
      status: 409,
    });
    expect(incidentRefusal("unknown")).toBeNull();
    expect(incidentBodyRefusal("no")).toBe("invalid_request");
  });

  it("signal privé « incidents » accepté (compte et admin)", () => {
    expect(DOMAINS).toContain("incidents");
    expect(parseSignal("self", { d: "incidents", r: DAY })).toEqual({
      key: "incidents",
      resource: DAY,
    });
    expect(parseSignal("admin", { d: "incidents", r: DAY })).toEqual({
      key: "admin:incidents",
      resource: null,
    });
  });
});
