-- =====================================================================
-- MIGRATION ADDITIVE MULTI-APPAREILS & SÉCURITÉ RÔLES — LAHCEN POINTEUR
-- STRICTEMENT NON DESTRUCTIVE :
-- - Aucune suppression de table, colonne ou donnée existante
-- - Aucun DROP TABLE, TRUNCATE ou DELETE automatique
-- - Recommandation Phase 1 : Effectuer un export/snapshot JSON ou pg_dump avant exécution
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MISE À JOUR DES RÔLES & PROFILS (AJOUT caporal_contractuelles & lecteur)
-- ---------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS module_attribue TEXT DEFAULT 'recolte';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS domaines_autorises JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS serres_autorisees JSONB DEFAULT '[]'::jsonb;

DO $$
DECLARE
  constraint_rec RECORD;
BEGIN
  FOR constraint_rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', constraint_rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'caporal', 'caporal_contractuelles', 'lecteur'));

-- ---------------------------------------------------------------------
-- 2. ENRICHISSEMENT ADDITIF DES TABLES EXISTANTES (RÉFÉRENTIELS & TERRAIN)
-- ---------------------------------------------------------------------

ALTER TABLE public.taches ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.serres ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.domaines ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES public.companies(id);

ALTER TABLE public.pointages ADD COLUMN IF NOT EXISTS serre_id TEXT;
ALTER TABLE public.pointages ADD COLUMN IF NOT EXISTS serre_nom TEXT;
ALTER TABLE public.pointages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS serre_id TEXT;
ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS serre_nom TEXT;
ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS serres_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS serres_noms JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.affectations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS type_operation TEXT DEFAULT 'RECOLTE';
ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS updated_by_id TEXT;

-- ---------------------------------------------------------------------
-- 3. CRÉATION ADDITIVE DES TABLES MANQUANTES (IF NOT EXISTS)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tache_serre_configs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  date TEXT NOT NULL,
  tache_id TEXT NOT NULL,
  domaine_id TEXT NOT NULL,
  serre_ids JSONB DEFAULT '[]'::jsonb,
  serre_noms JSONB DEFAULT '[]'::jsonb,
  updated_at BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.taches_supplementaires (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  ouvrier_id TEXT,
  numero_ouvrier INTEGER NOT NULL,
  date TEXT NOT NULL,
  tache_id TEXT,
  nom_tache TEXT NOT NULL,
  description TEXT,
  quantite NUMERIC NOT NULL,
  unite TEXT NOT NULL,
  domaine_id TEXT,
  serre_id TEXT,
  observation TEXT,
  created_by_id TEXT,
  created_by_nom TEXT,
  created_by_role TEXT,
  heure_enregistrement TEXT,
  timestamp BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by_id TEXT,
  updated_by_nom TEXT
);

