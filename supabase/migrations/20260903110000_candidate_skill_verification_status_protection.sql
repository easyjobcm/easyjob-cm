-- Migration : Protection du statut de vérification des compétences candidat
-- Date : 2026-09-03
-- Tables affectées : candidate_skills (trigger de protection de colonne)
-- Fonctions : recompute_skill_verification_status (SECURITY DEFINER),
--             protect_candidate_skill_verification_status (trigger BEFORE UPDATE)
-- Contexte : candidate_skills a une policy RLS large "Candidates can manage own
--            skills" (ALL, sans restriction de colonne). Sans ce garde-fou, un
--            candidat pourrait passer sa propre compétence à 'verified' en
--            appelant directement l'API Supabase (contournement total de la
--            validation admin). Cette migration verrouille la colonne
--            verification_status : elle ne peut être modifiée que par la
--            fonction de recalcul ci-dessous, qui dérive toujours la valeur
--            réelle depuis le statut des documents liés (jamais une valeur
--            arbitraire fournie par le client).
-- Rollback :
--   drop trigger if exists trg_protect_candidate_skill_verification_status on public.candidate_skills;
--   drop function if exists public.protect_candidate_skill_verification_status();
--   drop function if exists public.recompute_skill_verification_status(uuid);

begin;

create or replace function public.protect_candidate_skill_verification_status()
returns trigger
language plpgsql
as $$
begin
  if new.verification_status is distinct from old.verification_status
     and coalesce(current_setting('easyjob.system_update', true), 'off') <> 'on'
  then
    new.verification_status := old.verification_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_candidate_skill_verification_status on public.candidate_skills;
create trigger trg_protect_candidate_skill_verification_status
  before update on public.candidate_skills
  for each row execute function public.protect_candidate_skill_verification_status();

-- Recalcule le statut réel d'une compétence à partir des documents qui la
-- couvrent. Ne fait jamais confiance à une valeur envoyée par le client :
-- le résultat dépend uniquement de candidate_documents.status (contrôlé
-- côté serveur par les policies admin_ops/admin_founder).
create or replace function public.recompute_skill_verification_status(p_skill_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select cp.user_id into v_owner
  from public.candidate_skills cs
  join public.candidate_profiles cp on cp.id = cs.candidate_id
  where cs.id = p_skill_id;

  if v_owner is null then
    raise exception 'Skill not found';
  end if;

  if v_owner <> (select auth.uid()) and not public.is_admin_user((select auth.uid())) then
    raise exception 'Not authorized';
  end if;

  select case
    when exists (
      select 1
      from public.candidate_skill_documents csd
      join public.candidate_documents cd on cd.id = csd.candidate_document_id
      where csd.candidate_skill_id = p_skill_id
        and cd.status = 'verified'
        and (cd.expires_at is null or cd.expires_at >= current_date)
    ) then 'verified'
    when exists (
      select 1
      from public.candidate_skill_documents csd
      join public.candidate_documents cd on cd.id = csd.candidate_document_id
      where csd.candidate_skill_id = p_skill_id
        and cd.status = 'verified'
        and cd.expires_at is not null
        and cd.expires_at < current_date
    ) then 'expired'
    when exists (
      select 1
      from public.candidate_skill_documents csd
      join public.candidate_documents cd on cd.id = csd.candidate_document_id
      where csd.candidate_skill_id = p_skill_id
        and cd.status = 'pending'
    ) then 'pending'
    when exists (
      select 1
      from public.candidate_skill_documents csd
      join public.candidate_documents cd on cd.id = csd.candidate_document_id
      where csd.candidate_skill_id = p_skill_id
        and cd.status = 'rejected'
    ) then 'rejected'
    else 'unverified'
  end into v_status;

  perform set_config('easyjob.system_update', 'on', true);
  update public.candidate_skills set verification_status = v_status where id = p_skill_id;
  perform set_config('easyjob.system_update', 'off', true);

  return v_status;
end;
$$;

grant execute on function public.recompute_skill_verification_status(uuid) to authenticated;

commit;
