import { describe, expect, it } from "vitest";
import {
  isJobUrgent,
  jobStartInstant,
  nextUrgencyChange,
  URGENT_WINDOW_MS,
} from "@/lib/jobs/urgency";

/**
 * Lot 9d : badge « Urgente » calculé. Offre ouverte, début strictement
 * futur et à 24 h ou moins, heures saisies en heure de Douala (UTC+1).
 */

const job = {
  start_date: "2026-11-11",
  start_time: "08:00:00",
  status: "active",
  positions_available: 2,
  positions_filled: 0,
};
// 08:00 à Douala = 07:00 UTC.
const start = Date.parse("2026-11-11T07:00:00Z");

describe("jobStartInstant", () => {
  it("lit la date et l'heure en heure de Douala", () => {
    expect(jobStartInstant(job)).toBe(start);
    expect(
      jobStartInstant({ start_date: "2026-11-11", start_time: "08:00" }),
    ).toBe(start);
  });

  it("illisible → null", () => {
    expect(jobStartInstant({ start_date: "", start_time: "08:00" })).toBeNull();
    expect(
      jobStartInstant({ start_date: "2026-11-11", start_time: "8h" }),
    ).toBeNull();
  });
});

describe("isJobUrgent", () => {
  it("à 24 h exactement : urgente ; 1 ms avant : non", () => {
    expect(isJobUrgent(job, start - URGENT_WINDOW_MS)).toBe(true);
    expect(isJobUrgent(job, start - URGENT_WINDOW_MS - 1)).toBe(false);
  });

  it("début dans 1 ms : urgente ; au début ou après : non", () => {
    expect(isJobUrgent(job, start - 1)).toBe(true);
    expect(isJobUrgent(job, start)).toBe(false);
    expect(isJobUrgent(job, start + 60_000)).toBe(false);
  });

  it("offre non ouverte : jamais urgente", () => {
    const now = start - 3_600_000;
    expect(isJobUrgent({ ...job, status: "filled" }, now)).toBe(false);
    expect(isJobUrgent({ ...job, positions_filled: 2 }, now)).toBe(false);
    expect(isJobUrgent({ ...job, status: undefined }, now)).toBe(true);
  });

  it("l'ancienne option manuelle n'a plus d'effet", () => {
    const later = { ...job, urgency: "urgent" } as typeof job;
    expect(isJobUrgent(later, start - 3 * URGENT_WINDOW_MS)).toBe(false);
  });
});

describe("nextUrgencyChange", () => {
  it("avant la fenêtre : entrée à H−24 ; dans la fenêtre : début ; après : null", () => {
    expect(nextUrgencyChange(job, start - 2 * URGENT_WINDOW_MS)).toBe(
      start - URGENT_WINDOW_MS,
    );
    expect(nextUrgencyChange(job, start - 1000)).toBe(start);
    expect(nextUrgencyChange(job, start)).toBeNull();
    expect(nextUrgencyChange({ ...job, status: "closed" }, 0)).toBeNull();
  });
});