CREATE TABLE IF NOT EXISTS public.gazoil_configs (
  company_id TEXT PRIMARY KEY REFERENCES public.companies(id),
  stock_initial NUMERIC NOT NULL DEFAULT 0,
  initial_set BOOLEAN NOT NULL DEFAULT FALSE,
  seuil_alerte NUMERIC NOT NULL DEFAULT 20,
  commande_active JSONB,
  notified_below_threshold BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tables Module Contractuelles V2
CREATE TABLE IF NOT EXISTS public.contractuels_contrats (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  code TEXT,
  designation TEXT NOT NULL,
  prix_unitaire NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unite TEXT NOT NULL DEFAULT 'JOUR',
  mode_remuneration TEXT NOT NULL DEFAULT 'JOUR'
    CHECK (mode_remuneration IN ('JOUR', 'TACHE', 'UNITE', 'HEURE')),
  domaine_id TEXT,
  description TEXT,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contractuels_ouvriers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  nom TEXT NOT NULL,
  prenom TEXT DEFAULT '',
  nom_complet TEXT NOT NULL,
  matricule TEXT NOT NULL,
  domaine_id TEXT NOT NULL DEFAULT 'dom_d2',
  serre_id TEXT,
  mode_remuneration TEXT NOT NULL DEFAULT 'JOUR'
    CHECK (mode_remuneration IN ('JOUR', 'TACHE', 'UNITE', 'HEURE')),
  prix_convenu NUMERIC(10, 2) NOT NULL DEFAULT 0,
  unite TEXT DEFAULT 'JOUR',
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  telephone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contractuels_pointages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  ouvrier_id TEXT NOT NULL,
  matricule TEXT DEFAULT '',
  nom_complet TEXT NOT NULL,
  date TEXT NOT NULL,
  present BOOLEAN NOT NULL DEFAULT TRUE,
  domaine_id TEXT NOT NULL DEFAULT 'dom_d2',
  serre_id TEXT,
  serres_ids JSONB DEFAULT '[]'::jsonb,
  serres_noms JSONB DEFAULT '[]'::jsonb,
  serres_texte TEXT,
  taches_ids JSONB DEFAULT '[]'::jsonb,
  taches_noms JSONB DEFAULT '[]'::jsonb,
  taches_texte TEXT,
  heure_debut TEXT,
  heure_fin TEXT,
  duree_heures NUMERIC(6, 2),
  tarif_initial NUMERIC(10, 2) DEFAULT 0,
  montant_propose NUMERIC(10, 2) DEFAULT 0,
  montant_valide NUMERIC(10, 2),
  tarif_modifie BOOLEAN DEFAULT FALSE,
  motif_modification TEXT,
  statut_validation TEXT NOT NULL DEFAULT 'BROUILLON'
    CHECK (statut_validation IN ('BROUILLON', 'SOUMIS', 'VALIDE', 'REFUSE')),
  submitted_by_id TEXT,
  submitted_by_nom TEXT,
  submitted_at TIMESTAMPTZ,
  validated_by_id TEXT,
  validated_by_nom TEXT,
  validated_at TIMESTAMPTZ,
  motif_refus TEXT,
  historique_validations JSONB DEFAULT '[]'::jsonb,
  montant_total_jour NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_by_id TEXT,
  created_by_nom TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.contractuels_activites (
  id TEXT PRIMARY KEY,
  pointage_id TEXT,
  company_id TEXT NOT NULL REFERENCES public.companies(id),
  ouvrier_id TEXT NOT NULL,
  nom_complet TEXT NOT NULL,
  matricule TEXT DEFAULT '',
  date TEXT NOT NULL,
  contrat_id TEXT,
  contrat_nom TEXT,
  tache_id TEXT NOT NULL,
  tache_nom TEXT NOT NULL,
  domaine_id TEXT NOT NULL DEFAULT 'dom_d2',
  serre_id TEXT,
  serre_nom TEXT,
  serres_ids JSONB DEFAULT '[]'::jsonb,
  serres_noms JSONB DEFAULT '[]'::jsonb,
  serres_texte TEXT,
  heure_debut TEXT,
  heure_fin TEXT,
  duree_heures NUMERIC(6, 2),
  tarif_initial NUMERIC(10, 2),
  montant_propose NUMERIC(10, 2),
  montant_valide NUMERIC(10, 2),
  statut_validation TEXT DEFAULT 'BROUILLON',
  mode_remuneration TEXT NOT NULL DEFAULT 'JOUR',
  quantite NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unite TEXT NOT NULL DEFAULT 'JOUR',
  prix_unitaire NUMERIC(10, 2) NOT NULL DEFAULT 0,
  montant_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  observation TEXT,
  created_by_id TEXT,
  created_by_nom TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Colonnes V2 additives si tables créées antérieurement
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
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS statut_validation TEXT NOT NULL DEFAULT 'BROUILLON';
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_by_id TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_by_nom TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_by_id TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_by_nom TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS motif_refus TEXT;
ALTER TABLE public.contractuels_pointages ADD COLUMN IF NOT EXISTS historique_validations JSONB DEFAULT '[]'::jsonb;

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

-- ---------------------------------------------------------------------
-- 4. INDEX DE SYNCHRONISATION MULTI-APPAREILS
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_pointages_company_date ON public.pointages(company_id, date);
CREATE INDEX IF NOT EXISTS idx_affectations_company_date ON public.affectations(company_id, date);
CREATE INDEX IF NOT EXISTS idx_recolte_company_date ON public.recolte_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_recolte_updated ON public.recolte_entries(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tache_serre_cfg_company_date ON public.tache_serre_configs(company_id, date);
CREATE INDEX IF NOT EXISTS idx_taches_supp_company_date ON public.taches_supplementaires(company_id, date);
CREATE INDEX IF NOT EXISTS idx_contractuels_ptg_company_date ON public.contractuels_pointages(company_id, date, statut_validation);
CREATE INDEX IF NOT EXISTS idx_contractuels_ptg_updated ON public.contractuels_pointages(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_contractuels_act_pointage ON public.contractuels_activites(company_id, pointage_id, date);
CREATE INDEX IF NOT EXISTS idx_contractuels_logs_pointage ON public.contractuels_validation_logs(company_id, pointage_id, date);

-- ---------------------------------------------------------------------
-- 5. FONCTIONS HELPER RLS (BLOQUANT LECTEUR SUR TOUTE ÉCRITURE)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS TEXT STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND actif = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_lecteur()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'lecteur' AND actif = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND actif = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_writer()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND actif = true
      AND role IN ('admin', 'caporal', 'caporal_contractuelles')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_contractuels_writer()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND actif = true
      AND role IN ('admin', 'caporal_contractuelles')
  );
$$;

-- ---------------------------------------------------------------------
-- 6. POLITIQUES RLS STRICTES (LECTEUR = LECTURE SEULE PARTOUT)
-- ---------------------------------------------------------------------

-- Activer RLS sur les tables nouvelles et existantes
ALTER TABLE public.tache_serre_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taches_supplementaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gazoil_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractuels_contrats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractuels_ouvriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractuels_pointages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractuels_activites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractuels_validation_logs ENABLE ROW LEVEL SECURITY;

-- Profiles : lecteur ne peut ni insérer, ni modifier, ni supprimer
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_admin()
    AND role IN ('caporal', 'caporal_contractuelles', 'lecteur')
  );

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.is_admin()
    AND role IN ('caporal', 'caporal_contractuelles', 'lecteur')
  );

-- Pointages, Affectations, Récolte : lecteur interdit d'écriture (is_active_writer)
DROP POLICY IF EXISTS "pointages_insert" ON public.pointages;
CREATE POLICY "pointages_insert" ON public.pointages
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

DROP POLICY IF EXISTS "pointages_update" ON public.pointages;
CREATE POLICY "pointages_update" ON public.pointages
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

DROP POLICY IF EXISTS "affectations_insert" ON public.affectations;
CREATE POLICY "affectations_insert" ON public.affectations
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

DROP POLICY IF EXISTS "affectations_update" ON public.affectations;
CREATE POLICY "affectations_update" ON public.affectations
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

DROP POLICY IF EXISTS "recolte_insert" ON public.recolte_entries;
CREATE POLICY "recolte_insert" ON public.recolte_entries
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_writer());

DROP POLICY IF EXISTS "recolte_update" ON public.recolte_entries;
CREATE POLICY "recolte_update" ON public.recolte_entries
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_writer())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_writer());

