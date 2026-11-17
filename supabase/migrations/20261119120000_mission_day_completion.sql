-- Lot 15 — fin de journée : saisie du code à l'heure de fin prévue, et
-- confirmation manuelle d'une journée par le support après confirmation
-- explicite de l'entreprise. Non déployée.
--
-- Tables : mission_days.completion_source (nouvelle colonne),
--   mission_incident_contacts, mission_day_confirmations (nouvelles, aucun
--   accès de session).
-- Fonctions : submit_completion_code, report_mission_incident,
--   admin_decide_mission_incident, mission_days_json, company_job_missions,
--   mission_incidents_for_party, admin_mission_incident (redéfinies) ;
--   admin_record_incident_contact, admin_confirm_mission_day,
--   mission_work_confirmed (nouvelles) ; réputation : compute_reputation,
--   reputation_company_offers, reputation_review_admissible,
--   protect_reputation_incidents (règle de réalisation seulement).
--
-- Règles :
--   * Échéance : le code d'une journée n'est reçu qu'à partir de sa fin
--     prévue (mission_days.ends_at, figée, calculée en Africa/Douala ; une
--     journée de 22 h à 6 h finit à 6 h le lendemain), à l'heure de la base.
--     Un envoi anticipé, même avec le bon code, est refusé AVANT toute
--     lecture du code : code, compteur d'essais, blocage et réalisation
--     intacts. Conditions existantes conservées (début confirmé, mission
--     active, candidature sélectionnée).
--   * « Code non remis » (lot 14) : même échéance, début confirmé exigé,
--     y compris en appel direct. Retard et absence : règles du lot 14.
--   * Provenance d'une réalisation (mission_days.completion_source) :
--     'code' (code saisi par le candidat), 'support' (décision du support),
--     'legacy' (réalisation antérieure enregistrée sans code consommé, non
--     comptée, comme avant). La voie manuelle ne consomme jamais le code.
--   * Contacts du support avec l'entreprise : demande (request : envoyée,
--     sans réponse, injoignable) distincte de la réponse obtenue
--     (response : travail confirmé, contesté, autre) ; date, canal,
--     référence privée, note interne ; append-only ; tout admin actif.
--   * Confirmation manuelle : admin_ops ou admin_founder actif, sur un
--     dossier « code non remis » ouvert, journée commencée et fin prévue
--     atteinte, avec une réponse « travail confirmé » de l'entreprise
--     consignée sur ce dossier. Réalisation, décision, trace (audit_logs) et
--     notifications dans une seule transaction. Entreprise injoignable ou
--     travail contesté : le dossier reste en instruction (aucune décision
--     possible sur un « code non remis » hors de cette voie).
--   * Course code / support : verrous mission puis journée dans les deux
--     RPC ; la journée relue après verrou fait foi ; la seconde opération
--     retrouve la réalisation acquise, sans écriture.
--   * Réputation et avis : une journée confirmée par le support compte comme
--     travail effectué ; les règles du lot 12 (mission +1 quand toutes ses
--     journées sont confirmées, offre +1 une fois) et du lot 9c sont
--     inchangées par ailleurs. Aucun paiement, remboursement ni retrait
--     d'étoiles ne découle d'un signalement.
--
-- Retour arrière (pile non déployée) : réappliquer les fonctions des
--   migrations 20261113120000, 20261117120000 et 20261109120000 ; drop table
--   public.mission_day_confirmations, public.mission_incident_contacts ;
--   alter table public.mission_days drop constraint
--   mission_days_completion_source_chk, drop column completion_source.

-- ════════════════════════════════════════════════════════════════════
-- 1. Provenance de la réalisation d'une journée
-- ════════════════════════════════════════════════════════════════════
alter table public.mission_days
  add column if not exists completion_source text
    check (completion_source is null or completion_source in ('code', 'support', 'legacy'));

-- Reprise : code consommé pour la journée → 'code' ; sinon 'legacy'.
-- Sans déclencheur (aucun signal ni recalcul : rien ne change de sens).
alter table public.mission_days disable trigger user;
update public.mission_days d
set completion_source = case
  when exists (select 1 from public.mission_completion_codes c
               where c.mission_day_id = d.id and c.consumed_at is not null)
  then 'code' else 'legacy' end
where d.actual_end_time is not null and d.completion_source is null;
alter table public.mission_days enable trigger user;

alter table public.mission_days drop constraint if exists mission_days_completion_source_chk;
alter table public.mission_days add constraint mission_days_completion_source_chk
  check ((actual_end_time is null) = (completion_source is null));

comment on column public.mission_days.completion_source is
  'Lot 15 : provenance de la réalisation de la journée : code (saisi par le candidat), support (décision après confirmation de l''entreprise, mission_day_confirmations), legacy (antérieure, sans code consommé, non comptée).';

create or replace function public.protect_mission_day_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_bounds record;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_days: use start_mission / submit_completion_code'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.mission_id is distinct from old.mission_id
       or (new.job_day_id is distinct from old.job_day_id and new.job_day_id is not null) then
      raise exception 'mission_days: mission is immutable' using errcode = '42501';
    end if;
    if old.actual_start_time is not null
       and new.actual_start_time is distinct from old.actual_start_time then
      raise exception 'mission_days: start already recorded' using errcode = '42501';
    end if;
    if old.actual_end_time is not null
       and (new.actual_end_time, new.completion_source)
           is distinct from (old.actual_end_time, old.completion_source) then
      raise exception 'mission_days: completion already recorded' using errcode = '42501';
    end if;
    if old.actual_start_time is not null
       and (new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time)
           is distinct from (old.scheduled_date, old.scheduled_start_time, old.scheduled_end_time) then
      raise exception 'mission_days: schedule is frozen once started' using errcode = '42501';
    end if;
  end if;
  select * into v_bounds from public.mission_schedule_bounds(
    new.scheduled_date, new.scheduled_start_time, new.scheduled_end_time);
  new.starts_at := v_bounds.starts_at;
  new.ends_at := v_bounds.ends_at;
  return new;
end;
$$;
revoke all on function public.protect_mission_day_writes() from public, anon, authenticated;

-- Travail effectué : toutes les journées de la mission confirmées, par code
-- ou par le support (lecture partagée par la réputation et les avis).
create or replace function public.mission_work_confirmed(p_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.missions m
                 where m.id = p_mission_id and m.actual_end_time is not null)
     and exists (select 1 from public.mission_days d where d.mission_id = p_mission_id)
     and not exists (select 1 from public.mission_days d
                     where d.mission_id = p_mission_id
                       and coalesce(d.completion_source, '') not in ('code', 'support'));
