---
applyTo: "**/*.sql,**/migrations/**,**/supabase/**"
---

# Instructions Base de données — Easyjob CM

## Toujours appliquer sur les fichiers SQL et migrations

- Interroger le schéma réel via MCP Supabase avant d'écrire du SQL
- Toujours inclure created_at DEFAULT now() et updated_at sur chaque table
- IDs : uuid NOT NULL DEFAULT gen_random_uuid()
- Index obligatoires sur toutes les foreign keys
- RLS activée sur toutes les tables contenant des données utilisateur
- Jamais de SELECT * — toujours lister les colonnes explicitement
- Les colonnes sensibles (phone, cni_number, momo_number) protégées par RLS
  (la RLS filtre des LIGNES : une policy UPDATE « own row » laisse écrire
  toutes les colonnes accordées — voir ci-dessous pour les colonnes de droits)

## Colonnes porteuses de droits — `public.users`

Mécanisme en place (migration `20261031120000_lock_users_privileged_columns.sql`) :

- `anon`/`authenticated` : `SELECT` + `UPDATE (locale)` uniquement ; aucun
  `INSERT`/`DELETE`. Ne jamais réaccorder `INSERT`/`UPDATE` sur la table.
- Trigger `trg_protect_user_account_columns` : refuse (42501) toute écriture
  faite en `anon`/`authenticated` autre que `locale`. Les écritures de
  confiance passent par `service_role` (serveur) ou une RPC
  `SECURITY DEFINER` gardée (`is_admin_user` + grade).
- Le rôle n'est jamais lu depuis `user_metadata` (modifiable par le client) :
  choix d'inscription limité à `candidate | company`
  (`lib/auth/signup-role.ts`, `handle_new_user()`), rôle existant jamais
  réécrit (`lib/auth/finalize-signup.ts`), `app_metadata.role` recopié
  depuis `public.users`.
- Preuve : `scripts/proof-account-security.ts` (pile locale uniquement).

## Colonnes et tables porteuses de droits — lot 2

Migration `20261031130000_lock_business_permissions.sql`, même principe
(privilèges de colonnes + trigger sur `current_user`, jamais le seul GUC
`easyjob.system_update`) :

- `candidate_profiles` : `authenticated` n'écrit que les colonnes ordinaires
  listées dans les `GRANT INSERT/UPDATE (…)` de la migration. Niveau,
  premium, permis, statistiques, vérifications CNI/MoMo : `service_role` ou
  RPC. Ajouter une colonne écrivable en session = l'ajouter au `GRANT` **et**
  à la liste du trigger `protect_candidate_profile_columns`.
- `profile_completion_pct` est calculé par la base
  (`candidate_profile_completion_pct`, traduction de
  `computeCandidateCriteria`) : modifier les critères dans **les deux**.
  Toute nouvelle donnée entrant dans le calcul, y compris venant d'une
  table liée, doit relancer ce calcul (voir
  `refresh_candidate_profile_completion` pour `candidate_skills`).
  `onboarding_status` est dérivé pour les écritures candidat (règles de
  l'assistant) ; ne jamais l'écrire depuis le client.
- Données vérifiées (F-35) : sur une CNI vérifiée, l'identité et les
  photos CNI ne s'écrivent en session qu'avec une demande admin pending
  (`trg_protect_verified_candidate_data`, qui repasse la CNI en `pending` et
  clôture la demande dans la même écriture). La déclaration MoMo passe
  uniquement par `candidate_update_momo`. `users.is_verified` est recalculé
  automatiquement (`trg_sync_user_verification_from_profile`) : ne jamais
  l'écrire, ni compter sur un appel manuel de `recompute_user_verification`.
- `job_applications` : création par `apply_to_job(job_id)`, retrait
  (`pending → withdrawn`) par `withdraw_job_application(job_id)`. Ces RPC
  sont la source de référence des règles de candidature ; la route ne fait
  que traduire leurs codes. L'entreprise n'écrit que `status`
  (`shortlisted`/`selected`/`rejected`), `selected_at`, `selected_by`
  (= elle-même) et `rejection_reason`.
- `subscriptions` : écriture `service_role` uniquement (aucun grade admin en
  session). `otp_codes` : aucun accès `anon`/`authenticated`.
- Preuve : `scripts/proof-business-permissions.ts`.

## Tables interdites dans le code MVP

wallets · withdrawal_requests · payment_batches

## Types ENUM du projet

user_role · mission_status · job_status · contract_status
payment_status · verification_status · onboarding_status · locale_type

## Colonnes sensibles protégées (jamais visibles par les entreprises)

candidate_profiles : phone (via users), cni_number, cni_front_url, cni_back_url,
cni_selfie_url, momo_number, home_gps_lat, home_gps_lng

## Format migration obligatoire

-- Migration : [description courte]
-- Date : [date]
-- Tables affectées : [liste]
-- Rollback : [SQL de rollback en commentaire]