-- Domaines multi-tenant select (compatible company_id NULL historique)
DROP POLICY IF EXISTS "domaines_select" ON public.domaines;
CREATE POLICY "domaines_select" ON public.domaines
  FOR SELECT TO authenticated
  USING ((company_id IS NULL OR company_id = public.get_my_company_id()) AND public.is_active_user());

DROP POLICY IF EXISTS "domaines_insert" ON public.domaines;
CREATE POLICY "domaines_insert" ON public.domaines
  FOR INSERT TO authenticated
  WITH CHECK ((company_id IS NULL OR company_id = public.get_my_company_id()) AND public.is_admin());

DROP POLICY IF EXISTS "domaines_update" ON public.domaines;
CREATE POLICY "domaines_update" ON public.domaines
  FOR UPDATE TO authenticated
  USING ((company_id IS NULL OR company_id = public.get_my_company_id()) AND public.is_admin())
  WITH CHECK ((company_id IS NULL OR company_id = public.get_my_company_id()) AND public.is_admin());

-- Lecture autorisée pour le rôle lecteur (en plus d'Admin) sur les modules en consultation
DROP POLICY IF EXISTS "heures_supp_select" ON public.heures_supplementaires;
CREATE POLICY "heures_supp_select" ON public.heures_supplementaires
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));

