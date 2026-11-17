-- Lot 16 — instruction des journées contestées : délais, double validation
-- exceptionnelle et révision interne. Non déployée.
--
-- Réutilise les dossiers du lot 14 (mission_incidents, déclarations,
-- justificatifs), les contacts et la confirmation de journée du lot 15
-- (verrous mission puis journée, réalisation unique), les notifications
-- durables (public.notifications), les signaux privés et la tâche
-- planifiée existante (pg_cron « reputation-expiry-sweep »).
--
-- Tables : mission_incidents (situation, revision, deadline_extension_hours,
--   résultats partial / disagreement), mission_incident_statements
--   (info_request_id), mission_incident_contacts (channel_verified),
--   mission_days.completion_source (« exceptional ») ; nouvelles :
--   mission_incident_events, mission_incident_info_requests,
--   mission_incident_notes, mission_incident_conflicts,
--   mission_incident_proposals, mission_incident_decisions,
--   mission_incident_appeals, mission_incident_appeal_requests (aucun accès
--   de session).
--
-- Règles :
--   * Délais : origine = ouverture du dossier (created_at), décalée des
--     prolongations motivées (deadline_extension_hours, historisées). Pour
--     un dossier ouvert par le candidat (l'entreprise doit répondre) :
--     notification initiale à l'ouverture ; à 24 h sans réponse, relance
--     (notification dans l'application) ; à 48 h sans réponse, examen
--     renforcé, avec une tentative sur un second canal vérifié à consigner.
--     Réponse de l'entreprise = sa déclaration dans l'application, ou une
--     réponse obtenue consignée par le support. Le silence ne confirme
--     jamais rien. Balayage idempotent (un événement par étape, index
--     unique), appelé par la tâche planifiée existante.
--   * Aucune notification externe n'est envoyée : « notification créée »
--     (in-app), « tentative enregistrée » (contact du support, demande) et
--     « réponse reçue » restent distincts.
--   * Décision d'un dossier contesté : proposition d'un admin_ops ou
--     admin_founder actif, sur une version précise du dossier (revision),
--     puis examen et décision par un AUTRE admin_ops ou admin_founder actif.
--     Déclaration de conflit d'intérêts à chaque étape ; un agent déclaré
--     concerné est bloqué sur ce dossier. Nouvelle déclaration, pièce,
--     réponse ou requalification après la proposition : relecture exigée
--     (proposal_stale). admin_support instruit (situation, compléments,
--     contacts, notes, prolongation) sans proposer ni décider.
--   * Résultats : établi (journée confirmée, provenance « exceptional »),
--     non établi (aucune absence fautive, aucune sanction), partiel (dossier
--     identifié, journée non terminée, forfait non divisé), désaccord
--     persistant (tentative amiable et orientation consignées).
--   * Réalisation unique : mêmes verrous que submit_completion_code et
--     admin_confirm_mission_day ; une journée déjà confirmée ou un dossier
--     tranché par une autre voie : état relu, aucun effet.
--   * Révision interne : sept jours après l'enregistrement de la décision
--     notifiée (heure de la base), par chaque partie ; examinée par un agent
--     habilité distinct de celui qui a proposé et de celui qui a validé ;
--     sans agent distinct, en attente d'affectation. Décisions successives
--     conservées. Une décision « établie » (journée confirmée) n'est pas
--     annulée par la révision : la confirmer ou demander un arbitrage
--     (annulation d'une réalisation : décision produit ouverte).
--
-- Retour arrière (pile non déployée) : réappliquer les fonctions des
--   migrations 20261119120000, 20261117120000, 20261113120000 et
--   20261109120000 ; drop des tables nouvelles et des colonnes ajoutées ;
--   replanifier « reputation-expiry-sweep » sans le balayage des dossiers.

-- ════════════════════════════════════════════════════════════════════
-- 1. Schéma
-- ════════════════════════════════════════════════════════════════════
-- Provenance distincte d'une confirmation exceptionnelle (double validation).
alter table public.mission_days drop constraint if exists mission_days_completion_source_check;
alter table public.mission_days add constraint mission_days_completion_source_check
  check (completion_source is null
         or completion_source in ('code', 'support', 'exceptional', 'legacy'));

alter table public.mission_incidents
  add column if not exists situation text
    check (situation is null or situation in ('company_unreachable', 'presence_disputed',
           'partial_work', 'quality_disputed', 'late_or_conduct')),
  add column if not exists revision integer not null default 1,
  add column if not exists deadline_extension_hours integer not null default 0
    check (deadline_extension_hours between 0 and 720);
alter table public.mission_incidents drop constraint if exists mission_incidents_outcome_check;
alter table public.mission_incidents add constraint mission_incidents_outcome_check
  check (outcome is null
         or outcome in ('established', 'not_established', 'partial', 'disagreement'));

alter table public.mission_incident_contacts
  add column if not exists channel_verified boolean not null default false;

-- Événements datés du dossier (chronologie) ; visibility « party » : lus
-- par les parties (sans donnée interne), « admin » : support seulement.
create table if not exists public.mission_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  event_type text not null check (event_type in (
    'opened', 'party_notified', 'reminder_24h', 'escalation_48h', 'deadline_extended',
    'situation_set', 'info_requested', 'info_answered', 'proposal_created',
    'proposal_rejected', 'decision_recorded', 'appeal_requested', 'appeal_assigned',
    'appeal_decided')),
  visibility text not null check (visibility in ('party', 'admin')),
  actor_id uuid references public.users(id) on delete set null,
  actor_role text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_mission_incident_events_incident
  on public.mission_incident_events (incident_id, created_at);
-- Étapes uniques : jamais de relance ni d'examen renforcé en double.
create unique index if not exists mission_incident_events_once_key
  on public.mission_incident_events (incident_id, event_type)
  where event_type in ('opened', 'reminder_24h', 'escalation_48h');

create table if not exists public.mission_incident_info_requests (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  question text not null check (length(question) between 10 and 1000),
  requested_by uuid references public.users(id) on delete set null,
  requested_by_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  answer_statement_id uuid,
  answered_at timestamptz,
  constraint mission_incident_info_requests_answer_chk check (
    (answered_at is null) = (answer_statement_id is null))
);
create index if not exists idx_mission_incident_info_requests_incident
  on public.mission_incident_info_requests (incident_id, created_at);

alter table public.mission_incident_statements
  add column if not exists info_request_id uuid
    references public.mission_incident_info_requests(id) on delete set null;

create table if not exists public.mission_incident_notes (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  body text not null check (length(body) between 3 and 2000),
  author_id uuid references public.users(id) on delete set null,
  author_role text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_mission_incident_notes_incident
  on public.mission_incident_notes (incident_id, created_at);

-- Déclarations de conflit d'intérêts (append-only ; « concerné » définitif).
create table if not exists public.mission_incident_conflicts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  admin_id uuid not null references public.users(id) on delete cascade,
  concerned boolean not null,
  context text not null check (context in ('proposal', 'review', 'appeal')),
  declared_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_mission_incident_conflicts_admin
  on public.mission_incident_conflicts (incident_id, admin_id);

create table if not exists public.mission_incident_proposals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  outcome text not null check (outcome in ('established', 'not_established', 'partial', 'disagreement')),
  facts_retained text not null check (length(facts_retained) between 10 and 4000),
  elements_verified text not null check (length(elements_verified) between 10 and 4000),
  contradictions text not null check (length(contradictions) between 10 and 4000),
  justification text not null check (length(justification) between 10 and 4000),
  amicable_attempt text check (amicable_attempt is null or length(amicable_attempt) between 10 and 2000),
  orientation text check (orientation is null or length(orientation) between 10 and 2000),
  dossier_revision integer not null,
  proposed_by uuid references public.users(id) on delete set null,
  proposed_by_role text not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  reviewed_by uuid references public.users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  constraint mission_incident_proposals_followup_chk check (
    (outcome = 'disagreement') = (amicable_attempt is not null and orientation is not null))
);
create unique index if not exists mission_incident_proposals_pending_key
  on public.mission_incident_proposals (incident_id) where status = 'pending';

create table if not exists public.mission_incident_decisions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  kind text not null check (kind in ('initial', 'appeal')),
  proposal_id uuid unique references public.mission_incident_proposals(id) on delete set null,
  appeal_id uuid unique,
  supersedes_id uuid references public.mission_incident_decisions(id) on delete set null,
  outcome text not null check (outcome in ('established', 'not_established', 'partial', 'disagreement')),
  appeal_result text check (appeal_result is null
    or appeal_result in ('upheld', 'revised', 'arbitration_required')),
  facts_retained text not null,
  elements_verified text not null,
  contradictions text not null,
  justification text not null,
  amicable_attempt text,
  orientation text,
  proposed_by uuid references public.users(id) on delete set null,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_role text not null,
  decided_at timestamptz not null default now(),
  -- Révision interne : 7 jours après l'enregistrement de la décision
  -- notifiée (même transaction) ; aucune pour une décision de révision.
  review_deadline timestamptz,
  constraint mission_incident_decisions_kind_chk check (
    (kind = 'initial') = (review_deadline is not null)
    and (kind = 'appeal') = (appeal_result is not null))
);
create index if not exists idx_mission_incident_decisions_incident
  on public.mission_incident_decisions (incident_id, decided_at);

create table if not exists public.mission_incident_appeals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  decision_id uuid not null unique references public.mission_incident_decisions(id) on delete cascade,
  status text not null default 'pending_assignment'
    check (status in ('pending_assignment', 'assigned', 'decided')),
  assigned_to uuid references public.users(id) on delete set null,
  assigned_at timestamptz,
  result_decision_id uuid references public.mission_incident_decisions(id) on delete set null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.mission_incident_decisions drop constraint if exists mission_incident_decisions_appeal_fkey;
alter table public.mission_incident_decisions add constraint mission_incident_decisions_appeal_fkey
  foreign key (appeal_id) references public.mission_incident_appeals(id) on delete set null;

create table if not exists public.mission_incident_appeal_requests (
  id uuid primary key default gen_random_uuid(),
  appeal_id uuid not null references public.mission_incident_appeals(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  requested_by uuid references public.users(id) on delete set null,
  body text not null check (length(body) between 10 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  constraint mission_incident_appeal_requests_party_key unique (appeal_id, party)
);

do $$
declare
  t text;
begin
  foreach t in array array['mission_incident_events', 'mission_incident_info_requests',
    'mission_incident_notes', 'mission_incident_conflicts', 'mission_incident_proposals',
    'mission_incident_decisions', 'mission_incident_appeals', 'mission_incident_appeal_requests']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

comment on table public.mission_incident_events is
  'Lot 16 : chronologie d''un dossier (ouverture, notifications créées dans l''application, relance 24 h, examen renforcé 48 h, prolongations, compléments, décisions, révisions). Aucune notification externe n''y est annoncée.';
comment on table public.mission_incident_proposals is
  'Lot 16 : proposition de décision d''un admin_ops ou admin_founder sur une version du dossier (dossier_revision), examinée par un autre agent habilité.';
comment on table public.mission_incident_decisions is
  'Lot 16 : décisions successives (initiale, révision) avec faits retenus, éléments vérifiés, contradictions et justification ; append-only.';

-- ════════════════════════════════════════════════════════════════════
-- 2. Protections d'écriture
-- ════════════════════════════════════════════════════════════════════
-- Append-only (aucune session) : événements, notes, conflits, décisions,
-- demandes de révision.
drop trigger if exists trg_protect_mission_incident_events on public.mission_incident_events;
create trigger trg_protect_mission_incident_events
  before insert or update or delete on public.mission_incident_events
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_notes on public.mission_incident_notes;
create trigger trg_protect_mission_incident_notes
  before insert or update or delete on public.mission_incident_notes
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_conflicts on public.mission_incident_conflicts;
create trigger trg_protect_mission_incident_conflicts
  before insert or update or delete on public.mission_incident_conflicts
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_decisions on public.mission_incident_decisions;
create trigger trg_protect_mission_incident_decisions
  before insert or update or delete on public.mission_incident_decisions
  for each row execute function public.protect_mission_incident_writes();
drop trigger if exists trg_protect_mission_incident_appeal_requests on public.mission_incident_appeal_requests;
create trigger trg_protect_mission_incident_appeal_requests
  before insert or update or delete on public.mission_incident_appeal_requests
  for each row execute function public.protect_mission_incident_writes();

-- États modifiables sous contrôle : demandes de complément (réponse une
-- fois), propositions (statut depuis « pending » seulement, contenu figé),
-- révisions (affectation puis décision).
create or replace function public.protect_mission_incident_flow_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception '%: use the incident RPCs', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'mission_incident_info_requests' then
      if (new.incident_id, new.party, new.question, new.requested_by, new.created_at)
         is distinct from (old.incident_id, old.party, old.question, old.requested_by, old.created_at)
         or old.answered_at is not null then
        raise exception 'info request is immutable once answered' using errcode = '42501';
      end if;
    elsif tg_table_name = 'mission_incident_proposals' then
      if (new.incident_id, new.outcome, new.facts_retained, new.elements_verified,
          new.contradictions, new.justification, new.amicable_attempt, new.orientation,
          new.dossier_revision, new.proposed_by, new.created_at)
         is distinct from
         (old.incident_id, old.outcome, old.facts_retained, old.elements_verified,
          old.contradictions, old.justification, old.amicable_attempt, old.orientation,
          old.dossier_revision, old.proposed_by, old.created_at)
         or old.status <> 'pending' then
        raise exception 'proposal is immutable once reviewed' using errcode = '42501';
      end if;
    elsif tg_table_name = 'mission_incident_appeals' then
      if (new.incident_id, new.decision_id, new.created_at)
         is distinct from (old.incident_id, old.decision_id, old.created_at)
         or old.status = 'decided'
         or (old.assigned_to is not null and new.assigned_to is distinct from old.assigned_to) then
        raise exception 'appeal is immutable once decided or assigned' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_mission_incident_flow_writes() from public, anon, authenticated;

drop trigger if exists trg_protect_mission_incident_info_requests on public.mission_incident_info_requests;
create trigger trg_protect_mission_incident_info_requests
  before insert or update or delete on public.mission_incident_info_requests
  for each row execute function public.protect_mission_incident_flow_writes();
drop trigger if exists trg_protect_mission_incident_proposals on public.mission_incident_proposals;
create trigger trg_protect_mission_incident_proposals
  before insert or update or delete on public.mission_incident_proposals
  for each row execute function public.protect_mission_incident_flow_writes();
drop trigger if exists trg_protect_mission_incident_appeals on public.mission_incident_appeals;
create trigger trg_protect_mission_incident_appeals
  before insert or update or delete on public.mission_incident_appeals
  for each row execute function public.protect_mission_incident_flow_writes();

-- ════════════════════════════════════════════════════════════════════
-- 3. Version du dossier : toute nouvelle réponse, pièce ou réponse obtenue
-- ════════════════════════════════════════════════════════════════════
create or replace function public.bump_incident_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.mission_incidents i set revision = i.revision + 1
  where i.id = new.incident_id;
  return null;
end;
$$;
revoke all on function public.bump_incident_revision() from public, anon, authenticated;

drop trigger if exists trg_bump_revision_statements on public.mission_incident_statements;
create trigger trg_bump_revision_statements
  after insert on public.mission_incident_statements
  for each row execute function public.bump_incident_revision();
drop trigger if exists trg_bump_revision_evidence on public.mission_incident_evidence;
create trigger trg_bump_revision_evidence
  after insert on public.mission_incident_evidence
  for each row execute function public.bump_incident_revision();
drop trigger if exists trg_bump_revision_contacts on public.mission_incident_contacts;
create trigger trg_bump_revision_contacts
  after insert on public.mission_incident_contacts
  for each row when (new.entry_type = 'response')
  execute function public.bump_incident_revision();

-- ════════════════════════════════════════════════════════════════════
-- 4. Règles partagées
-- ════════════════════════════════════════════════════════════════════
-- Provenances qui valent travail effectué.
create or replace function public.completion_counts(p_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_source in ('code', 'support', 'exceptional'), false);
$$;

-- Réponse de l'entreprise à un instant : déclaration dans l'application ou
-- réponse obtenue consignée par le support.
create or replace function public.incident_company_responded(
  p_incident_id uuid, p_at timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.mission_incident_statements s
                 where s.incident_id = p_incident_id and s.party = 'company'
                   and s.created_at <= p_at)
      or exists (select 1 from public.mission_incident_contacts c
                 where c.incident_id = p_incident_id and c.entry_type = 'response'
                   and c.created_at <= p_at);
$$;
revoke all on function public.incident_company_responded(uuid, timestamptz) from public, anon, authenticated;

-- Origine des délais (ouverture + prolongations).
create or replace function public.incident_deadline_base(p_incident_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select i.created_at + make_interval(hours => i.deadline_extension_hours)
  from public.mission_incidents i where i.id = p_incident_id;
$$;
revoke all on function public.incident_deadline_base(uuid) from public, anon, authenticated;

-- Second canal vérifié tenté après l'examen renforcé : une demande sur un
-- canal vérifié, postérieure à l'examen renforcé, et une autre demande sur
-- un canal différent.
create or replace function public.incident_second_channel_done(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mission_incident_events e
    join public.mission_incident_contacts c2
      on c2.incident_id = e.incident_id and c2.entry_type = 'request'
     and c2.channel_verified and c2.created_at >= e.created_at
    where e.incident_id = p_incident_id and e.event_type = 'escalation_48h'
      and exists (select 1 from public.mission_incident_contacts c1
                  where c1.incident_id = p_incident_id and c1.entry_type = 'request'
                    and c1.id <> c2.id and c1.channel <> c2.channel));
$$;
revoke all on function public.incident_second_channel_done(uuid) from public, anon, authenticated;

-- Conflit d'intérêts : déclaration exigée à chaque étape ; « concerned »
-- est enregistré et bloque définitivement l'agent sur ce dossier. Renvoie
-- true si l'agent peut poursuivre.
create or replace function public.incident_conflict_gate(
  p_incident_id uuid, p_uid uuid, p_conflict text, p_context text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_conflict is null or p_conflict not in ('none', 'concerned') then
    raise exception 'conflict_declaration_required';
  end if;
  if exists (select 1 from public.mission_incident_conflicts c
             where c.incident_id = p_incident_id and c.admin_id = p_uid and c.concerned) then
    raise exception 'conflict_of_interest';
  end if;
  insert into public.mission_incident_conflicts (incident_id, admin_id, concerned, context)
  values (p_incident_id, p_uid, p_conflict = 'concerned', p_context);
  return p_conflict = 'none';
end;
$$;
revoke all on function public.incident_conflict_gate(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.incident_agent_concerned(p_incident_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.mission_incident_conflicts c
                 where c.incident_id = p_incident_id and c.admin_id = p_uid and c.concerned);
$$;
revoke all on function public.incident_agent_concerned(uuid, uuid) from public, anon, authenticated;

-- Agents habilités distincts disponibles pour une révision.
create or replace function public.incident_appeal_eligible_count(p_appeal_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.users u
  join public.mission_incident_appeals a on a.id = p_appeal_id
  join public.mission_incident_decisions d on d.id = a.decision_id
  where u.is_active is not false
    and u.role::text in ('admin_ops', 'admin_founder')
    and u.id is distinct from d.proposed_by
    and u.id is distinct from d.decided_by
    and not public.incident_agent_concerned(a.incident_id, u.id);
$$;
revoke all on function public.incident_appeal_eligible_count(uuid) from public, anon, authenticated;

-- Événement de chronologie.
create or replace function public.incident_event(
  p_incident_id uuid, p_type text, p_visibility text, p_actor uuid, p_data jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.mission_incident_events (incident_id, event_type, visibility, actor_id, actor_role, data)
  values (p_incident_id, p_type, p_visibility, p_actor,
          (select u.role::text from public.users u where u.id = p_actor), p_data);
$$;
revoke all on function public.incident_event(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

-- Notification durable (dans l'application) d'une partie d'un dossier.
create or replace function public.incident_notify(
  p_user uuid, p_title_fr text, p_title_en text, p_body_fr text, p_body_en text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locale text;
begin
  if p_user is null then
    return;
  end if;
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = p_user;
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (p_user, 'mission_update',
          case when v_locale = 'en' then p_title_en else p_title_fr end,
          case when v_locale = 'en' then p_body_en else p_body_fr end,
          p_data);
end;
$$;
revoke all on function public.incident_notify(uuid, text, text, text, text, jsonb) from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
-- 5-6. Fonctions des lots 9c à 15 reprises (provenance « exceptional »,
--      chronologie, éléments après décision, canal vérifié) — corps
--      d'origine, seules les lignes commentées « Lot 16 » ou les listes de
--      provenances changent.
-- ════════════════════════════════════════════════════════════════════
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
                       and not public.completion_counts(d.completion_source));
$$;
revoke all on function public.mission_work_confirmed(uuid) from public, anon, authenticated;


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
           'completed_via', case when public.completion_counts(d.completion_source)
                                 then d.completion_source end) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;


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
         case when public.completion_counts(d.completion_source) then d.completion_source end,
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
           bool_and(public.completion_counts(d.completion_source)) as all_confirmed,
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
        -- Lots 12, 15 et 16 : une unité par mission réalisée (toutes ses
        -- journées confirmées : code, support ou décision exceptionnelle).
        select max(d.actual_end_time) as at, 1 as delta, m.id as ref
        from public.missions m
        join public.mission_days d on d.mission_id = m.id
        where m.candidate_id = p_subject_id
          and m.actual_end_time is not null
        group by m.id
        having bool_and(public.completion_counts(d.completion_source))
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
                 and public.completion_counts(d.completion_source)) then
      raise exception 'incident_conflicts_with_completion';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.protect_reputation_incidents() from public, anon, authenticated;


create or replace function public.admin_mission_incident_base(p_incident_id uuid)
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
      'completed_via', case when public.completion_counts(d.completion_source)
                            then d.completion_source end,
      'code_consumed_at', (select c.consumed_at from public.mission_completion_codes c
                           where c.mission_day_id = d.id)),
    'other_days', coalesce((select jsonb_agg(jsonb_build_object(
        'date', o.scheduled_date, 'confirmed_at', o.actual_end_time,
        'completed_via', case when public.completion_counts(o.completion_source)
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
        'note', c.note, 'recorded_by_role', c.recorded_by_role, 'created_at', c.created_at,
        'channel_verified', c.channel_verified)
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
revoke all on function public.admin_mission_incident_base(uuid) from public, anon, authenticated;


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

  -- Lot 16 : ouverture et notification créée dans l'application
  -- (origine des délais ; aucune notification externe).
  perform public.incident_event(v_id, 'opened', 'party', v_uid,
    jsonb_build_object('party', v_party));
  if v_other is not null then
    perform public.incident_event(v_id, 'party_notified', 'party', null,
      jsonb_build_object('party', case when v_party = 'candidate' then 'company' else 'candidate' end,
                         'channel', 'in_app'));
  end if;

  return query select v_id, 'open'::text, false;
end;
$$;
revoke all on function public.report_mission_incident(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.report_mission_incident(uuid, uuid, text, text, integer) to authenticated;


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

  -- Lot 16 : de nouveaux éléments restent recevables après une décision.
  if v_incident.status not in ('open', 'answered', 'decided') then
    raise exception 'incident_closed';
  end if;
  if length(v_body) < 10 or length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  select count(*) into v_count from public.mission_incident_statements s
  where s.incident_id = v_incident.id and s.party = v_party and s.info_request_id is null;
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
  if v_incident.status not in ('open', 'answered', 'decided') then
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
  -- Lot 16 : une absence se tranche par la double validation.
  if v_incident.kind = 'absence' then
    raise exception 'use_dispute_decision';
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


drop function if exists public.admin_record_incident_contact(uuid, text, text, timestamptz, text, text, text);
create or replace function public.admin_record_incident_contact(
  p_incident_id uuid,
  p_entry_type text,
  p_channel text,
  p_occurred_at timestamptz,
  p_result text,
  p_reference text default null,
  p_note text default null,
  p_channel_verified boolean default false
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
    and c.reference is not distinct from v_reference and c.note is not distinct from v_note
    and c.channel_verified = coalesce(p_channel_verified, false);
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;

  if v_incident.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;

  insert into public.mission_incident_contacts (
    incident_id, entry_type, channel, occurred_at, result, reference, note,
    recorded_by, recorded_by_role, channel_verified
  ) values (
    v_incident.id, p_entry_type, p_channel, p_occurred_at, p_result, v_reference, v_note,
    v_uid, v_role, coalesce(p_channel_verified, false)
  ) returning id into v_id;

  -- Trace sans la référence ni la note (privées, lues dans le dossier).
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'record_incident_contact', 'mission_incidents', v_incident.id,
          jsonb_build_object('contact_id', v_id, 'entry_type', p_entry_type,
                             'channel', p_channel, 'result', p_result,
                             'occurred_at', p_occurred_at,
                             'channel_verified', coalesce(p_channel_verified, false)));

  return query select v_id, false;
end;
$$;
revoke all on function public.admin_record_incident_contact(uuid, text, text, timestamptz, text, text, text, boolean) from public, anon;
grant execute on function public.admin_record_incident_contact(uuid, text, text, timestamptz, text, text, text, boolean) to authenticated;

-- Reprise : ouverture de chaque dossier existant (origine des délais).
insert into public.mission_incident_events (incident_id, event_type, visibility, data, created_at)
select i.id, 'opened', 'party', jsonb_build_object('party', i.reported_by_party), i.created_at
from public.mission_incidents i
on conflict (incident_id, event_type) where event_type in ('opened', 'reminder_24h', 'escalation_48h')
do nothing;

-- ════════════════════════════════════════════════════════════════════
-- 7. Instruction par le support (tout admin actif)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_set_incident_situation(
  p_incident_id uuid, p_situation text)
returns table (incident_id uuid, situation text, revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inc public.mission_incidents;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_situation is null or p_situation not in ('company_unreachable', 'presence_disputed',
      'partial_work', 'quality_disputed', 'late_or_conduct') then
    raise exception 'situation_invalid';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  if v_inc.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;
  if v_inc.situation is not distinct from p_situation then
    return query select v_inc.id, v_inc.situation, v_inc.revision;
    return;
  end if;
  -- Requalification : modification substantielle (relecture d'une proposition).
  update public.mission_incidents i set situation = p_situation, revision = i.revision + 1
  where i.id = v_inc.id returning i.* into v_inc;
  perform public.incident_event(v_inc.id, 'situation_set', 'admin', v_uid,
    jsonb_build_object('situation', p_situation));
  return query select v_inc.id, v_inc.situation, v_inc.revision;
end;
$$;
revoke all on function public.admin_set_incident_situation(uuid, text) from public, anon;
grant execute on function public.admin_set_incident_situation(uuid, text) to authenticated;

create or replace function public.admin_add_incident_note(p_incident_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_body) < 3 or length(v_body) > 2000 then
    raise exception 'note_invalid';
  end if;
  perform 1 from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  -- Double envoi : la même note du même agent.
  select n.id into v_id from public.mission_incident_notes n
  where n.incident_id = p_incident_id and n.author_id = v_uid and n.body = v_body;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.mission_incident_notes (incident_id, body, author_id, author_role)
  values (p_incident_id, v_body, v_uid,
          (select u.role::text from public.users u where u.id = v_uid))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.admin_add_incident_note(uuid, text) from public, anon;
grant execute on function public.admin_add_incident_note(uuid, text) to authenticated;

-- Prolongation motivée, datée et historisée : décale les échéances non
-- encore atteintes (une relance ou un examen déjà enregistrés restent).
create or replace function public.admin_extend_incident_deadlines(
  p_incident_id uuid, p_hours integer, p_reason text)
returns table (incident_id uuid, extension_hours integer, reminder_at timestamptz, escalation_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_inc public.mission_incidents;
  v_base timestamptz;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'extension_invalid';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 1000 then
    raise exception 'note_invalid';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  if v_inc.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;
  if v_inc.deadline_extension_hours + p_hours > 720 then
    raise exception 'extension_invalid';
  end if;
  update public.mission_incidents i
  set deadline_extension_hours = i.deadline_extension_hours + p_hours
  where i.id = v_inc.id returning i.* into v_inc;
  v_base := v_inc.created_at + make_interval(hours => v_inc.deadline_extension_hours);
  perform public.incident_event(v_inc.id, 'deadline_extended', 'admin', v_uid,
    jsonb_build_object('hours', p_hours, 'reason', v_reason,
      'reminder_at', v_base + interval '24 hours', 'escalation_at', v_base + interval '48 hours'));
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, (select u.role::text from public.users u where u.id = v_uid),
          'extend_incident_deadlines', 'mission_incidents', v_inc.id,
          jsonb_build_object('hours', p_hours, 'total_hours', v_inc.deadline_extension_hours));
  return query select v_inc.id, v_inc.deadline_extension_hours,
    v_base + interval '24 hours', v_base + interval '48 hours';
end;
$$;
revoke all on function public.admin_extend_incident_deadlines(uuid, integer, text) from public, anon;
grant execute on function public.admin_extend_incident_deadlines(uuid, integer, text) to authenticated;

-- Demande de complément adressée à une partie (notification dans
-- l'application).
create or replace function public.admin_request_incident_info(
  p_incident_id uuid, p_party text, p_question text)
returns table (request_id uuid, already_requested boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_question text := btrim(coalesce(p_question, ''));
  v_inc public.mission_incidents;
  v_id uuid;
  v_parties uuid[];
  v_title text;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_party is null or p_party not in ('candidate', 'company') then
    raise exception 'party_invalid';
  end if;
  if length(v_question) < 10 or length(v_question) > 1000 then
    raise exception 'question_invalid';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;
  if not found then
    raise exception 'incident_not_found';
  end if;
  if v_inc.status = 'closed' then
    raise exception 'incident_closed';
  end if;
  select r.id into v_id from public.mission_incident_info_requests r
  where r.incident_id = v_inc.id and r.party = p_party and r.question = v_question
    and r.answered_at is null;
  if v_id is not null then
    return query select v_id, true;
    return;
  end if;
  insert into public.mission_incident_info_requests (incident_id, party, question, requested_by, requested_by_role)
  values (v_inc.id, p_party, v_question, v_uid,
          (select u.role::text from public.users u where u.id = v_uid))
  returning id into v_id;
  perform public.incident_event(v_inc.id, 'info_requested', 'party', v_uid,
    jsonb_build_object('party', p_party, 'request_id', v_id));
  v_parties := public.mission_incident_parties(v_inc.id);
  select j.title into v_title from public.jobs j where j.id = v_inc.job_id;
  perform public.incident_notify(
    v_parties[case when p_party = 'candidate' then 1 else 2 end],
    'Le support demande un complément', 'Support requests more information',
    'Le support vous pose une question sur le signalement de « ' || v_title || ' ».',
    'Support has a question about the report on "' || v_title || '".',
    jsonb_build_object('kind', 'mission_incident_info', 'incident_id', v_inc.id,
      'request_id', v_id, 'mission_id', v_inc.mission_id,
      'href', case when p_party = 'candidate' then '/missions/' || v_inc.mission_id
                   else '/company/jobs/' || v_inc.job_id end));
  return query select v_id, false;
end;
$$;
revoke all on function public.admin_request_incident_info(uuid, text, text) from public, anon;
grant execute on function public.admin_request_incident_info(uuid, text, text) to authenticated;

-- Réponse d'une partie à une demande de complément (déclaration liée, hors
-- limite des 5 déclarations ; nouvelle version du dossier).
create or replace function public.answer_incident_info_request(p_request_id uuid, p_body text)
returns table (request_id uuid, statement_id uuid, already_answered boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_req public.mission_incident_info_requests;
  v_inc public.mission_incidents;
  v_party text;
  v_sid uuid;
begin
  select r.* into v_req from public.mission_incident_info_requests r where r.id = p_request_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = v_req.incident_id;
  begin
    v_party := public.mission_incident_party(v_uid, v_inc.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;
  -- Une question adressée à l'autre partie reste invisible : même réponse
  -- qu'une demande inexistante.
  if v_party <> v_req.party then
    raise exception 'incident_not_found';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = v_req.incident_id for update;
  select r.* into v_req from public.mission_incident_info_requests r where r.id = p_request_id for update;
  if v_req.answered_at is not null then
    return query select v_req.id, v_req.answer_statement_id, true;
    return;
  end if;
  if v_inc.status = 'closed' then
    raise exception 'incident_closed';
  end if;
  if length(v_body) < 10 or length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  insert into public.mission_incident_statements (incident_id, party, author_id, body, info_request_id)
  values (v_inc.id, v_party, v_uid, v_body, v_req.id)
  returning id into v_sid;
  update public.mission_incident_info_requests r
  set answered_at = now(), answer_statement_id = v_sid where r.id = v_req.id;
  if v_party <> v_inc.reported_by_party and v_inc.status = 'open' then
    update public.mission_incidents i set status = 'answered' where i.id = v_inc.id;
  end if;
  perform public.incident_event(v_inc.id, 'info_answered', 'party', v_uid,
    jsonb_build_object('party', v_party, 'request_id', v_req.id));
  return query select v_req.id, v_sid, false;
end;
$$;
revoke all on function public.answer_incident_info_request(uuid, text) from public, anon;
grant execute on function public.answer_incident_info_request(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Proposition puis seconde validation (admin_ops, admin_founder)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.admin_propose_incident_decision(
  p_incident_id uuid,
  p_outcome text,
  p_facts_retained text,
  p_elements_verified text,
  p_contradictions text,
  p_justification text,
  p_amicable_attempt text default null,
  p_orientation text default null,
  p_conflict text default null
)
returns table (result text, proposal_id uuid, dossier_revision integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_inc public.mission_incidents;
  v_day public.mission_days;
  v_mission public.missions;
  v_app public.application_status;
  v_facts text := btrim(coalesce(p_facts_retained, ''));
  v_elements text := btrim(coalesce(p_elements_verified, ''));
  v_contra text := btrim(coalesce(p_contradictions, ''));
  v_just text := btrim(coalesce(p_justification, ''));
  v_amicable text := nullif(btrim(coalesce(p_amicable_attempt, '')), '');
  v_orient text := nullif(btrim(coalesce(p_orientation, '')), '');
  v_id uuid;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_outcome is null or p_outcome not in ('established', 'not_established', 'partial', 'disagreement') then
    raise exception 'outcome_invalid';
  end if;
  if length(v_facts) not between 10 and 4000 or length(v_elements) not between 10 and 4000
     or length(v_contra) not between 10 and 4000 or length(v_just) not between 10 and 4000 then
    raise exception 'decision_text_invalid';
  end if;
  if p_outcome = 'disagreement' then
    if v_amicable is null or v_orient is null
       or length(v_amicable) not between 10 and 2000 or length(v_orient) not between 10 and 2000 then
      raise exception 'disagreement_followup_required';
    end if;
  else
    v_amicable := null;
    v_orient := null;
  end if;

  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  -- Ordre des verrous de la réalisation : mission, journée, dossier.
  select m.* into v_mission from public.missions m where m.id = v_inc.mission_id for update;
  select d.* into v_day from public.mission_days d where d.id = v_inc.mission_day_id for update;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;

  if not public.incident_conflict_gate(v_inc.id, v_uid, p_conflict, 'proposal') then
    return query select 'conflict_declared'::text, null::uuid, v_inc.revision;
    return;
  end if;
  if v_inc.status not in ('open', 'answered') then
    raise exception 'incident_closed';
  end if;

  if p_outcome = 'established' then
    if v_inc.kind not in ('code_not_received', 'absence') then
      raise exception 'outcome_not_applicable';
    end if;
    if v_day.actual_end_time is not null then
      raise exception 'day_already_confirmed';
    end if;
    select a.status into v_app from public.job_applications a where a.id = v_mission.application_id;
    if v_mission.status in ('cancelled', 'no_show', 'disputed') or v_app is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
    if v_day.actual_start_time is null then
      raise exception 'start_not_confirmed';
    end if;
    if now() < v_day.ends_at then
      raise exception 'day_not_ended';
    end if;
    -- Silence de l'entreprise : examen renforcé atteint et second canal
    -- vérifié tenté. Le silence ne vaut jamais confirmation : il autorise
    -- seulement une proposition, examinée par un second agent.
    if not public.incident_company_responded(v_inc.id) then
      if not exists (select 1 from public.mission_incident_events e
                     where e.incident_id = v_inc.id and e.event_type = 'escalation_48h') then
        raise exception 'escalation_pending';
      end if;
      if not public.incident_second_channel_done(v_inc.id) then
        raise exception 'second_channel_required';
      end if;
    end if;
  end if;

  update public.mission_incident_proposals p set status = 'superseded'
  where p.incident_id = v_inc.id and p.status = 'pending';
  insert into public.mission_incident_proposals (
    incident_id, outcome, facts_retained, elements_verified, contradictions, justification,
    amicable_attempt, orientation, dossier_revision, proposed_by, proposed_by_role
  ) values (
    v_inc.id, p_outcome, v_facts, v_elements, v_contra, v_just, v_amicable, v_orient,
    v_inc.revision, v_uid, v_role
  ) returning id into v_id;
  perform public.incident_event(v_inc.id, 'proposal_created', 'admin', v_uid,
    jsonb_build_object('proposal_id', v_id, 'outcome', p_outcome, 'revision', v_inc.revision));
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'propose_incident_decision', 'mission_incidents', v_inc.id,
          jsonb_build_object('proposal_id', v_id, 'outcome', p_outcome, 'revision', v_inc.revision));
  return query select 'proposed'::text, v_id, v_inc.revision;
end;
$$;
revoke all on function public.admin_propose_incident_decision(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_propose_incident_decision(uuid, text, text, text, text, text, text, text, text) to authenticated;

-- Confirmation exceptionnelle de la journée d'un dossier (appelée sous
-- verrous mission, journée et dossier) : provenance « exceptional », fin
-- de mission si c'était la dernière journée.
create or replace function public.incident_confirm_day_exceptional(p_day_id uuid, p_mission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done boolean;
begin
  update public.mission_days d set actual_end_time = now(), completion_source = 'exceptional'
  where d.id = p_day_id;
  v_done := not exists (select 1 from public.mission_days d
                        where d.mission_id = p_mission_id and d.actual_end_time is null);
  if v_done then
    update public.missions m set actual_end_time = now(), status = 'completed'
    where m.id = p_mission_id;
  end if;
  return v_done;
end;
$$;
revoke all on function public.incident_confirm_day_exceptional(uuid, uuid) from public, anon, authenticated;

-- Notifications d'une décision (initiale ou de révision) aux deux parties.
create or replace function public.incident_notify_decision(
  p_incident_id uuid, p_decision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.mission_incidents;
  v_dec public.mission_incident_decisions;
  v_parties uuid[];
  v_title text;
  v_date date;
  v_out_fr text;
  v_out_en text;
  v_tail_fr text;
  v_tail_en text;
  i integer;
begin
  select x.* into v_inc from public.mission_incidents x where x.id = p_incident_id;
  select x.* into v_dec from public.mission_incident_decisions x where x.id = p_decision_id;
  v_parties := public.mission_incident_parties(p_incident_id);
  select j.title into v_title from public.jobs j where j.id = v_inc.job_id;
  select d.scheduled_date into v_date from public.mission_days d where d.id = v_inc.mission_day_id;
  v_out_fr := case v_dec.outcome when 'established' then 'réalisation établie'
                when 'not_established' then 'réalisation non établie'
                when 'partial' then 'réalisation partielle'
                else 'désaccord persistant' end;
  v_out_en := case v_dec.outcome when 'established' then 'work established'
                when 'not_established' then 'work not established'
                when 'partial' then 'partial work'
                else 'persistent disagreement' end;
  if v_dec.kind = 'initial' then
    v_tail_fr := ' Vous pouvez demander une révision interne jusqu''au '
      || to_char(v_dec.review_deadline at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI') || ' (heure de Douala).';
    v_tail_en := ' You can request an internal review until '
      || to_char(v_dec.review_deadline at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI') || ' (Douala time).';
  else
    v_tail_fr := ' Révision interne examinée. Vos autres recours restent ouverts.';
    v_tail_en := ' Internal review completed. Your other remedies remain open.';
  end if;
  for i in 1..2 loop
    perform public.incident_notify(
      v_parties[i],
      case when v_dec.kind = 'initial' then 'Décision sur un signalement' else 'Révision d''une décision' end,
      case when v_dec.kind = 'initial' then 'Decision on a report' else 'Review of a decision' end,
      'Journée du ' || to_char(v_date, 'DD/MM/YYYY') || ' (« ' || v_title || ' ») : ' || v_out_fr || '.' || v_tail_fr,
      'Day of ' || to_char(v_date, 'YYYY-MM-DD') || ' ("' || v_title || '"): ' || v_out_en || '.' || v_tail_en,
      jsonb_build_object('kind', 'mission_incident_decision', 'incident_id', p_incident_id,
        'decision_id', p_decision_id, 'outcome', v_dec.outcome,
        'review_deadline', v_dec.review_deadline, 'mission_id', v_inc.mission_id,
        'href', case when i = 1 then '/missions/' || v_inc.mission_id
                     else '/company/jobs/' || v_inc.job_id end));
  end loop;
end;
$$;
revoke all on function public.incident_notify_decision(uuid, uuid) from public, anon, authenticated;

create or replace function public.admin_review_incident_proposal(
  p_proposal_id uuid,
  p_approve boolean,
  p_note text,
  p_conflict text default null
)
returns table (
  result text,
  decision_id uuid,
  outcome text,
  mission_day_id uuid,
  completed_via text,
  mission_completed boolean,
  review_deadline timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := btrim(coalesce(p_note, ''));
  v_prop public.mission_incident_proposals;
  v_inc public.mission_incidents;
  v_day public.mission_days;
  v_mission public.missions;
  v_app public.application_status;
  v_dec public.mission_incident_decisions;
  v_done boolean := false;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_approve is null then
    raise exception 'outcome_invalid';
  end if;
  if length(v_note) < 10 or length(v_note) > 2000 then
    raise exception 'note_invalid';
  end if;
  select p.* into v_prop from public.mission_incident_proposals p where p.id = p_proposal_id;
  if not found then
    raise exception 'proposal_not_found';
  end if;
  select i.* into v_inc from public.mission_incidents i where i.id = v_prop.incident_id;
  select m.* into v_mission from public.missions m where m.id = v_inc.mission_id for update;
  select d.* into v_day from public.mission_days d where d.id = v_inc.mission_day_id for update;
  select i.* into v_inc from public.mission_incidents i where i.id = v_prop.incident_id for update;
  select p.* into v_prop from public.mission_incident_proposals p where p.id = p_proposal_id for update;

  -- Relance (double clic, réponse perdue) : le résultat acquis.
  if v_prop.status = 'approved' then
    select x.* into v_dec from public.mission_incident_decisions x where x.proposal_id = v_prop.id;
    return query select 'already_decided'::text, v_dec.id, v_dec.outcome, v_day.id,
      v_day.completion_source, v_mission.actual_end_time is not null, v_dec.review_deadline;
    return;
  end if;
  if v_prop.status = 'rejected' and v_prop.reviewed_by = v_uid and not p_approve then
    return query select 'already_rejected'::text, null::uuid, v_prop.outcome, v_day.id,
      v_day.completion_source, false, null::timestamptz;
    return;
  end if;
  if v_prop.status <> 'pending' then
    raise exception 'proposal_closed';
  end if;
  -- Dossier tranché ailleurs (code, confirmation de l'entreprise) : état
  -- relu, aucun effet.
  if v_inc.status not in ('open', 'answered')
     or (v_prop.outcome = 'established' and v_day.actual_end_time is not null) then
    return query select
      case when v_day.actual_end_time is not null then 'already_confirmed' else 'obsolete' end,
      null::uuid, v_prop.outcome, v_day.id, v_day.completion_source,
      v_mission.actual_end_time is not null, null::timestamptz;
    return;
  end if;
  -- Double validation : jamais par l'auteur de la proposition.
  if v_prop.proposed_by = v_uid then
    raise exception 'self_review_forbidden';
  end if;
  if public.incident_agent_concerned(v_inc.id, v_prop.proposed_by) then
    raise exception 'proposer_conflict';
  end if;
  if not public.incident_conflict_gate(v_inc.id, v_uid, p_conflict, 'review') then
    return query select 'conflict_declared'::text, null::uuid, v_prop.outcome, v_day.id,
      v_day.completion_source, false, null::timestamptz;
    return;
  end if;
  -- Version examinée : toute réponse, pièce ou requalification postérieure
  -- impose une relecture (nouvelle proposition).
  if v_prop.dossier_revision <> v_inc.revision then
    raise exception 'proposal_stale';
  end if;

  if not p_approve then
    update public.mission_incident_proposals p
    set status = 'rejected', reviewed_by = v_uid, review_note = v_note, reviewed_at = now()
    where p.id = v_prop.id;
    perform public.incident_event(v_inc.id, 'proposal_rejected', 'admin', v_uid,
      jsonb_build_object('proposal_id', v_prop.id));
    insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
    values (v_uid, v_role, 'reject_incident_proposal', 'mission_incidents', v_inc.id,
            jsonb_build_object('proposal_id', v_prop.id, 'proposed_by', v_prop.proposed_by));
    return query select 'rejected'::text, null::uuid, v_prop.outcome, v_day.id,
      v_day.completion_source, false, null::timestamptz;
    return;
  end if;

  if v_prop.outcome = 'established' then
    select a.status into v_app from public.job_applications a where a.id = v_mission.application_id;
    if v_mission.status in ('cancelled', 'no_show', 'disputed') or v_app is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
    if v_day.actual_start_time is null then
      raise exception 'start_not_confirmed';
    end if;
    if now() < v_day.ends_at then
      raise exception 'day_not_ended';
    end if;
  end if;

  insert into public.mission_incident_decisions (
    incident_id, kind, proposal_id, outcome, facts_retained, elements_verified, contradictions,
    justification, amicable_attempt, orientation, proposed_by, decided_by, decided_by_role,
    review_deadline
  ) values (
    v_inc.id, 'initial', v_prop.id, v_prop.outcome, v_prop.facts_retained, v_prop.elements_verified,
    v_prop.contradictions, v_prop.justification, v_prop.amicable_attempt, v_prop.orientation,
    v_prop.proposed_by, v_uid, v_role, now() + interval '7 days'
  ) returning * into v_dec;
  update public.mission_incident_proposals p
  set status = 'approved', reviewed_by = v_uid, review_note = v_note, reviewed_at = now()
  where p.id = v_prop.id;
  -- Décision d'abord : le dossier n'est pas clos « journée confirmée ».
  update public.mission_incidents i
  set status = 'decided', outcome = v_prop.outcome, decision_note = v_prop.justification,
      decided_by = v_uid, decided_at = now()
  where i.id = v_inc.id;
  if v_prop.outcome = 'established' then
    v_done := public.incident_confirm_day_exceptional(v_day.id, v_mission.id);
    select d.* into v_day from public.mission_days d where d.id = v_day.id;
  end if;

  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'decide_incident_double_validation', 'mission_incidents', v_inc.id,
          jsonb_build_object('decision_id', v_dec.id, 'proposal_id', v_prop.id,
            'outcome', v_prop.outcome, 'proposed_by', v_prop.proposed_by, 'decided_by', v_uid,
            'revision', v_prop.dossier_revision, 'mission_day_id', v_day.id,
            'mission_completed', v_done));
  perform public.incident_event(v_inc.id, 'decision_recorded', 'party', v_uid,
    jsonb_build_object('decision_id', v_dec.id, 'outcome', v_dec.outcome, 'kind', 'initial',
      'review_deadline', v_dec.review_deadline));
  perform public.incident_notify_decision(v_inc.id, v_dec.id);

  return query select 'decided'::text, v_dec.id, v_dec.outcome, v_day.id,
    v_day.completion_source, v_done, v_dec.review_deadline;
end;
$$;
revoke all on function public.admin_review_incident_proposal(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_review_incident_proposal(uuid, boolean, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 9. Révision interne (7 jours)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.request_incident_review(p_incident_id uuid, p_statement text)
returns table (appeal_id uuid, status text, already_requested boolean, review_deadline timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(coalesce(p_statement, ''));
  v_inc public.mission_incidents;
  v_party text;
  v_dec public.mission_incident_decisions;
  v_appeal public.mission_incident_appeals;
begin
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id;
  if not found then
    raise exception 'incident_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(v_uid, v_inc.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id for update;
  select d.* into v_dec from public.mission_incident_decisions d
  where d.incident_id = v_inc.id and d.kind = 'initial'
  order by d.decided_at desc limit 1;
  if not found then
    raise exception 'no_decision';
  end if;
  select a.* into v_appeal from public.mission_incident_appeals a where a.decision_id = v_dec.id for update;
  if found and exists (select 1 from public.mission_incident_appeal_requests r
                       where r.appeal_id = v_appeal.id and r.party = v_party) then
    return query select v_appeal.id, v_appeal.status, true, v_dec.review_deadline;
    return;
  end if;
  -- Échéance à l'heure de la base : à l'instant exact, close.
  if now() >= v_dec.review_deadline then
    raise exception 'review_window_closed';
  end if;
  if found and v_appeal.status = 'decided' then
    raise exception 'review_already_decided';
  end if;
  if length(v_body) < 10 or length(v_body) > 2000 then
    raise exception 'statement_invalid';
  end if;
  if v_appeal.id is null then
    insert into public.mission_incident_appeals (incident_id, decision_id)
    values (v_inc.id, v_dec.id) returning * into v_appeal;
  end if;
  insert into public.mission_incident_appeal_requests (appeal_id, party, requested_by, body)
  values (v_appeal.id, v_party, v_uid, v_body);
  perform public.incident_event(v_inc.id, 'appeal_requested', 'party', v_uid,
    jsonb_build_object('party', v_party, 'appeal_id', v_appeal.id, 'decision_id', v_dec.id));
  return query select v_appeal.id, v_appeal.status, false, v_dec.review_deadline;
end;
$$;
revoke all on function public.request_incident_review(uuid, text) from public, anon;
grant execute on function public.request_incident_review(uuid, text) to authenticated;

-- Affectation : un agent habilité distinct de celui qui a proposé et de
-- celui qui a validé la décision contestée, non concerné.
create or replace function public.admin_take_incident_appeal(p_appeal_id uuid, p_conflict text default null)
returns table (result text, appeal_id uuid, assigned_to uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_appeal public.mission_incident_appeals;
  v_dec public.mission_incident_decisions;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select a.* into v_appeal from public.mission_incident_appeals a where a.id = p_appeal_id for update;
  if not found then
    raise exception 'appeal_not_found';
  end if;
  select d.* into v_dec from public.mission_incident_decisions d where d.id = v_appeal.decision_id;
  if v_uid = v_dec.proposed_by or v_uid = v_dec.decided_by then
    raise exception 'reviewer_not_eligible';
  end if;
  if v_appeal.assigned_to = v_uid then
    return query select 'already_assigned'::text, v_appeal.id, v_uid;
    return;
  end if;
  if v_appeal.status <> 'pending_assignment' then
    raise exception 'appeal_already_assigned';
  end if;
  if not public.incident_conflict_gate(v_appeal.incident_id, v_uid, p_conflict, 'appeal') then
    return query select 'conflict_declared'::text, v_appeal.id, null::uuid;
    return;
  end if;
  update public.mission_incident_appeals a
  set status = 'assigned', assigned_to = v_uid, assigned_at = now()
  where a.id = v_appeal.id;
  perform public.incident_event(v_appeal.incident_id, 'appeal_assigned', 'party', v_uid,
    jsonb_build_object('appeal_id', v_appeal.id));
  return query select 'assigned'::text, v_appeal.id, v_uid;
end;
$$;
revoke all on function public.admin_take_incident_appeal(uuid, text) from public, anon;
grant execute on function public.admin_take_incident_appeal(uuid, text) to authenticated;

create or replace function public.admin_decide_incident_appeal(
  p_appeal_id uuid,
  p_result text,
  p_new_outcome text,
  p_facts_retained text,
  p_elements_verified text,
  p_contradictions text,
  p_justification text,
  p_amicable_attempt text default null,
  p_orientation text default null
)
returns table (result text, decision_id uuid, outcome text, completed_via text, mission_completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_appeal public.mission_incident_appeals;
  v_contested public.mission_incident_decisions;
  v_inc public.mission_incidents;
  v_day public.mission_days;
  v_mission public.missions;
  v_app public.application_status;
  v_dec public.mission_incident_decisions;
  v_outcome text;
  v_facts text := btrim(coalesce(p_facts_retained, ''));
  v_elements text := btrim(coalesce(p_elements_verified, ''));
  v_contra text := btrim(coalesce(p_contradictions, ''));
  v_just text := btrim(coalesce(p_justification, ''));
  v_amicable text := nullif(btrim(coalesce(p_amicable_attempt, '')), '');
  v_orient text := nullif(btrim(coalesce(p_orientation, '')), '');
  v_done boolean := false;
begin
  if not public.is_ops_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if p_result is null or p_result not in ('upheld', 'revised', 'arbitration_required') then
    raise exception 'outcome_invalid';
  end if;
  if length(v_facts) not between 10 and 4000 or length(v_elements) not between 10 and 4000
     or length(v_contra) not between 10 and 4000 or length(v_just) not between 10 and 4000 then
    raise exception 'decision_text_invalid';
  end if;
  select a.* into v_appeal from public.mission_incident_appeals a where a.id = p_appeal_id;
  if not found then
    raise exception 'appeal_not_found';
  end if;
  select d.* into v_contested from public.mission_incident_decisions d where d.id = v_appeal.decision_id;
  select i.* into v_inc from public.mission_incidents i where i.id = v_appeal.incident_id;
  select m.* into v_mission from public.missions m where m.id = v_inc.mission_id for update;
  select d.* into v_day from public.mission_days d where d.id = v_inc.mission_day_id for update;
  select i.* into v_inc from public.mission_incidents i where i.id = v_appeal.incident_id for update;
  select a.* into v_appeal from public.mission_incident_appeals a where a.id = p_appeal_id for update;

  if v_appeal.status = 'decided' then
    select d.* into v_dec from public.mission_incident_decisions d where d.id = v_appeal.result_decision_id;
    return query select 'already_decided'::text, v_dec.id, v_dec.outcome,
      v_day.completion_source, v_mission.actual_end_time is not null;
    return;
  end if;
  if v_appeal.assigned_to is distinct from v_uid then
    raise exception 'appeal_not_assigned';
  end if;
  if public.incident_agent_concerned(v_inc.id, v_uid) then
    raise exception 'conflict_of_interest';
  end if;

  v_outcome := v_contested.outcome;
  if p_result = 'revised' then
    if v_contested.outcome = 'established' then
      -- Annuler une journée confirmée n'est pas introduit : arbitrage.
      raise exception 'arbitration_required';
    end if;
    if p_new_outcome is null
       or p_new_outcome not in ('established', 'not_established', 'partial', 'disagreement')
       or p_new_outcome = v_contested.outcome then
      raise exception 'outcome_invalid';
    end if;
    v_outcome := p_new_outcome;
  end if;
  if v_outcome = 'disagreement' then
    if v_amicable is null or v_orient is null
       or length(v_amicable) not between 10 and 2000 or length(v_orient) not between 10 and 2000 then
      raise exception 'disagreement_followup_required';
    end if;
  elsif p_result = 'revised' then
    v_amicable := null;
    v_orient := null;
  else
    v_amicable := coalesce(v_amicable, v_contested.amicable_attempt);
    v_orient := coalesce(v_orient, v_contested.orientation);
  end if;

  if p_result = 'revised' and v_outcome = 'established' then
    if v_day.actual_end_time is not null then
      return query select 'already_confirmed'::text, null::uuid, v_outcome,
        v_day.completion_source, v_mission.actual_end_time is not null;
      return;
    end if;
    if v_inc.kind not in ('code_not_received', 'absence') then
      raise exception 'outcome_not_applicable';
    end if;
    select a.status into v_app from public.job_applications a where a.id = v_mission.application_id;
    if v_mission.status in ('cancelled', 'no_show', 'disputed') or v_app is distinct from 'selected' then
      raise exception 'mission_not_active';
    end if;
    if v_day.actual_start_time is null then
      raise exception 'start_not_confirmed';
    end if;
  end if;

  insert into public.mission_incident_decisions (
    incident_id, kind, appeal_id, supersedes_id, outcome, appeal_result, facts_retained,
    elements_verified, contradictions, justification, amicable_attempt, orientation,
    proposed_by, decided_by, decided_by_role
  ) values (
    v_inc.id, 'appeal', v_appeal.id, v_contested.id, v_outcome, p_result, v_facts, v_elements,
    v_contra, v_just, v_amicable, v_orient, null, v_uid, v_role
  ) returning * into v_dec;
  update public.mission_incident_appeals a
  set status = 'decided', result_decision_id = v_dec.id where a.id = v_appeal.id;
  if p_result = 'revised' and v_outcome = 'established' then
    v_done := public.incident_confirm_day_exceptional(v_day.id, v_mission.id);
    select d.* into v_day from public.mission_days d where d.id = v_day.id;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, v_role, 'decide_incident_appeal', 'mission_incidents', v_inc.id,
          jsonb_build_object('appeal_id', v_appeal.id, 'decision_id', v_dec.id,
            'contested_decision_id', v_contested.id, 'result', p_result, 'outcome', v_outcome,
            'mission_completed', v_done));
  perform public.incident_event(v_inc.id, 'appeal_decided', 'party', v_uid,
    jsonb_build_object('appeal_id', v_appeal.id, 'decision_id', v_dec.id,
      'result', p_result, 'outcome', v_outcome));
  perform public.incident_notify_decision(v_inc.id, v_dec.id);
  return query select 'decided'::text, v_dec.id, v_outcome, v_day.completion_source, v_done;
end;
$$;
revoke all on function public.admin_decide_incident_appeal(uuid, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_decide_incident_appeal(uuid, text, text, text, text, text, text, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Échéances : balayage idempotent (tâche planifiée existante)
-- ════════════════════════════════════════════════════════════════════
-- p_at : heure de la base (la preuve rejoue des instants exacts). Relance
-- à base + 24 h et examen renforcé à base + 48 h, seulement si
-- l'entreprise n'a pas répondu ; un événement unique par étape (index
-- unique) : relances et exécutions concurrentes sans doublon. Rien n'est
-- jamais confirmé.
create or replace function public.incident_deadline_sweep(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
  v_event uuid;
  v_parties uuid[];
  v_title text;
  v_date date;
begin
  for r in
    select i.id, i.mission_id, i.job_id, i.mission_day_id,
           i.created_at + make_interval(hours => i.deadline_extension_hours) as base
    from public.mission_incidents i
    where i.reported_by_party = 'candidate'
      and i.status in ('open', 'answered')
      and i.created_at + make_interval(hours => i.deadline_extension_hours)
          + interval '24 hours' <= p_at
      and not public.incident_company_responded(i.id, p_at)
    order by i.created_at
  loop
    v_event := null;
    insert into public.mission_incident_events (incident_id, event_type, visibility, data)
    values (r.id, 'reminder_24h', 'party',
            jsonb_build_object('due_at', r.base + interval '24 hours', 'channel', 'in_app'))
    on conflict (incident_id, event_type)
      where event_type in ('opened', 'reminder_24h', 'escalation_48h')
    do nothing
    returning id into v_event;
    if v_event is not null then
      v_count := v_count + 1;
      v_parties := public.mission_incident_parties(r.id);
      select j.title into v_title from public.jobs j where j.id = r.job_id;
      select d.scheduled_date into v_date from public.mission_days d where d.id = r.mission_day_id;
      perform public.incident_notify(v_parties[2],
        'Signalement en attente de votre réponse', 'Report awaiting your answer',
        'Rappel : le candidat a signalé la journée du ' || to_char(v_date, 'DD/MM/YYYY')
          || ' (« ' || v_title || ' »). Donnez votre version dans EasyJob.',
        'Reminder: the candidate reported the day of ' || to_char(v_date, 'YYYY-MM-DD')
          || ' ("' || v_title || '"). Give your version in EasyJob.',
        jsonb_build_object('kind', 'mission_incident_reminder', 'incident_id', r.id,
          'mission_id', r.mission_id, 'href', '/company/jobs/' || r.job_id));
    end if;
    if r.base + interval '48 hours' <= p_at then
      v_event := null;
      insert into public.mission_incident_events (incident_id, event_type, visibility, data)
      values (r.id, 'escalation_48h', 'admin',
              jsonb_build_object('due_at', r.base + interval '48 hours'))
      on conflict (incident_id, event_type)
        where event_type in ('opened', 'reminder_24h', 'escalation_48h')
      do nothing
      returning id into v_event;
      if v_event is not null then
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.incident_deadline_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.incident_deadline_sweep(timestamptz) to service_role;

-- Tâche planifiée existante : même travail, toutes les 15 minutes.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('reputation-expiry-sweep')
      where exists (select 1 from cron.job where jobname = 'reputation-expiry-sweep');
      perform cron.schedule(
        'reputation-expiry-sweep',
        '*/15 * * * *',
        $cron$select public.reputation_expiry_sweep(); select public.incident_deadline_sweep();$cron$
      );
    exception when others then
      raise notice 'pg_cron : incident_deadline_sweep à planifier manuellement.';
    end;
  else
    raise notice 'pg_cron absent : incident_deadline_sweep à planifier avec reputation_expiry_sweep.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 11. Lectures
-- ════════════════════════════════════════════════════════════════════
-- Parties : chronologie publique, compléments adressés à la partie,
-- décisions (faits retenus, contradictions, justification ; jamais les
-- éléments vérifiés, références, notes ni pièces), révision.
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
  can_add_statement boolean,
  timeline jsonb,
  info_requests jsonb,
  decisions jsonb,
  review jsonb,
  server_now timestamptz
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
                    'party', s.party, 'body', s.body, 'created_at', s.created_at,
                    'answers_request', s.info_request_id is not null)
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
         i.status in ('open', 'answered', 'decided')
           and (select count(*) from public.mission_incident_statements s
                where s.incident_id = i.id and s.party = v_party and s.info_request_id is null) < 5,
         coalesce((select jsonb_agg(jsonb_build_object(
                    'type', e.event_type, 'at', e.created_at,
                    'party', e.data ->> 'party', 'outcome', e.data ->> 'outcome',
                    'result', e.data ->> 'result', 'channel', e.data ->> 'channel')
                    order by e.created_at)
                   from public.mission_incident_events e
                   where e.incident_id = i.id and e.visibility = 'party'
                     and (e.event_type not in ('info_requested', 'info_answered')
                          or e.data ->> 'party' = v_party)), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', r.id, 'question', r.question, 'created_at', r.created_at,
                    'answered_at', r.answered_at) order by r.created_at)
                   from public.mission_incident_info_requests r
                   where r.incident_id = i.id and r.party = v_party), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'id', x.id, 'kind', x.kind, 'outcome', x.outcome,
                    'appeal_result', x.appeal_result, 'facts_retained', x.facts_retained,
                    'contradictions', x.contradictions, 'justification', x.justification,
                    'amicable_attempt', x.amicable_attempt, 'orientation', x.orientation,
                    'decided_at', x.decided_at, 'review_deadline', x.review_deadline)
                    order by x.decided_at)
                   from public.mission_incident_decisions x where x.incident_id = i.id), '[]'::jsonb),
         (select jsonb_build_object(
             'decision_id', x.id, 'deadline', x.review_deadline,
             'open', now() < x.review_deadline
                     and coalesce(a.status, 'none') <> 'decided'
                     and not exists (select 1 from public.mission_incident_appeal_requests q
                                     where q.appeal_id = a.id and q.party = v_party),
             'status', a.status,
             'requested_by_viewer', exists (select 1 from public.mission_incident_appeal_requests q
                                            where q.appeal_id = a.id and q.party = v_party),
             'parties', coalesce((select jsonb_agg(q.party order by q.created_at)
                                  from public.mission_incident_appeal_requests q
                                  where q.appeal_id = a.id), '[]'::jsonb))
          from public.mission_incident_decisions x
          left join public.mission_incident_appeals a on a.decision_id = x.id
          where x.incident_id = i.id and x.kind = 'initial'
          order by x.decided_at desc limit 1),
         now()
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  left join public.mission_day_confirmations k on k.incident_id = i.id
  where i.mission_id = p_mission_id
  order by d.starts_at, i.created_at;
end;
$$;
revoke all on function public.mission_incidents_for_party(uuid) from public, anon;
grant execute on function public.mission_incidents_for_party(uuid) to authenticated;

-- Liste du support : situation, échéances, proposition et révision en cours.
drop function if exists public.admin_mission_incidents(text);
create function public.admin_mission_incidents(p_status text default null)
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
  created_at timestamptz,
  situation text,
  escalated boolean,
  reminder_sent boolean,
  pending_proposal boolean,
  appeal_status text
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
         i.outcome, i.created_at, i.situation,
         exists (select 1 from public.mission_incident_events e
                 where e.incident_id = i.id and e.event_type = 'escalation_48h'),
         exists (select 1 from public.mission_incident_events e
                 where e.incident_id = i.id and e.event_type = 'reminder_24h'),
         exists (select 1 from public.mission_incident_proposals p
                 where p.incident_id = i.id and p.status = 'pending'),
         (select a.status from public.mission_incident_appeals a
          where a.incident_id = i.id order by a.created_at desc limit 1)
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

-- Dossier complet (support) : base du lot 15 enrichie.
create or replace function public.admin_mission_incident(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ops boolean;
  v_concerned boolean;
  v_base jsonb;
  v_inc public.mission_incidents;
  v_start timestamptz;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_base := public.admin_mission_incident_base(p_incident_id);
  select i.* into v_inc from public.mission_incidents i where i.id = p_incident_id;
  v_ops := public.is_ops_admin_user(v_uid);
  v_concerned := public.incident_agent_concerned(v_inc.id, v_uid);
  v_start := v_inc.created_at + make_interval(hours => v_inc.deadline_extension_hours);
  return v_base || jsonb_build_object(
    -- Lot 14 : décision générique réservée aux retards.
    'can_decide', v_ops and v_inc.status in ('open', 'answered') and v_inc.kind = 'late',
    'situation', v_inc.situation,
    'revision', v_inc.revision,
    'viewer_id', v_uid,
    'viewer_is_ops', v_ops,
    'viewer_concerned', v_concerned,
    'deadlines', jsonb_build_object(
      'applies', v_inc.reported_by_party = 'candidate',
      'opened_at', v_inc.created_at,
      'extension_hours', v_inc.deadline_extension_hours,
      'reminder_at', v_start + interval '24 hours',
      'escalation_at', v_start + interval '48 hours',
      'company_responded', public.incident_company_responded(v_inc.id),
      'reminder_sent_at', (select e.created_at from public.mission_incident_events e
                           where e.incident_id = v_inc.id and e.event_type = 'reminder_24h'),
      'escalated_at', (select e.created_at from public.mission_incident_events e
                       where e.incident_id = v_inc.id and e.event_type = 'escalation_48h'),
      'second_channel_done', public.incident_second_channel_done(v_inc.id)),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'type', e.event_type, 'visibility', e.visibility, 'at', e.created_at,
        'actor_role', e.actor_role, 'data', e.data) order by e.created_at)
      from public.mission_incident_events e where e.incident_id = v_inc.id), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id, 'body', n.body, 'author_role', n.author_role, 'created_at', n.created_at)
        order by n.created_at)
      from public.mission_incident_notes n where n.incident_id = v_inc.id), '[]'::jsonb),
    'info_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'party', r.party, 'question', r.question, 'created_at', r.created_at,
        'answered_at', r.answered_at, 'requested_by_role', r.requested_by_role)
        order by r.created_at)
      from public.mission_incident_info_requests r where r.incident_id = v_inc.id), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'outcome', p.outcome, 'facts_retained', p.facts_retained,
        'elements_verified', p.elements_verified, 'contradictions', p.contradictions,
        'justification', p.justification, 'amicable_attempt', p.amicable_attempt,
        'orientation', p.orientation, 'dossier_revision', p.dossier_revision,
        'stale', p.dossier_revision <> v_inc.revision, 'status', p.status,
        'proposed_by_role', p.proposed_by_role, 'mine', p.proposed_by = v_uid,
        'created_at', p.created_at, 'review_note', p.review_note, 'reviewed_at', p.reviewed_at,
        'can_review', v_ops and not v_concerned and p.status = 'pending'
                      and p.proposed_by <> v_uid and p.dossier_revision = v_inc.revision
                      and v_inc.status in ('open', 'answered'))
        order by p.created_at)
      from public.mission_incident_proposals p where p.incident_id = v_inc.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'kind', x.kind, 'outcome', x.outcome, 'appeal_result', x.appeal_result,
        'facts_retained', x.facts_retained, 'elements_verified', x.elements_verified,
        'contradictions', x.contradictions, 'justification', x.justification,
        'amicable_attempt', x.amicable_attempt, 'orientation', x.orientation,
        'decided_at', x.decided_at, 'decided_by_role', x.decided_by_role,
        'review_deadline', x.review_deadline) order by x.decided_at)
      from public.mission_incident_decisions x where x.incident_id = v_inc.id), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'decision_id', a.decision_id, 'status', a.status,
        'assigned_to_me', a.assigned_to = v_uid, 'assigned_at', a.assigned_at,
        'eligible_count', public.incident_appeal_eligible_count(a.id),
        'can_take', v_ops and not v_concerned and a.status = 'pending_assignment'
                    and v_uid is distinct from x.proposed_by and v_uid is distinct from x.decided_by,
        'contested_outcome', x.outcome,
        'requests', coalesce((select jsonb_agg(jsonb_build_object(
            'party', q.party, 'body', q.body, 'created_at', q.created_at) order by q.created_at)
          from public.mission_incident_appeal_requests q where q.appeal_id = a.id), '[]'::jsonb))
        order by a.created_at)
      from public.mission_incident_appeals a
      join public.mission_incident_decisions x on x.id = a.decision_id
      where a.incident_id = v_inc.id), '[]'::jsonb),
    'can_propose', v_ops and not v_concerned and v_inc.status in ('open', 'answered'));
end;
$$;
revoke all on function public.admin_mission_incident(uuid) from public, anon;
grant execute on function public.admin_mission_incident(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Temps réel : signaux minimaux
-- ════════════════════════════════════════════════════════════════════
-- Lignes lisibles par les parties : parties et support ; lignes internes :
-- support seulement. Charge utile {d, r} sans donnée.
create or replace function public.rt_on_incident_flow_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_incident uuid;
  v_party_visible boolean;
begin
  if tg_table_name = 'mission_incident_appeal_requests' then
    select a.incident_id into v_incident from public.mission_incident_appeals a
    where a.id = (v_row ->> 'appeal_id')::uuid;
  else
    v_incident := (v_row ->> 'incident_id')::uuid;
  end if;
  v_party_visible := case tg_table_name
    when 'mission_incident_events' then v_row ->> 'visibility' = 'party'
    when 'mission_incident_info_requests' then true
    when 'mission_incident_decisions' then true
    when 'mission_incident_appeals' then true
    when 'mission_incident_appeal_requests' then true
    else false end;
  if v_party_visible then
    perform public.rt_signal_users(public.mission_incident_parties(v_incident), 'incidents', v_incident);
  end if;
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_incident_flow_rows() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['mission_incident_events', 'mission_incident_info_requests',
    'mission_incident_notes', 'mission_incident_conflicts', 'mission_incident_proposals',
    'mission_incident_decisions', 'mission_incident_appeals', 'mission_incident_appeal_requests']
  loop
    execute format('drop trigger if exists trg_rt_%s on public.%I', t, t);
    execute format('create trigger trg_rt_%s after insert or update on public.%I '
                   'for each row execute function public.rt_on_incident_flow_rows()', t, t);
  end loop;
end $$;
