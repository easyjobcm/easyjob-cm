import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEmailConfig, bareAddress } from "@/lib/email/config";
import { renderReplacementAlert } from "@/lib/email/replacement-alert";
import {
  classifyResendResponse,
  fakeTransport,
  resendTransport,
  type EmailMessage,
} from "@/lib/email/transport";
import { verifyWebhookSignature } from "@/lib/email/webhook-signature";
import {
  dispatchReplacementEmails,
  type ClaimedEmail,
  type OutboxStore,
  type RecordArgs,
} from "@/lib/email/dispatcher";
import {
  outboxIdFromTags,
  resendWebhookSchema,
} from "@/lib/validations/email-webhook";
import {
  REPLACEMENT_EMAIL_CONSENT_VERSION,
  replacementEmailPreferenceSchema,
} from "@/lib/validations/email-preference";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";

/**
 * Lot 17d-4b — e-mails du recrutement de remplacement. Décisions : ANN-14
 * (destinataires), ANN-21 et ANN-22 (`[UV]` 2026-11-26), DON-04, DON-06.
 * Aucun appel réseau : fournisseur simulé et `fetch` injecté.
 */

afterEach(() => vi.restoreAllMocks());

const JOB = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const OUTBOX = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const RENDER = {
  locale: "fr" as const,
  job_id: JOB,
  title: "Serveurs pour un mariage",
  city: "Douala",
  closes_at: "2099-03-02T05:00:00+00:00",
  days: [
    {
      starts_at: "2099-03-02T07:00:00+00:00",
      ends_at: "2099-03-02T13:00:00+00:00",
    },
  ],
};
const APP = "https://easyjobcm.com";

const PROD = {
  EMAIL_TRANSPORT: "resend",
  EMAIL_FROM: "EasyJob CM <alertes@notifications.easyjobcm.com>",
  EMAIL_REPLY_TO: "contact@example.org",
  RESEND_API_KEY: "re_test_key",
  RESEND_WEBHOOK_SECRET: "whsec_c2VjcmV0LWRlLXRlc3QtMTIzNDU2",
  NEXT_PUBLIC_APP_URL: APP,
  VERCEL_ENV: "production",
};

