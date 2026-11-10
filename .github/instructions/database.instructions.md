---
applyTo: "**/*.sql,supabase/**"
---

# Base de données — EasyJob CM

Règles communes : [AGENTS.md](../../AGENTS.md). Spécifique au SQL :

## Avant d'écrire

- Schéma réel : migrations de `supabase/migrations/` (la dernière qui
  redéfinit un objet fait foi) et `lib/database.types.ts`. Pour vérifier un
  comportement, interroge la pile **locale** (`docker exec
  supabase_db_easyjob-cm psql …` ou le MCP local `127.0.0.1:54321/mcp`),
  jamais le projet distant.
- Ne modifie jamais une migration déjà appliquée ni `_archive/` :
  l'historique est rejoué par la CI et par `supabase db push`. Toute
  correction passe par une nouvelle migration horodatée.

## Format d'une migration

```sql
-- Migration : description courte (lot N)
-- Date : AAAA-MM-JJ
-- Tables : …   Fonctions : …
-- Contexte : constat, décision produit, AUDIT.md §…
-- Rollback : SQL de retour arrière en commentaire
```

Idempotente quand c'est possible (`create or replace`, `if not exists`) ;
`drop` sans `cascade` (une dépendance oubliée doit faire échouer la
migration) ; garde-fou explicite si des données existantes rendent la
migration ambiguë.

## Droits

- RLS activée sur toute table de `public`. La RLS filtre des **lignes** : une
  politique UPDATE « propriétaire » laisse écrire toutes les colonnes
  accordées. Les colonnes qui portent un droit sont protégées par
  privilèges de colonnes (`grant update (col, …)`) **et** par un trigger
  fondé sur `current_user` (jamais le seul GUC `easyjob.system_update`).
- Ajouter une colonne écrivable en session = l'ajouter au `GRANT` **et** à
  la liste du trigger de protection de la table
  (`protect_user_account_columns`, `protect_candidate_profile_columns`,
  `protect_company_profile_columns`, `protect_job_writes`…).
- Écritures de confiance : RPC `SECURITY DEFINER`, `set search_path = ''`,
  contrôle d'appelant interne (`auth.uid()`, `is_admin_user()` et grade),
  verrous (`for update`) pour les compteurs et les places, `audit_logs` pour
  les actions admin, codes d'erreur métier en `raise exception 'code'`
  (traduits par les routes, à ne pas renommer).
- Contrôle de grade : `is_admin_user()` / `is_ops_admin_user()` (compte actif
  exigé), ou une relecture de `users` avec `is_active is not false` ; jamais
  un rôle seul, qu'un admin suspendu garderait (lot 10).
- `revoke … from public, anon, authenticated` sur les fonctions internes.
- Calculs dupliqués en TypeScript (`profile_completion_pct` ↔
  `computeCandidateCriteria`, réputation, CNI) : modifier les deux et le test
  de cohérence.

## Temps réel

Nouvelle table visible à l'écran : trigger qui appelle `rt_signal_users`,
`rt_signal_admin` ou `rt_signal_public_jobs` (migration
`20261107150000_app_realtime_signals.sql`). Pas d'ajout à la publication
`supabase_realtime` d'une table sensible.

## Après la migration

1. Pile de preuve : `supabase db reset --workdir $stack` (ou
   `init-proof-stack` puis `start`).
2. Types : `pnpm exec supabase gen types typescript --local --workdir $stack --schema public > lib/database.types.ts`.
3. Preuve d'autorisation (nouvelle ou adaptée) et `pnpm test:rls`.
4. Requête de comptage en lecture seule à exécuter avant le déploiement, si
   des données existantes sont touchées (consignée dans `AUDIT.md`).
