-- Lot 14 — incidents de mission par journée (retard, absence, code non remis).
-- Non déployée.
--
-- Tables : mission_incidents, mission_incident_statements,
--   mission_incident_evidence (nouvelles, aucune lecture ni écriture en
--   session) ; storage.buckets (incident-evidence, privé, sans politique :
--   clé service seulement).
-- Fonctions : report_mission_incident, add_mission_incident_statement,
--   mission_incidents_for_party, record_incident_evidence (clé service),
--   admin_mission_incidents, admin_mission_incident,
--   admin_incident_evidence_path, admin_decide_mission_incident,
--   mission_incident_parties, mission_incident_close_on_confirmation,
--   protect_mission_incident_writes, rt_on_mission_incidents (+ triggers).
--
-- Ce lot ENREGISTRE des faits et leur traitement, rien d'autre :
--   * le fait déclaré (signalement d'une partie, sur une journée précise) ;
--   * la version de chaque partie (déclarations successives, append-only) ;
--   * la décision motivée du support (admin_ops ou admin_founder) :
--     « établi » ou « non établi ».
-- Aucune conséquence n'est appliquée : ni sanction (reputation_incidents
-- n'est jamais écrite), ni annulation, remplacement, remboursement,
-- indemnité ou paiement ; la journée, les autres journées, la mission, le
-- contrat et la réputation (règle du lot 12) sont inchangés. Une décision
-- d'absence n'est jamais une preuve de remboursement. Ces conséquences
-- sont à arbitrer (PLAN_ACTION.md, lot « Engagements et annulations »).
--
-- Règles en base :
--   * Partie déduite de la session ; candidat : retard, absence (prévenir),
--     code non remis ; entreprise : retard, absence du candidat.
--   * Une journée confirmée par code ne peut pas être déclarée absente, ni
--     faire l'objet d'un « code non remis » ; un retard reste signalable
--     (travail effectué après un retard). La règle porte sur la JOURNÉE
--     visée : un code accepté un autre jour n'empêche rien.
--   * Entreprise et « code non remis » : seulement à partir du début prévu
--     de la journée ; le candidat peut prévenir d'un retard ou d'une absence
--     à l'avance.
--   * Course avec la confirmation par code : verrous mission puis journée,
--     dans l'ordre de submit_completion_code ; la journée relue après
--     verrou fait foi. Une absence ou un « code non remis » encore ouverts
--     sont clos (« journée confirmée ») si le code est accepté ensuite.
--   * Double envoi : un signalement par (journée, nature, partie) ; un
--     nouvel envoi renvoie le même signalement sans écriture. Une même
--     déclaration envoyée deux fois n'est enregistrée qu'une fois.
--   * Pièces : téléversées par la route (clé service) dans un bucket privé,
--     enregistrées par record_incident_evidence ; lisibles par le support
--     habilité seulement (URL signée de 60 s). L'autre partie ne voit que
--     leur nombre.
--   * Litige « code non remis » : instruit (versions, pièces, décision
--     motivée) ; la décision ne confirme jamais la journée à la place de
--     l'entreprise (pouvoir non introduit, décision produit à prendre).
--
-- Retour arrière (pile non déployée) :
--   drop trigger trg_mission_incident_close_on_confirmation on public.mission_days ;
--   drop table public.mission_incident_evidence, public.mission_incident_statements,
--     public.mission_incidents ; drop des fonctions listées ;
--   delete from storage.buckets where id = 'incident-evidence' (vide).

-- ════════════════════════════════════════════════════════════════════
-- 1. Tables
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.mission_incidents (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  mission_day_id uuid not null references public.mission_days(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  company_id uuid not null references public.company_profiles(id) on delete cascade,
  kind text not null check (kind in ('late', 'absence', 'code_not_received')),
  reported_by_party text not null check (reported_by_party in ('candidate', 'company')),
  reported_by uuid references public.users(id) on delete set null,
  late_minutes integer check (late_minutes is null or late_minutes between 1 and 720),
  status text not null default 'open'
    check (status in ('open', 'answered', 'decided', 'closed')),
  closed_reason text check (closed_reason is null or closed_reason = 'day_confirmed'),
  closed_at timestamptz,
  outcome text check (outcome is null or outcome in ('established', 'not_established')),
  decision_note text,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mission_incidents_kind_party_chk check (
    kind <> 'code_not_received' or reported_by_party = 'candidate'),
  constraint mission_incidents_late_minutes_chk check (
    late_minutes is null or kind = 'late'),
  constraint mission_incidents_decision_chk check (
    (status = 'decided') = (outcome is not null)
    and (outcome is null) = (decided_at is null)
    and (outcome is null) = (decision_note is null)),
  constraint mission_incidents_closed_chk check (
    (status = 'closed') = (closed_reason is not null))
);

-- Double envoi : le même signalement.
create unique index if not exists mission_incidents_day_kind_party_key
  on public.mission_incidents (mission_day_id, kind, reported_by_party);
create index if not exists idx_mission_incidents_mission on public.mission_incidents (mission_id);
create index if not exists idx_mission_incidents_status on public.mission_incidents (status, created_at);

comment on table public.mission_incidents is
  'Lot 14 : fait déclaré par une partie sur une journée de mission (retard, absence, code non remis), puis décision motivée du support. Aucune conséquence appliquée (sanction, annulation, paiement) : voir la migration 20261117120000.';

create table if not exists public.mission_incident_statements (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  author_id uuid references public.users(id) on delete set null,
  body text not null check (length(btrim(body)) between 10 and 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_mission_incident_statements_incident
  on public.mission_incident_statements (incident_id, created_at);

create table if not exists public.mission_incident_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  uploaded_by uuid references public.users(id) on delete set null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);
create index if not exists idx_mission_incident_evidence_incident
  on public.mission_incident_evidence (incident_id);

alter table public.mission_incidents enable row level security;
alter table public.mission_incident_statements enable row level security;
alter table public.mission_incident_evidence enable row level security;
revoke all on table public.mission_incidents from public, anon, authenticated;
revoke all on table public.mission_incident_statements from public, anon, authenticated;
revoke all on table public.mission_incident_evidence from public, anon, authenticated;
grant select, insert, update, delete on table public.mission_incidents to service_role;
grant select, insert, update, delete on table public.mission_incident_statements to service_role;
grant select, insert, update, delete on table public.mission_incident_evidence to service_role;

-- Pièces : bucket privé, aucune politique (aucun accès en session).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-evidence', 'incident-evidence', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 2. Protections d'écriture (tous rôles)
-- ════════════════════════════════════════════════════════════════════
-- Faits immuables ; une décision est définitive ; une déclaration ou une
-- pièce ne se modifie pas.
create or replace function public.protect_mission_incident_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'mission_incidents: use the incident RPCs' using errcode = '42501';
  end if;
  if tg_table_name = 'mission_incidents' and tg_op = 'UPDATE' then
    if (new.mission_id, new.mission_day_id, new.job_id, new.candidate_id, new.company_id,
        new.kind, new.reported_by_party, new.late_minutes, new.created_at)
       is distinct from
       (old.mission_id, old.mission_day_id, old.job_id, old.candidate_id, old.company_id,
        old.kind, old.reported_by_party, old.late_minutes, old.created_at)
       or (new.reported_by is distinct from old.reported_by and new.reported_by is not null) then
      raise exception 'mission_incidents: reported facts are immutable' using errcode = '42501';
    end if;
    if old.status in ('decided', 'closed') and (
         new.status, new.outcome, new.decision_note, new.decided_at, new.closed_reason, new.closed_at)
         is distinct from
         (old.status, old.outcome, old.decision_note, old.decided_at, old.closed_reason, old.closed_at)
    then
      raise exception 'mission_incidents: incident is final' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  if tg_table_name <> 'mission_incidents' and tg_op = 'UPDATE' then
    raise exception '%: rows are append-only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_mission_incident_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_incidents on public.mission_incidents;
create trigger trg_protect_mission_incidents
  before insert or update or delete on public.mission_incidents
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_statements on public.mission_incident_statements;
create trigger trg_protect_mission_incident_statements
  before insert or update or delete on public.mission_incident_statements
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_evidence on public.mission_incident_evidence;
create trigger trg_protect_mission_incident_evidence
  before insert or update or delete on public.mission_incident_evidence
  for each row execute function public.protect_mission_incident_writes();

-- ════════════════════════════════════════════════════════════════════
-- 3. Partie de l'utilisateur sur une mission
-- ════════════════════════════════════════════════════════════════════
-- Compte actif obligatoire (même règle que les autres actions de mission).
create or replace function public.mission_incident_party(p_uid uuid, p_mission_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_active boolean;
begin
  if p_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.is_active into v_active from public.users u where u.id = p_uid;
  if v_active is false then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  if exists (select 1 from public.missions m
             join public.candidate_profiles cp on cp.id = m.candidate_id
             where m.id = p_mission_id and cp.user_id = p_uid) then
    return 'candidate';
  end if;
  if exists (select 1 from public.missions m
             join public.jobs j on j.id = m.job_id
             join public.company_profiles cp on cp.id = j.company_id
             where m.id = p_mission_id and cp.user_id = p_uid) then
    if exists (select 1 from public.missions m
               join public.jobs j on j.id = m.job_id
               join public.company_profiles cp on cp.id = j.company_id
               where m.id = p_mission_id and cp.is_active is false) then
      raise exception 'account_suspended' using errcode = '42501';
    end if;
    return 'company';
  end if;
  -- Tiers : même réponse qu'une mission inexistante.
  raise exception 'mission_not_found';
end;
$$;
revoke all on function public.mission_incident_party(uuid, uuid) from public, anon, authenticated;

-- Utilisateurs des deux parties d'un signalement : [candidat, entreprise].
create or replace function public.mission_incident_parties(p_incident_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array[cand.user_id, comp.user_id]
  from public.mission_incidents i
  join public.candidate_profiles cand on cand.id = i.candidate_id
  join public.company_profiles comp on comp.id = i.company_id
  where i.id = p_incident_id;
$$;
revoke all on function public.mission_incident_parties(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 4. Signaler
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

  -- Double envoi : le signalement existant, sans écriture.
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
  -- Journée confirmée par code : le travail a eu lieu ce jour-là.
  if p_kind in ('absence', 'code_not_received') and v_day.actual_end_time is not null then
    raise exception 'day_already_confirmed';
  end if;
  -- Constat après le début prévu : entreprise, et code non remis.
  if (v_party = 'company' or p_kind = 'code_not_received') and now() < v_day.starts_at then
    raise exception 'day_not_started';
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

  -- L'autre partie est informée (date et mission), sans pièce.
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
-- 5. Donner sa version
-- ════════════════════════════════════════════════════════════════════
create or replace function public.add_mission_incident_statement(
  p_incident_id uuid,
  p_statement text
)
returns table (statement_id uuid, status text, already_recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_incident public.mission_incidents;
  v_party text;
  v_body text := btrim(coalesce(p_statement, ''));
  v_id uuid;
  v_count integer;
  v_other uuid;
  v_locale text;
  v_title text;
  v_date date;
begin
  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(v_uid, v_incident.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;

  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id for update;

  -- Double envoi : même déclaration de la même partie, déjà enregistrée.
  select s.id into v_id from public.mission_incident_statements s
  where s.incident_id = v_incident.id and s.party = v_party and btrim(s.body) = v_body
  order by s.created_at desc limit 1;
  if v_id is not null then
    return query select v_id, v_incident.status, true;
    return;
  end if;

  if v_incident.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;
  if length(v_body) < 10 or length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  select count(*) into v_count from public.mission_incident_statements s
  where s.incident_id = v_incident.id and s.party = v_party;
  if v_count >= 5 then
    raise exception 'statement_limit';
  end if;

  insert into public.mission_incident_statements (incident_id, party, author_id, body)
  values (v_incident.id, v_party, v_uid, v_body)
  returning id into v_id;

  if v_party <> v_incident.reported_by_party and v_incident.status = 'open' then
    update public.mission_incidents i set status = 'answered' where i.id = v_incident.id
    returning i.* into v_incident;
  end if;

  v_other := (public.mission_incident_parties(v_incident.id))[case when v_party = 'candidate' then 2 else 1 end];
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = v_other;
  select j.title into v_title from public.jobs j where j.id = v_incident.job_id;
  select d.scheduled_date into v_date from public.mission_days d where d.id = v_incident.mission_day_id;
  if v_other is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      v_other, 'mission_update',
      case when v_locale = 'en' then 'New statement on an incident' else 'Nouvelle déclaration sur un signalement' end,
      case when v_locale = 'en'
        then 'The other party gave its version for "' || v_title || '" on ' || to_char(v_date, 'YYYY-MM-DD') || '.'
        else 'L''autre partie a donné sa version pour « ' || v_title || ' » le ' || to_char(v_date, 'DD/MM/YYYY') || '.' end,
      jsonb_build_object('kind', 'mission_incident', 'incident_id', v_incident.id,
        'mission_id', v_incident.mission_id, 'mission_day_id', v_incident.mission_day_id,
        'href', case when v_party = 'candidate' then '/company/jobs/' || v_incident.job_id
                     else '/missions/' || v_incident.mission_id end));
  end if;

  return query select v_id, v_incident.status, false;
end;
$$;
revoke all on function public.add_mission_incident_statement(uuid, text) from public, anon;
grant execute on function public.add_mission_incident_statement(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Lecture par une partie (sans pièce, sans auteur nominatif)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.mission_incidents_for_party(p_mission_id uuid)
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
         i.outcome, i.decision_note, i.decided_at, i.closed_reason,
         i.status in ('open', 'answered')
           and (select count(*) from public.mission_incident_statements s
                where s.incident_id = i.id and s.party = v_party) < 5
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  where i.mission_id = p_mission_id
  order by d.starts_at, i.created_at;
end;
$$;
revoke all on function public.mission_incidents_for_party(uuid) from public, anon;
grant execute on function public.mission_incidents_for_party(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Pièces (route de l'application, clé service)
-- ════════════════════════════════════════════════════════════════════
-- L'utilisateur vient de la session vérifiée par la route ; le chemin est
-- produit par la route sous <incident>/ ; 5 pièces par partie au plus.
create or replace function public.record_incident_evidence(
  p_user_id uuid,
  p_incident_id uuid,
  p_path text,
  p_mime text,
  p_size integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_incident public.mission_incidents;
  v_party text;
  v_id uuid;
begin
  select i.* into v_incident from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(p_user_id, v_incident.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;
  if v_incident.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;
  if p_path is null or p_path not like p_incident_id::text || '/%' then
    raise exception 'evidence_invalid';
  end if;
  if (select count(*) from public.mission_incident_evidence e
      where e.incident_id = p_incident_id and e.party = v_party) >= 5 then
    raise exception 'evidence_limit';
  end if;
  insert into public.mission_incident_evidence (incident_id, party, uploaded_by, storage_path, mime_type, size_bytes)
  values (p_incident_id, v_party, p_user_id, p_path, p_mime, p_size)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_incident_evidence(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_incident_evidence(uuid, uuid, text, text, integer) to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 8. Support
-- ════════════════════════════════════════════════════════════════════
-- Lecture : tout admin actif (is_admin_user). Décision : admin_ops ou
-- admin_founder actif (is_ops_admin_user), comme les contestations d'avis.
create or replace function public.admin_mission_incidents(p_status text default null)
returns table (
  incident_id uuid,
  kind text,
  status text,
  reported_by_party text,
  day_date date,
  job_title text,
  company_name text,
  candidate_name text,
  statement_count integer,
  evidence_count integer,
  outcome text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select i.id, i.kind, i.status, i.reported_by_party, d.scheduled_date, j.title,
         cmp.company_name,
         nullif(btrim(concat_ws(' ', cand.first_name, cand.last_name)), ''),
         (select count(*)::integer from public.mission_incident_statements s where s.incident_id = i.id),
         (select count(*)::integer from public.mission_incident_evidence e where e.incident_id = i.id),
         i.outcome, i.created_at
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  join public.jobs j on j.id = i.job_id
  join public.company_profiles cmp on cmp.id = i.company_id
  join public.candidate_profiles cand on cand.id = i.candidate_id
  where p_status is null or i.status = p_status
  order by (i.status in ('open', 'answered')) desc, i.created_at desc
  limit 200;
end;
$$;
revoke all on function public.admin_mission_incidents(text) from public, anon;
grant execute on function public.admin_mission_incidents(text) to authenticated;

create or replace function public.admin_mission_incident(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'incident_id', i.id, 'kind', i.kind, 'status', i.status,
    'reported_by_party', i.reported_by_party, 'late_minutes', i.late_minutes,
    'created_at', i.created_at, 'outcome', i.outcome, 'decision_note', i.decision_note,
    'decided_at', i.decided_at, 'closed_reason', i.closed_reason, 'closed_at', i.closed_at,
    'mission_id', i.mission_id, 'job_title', j.title, 'company_name', cmp.company_name,
    'candidate_name', nullif(btrim(concat_ws(' ', cand.first_name, cand.last_name)), ''),
    'can_decide', public.is_ops_admin_user(auth.uid()) and i.status in ('open', 'answered'),
    'day', jsonb_build_object(
      'id', d.id, 'date', d.scheduled_date, 'starts_at', d.starts_at, 'ends_at', d.ends_at,
      'started_at', d.actual_start_time, 'confirmed_at', d.actual_end_time,
      'code_consumed_at', (select c.consumed_at from public.mission_completion_codes c
                           where c.mission_day_id = d.id)),
    'other_days', coalesce((select jsonb_agg(jsonb_build_object(
        'date', o.scheduled_date, 'confirmed_at', o.actual_end_time) order by o.starts_at)
      from public.mission_days o where o.mission_id = i.mission_id and o.id <> d.id), '[]'::jsonb),
    'statements', coalesce((select jsonb_agg(jsonb_build_object(
        'party', s.party, 'body', s.body, 'created_at', s.created_at) order by s.created_at)
      from public.mission_incident_statements s where s.incident_id = i.id), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'party', e.party, 'mime_type', e.mime_type, 'size_bytes', e.size_bytes,
        'created_at', e.created_at) order by e.created_at)
      from public.mission_incident_evidence e where e.incident_id = i.id), '[]'::jsonb))
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

-- Chemin d'une pièce pour le support (la route signe l'URL en clé service).
create or replace function public.admin_incident_evidence_path(p_evidence_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not public.is_admin_user(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select e.storage_path into v_path from public.mission_incident_evidence e where e.id = p_evidence_id;
  if v_path is null then
    raise exception 'evidence_not_found';
  end if;
  return v_path;
end;
$$;
revoke all on function public.admin_incident_evidence_path(uuid) from public, anon;
grant execute on function public.admin_incident_evidence_path(uuid) to authenticated;

-- Décision motivée, définitive, tracée ; aucune conséquence appliquée.
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
  -- Même ordre de verrous que la confirmation par code.
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
-- 9. Journée confirmée ensuite : absence et code non remis clos
-- ════════════════════════════════════════════════════════════════════
create or replace function public.mission_incident_close_on_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.actual_end_time is not null and old.actual_end_time is null then
    update public.mission_incidents i
    set status = 'closed', closed_reason = 'day_confirmed', closed_at = now()
    where i.mission_day_id = new.id
      and i.kind in ('absence', 'code_not_received')
      and i.status in ('open', 'answered');
  end if;
  return null;
end;
$$;
revoke all on function public.mission_incident_close_on_confirmation() from public, anon, authenticated;

drop trigger if exists trg_mission_incident_close_on_confirmation on public.mission_days;
create trigger trg_mission_incident_close_on_confirmation
  after update of actual_end_time on public.mission_days
  for each row execute function public.mission_incident_close_on_confirmation();

-- ════════════════════════════════════════════════════════════════════
-- 10. Temps réel : domaine « incidents » (parties et support)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.rt_on_mission_incidents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Trois tables : l'identifiant du signalement est `id` ou `incident_id`.
  v_row jsonb := to_jsonb(new);
  v_incident uuid := coalesce(v_row ->> 'incident_id', v_row ->> 'id')::uuid;
begin
  if tg_table_name = 'mission_incidents' then
    v_incident := (v_row ->> 'id')::uuid;
  end if;
  perform public.rt_signal_users(public.mission_incident_parties(v_incident), 'incidents', v_incident);
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_mission_incidents() from public, anon, authenticated;

drop trigger if exists trg_rt_mission_incidents on public.mission_incidents;
create trigger trg_rt_mission_incidents
  after insert or update on public.mission_incidents
  for each row execute function public.rt_on_mission_incidents();
drop trigger if exists trg_rt_mission_incident_statements on public.mission_incident_statements;
create trigger trg_rt_mission_incident_statements
  after insert on public.mission_incident_statements
  for each row execute function public.rt_on_mission_incidents();
drop trigger if exists trg_rt_mission_incident_evidence on public.mission_incident_evidence;
create trigger trg_rt_mission_incident_evidence
  after insert on public.mission_incident_evidence
  for each row execute function public.rt_on_mission_incidents();
