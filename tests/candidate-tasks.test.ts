import { describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import {
  documentTaskKey,
  findActionTask,
  missionActionCount,
  parseActionTasks,
  pendingActionCount,
  taskHref,
  type MissionTaskState,
} from "@/lib/tasks/candidate-tasks";
import { actionTaskView } from "@/lib/tasks/action-task-view";

/**
 * Lot 9d : tâches qui débloquent une candidature et point rouge de
 * l'onglet Tâches (au moins une action attend le candidat).
 */

const now = Date.parse("2026-11-10T10:00:00Z");
const mission = (patch: Partial<MissionTaskState> = {}): MissionTaskState => ({
  status: "confirmed",
  contract_id: null,
  candidate_signed: true,
  started_at: null,
  completed_at: null,
  candidate_reviewed: false,
  start_available_at: "2026-11-11T07:45:00Z",
  scheduled_end_at: "2026-11-11T16:00:00Z",
  ...patch,
});

describe("parseActionTasks", () => {
  it("garde les tâches valides, ignore le reste", () => {
    const tasks = parseActionTasks([
      { key: "cni", kind: "cni", state: "expired", action_required: true },
      { key: "x", kind: "unknown", state: "?", action_required: true },
      {
        key: documentTaskKey("diplome", "Cuisine"),
        kind: "document",
        state: "pending",
        document_type: "diplome",
        skill_name: "Cuisine",
        jobs: [{ id: "8f6a2c56-6b1c-4f7e-9d2a-0c8e5b1a2f33", title: "Aide" }],
        action_required: false,
      },
    ]);
    expect(tasks.map((t) => t.key)).toEqual([
      "cni",
      "document:diplome:Cuisine",
    ]);
    expect(parseActionTasks(null)).toEqual([]);
    expect(parseActionTasks({ key: "cni" })).toEqual([]);
  });

  it("une CNI « valid » n'est jamais une tâche", () => {
    expect(
      parseActionTasks([
        { key: "cni", kind: "cni", state: "valid", action_required: false },
      ]),
    ).toEqual([]);
  });
});

describe("missionActionCount", () => {
  it("signature, début disponible, fin atteinte, notation", () => {
    expect(
      missionActionCount(
        mission({ contract_id: "c", candidate_signed: false }),
        now,
      ),
    ).toBe(1);
    // Début à venir : pas une action.
    expect(missionActionCount(mission(), now)).toBe(0);
    expect(
      missionActionCount(
        mission({ start_available_at: "2026-11-10T09:00:00Z" }),
        now,
      ),
    ).toBe(1);
    // En cours avant l'heure de fin : pas une action ; à l'heure : oui.
    expect(
      missionActionCount(
        mission({
          started_at: "2026-11-10T08:00:00Z",
          scheduled_end_at: "2026-11-10T12:00:00Z",
        }),
        now,
      ),
    ).toBe(0);
    expect(
      missionActionCount(
        mission({
          started_at: "2026-11-10T08:00:00Z",
          scheduled_end_at: "2026-11-10T09:59:00Z",
        }),
        now,
      ),
    ).toBe(1);
    expect(
      missionActionCount(
        mission({
          started_at: "x",
          completed_at: "y",
          candidate_reviewed: false,
        }),
        now,
      ),
    ).toBe(1);
    expect(
      missionActionCount(
        mission({
          started_at: "x",
          completed_at: "y",
          candidate_reviewed: true,
        }),
        now,
      ),
    ).toBe(0);
  });
});

describe("pendingActionCount", () => {
  const cni = (state: string, action_required: boolean) =>
    parseActionTasks([{ key: "cni", kind: "cni", state, action_required }]);

  it("CNI expirée → point ; renouvellement soumis → plus d'action", () => {
    const base = { missions: [], updateRequests: [] };
    expect(
      pendingActionCount({ ...base, actions: cni("expired", true) }, now),
    ).toBe(1);
    expect(
      pendingActionCount(
        { ...base, actions: cni("renewal_pending", false) },
        now,
      ),
    ).toBe(0);
    // Complément demandé : de nouveau une action.
    expect(
      pendingActionCount(
        { ...base, actions: cni("renewal_pending", true) },
        now,
      ),
    ).toBe(1);
  });

  it("le point reste si une autre tâche attend", () => {
    expect(
      pendingActionCount(
        {
          missions: [mission({ contract_id: "c", candidate_signed: false })],
          actions: cni("renewal_pending", false),
          updateRequests: [],
        },
        now,
      ),
    ).toBe(1);
    expect(
      pendingActionCount(
        { missions: [], actions: [], updateRequests: [{ id: "r" }] },
        now,
      ),
    ).toBe(1);
    expect(pendingActionCount(undefined, now)).toBe(0);
  });
});

describe("liens et vues des tâches", () => {
  it("clé et lien encodés", () => {
    expect(documentTaskKey("permis_conduire", null)).toBe(
      "document:permis_conduire:",
    );
    expect(taskHref("document:diplome:Électricité")).toBe(
      "/tasks?task=document%3Adiplome%3A%C3%89lectricit%C3%A9",
    );
    const tasks = cni("expired", true);
    expect(findActionTask(tasks, "cni")?.kind).toBe("cni");
    expect(findActionTask(tasks, null)).toBeNull();
  });

  function cni(state: string, action_required: boolean) {
    return parseActionTasks([
      {
        key: "cni",
        kind: "cni",
        state,
        action_required,
        expires_at: "2026-11-01",
      },
    ]);
  }

  it("CNI expirée : bouton « Renouveler ma CNI » vers l'envoi de la CNI (FR/EN)", () => {
    const [task] = cni("expired", true);
    const vfr = actionTaskView(task, fr, "fr");
    expect(vfr.label).toBe("Renouveler ma CNI");
    expect(vfr.href).toBe("/profile/candidate/edit?focus=cni");
    expect(vfr.hint).toContain("01 nov. 2026");
    const ven = actionTaskView(task, en, "en");
    expect(ven.label).toBe(en.tasks.cni.renew);
    expect(ven.hint).toContain("Nov 01, 2026");
  });

  it("renouvellement soumis : suivi ; complément demandé : message dédié", () => {
    const [pending] = cni("renewal_pending", false);
    expect(actionTaskView(pending, fr, "fr")).toMatchObject({
      title: fr.tasks.cni.renewalPendingTitle,
      label: fr.tasks.cni.track,
    });
    const [complement] = parseActionTasks([
      {
        key: "cni",
        kind: "cni",
        state: "renewal_pending",
        complement_requested: true,
        action_required: true,
      },
    ]);
    expect(actionTaskView(complement, fr, "fr").hint).toBe(
      fr.tasks.cni.complementHint,
    );
  });

  it("justificatif : texte du refus et page de gestion ; en attente : suivi", () => {
    const [missing, pending] = parseActionTasks([
      {
        key: "document:diplome:Cuisine",
        kind: "document",
        state: "missing",
        document_type: "diplome",
        skill_name: "Cuisine",
        jobs: [],
        action_required: true,
      },
      {
        key: "document:casier_judiciaire:",
        kind: "document",
        state: "pending",
        document_type: "casier_judiciaire",
        skill_name: null,
        jobs: [],
        action_required: false,
      },
    ]);
    const v = actionTaskView(missing, fr, "fr");
    expect(v.hint).toContain("« Cuisine »");
    expect(v.href).toBe("/profile/skill-documents");
    expect(actionTaskView(pending, fr, "fr").href).toBe("/profile/documents");
  });

  it("profil incomplet : pourcentage et lien d'édition", () => {
    const [task] = parseActionTasks([
      {
        key: "profile",
        kind: "profile",
        state: "incomplete",
        pct: 45,
        action_required: true,
      },
    ]);
    const v = actionTaskView(task, fr, "fr");
    expect(v.hint).toContain("45 %");
    expect(v.href).toBe("/profile/candidate/edit");
  });
});
