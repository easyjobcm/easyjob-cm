-- ============================================================
-- Drop le trigger orphelin "on_candidate_created" qui essayait
-- d'insérer dans public.wallets (table hors-périmètre MVP, supprimée).
-- Sans ce correctif, tout signup candidat échoue avec :
--   relation "public.wallets" does not exist
-- ============================================================

DROP TRIGGER IF EXISTS on_candidate_created ON public.candidate_profiles;
DROP FUNCTION IF EXISTS public.create_candidate_wallet();

-- Rollback (manuel, à éviter — wallets ne fait plus partie du MVP) :
-- CREATE FUNCTION public.create_candidate_wallet() ... ;
-- CREATE TRIGGER on_candidate_created AFTER INSERT ON public.candidate_profiles
--   FOR EACH ROW EXECUTE FUNCTION public.create_candidate_wallet();
