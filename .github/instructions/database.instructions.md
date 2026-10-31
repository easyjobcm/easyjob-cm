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
