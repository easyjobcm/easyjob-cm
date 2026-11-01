import { describe, expect, it } from "vitest";
import { availabilitySchema, paymentSchema } from "@/lib/validations/profile";
import {
  skillDocumentModerateSchema,
  skillDocumentUploadSchema,
} from "@/lib/validations/skill-documents";

const SKILL_ID = "3f2b8c1e-4d5a-4b6c-8e7f-9a0b1c2d3e4f";

const validDay = { day_of_week: 1, start_time: "08:00", end_time: "17:00" };

const validUpload = {
  document_type: "certificat",
  title: "CAP électricité",
  skill_ids: [SKILL_ID],
  confirm_accurate: true,
};

describe("availabilitySchema (PATCH /api/profile/availability)", () => {
  it("accepte une semaine valide", () => {
    const r = availabilitySchema.safeParse({
      days: [validDay],
      max_travel_distance_km: 15,
    });
    expect(r.success).toBe(true);
  });

  it("refuse une heure invalide et une plage inversée", () => {
    const r = availabilitySchema.safeParse({
      days: [
        { ...validDay, start_time: "25:00" },
        { ...validDay, start_time: "18:00", end_time: "09:00" },
      ],
      max_travel_distance_km: 15,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(["timeInvalid", "timeRangeInvalid"]),
    );
  });

  it("refuse une distance hors bornes", () => {
    const r = availabilitySchema.safeParse({
      days: [],
      max_travel_distance_km: 500,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["max_travel_distance_km"]);
  });

  it("rejette un tableau surdimensionné sur sa borne, sans valider chaque élément", () => {
    const r = availabilitySchema.safeParse({
      days: Array.from({ length: 5000 }, () => ({ day_of_week: "x" })),
      max_travel_distance_km: 15,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toHaveLength(1);
    expect(r.error?.issues[0]).toMatchObject({
      code: "too_big",
      path: ["days"],
    });
  });
});

describe("skillDocumentUploadSchema (POST /api/profile/skill-documents)", () => {
  it("accepte un justificatif valide", () => {
    expect(skillDocumentUploadSchema.safeParse(validUpload).success).toBe(true);
  });

  it("refuse un identifiant de compétence qui n'est pas un UUID", () => {
    const r = skillDocumentUploadSchema.safeParse({
      ...validUpload,
      skill_ids: ["not-a-uuid"],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["skill_ids", 0]);
  });

  it("exige la confirmation et la catégorie du permis", () => {
    const noConfirm = skillDocumentUploadSchema.safeParse({
      ...validUpload,
      confirm_accurate: false,
    });
    expect(noConfirm.error?.issues[0]?.message).toBe("confirmRequired");

    const noCategory = skillDocumentUploadSchema.safeParse({
      ...validUpload,
      document_type: "permis_conduire",
    });
    expect(noCategory.success).toBe(false);
  });

  it("rejette une liste de compétences surdimensionnée sur sa borne", () => {
    const r = skillDocumentUploadSchema.safeParse({
      ...validUpload,
      skill_ids: Array.from({ length: 5000 }, () => "x"),
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toHaveLength(1);
    expect(r.error?.issues[0]).toMatchObject({
      code: "too_big",
      path: ["skill_ids"],
    });
  });
});

describe("skillDocumentModerateSchema", () => {
  it("exige un motif pour un refus", () => {
    expect(
      skillDocumentModerateSchema.safeParse({ action: "reject" }).success,
    ).toBe(false);
    expect(
      skillDocumentModerateSchema.safeParse({
        action: "reject",
        rejection_reason: "Illisible",
      }).success,
    ).toBe(true);
  });
});

describe("paymentSchema (PATCH /api/profile/payment)", () => {
  it("normalise le numéro et refuse un opérateur inconnu", () => {
    const ok = paymentSchema.safeParse({
      momo_provider: "mtn",
      momo_number: "6 12 34 56 78",
    });
    expect(ok.success && ok.data.momo_number).toBe("612345678");

    const bad = paymentSchema.safeParse({
      momo_provider: "paypal",
      momo_number: "612345678",
    });
    expect(bad.error?.issues[0]?.message).toBe("momoProviderInvalid");
  });
});
