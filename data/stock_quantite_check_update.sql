-- =====================================================================
-- MISE A JOUR CONTRAINTE DE QUANTITE SUR public.stock_mouvements
-- Application : LAHCEN POINTEUR
-- Base de données : Supabase PostgreSQL (Production)
-- =====================================================================
-- OBJECTIF :
-- Autoriser quantite = 0 UNIQUEMENT pour les mouvements de type INITIAL
-- (ex: CARTOUCHE 20 = 0), tout en interdisant formellement les valeurs négatives
-- et en maintenant l'exigence quantite > 0 pour ENTREE et SORTIE.
-- =====================================================================

BEGIN;

-- 1. Supprimer l'ancienne contrainte CHECK qui exigeait strictement quantite > 0
ALTER TABLE public.stock_mouvements 
DROP CONSTRAINT IF EXISTS stock_mouvements_quantite_check;

ALTER TABLE public.stock_mouvements 
DROP CONSTRAINT IF EXISTS stock_movements_quantite_check;

-- 2. Ajouter la nouvelle contrainte CHECK adaptée
-- - INITIAL : quantite >= 0 (accepte 0 et toutes valeurs positives, refuse < 0)
-- - ENTREE / SORTIE / CORRECTION : quantite > 0 (refuse 0 et valeurs négatives)
ALTER TABLE public.stock_mouvements 
ADD CONSTRAINT stock_mouvements_quantite_check 
CHECK (
  (type = 'INITIAL' AND quantite >= 0) OR 
  (type != 'INITIAL' AND quantite > 0)
);

COMMIT;

-- Requête de vérification
-- SELECT conname, pg_get_constraintdef(c.oid) 
-- FROM pg_constraint c 
-- JOIN pg_class t ON c.conrelid = t.oid 
-- WHERE t.relname = 'stock_mouvements' AND c.contype = 'c';