describe("ANN-21 configuration (serveur uniquement)", () => {
  it("est désactivée par défaut : rien n'est revendiqué", () => {
    const c = readEmailConfig({});
    expect(c.mode).toBe("disabled");
    expect(c.ready).toBe(false);
    expect(c.deliveryActive).toBe(false);
  });

  it("le mode simulé n'exige qu'une URL d'application", () => {
    expect(readEmailConfig({ EMAIL_TRANSPORT: "fake" }).ready).toBe(false);
    const c = readEmailConfig({
      EMAIL_TRANSPORT: "fake",
      NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    });
    expect(c.ready).toBe(true);
    expect(c.deliveryActive).toBe(false);
    // Jamais sur Vercel (une preview peut viser la base de production).
    for (const env of ["preview", "production"]) {
      expect(
        readEmailConfig({
          EMAIL_TRANSPORT: "fake",
          NEXT_PUBLIC_APP_URL: APP,
          VERCEL_ENV: env,
        }).problems,
      ).toContain("VERCEL_ENV");
    }
  });

  it("exige une adresse de réponse fournie, jamais devinée", () => {
    const c = readEmailConfig({ ...PROD, EMAIL_REPLY_TO: "" });
    expect(c.ready).toBe(false);
    expect(c.problems).toContain("EMAIL_REPLY_TO");
    expect(c.replyTo).toBeNull();
  });

  it("expéditeur existant noreply@easyjobcm.com ; réponse jamais vers une adresse « noreply »", () => {
    const sender = "EasyJob CM <noreply@easyjobcm.com>";
    expect(readEmailConfig({ ...PROD, EMAIL_FROM: sender }).ready).toBe(true);
    for (const reply of [
      "noreply@easyjobcm.com",
      "EasyJob <noreply@easyjobcm.com>",
      "no-reply@example.org",
    ]) {
      expect(
        readEmailConfig({ ...PROD, EMAIL_FROM: sender, EMAIL_REPLY_TO: reply })
          .problems,
      ).toContain("EMAIL_REPLY_TO");
    }
    // Boîte de réponse prévue mais pas encore créée : variable vide,
    // envoi réel refusé.
    const pending = readEmailConfig({
      ...PROD,
      EMAIL_FROM: sender,
      EMAIL_REPLY_TO: "",
    });
    expect(pending.ready).toBe(false);
    expect(pending.deliveryActive).toBe(false);
  });

  it("refuse un expéditeur hors du domaine easyjobcm.com", () => {
    for (const from of [
      "alertes@easyjob.cm",
      "alertes@easyjobcm.com.evil.io",
      "pas une adresse",
    ]) {
      const c = readEmailConfig({ ...PROD, EMAIL_FROM: from });
      expect(c.problems).toContain("EMAIL_FROM");
    }
    expect(
      readEmailConfig({ ...PROD, EMAIL_FROM: "a@easyjobcm.com" }).ready,
    ).toBe(true);
  });

  it("aucun envoi réel depuis une preview, ni hors production sans liste d'essai", () => {
    expect(
      readEmailConfig({ ...PROD, VERCEL_ENV: "preview" }).problems,
    ).toContain("VERCEL_ENV");
    const { VERCEL_ENV: _drop, ...local } = PROD;
    void _drop;
    expect(readEmailConfig(local).problems).toContain(
      "EMAIL_RECIPIENT_ALLOWLIST",
    );
    const trial = readEmailConfig({
      ...local,
      EMAIL_RECIPIENT_ALLOWLIST: "essai@example.org",
    });
    expect(trial.ready).toBe(true);
    // Essai limité : jamais annoncé comme en service.
    expect(trial.deliveryActive).toBe(false);
  });

  it("n'annonce l'envoi qu'après vérification explicite", () => {
    expect(readEmailConfig(PROD).deliveryActive).toBe(false);
    expect(
      readEmailConfig({ ...PROD, EMAIL_DELIVERY_VERIFIED: "true" })
        .deliveryActive,
    ).toBe(true);
  });

  it("aucune variable d'e-mail n'est exposée au navigateur", () => {
    const root = path.resolve(__dirname, "..");
    const files = [
      "lib/email/config.ts",
      "lib/email/dispatcher.ts",
      "lib/email/transport.ts",
      "lib/email/run.ts",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).not.toMatch(/NEXT_PUBLIC_(?!APP_URL)[A-Z]/);
    }
    // Aucun composant client n'importe la configuration ou l'envoi.
    const comp = fs.readFileSync(
      path.join(
        root,
        "components/notifications/replacement-email-preference.tsx",
      ),
      "utf8",
    );
    expect(comp).not.toMatch(/@\/lib\/email\//);
  });

  it("lit une adresse nue", () => {
    expect(bareAddress("EasyJob <A@easyjobcm.com>")).toBe("a@easyjobcm.com");
    expect(bareAddress("x")).toBeNull();
  });
});