$$;
revoke all on function public.mission_work_confirmed(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 2. Contacts du support et confirmations manuelles
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.mission_incident_contacts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  entry_type text not null check (entry_type in ('request', 'response')),
  channel text not null
    check (channel in ('phone', 'sms', 'whatsapp', 'email', 'in_person', 'other')),
  occurred_at timestamptz not null,
  result text not null,
  reference text check (reference is null or length(reference) between 3 and 500),
  note text check (note is null or length(note) between 1 and 2000),
  recorded_by uuid references public.users(id) on delete set null,
  recorded_by_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint mission_incident_contacts_result_chk check (
    (entry_type = 'request' and result in ('sent', 'no_answer', 'unreachable'))
    or (entry_type = 'response' and result in ('work_confirmed', 'work_disputed', 'other'))),
  -- Une confirmation de l'entreprise porte toujours sa référence privée.
  constraint mission_incident_contacts_reference_chk check (
    result <> 'work_confirmed' or reference is not null)
);
create index if not exists idx_mission_incident_contacts_incident
  on public.mission_incident_contacts (incident_id, occurred_at);

comment on table public.mission_incident_contacts is
  'Lot 15 : contacts du support avec l''entreprise sur un signalement : demande (request) ou réponse effectivement obtenue (response), date, canal, résultat, référence privée et note interne. Support seulement (admin_mission_incident) ; append-only.';

