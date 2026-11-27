/**
 * Lot 17d-4b — envoi des alertes de remplacement en file (ANN-21, ANN-22,
 * `[UV]` 2026-11-26).
 *
 * Chaque passage : revendication par la base (lignes dues, revérifiées une
 * à une : cycle ouvert, places, date, entreprise autorisée, destinataire,
 * préférence, adresse), rendu, envoi avec la clé d'idempotence stable de la
 * ligne, enregistrement de l'issue. Une panne d'enregistrement laisse la
 * ligne sous bail : à son expiration, la base la tient pour incertaine et
 * ne la renvoie qu'avec la même clé, dans la fenêtre du fournisseur.
 *
 * Ce module ne journalise ni adresse, ni objet, ni corps, ni identifiant de
 * ligne : seulement des codes et des compteurs.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  logServerError,
  logServerWarning,
} from "@/lib/observability/server-log";
import type { EmailConfig } from "./config";
import {
  fakeTransport,
  resendTransport,
  type EmailMessage,
  type EmailTransport,
  type SendOutcome,
} from "./transport";
import {
  renderReplacementAlert,
  replacementRenderSchema,
} from "./replacement-alert";

export type ClaimedEmail = {
  outbox_id: string;
  lease_token: string;
  idempotency_key: string;
  to_email: string;
  render: unknown;
  attempt: number;
};

export type RecordArgs = {
  outboxId: string;
  leaseToken: string;
  outcome: SendOutcome["kind"] | "blocked";
  providerId?: string;
  code?: string;
  retryAfterSeconds?: number;
};

export interface OutboxStore {
  claim(limit: number): Promise<ClaimedEmail[]>;
  /**
   * Contrôle juste avant l'appel réseau (`replacement_email_presend`) :
   * « ok » seulement si l'appel est permis ; sinon la base a déjà annulé,
   * différé ou refusé la ligne, et rien n'est envoyé.
   */
  presend(
    outboxId: string,
    leaseToken: string,
    digest: string,
  ): Promise<string>;
  record(args: RecordArgs): Promise<string>;
}

/** File de la base (clé service, serveur uniquement). */
export function supabaseOutboxStore(
  client: SupabaseClient<Database>,
): OutboxStore {
  return {
    async claim(limit) {
      const { data, error } = await client.rpc("replacement_email_claim", {
        p_limit: limit,
        p_lease_seconds: 120,
      });
      if (error) throw error;
      return (data ?? []) as ClaimedEmail[];
    },
    async presend(outboxId, leaseToken, digest) {
      const { data, error } = await client.rpc("replacement_email_presend", {
        p_outbox_id: outboxId,
        p_lease_token: leaseToken,
        p_payload_digest: digest,
      });
      if (error) throw error;
      return String(data);
    },
    async record(a) {
      const { data, error } = await client.rpc("replacement_email_record", {
        p_outbox_id: a.outboxId,
        p_lease_token: a.leaseToken,
        p_outcome: a.outcome,
        p_provider_id: a.providerId,
        p_code: a.code,
        p_retry_after_seconds: a.retryAfterSeconds,
      });
      if (error) throw error;
      return String(data);
    },
  };
}

let sharedFake: ReturnType<typeof fakeTransport> | null = null;

/** Transport du mode configuré ; null si l'envoi n'est pas permis. */
export function transportFor(config: EmailConfig): EmailTransport | null {
  if (!config.ready) return null;
  if (config.mode === "fake") {
    sharedFake ??= fakeTransport();
    return sharedFake;
  }
  if (config.mode === "resend" && config.apiKey)
    return resendTransport(config.apiKey);
  return null;
}

export type DispatchSummary = {
  mode: EmailConfig["mode"];
  ready: boolean;
  claimed: number;
  accepted: number;
  retry: number;
  uncertain: number;
  failed: number;
  indeterminate: number;
  blocked: number;
  /** Lignes non envoyées après le contrôle final (fermeture, retrait…). */
  notSent: number;
  /** Reprises refusées : contenu différent d'une tentative incertaine. */
  payloadChanged: number;
  recordErrors: number;
};

/**
 * Empreinte du message complet, liée à la ligne : une reprise après une
 * issue incertaine doit envoyer exactement le même contenu avec la même
 * clé, sinon la base la refuse (`payload_changed`). Seule l'empreinte est
 * conservée (le temps des reprises), jamais l'adresse ni le contenu.
 */
