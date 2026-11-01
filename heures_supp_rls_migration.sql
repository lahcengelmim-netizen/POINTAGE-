-- =========================================================================
-- MIGRATION SÉCURITÉ RLS — MODULE HEURES & TÂCHES SUPPLÉMENTAIRES
-- LAHCEN POINTEUR
--- =========================================================================

-- 1. Migration additive non destructive de la table
CREATE TABLE IF NOT EXISTS public.heures_supplementaires (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  ouvrier_id TEXT REFERENCES public.ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  date TEXT NOT NULL,
  type TEXT DEFAULT 'heures',
  tache_id TEXT REFERENCES public.taches(id),
  quantite NUMERIC,
  unite TEXT,
  heures NUMERIC,
  domaine_id TEXT,
  serre_id TEXT,
  observation TEXT,
  created_by_id UUID REFERENCES public.profiles(id),
  created_by_nom TEXT,
  heure_enregistrement TEXT NOT NULL,
  timestamp BIGINT NOT NULL
);

ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS serre_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS observation TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS created_by_id UUID;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS created_by_nom TEXT;

-- 2. Index de performance
CREATE INDEX IF NOT EXISTS idx_heures_supp_lookup 
  ON public.heures_supplementaires(company_id, date, ouvrier_id);

-- 3. Activation RLS (Row Level Security)
ALTER TABLE public.heures_supplementaires ENABLE ROW LEVEL SECURITY;

-- 4. Suppression de l'ancienne politique si elle existe
DROP POLICY IF EXISTS "Heures Supp - Admin Uniquement" ON public.heures_supplementaires;

-- 5. Création de la politique stricte Admin + Multi-entreprise
-- Seuls les Administrateurs actifs de l'entreprise correspondante peuvent SELECT, INSERT, UPDATE, DELETE.
-- Les Caporaux et les utilisateurs d'autres entreprises sont totalement bloqués au niveau base de données.
CREATE POLICY "Heures Supp - Admin Uniquement" ON public.heures_supplementaires
  FOR ALL
  TO authenticated
  USING (
    company_id = (
      SELECT company_id 
      FROM public.profiles 
      WHERE id = auth.uid() 
        AND role = 'admin' 
        AND actif = true
    )
  )
  WITH CHECK (
    company_id = (
      SELECT company_id 
      FROM public.profiles 
      WHERE id = auth.uid() 
        AND role = 'admin' 
        AND actif = true
    )
  );
