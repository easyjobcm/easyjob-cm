import { describe, expect, it } from "vitest";
import { renderPdf, textWidth, toWinAnsi, wrapText } from "@/lib/contracts/pdf";
import {
  contractPdf,
  contractPdfBlocks,
  type ContractPdfSource,
} from "@/lib/contracts/contract-pdf";
import { parseContractTerms } from "@/lib/contracts/terms";
import { displayApplicationStatus } from "@/lib/jobs/application-status";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

const CLAUSES = {
  version: "formal-v3",
  fr: {
    intro: "Le présent contrat est conclu entre les parties ci-dessus.",
    candidate_title: "Le candidat s'engage à",
    candidate: ["se présenter à l'heure ;", "utiliser le pointage EasyJob."],
    company_title: "L'entreprise s'engage à",
    company: ["fournir un environnement de travail sûr ;"],
    consent: "J'ai lu les conditions ci-dessus et je les accepte.",
  },
  en: {
    intro: "This contract is concluded between the parties above.",
    candidate_title: "The candidate agrees to",
    candidate: ["arrive on time;", "use EasyJob check-in."],
    company_title: "The company agrees to",
    company: ["provide a safe working environment;"],
    consent: "I have read the terms above and accept them.",
  },
};

const CONTRACT: ContractPdfSource = {
  contract_id: "1b2c3d4e-0000-4000-8000-000000000000",
  contract_template: "formal",
  terms: {
    job_title: "Équipe d'accueil événementiel",
    company_name: "Restaurant Étoile",
    schedule_format: "full_period",
    start_date: "2099-09-01",
    end_date: "2099-09-04",
    start_time: "09:00:00",
    end_time: "17:00:00",
    day_count: 3,
    days: [
      { date: "2099-09-01", start_time: "09:00:00", end_time: "17:00:00" },
      { date: "2099-09-02", start_time: "22:00:00", end_time: "06:00:00" },
      { date: "2099-09-04", start_time: "09:00:00", end_time: "17:00:00" },
    ],
    break_minutes: 30,
    address: "Boulevard de la Liberté",
    city: "Douala",
    mission_pay_per_candidate: 45000,
    currency: "XAF",
    pay_basis: "per_mission",
    clauses: CLAUSES,
  },
  terms_hash: "a".repeat(64),
  company_name: "Restaurant Étoile",
  candidate_name: "Aline M.",
  viewer_signed: true,
  needs_review: false,
  can_sign: false,
};

/** Texte des chaînes hexadécimales d'un PDF produit par renderPdf. */
function pdfText(bytes: Uint8Array): string {
  const back: Record<number, string> = { 0x92: "’", 0x96: "–", 0x95: "•" };
  const raw = Buffer.from(bytes).toString("latin1");
  return [...raw.matchAll(/<([0-9a-f]*)> Tj/g)]
    .map((m) =>
      (m[1].match(/../g) ?? [])
        .map((h) => parseInt(h, 16))
        .map((b) => back[b] ?? String.fromCharCode(b))
        .join(""),
    )
    .join("\n");
}

describe("toWinAnsi", () => {
  it("garde les accents français, guillemets et tirets en WinAnsi", () => {
    expect(toWinAnsi("é")).toEqual([0xe9]);
    expect(toWinAnsi("Ç")).toEqual([0xc7]);
    expect(toWinAnsi("« »")).toEqual([0xab, 0x20, 0xbb]);
    expect(toWinAnsi("’–€œ")).toEqual([0x92, 0x96, 0x80, 0x9c]);
  });

  it("remplace les espaces insécables des montants et les caractères non couverts", () => {
    expect(toWinAnsi("45 000 F")).toEqual(toWinAnsi("45 000 F"));
    expect(toWinAnsi("→")).toEqual(toWinAnsi("->"));
    expect(toWinAnsi("😀")).toEqual([0x3f]);
  });

  it("normalise les accents décomposés (NFD)", () => {
    expect(toWinAnsi("é")).toEqual([0xe9]);
  });
});

describe("wrapText", () => {
  it("ne dépasse jamais la largeur demandée", () => {
    const text =
      "Le candidat s'engage à se présenter à l'heure convenue sur le lieu de la mission et à utiliser le pointage EasyJob.";
    const lines = wrapText(text, 10, 120);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines)
      expect(textWidth(line, 10)).toBeLessThanOrEqual(120);
    expect(lines.join(" ")).toBe(text);
  });

  it("coupe un mot plus long que la ligne", () => {
    const lines = wrapText("a".repeat(200), 10, 100);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("a".repeat(200));
  });
});

