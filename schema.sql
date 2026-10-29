-- Schema SQL pour Lahcen Pointeur
-- Assure l'isolation multi-entreprise (Multi-tenant)

-- Table des Entreprises
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  code TEXT NOT NULL,
  ville TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Profils Utilisateurs (Auth + Rôle)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  username TEXT NOT NULL,
  nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'caporal')),
  company_id TEXT REFERENCES companies(id),
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Ouvriers
CREATE TABLE IF NOT EXISTS ouvriers (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  numero INTEGER NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, numero)
);

-- Table des Tâches
CREATE TABLE IF NOT EXISTS taches (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  code TEXT,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  couleur TEXT,
  ouvriers_autorises TEXT DEFAULT 'tous',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des Serres
CREATE TABLE IF NOT EXISTS serres (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  code TEXT NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  ordre INTEGER NOT NULL
);

-- Table des Pointages
CREATE TABLE IF NOT EXISTS pointages (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  ouvrier_id TEXT REFERENCES ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  date TEXT NOT NULL,
  present BOOLEAN DEFAULT TRUE,
  tache_id TEXT REFERENCES taches(id),
  domaine_id TEXT,
  heure TEXT NOT NULL,
  timestamp BIGINT NOT NULL
);

-- Table des Récoltes
CREATE TABLE IF NOT EXISTS recolte_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  date TEXT NOT NULL,
  serre_id TEXT REFERENCES serres(id),
  serre_nom TEXT NOT NULL,
  ouvrier_id TEXT REFERENCES ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  nom_ouvrier TEXT NOT NULL,
  caisses NUMERIC NOT NULL,
  notes TEXT,
  created_by_id UUID REFERENCES profiles(id),
  created_by_nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- RLS Policies (Exemple pour 'ouvriers' - à appliquer aux autres tables)
ALTER TABLE ouvriers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Isolation multi-entreprise" ON ouvriers
  USING (company_id = (SELECT company_id FROM profiles WHERE id = auth.uid()));
