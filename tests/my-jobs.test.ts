import { describe, expect, it } from "vitest";
import {
  applicationsEmptyState,
  loadState,
  splitApplications,
} from "@/lib/jobs/my-jobs";
import { agreedEarnings } from "@/lib/jobs/earnings";
import { plural } from "@/lib/i18n/plural";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

// Lot 9 : après un retrait, « Mes jobs » disait « Vous n'avez pas encore
// postulé » ; une coupure réseau affichait la même chose.
describe("Mes jobs : candidatures", () => {
  const a = (status: string) => ({ status });

  it("jamais postulé", () => {
    expect(applicationsEmptyState([])).toBe("never");
  });

  it("après un retrait : aucune candidature en cours, mais un historique", () => {
    const apps = [a("withdrawn")];
    expect(applicationsEmptyState(apps)).toBe("noActive");
    expect(splitApplications(apps)).toEqual({ active: [], past: apps });
  });

  it("candidatures en cours et historique séparés ; sélectionnée en mission", () => {
    const apps = [
      a("pending"),
      a("shortlisted"),
      a("rejected"),
      a("selected"),
      a("no_show"),
    ];
    const { active, past } = splitApplications(apps);
    expect(active.map((x) => x.status)).toEqual(["pending", "shortlisted"]);
    expect(past.map((x) => x.status)).toEqual(["rejected", "no_show"]);
    expect(applicationsEmptyState(apps)).toBeNull();
  });

  it("chaque statut a un libellé FR et EN", () => {
    for (const s of [
      "pending",
      "shortlisted",
      "selected",
      "rejected",
      "withdrawn",
      "no_show",
    ] as const) {
      expect(fr.myJobs.applicationStatus[s]).toBeTruthy();
      expect(en.myJobs.applicationStatus[s]).not.toBe(
        fr.myJobs.applicationStatus[s],
      );
    }
  });
});

describe("loadState", () => {
  it("dernier état connu conservé après une erreur réseau", () => {
    expect(loadState(true, new TypeError("Failed to fetch"))).toBe("stale");
    expect(loadState(false, new TypeError("Failed to fetch"))).toBe("error");
    expect(loadState(true, undefined)).toBe("ok");
  });
});

describe("Mes gains", () => {
  it("additionne les montants figés des missions terminées seulement", () => {
    expect(
      agreedEarnings([
        { status: "completed", pay: 10_000 },
        { status: "validated", pay: 5_000 },
        { status: "completed", pay: null },
        { status: "in_progress", pay: 99_000 },
      ]),
    ).toEqual({ count: 3, total: 15_000, withoutAmount: 1 });
  });
});

describe("plural", () => {
  it("français : 0 et 1 au singulier", () => {
    const f = fr.mission.code.invalid;
    expect(plural(1, f, "fr")).toBe("Code incorrect. Il vous reste 1 essai.");
    expect(plural(0, f, "fr")).toBe("Code incorrect. Il vous reste 0 essai.");
    expect(plural(3, f, "fr")).toBe("Code incorrect. Il vous reste 3 essais.");
  });

  it("anglais : seul 1 au singulier", () => {
    expect(plural(0, en.mission.code.invalid, "en")).toBe(
      "Incorrect code. 0 attempts left.",
    );
    expect(plural(1, en.pay.positions, "en")).toBe("1 person needed");
    expect(plural(3, en.pay.positions, "en")).toBe("3 people needed");
  });
});
