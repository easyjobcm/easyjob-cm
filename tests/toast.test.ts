import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissToast,
  getToasts,
  subscribeToasts,
  toast,
  useToast,
} from "@/hooks/use-toast";

// F-39 : le hook se contentait d'écrire dans la console.
describe("toast (état partagé lu par <Toaster />)", () => {
  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
    vi.useRealTimers();
  });

  it("publie la notification et prévient les abonnés", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    useToast().toast({
      title: "Erreur",
      description: "Impossible de rejeter le candidat.",
      variant: "destructive",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getToasts()).toMatchObject([
      {
        title: "Erreur",
        description: "Impossible de rejeter le candidat.",
        variant: "destructive",
      },
    ]);
    unsubscribe();
  });

  it("variante par défaut et fermeture manuelle", () => {
    const id = toast({ title: "Candidat selectionne" });
    expect(getToasts()[0]?.variant).toBe("default");
    dismissToast(id);
    expect(getToasts()).toEqual([]);
  });

  it("disparaît seule, les erreurs restant affichées plus longtemps", () => {
    vi.useFakeTimers();
    toast({ title: "Succès", variant: "success" });
    toast({ title: "Erreur", variant: "destructive" });
    vi.advanceTimersByTime(5000);
    expect(getToasts().map((t) => t.title)).toEqual(["Erreur"]);
    vi.advanceTimersByTime(3000);
    expect(getToasts()).toEqual([]);
  });

  it("limite l'empilement aux trois plus récentes", () => {
    for (const n of [1, 2, 3, 4]) toast({ title: `n${n}` });
    expect(getToasts().map((t) => t.title)).toEqual(["n2", "n3", "n4"]);
  });

  it("l'état reste stable entre deux lectures (useSyncExternalStore)", () => {
    toast({ title: "a" });
    expect(getToasts()).toBe(getToasts());
  });
});

// Lot 9 : un refus propose l'étape suivante (lien) et reste affiché plus longtemps.
describe("toast avec action", () => {
  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
    vi.useRealTimers();
  });

  it("conserve l'action et prolonge l'affichage de 4 s", () => {
    vi.useFakeTimers();
    toast({
      title: "Candidature non envoyée",
      variant: "destructive",
      action: { label: "Voir mes candidatures", href: "/my-jobs" },
    });
    expect(getToasts()[0]?.action).toEqual({
      label: "Voir mes candidatures",
      href: "/my-jobs",
    });
    vi.advanceTimersByTime(8000);
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(getToasts()).toHaveLength(0);
  });
});