create table if not exists public.mission_day_confirmations (
  id uuid primary key default gen_random_uuid(),
  mission_day_id uuid not null unique references public.mission_days(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  incident_id uuid not null unique references public.mission_incidents(id) on delete cascade,
  contact_id uuid not null references public.mission_incident_contacts(id) on delete cascade,
  basis text not null default 'company_confirmed' check (basis = 'company_confirmed'),
  reason text not null check (length(reason) between 10 and 2000),
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_by_role text not null,
  confirmed_at timestamptz not null default now()
);
create index if not exists idx_mission_day_confirmations_mission
  on public.mission_day_confirmations (mission_id);

comment on table public.mission_day_confirmations is
  'Lot 15 : journée confirmée par le support (admin_ops, admin_founder) après confirmation explicite de l''entreprise (contact_id : réponse « travail confirmé »), rattachée au candidat, à la journée et au dossier « code non remis ». Motif interne. Aucun accès de session.';

alter table public.mission_incident_contacts enable row level security;
alter table public.mission_day_confirmations enable row level security;
revoke all on table public.mission_incident_contacts from public, anon, authenticated;
revoke all on table public.mission_day_confirmations from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_incident_contacts to service_role;
grant select, insert, update, delete on table public.mission_day_confirmations to service_role;

-- Même protection que les déclarations du lot 14 : aucune écriture de
-- session, lignes append-only.
drop trigger if exists trg_protect_mission_incident_contacts on public.mission_incident_contacts;
create trigger trg_protect_mission_incident_contacts
  before insert or update or delete on public.mission_incident_contacts
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_day_confirmations on public.mission_day_confirmations;
create trigger trg_protect_mission_day_confirmations
  before insert or update or delete on public.mission_day_confirmations
  for each row execute function public.protect_mission_incident_writes();

-- Signal minimal au seul support (aucune donnée, aucune partie).
create or replace function public.rt_on_incident_support_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_incident_support_rows() from public, anon, authenticated;

drop trigger if exists trg_rt_mission_incident_contacts on public.mission_incident_contacts;
create trigger trg_rt_mission_incident_contacts
  after insert on public.mission_incident_contacts
  for each row execute function public.rt_on_incident_support_rows();
drop trigger if exists trg_rt_mission_day_confirmations on public.mission_day_confirmations;
create trigger trg_rt_mission_day_confirmations
  after insert on public.mission_day_confirmations
  for each row execute function public.rt_on_incident_support_rows();

-- ════════════════════════════════════════════════════════════════════
-- 3. Code de fin : reçu à partir de la fin prévue
-- ════════════════════════════════════════════════════════════════════
create or replace function public.submit_completion_code(
  p_mission_id uuid,
  p_code text,
  p_mission_day_id uuid default null
)
returns table (
  result text,
  mission_id uuid,
  mission_day_id uuid,
  completed_at timestamptz,
  mission_completed boolean,
  remaining_attempts integer,
  locked_until timestamptz,
  already_completed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user_active boolean;
  v_mission public.missions;
  v_day public.mission_days;
  v_job public.jobs;
  v_candidate record;
  v_code public.mission_completion_codes;
  v_application_status public.application_status;
  v_company record;
  v_failed integer;
  v_window timestamptz;
  v_day_count integer;
  v_done boolean;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.is_active into v_user_active from public.users u where u.id = v_uid;
  if v_user_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;

  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;
  select cp.id, cp.first_name into v_candidate from public.candidate_profiles cp
  where cp.id = v_mission.candidate_id and cp.user_id = v_uid;
  if not found then
    raise exception 'mission_not_found';
  end if;

  select count(*) into v_day_count from public.mission_days d where d.mission_id = v_mission.id;
  if p_mission_day_id is null then
    if v_day_count <> 1 then
      raise exception 'mission_day_required';
    end if;
    select d.* into v_day from public.mission_days d where d.mission_id = v_mission.id for update;
  else
    select d.* into v_day from public.mission_days d
    where d.id = p_mission_day_id and d.mission_id = v_mission.id for update;
    if not found then
      raise exception 'mission_not_found';
    end if;
  end if;

  -- Réalisation déjà acquise (par code ou par le support) : même résultat.
  if v_day.actual_end_time is not null then
    return query select 'completed'::text, v_mission.id, v_day.id, v_day.actual_end_time,
      v_mission.actual_end_time is not null, null::integer, null::timestamptz, true;
    return;
  end if;

  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status in ('cancelled', 'no_show', 'disputed')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;
  if v_day.actual_start_time is null then
    raise exception 'not_started';
  end if;
  -- Lot 15 : fin prévue de la journée (horaire figé), heure de la base.
  -- Refus avant toute lecture du code : rien n'est compté ni modifié.
  if now() < v_day.ends_at then
    raise exception 'completion_not_open'
      using detail = to_char(v_day.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  select c.* into v_code from public.mission_completion_codes c
  where c.mission_day_id = v_day.id for update;
  if not found or v_code.consumed_at is not null then
    raise exception 'code_unavailable';
  end if;

  if v_code.locked_until is not null and v_code.locked_until > now() then
    return query select 'locked'::text, v_mission.id, v_day.id, null::timestamptz, false, 0,
      v_code.locked_until, false;
    return;
  end if;

  if p_code is null or btrim(p_code) is distinct from v_code.code then
    v_window := case when v_code.attempt_window_started_at is null
                       or v_code.attempt_window_started_at < now() - interval '15 minutes'
                     then now() else v_code.attempt_window_started_at end;
    v_failed := case when v_window = now() then 1 else v_code.failed_attempts + 1 end;
    if v_failed >= 5 then
      update public.mission_completion_codes c
      set failed_attempts = 0, attempt_window_started_at = null,
          locked_until = now() + interval '15 minutes'
      where c.mission_day_id = v_day.id
      returning c.* into v_code;
      return query select 'locked'::text, v_mission.id, v_day.id, null::timestamptz, false, 0,
        v_code.locked_until, false;
    else
      update public.mission_completion_codes c
      set failed_attempts = v_failed, attempt_window_started_at = v_window,
          locked_until = null
      where c.mission_day_id = v_day.id;
      return query select 'invalid'::text, v_mission.id, v_day.id, null::timestamptz, false,
        5 - v_failed, null::timestamptz, false;
    end if;
    return;
  end if;

  update public.mission_completion_codes c
  set consumed_at = now(), failed_attempts = 0, attempt_window_started_at = null,
      locked_until = null
  where c.mission_day_id = v_day.id;
  insert into public.mission_check_ins (mission_id, check_in_type, checked_at)
  values (v_mission.id, 'departure', now());
  update public.mission_days d set actual_end_time = now(), completion_source = 'code'
  where d.id = v_day.id returning d.* into v_day;

  v_done := not exists (select 1 from public.mission_days d
                        where d.mission_id = v_mission.id and d.actual_end_time is null);
  if v_done then
    update public.missions m
    set actual_end_time = now(), status = 'completed'
    where m.id = v_mission.id
    returning m.* into v_mission;
  end if;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;
  select cp.user_id, u.locale::text as locale into v_company
  from public.company_profiles cp join public.users u on u.id = cp.user_id
  where cp.id = v_job.company_id;
  if v_company.user_id is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_company.user_id, 'mission_update',
      case
        when v_done and v_company.locale = 'en' then 'Mission completed'
        when v_done then 'Mission réalisée'
        when v_company.locale = 'en' then 'Day confirmed'
        else 'Journée confirmée' end,
      case
        when v_done and v_company.locale = 'en'
          then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed the completion of "' || v_job.title || '".'
        when v_done
          then coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé la réalisation de « ' || v_job.title || ' ».'
        when v_company.locale = 'en'
          then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed the day of '
               || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || ' for "' || v_job.title || '".'
        else coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé la journée du '
             || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || ' pour « ' || v_job.title || ' ».' end,
      jsonb_build_object('mission_id', v_mission.id, 'job_id', v_job.id,
                         'mission_status', v_mission.status)
    );
  end if;

  return query select 'completed'::text, v_mission.id, v_day.id, v_day.actual_end_time,
    v_done, null::integer, null::timestamptz, false;
end;
$$;
revoke all on function public.submit_completion_code(uuid, text, uuid) from public, anon;
grant execute on function public.submit_completion_code(uuid, text, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. « Code non remis » : même échéance, début confirmé
-- ════════════════════════════════════════════════════════════════════
create or replace function public.report_mission_incident(
  p_mission_id uuid,
  p_mission_day_id uuid,
  p_kind text,
  p_statement text,
  p_late_minutes integer default null
)
returns table (incident_id uuid, status text, already_reported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_party text;
  v_mission public.missions;
  v_day public.mission_days;
  v_job public.jobs;
  v_existing public.mission_incidents;
  v_id uuid;
  v_body text := btrim(coalesce(p_statement, ''));
  v_other uuid;
  v_locale text;
  v_kind_fr text;
  v_kind_en text;
begin
  v_party := public.mission_incident_party(v_uid, p_mission_id);

  if p_kind is null or p_kind not in ('late', 'absence', 'code_not_received') then
    raise exception 'incident_kind_invalid';
  end if;
  if p_kind = 'code_not_received' and v_party <> 'candidate' then
    raise exception 'incident_kind_invalid';
  end if;

  -- Verrous dans l'ordre de submit_completion_code : mission puis journée.
  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  select d.* into v_day from public.mission_days d
  where d.id = p_mission_day_id and d.mission_id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;

  -- Double envoi ou relance : le dossier existant, sans écriture.
  select i.* into v_existing from public.mission_incidents i
  where i.mission_day_id = v_day.id and i.kind = p_kind and i.reported_by_party = v_party;
  if found then
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  if length(v_body) < 10 or length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  if p_kind = 'late' then
    if p_late_minutes is not null and (p_late_minutes < 1 or p_late_minutes > 720) then
      raise exception 'late_minutes_invalid';
    end if;
  elsif p_late_minutes is not null then
    raise exception 'late_minutes_invalid';
  end if;

  if coalesce(v_mission.status::text, 'pending') in ('cancelled', 'no_show') then
    raise exception 'mission_not_active';
  end if;
  -- Journée confirmée (code ou support) : le travail a eu lieu ce jour-là.
  if p_kind in ('absence', 'code_not_received') and v_day.actual_end_time is not null then
    raise exception 'day_already_confirmed';
  end if;
  -- Constat de l'entreprise : après le début prévu.
  if v_party = 'company' and now() < v_day.starts_at then
    raise exception 'day_not_started';
  end if;
  -- Lot 15 : « code non remis » aux mêmes conditions que la saisie du code
  -- (début confirmé, fin prévue atteinte).
  if p_kind = 'code_not_received' then
    if v_day.actual_start_time is null then
      raise exception 'start_not_confirmed';
    end if;
    if now() < v_day.ends_at then
      raise exception 'day_not_ended'
        using detail = to_char(v_day.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    end if;
  end if;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;

  insert into public.mission_incidents (
    mission_id, mission_day_id, job_id, candidate_id, company_id, kind,
    reported_by_party, reported_by, late_minutes
  ) values (
    v_mission.id, v_day.id, v_job.id, v_mission.candidate_id, v_job.company_id, p_kind,
    v_party, v_uid, case when p_kind = 'late' then p_late_minutes end
  )
  on conflict (mission_day_id, kind, reported_by_party) do nothing
  returning id into v_id;
  if v_id is null then
    select i.* into v_existing from public.mission_incidents i
    where i.mission_day_id = v_day.id and i.kind = p_kind and i.reported_by_party = v_party;
    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  insert into public.mission_incident_statements (incident_id, party, author_id, body)
  values (v_id, v_party, v_uid, v_body);

  v_other := (public.mission_incident_parties(v_id))[case when v_party = 'candidate' then 2 else 1 end];
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_other;
  v_kind_fr := case p_kind when 'late' then 'un retard' when 'absence' then 'une absence'
               else 'un code de fin non remis' end;
  v_kind_en := case p_kind when 'late' then 'a delay' when 'absence' then 'an absence'
               else 'an end code not received' end;
  if v_other is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_other, 'mission_update',
      case when v_locale = 'en' then 'Mission incident reported' else 'Signalement sur une mission' end,
      case when v_locale = 'en'
        then 'An incident (' || v_kind_en || ') was reported for "' || v_job.title || '" on '
             || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || '. You can give your version.'
        else 'Un signalement (' || v_kind_fr || ') concerne « ' || v_job.title || ' » le '
             || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || '. Vous pouvez donner votre version.' end,
      jsonb_build_object('kind', 'mission_incident', 'incident_id', v_id,
        'mission_id', v_mission.id, 'mission_day_id', v_day.id,
        'href', case when v_party = 'candidate' then '/company/jobs/' || v_job.id
                     else '/missions/' || v_mission.id end));
  end if;

  return query select v_id, 'open'::text, false;
end;
$$;
revoke all on function public.report_mission_incident(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.report_mission_incident(uuid, uuid, text, text, integer) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Décision générique : jamais sur un « code non remis »
-- ════════════════════════════════════════════════════════════════════
-- Un « code non remis » ne se tranche que par la confirmation de la journée
-- (section 7). Entreprise injoignable ou travail contesté : le dossier reste
-- en instruction (décision produit ouverte).
create or replace function public.admin_decide_mission_incident(
  p_incident_id uuid,
  p_outcome text,
  p_note text
)
returns table (incident_id uuid, outcome text, already_decided boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_incident public.mission_incidents;
  v_note text := btrim(coalesce(p_note, ''));
  v_parties uuid[];
  v_user uuid;
  v_locale text;
  v_title text;
  v_date date;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_outcome is null or p_outcome not in ('established', 'not_established') then
    raise exception 'outcome_invalid';
  end if;
  if length(v_note) < 10 or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;

  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  if v_incident.kind = 'code_not_received' then
    raise exception 'use_day_confirmation';
  end if;
  perform 1 from public.missions m where m.id = v_incident.mission_id for update;
  perform 1 from public.mission_days d where d.id = v_incident.mission_day_id for update;
  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id for update;

  if v_incident.status = 'decided' then
    if v_incident.outcome = p_outcome and v_incident.decision_note = v_note then
      return query select v_incident.id, v_incident.outcome, true;
      return;
    end if;
    raise exception 'incident_already_decided';
  end if;
  if v_incident.status = 'closed' then
    raise exception 'incident_closed';
  end if;

  update public.mission_incidents i
  set status = 'decided', outcome = p_outcome, decision_note = v_note,
      decided_by = v_uid, decided_at = now()
  where i.id = v_incident.id;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'decide_mission_incident', 'mission_incidents', v_incident.id,
          jsonb_build_object('outcome', p_outcome, 'note', v_note, 'kind', v_incident.kind,
                             'mission_id', v_incident.mission_id,
                             'mission_day_id', v_incident.mission_day_id,
                             'reported_by_party', v_incident.reported_by_party));

  v_parties := public.mission_incident_parties(v_incident.id);
  select j.title into v_title from public.jobs j where j.id = v_incident.job_id;
  select d.scheduled_date into v_date from public.mission_days d where d.id = v_incident.mission_day_id;
  foreach v_user in array v_parties loop
    continue when v_user is null;
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_user;
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_user, 'mission_update',
      case when v_locale = 'en' then 'Incident reviewed by support' else 'Signalement examiné par le support' end,
      case when v_locale = 'en'
        then 'Support reviewed the incident for "' || v_title || '" on ' || to_char(v_date, 'YYYY-MM-DD') || '.'
        else 'Le support a examiné le signalement pour « ' || v_title || ' » le ' || to_char(v_date, 'DD/MM/YYYY') || '.' end,
      jsonb_build_object('kind', 'mission_incident', 'incident_id', v_incident.id,
        'mission_id', v_incident.mission_id, 'mission_day_id', v_incident.mission_day_id,
        'href', case when v_user = v_parties[1] then '/missions/' || v_incident.mission_id
                     else '/company/jobs/' || v_incident.job_id end));
  end loop;

  return query select v_incident.id, p_outcome, false;
end;
$$;
revoke all on function public.admin_decide_mission_incident(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_mission_incident(uuid, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Consigner un contact avec l'entreprise (tout admin actif)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_record_incident_contact(
  p_incident_id uuid,
  p_entry_type text,
  p_channel text,
  p_occurred_at timestamptz,
  p_result text,
  p_reference text default null,
  p_note text default null
)
returns table (contact_id uuid, already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_incident public.mission_incidents;
  v_day public.mission_days;
  v_reference text := nullif(btrim(coalesce(p_reference, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;

  if p_entry_type is null or p_entry_type not in ('request', 'response')
     or p_channel is null
     or p_channel not in ('phone', 'sms', 'whatsapp', 'email', 'in_person', 'other')
     or p_result is null
     or not ((p_entry_type = 'request' and p_result in ('sent', 'no_answer', 'unreachable'))
             or (p_entry_type = 'response'
                 and p_result in ('work_confirmed', 'work_disputed', 'other'))) then
    raise exception 'contact_invalid';
  end if;
  if p_result = 'work_confirmed' and v_reference is null then
    raise exception 'reference_required';
  end if;
  if (v_reference is not null and length(v_reference) not between 3 and 500)
     or (v_note is not null and length(v_note) > 2000) then
    raise exception 'contact_invalid';
  end if;

  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  select d.* into v_day from public.mission_days d where d.id = v_incident.mission_day_id;
  -- Contact daté entre le début prévu de la journée et maintenant (5 min de
  -- tolérance d'horloge).
  if p_occurred_at is null or p_occurred_at < v_day.starts_at
     or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'contact_date_invalid';
  end if;

  -- Double envoi : la même entrée, sans écriture.
  select c.id into v_id from public.mission_incident_contacts c
  where c.incident_id = v_incident.id and c.entry_type = p_entry_type
    and c.channel = p_channel and c.occurred_at = p_occurred_at and c.result = p_result
    and c.reference is not distinct from v_reference and c.note is not distinct from v_note;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  if v_incident.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;

  insert into public.mission_incident_contacts (
    incident_id, entry_type, channel, occurred_at, result, reference, note,
    recorded_by, recorded_by_role
  ) values (
    v_incident.id, p_entry_type, p_channel, p_occurred_at, p_result, v_reference, v_note,
    v_uid, v_role
  ) returning id into v_id;

  -- Trace sans la référence ni la note (privées, lues dans le dossier).
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'record_incident_contact', 'mission_incidents', v_incident.id,
          jsonb_build_object('contact_id', v_id, 'entry_type', p_entry_type,
                             'channel', p_channel, 'result', p_result,
                             'occurred_at', p_occurred_at));

  return query select v_id, false;
end;
$$;
revoke all on function public.admin_record_incident_contact(uuid, text, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.admin_record_incident_contact(uuid, text, text, timestamptz, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Confirmer la journée (admin_ops, admin_founder)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_confirm_mission_day(
  p_incident_id uuid,
  p_contact_id uuid,
  p_reason text
)
returns table (
  result text,
  incident_id uuid,
  mission_day_id uuid,
  completed_at timestamptz,
  completed_via text,
  mission_completed boolean,
  confirmation_id uuid,
  already_confirmed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_incident public.mission_incidents;
  v_mission public.missions;
  v_day public.mission_days;
  v_contact public.mission_incident_contacts;
  v_application_status public.application_status;
  v_confirmation uuid;
  v_done boolean;
  v_title text;
  v_first_name text;
  v_parties uuid[];
  v_locale text;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'note_invalid';
  end if;

  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  if v_incident.kind <> 'code_not_received' then
    raise exception 'incident_kind_invalid';
  end if;

  -- Ordre de submit_completion_code : mission, journée ; puis le dossier.
  select m.* into v_mission from public.missions m where m.id = v_incident.mission_id for update;
  select d.* into v_day from public.mission_days d where d.id = v_incident.mission_day_id for update;
  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id for update;

  -- Réalisation déjà acquise (code saisi entre-temps, ou relance) : le
  -- résultat existant, sans écriture.
  if v_day.actual_end_time is not null then
    select c.id into v_confirmation from public.mission_day_confirmations c
    where c.mission_day_id = v_day.id;
    return query select 'already_confirmed'::text, v_incident.id, v_day.id, v_day.actual_end_time,
      v_day.completion_source, v_mission.actual_end_time is not null, v_confirmation, true;
    return;
  end if;

  if v_incident.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;
  select a.status into v_application_status
  from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status in ('cancelled', 'no_show', 'disputed')
     or v_application_status is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;
  if v_day.actual_start_time is null then
    raise exception 'start_not_confirmed';
  end if;
  if now() < v_day.ends_at then
    raise exception 'day_not_ended'
      using detail = to_char(v_day.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  -- Confirmation explicite de l'entreprise, consignée sur CE dossier.
  select c.* into v_contact from public.mission_incident_contacts c
  where c.id = p_contact_id and c.incident_id = v_incident.id;
  if not found or v_contact.entry_type <> 'response' or v_contact.result <> 'work_confirmed' then
    raise exception 'company_confirmation_required';
  end if;

  -- Décision d'abord (le dossier n'est pas clos « journée confirmée »).
  update public.mission_incidents i
  set status = 'decided', outcome = 'established', decision_note = v_reason,
      decided_by = v_uid, decided_at = now()
  where i.id = v_incident.id;

  insert into public.mission_day_confirmations (
    mission_day_id, mission_id, candidate_id, incident_id, contact_id, reason,
    confirmed_by, confirmed_by_role
  ) values (
    v_day.id, v_mission.id, v_mission.candidate_id, v_incident.id, v_contact.id, v_reason,
    v_uid, v_role
  ) returning id into v_confirmation;

  -- Réalisation de la journée : provenance « support », code jamais consommé.
  update public.mission_days d set actual_end_time = now(), completion_source = 'support'
  where d.id = v_day.id returning d.* into v_day;

  v_done := not exists (select 1 from public.mission_days d
                        where d.mission_id = v_mission.id and d.actual_end_time is null);
  if v_done then
    update public.missions m
    set actual_end_time = now(), status = 'completed'
    where m.id = v_mission.id
    returning m.* into v_mission;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'confirm_mission_day', 'mission_days', v_day.id,
          jsonb_build_object('incident_id', v_incident.id, 'confirmation_id', v_confirmation,
                             'contact_id', v_contact.id, 'mission_id', v_mission.id,
                             'candidate_id', v_mission.candidate_id,
                             'mission_completed', v_done, 'basis', 'company_confirmed'));

  select j.title into v_title from public.jobs j where j.id = v_mission.job_id;
  select cp.first_name into v_first_name from public.candidate_profiles cp
  where cp.id = v_mission.candidate_id;
  v_parties := public.mission_incident_parties(v_incident.id);

  if v_parties[1] is not null then
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_parties[1];
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_parties[1], 'mission_update',
      case when v_locale = 'en' then 'Day confirmed by support' else 'Journée confirmée par le support' end,
      case when v_locale = 'en'
        then 'After checking with the company, support confirmed your day of '
             || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || ' for "' || v_title || '".'
             || case when v_done then ' The mission is completed.' else '' end
        else 'Après vérification auprès de l''entreprise, le support a confirmé votre journée du '
             || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || ' pour « ' || v_title || ' ».'
             || case when v_done then ' La mission est réalisée.' else '' end end,
      jsonb_build_object('kind', 'mission_day_confirmed', 'incident_id', v_incident.id,
        'mission_id', v_mission.id, 'mission_day_id', v_day.id,
        'mission_status', v_mission.status, 'href', '/missions/' || v_mission.id));
  end if;
  if v_parties[2] is not null then
    select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_parties[2];
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_parties[2], 'mission_update',
      case when v_locale = 'en' then 'Day confirmed by support' else 'Journée confirmée par le support' end,
      case when v_locale = 'en'
        then 'Following your confirmation, support recorded the day of '
             || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || ' worked by '
             || coalesce(v_first_name, 'the candidate') || ' for "' || v_title || '".'
        else 'Suite à votre confirmation, le support a enregistré la journée du '
             || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || ' effectuée par '
             || coalesce(v_first_name, 'le candidat') || ' pour « ' || v_title || ' ».' end,
      jsonb_build_object('kind', 'mission_day_confirmed', 'incident_id', v_incident.id,
        'mission_id', v_mission.id, 'mission_day_id', v_day.id, 'job_id', v_mission.job_id,
        'mission_status', v_mission.status, 'href', '/company/jobs/' || v_mission.job_id));
  end if;

  return query select 'confirmed'::text, v_incident.id, v_day.id, v_day.actual_end_time,
    'support'::text, v_done, v_confirmation, false;
end;
$$;
revoke all on function public.admin_confirm_mission_day(uuid, uuid, text) from public, anon;
grant execute on function public.admin_confirm_mission_day(uuid, uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Lectures
-- ════════════════════════════════════════════════════════════════════
-- Journées d'une mission, sans code : échéance de validation et provenance.
create or replace function public.mission_days_json(p_mission_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'date', d.scheduled_date,
           'start_time', d.scheduled_start_time,
           'end_time', d.scheduled_end_time,
           'starts_at', d.starts_at,
           'ends_at', d.ends_at,
           'start_available_at', d.starts_at - interval '15 minutes',
           -- Lot 15 : saisie du code et « code non remis » à la fin prévue.
           'completion_available_at', d.ends_at,
           'started_at', d.actual_start_time,
           'completed_at', d.actual_end_time,
           'completed_via', case when d.completion_source in ('code', 'support')
                                 then d.completion_source end) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;

-- Entreprise propriétaire : provenance de chaque journée ; code retiré dès
-- que la journée est confirmée (par code ou par le support).
drop function if exists public.company_job_missions(uuid);
create function public.company_job_missions(p_job_id uuid)
returns table (
  mission_id uuid,
  mission_day_id uuid,
  application_id uuid,
  status public.mission_status,
  day_date date,
  day_count integer,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  completion_code text,
  code_used boolean,
  completed_via text,
  mission_completed_at timestamptz,
  company_reviewed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs j
    join public.company_profiles cp on cp.id = j.company_id
    where j.id = p_job_id and cp.user_id = (select auth.uid())
  ) then
    raise exception 'job_not_found';
  end if;

  return query
  select m.id, d.id, m.application_id, m.status, d.scheduled_date,
         (select count(*)::integer from public.mission_days x where x.mission_id = m.id),
         d.starts_at, d.ends_at, d.actual_start_time, d.actual_end_time,
         case when c.consumed_at is null and d.actual_end_time is null
                   and m.status not in ('cancelled', 'no_show')
              then c.code end,
         c.consumed_at is not null,
         case when d.completion_source in ('code', 'support') then d.completion_source end,
         m.actual_end_time,
         exists (select 1 from public.reviews r where r.mission_id = m.id
                 and r.reviewer_type = 'company' and r.origin = 'mission_flow')
  from public.missions m
  join public.mission_days d on d.mission_id = m.id
  left join public.mission_completion_codes c on c.mission_day_id = d.id
  where m.job_id = p_job_id
  order by d.starts_at, m.created_at;
end;
$$;
revoke all on function public.company_job_missions(uuid) from public, anon;
grant execute on function public.company_job_missions(uuid) to authenticated;

-- Parties : la confirmation par le support est signalée (resolution), son
-- motif et la référence de l'entreprise restent internes.
drop function if exists public.mission_incidents_for_party(uuid);
create function public.mission_incidents_for_party(p_mission_id uuid)
returns table (
  incident_id uuid,
  mission_day_id uuid,
  day_date date,
  day_starts_at timestamptz,
  kind text,
  reported_by_party text,
  viewer_party text,
  status text,
  late_minutes integer,
  created_at timestamptz,
  statements jsonb,
  evidence_counts jsonb,
  outcome text,
  decision_note text,
  decided_at timestamptz,
  closed_reason text,
  resolution text,
  can_add_statement boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_party text;
begin
  v_party := public.mission_incident_party(auth.uid(), p_mission_id);
  return query
  select i.id, i.mission_day_id, d.scheduled_date, d.starts_at, i.kind, i.reported_by_party,
         v_party, i.status, i.late_minutes, i.created_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                    'party', s.party, 'body', s.body, 'created_at', s.created_at)
                    order by s.created_at)
                   from public.mission_incident_statements s where s.incident_id = i.id), '[]'::jsonb),
         jsonb_build_object(
           'candidate', (select count(*) from public.mission_incident_evidence e
                         where e.incident_id = i.id and e.party = 'candidate'),
           'company', (select count(*) from public.mission_incident_evidence e
                       where e.incident_id = i.id and e.party = 'company')),
         i.outcome,
         case when k.id is null then i.decision_note end,
         i.decided_at, i.closed_reason,
         case when k.id is not null then 'support_confirmed_day' end,
         i.status in ('open', 'answered')
           and (select count(*) from public.mission_incident_statements s
                where s.incident_id = i.id and s.party = v_party) < 5
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  left join public.mission_day_confirmations k on k.incident_id = i.id
  where i.mission_id = p_mission_id
  order by d.starts_at, i.created_at;
end;
$$;
revoke all on function public.mission_incidents_for_party(uuid) from public, anon;
grant execute on function public.mission_incidents_for_party(uuid) to authenticated;

-- Dossier complet pour le support : contacts, confirmation, droits d'action.
create or replace function public.admin_mission_incident(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'incident_id', i.id, 'kind', i.kind, 'status', i.status,
    'reported_by_party', i.reported_by_party, 'late_minutes', i.late_minutes,
    'created_at', i.created_at, 'outcome', i.outcome, 'decision_note', i.decision_note,
    'decided_at', i.decided_at, 'closed_reason', i.closed_reason, 'closed_at', i.closed_at,
    'mission_id', i.mission_id, 'job_title', j.title, 'company_name', cmp.company_name,
    'candidate_name', nullif(btrim(concat_ws(' ', cand.first_name, cand.last_name)), ''),
    'can_decide', public.is_ops_admin_user(v_uid) and i.status in ('open', 'answered')
                  and i.kind <> 'code_not_received',
    'can_record_contact', i.status in ('open', 'answered'),
    'can_confirm_day', public.is_ops_admin_user(v_uid) and i.kind = 'code_not_received'
                       and i.status in ('open', 'answered') and d.actual_end_time is null
                       and d.actual_start_time is not null and now() >= d.ends_at,
    'server_now', now(),
    'day', jsonb_build_object(
      'id', d.id, 'date', d.scheduled_date, 'starts_at', d.starts_at, 'ends_at', d.ends_at,
      'started_at', d.actual_start_time, 'confirmed_at', d.actual_end_time,
      'completed_via', case when d.completion_source in ('code', 'support')
                            then d.completion_source end,
      'code_consumed_at', (select c.consumed_at from public.mission_completion_codes c
                           where c.mission_day_id = d.id)),
    'other_days', coalesce((select jsonb_agg(jsonb_build_object(
        'date', o.scheduled_date, 'confirmed_at', o.actual_end_time,
        'completed_via', case when o.completion_source in ('code', 'support')
                              then o.completion_source end) order by o.starts_at)
      from public.mission_days o where o.mission_id = i.mission_id and o.id <> d.id), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object(
        'party', s.party, 'body', s.body, 'created_at', s.created_at) order by s.created_at)
      from public.mission_incident_statements s where s.incident_id = i.id), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'party', e.party, 'mime_type', e.mime_type, 'size_bytes', e.size_bytes,
        'created_at', e.created_at) order by e.created_at)
      from public.mission_incident_evidence e where e.incident_id = i.id), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'entry_type', c.entry_type, 'channel', c.channel,
        'occurred_at', c.occurred_at, 'result', c.result, 'reference', c.reference,
        'note', c.note, 'recorded_by_role', c.recorded_by_role, 'created_at', c.created_at)
        order by c.occurred_at, c.created_at)
      from public.mission_incident_contacts c where c.incident_id = i.id), '[]'::jsonb),
    'confirmation', (select jsonb_build_object(
        'id', k.id, 'contact_id', k.contact_id, 'reason', k.reason,
        'confirmed_at', k.confirmed_at, 'confirmed_by_role', k.confirmed_by_role)
      from public.mission_day_confirmations k where k.incident_id = i.id))
  into v_result
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  join public.jobs j on j.id = i.job_id
  join public.company_profiles cmp on cmp.id = i.company_id
  join public.candidate_profiles cand on cand.id = i.candidate_id
  where i.id = p_incident_id;
  if v_result is null then
    raise exception 'incident_not_found';
  end if;
  return v_result;
