-- =====================================================================
-- MIGRATION ADDITIVE ET NON-DESTRUCTIVE : SUPPLÉMENTAIRES & RÉCOLTE V2
-- PostgreSQL / Supabase avec RLS et isolation par company_id
-- =====================================================================

-- 1. MODULE HEURES SUPPLÉMENTAIRES (Suivi du temps de travail en heures)
CREATE TABLE IF NOT EXISTS public.heures_supplementaires (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ouvrier_id TEXT NOT NULL REFERENCES public.ouvriers(id) ON DELETE RESTRICT,
  numero_ouvrier INTEGER NOT NULL,
  date DATE NOT NULL,
  tache_id TEXT REFERENCES public.taches(id) ON DELETE SET NULL,
  nom_tache TEXT,
  heure_debut TIME,
  heure_fin TIME,
  duree_heures DECIMAL NOT NULL CHECK (duree_heures > 0),
  domaine_id TEXT,
  serre_id TEXT,
  observation TEXT,
  created_by_id TEXT,
  created_by_nom TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by_id TEXT,
  updated_by_nom TEXT
);

-- Colonnes additives si la table existait déjà sous un schéma antérieur
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS heure_debut TIME;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS heure_fin TIME;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS duree_heures DECIMAL;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS nom_tache TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS serre_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS observation TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS created_by_role TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_by_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_by_nom TEXT;

-- 2. MODULE TÂCHES SUPPLÉMENTAIRES (Suivi des travaux à la tâche mesurés en quantités physiques)
CREATE TABLE IF NOT EXISTS public.taches_supplementaires (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ouvrier_id TEXT NOT NULL REFERENCES public.ouvriers(id) ON DELETE RESTRICT,
  numero_ouvrier INTEGER NOT NULL,
  date DATE NOT NULL,
  tache_id TEXT REFERENCES public.taches(id) ON DELETE SET NULL,
  nom_tache TEXT NOT NULL,
  description TEXT,
  quantite DECIMAL NOT NULL CHECK (quantite > 0),
  unite TEXT NOT NULL,
  domaine_id TEXT,
  serre_id TEXT,
  observation TEXT,
  created_by_id TEXT,
  created_by_nom TEXT,
  created_by_role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by_id TEXT,
  updated_by_nom TEXT
);

-- 3. ÉVOLUTION DU MODULE RÉCOLTE (Ajout de CHARGEMENT et DÉCHARGEMENT)
ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS type_operation TEXT NOT NULL DEFAULT 'RECOLTE';
ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS domaine_id TEXT;

-- 4. POLITIQUES DE SÉCURITÉ ROW LEVEL SECURITY (RLS)
ALTER TABLE public.heures_supplementaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taches_supplementaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recolte_entries ENABLE ROW LEVEL SECURITY;

-- Politiques Heures Supplémentaires : Admin & Caporal autorisés sur leur entreprise
DROP POLICY IF EXISTS "heures_supp_company_isolation" ON public.heures_supplementaires;
CREATE POLICY "heures_supp_company_isolation" ON public.heures_supplementaires
  FOR ALL TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  );

-- Politiques Tâches Supplémentaires : Admin & Caporal autorisés sur leur entreprise
DROP POLICY IF EXISTS "taches_supp_company_isolation" ON public.taches_supplementaires;
CREATE POLICY "taches_supp_company_isolation" ON public.taches_supplementaires
  FOR ALL TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  );

-- Politiques Récolte / Chargement / Déchargement : Admin & Caporal autorisés sur leur entreprise
DROP POLICY IF EXISTS "recolte_entries_company_isolation" ON public.recolte_entries;
CREATE POLICY "recolte_entries_company_isolation" ON public.recolte_entries
  FOR ALL TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid())
  );
