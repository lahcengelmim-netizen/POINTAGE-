-- =====================================================================
-- SCHEMA SQL DEFINITIF ET SECURISE — LAHCEN POINTEUR (SUPABASE)
-- Multi-tenant isolation strict par company_id
-- RLS ultra-sécurisée avec zéro "FOR ALL"
-- Compatible avec l'application existante et migrations additives
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES FONDAMENTALES (ENTREPRISES & PROFILS)
-- ---------------------------------------------------------------------

-- Table des Entreprises
CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  code TEXT NOT NULL,
  ville TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Profils Utilisateurs (Liée à auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT NOT NULL,
  nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'caporal')),
  company_id TEXT REFERENCES public.companies(id),
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2. FONCTIONS DE SÉCURITÉ HELPER (SECURITY DEFINER sans récursion RLS)
-- ---------------------------------------------------------------------

-- Fonction Helper : Récupérer le company_id de l'utilisateur connecté
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS TEXT STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Fonction Helper : Vérifier si l'utilisateur connecté est Administrateur actif
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin' AND actif = true
  );
$$;

-- Fonction Helper : Vérifier si l'utilisateur est un compte actif (Admin ou Caporal)
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN STABLE LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND actif = true
  );
$$;

-- ---------------------------------------------------------------------
-- 3. TABLES DE RÉFÉRENCE (OUVRIERS, TÂCHES, SERRES, DOMAINES)
-- ---------------------------------------------------------------------

-- Table des Ouvriers
CREATE TABLE IF NOT EXISTS public.ouvriers (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  numero INTEGER NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, numero)
);

