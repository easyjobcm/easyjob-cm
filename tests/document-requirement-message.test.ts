import { describe, expect, it } from "vitest";
import {
  documentRequirementMessage,
  parseDocumentRequirementDetail,
} from "@/lib/matching/skill-document-requirements";

// Messages historiques de checkJobDocumentRequirements, conservés depuis
// que la décision est prise par la RPC apply_to_job (lot 2).
describe("documentRequirementMessage", () => {
  it.each([
    [
      { document_type: "cni", state: "missing" },
      "Cette offre exige une CNI vérifiée pour postuler.",
    ],
    [
      { document_type: "driving_license", state: "missing" },
      "Cette offre exige un permis de conduire valide pour postuler.",
    ],
    [
      { document_type: "casier_judiciaire", state: "missing" },
      "Cette offre exige un casier judiciaire valide pour postuler.",
    ],
    [
      { document_type: "inconnu", state: "missing" },
      "Cette offre exige un inconnu valide pour postuler.",
    ],
    [
      { document_type: "diplome", state: "missing", skill_name: "Électricité" },
      "Cette offre exige un diplôme ou certificat valide pour la compétence « Électricité ».",
    ],
    [
      { document_type: "cni", state: "pending" },
      "Votre justificatif est encore en cours de vérification.",
    ],
    [
      { document_type: "diplome", state: "rejected", skill_name: "Soudure" },
      "Votre justificatif a été refusé. Consultez votre profil pour le remplacer.",
    ],
    [
      { document_type: "driving_license", state: "expired" },
      "Votre justificatif a expiré. Mettez-le à jour pour postuler.",
    ],
  ] as const)("%o", (detail, expected) => {
    expect(documentRequirementMessage(detail)).toBe(expected);
  });
});

describe("parseDocumentRequirementDetail", () => {
  it("lit le détail JSON de la RPC", () => {
    expect(
      parseDocumentRequirementDetail(
        '{"document_type":"diplome","skill_name":"Soudure","state":"pending"}',
      ),
    ).toEqual({
      document_type: "diplome",
      skill_name: "Soudure",
      state: "pending",
    });
  });

  it.each([null, undefined, "", "pas du json", '{"state":"missing"}'])(
    "rejette %o",
    (raw) => {
      expect(parseDocumentRequirementDetail(raw)).toBeNull();
    },
  );

  it("rejette un état inconnu", () => {
    expect(
      parseDocumentRequirementDetail('{"document_type":"cni","state":"ok"}'),
    ).toBeNull();
  });
});
