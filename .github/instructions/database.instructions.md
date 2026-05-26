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