DROP POLICY IF EXISTS "gazoil_select" ON public.gazoil_mouvements;
CREATE POLICY "gazoil_select" ON public.gazoil_mouvements
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));

DROP POLICY IF EXISTS "stock_prod_select" ON public.stock_produits;
CREATE POLICY "stock_prod_select" ON public.stock_produits
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));

DROP POLICY IF EXISTS "stock_mvt_select" ON public.stock_mouvements;
CREATE POLICY "stock_mvt_select" ON public.stock_mouvements
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));

-- Tache Serre Configs
DROP POLICY IF EXISTS "tache_serre_cfg_select" ON public.tache_serre_configs;
CREATE POLICY "tache_serre_cfg_select" ON public.tache_serre_configs
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "tache_serre_cfg_insert" ON public.tache_serre_configs;
CREATE POLICY "tache_serre_cfg_insert" ON public.tache_serre_configs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "tache_serre_cfg_update" ON public.tache_serre_configs;
CREATE POLICY "tache_serre_cfg_update" ON public.tache_serre_configs
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "tache_serre_cfg_delete" ON public.tache_serre_configs;
CREATE POLICY "tache_serre_cfg_delete" ON public.tache_serre_configs
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Tâches Supplémentaires
DROP POLICY IF EXISTS "taches_supp_select" ON public.taches_supplementaires;
CREATE POLICY "taches_supp_select" ON public.taches_supplementaires
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));
DROP POLICY IF EXISTS "taches_supp_insert" ON public.taches_supplementaires;
CREATE POLICY "taches_supp_insert" ON public.taches_supplementaires
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "taches_supp_update" ON public.taches_supplementaires;
CREATE POLICY "taches_supp_update" ON public.taches_supplementaires
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "taches_supp_delete" ON public.taches_supplementaires;
CREATE POLICY "taches_supp_delete" ON public.taches_supplementaires
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Gazoil Configs
DROP POLICY IF EXISTS "gazoil_cfg_select" ON public.gazoil_configs;
CREATE POLICY "gazoil_cfg_select" ON public.gazoil_configs
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND (public.is_admin() OR public.is_lecteur()));
DROP POLICY IF EXISTS "gazoil_cfg_insert" ON public.gazoil_configs;
CREATE POLICY "gazoil_cfg_insert" ON public.gazoil_configs
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "gazoil_cfg_update" ON public.gazoil_configs;
CREATE POLICY "gazoil_cfg_update" ON public.gazoil_configs
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

-- Contractuels Contrats (Select: actif, Write: Admin)
DROP POLICY IF EXISTS "contractuels_contrats_select" ON public.contractuels_contrats;
CREATE POLICY "contractuels_contrats_select" ON public.contractuels_contrats
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "contractuels_contrats_insert" ON public.contractuels_contrats;
CREATE POLICY "contractuels_contrats_insert" ON public.contractuels_contrats
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "contractuels_contrats_update" ON public.contractuels_contrats;
CREATE POLICY "contractuels_contrats_update" ON public.contractuels_contrats
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "contractuels_contrats_delete" ON public.contractuels_contrats;
CREATE POLICY "contractuels_contrats_delete" ON public.contractuels_contrats
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Contractuels Ouvriers (Select: actif, Write: Admin)
DROP POLICY IF EXISTS "contractuels_ouvriers_select" ON public.contractuels_ouvriers;
CREATE POLICY "contractuels_ouvriers_select" ON public.contractuels_ouvriers
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "contractuels_ouvriers_insert" ON public.contractuels_ouvriers;
CREATE POLICY "contractuels_ouvriers_insert" ON public.contractuels_ouvriers
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "contractuels_ouvriers_update" ON public.contractuels_ouvriers;
CREATE POLICY "contractuels_ouvriers_update" ON public.contractuels_ouvriers
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());
DROP POLICY IF EXISTS "contractuels_ouvriers_delete" ON public.contractuels_ouvriers;
CREATE POLICY "contractuels_ouvriers_delete" ON public.contractuels_ouvriers
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Contractuels Pointages (Select: actif, Insert/Update: Admin ou Caporal Contractuelles, Delete: Admin uniquement)
DROP POLICY IF EXISTS "contractuels_pointages_select" ON public.contractuels_pointages;
CREATE POLICY "contractuels_pointages_select" ON public.contractuels_pointages
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "contractuels_pointages_insert" ON public.contractuels_pointages;
CREATE POLICY "contractuels_pointages_insert" ON public.contractuels_pointages
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_contractuels_writer()
    AND (public.is_admin() OR statut_validation IN ('BROUILLON', 'SOUMIS'))
  );
