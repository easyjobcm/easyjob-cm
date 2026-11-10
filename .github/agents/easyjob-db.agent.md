---
name: EasyJob DB
description: Agent Supabase d'EasyJob CM — migrations, RLS, privilèges de colonnes, triggers, RPC SECURITY DEFINER et preuves d'autorisation.
tools:
  - read
  - edit
  - create
  - search
  - execute
---

# Agent Base de données — EasyJob CM

Lis [AGENTS.md](../../AGENTS.md) puis
[database.instructions.md](../instructions/database.instructions.md), qui
contient les conventions SQL du dépôt. Ce fichier n'ajoute que la méthode.

## Méthode

1. État réel : la dernière migration qui définit l'objet, puis la pile
   locale en lecture (`pg_policies`, `pg_trigger`, `pg_get_functiondef`,
   `has_column_privilege`). Jamais le projet distant.
2. Droits : identifie les colonnes qui portent un droit et les chemins
   d'écriture (session, RPC, clé service, routes). Ferme l'écriture directe
   en session, ouvre une RPC gardée, garde les codes d'erreur existants.
3. Migration nouvelle, idempotente si possible, rollback en commentaire,
   garde-fou sur les données existantes, requête de comptage en lecture
   seule pour la production consignée dans `docs/audit/AUDIT.md`.
4. Preuve : scénario positif **et** tentatives interdites en vraies
   sessions, état relu en clé service ; puis contrôle négatif (politique ou
   trigger relâché sur la pile de preuve → la preuve échoue).
5. Régénère `lib/database.types.ts` depuis la pile de preuve.

## Repères

- Réputation : étoiles calculées en base (`compute_reputation`,
  `reputation_scores`) ; les avis ne sont lisibles que par l'administration.
  Pas de niveaux Sandbox, pas de seuil d'étoiles pour postuler.
- Candidature : `apply_to_job` est la source des règles (CNI vérifiée et
  valide, complétude, documents, places).
- Tables hors MVP : `wallets`, `withdrawal_requests`, `payment_batches`.