-- Table des Tâches
CREATE TABLE IF NOT EXISTS public.taches (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  code TEXT,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  couleur TEXT,
  description TEXT,
  ouvriers_autorises TEXT DEFAULT 'tous',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Serres
CREATE TABLE IF NOT EXISTS public.serres (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  code TEXT NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Domaines
CREATE TABLE IF NOT EXISTS public.domaines (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  nom TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, nom)
);

-- ---------------------------------------------------------------------
-- 4. TABLES OPERATIONNELLES (POINTAGES, AFFECTATIONS, RECOLTES)
-- ---------------------------------------------------------------------

-- Table des Pointages Quotidiens
CREATE TABLE IF NOT EXISTS public.pointages (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  ouvrier_id TEXT REFERENCES public.ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  date TEXT NOT NULL,
  present BOOLEAN DEFAULT TRUE,
  tache_id TEXT REFERENCES public.taches(id),
  domaine_id TEXT,
  heure TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Affectations aux Tâches
CREATE TABLE IF NOT EXISTS public.affectations (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  ouvrier_id TEXT REFERENCES public.ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  tache_id TEXT REFERENCES public.taches(id),
  date TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Saisies de Récolte
CREATE TABLE IF NOT EXISTS public.recolte_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  date TEXT NOT NULL,
  serre_id TEXT REFERENCES public.serres(id),
  serre_nom TEXT NOT NULL,
  ouvrier_id TEXT REFERENCES public.ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  nom_ouvrier TEXT NOT NULL,
  caisses NUMERIC NOT NULL,
  notes TEXT,
  created_by_id UUID REFERENCES public.profiles(id),
  created_by_nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 5. MODULES ADMIN (HEURES SUPP, GAZOIL, STOCK PRO)
-- ---------------------------------------------------------------------

-- Table des Heures & Tâches Supplémentaires
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
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Mouvements de Gazoil
CREATE TABLE IF NOT EXISTS public.gazoil_mouvements (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES public.companies(id),
  type TEXT NOT NULL CHECK (type IN ('entree', 'sortie')),
  date TEXT NOT NULL,
  quantite NUMERIC NOT NULL CHECK (quantite > 0),
  engin_ou_tache TEXT,
  remarque TEXT,
  created_by_id UUID REFERENCES public.profiles(id),
  created_by_nom TEXT,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Produits en Stock Pro
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

-- Table des Mouvements de Stock Pro
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
  created_by_id UUID REFERENCES public.profiles(id),
  created_by_nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 6. MIGRATIONS ADDITIVES ET INDEX D'OPTIMISATION
-- ---------------------------------------------------------------------

ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS domaine_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS serre_id TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS observation TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS nom_tache TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS created_by_id UUID;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS created_by_nom TEXT;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_by_id UUID;
ALTER TABLE public.heures_supplementaires ADD COLUMN IF NOT EXISTS updated_by_nom TEXT;

CREATE INDEX IF NOT EXISTS idx_pointages_lookup ON public.pointages(company_id, date, ouvrier_id);
CREATE INDEX IF NOT EXISTS idx_recolte_lookup ON public.recolte_entries(company_id, date, serre_id);
CREATE INDEX IF NOT EXISTS idx_heures_supp_lookup ON public.heures_supplementaires(company_id, date, ouvrier_id);
CREATE INDEX IF NOT EXISTS idx_stock_mouvements_lookup ON public.stock_mouvements(company_id, produit_id, type);
CREATE INDEX IF NOT EXISTS idx_stock_mouvements_idempotency ON public.stock_mouvements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_gazoil_mouvements_lookup ON public.gazoil_mouvements(company_id, date, type);

-- ---------------------------------------------------------------------
-- 7. ACTIVATION ET PURGE DES ANCIENNES POLITIQUES RLS
-- ---------------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ouvriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.serres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domaines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pointages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recolte_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heures_supplementaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gazoil_mouvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_produits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_mouvements ENABLE ROW LEVEL SECURITY;

-- Suppression explicite des anciennes politiques
DROP POLICY IF EXISTS "FOR ALL" ON public.companies;
DROP POLICY IF EXISTS "FOR ALL" ON public.profiles;
DROP POLICY IF EXISTS "FOR ALL" ON public.ouvriers;
DROP POLICY IF EXISTS "FOR ALL" ON public.taches;
DROP POLICY IF EXISTS "FOR ALL" ON public.serres;
DROP POLICY IF EXISTS "FOR ALL" ON public.domaines;
DROP POLICY IF EXISTS "FOR ALL" ON public.pointages;
DROP POLICY IF EXISTS "FOR ALL" ON public.affectations;
DROP POLICY IF EXISTS "FOR ALL" ON public.recolte_entries;
DROP POLICY IF EXISTS "FOR ALL" ON public.heures_supplementaires;
DROP POLICY IF EXISTS "FOR ALL" ON public.gazoil_mouvements;
DROP POLICY IF EXISTS "FOR ALL" ON public.stock_produits;
DROP POLICY IF EXISTS "FOR ALL" ON public.stock_mouvements;

DROP POLICY IF EXISTS "Isolation multi-entreprise" ON public.ouvriers;
DROP POLICY IF EXISTS "Heures Supp - Admin Uniquement" ON public.heures_supplementaires;
DROP POLICY IF EXISTS "Stock Produits - Admin Uniquement" ON public.stock_produits;
DROP POLICY IF EXISTS "Stock Mouvements - Admin Uniquement" ON public.stock_mouvements;

-- Nettoyage des nouvelles policies si réexécuté
DROP POLICY IF EXISTS "companies_select" ON public.companies;
DROP POLICY IF EXISTS "companies_update" ON public.companies;

DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;

DROP POLICY IF EXISTS "ouvriers_select" ON public.ouvriers;
DROP POLICY IF EXISTS "ouvriers_insert" ON public.ouvriers;
DROP POLICY IF EXISTS "ouvriers_update" ON public.ouvriers;
DROP POLICY IF EXISTS "ouvriers_delete" ON public.ouvriers;

DROP POLICY IF EXISTS "taches_select" ON public.taches;
DROP POLICY IF EXISTS "taches_insert" ON public.taches;
DROP POLICY IF EXISTS "taches_update" ON public.taches;
DROP POLICY IF EXISTS "taches_delete" ON public.taches;

DROP POLICY IF EXISTS "serres_select" ON public.serres;
DROP POLICY IF EXISTS "serres_insert" ON public.serres;
DROP POLICY IF EXISTS "serres_update" ON public.serres;
DROP POLICY IF EXISTS "serres_delete" ON public.serres;

DROP POLICY IF EXISTS "domaines_select" ON public.domaines;
DROP POLICY IF EXISTS "domaines_insert" ON public.domaines;
DROP POLICY IF EXISTS "domaines_update" ON public.domaines;
DROP POLICY IF EXISTS "domaines_delete" ON public.domaines;

DROP POLICY IF EXISTS "pointages_select" ON public.pointages;
DROP POLICY IF EXISTS "pointages_insert" ON public.pointages;
DROP POLICY IF EXISTS "pointages_update" ON public.pointages;
DROP POLICY IF EXISTS "pointages_delete" ON public.pointages;

DROP POLICY IF EXISTS "affectations_select" ON public.affectations;
DROP POLICY IF EXISTS "affectations_insert" ON public.affectations;
DROP POLICY IF EXISTS "affectations_update" ON public.affectations;
DROP POLICY IF EXISTS "affectations_delete" ON public.affectations;

DROP POLICY IF EXISTS "recolte_select" ON public.recolte_entries;
DROP POLICY IF EXISTS "recolte_insert" ON public.recolte_entries;
DROP POLICY IF EXISTS "recolte_update" ON public.recolte_entries;
DROP POLICY IF EXISTS "recolte_delete" ON public.recolte_entries;

DROP POLICY IF EXISTS "heures_supp_select" ON public.heures_supplementaires;
DROP POLICY IF EXISTS "heures_supp_insert" ON public.heures_supplementaires;
DROP POLICY IF EXISTS "heures_supp_update" ON public.heures_supplementaires;
DROP POLICY IF EXISTS "heures_supp_delete" ON public.heures_supplementaires;

DROP POLICY IF EXISTS "gazoil_select" ON public.gazoil_mouvements;
DROP POLICY IF EXISTS "gazoil_insert" ON public.gazoil_mouvements;
DROP POLICY IF EXISTS "gazoil_update" ON public.gazoil_mouvements;
DROP POLICY IF EXISTS "gazoil_delete" ON public.gazoil_mouvements;

DROP POLICY IF EXISTS "stock_prod_select" ON public.stock_produits;
DROP POLICY IF EXISTS "stock_prod_insert" ON public.stock_produits;
DROP POLICY IF EXISTS "stock_prod_update" ON public.stock_produits;
DROP POLICY IF EXISTS "stock_prod_delete" ON public.stock_produits;

DROP POLICY IF EXISTS "stock_mvt_select" ON public.stock_mouvements;
DROP POLICY IF EXISTS "stock_mvt_insert" ON public.stock_mouvements;
DROP POLICY IF EXISTS "stock_mvt_update" ON public.stock_mouvements;
DROP POLICY IF EXISTS "stock_mvt_delete" ON public.stock_mouvements;

-- ---------------------------------------------------------------------
-- 8. DÉFINITION EXPLICITE DES POLITIQUES RLS PAR OPÉRATION
-- ---------------------------------------------------------------------

-- A. Table COMPANIES (Zero création client)
CREATE POLICY "companies_select" ON public.companies
  FOR SELECT TO authenticated
  USING (id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "companies_update" ON public.companies
  FOR UPDATE TO authenticated
  USING (id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (id = public.get_my_company_id() AND public.is_admin());

-- B. Table PROFILES
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() OR id = auth.uid());

CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin() AND role = 'caporal');

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((company_id = public.get_my_company_id() AND public.is_admin()) OR id = auth.uid())
  WITH CHECK ((company_id = public.get_my_company_id() AND public.is_admin()) OR id = auth.uid());

CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin() AND role = 'caporal');

-- C. Tables REFERENTIELS (ouvriers, taches, serres, domaines)
-- Lecture : Admin & Caporal | Écriture : Admin uniquement

-- Ouvriers
CREATE POLICY "ouvriers_select" ON public.ouvriers
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "ouvriers_insert" ON public.ouvriers
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "ouvriers_update" ON public.ouvriers
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "ouvriers_delete" ON public.ouvriers
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Tâches
CREATE POLICY "taches_select" ON public.taches
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "taches_insert" ON public.taches
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "taches_update" ON public.taches
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "taches_delete" ON public.taches
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Serres
CREATE POLICY "serres_select" ON public.serres
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "serres_insert" ON public.serres
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "serres_update" ON public.serres
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "serres_delete" ON public.serres
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Domaines
CREATE POLICY "domaines_select" ON public.domaines
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "domaines_insert" ON public.domaines
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "domaines_update" ON public.domaines
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "domaines_delete" ON public.domaines
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- D. Tables SAISIES TERRAIN (pointages, affectations, recolte_entries)
-- Lecture, Insert, Update : Admin & Caporal | Delete : Admin uniquement (interdiction pour Caporal d'effacer les historiques)

-- Pointages
CREATE POLICY "pointages_select" ON public.pointages
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "pointages_insert" ON public.pointages
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "pointages_update" ON public.pointages
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "pointages_delete" ON public.pointages
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Affectations
CREATE POLICY "affectations_select" ON public.affectations
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "affectations_insert" ON public.affectations
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "affectations_update" ON public.affectations
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "affectations_delete" ON public.affectations
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Récoltes
CREATE POLICY "recolte_select" ON public.recolte_entries
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "recolte_insert" ON public.recolte_entries
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "recolte_update" ON public.recolte_entries
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_active_user())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_active_user());

CREATE POLICY "recolte_delete" ON public.recolte_entries
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- E. Tables GESTION CONFIDENTIELLE (heures_supplementaires, gazoil_mouvements, stock_produits, stock_mouvements)
-- Réservé strictement à l'Admin

-- Heures Supplémentaires
CREATE POLICY "heures_supp_select" ON public.heures_supplementaires
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "heures_supp_insert" ON public.heures_supplementaires
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "heures_supp_update" ON public.heures_supplementaires
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "heures_supp_delete" ON public.heures_supplementaires
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Gazoil Mouvements
CREATE POLICY "gazoil_select" ON public.gazoil_mouvements
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "gazoil_insert" ON public.gazoil_mouvements
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "gazoil_update" ON public.gazoil_mouvements
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "gazoil_delete" ON public.gazoil_mouvements
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Stock Produits
CREATE POLICY "stock_prod_select" ON public.stock_produits
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_prod_insert" ON public.stock_produits
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_prod_update" ON public.stock_produits
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_prod_delete" ON public.stock_produits
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- Stock Mouvements
CREATE POLICY "stock_mvt_select" ON public.stock_mouvements
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_mvt_insert" ON public.stock_mouvements
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_mvt_update" ON public.stock_mouvements
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_my_company_id() AND public.is_admin());

CREATE POLICY "stock_mvt_delete" ON public.stock_mouvements
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id() AND public.is_admin());