describe("ANN-21 contenu de l'alerte (FR/EN)", () => {
  it("ouvre l'offre, sans jeton ni action, et propose la désactivation", () => {
    const m = renderReplacementAlert(RENDER, APP);
    expect(m.subject).toBe(
      "Une place s'est libérée : Serveurs pour un mariage",
    );
    expect(m.text).toContain(`${APP}/jobs/${JOB}`);
    expect(m.html).toContain(`href="${APP}/jobs/${JOB}"`);
    expect(m.text).toContain(`${APP}/profile/notifications`);
    expect(m.html).not.toMatch(/\/jobs\/[^"]*\?/);
    expect(m.text).toMatch(/ne garantit pas une sélection/);
    expect(m.text).toMatch(/ne confirme rien/);
  });

  it("rend l'anglais selon la langue du destinataire", () => {
    const m = renderReplacementAlert({ ...RENDER, locale: "en" }, APP);
    expect(m.subject).toBe("A place has opened up: Serveurs pour un mariage");
    expect(m.text).toMatch(/does not guarantee selection/);
  });

  it("n'inclut jamais un champ non prévu (motif, justificatif, coordonnées)", () => {
    const m = renderReplacementAlert(
      {
        ...RENDER,
        reason: "malade, certificat médical",
        phone: "+237691234567",
        evidence: "justificatif.pdf",
      } as unknown as typeof RENDER,
      APP,
    );
    for (const s of [
      "malade",
      "certificat",
      "+237691234567",
      "justificatif.pdf",
    ]) {
      expect(m.text).not.toContain(s);
      expect(m.html).not.toContain(s);
    }
  });

  it("échappe le titre et neutralise une injection dans l'objet", () => {
    const m = renderReplacementAlert(
      { ...RENDER, title: "<script>x</script>\r\nBcc: a@b.c" },
      APP,
    );
    expect(m.html).not.toContain("<script>");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("est déterministe (même contenu à chaque reprise)", () => {
    expect(renderReplacementAlert(RENDER, APP)).toEqual(
      renderReplacementAlert(RENDER, APP),
    );
  });

  it("existe en français et en anglais", () => {
    expect(Object.keys(en.replacementEmail).sort()).toEqual(
      Object.keys(fr.replacementEmail).sort(),
    );
  });
});

function sign(secret: string, id: string, ts: number, body: string): string {
  const key = Buffer.from(secret.slice(6), "base64");
  return createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

describe("événements du fournisseur : authenticité", () => {
  const secret = PROD.RESEND_WEBHOOK_SECRET;
  const body =
    '{"type":"email.delivered","created_at":"2099-01-01T00:00:00Z","data":{}}';
  const now = 1_900_000_000;

  it("accepte une signature valide parmi plusieurs", () => {
    const sig = sign(secret, "msg_1", now, body);
    const r = verifyWebhookSignature(
      body,
      { id: "msg_1", timestamp: String(now), signature: `v1,AAAA v1,${sig}` },
      secret,
      now,
    );
    expect(r).toEqual({ ok: true, eventId: "msg_1" });
  });

  it("vérifie le vecteur de test publié par Svix", () => {
    const r = verifyWebhookSignature(
      '{"event_type":"ping","data":{"success":true}}',
      {
        id: "msg_loFOjxBNrRLzqYUf",
        timestamp: "1731705121",
        signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
      },
      "whsec_plJ3nmyCDGBKInavdOK15jsl",
      1731705121,
    );
    expect(r.ok).toBe(true);
  });

  it("refuse un corps modifié, un autre secret, un horodatage ancien, des en-têtes absents", () => {
    const sig = sign(secret, "msg_1", now, body);
    const h = { id: "msg_1", timestamp: String(now), signature: `v1,${sig}` };
    expect(verifyWebhookSignature(`${body} `, h, secret, now)).toMatchObject({
      ok: false,
      reason: "mismatch",
    });
    expect(
      verifyWebhookSignature(
        body,
        h,
        "whsec_YXV0cmUtc2VjcmV0LWRlLXRlc3Q=",
        now,
      ),
    ).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature(body, h, secret, now + 301)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect(
      verifyWebhookSignature(body, { ...h, signature: null }, secret, now),
    ).toMatchObject({ ok: false, reason: "missing_headers" });
    // Autre identifiant d'événement : la signature ne couvre pas un rejeu renommé.
    expect(
      verifyWebhookSignature(body, { ...h, id: "msg_2" }, secret, now),
    ).toMatchObject({ ok: false, reason: "mismatch" });
  });

  it("lit l'étiquette de corrélation et le contenu utile", () => {
    expect(outboxIdFromTags({ outbox_id: OUTBOX })).toBe(OUTBOX);
    expect(outboxIdFromTags({ outbox_id: "x'; drop" })).toBeNull();
    expect(
      resendWebhookSchema.safeParse({
        type: "email.delivered",
        created_at: "2099-01-01T00:00:00.000Z",
        data: {
          email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c",
          tags: { outbox_id: OUTBOX },
        },
      }).success,
    ).toBe(true);
    expect(
      resendWebhookSchema.safeParse({ type: "email.delivered", data: {} })
        .success,
    ).toBe(false);
  });
});

const jsonResponse = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

describe("issues d'une tentative (documentation Resend du 2026-11-26)", () => {
  it("classe chaque réponse", async () => {
    expect(
      await classifyResendResponse(jsonResponse(200, { id: "abc-123" })),
    ).toEqual({
      kind: "accepted",
      providerId: "abc-123",
    });
    expect((await classifyResendResponse(jsonResponse(200, {}))).kind).toBe(
      "uncertain",
    );
    expect(
      await classifyResendResponse(
        jsonResponse(
          429,
          { name: "rate_limit_exceeded" },
          { "retry-after": "2" },
        ),
      ),
    ).toEqual({
      kind: "retry",
      code: "rate_limit_exceeded",
      retryAfterSeconds: 2,
    });
    expect(
      (
        await classifyResendResponse(
          jsonResponse(409, { name: "concurrent_idempotent_requests" }),
        )
      ).kind,
    ).toBe("uncertain");
    expect(
      (
        await classifyResendResponse(
          jsonResponse(409, { name: "invalid_idempotent_request" }),
        )
      ).kind,
    ).toBe("indeterminate");
    expect(
      (
        await classifyResendResponse(
          jsonResponse(500, { name: "application_error" }),
        )
      ).kind,
    ).toBe("uncertain");
    expect((await classifyResendResponse(jsonResponse(503, "x"))).kind).toBe(
      "uncertain",
    );
    expect(
      await classifyResendResponse(
        jsonResponse(422, { name: "invalid_parameter" }),
      ),
    ).toEqual({
      kind: "failed",
      code: "invalid_parameter",
    });
    // Un message d'erreur du fournisseur n'est jamais repris comme code.
    expect(
      await classifyResendResponse(
        jsonResponse(403, { name: "Not Allowed <x@y.z>" }),
      ),
    ).toEqual({ kind: "failed", code: "http_403" });
  });

  it("envoie la clé d'idempotence et ne tient pas une coupure pour un échec", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = resendTransport("re_key", {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(200, { id: "id-1" });
      },
    });
    const msg: EmailMessage = {
      to: "c@example.org",
      from: "EasyJob <a@easyjobcm.com>",
      replyTo: "r@example.org",
      subject: "s",
      text: "t",
      html: "<p>t</p>",
      tags: { outbox_id: OUTBOX },
    };
    expect(await ok.send(msg, "replacement-alert/1")).toEqual({
      kind: "accepted",
      providerId: "id-1",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(headers["Idempotency-Key"]).toBe("replacement-alert/1");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.reply_to).toBe("r@example.org");
    expect(sent.tags).toEqual([{ name: "outbox_id", value: OUTBOX }]);

    const timeout = resendTransport("re_key", {
      fetchImpl: async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      },
    });
    expect(await timeout.send(msg, "k")).toEqual({
      kind: "uncertain",
      code: "timeout",
    });
    const network = resendTransport("re_key", {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await network.send(msg, "k")).toEqual({
      kind: "uncertain",
      code: "network_error",
    });
  });

  it("fournisseur simulé : même clé, aucun second envoi ; autre contenu, issue indéterminée", async () => {
    const fake = fakeTransport(["accept_lost", "accept"]);
    const msg: EmailMessage = {
      to: "c@example.org",
      from: "",
      replyTo: "",
      subject: "s",
      text: "t",
      html: "h",
      tags: {},
    };
    expect((await fake.send(msg, "k1")).kind).toBe("uncertain");
    const again = await fake.send(msg, "k1");
    expect(again.kind).toBe("accepted");
    expect(fake.deliveries).toHaveLength(1);
    expect(again).toEqual({
      kind: "accepted",
      providerId: fake.deliveries[0].providerId,
    });
    expect((await fake.send({ ...msg, subject: "autre" }, "k1")).kind).toBe(
      "indeterminate",
    );
    expect(fake.deliveries).toHaveLength(1);
  });
});

function memoryStore(
  rows: ClaimedEmail[],
  failRecord = false,
  gate: (digest: string) => string = () => "ok",
) {
  const records: RecordArgs[] = [];
  const digests: string[] = [];
  let claimed = 0;
  const store: OutboxStore = {
    async claim() {
      claimed += 1;
      return rows.splice(0);
    },
    async presend(_id, _token, digest) {
      digests.push(digest);
      return gate(digest);
    },
    async record(a) {
      if (failRecord) throw new Error("db down");
      records.push(a);
      return "applied";
    },
  };
  return { store, records, digests, claims: () => claimed };
}

const claimedRow = (over: Partial<ClaimedEmail> = {}): ClaimedEmail => ({
  outbox_id: OUTBOX,
  lease_token: "11111111-1111-4111-8111-111111111111",
  idempotency_key: `replacement-alert/${OUTBOX}`,
  to_email: "c@example.org",
  render: RENDER,
  attempt: 1,
  ...over,
});

describe("passage d'envoi", () => {
  const fakeConfig = readEmailConfig({
    EMAIL_TRANSPORT: "fake",
    NEXT_PUBLIC_APP_URL: APP,
  });

  it("désactivé : aucune revendication, les intentions restent en file", async () => {
    const m = memoryStore([claimedRow()]);
    const s = await dispatchReplacementEmails({
      config: readEmailConfig({}),
      store: m.store,
      transport: null,
    });
    expect(s.claimed).toBe(0);
    expect(m.claims()).toBe(0);
  });

  it("réponse perdue puis reprise : un seul envoi, même identifiant", async () => {
    const fake = fakeTransport(["accept_lost", "accept"]);
    const m1 = memoryStore([claimedRow()]);
    await dispatchReplacementEmails({
      config: fakeConfig,
      store: m1.store,
      transport: fake,
    });
    expect(m1.records[0]).toMatchObject({
      outcome: "uncertain",
      code: "timeout",
    });
    const m2 = memoryStore([claimedRow({ attempt: 2 })]);
    await dispatchReplacementEmails({
      config: fakeConfig,
      store: m2.store,
      transport: fake,
    });
    expect(m2.records[0]).toMatchObject({
      outcome: "accepted",
      providerId: fake.deliveries[0].providerId,
    });
    expect(fake.deliveries).toHaveLength(1);
  });

  it("essai limité : aucune adresse hors liste n'est contactée", async () => {
    const fake = fakeTransport();
    const m = memoryStore([claimedRow({ to_email: "reel@example.org" })]);
    await dispatchReplacementEmails({
      config: { ...fakeConfig, allowlist: ["essai@example.org"] },
      store: m.store,
      transport: fake,
    });
    expect(fake.calls).toBe(0);
    expect(m.records[0]).toMatchObject({
      outcome: "blocked",
      code: "not_allowlisted",
    });
  });

  it("paramètres de rendu invalides : échec sans appel", async () => {
    const fake = fakeTransport();
    const m = memoryStore([claimedRow({ render: { title: "x" } })]);
    await dispatchReplacementEmails({
      config: fakeConfig,
      store: m.store,
      transport: fake,
    });
    expect(fake.calls).toBe(0);
    expect(m.records[0]).toMatchObject({
      outcome: "blocked",
      code: "render_invalid",
    });
  });

  it("contrôle final refusé (cycle fermé, retrait, contenu changé) : aucun appel, aucune issue écrite", async () => {
    for (const verdict of [
      "cycle_closed",
      "opted_out",
      "payload_changed",
      "stale_lease",
    ]) {
      const fake = fakeTransport();
      const m = memoryStore([claimedRow()], false, () => verdict);
      const s = await dispatchReplacementEmails({
        config: fakeConfig,
        store: m.store,
        transport: fake,
      });
      expect(fake.calls).toBe(0);
      expect(m.records).toHaveLength(0);
      expect(verdict === "payload_changed" ? s.payloadChanged : s.notSent).toBe(
        1,
      );
    }
  });

  it("empreinte : identique pour le même message, différente si l'adresse, la langue ou la configuration change", async () => {
    const run = async (row: ClaimedEmail, config = fakeConfig) => {
      const m = memoryStore([row]);
      await dispatchReplacementEmails({
        config,
        store: m.store,
        transport: fakeTransport(),
      });
      return m.digests[0];
    };
    const base = await run(claimedRow());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(await run(claimedRow())).toBe(base);
    expect(await run(claimedRow({ to_email: "autre@example.org" }))).not.toBe(
      base,
    );
    expect(
      await run(claimedRow({ render: { ...RENDER, locale: "en" } })),
    ).not.toBe(base);
    expect(
      await run(claimedRow(), {
        ...fakeConfig,
        appUrl: "https://autre.example",
      }),
    ).not.toBe(base);
    // La casse de l'adresse ne change pas l'empreinte.
    expect(await run(claimedRow({ to_email: "C@Example.org" }))).toBe(base);
  });

  it("panne de la base à l'enregistrement : comptée, journalisée sans donnée", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = memoryStore([claimedRow()], true);
    const s = await dispatchReplacementEmails({
      config: fakeConfig,
      store: m.store,
      transport: fakeTransport(),
    });
    expect(s.recordErrors).toBe(1);
    const out = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).not.toContain("c@example.org");
    expect(out).not.toContain(OUTBOX);
    expect(out).not.toContain("Serveurs");
  });
});

describe("préférence : activation explicite", () => {
  it("exige le texte accepté pour activer, rien pour désactiver", () => {
    expect(
      replacementEmailPreferenceSchema.safeParse({ enabled: true }).success,
    ).toBe(false);
    expect(
      replacementEmailPreferenceSchema.safeParse({
        enabled: true,
        consentVersion: REPLACEMENT_EMAIL_CONSENT_VERSION,
      }).success,
    ).toBe(true);
    expect(
      replacementEmailPreferenceSchema.safeParse({ enabled: false }).success,
    ).toBe(true);
    expect(
      replacementEmailPreferenceSchema.safeParse({ enabled: "true" }).success,
    ).toBe(false);
  });
});