export function messageDigest(
  outboxId: string,
  idempotencyKey: string,
  message: EmailMessage,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        outboxId,
        idempotencyKey,
        message.to.toLowerCase(),
        message.from,
        message.replyTo,
        message.subject,
        message.text,
        message.html,
        Object.entries(message.tags).sort(),
      ]),
    )
    .digest("hex");
}

const CODE = /^[a-z0-9_]{1,64}$/;
const safeCode = (c: string) => (CODE.test(c) ? c : "provider_error");

export async function dispatchReplacementEmails(options: {
  config: EmailConfig;
  store: OutboxStore;
  transport: EmailTransport | null;
  limit?: number;
}): Promise<DispatchSummary> {
  const { config, store, transport } = options;
  const summary: DispatchSummary = {
    mode: config.mode,
    ready: config.ready && transport !== null,
    claimed: 0,
    accepted: 0,
    retry: 0,
    uncertain: 0,
    failed: 0,
    indeterminate: 0,
    blocked: 0,
    notSent: 0,
    payloadChanged: 0,
    recordErrors: 0,
  };
  // Envoi non permis : rien n'est revendiqué, les intentions restent en file.
  if (!summary.ready || !transport || !config.appUrl) return summary;

  const rows = await store.claim(
    Math.min(Math.max(options.limit ?? 20, 1), 100),
  );
  summary.claimed = rows.length;
  const allow = config.allowlist?.length ? new Set(config.allowlist) : null;

  for (const row of rows) {
    let args: RecordArgs;
    const parsed = replacementRenderSchema.safeParse(row.render);
    if (!parsed.success) {
      // Aucun appel : la ligne est close sans envoi.
      args = {
        outboxId: row.outbox_id,
        leaseToken: row.lease_token,
        outcome: "blocked",
        code: "render_invalid",
      };
    } else if (allow && !allow.has(row.to_email.toLowerCase())) {
      // Essai limité : aucune adresse hors de la liste n'est contactée.
      args = {
        outboxId: row.outbox_id,
        leaseToken: row.lease_token,
        outcome: "blocked",
        code: "not_allowlisted",
      };
    } else {
      const message: EmailMessage = {
        to: row.to_email,
        from: config.from ?? "",
        replyTo: config.replyTo ?? "",
        ...renderReplacementAlert(parsed.data, config.appUrl),
        tags: { outbox_id: row.outbox_id, kind: "replacement_alert" },
      };
      // Contrôle final au plus près de l'appel (fermeture, retrait,
      // entreprise, destinataire, contenu d'une reprise).
      let gate: string;
      try {
        gate = await store.presend(
          row.outbox_id,
          row.lease_token,
          messageDigest(row.outbox_id, row.idempotency_key, message),
        );
      } catch (error) {
        // Sans contrôle final, aucun appel ; le bail expirera sans incertitude.
        summary.recordErrors += 1;
        logServerError("email.outbox.presend", error, { category: "database" });
        continue;
      }
      if (gate !== "ok") {
        if (gate === "payload_changed") summary.payloadChanged += 1;
        else summary.notSent += 1;
        continue;
      }
      let outcome: SendOutcome;
      try {
        outcome = await transport.send(message, row.idempotency_key);
      } catch {
        outcome = { kind: "uncertain", code: "transport_exception" };
      }
      args = {
        outboxId: row.outbox_id,
        leaseToken: row.lease_token,
        outcome: outcome.kind,
        providerId:
          outcome.kind === "accepted" ? outcome.providerId : undefined,
        code: outcome.kind === "accepted" ? undefined : safeCode(outcome.code),
        retryAfterSeconds:
          outcome.kind === "retry" || outcome.kind === "uncertain"
            ? outcome.retryAfterSeconds
            : undefined,
      };
    }
    summary[args.outcome] += 1;
    try {
      await store.record(args);
    } catch (error) {
      // Ligne « en vol » sous bail : à son expiration, la base la tiendra
      // pour incertaine et ne la reprendra qu'avec la même clé et le même
      // contenu.
      summary.recordErrors += 1;
      logServerError("email.outbox.record", error, { category: "database" });
    }
  }
  if (summary.uncertain || summary.failed || summary.indeterminate)
    logServerWarning("email.outbox.dispatch", "email_attempts_not_accepted", {
      category: "provider",
    });
  return summary;
}