-- ---------------------------------------------------------------------
-- 9. FONCTION TRANSACTIONNELLE ATOMIQUE ANTI-FALSIFICATION POUR LE STOCK
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enregistrer_sortie_stock(
  p_idempotency_key TEXT,
  p_produit_id TEXT,
  p_quantite NUMERIC,
  p_date TEXT,
  p_domaine_id TEXT DEFAULT NULL,
  p_serre_id TEXT DEFAULT NULL,
  p_tiers TEXT DEFAULT NULL,
  p_motif TEXT DEFAULT NULL,
  p_observation TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_company_id TEXT;
  v_user_nom TEXT;
  v_is_admin BOOLEAN;
  v_existing RECORD;
  v_produit RECORD;
  v_stock_actuel NUMERIC;
  v_mouvement_id TEXT;
BEGIN
  -- 1. SECURITE JWT STRICTE : Extraction de l'identité réelle depuis le token de session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié : Un jeton de session valide est requis';
  END IF;

  -- Validation du profil et de la société de l'utilisateur connecté
  SELECT company_id, nom, (role = 'admin' AND actif = true) 
  INTO v_company_id, v_user_nom, v_is_admin
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_company_id IS NULL OR NOT v_is_admin THEN
    RAISE EXCEPTION 'Accès refusé : Seul un Administrateur actif peut enregistrer des sorties de stock';
  END IF;

  -- 2. VERIFICATION D'IDEMPOTENCE
  SELECT id, quantite INTO v_existing 
  FROM public.stock_mouvements 
  WHERE idempotency_key = p_idempotency_key AND company_id = v_company_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'mouvement_id', v_existing.id,
      'is_duplicate_replay', true,
      'message', 'Opération déjà enregistrée (rejouée avec succès)'
    );
  END IF;

  -- 3. VERROUILLAGE EXCLUSIF DE LIGNE (FOR UPDATE)
  SELECT * INTO v_produit 
  FROM public.stock_produits 
  WHERE id = p_produit_id AND company_id = v_company_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit introuvable pour cette entreprise';
  END IF;

  -- 4. CALCUL DU STOCK DISPONIBLE DANS LA TRANSACTION
  SELECT COALESCE(
    SUM(CASE WHEN type IN ('INITIAL', 'ENTREE') THEN quantite ELSE -quantite END), 0
  ) INTO v_stock_actuel
  FROM public.stock_mouvements
  WHERE produit_id = p_produit_id AND company_id = v_company_id;

  -- 5. CONTROLE DE DEPASSEMENT STRICT
  IF v_stock_actuel < p_quantite THEN
    RAISE EXCEPTION 'Stock insuffisant : stock disponible = %, quantité demandée = %', v_stock_actuel, p_quantite;
  END IF;

  -- 6. CREATION SECURISEE DU MOUVEMENT (company_id et created_by_id issus du serveur, infalsifiables)
  v_mouvement_id := 'mvt_' || floor(extract(epoch from now()) * 1000)::text || '_' || substr(md5(random()::text), 1, 6);

  INSERT INTO public.stock_mouvements (
    id, idempotency_key, company_id, produit_id, produit_nom, unite,
    type, quantite, date, domaine_id, serre_id, tiers, motif, observation,
    created_by_id, created_by_nom, created_at
  ) VALUES (
    v_mouvement_id, p_idempotency_key, v_company_id, p_produit_id, v_produit.nom, v_produit.unite,
    'SORTIE', p_quantite, p_date, p_domaine_id, p_serre_id, p_tiers, p_motif, p_observation,
    v_user_id, v_user_nom, NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'mouvement_id', v_mouvement_id,
    'nouveau_stock', (v_stock_actuel - p_quantite)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Surcharge de compatibilité si anciens appels transmettent p_company_id / p_admin_id
CREATE OR REPLACE FUNCTION public.enregistrer_sortie_stock(
  p_idempotency_key TEXT,
  p_company_id TEXT,
  p_produit_id TEXT,
  p_quantite NUMERIC,
  p_date TEXT,
  p_domaine_id TEXT,
  p_serre_id TEXT,
  p_tiers TEXT,
  p_motif TEXT,
  p_observation TEXT,
  p_admin_id UUID,
  p_admin_nom TEXT
) RETURNS JSONB AS $$
BEGIN
  RETURN public.enregistrer_sortie_stock(
    p_idempotency_key,
    p_produit_id,
    p_quantite,
    p_date,
    p_domaine_id,
    p_serre_id,
    p_tiers,
    p_motif,
    p_observation
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
