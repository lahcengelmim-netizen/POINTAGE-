-- =====================================================================
-- MIGRATION ADDITIVE ET NON-DESTRUCTIVE : MODULE CONTRACTUELLES V2
-- Workflow de validation Admin, multi-tâches, multi-serres, horaires & traçabilité
-- =====================================================================

-- 1. Enrichissement additif de contractuels_pointages
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS serres_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS serres_noms JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS serres_texte TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS taches_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS taches_noms JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS taches_texte TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS heure_debut TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS heure_fin TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS duree_heures NUMERIC(6, 2);
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS tarif_initial NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS montant_propose NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS montant_valide NUMERIC(10, 2);
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS tarif_modifie BOOLEAN DEFAULT FALSE;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS motif_modification TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS statut_validation TEXT NOT NULL DEFAULT 'BROUILLON'
  CHECK (statut_validation IN ('BROUILLON', 'SOUMIS', 'VALIDE', 'REFUSE'));
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_by_id TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_by_nom TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_by_id TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_by_nom TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS motif_refus TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS historique_validations JSONB DEFAULT '[]'::jsonb;

-- 2. Enrichissement additif de contractuels_activites
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS serres_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS serres_noms JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS serres_texte TEXT;
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS heure_debut TEXT;
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS heure_fin TEXT;
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS duree_heures NUMERIC(6, 2);
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS tarif_initial NUMERIC(10, 2);
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS montant_propose NUMERIC(10, 2);
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS montant_valide NUMERIC(10, 2);
ALTER TABLE public.contractuels_activites ADD COLUMN IF NOT EXISTS statut_validation TEXT DEFAULT 'BROUILLON';

-- 3. Table dédiée d'audit / traçabilité immuable des validations
CREATE TABLE IF NOT EXISTS public.contractuels_validation_logs (
  id TEXT PRIMARY KEY,
  pointage_id TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  ouvrier_id TEXT NOT NULL,
  date TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATION', 'MODIFICATION', 'SOUMISSION', 'VALIDATION', 'REFUS')),
  auteur_id TEXT NOT NULL,
  auteur_nom TEXT NOT NULL,
  auteur_role TEXT NOT NULL,
  statut_avant TEXT,
  statut_apres TEXT NOT NULL,
  present BOOLEAN NOT NULL,
  tarif_initial NUMERIC(10, 2),
  montant_propose NUMERIC(10, 2),
  montant_valide NUMERIC(10, 2),
  tarif_modifie BOOLEAN DEFAULT FALSE,
  taches_noms JSONB DEFAULT '[]'::jsonb,
  serres_noms JSONB DEFAULT '[]'::jsonb,
  heure_debut TEXT,
  heure_fin TEXT,
  duree_heures NUMERIC(6, 2),
  motif TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractuels_ptg_validation
  ON public.contractuels_pointages(company_id, date, statut_validation);
CREATE INDEX IF NOT EXISTS idx_contractuels_logs_pointage
  ON public.contractuels_validation_logs(company_id, pointage_id, date);

-- 4. Politiques RLS additives (sans modifier les autres tables)
ALTER TABLE public.contractuels_validation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contractuels_logs_select" ON public.contractuels_validation_logs;
CREATE POLICY "contractuels_logs_select" ON public.contractuels_validation_logs
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

DROP POLICY IF EXISTS "contractuels_logs_insert" ON public.contractuels_validation_logs;
CREATE POLICY "contractuels_logs_insert" ON public.contractuels_validation_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_active_user()
    AND (
      public.is_admin()
      OR action IN ('CREATION', 'MODIFICATION', 'SOUMISSION')
    )
  );
