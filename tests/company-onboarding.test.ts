import { describe, expect, it } from "vitest";
import { companyOnboardingSchema } from "@/lib/validations/company";
import { detectDocumentMime } from "@/lib/utils/file-type";
import { formatCurrency } from "@/lib/utils";
import { isProfileLockGroup } from "@/lib/utils/profile-lock";

const valid = {
  company_name: "EasyJob Cameroun SARL",
  sector: "restaurant",
  company_size: "pme",
  website: "",
  description: "",
  rccm: "RC/DLA/2024/B/1234",
  city: "Douala",
  quartier: "Akwa",
  address: "Rue Joss",
};

const issueCodes = (input: Record<string, unknown>) => {
  const parsed = companyOnboardingSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};

// F-14 : l'onboarding entreprise écrit dans company_profiles (colonnes réelles).
describe("companyOnboardingSchema", () => {
  it("accepte un onboarding complet et convertit les champs facultatifs vides en null", () => {
    const parsed = companyOnboardingSchema.parse(valid);
    expect(parsed.website).toBeNull();
    expect(parsed.description).toBeNull();
    expect(parsed.company_size).toBe("pme");
  });

  it("n'écrit ni NIU, ni vérification, ni abonnement", () => {
    const parsed = companyOnboardingSchema.parse({
      ...valid,
      niu: "M012345678901Z",
      verification_status: "verified",
      niu_verified: true,
      subscription_plan: "premium",
      onboarding_status: "completed",
    });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(valid).sort());
  });

  it.each([
    ["company_name", "A", "companyNameTooShort"],
    ["sector", "", "sectorRequired"],
    ["company_size", "51-200", "companySizeRequired"],
    ["rccm", "   ", "rccmRequired"],
    ["city", "douala", "cityRequired"],
    ["quartier", "", "quartierRequired"],
    ["address", "", "addressRequired"],
  ])("refuse %s = %j (%s)", (field, value, code) => {
    expect(issueCodes({ ...valid, [field]: value })).toContain(code);
  });

  it.each(["javascript:alert(1)", "www.example", "ftp://example.com"])(
    "refuse le site web %j",
    (website) => {
      expect(issueCodes({ ...valid, website })).toContain("websiteInvalid");
    },
  );

  it("accepte un site web http(s)", () => {
    expect(issueCodes({ ...valid, website: "https://easyjob.cm" })).toEqual([]);
  });
});

describe("detectDocumentMime", () => {
  it.each([
    [[0x25, 0x50, 0x44, 0x46, 0x2d], "application/pdf"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d], "image/png"],
    [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
  ])("reconnaît %j", (bytes, mime) => {
    expect(detectDocumentMime(new Uint8Array(bytes))).toBe(mime);
  });

  it("refuse un contenu inconnu, quel que soit le nom du fichier", () => {
    expect(
      detectDocumentMime(new TextEncoder().encode("<html>rccm.pdf")),
    ).toBeNull();
  });
});

describe("formatCurrency", () => {
  it("utilise XAF quand la devise est absente ou null en base", () => {
    expect(formatCurrency(1500, null)).toBe(formatCurrency(1500, "XAF"));
    expect(formatCurrency(1500)).toBe(formatCurrency(1500, "XAF"));
  });
});

describe("isProfileLockGroup", () => {
  it("ne retient que les groupes autorisés par la contrainte SQL", () => {
    expect(
      ["identity", "cni_documents", "other"].filter(isProfileLockGroup),
    ).toEqual(["identity", "cni_documents"]);
  });
});
