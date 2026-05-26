-- Migration : Alignement strict SRS v1.1 des ENUMs et roles
-- Date : 2026-05-26
-- Tables affectees : users, jobs, missions, contracts, payments
-- Types affectes : user_role, job_status, mission_status, contract_status, payment_status
-- Rollback : non-trivial pour les ENUMs (voir notes en fin)

begin;

-- -----------------------------------------------------------------------------
-- user_role : ajout des roles premium (sans casser les donnees existantes)
-- -----------------------------------------------------------------------------
do $$
begin
	if exists (
		select 1
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where n.nspname = 'public'
			and t.typname = 'user_role'
	) then
		alter type public.user_role add value if not exists 'candidate_premium';
		alter type public.user_role add value if not exists 'company_premium';
	else
		raise notice 'Type public.user_role absent, etape ignoree.';
	end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- job_status : conserver legacy + ajouter valeurs SRS
-- SRS: draft | pending_review | active | filled | expired | cancelled | rejected
-- -----------------------------------------------------------------------------
do $$
begin
	if exists (
		select 1
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where n.nspname = 'public'
			and t.typname = 'job_status'
	) then
		alter type public.job_status add value if not exists 'pending_review';
		alter type public.job_status add value if not exists 'active';
	else
		raise notice 'Type public.job_status absent, etape ignoree.';
	end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- mission_status : conserver legacy + ajouter valeurs SRS
-- SRS: confirmed | en_route | arrived | in_progress | completed | validated | cancelled | disputed | no_show
-- -----------------------------------------------------------------------------
do $$
begin
	if exists (
		select 1
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where n.nspname = 'public'
			and t.typname = 'mission_status'
	) then
		alter type public.mission_status add value if not exists 'en_route';
		alter type public.mission_status add value if not exists 'arrived';
		alter type public.mission_status add value if not exists 'validated';
		alter type public.mission_status add value if not exists 'disputed';
	else
		raise notice 'Type public.mission_status absent, etape ignoree.';
	end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- contract_status : conserver legacy + ajouter valeurs SRS
-- SRS: pending | candidate_signed | company_signed | completed | expired
-- -----------------------------------------------------------------------------
do $$
begin
	if exists (
		select 1
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where n.nspname = 'public'
			and t.typname = 'contract_status'
	) then
		alter type public.contract_status add value if not exists 'candidate_signed';
		alter type public.contract_status add value if not exists 'company_signed';
		alter type public.contract_status add value if not exists 'completed';
	else
		raise notice 'Type public.contract_status absent, etape ignoree.';
	end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- payment_status : conserver legacy + ajouter valeurs SRS
-- SRS: pending | partial | full | failed | refunded
-- -----------------------------------------------------------------------------
do $$
begin
	if exists (
		select 1
		from pg_type t
		join pg_namespace n on n.oid = t.typnamespace
		where n.nspname = 'public'
			and t.typname = 'payment_status'
	) then
		alter type public.payment_status add value if not exists 'partial';
		alter type public.payment_status add value if not exists 'full';
	else
		raise notice 'Type public.payment_status absent, etape ignoree.';
	end if;
end;
$$;

commit;

begin;

-- -----------------------------------------------------------------------------
-- Backfill progressif des statuts legacy vers statuts SRS
-- (non destructif, execute seulement quand la valeur legacy est presente)
-- -----------------------------------------------------------------------------

-- jobs: pending_moderation -> pending_review, published -> active
do $do$
begin
	if to_regclass('public.jobs') is null then
		raise notice 'Table public.jobs absente, backfill ignore.';
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'jobs'
			and column_name = 'status'
			and udt_name = 'job_status'
	) then
		execute $sql$
			update public.jobs
			set status = 'pending_review'::public.job_status
			where status = 'pending_moderation'::public.job_status
		$sql$;

		execute $sql$
			update public.jobs
			set status = 'active'::public.job_status
			where status = 'published'::public.job_status
		$sql$;
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'jobs'
			and column_name = 'status'
	) then
		execute $sql$
			update public.jobs
			set status = 'pending_review'
			where status = 'pending_moderation'
		$sql$;

		execute $sql$
			update public.jobs
			set status = 'active'
			where status = 'published'
		$sql$;
	else
		raise notice 'Colonne public.jobs.status absente, backfill ignore.';
	end if;
end;
$do$;

-- contracts: signed_candidate -> candidate_signed, signed_company -> company_signed,
-- fully_signed -> completed
do $do$
begin
	if to_regclass('public.contracts') is null then
		raise notice 'Table public.contracts absente, backfill ignore.';
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'contracts'
			and column_name = 'status'
			and udt_name = 'contract_status'
	) then
		execute $sql$
			update public.contracts
			set status = 'candidate_signed'::public.contract_status
			where status = 'signed_candidate'::public.contract_status
		$sql$;

		execute $sql$
			update public.contracts
			set status = 'company_signed'::public.contract_status
			where status = 'signed_company'::public.contract_status
		$sql$;

		execute $sql$
			update public.contracts
			set status = 'completed'::public.contract_status
			where status = 'fully_signed'::public.contract_status
		$sql$;
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'contracts'
			and column_name = 'status'
	) then
		execute $sql$
			update public.contracts
			set status = 'candidate_signed'
			where status = 'signed_candidate'
		$sql$;

		execute $sql$
			update public.contracts
			set status = 'company_signed'
			where status = 'signed_company'
		$sql$;

		execute $sql$
			update public.contracts
			set status = 'completed'
			where status = 'fully_signed'
		$sql$;
	else
		raise notice 'Colonne public.contracts.status absente, backfill ignore.';
	end if;
end;
$do$;

-- payments: completed -> full, processing -> partial
do $do$
begin
	if to_regclass('public.payments') is null then
		raise notice 'Table public.payments absente, backfill ignore.';
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'payments'
			and column_name = 'status'
			and udt_name = 'payment_status'
	) then
		execute $sql$
			update public.payments
			set status = 'full'::public.payment_status
			where status = 'completed'::public.payment_status
		$sql$;

		execute $sql$
			update public.payments
			set status = 'partial'::public.payment_status
			where status = 'processing'::public.payment_status
		$sql$;
	elsif exists (
		select 1
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'payments'
			and column_name = 'status'
	) then
		execute $sql$
			update public.payments
			set status = 'full'
			where status = 'completed'
		$sql$;

		execute $sql$
			update public.payments
			set status = 'partial'
			where status = 'processing'
		$sql$;
	else
		raise notice 'Colonne public.payments.status absente, backfill ignore.';
	end if;
end;
$do$;

-- missions: pas de mapping automatique complet pour 'pending' vers SRS.
-- On garde 'pending' pour compatibilite historique et migration applicative progressive.

commit;

-- -----------------------------------------------------------------------------
-- Notes rollback
-- -----------------------------------------------------------------------------
-- PostgreSQL ne permet pas de supprimer directement une valeur d'ENUM.
-- Un rollback strict impose:
-- 1) creer de nouveaux types ENUM temporaires sans les nouvelles valeurs,
-- 2) caster les colonnes,
-- 3) renommer les types.
-- A executer manuellement selon l'etat des donnees en production.
