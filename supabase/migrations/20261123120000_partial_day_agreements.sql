-- Migration : interruption d'une journée commencée — instruction par le
-- support, décision et règlement partiel réservés au fondateur, délais
-- (décisions produit du 2026-11-19, du 2026-11-20 et du 2026-11-21)
-- Date : 2026-11-23
--
-- Cette migration n'a jamais été intégrée ni déployée. Ses versions
-- précédentes (montant proposé par l'entreprise le 2026-11-18, puis
-- règlement par le support en double validation le 2026-11-19) sont
-- remplacées ici ; aucune ligne d'accord n'existe hors des piles de preuve.
--
-- Tables : mission_incidents (nature « interruption », champs déclarés),
--   mission_incident_info_requests (respond_by), mission_days (provenances
--   « partial » et « partial_support ») ; nouvelles :
--   mission_interruption_versions, mission_interruption_proposals,
--   mission_interruption_responses, mission_interruption_closures,
--   mission_interruption_extensions, mission_interruption_recourses,
--   mission_interruption_notices, mission_interruption_reexaminations,
--   mission_interruption_closure_history (aucun accès de session).
--
-- Règles validées :
--   * Pouvoirs : seul un admin_founder actif propose ou modifie un montant,
--     prolonge son propre délai, clôt le dossier et finalise manuellement
--     un accord. admin_support et admin_ops actifs recueillent versions,
--     justificatifs, contacts et notes (fonctions du lot 16) sans fixer de
--     montant ni clore. Pas de seconde validation sur ce parcours ; la
--     double validation du lot 16 y est refusée (`use_founder_decision`).
--     Les autres parcours de litiges sont inchangés.
--   * Délais (heure de la base, contrôlés à chaque action, jamais par la
--     tâche planifiée) : 72 h pour chaque demande adressée à une partie
--     (version de l'autre partie dès l'ouverture, demandes de compléments
--     du support) ; réponse acceptée jusqu'à l'échéance incluse, refusée
--     après (`response_deadline_passed`) ; à l'échéance, examen du fondateur
--     avec les éléments disponibles (le silence ne prouve rien). 48 h pour
--     répondre à une proposition ; sans deux acceptations dans le délai elle
--     expire ; un refus la rend aussitôt non acceptée. 72 h ensuite pour le
--     fondateur (clôture motivée ou prolongation datée et motivée) ; un
--     dépassement est signalé dans sa file et rappelé, jamais tranché
--     automatiquement.
--   * Notifications : uniquement dans l'application. La mise à disposition
--     (notification créée) et la consultation effectivement observée (écran
--     du dossier affiché) sont enregistrées séparément ; rien n'est présenté
--     comme reçu ou lu sur le téléphone.
--   * Proposition : montant motivé du fondateur, identique pour les deux
--     parties, accepté par chacune pour son compte ; le silence ne vaut
--     jamais accord ; toute modification crée une version, annule les
--     acceptations et rouvre 48 h ; tout est conservé. Aucun prorata ni
--     répartition par étapes. Bornes validées le 2026-11-21 : entier en
--     XAF, minimum 0 (avec les mêmes garanties qu'un montant positif),
--     aucun multiple imposé ; plafond lu dans le contrat figé = montant du
--     contrat pour une journée, sinon part de la journée au prorata des
--     horaires contractuels (lot 17c), plafond seul arrondi à l'entier
--     inférieur (`amount_above_cap`). Le plafond ne calcule jamais la
--     valeur du travail partiel.
--   * Prolongation : une seule par dossier, 7 jours au plus après
--     l'échéance qu'elle prolonge, motivée, notifiée.
--   * Réexamen : une partie signale une erreur dans une décision du
--     fondateur ; le fondateur seul maintient, rouvre (décision conservée
--     dans l'historique) ou renvoie à un traitement distinct ; la demande
--     ne change ni blocage ni délai ; un accord accepté ou réglé n'est
--     jamais modifié ici.
--   * Finalisation : jamais sur une proposition expirée, refusée ou acceptée
--     par une seule partie. Deux acceptations de la même version : code
--     possible même avant la fin prévue, et l'échéance n'annule pas cet
--     accord. Code non remis : recours immédiat ; seul le fondateur finalise
--     alors manuellement (motif, provenance « partial_support »). Jamais une
--     réalisation complète, jamais le montant initial ; contrat signé et
--     journées confirmées intacts ; aucun versement ni remboursement.
--   * Blocages : un signalement identique ne rouvre pas un dossier clos ; un
--     nouvel élément est recevable sans rouvrir le blocage ; « non établie »
--     rend la journée à son parcours normal ; « désaccord non résolu » ne
--     confirme rien, ne crée aucun montant définitif et ne vaut ni
--     renoncement, ni remboursement, ni sanction. Aucune sanction pour
--     silence ou désaccord.
--
-- Rollback (pile non déployée) : drop des tables nouvelles, des triggers
--   trg_guard_day_completion_conflicts, trg_interruption_request_due,
--   trg_interruption_answer_deadline, trg_interruption_no_dispute_proposal ;
--   alter table mission_incident_info_requests drop column respond_by ;
--   alter table mission_incidents drop column interruption_cause,
--   interruption_declared_at, work_done ; rétablir les contraintes kind et
--   completion_source ; recréer admin_decide_mission_incident,
--   admin_request_incident_info, incident_deadline_sweep et
--   admin_mission_incidents depuis 20261120120000, submit_completion_code
--   depuis 20261119120000, mission_days_json et mission_acquired_amount
--   depuis 20261122120000 ; replanifier « reputation-expiry-sweep » sans
--   interruption_deadline_sweep ; drop function des RPC nouvelles.

-- ════════════════════════════════════════════════════════════════════
-- 1. Provenances « partial » (code après accord) et « partial_support »
--    (finalisation manuelle du fondateur)
-- ════════════════════════════════════════════════════════════════════
alter table public.mission_days drop constraint if exists mission_days_completion_source_check;
alter table public.mission_days add constraint mission_days_completion_source_check
  check (completion_source is null
         or completion_source in ('code', 'support', 'exceptional', 'legacy', 'partial',
                                  'partial_support'));

-- ════════════════════════════════════════════════════════════════════
-- 2. Nature « interruption » des signalements et versions des parties
-- ════════════════════════════════════════════════════════════════════
alter table public.mission_incidents drop constraint if exists mission_incidents_kind_check;
alter table public.mission_incidents add constraint mission_incidents_kind_check
  check (kind in ('late', 'absence', 'code_not_received', 'interruption'));
alter table public.mission_incidents
  add column if not exists interruption_cause text
    check (interruption_cause in ('candidate_left', 'company_stopped')),
  add column if not exists interruption_declared_at timestamptz,
  add column if not exists work_done text check (char_length(work_done) between 10 and 2000);
alter table public.mission_incidents drop constraint if exists mission_incidents_interruption_chk;
alter table public.mission_incidents add constraint mission_incidents_interruption_chk
  check ((kind = 'interruption')
         = (interruption_cause is not null and interruption_declared_at is not null
            and work_done is not null));
-- Un dossier d'interruption par journée, quelle que soit la partie.
create unique index if not exists mission_incidents_interruption_day_key
  on public.mission_incidents (mission_day_id) where kind = 'interruption';

create table if not exists public.mission_interruption_versions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  author_id uuid references public.users(id) on delete set null,
  cause text not null check (cause in ('candidate_left', 'company_stopped')),
  declared_at timestamptz not null,
  work_done text not null check (char_length(work_done) between 10 and 2000),
  reason text not null check (char_length(reason) between 10 and 2000),
  created_at timestamptz not null default now(),
  unique (incident_id, party)
);

-- ════════════════════════════════════════════════════════════════════
-- 3. Proposition, réponses, clôture, prolongations, recours, avis
-- ════════════════════════════════════════════════════════════════════
-- Une ligne par version, figée (seule la date de remplacement s'inscrit).
create table if not exists public.mission_interruption_proposals (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  mission_day_id uuid not null references public.mission_days(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  version integer not null check (version >= 1),
  amount integer not null check (amount >= 0),
  motivation text not null check (char_length(motivation) between 10 and 2000),
  -- Bornes appliquées (instantané de partial_settlement_policy()).
  policy jsonb not null,
  proposed_by uuid references public.users(id) on delete set null,
  proposed_by_role text not null check (proposed_by_role = 'admin_founder'),
  proposed_at timestamptz not null default now(),
  respond_by timestamptz not null,
  superseded_at timestamptz,
  unique (incident_id, version),
  constraint mission_interruption_proposals_due_chk
    check (respond_by = proposed_at + interval '48 hours')
);
create unique index if not exists mission_interruption_proposals_current_key
  on public.mission_interruption_proposals (incident_id) where superseded_at is null;

-- Réponse de chaque partie, une par version (en ajout seul).
create table if not exists public.mission_interruption_responses (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.mission_interruption_proposals(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  decision text not null check (decision in ('accept', 'refuse')),
  author_id uuid references public.users(id) on delete set null,
  responded_at timestamptz not null default now(),
  unique (proposal_id, party)
);

-- Clôture unique du dossier (en ajout seul).
create table if not exists public.mission_interruption_closures (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.mission_incidents(id) on delete cascade,
  outcome text not null check (outcome in ('not_established', 'disagreement', 'settled')),
  motivation text check (motivation is null or char_length(motivation) between 10 and 2000),
  proposal_id uuid references public.mission_interruption_proposals(id) on delete set null,
  amount integer check (amount is null or amount >= 0),
  completion_source text check (completion_source is null
                                or completion_source in ('partial', 'partial_support')),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_role text,
  decided_at timestamptz not null default now(),
  constraint mission_interruption_closures_settled_chk check (
    (outcome = 'settled') = (amount is not null and completion_source is not null)),
  -- Clôture du fondateur toujours motivée ; finalisation par code : le
  -- motif est l'accord des deux parties.
  constraint mission_interruption_closures_motivation_chk check (
    motivation is not null or completion_source = 'partial')
);

-- Prolongation exceptionnelle du délai du fondateur (en ajout seul).
-- Une seule prolongation par dossier, rattachée à l'échéance qu'elle
-- prolonge (7 jours au plus).
create table if not exists public.mission_interruption_extensions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.mission_incidents(id) on delete cascade,
  extends_due timestamptz not null,
  ends_at timestamptz not null,
  reason text not null check (char_length(reason) between 10 and 1000),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mission_interruption_extensions_span_chk check (
    ends_at > extends_due and ends_at <= extends_due + interval '7 days')
);

-- Réexamen d'une décision du fondateur demandé par une partie (même
-- dossier ; traité par le fondateur seul ; jamais un recours indépendant).
create table if not exists public.mission_interruption_reexaminations (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  closure_id uuid not null,
  closure_outcome text not null,
  party text not null check (party in ('candidate', 'company')),
  author_id uuid references public.users(id) on delete set null,
  reason text not null check (char_length(reason) between 10 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  decision text check (decision in ('maintained', 'reopened', 'separate_handling')),
  decision_motivation text check (decision_motivation is null
                                  or char_length(decision_motivation) between 10 and 2000),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  constraint mission_interruption_reexaminations_decision_chk check (
    (decided_at is null) = (decision is null)
    and (decided_at is null) = (decision_motivation is null))
);
create unique index if not exists mission_interruption_reexaminations_pending_key
  on public.mission_interruption_reexaminations (closure_id, party) where decided_at is null;

-- Décisions remplacées après un réexamen « rouvert » (en ajout seul) : la
-- clôture en vigueur reste seule dans mission_interruption_closures.
create table if not exists public.mission_interruption_closure_history (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  closure_id uuid not null,
  outcome text not null,
  motivation text,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz not null,
  reexamination_id uuid not null references public.mission_interruption_reexaminations(id) on delete cascade,
  revoked_at timestamptz not null default now()
);

-- Recours d'une partie quand le code n'est pas remis après l'accord.
create table if not exists public.mission_interruption_recourses (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  proposal_id uuid not null references public.mission_interruption_proposals(id) on delete cascade,
  party text not null check (party in ('candidate', 'company')),
  author_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (proposal_id, party)
);

-- Avis : mise à disposition dans l'application (notification créée) et
-- consultation observée, distinctes ; une étape une fois par destinataire.
create table if not exists public.mission_interruption_notices (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.mission_incidents(id) on delete cascade,
  kind text not null check (kind in (
    'version_request', 'version_reminder', 'version_expired',
    'info_request', 'info_reminder', 'info_expired',
    'proposal', 'proposal_reminder', 'proposal_expired', 'proposal_refused', 'agreement',
    'review_extended', 'founder_overdue', 'recourse', 'closure', 'finalized', 'new_element',
    'reexam_request', 'reexam_decision')),
  ref text not null,
  recipient_id uuid not null references public.users(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('candidate', 'company', 'founder')),
  notification_id uuid references public.notifications(id) on delete set null,
  made_available_at timestamptz not null default clock_timestamp(),
  viewed_at timestamptz,
  unique (incident_id, kind, ref, recipient_id)
);
create index if not exists idx_interruption_notices_recipient
  on public.mission_interruption_notices (recipient_id) where viewed_at is null;

do $$
declare
  t text;
begin
  foreach t in array array['mission_interruption_versions', 'mission_interruption_proposals',
    'mission_interruption_responses', 'mission_interruption_closures',
    'mission_interruption_extensions', 'mission_interruption_recourses',
    'mission_interruption_notices', 'mission_interruption_reexaminations',
    'mission_interruption_closure_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- Aucune écriture de session ; lignes en ajout seul, sauf la date de
-- remplacement d'une proposition et, pour un avis, la notification liée et
-- la consultation (une fois chacune).
create or replace function public.protect_interruption_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if current_user in ('anon', 'authenticated') then
    raise exception '%: server-side only', tg_table_name using errcode = '42501';
  end if;
  if tg_op <> 'UPDATE' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if tg_table_name = 'mission_interruption_proposals' then
    if v_old ->> 'superseded_at' is not null
       or (v_new - 'superseded_at') is distinct from (v_old - 'superseded_at') then
      raise exception 'mission_interruption_proposals: proposal is immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'mission_interruption_notices' then
    if (v_new - 'viewed_at' - 'notification_id') is distinct from (v_old - 'viewed_at' - 'notification_id')
       or (v_old ->> 'viewed_at' is not null and v_new ->> 'viewed_at' is distinct from v_old ->> 'viewed_at')
       or (v_old ->> 'notification_id' is not null
           and v_new ->> 'notification_id' is distinct from v_old ->> 'notification_id') then
      raise exception 'mission_interruption_notices: notice is immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'mission_interruption_reexaminations' then
    if v_old ->> 'decided_at' is not null
       or (v_new - 'decision' - 'decision_motivation' - 'decided_by' - 'decided_at')
          is distinct from (v_old - 'decision' - 'decision_motivation' - 'decided_by' - 'decided_at') then
      raise exception 'mission_interruption_reexaminations: decision is final' using errcode = '42501';
    end if;
  else
    raise exception '%: rows are append-only', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_interruption_writes() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['mission_interruption_versions', 'mission_interruption_proposals',
    'mission_interruption_responses', 'mission_interruption_closures',
    'mission_interruption_extensions', 'mission_interruption_recourses',
    'mission_interruption_notices', 'mission_interruption_reexaminations',
    'mission_interruption_closure_history'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_interruption_writes()', t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 4. Fondateur actif ; bornes du règlement (non arbitrées)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.is_founder_admin_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.users u
                 where u.id = uid and u.is_active is not false
                   and u.role::text = 'admin_founder');
$$;
revoke all on function public.is_founder_admin_user(uuid) from public, anon, authenticated;

-- Bornes validées (décision du 2026-11-21) : montant entier en XAF,
-- minimum 0, aucun multiple imposé ; plafond = montant initial du contrat
-- pour une mission d'une journée, sinon part de la journée au prorata des
-- horaires contractuels (formule du lot 17c), arrondie à l'entier
-- inférieur (interruption_settlement_cap). Le plafond encadre la
-- proposition : il ne calcule jamais la valeur du travail partiel.
create or replace function public.partial_settlement_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('validated', true, 'min_amount', 0, 'rounding_unit', 1,
                            'cap_rule', 'contract_day_share_floor');
$$;
revoke all on function public.partial_settlement_policy() from public, anon, authenticated;

-- Plafond d'une journée, lu dans les conditions figées du contrat (jamais
-- dans l'offre) : une journée → montant du contrat ; plusieurs →
-- floor(montant × minutes prévues de la journée ÷ minutes prévues de toutes
-- les journées), durées brutes du contrat, pause non déduite.
create or replace function public.interruption_settlement_cap(p_day_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day public.mission_days;
  v_contract public.contracts;
  v_pay numeric;
  v_days jsonb;
  v_total integer := 0;
  v_mine integer;
  e jsonb;
begin
  select d.* into v_day from public.mission_days d where d.id = p_day_id;
  select c.* into v_contract from public.contracts c
  join public.missions m on m.application_id = c.application_id
  where m.id = v_day.mission_id;
  if v_contract.id is null
     or jsonb_typeof(v_contract.contract_data -> 'mission_pay_per_candidate') is distinct from 'number' then
    return null;
  end if;
  v_pay := (v_contract.contract_data ->> 'mission_pay_per_candidate')::numeric;
  v_days := coalesce(v_contract.contract_data -> 'days',
    jsonb_build_array(jsonb_build_object(
      'date', v_contract.contract_data ->> 'start_date',
      'start_time', v_contract.contract_data ->> 'start_time',
      'end_time', v_contract.contract_data ->> 'end_time')));
  for e in select * from jsonb_array_elements(v_days) loop
    v_total := v_total + public.contract_day_minutes((e ->> 'start_time')::time, (e ->> 'end_time')::time);
    if (e ->> 'date')::date = v_day.scheduled_date then
      v_mine := public.contract_day_minutes((e ->> 'start_time')::time, (e ->> 'end_time')::time);
    end if;
  end loop;
  if v_mine is null or v_total <= 0 then
    return null;
  end if;
  if jsonb_array_length(v_days) = 1 then
    return floor(v_pay)::integer;
  end if;
  return floor(v_pay * v_mine / v_total)::integer;
end;
$$;
revoke all on function public.interruption_settlement_cap(uuid) from public, anon, authenticated;

-- Échéance : réponse recevable jusqu'à l'instant d'échéance inclus.
create or replace function public.interruption_deadline_open(p_due timestamptz, p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_due is not null and p_at <= p_due;
$$;
revoke all on function public.interruption_deadline_open(timestamptz, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 5. Délais des demandes et garde des autres parcours
-- ════════════════════════════════════════════════════════════════════
alter table public.mission_incident_info_requests
  add column if not exists respond_by timestamptz;

-- Demande de complément d'un dossier d'interruption : 72 h.
create or replace function public.interruption_request_due()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.mission_incidents i
             where i.id = new.incident_id and i.kind = 'interruption') then
    new.respond_by := new.created_at + interval '72 hours';
  end if;
  return new;
end;
$$;
revoke all on function public.interruption_request_due() from public, anon, authenticated;
drop trigger if exists trg_interruption_request_due on public.mission_incident_info_requests;
create trigger trg_interruption_request_due
  before insert on public.mission_incident_info_requests
  for each row execute function public.interruption_request_due();

-- Réponse à une demande après son échéance : refusée.
create or replace function public.interruption_answer_deadline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due timestamptz;
begin
  if new.info_request_id is not null then
    select r.respond_by into v_due from public.mission_incident_info_requests r
    where r.id = new.info_request_id;
    if v_due is not null and not public.interruption_deadline_open(v_due, now()) then
      raise exception 'response_deadline_passed';
    end if;
    -- Dossier d'interruption clos : plus de réponse d'instruction (un
    -- nouvel élément reste recevable comme déclaration libre).
    if v_due is not null and not public.incident_instruction_open(new.incident_id) then
      raise exception 'incident_closed';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.interruption_answer_deadline() from public, anon, authenticated;
drop trigger if exists trg_interruption_answer_deadline on public.mission_incident_statements;
create trigger trg_interruption_answer_deadline
  before insert on public.mission_incident_statements
  for each row execute function public.interruption_answer_deadline();

-- Double validation du lot 16 refusée sur une interruption (décision du
-- fondateur seul) ; les autres natures sont inchangées.
create or replace function public.interruption_no_dispute_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.mission_incidents i
             where i.id = new.incident_id and i.kind = 'interruption') then
    raise exception 'use_founder_decision';
  end if;
  return new;
end;
$$;
revoke all on function public.interruption_no_dispute_proposal() from public, anon, authenticated;
drop trigger if exists trg_interruption_no_dispute_proposal on public.mission_incident_proposals;
create trigger trg_interruption_no_dispute_proposal
  before insert on public.mission_incident_proposals
  for each row execute function public.interruption_no_dispute_proposal();

-- ════════════════════════════════════════════════════════════════════
-- 5 bis. État courant de l'instruction (une seule lecture pour toutes les
--        routes)
-- ════════════════════════════════════════════════════════════════════
-- Interruption : instruction ouverte tant qu'aucune clôture n'est en
-- vigueur (un dossier rouvert par réexamen l'est de nouveau ; la première
-- décision reste figée dans mission_incidents et l'historique). Autres
-- natures : règle des lots 14 à 16 (statut ouvert ou répondu), inchangée.
create or replace function public.incident_instruction_open(p_incident_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when i.kind = 'interruption'
              then not exists (select 1 from public.mission_interruption_closures c
                               where c.incident_id = i.id)
              else i.status in ('open', 'answered') end
  from public.mission_incidents i where i.id = p_incident_id;
$$;
revoke all on function public.incident_instruction_open(uuid) from public, anon, authenticated;

-- Contacts du support (reprise de 20261120120000) : seule la condition
-- d'ouverture change (état courant au lieu du statut générique).
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

  -- État courant du dossier (interruption rouverte comprise).
  if not public.incident_instruction_open(v_incident.id) then
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

-- Qualification de la situation (reprise de 20261120120000) : même
-- changement.
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
  -- État courant du dossier (interruption rouverte comprise).
  if not public.incident_instruction_open(v_inc.id) then
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

-- ════════════════════════════════════════════════════════════════════
-- 6. État d'un dossier (calculé à l'instant donné, heure de la base)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.interruption_current_proposal(p_incident_id uuid)
returns public.mission_interruption_proposals
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.mission_interruption_proposals p
  where p.incident_id = p_incident_id and p.superseded_at is null;
$$;
revoke all on function public.interruption_current_proposal(uuid) from public, anon, authenticated;

-- open : dans les 48 h ; accepted : deux acceptations dans le délai (non
-- annulées par l'échéance) ; refused : un refus ; expired : délai passé
-- sans deux acceptations ; superseded : remplacée par une nouvelle version.
create or replace function public.interruption_proposal_status(
  p public.mission_interruption_proposals, p_at timestamptz)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.id is null then null
    when p.superseded_at is not null then 'superseded'
    when exists (select 1 from public.mission_interruption_responses r
                 where r.proposal_id = p.id and r.decision = 'refuse') then 'refused'
    when (select count(*) from public.mission_interruption_responses r
          where r.proposal_id = p.id and r.decision = 'accept'
            and r.responded_at <= p.respond_by) = 2 then 'accepted'
    when not public.interruption_deadline_open(p.respond_by, p_at) then 'expired'
    else 'open' end;
$$;
revoke all on function public.interruption_proposal_status(public.mission_interruption_proposals, timestamptz) from public, anon, authenticated;

-- Étapes : closed, agreement (accord valide en attente du code),
-- awaiting_parties (proposition ouverte), instruction (une demande adressée
-- à une partie court encore), founder_review (examen du fondateur,
-- échéance = fin de la dernière étape + 72 h ou prolongation).
create or replace function public.interruption_state(p_incident_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  i public.mission_incidents;
  c public.mission_interruption_closures;
  p public.mission_interruption_proposals;
  v_pstatus text;
  v_other text;
  v_version_due timestamptz;
  v_version_at timestamptz;
  v_next timestamptz;
  v_req timestamptz;
  v_start timestamptz;
  v_due timestamptz;
  v_ext timestamptz;
begin
  select x.* into i from public.mission_incidents x
  where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    return null;
  end if;
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  p := public.interruption_current_proposal(i.id);
  v_pstatus := public.interruption_proposal_status(p, p_at);
  v_other := case when i.reported_by_party = 'candidate' then 'company' else 'candidate' end;
  v_version_due := i.created_at + interval '72 hours';
  select v.created_at into v_version_at from public.mission_interruption_versions v
  where v.incident_id = i.id and v.party = v_other;

  if c.id is not null then
    return jsonb_build_object('stage', 'closed', 'outcome', c.outcome, 'due_at', null,
      'overdue', false, 'proposal_status', v_pstatus, 'version_due_at', v_version_due);
  end if;
  if v_pstatus = 'accepted' then
    return jsonb_build_object('stage', 'agreement', 'due_at', null, 'overdue', false,
      'proposal_status', v_pstatus, 'version_due_at', v_version_due);
  end if;
  if v_pstatus = 'open' then
    return jsonb_build_object('stage', 'awaiting_parties', 'due_at', p.respond_by,
      'overdue', false, 'proposal_status', v_pstatus, 'version_due_at', v_version_due);
  end if;

  if v_version_at is null and public.interruption_deadline_open(v_version_due, p_at) then
    v_next := v_version_due;
  end if;
  select min(r.respond_by) into v_req from public.mission_incident_info_requests r
  where r.incident_id = i.id and r.respond_by is not null and r.answered_at is null
    and public.interruption_deadline_open(r.respond_by, p_at);
  if v_req is not null then
    v_next := least(coalesce(v_next, v_req), v_req);
  end if;
  if v_next is not null then
    return jsonb_build_object('stage', 'instruction', 'due_at', v_next, 'overdue', false,
      'proposal_status', v_pstatus, 'version_due_at', v_version_due);
  end if;

  -- Examen du fondateur : à partir de la fin de la dernière étape (réponse
  -- ou échéance de chaque demande, refus ou expiration d'une proposition).
  v_start := greatest(
    coalesce(v_version_at, v_version_due),
    (select max(coalesce(r.answered_at, r.respond_by)) from public.mission_incident_info_requests r
     where r.incident_id = i.id and r.respond_by is not null),
    case v_pstatus
      when 'refused' then (select max(r.responded_at) from public.mission_interruption_responses r
                           where r.proposal_id = p.id and r.decision = 'refuse')
      when 'expired' then p.respond_by end,
    (select max(h.revoked_at) from public.mission_interruption_closure_history h
     where h.incident_id = i.id));
  v_due := v_start + interval '72 hours';
  -- Prolongation rattachée à cette échéance seulement (jamais remise à
  -- zéro par une nouvelle étape).
  select e.ends_at into v_ext from public.mission_interruption_extensions e
  where e.incident_id = i.id and e.extends_due = v_due;
  if v_ext is not null and v_ext > v_due then
    v_due := v_ext;
  end if;
  return jsonb_build_object('stage', 'founder_review', 'review_since', v_start,
    'due_at', v_due, 'overdue', not public.interruption_deadline_open(v_due, p_at),
    'extended', v_ext is not null, 'proposal_status', v_pstatus,
    'version_due_at', v_version_due);
end;
$$;
revoke all on function public.interruption_state(uuid, timestamptz) from public, anon, authenticated;

-- Accord valide d'une journée (deux acceptations de la version courante,
-- dossier non clos), sinon une ligne vide.
create or replace function public.interruption_agreement(p_day_id uuid)
returns public.mission_interruption_proposals
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.mission_interruption_proposals;
  v_incident uuid;
begin
  select i.id into v_incident from public.mission_incidents i
  where i.mission_day_id = p_day_id and i.kind = 'interruption'
    and not exists (select 1 from public.mission_interruption_closures c where c.incident_id = i.id);
  if v_incident is null then
    return p;
  end if;
  p := public.interruption_current_proposal(v_incident);
  if public.interruption_proposal_status(p, now()) is distinct from 'accepted' then
    p := null;
  end if;
  return p;
end;
$$;
revoke all on function public.interruption_agreement(uuid) from public, anon, authenticated;

-- Dossier non clos, ou clos « désaccord non résolu » : aucune autre
-- confirmation de la journée.
create or replace function public.interruption_blocks_completion(p_day_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mission_incidents i
    left join public.mission_interruption_closures c on c.incident_id = i.id
    where i.mission_day_id = p_day_id and i.kind = 'interruption'
      and (c.id is null or c.outcome = 'disagreement'));
$$;
revoke all on function public.interruption_blocks_completion(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 7. Avis dans l'application (une étape une fois par destinataire)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.interruption_fmt(p_at timestamptz, p_locale text)
returns text
language sql
stable
set search_path = ''
as $$
  select case when p_locale = 'en'
    then to_char(p_at at time zone 'Africa/Douala', 'YYYY-MM-DD HH24:MI') || ' (Douala time)'
    else to_char(p_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI') || ' (heure de Douala)' end;
$$;
revoke all on function public.interruption_fmt(timestamptz, text) from public, anon, authenticated;

-- Crée l'avis puis la notification ; aucun doublon (index unique). Les
-- textes portent {due} remplacé par l'échéance dans la langue du
-- destinataire. Renvoie true si l'avis vient d'être créé.
create or replace function public.interruption_notify(
  p_incident_id uuid, p_kind text, p_ref text, p_user uuid, p_role text,
  p_title_fr text, p_title_en text, p_body_fr text, p_body_en text,
  p_due timestamptz default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice uuid;
  v_notif uuid;
  v_locale text;
  i public.mission_incidents;
begin
  if p_user is null then
    return false;
  end if;
  insert into public.mission_interruption_notices (incident_id, kind, ref, recipient_id, recipient_role)
  values (p_incident_id, p_kind, p_ref, p_user, p_role)
  on conflict (incident_id, kind, ref, recipient_id) do nothing
  returning id into v_notice;
  if v_notice is null then
    return false;
  end if;
  select x.* into i from public.mission_incidents x where x.id = p_incident_id;
  select coalesce(u.locale::text, 'fr') into v_locale from public.users u where u.id = p_user;
  insert into public.notifications (user_id, notification_type, title, body, data)
  values (p_user, 'mission_update',
    case when v_locale = 'en' then p_title_en else p_title_fr end,
    replace(case when v_locale = 'en' then p_body_en else p_body_fr end, '{due}',
            coalesce(public.interruption_fmt(p_due, v_locale), '')),
    jsonb_build_object('kind', 'mission_interruption', 'notice', p_kind,
      'incident_id', p_incident_id, 'mission_id', i.mission_id, 'mission_day_id', i.mission_day_id,
      'href', case p_role when 'candidate' then '/missions/' || i.mission_id
                          when 'company' then '/company/jobs/' || i.job_id
                          else '/admin/incidents' end))
  returning id into v_notif;
  update public.mission_interruption_notices n set notification_id = v_notif where n.id = v_notice;
  return true;
end;
$$;
revoke all on function public.interruption_notify(uuid, text, text, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- Les deux parties (candidat, entreprise).
create or replace function public.interruption_notify_parties(
  p_incident_id uuid, p_kind text, p_ref text,
  p_title_fr text, p_title_en text, p_body_fr text, p_body_en text,
  p_due timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[] := public.mission_incident_parties(p_incident_id);
begin
  perform public.interruption_notify(p_incident_id, p_kind, p_ref, v_users[1], 'candidate',
    p_title_fr, p_title_en, p_body_fr, p_body_en, p_due);
  perform public.interruption_notify(p_incident_id, p_kind, p_ref, v_users[2], 'company',
    p_title_fr, p_title_en, p_body_fr, p_body_en, p_due);
end;
$$;
revoke all on function public.interruption_notify_parties(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- Fondateurs actifs.
create or replace function public.interruption_notify_founders(
  p_incident_id uuid, p_kind text, p_ref text,
  p_title_fr text, p_title_en text, p_body_fr text, p_body_en text,
  p_due timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_count integer := 0;
begin
  for v_user in select u.id from public.users u
                where u.role::text = 'admin_founder' and u.is_active is not false
  loop
    if public.interruption_notify(p_incident_id, p_kind, p_ref, v_user, 'founder',
         p_title_fr, p_title_en, p_body_fr, p_body_en, p_due) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.interruption_notify_founders(uuid, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 8. Garde des confirmations contradictoires
-- ════════════════════════════════════════════════════════════════════
create or replace function public.guard_day_completion_conflicts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.completion_source is not distinct from old.completion_source
     or new.completion_source is null then
    return new;
  end if;
  if new.completion_source in ('partial', 'partial_support') then
    if (public.interruption_agreement(new.id)).id is null then
      raise exception 'settlement_not_accepted';
    end if;
    return new;
  end if;
  -- Code normal, confirmation du support ou décision exceptionnelle :
  -- jamais pendant une interruption non close ou un désaccord non résolu.
  if public.interruption_blocks_completion(new.id) then
    raise exception 'interruption_pending';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_day_completion_conflicts() from public, anon, authenticated;
drop trigger if exists trg_guard_day_completion_conflicts on public.mission_days;
create trigger trg_guard_day_completion_conflicts
  before update on public.mission_days
  for each row execute function public.guard_day_completion_conflicts();

-- ════════════════════════════════════════════════════════════════════
-- 9. Signalement d'une interruption et version de l'autre partie
-- ════════════════════════════════════════════════════════════════════
create or replace function public.report_mission_interruption(
  p_mission_id uuid,
  p_mission_day_id uuid,
  p_cause text,
  p_declared_at timestamptz,
  p_work_done text,
  p_reason text
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
  v_work text := btrim(coalesce(p_work_done, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_users uuid[];
  v_other text;
begin
  v_party := public.mission_incident_party(v_uid, p_mission_id);
  if p_cause is null or p_cause not in ('candidate_left', 'company_stopped') then
    raise exception 'interruption_cause_invalid';
  end if;
  if length(v_work) < 10 or length(v_work) > 2000 then
    raise exception 'work_done_invalid';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'statement_invalid';
  end if;

  -- Verrous dans l'ordre de submit_completion_code : mission, journée, dossier.
  select m.* into v_mission from public.missions m where m.id = p_mission_id for update;
  select d.* into v_day from public.mission_days d
  where d.id = p_mission_day_id and d.mission_id = p_mission_id for update;
  if not found then
    raise exception 'mission_not_found';
  end if;

  select i.* into v_existing from public.mission_incidents i
  where i.mission_day_id = v_day.id and i.kind = 'interruption' for update;
  if found then
    -- Dossier clos ou version déjà donnée : rien n'est rouvert ni réécrit.
    if exists (select 1 from public.mission_interruption_closures c where c.incident_id = v_existing.id)
       or exists (select 1 from public.mission_interruption_versions v
                  where v.incident_id = v_existing.id and v.party = v_party) then
      return query select v_existing.id, v_existing.status, true;
      return;
    end if;
    -- Version de l'autre partie : 72 h après l'ouverture, échéance incluse.
    if not public.interruption_deadline_open(v_existing.created_at + interval '72 hours', now()) then
      raise exception 'response_deadline_passed';
    end if;
    if p_declared_at is null or p_declared_at < coalesce(v_day.actual_start_time, v_day.starts_at)
       or p_declared_at > now() then
      raise exception 'declared_time_invalid';
    end if;
    insert into public.mission_interruption_versions (incident_id, party, author_id, cause,
                                                      declared_at, work_done, reason)
    values (v_existing.id, v_party, v_uid, p_cause, p_declared_at, v_work, v_reason);
    insert into public.mission_incident_statements (incident_id, party, author_id, body)
    values (v_existing.id, v_party, v_uid, v_reason);
    update public.mission_incidents i
    set status = case when i.status = 'open' then 'answered' else i.status end, updated_at = now()
    where i.id = v_existing.id;
    v_users := public.mission_incident_parties(v_existing.id);
    perform public.incident_notify(v_users[case when v_party = 'candidate' then 2 else 1 end],
      'Version reçue sur une interruption', 'Version received on an interruption',
      'L''autre partie a donné sa version. Le dossier est instruit par le support.',
      'The other party gave its version. Support is reviewing the file.',
      jsonb_build_object('kind', 'mission_interruption', 'incident_id', v_existing.id,
        'mission_id', v_existing.mission_id));
    return query select v_existing.id, v_existing.status, false;
    return;
  end if;

  if coalesce(v_mission.status::text, 'pending') in ('cancelled', 'no_show') then
    raise exception 'mission_not_active';
  end if;
  if v_day.actual_start_time is null then
    raise exception 'start_not_confirmed';
  end if;
  if v_day.actual_end_time is not null then
    raise exception 'day_already_confirmed';
  end if;
  if p_declared_at is null or p_declared_at < v_day.actual_start_time or p_declared_at > now() then
    raise exception 'declared_time_invalid';
  end if;

  select j.* into v_job from public.jobs j where j.id = v_mission.job_id;
  insert into public.mission_incidents (
    mission_id, mission_day_id, job_id, candidate_id, company_id, kind,
    reported_by_party, reported_by, interruption_cause, interruption_declared_at, work_done
  ) values (
    v_mission.id, v_day.id, v_job.id, v_mission.candidate_id, v_job.company_id, 'interruption',
    v_party, v_uid, p_cause, p_declared_at, v_work
  )
  returning id into v_id;
  insert into public.mission_interruption_versions (incident_id, party, author_id, cause,
                                                    declared_at, work_done, reason)
  values (v_id, v_party, v_uid, p_cause, p_declared_at, v_work, v_reason);
  insert into public.mission_incident_statements (incident_id, party, author_id, body)
  values (v_id, v_party, v_uid, v_reason);

  v_users := public.mission_incident_parties(v_id);
  v_other := case when v_party = 'candidate' then 'company' else 'candidate' end;
  perform public.interruption_notify(v_id, 'version_request', 'version',
    v_users[case when v_party = 'candidate' then 2 else 1 end], v_other,
    'Interruption signalée : votre version est demandée', 'Interruption reported: your version is requested',
    'Une interruption est signalée pour « ' || v_job.title || ' » le '
      || to_char(v_day.scheduled_date, 'DD/MM/YYYY') || '. Donnez votre version avant le {due}.',
    'An interruption was reported for "' || v_job.title || '" on '
      || to_char(v_day.scheduled_date, 'YYYY-MM-DD') || '. Give your version before {due}.',
    now() + interval '72 hours');
  perform public.incident_event(v_id, 'opened', 'party', v_uid, jsonb_build_object('party', v_party));
  perform public.incident_event(v_id, 'party_notified', 'party', null,
    jsonb_build_object('party', v_other, 'channel', 'in_app'));
  return query select v_id, 'open'::text, false;
end;
$$;
revoke all on function public.report_mission_interruption(uuid, uuid, text, timestamptz, text, text) from public, anon;
grant execute on function public.report_mission_interruption(uuid, uuid, text, timestamptz, text, text) to authenticated;

-- Décision générique (reprise de 20261120120000) : une interruption se
-- décide par le fondateur seul.
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
  -- Interruption : décision du fondateur seul (parcours dédié).
  if v_incident.kind = 'interruption' then
    raise exception 'use_founder_decision';
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

-- Demande de complément (reprise de 20261120120000) : tout admin actif ;
-- pour une interruption, échéance de 72 h annoncée et avis enregistré ;
-- refusée sur un dossier d'interruption clos.
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
  v_due timestamptz;
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
  if v_inc.status = 'closed'
     or (v_inc.kind = 'interruption' and not public.incident_instruction_open(v_inc.id)) then
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
  returning id, respond_by into v_id, v_due;
  perform public.incident_event(v_inc.id, 'info_requested', 'party', v_uid,
    jsonb_build_object('party', p_party, 'request_id', v_id));
  v_parties := public.mission_incident_parties(v_inc.id);
  select j.title into v_title from public.jobs j where j.id = v_inc.job_id;
  if v_inc.kind = 'interruption' then
    perform public.interruption_notify(v_inc.id, 'info_request', v_id::text,
      v_parties[case when p_party = 'candidate' then 1 else 2 end], p_party,
      'Le support demande un justificatif', 'Support requests supporting information',
      'Le support vous pose une question sur l''interruption de « ' || v_title
        || ' ». Répondez ou joignez une pièce avant le {due}.',
      'Support has a question about the interruption on "' || v_title
        || '". Answer or attach a document before {due}.',
      v_due);
  else
    perform public.incident_notify(
      v_parties[case when p_party = 'candidate' then 1 else 2 end],
      'Le support demande un complément', 'Support requests more information',
      'Le support vous pose une question sur le signalement de « ' || v_title || ' ».',
      'Support has a question about the report on "' || v_title || '".',
      jsonb_build_object('kind', 'mission_incident_info', 'incident_id', v_inc.id,
        'request_id', v_id, 'mission_id', v_inc.mission_id,
        'href', case when p_party = 'candidate' then '/missions/' || v_inc.mission_id
                     else '/company/jobs/' || v_inc.job_id end));
  end if;
  return query select v_id, false;
end;
$$;
revoke all on function public.admin_request_incident_info(uuid, text, text) from public, anon;
grant execute on function public.admin_request_incident_info(uuid, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. Fondateur : proposition, clôture, prolongation, finalisation
-- ════════════════════════════════════════════════════════════════════
-- Verrous communs : mission, journée, dossier (ordre de la réalisation).
create or replace function public.interruption_lock(p_incident_id uuid)
returns public.mission_incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.mission_incidents;
begin
  select x.* into i from public.mission_incidents x where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    raise exception 'incident_not_found';
  end if;
  perform 1 from public.missions m where m.id = i.mission_id for update;
  perform 1 from public.mission_days d where d.id = i.mission_day_id for update;
  select x.* into i from public.mission_incidents x where x.id = p_incident_id for update;
  return i;
end;
$$;
revoke all on function public.interruption_lock(uuid) from public, anon, authenticated;

create or replace function public.admin_propose_interruption_amount(
  p_incident_id uuid, p_amount integer, p_motivation text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mot text := btrim(coalesce(p_motivation, ''));
  v_policy jsonb := public.partial_settlement_policy();
  i public.mission_incidents;
  v_state jsonb;
  p public.mission_interruption_proposals;
  v_new public.mission_interruption_proposals;
  v_day public.mission_days;
  v_cap integer;
begin
  if not public.is_founder_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_mot) < 10 or length(v_mot) > 2000 then
    raise exception 'motivation_invalid';
  end if;
  -- Bornes validées seulement (sinon aucune proposition).
  if coalesce((v_policy ->> 'validated')::boolean, false) is not true then
    raise exception 'settlement_rule_pending';
  end if;
  if p_amount is null or p_amount < (v_policy ->> 'min_amount')::integer then
    raise exception 'amount_invalid';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'settlement_changed';
  end if;

  i := public.interruption_lock(p_incident_id);
  select d.* into v_day from public.mission_days d where d.id = i.mission_day_id;
  -- Plafond lu dans le contrat figé (jamais dans l'offre).
  v_cap := public.interruption_settlement_cap(i.mission_day_id);
  if v_cap is null then
    raise exception 'settlement_cap_unavailable';
  end if;
  if p_amount > v_cap then
    raise exception 'amount_above_cap';
  end if;
  v_policy := v_policy || jsonb_build_object('cap', v_cap);
  p := public.interruption_current_proposal(i.id);
  -- Double envoi : la même version déjà enregistrée par ce fondateur.
  if p.id is not null and p.version = p_expected_version + 1 and p.amount = p_amount
     and p.motivation = v_mot and p.proposed_by = v_uid then
    return jsonb_build_object('proposal_id', p.id, 'version', p.version, 'respond_by', p.respond_by,
                              'already_recorded', true);
  end if;
  v_state := public.interruption_state(i.id, now());
  if v_state ->> 'stage' = 'closed' then
    raise exception 'incident_closed';
  elsif v_state ->> 'stage' = 'agreement' then
    raise exception 'settlement_accepted';
  elsif v_state ->> 'stage' = 'instruction' then
    raise exception 'instruction_pending';
  end if;
  if v_day.actual_end_time is not null then
    raise exception 'day_already_confirmed';
  end if;
  if coalesce(p.version, 0) <> p_expected_version then
    raise exception 'settlement_changed';
  end if;

  if p.id is not null then
    update public.mission_interruption_proposals x set superseded_at = now() where x.id = p.id;
  end if;
  insert into public.mission_interruption_proposals (incident_id, mission_day_id, mission_id,
    version, amount, motivation, policy, proposed_by, proposed_by_role, proposed_at, respond_by)
  values (i.id, i.mission_day_id, i.mission_id, coalesce(p.version, 0) + 1, p_amount, v_mot,
    v_policy, v_uid, 'admin_founder', now(), now() + interval '48 hours')
  returning * into v_new;
  update public.mission_incidents x set status = 'answered', updated_at = now()
  where x.id = i.id and x.status = 'open';
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, 'admin_founder', 'propose_interruption_amount', 'mission_incidents', i.id,
          jsonb_build_object('proposal_id', v_new.id, 'version', v_new.version,
                             'amount', p_amount, 'previous_version', p.version));
  perform public.interruption_notify_parties(i.id, 'proposal', v_new.id::text,
    'Montant proposé pour la journée interrompue', 'Amount proposed for the interrupted day',
    'Le fondateur propose ' || p_amount || ' XAF (version ' || v_new.version
      || '). Acceptez ou refusez avant le {due}. Sans réponse, la proposition expire.',
    'The founder proposes ' || p_amount || ' XAF (version ' || v_new.version
      || '). Accept or refuse before {due}. Without an answer, the proposal expires.',
    v_new.respond_by);
  return jsonb_build_object('proposal_id', v_new.id, 'version', v_new.version,
                            'respond_by', v_new.respond_by, 'already_recorded', false);
end;
$$;
revoke all on function public.admin_propose_interruption_amount(uuid, integer, text, integer) from public, anon;
grant execute on function public.admin_propose_interruption_amount(uuid, integer, text, integer) to authenticated;

create or replace function public.admin_close_interruption(
  p_incident_id uuid, p_outcome text, p_motivation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mot text := btrim(coalesce(p_motivation, ''));
  i public.mission_incidents;
  c public.mission_interruption_closures;
  v_state jsonb;
begin
  if not public.is_founder_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('not_established', 'disagreement') then
    raise exception 'closure_outcome_invalid';
  end if;
  if length(v_mot) < 10 or length(v_mot) > 2000 then
    raise exception 'motivation_invalid';
  end if;
  i := public.interruption_lock(p_incident_id);
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  if c.id is not null then
    if c.outcome = p_outcome and c.motivation = v_mot then
      return jsonb_build_object('outcome', c.outcome, 'already_recorded', true);
    end if;
    raise exception 'incident_closed';
  end if;
  v_state := public.interruption_state(i.id, now());
  if v_state ->> 'stage' = 'agreement' then
    raise exception 'settlement_accepted';
  elsif v_state ->> 'stage' = 'awaiting_parties' then
    raise exception 'proposal_open';
  elsif v_state ->> 'stage' = 'instruction' then
    raise exception 'instruction_pending';
  end if;
  insert into public.mission_interruption_closures (incident_id, outcome, motivation,
                                                    decided_by, decided_by_role)
  values (i.id, p_outcome, v_mot, v_uid, 'admin_founder');
  -- Statut générique du signalement : première décision seulement (le
  -- lot 14 le fige ensuite) ; l'état courant est porté par les clôtures.
  update public.mission_incidents x
  set status = 'decided', outcome = p_outcome, decision_note = v_mot,
      decided_by = v_uid, decided_at = now(), updated_at = now()
  where x.id = i.id and x.status <> 'decided';
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, 'admin_founder', 'close_interruption', 'mission_incidents', i.id,
          jsonb_build_object('outcome', p_outcome, 'stage', v_state ->> 'stage',
                             'overdue', v_state -> 'overdue'));
  perform public.incident_event(i.id, 'decision_recorded', 'party', v_uid,
    jsonb_build_object('outcome', p_outcome, 'kind', 'founder'));
  perform public.interruption_notify_parties(i.id, 'closure', 'closure',
    'Décision sur la journée interrompue', 'Decision on the interrupted day',
    case p_outcome when 'not_established'
      then 'Interruption non établie : la journée reprend son parcours normal (code à la fin prévue).'
      else 'Désaccord non résolu : aucun montant définitif n''est fixé. Ce n''est ni un renoncement à rémunération, ni un remboursement, ni une sanction.' end,
    case p_outcome when 'not_established'
      then 'Interruption not established: the day returns to its normal path (code at the scheduled end).'
      else 'Unresolved disagreement: no final amount is set. This is neither a waiver of pay, nor a refund, nor a sanction.' end);
  return jsonb_build_object('outcome', p_outcome, 'already_recorded', false);
end;
$$;
revoke all on function public.admin_close_interruption(uuid, text, text) from public, anon;
grant execute on function public.admin_close_interruption(uuid, text, text) to authenticated;

-- Prolongation exceptionnelle : une seule par dossier, pendant l'examen du
-- fondateur, rattachée à l'échéance en cours, date de fin explicite de 7
-- jours au plus après elle, motif obligatoire ; jamais renouvelée par une
-- nouvelle version, une relance ou une réouverture.
create or replace function public.admin_extend_interruption_review(
  p_incident_id uuid, p_ends_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  i public.mission_incidents;
  v_state jsonb;
  e public.mission_interruption_extensions;
  v_due timestamptz;
begin
  if not public.is_founder_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_reason) < 10 or length(v_reason) > 1000 then
    raise exception 'note_invalid';
  end if;
  i := public.interruption_lock(p_incident_id);
  select x.* into e from public.mission_interruption_extensions x where x.incident_id = i.id;
  if e.id is not null then
    if e.ends_at = p_ends_at and e.reason = v_reason then
      return public.interruption_state(i.id, now()) || jsonb_build_object('already_recorded', true);
    end if;
    raise exception 'extension_already_used';
  end if;
  v_state := public.interruption_state(i.id, now());
  if v_state ->> 'stage' <> 'founder_review' then
    raise exception 'review_not_open';
  end if;
  v_due := (v_state ->> 'due_at')::timestamptz;
  if p_ends_at is null or p_ends_at <= v_due or p_ends_at > v_due + interval '7 days' then
    raise exception 'extension_date_invalid';
  end if;
  insert into public.mission_interruption_extensions (incident_id, extends_due, ends_at, reason, created_by)
  values (i.id, v_due, p_ends_at, v_reason, v_uid);
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, 'admin_founder', 'extend_interruption_review', 'mission_incidents', i.id,
          jsonb_build_object('ends_at', p_ends_at, 'extends_due', v_due));
  perform public.interruption_notify_parties(i.id, 'review_extended', p_ends_at::text,
    'Examen prolongé', 'Review extended',
    'L''examen du dossier par le fondateur est prolongé jusqu''au {due}.',
    'The founder''s review of the file is extended until {due}.',
    p_ends_at);
  return public.interruption_state(i.id, now()) || jsonb_build_object('already_recorded', false);
end;
$$;
revoke all on function public.admin_extend_interruption_review(uuid, timestamptz, text) from public, anon;
grant execute on function public.admin_extend_interruption_review(uuid, timestamptz, text) to authenticated;

-- Code non remis après l'accord : finalisation manuelle par le fondateur,
-- après un recours d'une partie, au montant accepté.
create or replace function public.admin_finalize_interruption(
  p_incident_id uuid, p_version integer, p_motivation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mot text := btrim(coalesce(p_motivation, ''));
  i public.mission_incidents;
  c public.mission_interruption_closures;
  p public.mission_interruption_proposals;
  v_mission public.missions;
  v_app public.application_status;
  v_done boolean;
begin
  if not public.is_founder_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if length(v_mot) < 10 or length(v_mot) > 2000 then
    raise exception 'motivation_invalid';
  end if;
  i := public.interruption_lock(p_incident_id);
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  if c.id is not null then
    if c.outcome = 'settled' then
      return jsonb_build_object('amount', c.amount, 'completion_source', c.completion_source,
                                'already_recorded', true);
    end if;
    raise exception 'incident_closed';
  end if;
  p := public.interruption_agreement(i.mission_day_id);
  if p.id is null then
    raise exception 'settlement_not_accepted';
  end if;
  if p_version is distinct from p.version then
    raise exception 'settlement_changed';
  end if;
  if not exists (select 1 from public.mission_interruption_recourses r where r.proposal_id = p.id) then
    raise exception 'recourse_required';
  end if;
  select m.* into v_mission from public.missions m where m.id = i.mission_id;
  select a.status into v_app from public.job_applications a where a.id = v_mission.application_id;
  if v_mission.status in ('cancelled', 'no_show', 'disputed') or v_app is distinct from 'selected' then
    raise exception 'mission_not_active';
  end if;
  if exists (select 1 from public.mission_days d where d.id = i.mission_day_id
             and d.actual_end_time is not null) then
    raise exception 'day_already_confirmed';
  end if;

  update public.mission_days d set actual_end_time = now(), completion_source = 'partial_support'
  where d.id = i.mission_day_id;
  insert into public.mission_interruption_closures (incident_id, outcome, motivation, proposal_id,
    amount, completion_source, decided_by, decided_by_role)
  values (i.id, 'settled', v_mot, p.id, p.amount, 'partial_support', v_uid, 'admin_founder');
  -- Statut générique du signalement : première décision seulement (le
  -- lot 14 le fige ensuite) ; l'état courant est porté par les clôtures.
  update public.mission_incidents x
  set status = 'decided', outcome = 'partial', decision_note = v_mot,
      decided_by = v_uid, decided_at = now(), updated_at = now()
  where x.id = i.id and x.status <> 'decided';
  v_done := not exists (select 1 from public.mission_days d
                        where d.mission_id = i.mission_id and d.actual_end_time is null);
  if v_done then
    update public.missions m set actual_end_time = now(), status = 'completed' where m.id = i.mission_id;
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, 'admin_founder', 'finalize_interruption', 'mission_incidents', i.id,
          jsonb_build_object('proposal_id', p.id, 'version', p.version, 'amount', p.amount,
                             'completion_source', 'partial_support', 'mission_completed', v_done));
  perform public.interruption_notify_parties(i.id, 'finalized', p.id::text,
    'Accord partiel finalisé par le support', 'Partial agreement finalised by support',
    'Le code n''ayant pas été remis, le fondateur a finalisé l''accord accepté par les deux parties : '
      || p.amount || ' XAF. Aucun versement n''est déclenché par l''application.',
    'As the code was not handed over, the founder finalised the agreement accepted by both parties: '
      || p.amount || ' XAF. The app triggers no payment.');
  return jsonb_build_object('amount', p.amount, 'completion_source', 'partial_support',
                            'mission_completed', v_done, 'already_recorded', false);
end;
$$;
revoke all on function public.admin_finalize_interruption(uuid, integer, text) from public, anon;
grant execute on function public.admin_finalize_interruption(uuid, integer, text) to authenticated;

-- Réexamen (décision du 2026-11-21) : une partie signale une erreur dans
-- une décision du fondateur (clôture en vigueur), avec un motif. La demande
-- ne change aucun état, aucun blocage ni aucun délai.
create or replace function public.request_interruption_reexamination(
  p_incident_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_party text;
  v_reason text := btrim(coalesce(p_reason, ''));
  i public.mission_incidents;
  c public.mission_interruption_closures;
  r public.mission_interruption_reexaminations;
begin
  if length(v_reason) < 10 or length(v_reason) > 2000 then
    raise exception 'motivation_invalid';
  end if;
  select x.* into i from public.mission_incidents x where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    raise exception 'incident_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(v_uid, i.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;
  i := public.interruption_lock(p_incident_id);
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  if c.id is null then
    raise exception 'no_decision';
  end if;
  select x.* into r from public.mission_interruption_reexaminations x
  where x.closure_id = c.id and x.party = v_party and x.decided_at is null;
  if r.id is not null then
    return jsonb_build_object('reexamination_id', r.id, 'already_recorded', true);
  end if;
  insert into public.mission_interruption_reexaminations (incident_id, closure_id, closure_outcome,
                                                          party, author_id, reason)
  values (i.id, c.id, c.outcome, v_party, v_uid, v_reason)
  returning * into r;
  perform public.interruption_notify_founders(i.id, 'reexam_request', r.id::text,
    'Réexamen demandé', 'Re-examination requested',
    'Une partie signale une erreur dans votre décision sur une interruption et demande un réexamen motivé.',
    'A party reports an error in your decision on an interruption and asks for a reasoned re-examination.');
  return jsonb_build_object('reexamination_id', r.id, 'already_recorded', false);
end;
$$;
revoke all on function public.request_interruption_reexamination(uuid, text) from public, anon;
grant execute on function public.request_interruption_reexamination(uuid, text) to authenticated;

-- Décision du fondateur seul : maintenue ; rouverte (clôture « non
-- établie » ou « désaccord » sur une journée non confirmée : la décision
-- passe à l'historique, le dossier revient à l'examen du fondateur) ; ou
-- traitement distinct (revenir sur un accord accepté, une réalisation ou
-- un règlement finalisés : rien n'est modifié ici).
create or replace function public.admin_decide_interruption_reexamination(
  p_reexamination_id uuid, p_decision text, p_motivation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mot text := btrim(coalesce(p_motivation, ''));
  r public.mission_interruption_reexaminations;
  i public.mission_incidents;
  c public.mission_interruption_closures;
  v_confirmed boolean;
begin
  if not public.is_founder_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('maintained', 'reopened', 'separate_handling') then
    raise exception 'decision_invalid';
  end if;
  if length(v_mot) < 10 or length(v_mot) > 2000 then
    raise exception 'motivation_invalid';
  end if;
  select x.* into r from public.mission_interruption_reexaminations x where x.id = p_reexamination_id;
  if r.id is null then
    raise exception 'reexamination_not_found';
  end if;
  i := public.interruption_lock(r.incident_id);
  select x.* into r from public.mission_interruption_reexaminations x where x.id = p_reexamination_id for update;
  if r.decided_at is not null then
    if r.decision = p_decision and r.decision_motivation = v_mot then
      return jsonb_build_object('decision', r.decision, 'already_recorded', true);
    end if;
    raise exception 'reexamination_decided';
  end if;
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  if c.id is distinct from r.closure_id then
    raise exception 'reexamination_obsolete';
  end if;
  select d.actual_end_time is not null into v_confirmed from public.mission_days d where d.id = i.mission_day_id;
  if p_decision = 'reopened' and (c.outcome = 'settled' or v_confirmed) then
    -- Accord finalisé ou journée déjà confirmée : immuables ici.
    raise exception 'requires_separate_handling';
  end if;

  update public.mission_interruption_reexaminations x
  set decision = p_decision, decision_motivation = v_mot, decided_by = v_uid, decided_at = now()
  where x.closure_id = c.id and x.decided_at is null;
  if p_decision = 'reopened' then
    insert into public.mission_interruption_closure_history (incident_id, closure_id, outcome, motivation,
                                                             decided_by, decided_at, reexamination_id)
    values (i.id, c.id, c.outcome, c.motivation, c.decided_by, c.decided_at, r.id);
    delete from public.mission_interruption_closures x where x.id = c.id;
    -- Le signalement générique reste figé sur sa première décision (règle
    -- du lot 14, non contournée) ; l'état rouvert se lit dans les clôtures.
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, resource_type, resource_id, metadata)
  values (v_uid, 'admin_founder', 'decide_interruption_reexamination', 'mission_incidents', i.id,
          jsonb_build_object('reexamination_id', r.id, 'decision', p_decision,
                             'closure_outcome', c.outcome));
  perform public.interruption_notify_parties(i.id, 'reexam_decision', r.id::text,
    'Réexamen traité par le fondateur', 'Re-examination handled by the founder',
    case p_decision
      when 'maintained' then 'Le fondateur maintient sa décision, avec ses motifs. Ce réexamen n''est pas un recours indépendant.'
      when 'reopened' then 'Le fondateur rouvre l''examen du dossier : la décision précédente est conservée dans l''historique.'
      else 'La correction demandée exige un traitement distinct : rien n''est modifié dans ce dossier.' end,
    case p_decision
      when 'maintained' then 'The founder maintains the decision, with reasons. This re-examination is not an independent appeal.'
      when 'reopened' then 'The founder reopens the review of the file: the previous decision is kept in the history.'
      else 'The requested correction needs separate handling: nothing is changed in this file.' end);
  return jsonb_build_object('decision', p_decision, 'already_recorded', false);
end;
$$;
revoke all on function public.admin_decide_interruption_reexamination(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_interruption_reexamination(uuid, text, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 11. Parties : réponse, recours, consultation
-- ════════════════════════════════════════════════════════════════════
create or replace function public.respond_interruption_proposal(
  p_proposal_id uuid, p_version integer, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_party text;
  p public.mission_interruption_proposals;
  cur public.mission_interruption_proposals;
  i public.mission_incidents;
  r public.mission_interruption_responses;
  v_status text;
  v_users uuid[];
begin
  if p_decision is null or p_decision not in ('accept', 'refuse') then
    raise exception 'decision_invalid';
  end if;
  select x.* into p from public.mission_interruption_proposals x where x.id = p_proposal_id;
  if p.id is null then
    raise exception 'settlement_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(v_uid, p.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'settlement_not_found';
  end;
  i := public.interruption_lock(p.incident_id);
  select x.* into p from public.mission_interruption_proposals x where x.id = p_proposal_id;
  if exists (select 1 from public.mission_interruption_closures c where c.incident_id = i.id) then
    raise exception 'incident_closed';
  end if;
  -- Version remplacée ou numéro différent : jamais de réponse reportée.
  cur := public.interruption_current_proposal(i.id);
  if cur.id is distinct from p.id or p_version is distinct from p.version then
    raise exception 'settlement_changed';
  end if;
  -- Double envoi : la même réponse déjà enregistrée ; pas de changement d'avis.
  select x.* into r from public.mission_interruption_responses x
  where x.proposal_id = p.id and x.party = v_party;
  if r.id is not null then
    if r.decision = p_decision then
      return jsonb_build_object('status', public.interruption_proposal_status(p, now()),
                                'already_recorded', true);
    end if;
    raise exception 'already_responded';
  end if;
  v_status := public.interruption_proposal_status(p, now());
  if v_status = 'refused' then
    raise exception 'proposal_refused';
  elsif v_status = 'expired' then
    raise exception 'proposal_expired';
  end if;
  insert into public.mission_interruption_responses (proposal_id, party, decision, author_id)
  values (p.id, v_party, p_decision, v_uid);
  v_status := public.interruption_proposal_status(p, now());
  v_users := public.mission_incident_parties(i.id);
  if v_status = 'accepted' then
    perform public.interruption_notify_parties(i.id, 'agreement', p.id::text,
      'Accord des deux parties', 'Both parties agree',
      'Les deux parties acceptent ' || p.amount || ' XAF (version ' || p.version
        || '). Le code de la journée peut être saisi, même avant la fin prévue.',
      'Both parties accept ' || p.amount || ' XAF (version ' || p.version
        || '). The day''s code can be entered, even before the scheduled end.');
  elsif v_status = 'refused' then
    perform public.interruption_notify(i.id, 'proposal_refused', p.id::text,
      v_users[case when v_party = 'candidate' then 2 else 1 end],
      case when v_party = 'candidate' then 'company' else 'candidate' end,
      'Proposition refusée', 'Proposal refused',
      'L''autre partie refuse la proposition : le dossier revient au fondateur.',
      'The other party refuses the proposal: the file goes back to the founder.');
    perform public.interruption_notify_founders(i.id, 'proposal_refused', p.id::text,
      'Proposition refusée', 'Proposal refused',
      'Une partie refuse la version ' || p.version || ' : le dossier revient à votre examen.',
      'A party refused version ' || p.version || ': the file is back for your review.');
  else
    perform public.incident_notify(v_users[case when v_party = 'candidate' then 2 else 1 end],
      'L''autre partie a accepté', 'The other party accepted',
      'L''autre partie accepte la proposition. Votre réponse est attendue.',
      'The other party accepts the proposal. Your answer is awaited.',
      jsonb_build_object('kind', 'mission_interruption', 'incident_id', i.id, 'mission_id', i.mission_id));
  end if;
  return jsonb_build_object('status', v_status, 'already_recorded', false);
end;
$$;
revoke all on function public.respond_interruption_proposal(uuid, integer, text) from public, anon;
grant execute on function public.respond_interruption_proposal(uuid, integer, text) to authenticated;

-- Recours immédiat : le code n'est pas remis malgré l'accord.
create or replace function public.request_interruption_finalization(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_party text;
  i public.mission_incidents;
  p public.mission_interruption_proposals;
  v_id uuid;
begin
  select x.* into i from public.mission_incidents x where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    raise exception 'incident_not_found';
  end if;
  begin
    v_party := public.mission_incident_party(v_uid, i.mission_id);
  exception when sqlstate 'P0001' then
    raise exception 'incident_not_found';
  end;
  i := public.interruption_lock(p_incident_id);
  p := public.interruption_agreement(i.mission_day_id);
  if p.id is null then
    raise exception 'settlement_not_accepted';
  end if;
  insert into public.mission_interruption_recourses (incident_id, proposal_id, party, author_id)
  values (i.id, p.id, v_party, v_uid)
  on conflict (proposal_id, party) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.interruption_notify_founders(i.id, 'recourse', p.id::text,
      'Code non remis après un accord', 'Code not handed over after an agreement',
      'Une partie signale que le code n''est pas remis malgré l''accord (version ' || p.version
        || ', ' || p.amount || ' XAF). Vérifiez puis finalisez si nécessaire.',
      'A party reports the code was not handed over despite the agreement (version ' || p.version
        || ', ' || p.amount || ' XAF). Check, then finalise if needed.');
  end if;
  return jsonb_build_object('already_recorded', v_id is null);
end;
$$;
revoke all on function public.request_interruption_finalization(uuid) from public, anon;
grant execute on function public.request_interruption_finalization(uuid) to authenticated;

-- Consultation observée : l'écran du dossier est affiché par le
-- destinataire (partie ou fondateur). Jamais déduite d'une notification.
create or replace function public.mark_interruption_viewed(p_incident_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i public.mission_incidents;
  v_count integer;
begin
  select x.* into i from public.mission_incidents x where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    raise exception 'incident_not_found';
  end if;
  if not public.is_founder_admin_user(v_uid) then
    begin
      perform public.mission_incident_party(v_uid, i.mission_id);
    exception when sqlstate 'P0001' then
      raise exception 'incident_not_found';
    end;
  end if;
  update public.mission_interruption_notices n set viewed_at = now()
  where n.incident_id = i.id and n.recipient_id = v_uid and n.viewed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_interruption_viewed(uuid) from public, anon;
grant execute on function public.mark_interruption_viewed(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Lectures : parties, support, tâches
-- ════════════════════════════════════════════════════════════════════
-- p_viewer : 'candidate', 'company' ou 'admin'. Les parties ne voient que
-- leurs demandes et leurs avis ; jamais les notes, contacts ni motifs de
-- prolongation.
create or replace function public.interruption_json(i public.mission_incidents, p_viewer text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb := public.interruption_state(i.id, now());
  v_other text := case when i.reported_by_party = 'candidate' then 'company' else 'candidate' end;
  c public.mission_interruption_closures;
  cur public.mission_interruption_proposals;
  v_admin boolean := p_viewer = 'admin';
  v_amount_state text;
  v_version_at timestamptz;
  v_day public.mission_days;
  v_acq jsonb;
  v_pstatus text;
begin
  select x.* into c from public.mission_interruption_closures x where x.incident_id = i.id;
  cur := public.interruption_current_proposal(i.id);
  v_pstatus := public.interruption_proposal_status(cur, now());
  select d.* into v_day from public.mission_days d where d.id = i.mission_day_id;
  -- Montant déjà reconnu de la mission (journées réalisées et accords
  -- réglés) ; information seulement, jamais un versement.
  begin
    v_acq := public.mission_acquired_amount(i.mission_id);
  exception when others then
    v_acq := null;
  end;
  select v.created_at into v_version_at from public.mission_interruption_versions v
  where v.incident_id = i.id and v.party = v_other;
  v_amount_state := case when c.outcome = 'settled' then 'settled'
                         when c.outcome = 'disagreement' then 'unresolved'
                         when c.outcome = 'not_established' then 'not_applicable'
                         else 'under_review' end;
  return jsonb_build_object(
    'incident_id', i.id, 'mission_day_id', i.mission_day_id, 'mission_id', i.mission_id,
    'cause', i.interruption_cause, 'declared_at', i.interruption_declared_at,
    'work_done', i.work_done, 'reported_by_party', i.reported_by_party,
    'status', i.status, 'outcome', i.outcome, 'viewer', p_viewer, 'server_now', now(),
    'state', v_state,
    'blocks_completion', public.interruption_blocks_completion(i.mission_day_id),
    'instruction_open', public.incident_instruction_open(i.id),
    'amount_state', v_amount_state,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
                  'party', v.party, 'cause', v.cause, 'declared_at', v.declared_at,
                  'work_done', v.work_done, 'reason', v.reason, 'created_at', v.created_at)
                  order by v.created_at)
                from public.mission_interruption_versions v where v.incident_id = i.id), '[]'::jsonb),
    'version_request', jsonb_build_object('party', v_other,
      'due_at', i.created_at + interval '72 hours', 'given_at', v_version_at,
      'open', v_version_at is null and c.id is null
              and public.interruption_deadline_open(i.created_at + interval '72 hours', now())),
    'requests', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'party', r.party, 'question', r.question, 'created_at', r.created_at,
                  'respond_by', r.respond_by, 'answered_at', r.answered_at,
                  'open', r.answered_at is null and c.id is null
                          and public.interruption_deadline_open(r.respond_by, now()),
                  'expired', r.answered_at is null
                             and not public.interruption_deadline_open(r.respond_by, now()))
                  order by r.created_at)
                from public.mission_incident_info_requests r
                where r.incident_id = i.id and r.respond_by is not null
                  and (v_admin or r.party = p_viewer)), '[]'::jsonb),
    'proposals', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', p.id, 'version', p.version, 'amount', p.amount, 'motivation', p.motivation,
                  'proposed_at', p.proposed_at, 'respond_by', p.respond_by,
                  'superseded_at', p.superseded_at, 'current', p.superseded_at is null,
                  'status', public.interruption_proposal_status(p, now()),
                  'responses', coalesce((select jsonb_agg(jsonb_build_object(
                      'party', x.party, 'decision', x.decision, 'responded_at', x.responded_at)
                      order by x.responded_at)
                    from public.mission_interruption_responses x where x.proposal_id = p.id), '[]'::jsonb))
                  order by p.version)
                from public.mission_interruption_proposals p where p.incident_id = i.id), '[]'::jsonb),
    'current_proposal_id', cur.id,
    'closure', case when c.id is null then null else jsonb_build_object(
                 'outcome', c.outcome, 'motivation', c.motivation, 'amount', c.amount,
                 'completion_source', c.completion_source, 'decided_at', c.decided_at) end,
    'recourses', coalesce((select jsonb_agg(jsonb_build_object('party', r.party, 'created_at', r.created_at)
                  order by r.created_at)
                from public.mission_interruption_recourses r where r.proposal_id = cur.id), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(jsonb_build_object(
                  'kind', n.kind, 'recipient', n.recipient_role,
                  'made_available_at', n.made_available_at, 'viewed_at', n.viewed_at)
                  order by n.made_available_at)
                from public.mission_interruption_notices n
                where n.incident_id = i.id
                  and (v_admin or (n.recipient_role = p_viewer
                                   and n.recipient_id = auth.uid()))), '[]'::jsonb),
    'unviewed', (select count(*) from public.mission_interruption_notices n
                 where n.incident_id = i.id and n.recipient_id = auth.uid() and n.viewed_at is null),
    -- Suivi financier : reconnu, proposé, accepté, réglé ; plafond du contrat.
    'finance', jsonb_build_object(
      'currency', 'XAF',
      'cap', public.interruption_settlement_cap(i.mission_day_id),
      'recognized_total', (v_acq ->> 'acquired_exact')::numeric,
      'recognized_status', v_acq ->> 'status',
      'pending_amount', case when v_pstatus = 'open' then cur.amount end,
      'accepted_amount', case when v_pstatus = 'accepted' then cur.amount
                              when c.outcome = 'settled' then c.amount end,
      'settled_amount', case when c.outcome = 'settled' then c.amount end,
      'finalized', c.outcome = 'settled',
      'completion_source', c.completion_source),
    -- Situations distinctes : journée, dossier (state), mission.
    'day_state', case when c.outcome = 'settled' then 'settled'
                      when c.outcome = 'disagreement' then 'unresolved'
                      when c.outcome = 'not_established' and v_day.actual_end_time is not null then 'confirmed'
                      when c.outcome = 'not_established' then 'normal'
                      when v_pstatus = 'accepted' then 'agreement'
                      else 'under_review' end,
    'mission_days', jsonb_build_object(
      'total', (select count(*) from public.mission_days d where d.mission_id = i.mission_id),
      'confirmed', (select count(*) from public.mission_days d
                    where d.mission_id = i.mission_id and d.actual_end_time is not null),
      'cancelled', (select count(*) from public.candidate_cancellation_days cd
                    join public.mission_days d on d.id = cd.mission_day_id
                    where d.mission_id = i.mission_id)),
    'reexaminations', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', r.id, 'party', r.party, 'reason', r.reason, 'created_at', r.created_at,
                  'closure_outcome', r.closure_outcome, 'decision', r.decision,
                  'decision_motivation', r.decision_motivation, 'decided_at', r.decided_at,
                  'current', r.closure_id = c.id)
                  order by r.created_at)
                from public.mission_interruption_reexaminations r
                where r.incident_id = i.id and (v_admin or r.party = p_viewer)), '[]'::jsonb),
    'closure_history', coalesce((select jsonb_agg(jsonb_build_object(
                  'outcome', h.outcome, 'motivation', h.motivation, 'decided_at', h.decided_at,
                  'revoked_at', h.revoked_at) order by h.revoked_at)
                from public.mission_interruption_closure_history h where h.incident_id = i.id), '[]'::jsonb),
    'can', jsonb_build_object(
      'give_version', not v_admin and p_viewer = v_other and v_version_at is null and c.id is null
                      and public.interruption_deadline_open(i.created_at + interval '72 hours', now()),
      'respond', not v_admin and v_state ->> 'stage' = 'awaiting_parties'
                 and not exists (select 1 from public.mission_interruption_responses x
                                 where x.proposal_id = cur.id and x.party = p_viewer),
      'request_recourse', not v_admin and v_state ->> 'stage' = 'agreement'
                          and not exists (select 1 from public.mission_interruption_recourses r
                                          where r.proposal_id = cur.id and r.party = p_viewer),
      'request_reexamination', not v_admin and c.id is not null
                          and not exists (select 1 from public.mission_interruption_reexaminations r
                                          where r.closure_id = c.id and r.party = p_viewer
                                            and r.decided_at is null)));
end;
$$;
revoke all on function public.interruption_json(public.mission_incidents, text) from public, anon, authenticated;

create or replace function public.mission_interruptions_for_party(p_mission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_party text;
begin
  v_party := public.mission_incident_party(auth.uid(), p_mission_id);
  return coalesce((select jsonb_agg(public.interruption_json(i, v_party) order by i.created_at)
                   from public.mission_incidents i
                   where i.mission_id = p_mission_id and i.kind = 'interruption'), '[]'::jsonb);
end;
$$;
revoke all on function public.mission_interruptions_for_party(uuid) from public, anon;
grant execute on function public.mission_interruptions_for_party(uuid) to authenticated;

-- Support : tout admin actif lit ; seuls les droits du fondateur ouvrent
-- les actions de décision.
create or replace function public.admin_mission_interruption(p_incident_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i public.mission_incidents;
  v_founder boolean;
  v_json jsonb;
  v_stage text;
  v_policy jsonb := public.partial_settlement_policy();
  v_open boolean;
begin
  if not public.is_admin_user(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select x.* into i from public.mission_incidents x where x.id = p_incident_id and x.kind = 'interruption';
  if i.id is null then
    return null;
  end if;
  v_founder := public.is_founder_admin_user(v_uid);
  v_json := public.interruption_json(i, 'admin');
  v_stage := v_json -> 'state' ->> 'stage';
  v_open := coalesce((v_policy ->> 'validated')::boolean, false);
  return v_json || jsonb_build_object(
    'policy', v_policy,
    'viewer_is_founder', v_founder,
    'extensions', coalesce((select jsonb_agg(jsonb_build_object(
                    'ends_at', e.ends_at, 'extends_due', e.extends_due, 'reason', e.reason,
                    'created_at', e.created_at)
                    order by e.created_at)
                  from public.mission_interruption_extensions e where e.incident_id = i.id), '[]'::jsonb),
    'founder', jsonb_build_object(
      'can_propose', v_founder and v_open and v_stage in ('founder_review', 'awaiting_parties'),
      'propose_blocked', case when not v_open then 'settlement_rule_pending'
                              when v_stage = 'instruction' then 'instruction_pending'
                              when v_stage = 'agreement' then 'settlement_accepted'
                              when v_stage = 'closed' then 'incident_closed' end,
      'can_close', v_founder and v_stage = 'founder_review',
      'can_extend', v_founder and v_stage = 'founder_review'
                    and not exists (select 1 from public.mission_interruption_extensions e
                                    where e.incident_id = i.id),
      'extension_used', exists (select 1 from public.mission_interruption_extensions e
                                where e.incident_id = i.id),
      'can_decide_reexamination', v_founder,
      'can_finalize', v_founder and v_stage = 'agreement'
                      and jsonb_array_length(v_json -> 'recourses') > 0));
end;
$$;
revoke all on function public.admin_mission_interruption(uuid) from public, anon;
grant execute on function public.admin_mission_interruption(uuid) to authenticated;

-- Tâches persistantes d'une partie : version, demande, proposition, code
-- après accord (recours possible).
create or replace function public.my_interruption_tasks()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '[]'::jsonb;
  x record;
  v_state jsonb;
  cur public.mission_interruption_proposals;
  v_base jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  for x in
    select i.*, d.scheduled_date, j.title as job_title,
           case when cand.user_id = v_uid then 'candidate' else 'company' end as viewer
    from public.mission_incidents i
    join public.mission_days d on d.id = i.mission_day_id
    join public.jobs j on j.id = i.job_id
    join public.candidate_profiles cand on cand.id = i.candidate_id
    join public.company_profiles comp on comp.id = i.company_id
    where i.kind = 'interruption' and (cand.user_id = v_uid or comp.user_id = v_uid)
      and not exists (select 1 from public.mission_interruption_closures c where c.incident_id = i.id)
    order by i.created_at
  loop
    v_state := public.interruption_state(x.id, now());
    cur := public.interruption_current_proposal(x.id);
    v_base := jsonb_build_object('incident_id', x.id, 'mission_id', x.mission_id,
      'job_id', x.job_id, 'job_title', x.job_title, 'day_date', x.scheduled_date,
      'viewer', x.viewer, 'stage', v_state ->> 'stage');
    if x.viewer <> x.reported_by_party
       and not exists (select 1 from public.mission_interruption_versions v
                       where v.incident_id = x.id and v.party = x.viewer)
       and public.interruption_deadline_open(x.created_at + interval '72 hours', now()) then
      v_out := v_out || (v_base || jsonb_build_object('action', 'give_version',
                 'due_at', x.created_at + interval '72 hours'));
    end if;
    v_out := v_out || coalesce((select jsonb_agg(v_base || jsonb_build_object(
                 'action', 'answer_request', 'request_id', r.id, 'due_at', r.respond_by)
                 order by r.respond_by)
               from public.mission_incident_info_requests r
               where r.incident_id = x.id and r.party = x.viewer and r.answered_at is null
                 and public.interruption_deadline_open(r.respond_by, now())), '[]'::jsonb);
    if v_state ->> 'stage' = 'awaiting_parties'
       and not exists (select 1 from public.mission_interruption_responses r
                       where r.proposal_id = cur.id and r.party = x.viewer) then
      v_out := v_out || (v_base || jsonb_build_object('action', 'respond_proposal',
                 'proposal_id', cur.id, 'version', cur.version, 'amount', cur.amount,
                 'due_at', cur.respond_by));
    elsif v_state ->> 'stage' = 'agreement' then
      v_out := v_out || (v_base || jsonb_build_object('action', 'agreement_code',
                 'proposal_id', cur.id, 'version', cur.version, 'amount', cur.amount,
                 'due_at', null,
                 'recourse_requested', exists (select 1 from public.mission_interruption_recourses r
                                               where r.proposal_id = cur.id and r.party = x.viewer)));
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.my_interruption_tasks() from public, anon;
grant execute on function public.my_interruption_tasks() to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 13. Code de la journée (reprise de 20261119120000)
-- ════════════════════════════════════════════════════════════════════
-- Ajouts marqués « Interruption » : refus sans lecture du code tant que le
-- dossier n'est pas clos ou en désaccord non résolu ; exception avant la
-- fin prévue avec un accord des deux parties sur la version courante
-- (l'échéance de réponse ne l'annule pas) ; provenance « partial » ;
-- clôture « réglée » au montant accepté.
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
  v_agree public.mission_interruption_proposals;
  v_incident uuid;
  v_partial boolean := false;
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

  -- Interruption : dossier lu sous verrou, avant tout accès au code.
  select i.id into v_incident from public.mission_incidents i
  where i.mission_day_id = v_day.id and i.kind = 'interruption' for update;
  v_agree := public.interruption_agreement(v_day.id);
  if v_agree.id is not null then
    v_partial := true;
  elsif public.interruption_blocks_completion(v_day.id) then
    if exists (select 1 from public.mission_interruption_closures c
               where c.incident_id = v_incident and c.outcome = 'disagreement') then
      raise exception 'interruption_unresolved';
    elsif (public.interruption_current_proposal(v_incident)).id is not null then
      -- Proposition ouverte, refusée ou expirée : refus précis.
      raise exception 'settlement_not_accepted';
    end if;
    raise exception 'interruption_pending';
  end if;

  -- Lot 15 : fin prévue de la journée ; exception : accord des deux parties.
  if not v_partial and now() < v_day.ends_at then
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
  update public.mission_days d
  set actual_end_time = now(), completion_source = case when v_partial then 'partial' else 'code' end
  where d.id = v_day.id returning d.* into v_day;
  if v_partial then
    insert into public.mission_interruption_closures (incident_id, outcome, proposal_id, amount,
      completion_source, decided_by, decided_by_role)
    values (v_agree.incident_id, 'settled', v_agree.id, v_agree.amount, 'partial', v_uid, 'candidate');
    update public.mission_incidents x
    set status = 'decided', outcome = 'partial', decided_at = now(), updated_at = now(),
        decision_note = 'Accord des deux parties sur la version ' || v_agree.version
          || ' (' || v_agree.amount || ' XAF), confirmé par le code de la journée.'
    where x.id = v_agree.incident_id and x.status <> 'decided';
  end if;

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
        when v_partial and v_company.locale = 'en' then 'Partial agreement finalised'
        when v_partial then 'Accord partiel finalisé'
        when v_done and v_company.locale = 'en' then 'Mission completed'
        when v_done then 'Mission réalisée'
        when v_company.locale = 'en' then 'Day confirmed'
        else 'Journée confirmée' end,
      case
        when v_partial and v_company.locale = 'en'
          then coalesce(v_candidate.first_name, 'The candidate') || ' confirmed with the code the partial agreement of "' || v_job.title || '". No payment is made by the app.'
        when v_partial
          then coalesce(v_candidate.first_name, 'Le candidat') || ' a confirmé par le code l''accord partiel de « ' || v_job.title || ' ». Aucun versement n''est effectué par l''application.'
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
                         'mission_status', v_mission.status, 'partial', v_partial)
    );
  end if;

  return query select 'completed'::text, v_mission.id, v_day.id, v_day.actual_end_time,
    v_done, null::integer, null::timestamptz, false;
end;
$$;
revoke all on function public.submit_completion_code(uuid, text, uuid) from public, anon;
grant execute on function public.submit_completion_code(uuid, text, uuid) to authenticated;

-- Journées vues par les parties (reprise de 20261122120000) : état de
-- l'interruption et accord de la journée.
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
           'completion_available_at', d.ends_at,
           'started_at', d.actual_start_time,
           'completed_at', d.actual_end_time,
           'completed_via', case when public.completion_counts(d.completion_source)
                                      or d.completion_source in ('partial', 'partial_support')
                                 then d.completion_source end,
           'cancelled_at', (select c.created_at from public.candidate_cancellation_days cd
                            join public.candidate_cancellations c on c.id = cd.cancellation_id
                            where cd.mission_day_id = d.id),
           'interruption', (select jsonb_build_object(
                              'incident_id', i.id, 'status', i.status, 'outcome', i.outcome,
                              'stage', public.interruption_state(i.id, now()) ->> 'stage',
                              'blocks_completion', public.interruption_blocks_completion(d.id),
                              'agreement', (select case when a.id is null then null
                                              else jsonb_build_object('proposal_id', a.id,
                                                     'version', a.version, 'amount', a.amount) end
                                            from public.interruption_agreement(d.id) a),
                              'settled_amount', (select c.amount from public.mission_interruption_closures c
                                                 where c.incident_id = i.id and c.outcome = 'settled'),
                              'closure_outcome', (select c.outcome from public.mission_interruption_closures c
                                                  where c.incident_id = i.id))
                            from public.mission_incidents i
                            where i.mission_day_id = d.id and i.kind = 'interruption')) order by d.starts_at), '[]'::jsonb)
  from public.mission_days d where d.mission_id = p_mission_id;
$$;
revoke all on function public.mission_days_json(uuid) from public, anon, authenticated;

-- Missions de l'offre vues par l'entreprise (reprise de 20261120120000) :
-- seule la provenance d'une journée réglée par accord est ajoutée.
create or replace function public.company_job_missions(p_job_id uuid)
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
         -- Interruption : accord réglé (code ou finalisation du fondateur).
         case when public.completion_counts(d.completion_source)
                   or d.completion_source in ('partial', 'partial_support')
              then d.completion_source end,
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

-- Montant acquis (reprise de 20261122120000). Journées entièrement
-- réalisées : prorata du lot 17c (décision validée), inchangé. Journée
-- interrompue : aucun montant automatique ; seul un règlement finalisé
-- (montant accepté) s'ajoute ; sinon « en attente de règlement », jamais
-- présenté comme nul ; désaccord non résolu : aucun montant définitif.
create or replace function public.mission_acquired_amount(p_mission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mission public.missions;
  v_contract public.contracts;
  v_pay numeric;
  v_total integer := 0;
  v_done integer := 0;
  v_days jsonb := '[]'::jsonb;
  v_pending boolean := false;
  v_settlement_pending boolean := false;
  v_settled numeric := 0;
  v_exact numeric;
  x record;
begin
  select m.* into v_mission from public.missions m where m.id = p_mission_id;
  if not found then
    raise exception 'mission_not_found';
  end if;
  if not (public.is_admin_user(v_uid)
          or exists (select 1 from public.candidate_profiles cp
                     where cp.id = v_mission.candidate_id and cp.user_id = v_uid)
          or exists (select 1 from public.jobs j join public.company_profiles cp on cp.id = j.company_id
                     where j.id = v_mission.job_id and cp.user_id = v_uid)) then
    raise exception 'mission_not_found';
  end if;
  select c.* into v_contract from public.contracts c where c.application_id = v_mission.application_id;
  if v_contract.id is null then
    raise exception 'mission_not_found';
  end if;
  v_pay := (v_contract.contract_data ->> 'mission_pay_per_candidate')::numeric;

  for x in
    select (e ->> 'date')::date as day_date, (e ->> 'start_time')::time as st,
           (e ->> 'end_time')::time as et, d.id as day_id, d.completion_source,
           exists (select 1 from public.candidate_cancellation_days cd where cd.mission_day_id = d.id) as cancelled,
           -- Travail partiel identifié (lot 16) ou interruption non réglée.
           (exists (select 1 from public.mission_incidents i where i.mission_day_id = d.id
                    and i.kind <> 'interruption' and i.outcome = 'partial')
            or public.interruption_blocks_completion(d.id)) as awaiting_settlement,
           exists (select 1 from public.mission_incidents i
                   join public.mission_interruption_closures c on c.incident_id = i.id
                   where i.mission_day_id = d.id and c.outcome = 'disagreement') as unresolved,
           (select c.amount from public.mission_incidents i
            join public.mission_interruption_closures c on c.incident_id = i.id
            where i.mission_day_id = d.id and c.outcome = 'settled') as settled_amount
    from jsonb_array_elements(coalesce(v_contract.contract_data -> 'days',
           jsonb_build_array(jsonb_build_object(
             'date', v_contract.contract_data ->> 'start_date',
             'start_time', v_contract.contract_data ->> 'start_time',
             'end_time', v_contract.contract_data ->> 'end_time')))) e
    left join public.mission_days d on d.mission_id = v_mission.id
      and d.scheduled_date = (e ->> 'date')::date
    order by (e ->> 'date')::date
  loop
    v_total := v_total + public.contract_day_minutes(x.st, x.et);
    if public.completion_counts(x.completion_source) then
      v_done := v_done + public.contract_day_minutes(x.st, x.et);
    elsif x.completion_source in ('partial', 'partial_support') then
      v_settled := v_settled + coalesce(x.settled_amount, 0);
    elsif x.awaiting_settlement and not x.cancelled then
      v_settlement_pending := true;
    elsif not x.cancelled then
      v_pending := true;
    end if;
    v_days := v_days || jsonb_build_object(
      'date', x.day_date, 'start_time', x.st, 'end_time', x.et,
      'planned_minutes', public.contract_day_minutes(x.st, x.et),
      'realized', public.completion_counts(x.completion_source),
      'realized_via', case when public.completion_counts(x.completion_source)
                                or x.completion_source in ('partial', 'partial_support')
                           then x.completion_source end,
      'cancelled', x.cancelled,
      'awaiting_settlement', x.awaiting_settlement and x.completion_source is null and not x.cancelled,
      'unresolved', x.unresolved and x.completion_source is null,
      'settled_amount', x.settled_amount);
  end loop;

  v_exact := (case when v_total > 0 then v_pay * v_done / v_total else 0 end) + v_settled;
  return jsonb_build_object(
    'mission_id', v_mission.id,
    'currency', coalesce(v_contract.contract_data ->> 'currency', 'XAF'),
    'contract_pay', v_pay,
    'planned_minutes_total', v_total,
    'realized_minutes', v_done,
    'settled_total', v_settled,
    'acquired_exact', round(v_exact, 4),
    'acquired_rounded', round(v_exact),
    'is_integer', v_exact = trunc(v_exact),
    'status', case when v_settlement_pending then 'settlement_pending'
                   when v_pending then 'in_progress' else 'final' end,
    'rounding', 'half_up_to_validate',
    'duration_convention', 'gross_scheduled_minutes_break_not_deducted',
    'days', v_days);
end;
$$;
revoke all on function public.mission_acquired_amount(uuid) from public, anon;
grant execute on function public.mission_acquired_amount(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 14. Lot 16 : relances 24 h / 48 h hors interruptions ; file du support
-- ════════════════════════════════════════════════════════════════════
-- Reprise de 20261120120000 : seule la condition « kind <> 'interruption' »
-- change (l'interruption suit ses propres délais, section 15).
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
      and i.kind <> 'interruption'
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

-- File du support (reprise de 20261120120000) : étape, échéance et
-- dépassement du fondateur pour une interruption.
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
  appeal_status text,
  interruption_stage text,
  interruption_due_at timestamptz,
  interruption_overdue boolean
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
          where a.incident_id = i.id order by a.created_at desc limit 1),
         st ->> 'stage',
         (st ->> 'due_at')::timestamptz,
         coalesce((st ->> 'overdue')::boolean, false)
  from public.mission_incidents i
  join public.mission_days d on d.id = i.mission_day_id
  join public.jobs j on j.id = i.job_id
  join public.company_profiles cmp on cmp.id = i.company_id
  join public.candidate_profiles cand on cand.id = i.candidate_id
  left join lateral (select public.interruption_state(i.id, now()) as st) s on i.kind = 'interruption'
  where p_status is null or i.status = p_status
  order by coalesce((st ->> 'overdue')::boolean, false) desc,
           (i.status in ('open', 'answered')) desc, i.created_at desc
  limit 200;
end;
$$;
revoke all on function public.admin_mission_incidents(text) from public, anon;
grant execute on function public.admin_mission_incidents(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 15. Échéances des interruptions : rappels et expirations idempotents
--     (tâche planifiée existante ; aucune décision automatique)
-- ════════════════════════════════════════════════════════════════════
-- p_at : heure de la base (la preuve rejoue des instants exacts). Rappel
-- 24 h avant l'échéance d'une demande, 12 h avant celle d'une proposition ;
-- avis d'expiration après l'échéance ; dépassement du fondateur signalé à
-- chaque fondateur actif, une fois par échéance. Le contrôle des actions ne
-- dépend jamais de ce balayage.
create or replace function public.interruption_deadline_sweep(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  x record;
  r record;
  v_count integer := 0;
  v_users uuid[];
  v_other text;
  v_due timestamptz;
  v_state jsonb;
  cur public.mission_interruption_proposals;
  v_status text;
begin
  for x in
    select i.* from public.mission_incidents i
    where i.kind = 'interruption'
      and not exists (select 1 from public.mission_interruption_closures c where c.incident_id = i.id)
    order by i.created_at
  loop
    v_users := public.mission_incident_parties(x.id);
    v_other := case when x.reported_by_party = 'candidate' then 'company' else 'candidate' end;

    -- Version de l'autre partie.
    v_due := x.created_at + interval '72 hours';
    if not exists (select 1 from public.mission_interruption_versions v
                   where v.incident_id = x.id and v.party = v_other) then
      if public.interruption_deadline_open(v_due, p_at) and p_at >= v_due - interval '24 hours' then
        if public.interruption_notify(x.id, 'version_reminder', 'version',
             v_users[case when v_other = 'candidate' then 1 else 2 end], v_other,
             'Rappel : votre version est attendue', 'Reminder: your version is awaited',
             'Donnez votre version de l''interruption avant le {due}.',
             'Give your version of the interruption before {due}.', v_due) then
          v_count := v_count + 1;
        end if;
      elsif not public.interruption_deadline_open(v_due, p_at) then
        if public.interruption_notify(x.id, 'version_expired', 'version',
             v_users[case when v_other = 'candidate' then 1 else 2 end], v_other,
             'Délai de version expiré', 'Version deadline passed',
             'Le délai pour donner votre version a expiré le {due}. Le dossier passe à l''examen du fondateur avec les éléments disponibles ; votre silence ne prouve rien.',
             'The deadline to give your version passed on {due}. The founder reviews the file with the available elements; your silence proves nothing.',
             v_due) then
          v_count := v_count + 1;
        end if;
      end if;
    end if;

    -- Demandes du support.
    for r in
      select q.* from public.mission_incident_info_requests q
      where q.incident_id = x.id and q.respond_by is not null and q.answered_at is null
    loop
      if public.interruption_deadline_open(r.respond_by, p_at)
         and p_at >= r.respond_by - interval '24 hours' then
        if public.interruption_notify(x.id, 'info_reminder', r.id::text,
             v_users[case when r.party = 'candidate' then 1 else 2 end], r.party,
             'Rappel : justificatif attendu', 'Reminder: supporting information awaited',
             'Répondez à la demande du support ou joignez une pièce avant le {due}.',
             'Answer the support request or attach a document before {due}.', r.respond_by) then
          v_count := v_count + 1;
        end if;
      elsif not public.interruption_deadline_open(r.respond_by, p_at) then
        if public.interruption_notify(x.id, 'info_expired', r.id::text,
             v_users[case when r.party = 'candidate' then 1 else 2 end], r.party,
             'Délai de réponse expiré', 'Answer deadline passed',
             'Le délai de réponse a expiré le {due}. Le dossier passe à l''examen du fondateur avec les éléments disponibles ; votre silence ne prouve rien.',
             'The answer deadline passed on {due}. The founder reviews the file with the available elements; your silence proves nothing.',
             r.respond_by) then
          v_count := v_count + 1;
        end if;
      end if;
    end loop;

    -- Proposition en cours.
    cur := public.interruption_current_proposal(x.id);
    v_status := public.interruption_proposal_status(cur, p_at);
    if v_status = 'open' and p_at >= cur.respond_by - interval '12 hours' then
      if not exists (select 1 from public.mission_interruption_responses q
                     where q.proposal_id = cur.id and q.party = 'candidate')
         and public.interruption_notify(x.id, 'proposal_reminder', cur.id::text, v_users[1], 'candidate',
               'Rappel : proposition à accepter ou refuser', 'Reminder: proposal to accept or refuse',
               'Répondez à la proposition de ' || cur.amount || ' XAF avant le {due}. Sans réponse, elle expire.',
               'Answer the ' || cur.amount || ' XAF proposal before {due}. Without an answer, it expires.',
               cur.respond_by) then
        v_count := v_count + 1;
      end if;
      if not exists (select 1 from public.mission_interruption_responses q
                     where q.proposal_id = cur.id and q.party = 'company')
         and public.interruption_notify(x.id, 'proposal_reminder', cur.id::text, v_users[2], 'company',
               'Rappel : proposition à accepter ou refuser', 'Reminder: proposal to accept or refuse',
               'Répondez à la proposition de ' || cur.amount || ' XAF avant le {due}. Sans réponse, elle expire.',
               'Answer the ' || cur.amount || ' XAF proposal before {due}. Without an answer, it expires.',
               cur.respond_by) then
        v_count := v_count + 1;
      end if;
    elsif v_status = 'expired' then
      if public.interruption_notify(x.id, 'proposal_expired', cur.id::text, v_users[1], 'candidate',
           'Proposition expirée', 'Proposal expired',
           'Sans deux acceptations avant le {due}, la proposition a expiré. Le dossier revient au fondateur.',
           'Without two acceptances before {due}, the proposal expired. The file goes back to the founder.',
           cur.respond_by) then
        v_count := v_count + 1;
      end if;
      if public.interruption_notify(x.id, 'proposal_expired', cur.id::text, v_users[2], 'company',
           'Proposition expirée', 'Proposal expired',
           'Sans deux acceptations avant le {due}, la proposition a expiré. Le dossier revient au fondateur.',
           'Without two acceptances before {due}, the proposal expired. The file goes back to the founder.',
           cur.respond_by) then
        v_count := v_count + 1;
      end if;
      v_count := v_count + public.interruption_notify_founders(x.id, 'proposal_expired', cur.id::text,
        'Proposition expirée', 'Proposal expired',
        'La version ' || cur.version || ' a expiré sans deux acceptations : le dossier revient à votre examen.',
        'Version ' || cur.version || ' expired without two acceptances: the file is back for your review.',
        cur.respond_by);
    end if;

    -- Délai du fondateur dépassé : rappel, jamais de décision.
    v_state := public.interruption_state(x.id, p_at);
    if v_state ->> 'stage' = 'founder_review' and (v_state ->> 'overdue')::boolean then
      v_count := v_count + public.interruption_notify_founders(x.id, 'founder_overdue',
        v_state ->> 'due_at',
        'Délai d''examen dépassé', 'Review deadline exceeded',
        'Le délai de 72 h pour traiter une interruption est dépassé depuis le {due} : clôture motivée ou prolongation exceptionnelle attendue.',
        'The 72-hour deadline to handle an interruption passed on {due}: a reasoned closure or an exceptional extension is expected.',
        (v_state ->> 'due_at')::timestamptz);
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.interruption_deadline_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.interruption_deadline_sweep(timestamptz) to service_role;

-- Nouvel élément après la clôture : recevable (lot 16), signalé au
-- fondateur pour examen, sans rouvrir le blocage ni le dossier.
create or replace function public.interruption_new_element()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.mission_incidents i
             join public.mission_interruption_closures c on c.incident_id = i.id
             where i.id = new.incident_id and i.kind = 'interruption') then
    perform public.interruption_notify_founders(new.incident_id, 'new_element', new.id::text,
      'Nouvel élément sur un dossier clos', 'New element on a closed file',
      'Une partie a déposé un nouvel élément sur une interruption close. Il est soumis à votre examen ; le dossier reste clos.',
      'A party submitted a new element on a closed interruption. It is submitted for your review; the file stays closed.');
  end if;
  return null;
end;
$$;
revoke all on function public.interruption_new_element() from public, anon, authenticated;
drop trigger if exists trg_interruption_new_statement on public.mission_incident_statements;
create trigger trg_interruption_new_statement
  after insert on public.mission_incident_statements
  for each row execute function public.interruption_new_element();
drop trigger if exists trg_interruption_new_evidence on public.mission_incident_evidence;
create trigger trg_interruption_new_evidence
  after insert on public.mission_incident_evidence
  for each row execute function public.interruption_new_element();

-- Tâche planifiée existante : même travail, plus les échéances des
-- interruptions (rappels seulement).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('reputation-expiry-sweep')
      where exists (select 1 from cron.job where jobname = 'reputation-expiry-sweep');
      perform cron.schedule(
        'reputation-expiry-sweep',
        '*/15 * * * *',
        $cron$select public.reputation_expiry_sweep(); select public.incident_deadline_sweep(); select public.account_suspension_sweep(); select public.interruption_deadline_sweep();$cron$
      );
    exception when others then
      raise notice 'pg_cron : interruption_deadline_sweep à planifier manuellement.';
    end;
  else
    raise notice 'pg_cron absent : interruption_deadline_sweep à planifier avec reputation_expiry_sweep.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 16. Signaux temps réel (domaines existants, charge utile {d, r})
-- ════════════════════════════════════════════════════════════════════
-- Parties et support pour toute ligne d'un dossier ; un avis destiné au
-- fondateur ne signale que le support.
create or replace function public.rt_on_interruption_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_incident uuid;
  v_mission uuid;
begin
  if tg_table_name = 'mission_interruption_responses' then
    select p.incident_id into v_incident from public.mission_interruption_proposals p
    where p.id = (v_row ->> 'proposal_id')::uuid;
  else
    v_incident := (v_row ->> 'incident_id')::uuid;
  end if;
  if not (tg_table_name = 'mission_interruption_notices' and v_row ->> 'recipient_role' = 'founder')
     and not (tg_table_name = 'mission_interruption_notices' and tg_op = 'UPDATE') then
    select i.mission_id into v_mission from public.mission_incidents i where i.id = v_incident;
    perform public.rt_signal_users(public.mission_incident_parties(v_incident), 'incidents', v_incident);
    perform public.rt_signal_users(public.mission_incident_parties(v_incident), 'missions', v_mission);
  end if;
  perform public.rt_signal_admin('incidents');
  return null;
end;
$$;
revoke all on function public.rt_on_interruption_rows() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['mission_interruption_versions', 'mission_interruption_proposals',
    'mission_interruption_responses', 'mission_interruption_closures',
    'mission_interruption_extensions', 'mission_interruption_recourses',
    'mission_interruption_notices', 'mission_interruption_reexaminations',
    'mission_interruption_closure_history'] loop
    execute format('drop trigger if exists trg_rt_%s on public.%I', t, t);
    execute format('create trigger trg_rt_%s after insert or update on public.%I '
                   'for each row execute function public.rt_on_interruption_rows()', t, t);
  end loop;
end $$;
