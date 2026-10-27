-- Tables for multi-tenant Lahcen Pointeur application

-- 1. Companies
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  code TEXT NOT NULL,
  ville TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Profiles (Users + Roles)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  username TEXT NOT NULL,
  nom TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'caporal')),
  company_id TEXT REFERENCES companies(id),
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

-- 3. Ouvriers
CREATE TABLE ouvriers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  numero INTEGER NOT NULL,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  telephone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Taches
CREATE TABLE taches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  couleur TEXT,
  ouvriers_autorises JSONB DEFAULT '"tous"',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Pointages
CREATE TABLE pointages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  ouvrier_id TEXT NOT NULL REFERENCES ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  date DATE NOT NULL,
  present BOOLEAN NOT NULL DEFAULT TRUE,
  tache_id TEXT REFERENCES taches(id),
  domaine_id TEXT,
  heure TIME NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Affectations
CREATE TABLE affectations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  ouvrier_id TEXT NOT NULL REFERENCES ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  tache_id TEXT NOT NULL REFERENCES taches(id),
  date DATE NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Recolte Entries
CREATE TABLE recolte_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  date DATE NOT NULL,
  serre_id TEXT NOT NULL,
  serre_nom TEXT NOT NULL,
  ouvrier_id TEXT NOT NULL REFERENCES ouvriers(id),
  numero_ouvrier INTEGER NOT NULL,
  nom_ouvrier TEXT NOT NULL,
  caisses INTEGER NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_nom TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  updated_by_id TEXT,
  sync_status TEXT DEFAULT 'synced'
);

-- 8. Serres
CREATE TABLE serres (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT,
  nom TEXT NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  ordre INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Heures Supplementaires
CREATE TABLE heures_supplementaires (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  ouvrier_id TEXT NOT NULL REFERENCES ouvriers(id),
  date DATE NOT NULL,
  type_supp TEXT NOT NULL,
  heures DECIMAL NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Gazoil Config & Mouvements
CREATE TABLE gazoil_config (
  company_id TEXT PRIMARY KEY REFERENCES companies(id),
  prix_unitaire DECIMAL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gazoil_mouvements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL,
  quantite DECIMAL NOT NULL,
  date DATE NOT NULL,
  commentaire TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies (Apply to all tables)
-- Simplified policy function for company_id check
CREATE OR REPLACE FUNCTION get_user_company_id() RETURNS TEXT AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- Apply to all tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ouvriers', 'taches', 'pointages', 'affectations', 'recolte_entries', 'serres', 'heures_supplementaires', 'gazoil_mouvements']
  LOOP
    EXECUTE 'ALTER TABLE ' || tbl || ' ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "Users can view data of their company" ON ' || tbl || ' FOR SELECT USING (company_id = get_user_company_id())';
    EXECUTE 'CREATE POLICY "Users can insert data of their company" ON ' || tbl || ' FOR INSERT WITH CHECK (company_id = get_user_company_id())';
    EXECUTE 'CREATE POLICY "Users can update data of their company" ON ' || tbl || ' FOR UPDATE USING (company_id = get_user_company_id())';
    EXECUTE 'CREATE POLICY "Users can delete data of their company" ON ' || tbl || ' FOR DELETE USING (company_id = get_user_company_id())';
  END LOOP;
END $$;