DROP POLICY IF EXISTS "contractuels_pointages_update" ON public.contractuels_pointages;
CREATE POLICY "contractuels_pointages_update" ON public.contractuels_pointages
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.is_contractuels_writer()
    AND (public.is_admin() OR statut_validation != 'VALIDE')
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_contractuels_writer()
    AND (public.is_admin() OR statut_validation IN ('BROUILLON', 'SOUMIS'))
  );
DROP POLICY IF EXISTS "contractuels_pointages_delete" ON public.contractuels_pointages;
CREATE POLICY "contractuels_pointages_delete" ON public.contractuels_pointages
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Contractuels Activités (Select: actif, Insert/Update: Admin ou Caporal Contractuelles, Delete: Admin ou Caporal sur non-validé)
DROP POLICY IF EXISTS "contractuels_activites_select" ON public.contractuels_activites;
CREATE POLICY "contractuels_activites_select" ON public.contractuels_activites
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "contractuels_activites_insert" ON public.contractuels_activites;
CREATE POLICY "contractuels_activites_insert" ON public.contractuels_activites
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_contractuels_writer());
DROP POLICY IF EXISTS "contractuels_activites_update" ON public.contractuels_activites;
CREATE POLICY "contractuels_activites_update" ON public.contractuels_activites
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_contractuels_writer())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_contractuels_writer());
DROP POLICY IF EXISTS "contractuels_activites_delete" ON public.contractuels_activites;
CREATE POLICY "contractuels_activites_delete" ON public.contractuels_activites
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.is_contractuels_writer()
    AND (public.is_admin() OR COALESCE(statut_validation, 'BROUILLON') != 'VALIDE')
  );

-- Contractuels Validation Logs (Select: actif, Insert: écrivains contractuels uniquement)
DROP POLICY IF EXISTS "contractuels_logs_select" ON public.contractuels_validation_logs;
CREATE POLICY "contractuels_logs_select" ON public.contractuels_validation_logs
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());
DROP POLICY IF EXISTS "contractuels_logs_insert" ON public.contractuels_validation_logs;
CREATE POLICY "contractuels_logs_insert" ON public.contractuels_validation_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.is_contractuels_writer()
    AND (public.is_admin() OR action IN ('CREATION', 'MODIFICATION', 'SOUMISSION'))
  );

-- ---------------------------------------------------------------------
-- 7. ACTIVATION REALTIME MULTI-APPAREILS (SÉCURISÉE & IDEMPOTENTE)
-- ---------------------------------------------------------------------

DO $$
DECLARE
  tbl TEXT;
  tables_list TEXT[] := ARRAY[
    'ouvriers',
    'taches',
    'serres',
    'domaines',
    'pointages',
    'affectations',
    'tache_serre_configs',
    'recolte_entries',
    'heures_supplementaires',
    'taches_supplementaires',
    'gazoil_mouvements',
    'gazoil_configs',
    'stock_produits',
    'stock_mouvements',
    'contractuels_contrats',
    'contractuels_ouvriers',
    'contractuels_pointages',
    'contractuels_activites'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY tables_list LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = tbl
      ) THEN
        EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = tbl
        ) THEN
          EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;
