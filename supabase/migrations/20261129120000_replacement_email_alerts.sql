-- Migration : e-mails du recrutement de remplacement (lot 17d-4b)
-- Date : 2026-11-26 (date de rédaction ; l'horodatage ordonne seulement)
-- Tables affectées :
--   replacement_email_preferences, replacement_email_preference_events,
--   replacement_email_outbox, replacement_email_provider_events (nouvelles,
--   fermées aux sessions et aux écritures de la clé service) ;
--   replacement_cycle_notices (colonne email_intent) ;
--   replacement_cycle_events (nouvelles natures d'événement) ;
--   fonction reprise : replacement_cycle_alert (20261128120000).
--
-- Décisions (docs/product/DECISIONS.md) : ANN-14 (destinataires), ANN-20,
-- ANN-21 et ANN-22 (`[UV]` du 2026-11-26 : réponse « oui » à la proposition
-- de mise en œuvre de 17d-4b), DON-04, DON-06.
--
--   1. E-mail aux seuls candidats d'ANN-14, jamais à l'entreprise (elle
--      garde son avis dans l'application).
--   2. Activation explicite par le candidat, désactivable ; aucun
--      consentement rétroactif : seuls les avis émis pendant que la
--      préférence est active ouvrent une intention d'e-mail.
--   3. Intention durable : replacement_cycle_notices.email_intent, écrite
--      avec l'avis dans la transaction du désistement. La file
--      (replacement_email_outbox) en dérive dans un bloc protégé : un échec
--      d'écriture de la file n'annule ni le désistement, ni le cycle, ni
--      l'avis ; il est tracé (email_enqueue_failed) et repris par le
--      balayage (email_enqueue_recovered).
--   4. Revérification juste avant l'appel réseau (replacement_email_presend) :
--      cycle ouvert, places restantes, date non annulée, entreprise
--      autorisée, destinataire éligible et non confirmé, préférence active,
--      adresse confirmée. Aucune nouvelle tentative après la fermeture ; un
--      appel déjà parti peut être accepté ou livré après elle (course
--      résiduelle, documentée) : le lien relit l'état.
--   5. Issue incertaine (délai, réseau, 5xx, bail expiré pendant un appel) :
--      reprise avec la même clé d'idempotence et le même contenu (paramètres
--      de rendu figés, empreinte du message comparée) tant que la fenêtre du
--      fournisseur le permet (24 h chez Resend ; marge : 23 h après la
--      première tentative), puis état « inconnu ». Contenu changé (adresse,
--      configuration, modèle) : reprise refusée, état « inconnu », aucune
--      nouvelle clé.
--   6. États distincts : en attente, accepté par le fournisseur, livré
--      (serveur du destinataire), échec, annulé avant envoi, inconnu. La
--      lecture n'est jamais suivie ni déduite.
--   7. Événements du fournisseur : authenticité vérifiée par la route
--      (signature) ; appliqués seulement à un véritable envoi d'alerte
--      (étiquette et identifiant du fournisseur concordants), sinon ignorés
--      sans écriture ; dédoublonnés ; sans retour en arrière.
--   8. ANN-22 : avis (application et e-mail) retenus si le dossier de
--      l'entreprise n'est pas valide ou si son compte est suspendu ; au
--      rétablissement, envoyés une fois aux destinataires encore éligibles
--      si le cycle est ouvert et a des places ; aucune prolongation. Les
--      droits de lecture, de candidature et de sélection sont inchangés.
--   9. Conservation : lignes d'envoi (et leurs événements) effacées
--      90 jours après la création de la ligne, quel que soit leur état ;
--      aucune adresse, aucun objet ni corps stockés ; paramètres publics de
--      rendu et empreinte du message effacés dès qu'aucune reprise n'est
--      possible, et au plus tard avec la ligne. Une intention plus ancienne
--      que l'horizon ne recrée jamais un envoi.
--  10. Planification : le balayage SQL (pg_cron, chaque minute) est installé
--      par cette migration là où pg_cron existe ; il n'appelle jamais le
--      fournisseur. L'appel de l'API Resend est fait par le serveur (route
--      interne ou réveil après un désistement).
--
-- Rollback :
--   select cron.unschedule('replacement-email-sweep') ;
--   recréer replacement_cycle_alert depuis 20261128120000 ;
--   drop function … (fonctions créées ci-dessous, dont replacement_email_presend) ;
--   drop table public.replacement_email_provider_events,
--     public.replacement_email_outbox, public.replacement_email_preference_events,
--     public.replacement_email_preferences ;
--   alter table public.replacement_cycle_notices drop column email_intent ;
--   remettre la contrainte replacement_cycle_events_kind_check de 20261128120000.

-- ════════════════════════════════════════════════════════════════════
-- 1. Préférence du candidat (activation explicite)
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.replacement_email_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  disabled_at timestamptz,
  consent_version text,
  updated_at timestamptz not null default now(),
  constraint replacement_email_preferences_consent_chk check (
    not enabled or (enabled_at is not null and consent_version is not null))
);

-- Historique des choix (ajout seul) : preuve de l'activation et du retrait.
create table if not exists public.replacement_email_preference_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  enabled boolean not null,
  consent_version text,
  created_at timestamptz not null default now()
);
create index if not exists idx_replacement_email_preference_events_user
  on public.replacement_email_preference_events (user_id, created_at);

-- ════════════════════════════════════════════════════════════════════
-- 2. Intention durable et file d'envoi
-- ════════════════════════════════════════════════════════════════════
alter table public.replacement_cycle_notices
  add column if not exists email_intent boolean not null default false;
comment on column public.replacement_cycle_notices.email_intent is
  'Lot 17d-4b : avis émis alors que le candidat avait activé les e-mails de remplacement (ANN-21). Source durable dont la file d''envoi est dérivée et reprise.';
create index if not exists idx_replacement_cycle_notices_email_intent
  on public.replacement_cycle_notices (cycle_id) where email_intent;