end;
$$;
revoke all on function public.admin_mission_incident(uuid) from public, anon;
grant execute on function public.admin_mission_incident(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 9. Réputation et avis : travail confirmé par code ou par le support
-- ════════════════════════════════════════════════════════════════════
-- Offres réalisées (décision du lot 12, inchangée) : une journée confirmée
-- par le support est du travail confirmé ; « au moins une réalisation » et
-- « tous les engagements résolus » s'entendent de journées confirmées par
-- code ou par le support. Une journée legacy (sans code consommé) reste non
-- résolue, comme avant. Horodatage : dernière confirmation.
create or replace function public.reputation_company_offers(
  p_company_id uuid,
  p_at timestamptz default now()
)
returns table (offer_id uuid, realized_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d.mission_id,
           bool_and(coalesce(d.completion_source, '') in ('code', 'support')) as all_confirmed,
           max(d.actual_end_time) as confirmed_at
    from public.mission_days d
    group by d.mission_id
  ), offer_jobs as (
    select coalesce(j.parent_job_id, j.id) as offer_id, j.id as job_id,
           (j.legacy_publication and j.applications_close_at is null)
             or (j.first_published_at is not null
                 and j.applications_close_at is not null
                 and j.applications_close_at <= p_at) as closed,
           j.applications_close_at
    from public.jobs j
    where j.company_id = p_company_id
  ), offers as (
    select oj.offer_id, bool_and(oj.closed) as closed,
           max(oj.applications_close_at) as close_at
    from offer_jobs oj
    group by oj.offer_id
  ), engagements as (
    select oj.offer_id,
           (a.status = 'selected'
            and m.id is not null
            and m.actual_end_time is not null
            and k.all_confirmed is true) as confirmed,
           case when k.all_confirmed then k.confirmed_at end as confirmed_at
    from offer_jobs oj
    join public.job_applications a on a.job_id = oj.job_id
    left join public.missions m on m.application_id = a.id
    left join days k on k.mission_id = m.id
    where a.status in ('selected', 'no_show')
  )
  select e.offer_id, greatest(max(e.confirmed_at), max(o.close_at))
  from engagements e
  join offers o on o.offer_id = e.offer_id
  where o.closed
  group by e.offer_id
  having bool_or(e.confirmed) and bool_and(e.confirmed);
$$;
revoke all on function public.reputation_company_offers(uuid, timestamptz) from public, anon, authenticated;

-- Score complet (lot 12), inchangé sauf la source de l'expérience du
-- candidat : une unité par mission dont toutes les journées sont confirmées
-- (par code ou par le support).
create or replace function public.compute_reputation(
  p_subject_type text, p_subject_id uuid, p_at timestamptz default now())
returns table (
  stars numeric,
  profile_pct integer,
  profile_stars numeric,
  experience_units integer,
  experience_stars numeric,
  confirmed_count integer,
  breach_count integer,
  review_units integer,
  review_stars numeric,
  skill_count integer,
  skill_stars numeric,
  next_expiry_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pct integer;
  v_exp integer := 0;
  v_confirmed integer := 0;
  v_breaches integer := 0;
  v_reviews integer := 0;
  v_skills integer;
  v_next timestamptz;
  v_window timestamptz[] := '{}';
  v_penalties timestamptz[] := '{}';
  v_company public.company_profiles;
  e record;
begin
  if p_subject_type = 'candidate' then
    select cp.profile_completion_pct into v_pct
    from public.candidate_profiles cp where cp.id = p_subject_id;
    if not found then
      return;
    end if;

    for e in
      select x.at, x.delta from (
        -- Lots 12 et 15 : une unité par mission réalisée (toutes ses
        -- journées confirmées, par code ou par le support).
        select max(d.actual_end_time) as at, 1 as delta, m.id as ref
        from public.missions m
        join public.mission_days d on d.mission_id = m.id
        where m.candidate_id = p_subject_id
          and m.actual_end_time is not null
        group by m.id
        having bool_and(coalesce(d.completion_source, '') in ('code', 'support'))
        union all
        select i.occurred_at, -5, i.id
        from public.reputation_incidents i
        where i.subject_type = 'candidate' and i.subject_id = p_subject_id
          and i.voided_at is null
      ) x
      order by x.at, x.delta desc, x.ref
    loop
      if e.delta > 0 then
        v_confirmed := v_confirmed + 1;
      else
        v_breaches := v_breaches + 1;
      end if;
      v_exp := greatest(0, least(20, v_exp + e.delta));
    end loop;

    v_reviews := public.reputation_review_units('candidate', p_subject_id, 10);

    select count(distinct lower(btrim(cs.skill_name)))::integer into v_skills
    from public.candidate_skills cs
    where cs.candidate_id = p_subject_id
      and exists (
        select 1 from public.candidate_skill_documents csd
        join public.candidate_documents d on d.id = csd.candidate_document_id
        where csd.candidate_skill_id = cs.id and d.candidate_id = p_subject_id
          and public.reputation_document_valid(d.status, d.expires_at, p_at))
      and (public.skill_requires_license(cs.skill_name) is null
           or exists (
             select 1 from public.candidate_documents l
             where l.candidate_id = p_subject_id
               and l.document_type = 'permis_conduire'
               and l.license_category = any (
                 public.license_categories_for(public.skill_requires_license(cs.skill_name)))
               and public.reputation_document_valid(l.status, l.expires_at, p_at)));

    select min(d.expires_at::timestamp at time zone 'UTC') into v_next
    from public.candidate_documents d
    where d.candidate_id = p_subject_id and d.status = 'verified'
      and d.expires_at is not null
      and d.expires_at::timestamp at time zone 'UTC' >= p_at;

    return query select
      (public.reputation_profile_stars(v_pct) + public.reputation_half_stars(v_exp, 20)
       + public.reputation_half_stars(v_reviews, 10)
       + least(coalesce(v_skills, 0), 2) * 0.5)::numeric(2,1),
      v_pct, public.reputation_profile_stars(v_pct),
      v_exp, public.reputation_half_stars(v_exp, 20), v_confirmed, v_breaches,
      v_reviews, public.reputation_half_stars(v_reviews, 10),
      coalesce(v_skills, 0), (least(coalesce(v_skills, 0), 2) * 0.5)::numeric(2,1),
      v_next;
    return;
  end if;

  if p_subject_type = 'company' then
    select cp.* into v_company from public.company_profiles cp where cp.id = p_subject_id;
    if not found then
      return;
    end if;
    v_pct := public.company_profile_completion_pct(v_company);

    for e in
      select i.occurred_at as at
      from public.reputation_incidents i
      where i.subject_type = 'company' and i.subject_id = p_subject_id
        and i.voided_at is null
      order by i.occurred_at, i.id
    loop
      v_breaches := v_breaches + 1;
      v_window := array(select w from unnest(v_window) w where w > e.at - interval '90 days')
                  || e.at;
      if cardinality(v_window) >= 3 then
        v_penalties := v_penalties || e.at;
        v_window := '{}';
      end if;
    end loop;

    for e in
      select x.at, x.delta from (
        select o.realized_at as at, 1 as delta, o.offer_id as ref
        from public.reputation_company_offers(p_subject_id, p_at) o
        union all
        select p.at, -5, null::uuid from unnest(v_penalties) as p(at)
      ) x
      order by x.at, x.delta desc, x.ref
    loop
      if e.delta > 0 then
        v_confirmed := v_confirmed + 1;
      end if;
      v_exp := greatest(0, least(20, v_exp + e.delta));
    end loop;

    v_reviews := public.reputation_review_units('company', p_subject_id, 20);

    return query select
      (public.reputation_profile_stars(v_pct) + public.reputation_half_stars(v_exp, 20)
       + public.reputation_half_stars(v_reviews, 20))::numeric(2,1),
      v_pct, public.reputation_profile_stars(v_pct),
      v_exp, public.reputation_half_stars(v_exp, 20), v_confirmed,
      cardinality(v_penalties),
      v_reviews, public.reputation_half_stars(v_reviews, 20),
      null::integer, null::numeric,
      public.reputation_company_next_close(p_subject_id, p_at);
  end if;
end;
$$;

-- Avis admissible : vérifié, mission dont le travail est confirmé (code ou
-- support), non invalidé.
create or replace function public.reputation_review_admissible(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reviews r
    where r.id = p_review_id
      and r.origin = 'mission_flow'
      and public.mission_work_confirmed(r.mission_id)
      and not exists (select 1 from public.disputes d
                      where d.review_id = r.id and d.type = 'review_contest'
                        and d.outcome = 'upheld'));
$$;

-- Manquement du candidat : refusé si une journée de la mission est
-- confirmée (par code ou par le support).
create or replace function public.protect_reputation_incidents()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if (new.subject_type, new.subject_id, new.kind, new.source,
        new.scheduled_start_at, new.occurred_at, new.created_at)
       is distinct from
       (old.subject_type, old.subject_id, old.kind, old.source,
        old.scheduled_start_at, old.occurred_at, old.created_at)
       or (new.mission_id is distinct from old.mission_id and new.mission_id is not null)
       or (new.job_id is distinct from old.job_id and new.job_id is not null)
       or (new.decided_by is distinct from old.decided_by and new.decided_by is not null)
       or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
      raise exception 'reputation_incidents: only a single void is allowed' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.kind = 'company_late_cancellation' then
    if new.job_id is null or not exists (
      select 1 from public.jobs j
      where j.id = new.job_id and j.company_id = new.subject_id) then
      raise exception 'incident_job_mismatch';
    end if;
  end if;
  if new.kind in ('candidate_late_cancellation', 'candidate_no_show') then
    if new.mission_id is null or not exists (
      select 1 from public.missions m where m.id = new.mission_id
        and m.candidate_id = new.subject_id) then
      raise exception 'incident_mission_mismatch';
    end if;
    -- Journée confirmée (code ou support) : le travail a eu lieu, pas de faute.
    if exists (select 1 from public.mission_days d
               where d.mission_id = new.mission_id
                 and d.completion_source in ('code', 'support')) then
      raise exception 'incident_conflicts_with_completion';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_reputation_incidents() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Diagnostic de reprise (lecture seule)
-- ════════════════════════════════════════════════════════════════════
do $$
declare
  v_code integer;
  v_legacy integer;
begin
  select count(*) filter (where completion_source = 'code'),
         count(*) filter (where completion_source = 'legacy')
  into v_code, v_legacy
  from public.mission_days;
  raise notice 'lot 15: % journée(s) confirmée(s) par code ; % journée(s) réalisée(s) sans code consommé (legacy, non comptées, comme avant)',
    v_code, v_legacy;
end $$;
