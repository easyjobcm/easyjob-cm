import { describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import {
  applyRefusalFeedback,
  documentRequirementText,
} from "@/lib/jobs/application-feedback";

/**
 * Lot 9 : un refus de /apply est affiché dans la langue de l'interface à
 * partir de son code, avec l'étape suivante. Avant, le toast reprenait
 * `error` (« Already applied to this job ») même en français.
 */

// Messages anglais renvoyés par la route (`error`), à ne jamais afficher en français.
const ROUTE_ENGLISH = [
  "Unauthorized",
  "Candidate profile not found",
  "Please complete your profile first",
  "Job not found",
  "Job is not available",
  "No positions available",
  "Already applied to this job",
  "Failed to submit application",
];

const CODES = [
  ["not_authenticated", 401],
  ["profile_not_found", 404],
  ["onboarding_incomplete", 400],
  ["profile_incomplete", 400],
  ["profile_not_verified", 403],
  ["account_suspended", 403],
  ["job_not_found", 404],
  ["job_not_available", 400],
  ["no_positions", 400],
  ["already_applied", 400],
  ["application_failed", 500],
] as const;

describe("applyRefusalFeedback", () => {
  it.each(CODES)(
    "%s : message français, sans texte anglais de la route",
    (code, status) => {
      const f = applyRefusalFeedback(
        { status, code },
        fr.application,
        "/jobs/1",
      );
      expect(f.title).toBe(fr.application.errorTitle);
      expect(f.description).toBe(fr.application.refusals[code]);
      for (const english of ROUTE_ENGLISH)
        expect(f.description).not.toContain(english);
    },
  );

  it.each(CODES)("%s : message anglais distinct en anglais", (code, status) => {
    const f = applyRefusalFeedback({ status, code }, en.application, "/jobs/1");
    expect(f.description).toBe(en.application.refusals[code]);
    expect(f.description).not.toBe(fr.application.refusals[code]);
  });

  it("propose l'étape suivante adaptée", () => {
    const at = (code: string) =>
      applyRefusalFeedback({ status: 400, code }, fr.application, "/jobs/7")
        .action;
    expect(at("already_applied")).toEqual({
      label: fr.application.actions.myApplications,
      href: "/my-jobs",
    });
    expect(at("no_positions")?.href).toBe("/jobs");
    expect(at("profile_incomplete")?.href).toBe("/profile/candidate/edit");
    expect(at("onboarding_incomplete")?.href).toBe("/onboarding/candidate");
    expect(at("not_authenticated")?.href).toBe("/auth/login?next=%2Fjobs%2F7");
    expect(at("account_suspended")?.href).toMatch(
      /^mailto:support@easyjob\.cm/,
    );
    expect(at("application_failed")).toBeUndefined();
  });

  it("réseau : message de connexion, sans action (le bouton reste disponible)", () => {
    const f = applyRefusalFeedback({ status: null }, fr.application, "/jobs/1");
    expect(f.description).toBe(fr.application.refusals.network);
    expect(f.action).toBeUndefined();
  });

  it("lot 9b : le refus pour niveau Sandbox n'existe plus", () => {
    expect("sandbox_level_too_low" in fr.application.refusals).toBe(false);
    expect("sandbox_level_too_low" in en.application.refusals).toBe(false);
    const f = applyRefusalFeedback(
      { status: 403, code: "sandbox_level_too_low" },
      fr.application,
      "/jobs/1",
    );
    expect(f.description).toBe(fr.application.refusals.generic);
  });

  it("code inconnu : message générique traduit", () => {
    const f = applyRefusalFeedback(
      { status: 418, code: "teapot" },
      en.application,
      "/jobs/1",
    );
    expect(f.description).toBe(en.application.refusals.generic);
  });

  it("justificatif : texte traduit et page de gestion", () => {
    const cni = applyRefusalFeedback(
      {
        status: 403,
        code: "document_requirement",
        requirement: { document_type: "cni", state: "missing" },
      },
      en.application,
      "/jobs/1",
    );
    expect(cni.description).toBe(en.application.documents.missingCni);
    expect(cni.action?.href).toBe("/profile/documents");

    const skill = applyRefusalFeedback(
      {
        status: 403,
        code: "document_requirement",
        requirement: {
          document_type: "diplome",
          state: "missing",
          skill_name: "Électricité",
        },
      },
      fr.application,
      "/jobs/1",
    );
    expect(skill.description).toContain("« Électricité »");
    expect(skill.action?.href).toBe("/profile/skill-documents");
  });
});

describe("documentRequirementText", () => {
  it.each([
    [{ document_type: "x", state: "pending" as const }, "pending"],
    [{ document_type: "x", state: "rejected" as const }, "rejected"],
    [{ document_type: "x", state: "expired" as const }, "expired"],
  ])("état %o", (detail, key) => {
    expect(documentRequirementText(detail, fr.application.documents)).toBe(
      fr.application.documents[key as "pending"],
    );
  });

  it("type inconnu : libellé générique, jamais l'identifiant technique", () => {
    const text = documentRequirementText(
      { document_type: "inconnu_xyz", state: "missing" },
      fr.application.documents,
    );
    expect(text).not.toContain("inconnu_xyz");
    expect(text).toContain(fr.application.documents.labels.autre);
  });
});