alter table public.replacement_cycle_events drop constraint if exists replacement_cycle_events_kind_check;
alter table public.replacement_cycle_events add constraint replacement_cycle_events_kind_check check (
  kind in ('opened', 'place_added', 'alerts_sent', 'alerts_withheld', 'place_filled', 'company_cancelled',
           'alerts_resumed', 'email_enqueue_failed', 'email_enqueue_recovered'));

create table if not exists public.replacement_email_outbox (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.replacement_cycles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'candidate_alert' check (kind = 'candidate_alert'),
  -- pending : pas encore accepté ; accepted : accepté par le fournisseur
  -- (ne prouve pas la remise) ; delivered : accepté par le serveur du
  -- destinataire (ne prouve pas la lecture) ; failed ; cancelled : jamais
  -- transmis ; unknown : issue impossible à établir sans risque de doublon.
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'delivered', 'failed', 'cancelled', 'unknown')),
  status_code text check (status_code ~ '^[a-z0-9_]{1,64}$'),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  first_attempt_at timestamptz,
  last_attempt_at timestamptz,
  -- Première tentative dont l'issue est incertaine : à partir de là, seule
  -- la même clé d'idempotence peut être renvoyée, dans sa fenêtre.
  uncertain_since timestamptz,
  provider_message_id text unique check (provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  -- Paramètres publics de rendu figés à la première tentative (même contenu
  -- à chaque reprise) ; effacés dès que plus aucun envoi n'est possible.
  render jsonb,
  -- Appel réseau en cours (posé par replacement_email_presend, levé par
  -- l'issue) : seul un bail expiré pendant un appel rend l'issue incertaine.
  in_flight boolean not null default false,
  -- Empreinte SHA-256 du message complet de la première tentative (voir
  -- replacement_email_presend) : refuse une reprise dont le contenu a
  -- changé. Effacée dès qu'aucune reprise n'est possible.
  payload_digest text check (payload_digest ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz,
  delivered_at timestamptz,
  complained_at timestamptz,
  provider_event_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint replacement_email_outbox_key unique (cycle_id, user_id, kind),
  constraint replacement_email_outbox_lease_chk check ((lease_until is null) = (lease_token is null))
);
create index if not exists idx_replacement_email_outbox_due
  on public.replacement_email_outbox (next_attempt_at) where status = 'pending';
create index if not exists idx_replacement_email_outbox_user
  on public.replacement_email_outbox (user_id) where status = 'pending';
create index if not exists idx_replacement_email_outbox_created
  on public.replacement_email_outbox (created_at);

-- Événements du fournisseur, un par identifiant (svix-id) : dédoublonnage.
create table if not exists public.replacement_email_provider_events (
  event_id text primary key check (event_id ~ '^[A-Za-z0-9_.-]{1,128}$'),
  outbox_id uuid references public.replacement_email_outbox(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z_.]{1,64}$'),
  occurred_at timestamptz not null,
  effect text not null default 'pending',
  received_at timestamptz not null default now()
);
create index if not exists idx_replacement_email_provider_events_received
  on public.replacement_email_provider_events (received_at);

do $$
declare
  t text;
begin
  foreach t in array array['replacement_email_preferences', 'replacement_email_preference_events',
                           'replacement_email_outbox', 'replacement_email_provider_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from service_role', t);
  end loop;
end $$;

-- Écrites par les seules fonctions de la base (clé service comprise).
create or replace function public.protect_replacement_email_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception '%: written by the database only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and tg_table_name = 'replacement_email_preference_events' then
    raise exception '%: rows are immutable', tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.protect_replacement_email_writes() from public, anon, authenticated, service_role;

do $$
declare
  t text;
begin
  foreach t in array array['replacement_email_preferences', 'replacement_email_preference_events',
                           'replacement_email_outbox', 'replacement_email_provider_events'] loop
    execute format('drop trigger if exists trg_protect_%s on public.%I', t, t);
    execute format('create trigger trg_protect_%s before insert or update or delete on public.%I '
                   'for each row execute function public.protect_replacement_email_writes()', t, t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 3. Outils communs
-- ════════════════════════════════════════════════════════════════════
-- Version du texte d'activation accepté par le candidat.
create or replace function public.replacement_email_consent_version()
returns text
language sql
immutable
set search_path = ''
as $$ select 'replacement-email-v1'::text $$;
grant execute on function public.replacement_email_consent_version() to authenticated, service_role;

-- Adresse de connexion confirmée (null : aucune). Lue au moment de l'envoi,
-- jamais copiée dans la file.
create or replace function public.replacement_email_address(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select au.email::text from auth.users au
  where au.id = p_user_id and au.email is not null and au.email <> ''
    and au.email_confirmed_at is not null;
$$;
revoke all on function public.replacement_email_address(uuid) from public, anon, authenticated, service_role;

-- Préférence active et adresse confirmée.
create or replace function public.replacement_email_wanted(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.replacement_email_preferences p
                 where p.user_id = p_user_id and p.enabled)
     and public.replacement_email_address(p_user_id) is not null;
$$;
revoke all on function public.replacement_email_wanted(uuid) from public, anon, authenticated, service_role;

-- ANN-22 : l'entreprise peut-elle déclencher des avis ? Dossier valide
-- (mêmes règles que la visibilité et la candidature) et compte non suspendu
-- (mêmes règles que la sélection : selection_company_of).
create or replace function public.replacement_company_can_alert(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select cp.is_active is not false and u.is_active is not false
           and public.company_dossier_valid(cp.id)
    from public.company_profiles cp
    join public.users u on u.id = cp.user_id
    where cp.id = p_company_id), false);
$$;
revoke all on function public.replacement_company_can_alert(uuid) from public, anon, authenticated, service_role;

-- Fin d'une ligne : état final, motif, bail et paramètres de rendu effacés.
-- Une ligne dont une tentative a une issue incertaine ne peut pas être dite
-- « annulée avant envoi » : elle devient « inconnue ».
create or replace function public.replacement_email_finalize(
  p_outbox_id uuid, p_status text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.replacement_email_outbox o
  set status = case when p_status = 'cancelled' and o.uncertain_since is not null
                    then 'unknown' else p_status end,
      status_code = p_code,
      lease_until = null, lease_token = null, in_flight = false,
      render = null, payload_digest = null,
      finalized_at = now(), updated_at = now()
  where o.id = p_outbox_id;
end;
$$;
revoke all on function public.replacement_email_finalize(uuid, text, text) from public, anon, authenticated, service_role;

-- Délai avant la tentative suivante.
create or replace function public.replacement_email_backoff(p_attempts integer)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_attempts <= 1 then interval '1 minute'
    when p_attempts = 2 then interval '5 minutes'
    when p_attempts = 3 then interval '15 minutes'
    when p_attempts = 4 then interval '30 minutes'
    else interval '60 minutes' end;
$$;
revoke all on function public.replacement_email_backoff(integer) from public, anon, authenticated;

-- Motif qui interdit l'envoi maintenant (null : envoi permis).
-- « company_unavailable » est le seul motif provisoire (ANN-22 : la ligne
-- attend un rétablissement) ; les autres sont définitifs.
create or replace function public.replacement_email_blocker(p_outbox public.replacement_email_outbox)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cycle public.replacement_cycles;
  v_state text;
  v_candidate uuid;
begin
  select c.* into v_cycle from public.replacement_cycles c where c.id = p_outbox.cycle_id;
  if not found then
    return 'cycle_closed';
  end if;
  v_state := public.replacement_cycle_state(v_cycle, now());
  if v_state = 'closed' then return 'cycle_closed'; end if;
  if v_state = 'filled' then return 'cycle_filled'; end if;
  if v_state = 'cancelled' then return 'date_cancelled'; end if;
  if v_state = 'job_closed' then return 'job_closed'; end if;
  if v_state = 'unavailable' or not public.replacement_company_can_alert(v_cycle.company_id) then
    return 'company_unavailable';
  end if;
  if not exists (select 1 from public.replacement_email_preferences p
                 where p.user_id = p_outbox.user_id and p.enabled) then
    return 'opted_out';
  end if;
  if public.replacement_email_address(p_outbox.user_id) is null then
    return 'no_email';
  end if;
  select cp.id into v_candidate from public.candidate_profiles cp where cp.user_id = p_outbox.user_id;
  if v_candidate is null then
    return 'recipient_ineligible';
  end if;
  -- Intérêt déjà confirmé (ou retiré) dans ce cycle : l'alerte n'a plus d'objet.
  if exists (select 1 from public.job_applications x
             where x.replacement_cycle_id = v_cycle.id and x.candidate_id = v_candidate) then
    return 'already_confirmed';
  end if;
  -- Toujours un destinataire d'ANN-14 : candidature en attente ou refusée
  -- sur la portée, et éligible (profil, compte, CNI, documents, marge de 3 h).
  if not exists (select 1 from public.job_applications a
                 where a.candidate_id = v_candidate and a.replacement_cycle_id is null
                   and public.replacement_scope_matches(v_cycle, a.job_id, a.job_day_id)
                   and a.status in ('pending', 'shortlisted', 'rejected'))
     or public.replacement_candidate_blocker(v_candidate, v_cycle) is not null then
    return 'recipient_ineligible';
  end if;
  return null;
end;
$$;
revoke all on function public.replacement_email_blocker(public.replacement_email_outbox) from public, anon, authenticated, service_role;

-- Paramètres publics de rendu : offre, ville, journées de la portée,
-- fermeture du cycle, langue du destinataire. Aucune donnée privée.
create or replace function public.replacement_email_render(p_outbox public.replacement_email_outbox)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'locale', coalesce((select u.locale::text from public.users u where u.id = p_outbox.user_id), 'fr'),
    'job_id', j.id,
    'title', j.title,
    'city', j.city,
    'closes_at', c.closes_at,
    'days', case when c.job_day_id is not null then
        (select jsonb_agg(jsonb_build_object('starts_at', d.starts_at, 'ends_at', d.ends_at))
         from public.job_days d where d.id = c.job_day_id)
      else
        (select jsonb_agg(jsonb_build_object('starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.starts_at)
         from public.job_effective_days(j.id) e)
      end)
  from public.replacement_cycles c
  join public.jobs j on j.id = c.job_id
  where c.id = p_outbox.cycle_id;
$$;
revoke all on function public.replacement_email_render(public.replacement_email_outbox) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 4. Avis (ANN-14, ANN-22) et intention d'e-mail
-- ════════════════════════════════════════════════════════════════════
create or replace function public.replacement_cycle_alert(p_cycle_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.replacement_cycles;
  v_job public.jobs;
  v_company_user uuid;
  v_rows integer;
  v_count integer := 0;
  v_intent boolean;
  v_when_fr text;
  v_when_en text;
  v_close_fr text;
  v_close_en text;
  r record;
begin
  select c.* into v_cycle from public.replacement_cycles c where c.id = p_cycle_id;
  select j.* into v_job from public.jobs j where j.id = v_cycle.job_id;
  select cp.user_id into v_company_user
  from public.company_profiles cp where cp.id = v_job.company_id;

  -- ANN-22 (`[UV]` 2026-11-26) : dossier non valide ou compte suspendu →
  -- aucun avis, ni dans l'application ni par e-mail. Le cycle reste tracé et
  -- sa fenêtre inchangée ; replacement_alerts_resume envoie les avis encore
  -- pertinents au rétablissement. Lecture, candidature et sélection suivent
  -- leurs règles propres, inchangées.
  if not public.replacement_company_can_alert(v_job.company_id) then
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'alerts_withheld', jsonb_build_object('reason',
      case when public.company_dossier_valid(v_job.company_id) then 'company_suspended'
           else 'company_dossier_invalid' end));
    return 0;
  end if;
  if public.replacement_cycle_state(v_cycle, now()) <> 'open' then
    return 0;
  end if;

  v_when_fr := case when v_cycle.job_day_id is not null
    then 'le ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI')
    else 'à partir du ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI') end;
  v_when_en := case when v_cycle.job_day_id is not null
    then 'on ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI')
    else 'from ' || to_char(v_cycle.starts_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI') end;
  v_close_fr := to_char(v_cycle.closes_at at time zone 'Africa/Douala', 'DD/MM/YYYY à HH24:MI');
  v_close_en := to_char(v_cycle.closes_at at time zone 'Africa/Douala', 'YYYY-MM-DD at HH24:MI');

  insert into public.replacement_cycle_notices (cycle_id, user_id, kind)
  values (v_cycle.id, v_company_user, 'company_opened')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.incident_notify(v_company_user,
      'Recrutement de remplacement ouvert', 'Replacement recruitment open',
      'Une place s''est libérée sur « ' || v_job.title || ' » (' || v_when_fr
        || '). Vous pouvez sélectionner un candidat qui confirme son intérêt jusqu''au '
        || v_close_fr || ' (heure de Douala).',
      'A place became free on "' || v_job.title || '" (' || v_when_en
        || '). You can select a candidate who confirms their interest until '
        || v_close_en || ' (Douala time).',
      jsonb_build_object('kind', 'replacement_cycle', 'job_id', v_job.id,
                         'cycle_id', v_cycle.id, 'href', '/company/jobs/' || v_job.id));
  end if;

  -- Destinataires (ANN-14) : candidature en attente non sélectionnée, ou
  -- refusée par l'entreprise, sur la portée, encore éligible et disponible.
  for r in
    select distinct cp.id as candidate_id, cp.user_id
    from public.job_applications a
    join public.candidate_profiles cp on cp.id = a.candidate_id
    where a.replacement_cycle_id is null
      and public.replacement_scope_matches(v_cycle, a.job_id, a.job_day_id)
      and a.status in ('pending', 'shortlisted', 'rejected')
      and not exists (select 1 from public.job_applications x
                      where x.replacement_cycle_id = v_cycle.id and x.candidate_id = cp.id)
      and public.replacement_candidate_blocker(cp.id, v_cycle) is null
    order by cp.id
  loop
    -- Intention d'e-mail : préférence active au moment de l'avis (aucun
    -- consentement rétroactif). Une lecture en échec ne doit ni bloquer le
    -- désistement ni perdre l'intention : elle est alors posée, et la
    -- préférence est revérifiée avant tout envoi.
    begin
      v_intent := public.replacement_email_wanted(r.user_id);
    exception when others then
      v_intent := true;
    end;
    insert into public.replacement_cycle_notices (cycle_id, user_id, kind, email_intent)
    values (v_cycle.id, r.user_id, 'candidate_alert', coalesce(v_intent, false))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      v_count := v_count + 1;
      perform public.incident_notify(r.user_id,
        'Une place s''est libérée', 'A place became free',
        '« ' || v_job.title || ' » : une place est de nouveau disponible (' || v_when_fr
          || ', heure de Douala). Si elle vous intéresse toujours, confirmez votre intérêt avant le '
          || v_close_fr || ' : l''entreprise choisit parmi les candidats qui confirment. '
          || 'Votre ancienne candidature n''est pas réactivée.',
        '"' || v_job.title || '": a place is available again (' || v_when_en
          || ', Douala time). If you are still interested, confirm your interest before '
          || v_close_en || ': the company chooses among the candidates who confirm. '
          || 'Your previous application is not reactivated.',
        jsonb_build_object('kind', 'replacement_cycle', 'job_id', v_job.id,
                           'cycle_id', v_cycle.id, 'href', '/jobs/' || v_job.id));
      if coalesce(v_intent, false) then
        -- Mise en file isolée : un échec annule seulement ce bloc.
        begin
          insert into public.replacement_email_outbox (cycle_id, user_id, kind)
          values (v_cycle.id, r.user_id, 'candidate_alert')
          on conflict do nothing;
        exception when others then
          begin
            insert into public.replacement_cycle_events (cycle_id, kind, detail)
            values (v_cycle.id, 'email_enqueue_failed', jsonb_build_object('sqlstate', sqlstate));
          exception when others then
            null; -- l'intention reste dans replacement_cycle_notices
          end;
        end;
      end if;
    end if;
  end loop;

  insert into public.replacement_cycle_events (cycle_id, kind, detail)
  values (v_cycle.id, 'alerts_sent', jsonb_build_object('candidates', v_count));
  return v_count;
end;
$$;
revoke all on function public.replacement_cycle_alert(uuid) from public, anon, authenticated, service_role;

-- Cycle dont les avis ont été retenus depuis le dernier envoi.
create or replace function public.replacement_alerts_pending(p_cycle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.replacement_cycle_events e
    where e.cycle_id = p_cycle_id and e.kind = 'alerts_withheld'
      and e.created_at > coalesce((select max(s.created_at) from public.replacement_cycle_events s
                                   where s.cycle_id = p_cycle_id and s.kind = 'alerts_sent'),
                                  '-infinity'::timestamptz));
$$;
revoke all on function public.replacement_alerts_pending(uuid) from public, anon, authenticated, service_role;

-- ANN-22 : rétablissement (dossier revalidé, suspension levée). Avis aux
-- destinataires encore éligibles si le cycle est ouvert et a des places ;
-- dédoublonnés par replacement_cycle_notices ; fenêtre inchangée.
create or replace function public.replacement_alerts_resume()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_cycle public.replacement_cycles;
  v_count integer := 0;
begin
  for r in
    select c.id from public.replacement_cycles c
    where c.cancelled_at is null and c.closes_at > now()
      and public.replacement_alerts_pending(c.id)
    order by c.closes_at
  loop
    select c.* into v_cycle from public.replacement_cycles c where c.id = r.id for update skip locked;
    if not found then
      continue;
    end if;
    -- Relecture sous verrou (balayages concurrents, désistement en cours).
    if not public.replacement_alerts_pending(v_cycle.id)
       or public.replacement_cycle_state(v_cycle, now()) <> 'open'
       or not public.replacement_company_can_alert(v_cycle.company_id) then
      continue;
    end if;
    insert into public.replacement_cycle_events (cycle_id, kind, detail)
    values (v_cycle.id, 'alerts_resumed', '{}'::jsonb);
    v_count := v_count + coalesce(public.replacement_cycle_alert(v_cycle.id), 0);
  end loop;
  return v_count;
end;
$$;
revoke all on function public.replacement_alerts_resume() from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════
-- 5. Préférence : lecture et choix (session du candidat)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.my_replacement_email_preference()
returns table (enabled boolean, enabled_at timestamptz, email_confirmed boolean, consent_version text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('candidate', 'candidate_premium') then
    raise exception 'not_a_candidate' using errcode = '42501';
  end if;
  return query
  select coalesce(p.enabled, false), case when p.enabled then p.enabled_at end,
         public.replacement_email_address(v_uid) is not null,
         public.replacement_email_consent_version()
  from (select 1) one
  left join public.replacement_email_preferences p on p.user_id = v_uid;
end;
$$;
revoke all on function public.my_replacement_email_preference() from public, anon;
grant execute on function public.my_replacement_email_preference() to authenticated;

create or replace function public.set_replacement_email_alerts(p_enabled boolean, p_consent_version text)
returns table (enabled boolean, enabled_at timestamptz, changed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_pref public.replacement_email_preferences;
  r record;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if v_role is null or v_role not in ('candidate', 'candidate_premium') then
    raise exception 'not_a_candidate' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_preference' using errcode = '22023';
  end if;
  if p_enabled and p_consent_version is distinct from public.replacement_email_consent_version() then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  if p_enabled and public.replacement_email_address(v_uid) is null then
    raise exception 'email_missing' using errcode = '22023';
  end if;

  select p.* into v_pref from public.replacement_email_preferences p where p.user_id = v_uid for update;
  if (found and v_pref.enabled = p_enabled) or (not found and not p_enabled) then
    return query select p_enabled, case when p_enabled then v_pref.enabled_at end, false;
    return;
  end if;

  insert into public.replacement_email_preferences as p
    (user_id, enabled, enabled_at, disabled_at, consent_version, updated_at)
  values (v_uid, p_enabled, case when p_enabled then now() end, case when not p_enabled then now() end,
          case when p_enabled then p_consent_version end, now())
  on conflict (user_id) do update set
    enabled = excluded.enabled,
    enabled_at = case when excluded.enabled then now() else p.enabled_at end,
    disabled_at = case when excluded.enabled then p.disabled_at else now() end,
    consent_version = case when excluded.enabled then excluded.consent_version else p.consent_version end,
    updated_at = now()
  returning * into v_pref;

  insert into public.replacement_email_preference_events (user_id, enabled, consent_version)
  values (v_uid, p_enabled, case when p_enabled then p_consent_version end);

  -- Retrait : rien de ce qui n'a pas encore été transmis ne part. Une
  -- tentative déjà en cours (bail actif) ne peut plus être retenue ; son
  -- issue est enregistrée telle quelle.
  if not p_enabled then
    for r in
      select o.id from public.replacement_email_outbox o
      where o.user_id = v_uid and o.status = 'pending'
        and (o.lease_until is null or o.lease_until < now())
      for update
    loop
      perform public.replacement_email_finalize(r.id, 'cancelled', 'opted_out');
    end loop;
  end if;

  return query select v_pref.enabled, case when v_pref.enabled then v_pref.enabled_at end, true;
end;
$$;
revoke all on function public.set_replacement_email_alerts(boolean, text) from public, anon;
grant execute on function public.set_replacement_email_alerts(boolean, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 6. Envoi : revendication, contrôle juste avant l'appel, issue
--    (serveur, clé service)
-- ════════════════════════════════════════════════════════════════════
-- Trois temps distincts :
--   1. replacement_email_claim : revendication (bail) de lignes dues,
--      premier tri ; aucune tentative n'est comptée ;
--   2. replacement_email_presend : appelée pour une ligne juste avant
--      l'appel réseau ; revérifie tout (cycle, places, date, entreprise,
--      destinataire, préférence, adresse, fenêtre d'idempotence), lie
--      l'empreinte du contenu, compte la tentative et marque l'appel « en
--      vol » ;
--   3. replacement_email_record : issue de l'appel.
-- Course résiduelle, non supprimable : entre presend et l'acceptation par
-- le fournisseur (durée de l'appel, 10 s au plus), puis entre
-- l'acceptation et la remise, le cycle peut fermer ; un message déjà parti
-- peut donc être accepté ou livré après la fermeture. Le lien relit l'état.

-- Revendique jusqu'à p_limit lignes dues. Renvoie l'adresse (lue, jamais
-- stockée), les paramètres de rendu figés à la première revendication et
-- la clé d'idempotence stable (identifiant de la ligne).
create or replace function public.replacement_email_claim(p_limit integer default 20, p_lease_seconds integer default 120)
returns table (outbox_id uuid, lease_token uuid, idempotency_key text, to_email text,
               render jsonb, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r public.replacement_email_outbox;
  v_block text;
  v_token uuid;
  v_render jsonb;
  v_email text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid_claim' using errcode = '22023';
  end if;
  for r in
    select o.* from public.replacement_email_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
      and (o.lease_until is null or o.lease_until < now())
    order by o.next_attempt_at
    limit p_limit
    for update skip locked
  loop
    -- Bail expiré : incertain seulement si un appel était en vol.
    if r.lease_until is not null then
      if r.in_flight then
        r.uncertain_since := coalesce(r.uncertain_since, r.lease_until);
      end if;
      update public.replacement_email_outbox o
      set uncertain_since = r.uncertain_since, lease_until = null, lease_token = null,
          in_flight = false, status_code = case when r.in_flight then 'lease_expired' else o.status_code end,
          updated_at = now()
      where o.id = r.id;
    end if;
    if r.uncertain_since is not null and now() >= r.first_attempt_at + interval '23 hours' then
      perform public.replacement_email_finalize(r.id, 'unknown', 'idempotency_window_elapsed');
      continue;
    end if;
    v_block := public.replacement_email_blocker(r);
    if v_block = 'company_unavailable' then
      update public.replacement_email_outbox o
      set next_attempt_at = now() + interval '5 minutes', status_code = v_block, updated_at = now()
      where o.id = r.id;
      continue;
    elsif v_block is not null then
      perform public.replacement_email_finalize(r.id, 'cancelled', v_block);
      continue;
    end if;
    v_email := public.replacement_email_address(r.user_id);
    v_render := coalesce(r.render, public.replacement_email_render(r));
    v_token := gen_random_uuid();
    update public.replacement_email_outbox o
    set lease_until = now() + make_interval(secs => p_lease_seconds), lease_token = v_token,
        render = v_render, updated_at = now()
    where o.id = r.id;
    outbox_id := r.id;
    lease_token := v_token;
    idempotency_key := 'replacement-alert/' || r.id::text;
    to_email := v_email;
    render := v_render;
    attempt := r.attempts + 1;
    return next;
  end loop;
end;
$$;
revoke all on function public.replacement_email_claim(integer, integer) from public, anon, authenticated;
grant execute on function public.replacement_email_claim(integer, integer) to service_role;

-- Contrôle juste avant l'appel réseau. Résultats : ok (appel permis,
-- tentative comptée, ligne « en vol ») ; stale_lease (bail perdu ou
-- expiré : ne pas appeler) ; payload_changed (une tentative précédente a
-- une issue incertaine et le contenu à envoyer diffère : reprise
-- incohérente refusée, état « inconnu », aucune nouvelle clé) ;
-- idempotency_window_elapsed ; ou le motif de blocage (ligne annulée, ou
-- différée si l'entreprise n'est pas autorisée).
-- p_payload_digest : SHA-256 (hex) du message complet (destinataire,
-- expéditeur, réponse, objet, textes, étiquettes, clé) calculé par le
-- serveur. Nécessité : refuser localement une reprise dont le contenu a
-- changé (adresse, configuration, modèle). Pseudonyme : conservé seulement
-- tant qu'une reprise est possible, effacé à tout état final ou accepté,
-- et au plus tard avec la ligne, 90 jours après sa création.
create or replace function public.replacement_email_presend(
  p_outbox_id uuid, p_lease_token uuid, p_payload_digest text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.replacement_email_outbox;
  v_block text;
begin
  if p_payload_digest is null or p_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_digest' using errcode = '22023';
  end if;
  select o.* into v from public.replacement_email_outbox o where o.id = p_outbox_id for update;
  if not found or v.status <> 'pending' or v.lease_token is distinct from p_lease_token
     or v.lease_until is null or v.lease_until <= now() or v.in_flight then
    return 'stale_lease';
  end if;
  if v.uncertain_since is not null and now() >= v.first_attempt_at + interval '23 hours' then
    perform public.replacement_email_finalize(v.id, 'unknown', 'idempotency_window_elapsed');
    return 'idempotency_window_elapsed';
  end if;
  v_block := public.replacement_email_blocker(v);
  if v_block = 'company_unavailable' then
    update public.replacement_email_outbox o
    set next_attempt_at = now() + interval '5 minutes', status_code = v_block,
        lease_until = null, lease_token = null, updated_at = now()
    where o.id = v.id;
    return v_block;
  elsif v_block is not null then
    perform public.replacement_email_finalize(v.id, 'cancelled', v_block);
    return v_block;
  end if;
  if v.uncertain_since is not null and v.payload_digest is not null
     and v.payload_digest <> p_payload_digest then
    perform public.replacement_email_finalize(v.id, 'unknown', 'payload_changed');
    return 'payload_changed';
  end if;
  update public.replacement_email_outbox o
  set payload_digest = p_payload_digest, in_flight = true,
      attempts = o.attempts + 1, first_attempt_at = coalesce(o.first_attempt_at, now()),
      last_attempt_at = now(), updated_at = now()
  where o.id = v.id;
  return 'ok';
end;
$$;
revoke all on function public.replacement_email_presend(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.replacement_email_presend(uuid, uuid, text) to service_role;

-- Issue d'une tentative :
--   accepted      : identifiant du fournisseur reçu ;
--   retry         : refus sans traitement (429) : nouvelle tentative ;
--   uncertain     : délai, réseau, 5xx, requête concurrente en cours ;
--   failed        : refus définitif (4xx) ;
--   indeterminate : le fournisseur a déjà traité cette clé avec un autre
--                   contenu : envoi passé possible, aucune relance ;
--   blocked       : refus local avant tout appel (liste d'autorisation d'essai).
create or replace function public.replacement_email_record(
  p_outbox_id uuid, p_lease_token uuid, p_outcome text,
  p_provider_id text default null, p_code text default null, p_retry_after_seconds integer default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.replacement_email_outbox;
  v_uncertain timestamptz;
  v_next timestamptz;
begin
  if p_outcome is null or p_outcome not in ('accepted', 'retry', 'uncertain', 'failed', 'indeterminate', 'blocked') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  if p_provider_id is not null and p_provider_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'invalid_provider_id' using errcode = '22023';
  end if;
  select o.* into v from public.replacement_email_outbox o where o.id = p_outbox_id for update;
  if not found then
    return 'not_found';
  end if;

  if p_outcome = 'accepted' then
    if p_provider_id is null then
      raise exception 'provider_id_required' using errcode = '22023';
    end if;
    -- Une acceptation ne vaut que pour une tentative réellement faite.
    if v.first_attempt_at is null then
      return 'stale_lease';
    end if;
    -- Identifiant différent déjà lié (par un événement) : rien ne change.
    if v.provider_message_id is not null and v.provider_message_id <> p_provider_id then
      return 'provider_mismatch';
    end if;
    -- L'acceptation est un fait : elle s'applique même après l'expiration du
    -- bail (même clé, même réponse du fournisseur).
    if v.status in ('pending', 'unknown', 'cancelled') then
      update public.replacement_email_outbox o
      set status = 'accepted', provider_message_id = coalesce(o.provider_message_id, p_provider_id),
          accepted_at = coalesce(o.accepted_at, now()), status_code = null,
          lease_until = null, lease_token = null, in_flight = false,
          render = null, payload_digest = null, updated_at = now()
      where o.id = v.id;
      return 'applied';
    end if;
    -- Un événement du fournisseur est arrivé avant la réponse : rien ne recule.
    update public.replacement_email_outbox o
    set provider_message_id = coalesce(o.provider_message_id, p_provider_id),
        lease_until = null, lease_token = null, in_flight = false, updated_at = now()
    where o.id = v.id;
    return 'already_recorded';
  end if;

  if v.status <> 'pending' or v.lease_token is distinct from p_lease_token then
    return 'stale_lease';
  end if;
  if p_outcome = 'blocked' then
    perform public.replacement_email_finalize(v.id, 'cancelled', coalesce(p_code, 'blocked'));
    return 'applied';
  end if;
  -- Les autres issues suivent un appel, donc un passage par presend.
  if not v.in_flight then
    return 'stale_lease';
  end if;
  if p_outcome = 'failed' then
    perform public.replacement_email_finalize(v.id, 'failed', coalesce(p_code, 'provider_rejected'));
    return 'applied';
  elsif p_outcome = 'indeterminate' then
    perform public.replacement_email_finalize(v.id, 'unknown', coalesce(p_code, 'idempotency_conflict'));
    return 'applied';
  end if;

  v_uncertain := case when p_outcome = 'uncertain' then coalesce(v.uncertain_since, now()) else v.uncertain_since end;
  v_next := now() + greatest(public.replacement_email_backoff(v.attempts),
                             make_interval(secs => least(greatest(coalesce(p_retry_after_seconds, 0), 0), 3600)));
  update public.replacement_email_outbox o
  set uncertain_since = v_uncertain, status_code = coalesce(p_code, p_outcome),
      lease_until = null, lease_token = null, in_flight = false, next_attempt_at = v_next, updated_at = now()
  where o.id = v.id;
  if v.attempts >= 10 then
    perform public.replacement_email_finalize(v.id, case when v_uncertain is null then 'failed' else 'unknown' end,
                                              'retries_exhausted');
  elsif v_uncertain is not null and v_next >= v.first_attempt_at + interval '23 hours' then
    perform public.replacement_email_finalize(v.id, 'unknown', 'idempotency_window_elapsed');
  end if;
  return 'applied';
end;
$$;
revoke all on function public.replacement_email_record(uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.replacement_email_record(uuid, uuid, text, text, text, integer) to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 7. Événements du fournisseur (signature vérifiée par la route)
-- ════════════════════════════════════════════════════════════════════
-- Un événement ne s'applique qu'à un véritable envoi d'alerte : étiquette
-- `outbox_id` d'une ligne existante dont une tentative a été faite, et
-- identifiant du fournisseur égal à celui de la ligne (ou, si la réponse
-- HTTP n'est pas encore enregistrée, libre et alors lié). Tout autre
-- événement (authentification, identifiant inconnu, incohérent, ligne
-- purgée) est ignoré **sans aucune écriture**. Les événements retenus sont
-- dédoublonnés par identifiant et appliqués sans retour en arrière :
-- accepté → livré ; échec (rebond, refus, suppression) final, sauf s'il
-- précède une remise plus récente ; plainte notée sans changer l'état ;
-- ouverture et clic ignorés (suivi désactivé ; la lecture n'est jamais
-- déduite).
create or replace function public.replacement_email_provider_event(
  p_event_id text, p_type text, p_occurred_at timestamptz,
  p_provider_id text default null, p_outbox_id uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.replacement_email_outbox;
  v_rows integer;
  v_effect text;
begin
  if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.-]{1,128}$'
     or p_type is null or p_type !~ '^[a-z_.]{1,64}$' or p_occurred_at is null then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if p_provider_id is not null and p_provider_id !~ '^[A-Za-z0-9_-]{1,128}$' then
    raise exception 'invalid_provider_id' using errcode = '22023';
  end if;
  if p_outbox_id is null or p_provider_id is null then
    return 'ignored_unmatched';
  end if;
  select o.* into v from public.replacement_email_outbox o where o.id = p_outbox_id for update;
  if not found or v.first_attempt_at is null then
    return 'ignored_unmatched';
  end if;
  if v.provider_message_id is not null and v.provider_message_id <> p_provider_id then
    return 'ignored_mismatch';
  end if;
  if v.provider_message_id is null
     and exists (select 1 from public.replacement_email_outbox x
                 where x.provider_message_id = p_provider_id and x.id <> v.id) then
    return 'ignored_mismatch';
  end if;

  insert into public.replacement_email_provider_events (event_id, outbox_id, event_type, occurred_at)
  values (p_event_id, v.id, p_type, p_occurred_at)
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'duplicate';
  end if;

  if p_type in ('email.sent', 'email.delivery_delayed') then
    if v.status in ('pending', 'unknown', 'cancelled') then
      update public.replacement_email_outbox o
      set status = 'accepted', accepted_at = coalesce(o.accepted_at, p_occurred_at),
          provider_message_id = coalesce(o.provider_message_id, p_provider_id),
          provider_event_at = greatest(o.provider_event_at, p_occurred_at), status_code = null,
          lease_until = null, lease_token = null, in_flight = false,
          render = null, payload_digest = null, finalized_at = null, updated_at = now()
      where o.id = v.id;
      v_effect := 'applied';
    else
      v_effect := 'ignored_stale';
    end if;
  elsif p_type = 'email.delivered' then
    if v.status in ('pending', 'unknown', 'cancelled', 'accepted')
       or (v.status = 'failed' and v.provider_event_at is not null and p_occurred_at > v.provider_event_at) then
      update public.replacement_email_outbox o
      set status = 'delivered', delivered_at = p_occurred_at,
          accepted_at = coalesce(o.accepted_at, p_occurred_at),
          provider_message_id = coalesce(o.provider_message_id, p_provider_id),
          provider_event_at = greatest(o.provider_event_at, p_occurred_at), status_code = null,
          lease_until = null, lease_token = null, in_flight = false,
          render = null, payload_digest = null,
          finalized_at = coalesce(o.finalized_at, now()), updated_at = now()
      where o.id = v.id;
      v_effect := 'applied';
    else
      v_effect := 'ignored_stale';
    end if;
  elsif p_type in ('email.bounced', 'email.failed', 'email.suppressed') then
    if v.status in ('pending', 'unknown', 'cancelled', 'accepted')
       or (v.status = 'delivered' and p_occurred_at > v.delivered_at) then
      update public.replacement_email_outbox o
      set status = 'failed',
          status_code = case p_type when 'email.bounced' then 'bounced'
                                    when 'email.suppressed' then 'suppressed' else 'provider_failed' end,
          provider_message_id = coalesce(o.provider_message_id, p_provider_id),
          provider_event_at = greatest(o.provider_event_at, p_occurred_at),
          lease_until = null, lease_token = null, in_flight = false,
          render = null, payload_digest = null,
          finalized_at = coalesce(o.finalized_at, now()), updated_at = now()
      where o.id = v.id;
      v_effect := 'applied';
    else
      v_effect := 'ignored_stale';
    end if;
  elsif p_type = 'email.complained' then
    update public.replacement_email_outbox o
    set complained_at = coalesce(o.complained_at, p_occurred_at), updated_at = now()
    where o.id = v.id;
    v_effect := 'noted';
  else
    v_effect := 'ignored_type';
  end if;
  update public.replacement_email_provider_events set effect = v_effect where event_id = p_event_id;
  return v_effect;
end;
$$;
revoke all on function public.replacement_email_provider_event(text, text, timestamptz, text, uuid) from public, anon, authenticated;
grant execute on function public.replacement_email_provider_event(text, text, timestamptz, text, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════
-- 8. Balayage SQL (pg_cron) : rétablissements ANN-22, reprise des
--    intentions, fermetures, issues incertaines, conservation (90 jours).
--    Il n'appelle jamais le fournisseur.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.replacement_email_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Horizon unique de conservation : une ligne purgée a été créée avant
  -- lui, son intention aussi ; la reprise ne regarde que les intentions
  -- postérieures. Une intention conservée ne recrée donc jamais un envoi
  -- purgé (aucune nouvelle clé, aucun doublon).
  v_cutoff timestamptz := now() - interval '90 days';
  v_resumed integer;
  v_recovered integer := 0;
  v_closed integer := 0;
  v_unknown integer := 0;
  v_purged integer := 0;
  v_events integer := 0;
  v_block text;
  r record;
  v_row public.replacement_email_outbox;
begin
  v_resumed := public.replacement_alerts_resume();

  -- Intentions sans ligne de file (mise en file en échec) : reprises tant
  -- que le cycle peut encore recevoir des candidats.
  for r in
    select n.cycle_id, n.user_id
    from public.replacement_cycle_notices n
    join public.replacement_cycles c on c.id = n.cycle_id
    where n.email_intent and n.kind = 'candidate_alert' and c.closes_at > now()
      and n.created_at >= v_cutoff
      and not exists (select 1 from public.replacement_email_outbox o
                      where o.cycle_id = n.cycle_id and o.user_id = n.user_id and o.kind = 'candidate_alert')
  loop
    insert into public.replacement_email_outbox (cycle_id, user_id, kind)
    values (r.cycle_id, r.user_id, 'candidate_alert')
    on conflict do nothing;
    get diagnostics v_events = row_count;
    if v_events > 0 then
      v_recovered := v_recovered + 1;
      insert into public.replacement_cycle_events (cycle_id, kind, detail)
      values (r.cycle_id, 'email_enqueue_recovered', '{}'::jsonb);
    end if;
  end loop;

  -- Bail expiré : incertain seulement si un appel était en vol.
  update public.replacement_email_outbox o
  set uncertain_since = case when o.in_flight then coalesce(o.uncertain_since, o.lease_until) else o.uncertain_since end,
      status_code = case when o.in_flight then 'lease_expired' else o.status_code end,
      lease_until = null, lease_token = null, in_flight = false, updated_at = now()
  where o.status = 'pending' and o.lease_until is not null and o.lease_until < now();

  for v_row in
    select o.* from public.replacement_email_outbox o
    where o.status = 'pending' and o.lease_until is null
    for update skip locked
  loop
    if v_row.uncertain_since is not null and now() >= v_row.first_attempt_at + interval '23 hours' then
      perform public.replacement_email_finalize(v_row.id, 'unknown', 'idempotency_window_elapsed');
      v_unknown := v_unknown + 1;
      continue;
    end if;
    -- Fermeture du cycle : aucune nouvelle tentative.
    v_block := public.replacement_email_blocker(v_row);
    if v_block in ('cycle_closed', 'cycle_filled', 'date_cancelled', 'job_closed') then
      perform public.replacement_email_finalize(v_row.id, 'cancelled', v_block);
      v_closed := v_closed + 1;
    end if;
  end loop;

  -- Conservation (ANN-21 : 90 jours) : toute ligne d'envoi créée avant
  -- l'horizon est effacée, quel que soit son état ou celui du cycle (un
  -- cycle peut rester ouvert plus de 90 jours : aucune date d'offre n'est
  -- bornée) ; ses événements partent avec elle. Une ligne effacée encore
  -- en attente n'est jamais envoyée ni recréée (reprise bornée ci-dessus).
  delete from public.replacement_email_provider_events e
  using public.replacement_email_outbox o
  where e.outbox_id = o.id and o.created_at < v_cutoff;
  delete from public.replacement_email_outbox o
  where o.created_at < v_cutoff;
  get diagnostics v_purged = row_count;
  delete from public.replacement_email_provider_events e where e.received_at < v_cutoff;
  get diagnostics v_events = row_count;

  return jsonb_build_object('resumed', v_resumed, 'recovered', v_recovered, 'closed', v_closed,
                            'unknown', v_unknown, 'purged', v_purged, 'events_purged', v_events);
end;
$$;
revoke all on function public.replacement_email_sweep() from public, anon, authenticated;
grant execute on function public.replacement_email_sweep() to service_role;

-- Tâche planifiée : une minute (rétablissements ANN-22 et reprise des
-- intentions). L'envoi lui-même est fait par le serveur (route interne).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('replacement-email-sweep')
      where exists (select 1 from cron.job where jobname = 'replacement-email-sweep');
      perform cron.schedule('replacement-email-sweep', '* * * * *',
                            $cron$select public.replacement_email_sweep();$cron$);
    exception when others then
      raise notice 'pg_cron : replacement_email_sweep à planifier manuellement.';
    end;
  else
    raise notice 'pg_cron absent : replacement_email_sweep à planifier.';
  end if;
end $$;
