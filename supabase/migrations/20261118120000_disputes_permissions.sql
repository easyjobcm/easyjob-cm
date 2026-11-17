-- Lot 14b — contestations historiques (public.disputes) : plus aucune
-- écriture en session. Non déployée.
--
-- Défaut (AUDIT.md §33, reproduit au lot 14b) : la base initiale accordait
-- ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) à
-- anon et authenticated, avec deux politiques permissives :
--   * disputes_insert_party_or_admin : WITH CHECK (opened_by = auth.uid()
--     OR is_admin_user(auth.uid())) — aucune vérification de la mission.
--     Effet reproduit : un compte étranger à la mission y crée une
--     contestation à son nom, lisible ensuite par les deux parties
--     (disputes_select_party_or_admin) ; la partie elle-même en crée une
--     hors de tout parcours ; un admin (support compris) en crée une au nom
--     de n'importe quel utilisateur (auteur usurpé).
--   * disputes_update_admin_only : tout admin actif, support compris,
--     réécrit directement une ligne (rattachement à une autre mission,
--     statut, résolution) sans passer par les RPC, donc sans audit_logs.
--   * TRUNCATE accordé aux sessions (hors RLS) ; PostgREST ne l'expose pas,
--     retiré par principe.
-- Seule l'écriture des contestations d'avis était déjà fermée en session
-- (trigger du lot 9c).
--
-- Parcours légitimes (inchangés) : admin_open_review_contest et
-- admin_resolve_review_contest (SECURITY DEFINER, grade vérifié, audit) ;
-- lecture admin en clé service (route de réputation) ; lecture par la
-- partie concernée en session (disputes_select_party_or_admin). Aucun
-- écran, route ou script n'écrit directement dans la table. Les
-- signalements par journée du lot 14 vivent dans mission_incidents.
--
-- Après : authenticated garde SELECT (RLS inchangée) ; anon n'a plus rien ;
-- aucune politique d'écriture ; le trigger refuse toute écriture de
-- session (seconde barrière). Table, lignes et historique conservés.
--
-- Retour arrière (déconseillé : rouvre le défaut) : recréer les deux
-- politiques depuis 20260526130000 et le trigger depuis 20261109120000.

revoke all on table public.disputes from anon, authenticated;
grant select on table public.disputes to authenticated;

drop policy if exists disputes_insert_party_or_admin on public.disputes;
drop policy if exists disputes_update_admin_only on public.disputes;

-- Reprise de 20261109120000 : toute écriture de session est refusée (plus
-- seulement celle des contestations d'avis) ; décisions définitives.
create or replace function public.protect_review_contest_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'disputes: use admin_open_review_contest' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.type = 'review_contest'
     and (new.review_id is distinct from old.review_id
          or (old.outcome is not null and new.outcome is distinct from old.outcome)) then
    raise exception 'disputes: review contest decisions are final' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_review_contest_writes() from public, anon, authenticated;

comment on table public.disputes is
  'Litiges historiques et contestations d''avis (review_contest). Écriture par les RPC admin seulement (lot 14b) ; signalements par journée : mission_incidents (lot 14).';
