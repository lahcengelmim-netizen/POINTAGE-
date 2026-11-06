-- =====================================================================
-- MIGRATION SQL — DEBLOCAGE DES FOREIGN KEYS STOCK INITIAL
-- Application : LAHCEN POINTEUR
-- Base de données : Supabase PostgreSQL (Production)
-- =====================================================================
-- OBJECTIF :
-- Supprimer UNIQUEMENT la contrainte Foreign Key bloquante sur created_by_id
-- tout en CONSERVANT scrupuleusement :
-- 1. La relation produit_id -> public.stock_produits(id) (VITAL pour le suivi des mouvements)
-- 2. La relation company_id -> public.companies(id) (Cloisonnement multi-société)
-- 3. Le calcul du stock restant, l'historique des entrées/sorties et la traçabilité.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. GARANTIR L'EXISTENCE DE LA SOCIETE PAR DEFAUT DANS public.companies
-- ---------------------------------------------------------------------
INSERT INTO public.companies (id, nom, code, ville)
VALUES ('cie_lahcen_pointeur', 'Exploitation Agricole Lahcen Pointeur', 'LAH', 'Guelmim')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. TABLE public.stock_produits
-- ---------------------------------------------------------------------
-- S'assurer que la table existe et possède ses colonnes complètes
CREATE TABLE IF NOT EXISTS public.stock_produits (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  nom TEXT NOT NULL,
  unite TEXT NOT NULL,
  seuil_minimum NUMERIC DEFAULT 0,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, nom, unite)
);

-- Index pour des recherches ultra-rapides par société et nom de produit
CREATE INDEX IF NOT EXISTS idx_stock_produits_company_nom 
ON public.stock_produits(company_id, nom);

-- ---------------------------------------------------------------------
-- 3. TABLE public.stock_mouvements — DEBLOCAGE CIBLE DE LA CONTRAINTE FK
-- ---------------------------------------------------------------------
-- S'assurer que la table stock_mouvements existe
CREATE TABLE IF NOT EXISTS public.stock_mouvements (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  company_id TEXT REFERENCES public.companies(id),
  produit_id TEXT REFERENCES public.stock_produits(id),
  produit_nom TEXT NOT NULL,
  unite TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('INITIAL', 'ENTREE', 'SORTIE', 'CORRECTION')),
  quantite NUMERIC NOT NULL CHECK (quantite > 0),
  date TEXT NOT NULL,
  domaine_id TEXT,
  serre_id TEXT,
  tiers TEXT,
  reference_document TEXT,
  motif TEXT,
  observation TEXT,
  created_by_id TEXT,
  created_by_nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPRESSION DE LA SEULE CONTRAINTE BLOQUANTE SUR created_by_id
-- (Responsable du blocage lors de l'import Excel ou des créations de produits sans session profil synchronisée)
ALTER TABLE public.stock_mouvements 
DROP CONSTRAINT IF EXISTS stock_mouvements_created_by_id_fkey;

-- Permettre à created_by_id d'être nullable
ALTER TABLE public.stock_mouvements 
ALTER COLUMN created_by_id DROP NOT NULL;

-- Convertir created_by_id en TEXT pour accepter sans erreur aussi bien un UUID Supabase qu'un identifiant textuel
ALTER TABLE public.stock_mouvements 
ALTER COLUMN created_by_id TYPE TEXT USING created_by_id::TEXT;

-- ---------------------------------------------------------------------
-- 4. CONSERVATION STRICTE DES CONTRAINTES ESSENTIELLES DE SUIVI DE STOCK
-- ---------------------------------------------------------------------
-- A. Vérifier que la contrainte produit_id -> stock_produits existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'stock_mouvements_produit_id_fkey' 
      AND table_name = 'stock_mouvements'
  ) THEN
    ALTER TABLE public.stock_mouvements
    ADD CONSTRAINT stock_mouvements_produit_id_fkey
    FOREIGN KEY (produit_id) REFERENCES public.stock_produits(id)
    ON DELETE RESTRICT;
  END IF;
END $$;

-- B. Vérifier que la contrainte company_id -> companies existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'stock_mouvements_company_id_fkey' 
      AND table_name = 'stock_mouvements'
  ) THEN
    ALTER TABLE public.stock_mouvements
    ADD CONSTRAINT stock_mouvements_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id)
    ON DELETE RESTRICT;
  END IF;
END $$;

-- C. Index d'optimisation pour le calcul de stock consolidé et d'historique
CREATE INDEX IF NOT EXISTS idx_stock_mouvements_calc 
ON public.stock_mouvements(company_id, produit_id, type);

CREATE INDEX IF NOT EXISTS idx_stock_mouvements_date 
ON public.stock_mouvements(company_id, date DESC);

COMMIT;

-- =====================================================================
-- REQUETE DE VERIFICATION POST-MIGRATION (A EXECUTER APRES LE SCRIPT)
-- =====================================================================
-- SELECT
--   tc.table_name,
--   tc.constraint_name,
--   tc.constraint_type,
--   kcu.column_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu 
--   ON tc.constraint_name = kcu.constraint_name
-- WHERE tc.table_name IN ('stock_produits', 'stock_mouvements')
-- ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;
