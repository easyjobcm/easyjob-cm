import { describe, expect, it } from "vitest";
import {
  crossesMidnight,
  dayBounds,
  formatDayHours,
  parseBlockedDays,
  parseDaysDetail,
  scheduleIssue,
  sortDays,
} from "@/lib/jobs/schedule";
import { jobInputSchema, jobUpdateSchema } from "@/lib/validations/job";
import {
  canStartDay,
  dayEndReached,
  missionActionCount,
  missionDays,
} from "@/lib/tasks/candidate-tasks";

const day = (date: string, start = "08:00", end = "12:00") => ({
  date,
  start_time: start,
  end_time: end,
});

describe("calendrier (lot 12)", () => {
  it("lit les heures en Douala et traverse minuit", () => {
    const b = dayBounds(day("2099-01-10", "22:00", "06:00"));
    expect(new Date(b.start).toISOString()).toBe("2099-01-10T21:00:00.000Z");
    expect(new Date(b.end).toISOString()).toBe("2099-01-11T05:00:00.000Z");
    expect(crossesMidnight({ start_time: "22:00", end_time: "06:00" })).toBe(
      true,
    );
    expect(formatDayHours(day("2099-01-10", "22:00", "06:00"), "+1 j")).toBe(
      "22:00 → 06:00 (+1 j)",
    );
  });

  it("accepte des dates non consécutives et refuse doublons, chevauchements, début = fin", () => {
    expect(
      scheduleIssue([day("2099-01-10"), day("2099-01-14"), day("2099-01-20")]),
    ).toBeNull();
    expect(scheduleIssue([])).toBe("daysRequired");
    expect(scheduleIssue([day("2099-01-10"), day("2099-01-10")])).toBe(
      "daysDuplicate",
    );
    expect(scheduleIssue([day("2099-01-10", "08:00", "08:00")])).toBe(
      "daysTime",
    );
    expect(
      scheduleIssue([
        day("2099-01-10", "22:00", "06:00"),
        day("2099-01-11", "05:00", "09:00"),
      ]),
    ).toBe("daysOverlap");
    // Fin à 06:00 et début à 06:00 le lendemain : bord à bord, admis.
    expect(
      scheduleIssue([
        day("2099-01-10", "22:00", "06:00"),
        day("2099-01-11", "06:00", "09:00"),
      ]),
    ).toBeNull();
    expect(
      scheduleIssue(
        Array.from({ length: 32 }, (_, i) =>
          day(`2099-02-${String(i + 1).padStart(2, "0")}`),
        ),
      ),
    ).toBe("daysTooMany");
  });

  it("limite en journées travaillées, pas en jours calendaires", () => {
    // 20 journées réparties sur plus de deux mois (une tous les 4 jours).
    const start = Date.parse("2099-03-01T12:00:00Z");
    const spread = (count: number, step: number) =>
      Array.from({ length: count }, (_, i) =>
        day(new Date(start + i * step * 86_400_000).toISOString().slice(0, 10)),
      );
    const twenty = spread(20, 4);
    expect(twenty[19].date).toBe("2099-05-16");
    expect(scheduleIssue(twenty)).toBeNull();
    // 31 journées sur deux mois : admis ; la 32e est refusée.
    expect(scheduleIssue(spread(31, 2))).toBeNull();
    expect(scheduleIssue(spread(32, 2))).toBe("daysTooMany");
  });

  it("trie par début réel", () => {
    expect(
      sortDays([day("2099-01-14"), day("2099-01-10")]).map((d) => d.date),
    ).toEqual(["2099-01-10", "2099-01-14"]);
  });

  it("lit les détails d'erreur sans faire confiance au contenu", () => {
    expect(parseDaysDetail('{"days":["2099-01-10","x"]}')).toEqual([
      "2099-01-10",
    ]);
    expect(parseDaysDetail("not json")).toEqual([]);
    expect(
      parseBlockedDays(
        '{"days":[{"id":"a","date":"2099-01-10","reason":"no_positions"},{"id":"b","date":"x","reason":"hack"}]}',
      ),
    ).toEqual([{ id: "a", date: "2099-01-10", reason: "no_positions" }]);
  });
});

describe("validation partagée du calendrier", () => {
  const base = {
    title: "Inventaire",
    description: "Comptage",
    address: "Rue",
    city: "Douala",
    start_date: "2099-01-10",
    start_time: "08:00",
    end_time: "12:00",
    mission_pay_per_candidate: 10000,
  };

  it("refuse un intervalle sans journées (aucune journée déduite)", () => {
    const r = jobInputSchema.safeParse({ ...base, end_date: "2099-01-14" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("daysRequired");
  });

  it("période complète : aucun montant journalier", () => {
    expect(
      jobInputSchema.safeParse({
        ...base,
        schedule_format: "full_period",
        days: [day("2099-01-10"), day("2099-01-14")],
      }).success,
    ).toBe(true);
    expect(
      jobInputSchema.safeParse({
        ...base,
        schedule_format: "full_period",
        days: [{ ...day("2099-01-10"), mission_pay_per_candidate: 500 }],
      }).success,
    ).toBe(false);
  });

  it("journées au choix : montant entier positif par journée", () => {
    const ok = jobInputSchema.safeParse({
      ...base,
      schedule_format: "per_day",
      days: [
        { ...day("2099-01-10"), mission_pay_per_candidate: 5000 },
        {
          ...day("2099-01-12"),
          mission_pay_per_candidate: 6000,
          positions_available: 2,
        },
      ],
    });
    expect(ok.success).toBe(true);
    for (const pay of [undefined, 0, -1, 10.5]) {
      expect(
        jobUpdateSchema.safeParse({
          ...base,
          schedule_format: "per_day",
          days: [{ ...day("2099-01-10"), mission_pay_per_candidate: pay }],
        }).success,
      ).toBe(false);
    }
  });
});

describe("tâches par journée", () => {
  const raw = [
    {
      id: "d2",
      date: "2099-01-12",
      starts_at: "2099-01-12T07:00:00Z",
      ends_at: "2099-01-12T11:00:00Z",
      start_available_at: "2099-01-12T06:45:00Z",
      started_at: null,
      completed_at: null,
    },
    {
      id: "d1",
      date: "2099-01-10",
      starts_at: "2099-01-10T07:00:00Z",
      ends_at: "2099-01-10T11:00:00Z",
      start_available_at: "2099-01-10T06:45:00Z",
      started_at: "2099-01-10T07:00:00Z",
      completed_at: null,
    },
    { id: "broken" },
  ];

  it("ignore les entrées invalides et trie", () => {
    expect(missionDays(raw).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("une journée non confirmée n'empêche pas de commencer la suivante", () => {
    const [d1, d2] = missionDays(raw);
    const now = Date.parse("2099-01-12T06:50:00Z");
    expect(dayEndReached(d1, now)).toBe(true);
    expect(canStartDay({ status: "in_progress" }, d2, now)).toBe(true);
    expect(
      missionActionCount(
        {
          status: "in_progress",
          contract_id: null,
          candidate_signed: true,
          started_at: "2099-01-10T07:00:00Z",
          completed_at: null,
          candidate_reviewed: false,
          start_available_at: "2099-01-10T06:45:00Z",
          scheduled_end_at: "2099-01-12T11:00:00Z",
          days: raw,
        },
        now,
      ),
    ).toBe(2);
  });
});