describe("renderPdf", () => {
  it("produit un PDF dont la table xref pointe sur chaque objet", () => {
    const bytes = renderPdf(
      [
        { kind: "title", text: "Contrat" },
        ...Array.from({ length: 120 }, (_, i) => ({
          kind: "bullet" as const,
          text: `Ligne ${i} avec accents éèà`,
        })),
      ],
      { title: "Contrat É", footer: "EasyJob CM" },
    );
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(raw)?.[1]);
    expect(raw.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...raw.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map(
      (m) => Number(m[1]),
    );
    offsets.forEach((offset, i) => {
      expect(raw.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
    // Pagination : plusieurs pages, pied « n / N » sur chacune.
    const pages = Number(/\/Count (\d+)/.exec(raw)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(pdfText(bytes)).toContain(`EasyJob CM · ${pages} / ${pages}`);
  });
});

describe("contractPdf", () => {
  it("contient les conditions figées : accents, montant, toutes les journées, clauses", () => {
    const text = pdfText(contractPdf(CONTRACT, "fr", fr, new Date()));
    expect(text).toContain("Équipe d'accueil événementiel");
    expect(text).toContain("mardi 1 septembre 2099 : 09:00 – 17:00");
    expect(text).toContain("mercredi 2 septembre 2099 : 22:00 – 06:00 (+1 j)");
    expect(text).toContain("vendredi 4 septembre 2099");
    expect(text).toContain("45 000 F CFA");
    expect(text).toContain("Boulevard de la Liberté, Douala");
    expect(text).toContain(CLAUSES.fr.intro);
    expect(text).toContain("Version des clauses : formal-v3");
    expect(text).toContain("Aline M.");
  });

  it("ne mentionne que la signature du lecteur, jamais celle de l'autre partie", () => {
    const signed = pdfText(contractPdf(CONTRACT, "fr", fr, new Date()));
    expect(signed).toContain(fr.contract.viewerState.signed);
    const toSign = pdfText(
      contractPdf(
        { ...CONTRACT, viewer_signed: false, can_sign: true },
        "fr",
        fr,
        new Date(),
      ),
    );
    expect(toSign).toContain(fr.contract.viewerState.toSign);
    for (const text of [signed, toSign]) {
      expect(text).not.toMatch(
        /Signé le|signé par l'entreprise|signé par le candidat/i,
      );
    }
  });

  it("traduit le document en anglais à partir des clauses anglaises figées", () => {
    const text = pdfText(contractPdf(CONTRACT, "en", en, new Date()));
    expect(text).toContain("Tuesday, 1 September 2099: 09:00 – 17:00");
    expect(text).toContain("45,000 CFA francs");
    expect(text).toContain(CLAUSES.en.intro);
    expect(text).toContain(en.contract.viewerState.signed);
  });

  it("n'invente pas de clauses pour un contrat ancien qui n'en a pas", () => {
    const blocks = contractPdfBlocks(
      { ...CONTRACT, terms: { job_title: "Ancien" } },
      "fr",
      fr,
      new Date(),
    );
    const texts = blocks.flatMap((b) => ("text" in b ? [b.text] : []));
    expect(texts).toContain(fr.contract.clausesMissing);
    expect(texts.some((t) => t.includes("F CFA"))).toBe(false);
  });
});

describe("parseContractTerms", () => {
  it("déduit la journée unique d'un contrat antérieur au lot 12", () => {
    const parsed = parseContractTerms(
      {
        start_date: "2099-03-10",
        start_time: "09:00:00",
        end_time: "17:00:00",
        mission_pay_per_candidate: 1500,
        currency: "XAF",
        pay_basis: "per_mission",
      },
      "fr",
    );
    expect(parsed.days).toEqual([
      { date: "2099-03-10", start_time: "09:00:00", end_time: "17:00:00" },
    ]);
    expect(parsed.pay).toBe(1500);
    expect(parsed.clauses).toBeNull();
  });

  it("n'affiche aucun montant hors forfait XAF", () => {
    expect(
      parseContractTerms(
        {
          mission_pay_per_candidate: 1500,
          currency: "EUR",
          pay_basis: "per_mission",
        },
        "fr",
      ).pay,
    ).toBeNull();
  });
});

describe("displayApplicationStatus", () => {
  it("affiche une ancienne présélection comme une candidature en attente", () => {
    expect(displayApplicationStatus("shortlisted")).toBe("pending");
    expect(displayApplicationStatus("selected")).toBe("selected");
    expect(displayApplicationStatus(null)).toBeNull();
  });
});
