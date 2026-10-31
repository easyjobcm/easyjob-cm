-- T5 — Normalisation de l'orthographe de la ville « Yaoundé » (candidats).
--
-- Contexte : le catalogue applicatif (lib/utils/candidate-constants.ts)
-- portait « Yaounde » SANS accent alors que la graphie de référence
-- (seed de données + SRS) est accentuée. Conséquences : ville désélectionnée
-- dans la grille, match du fallback « même ville » du matching cassé sur
-- ces lignes. La source de vérité = la graphie accentuée.
--
-- Insensible à la casse / à la casse + espaces : « Yaounde », « yaounde »,
-- « Yaoundé »... → « Yaoundé ».
-- Limité à candidate_profiles : côté entreprise, les villes sont saisies
-- librement depuis l'onboarding société (pas de catalogue) — à traiter
-- séparément si un cas réel apparaît.

DO $$
BEGIN
    UPDATE candidate_profiles
    SET city = 'Yaoundé'
    WHERE lower(btrim(city)) = 'yaounde';
END
$$;
