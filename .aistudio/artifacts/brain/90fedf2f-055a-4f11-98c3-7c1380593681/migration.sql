-- Migration: Add missing columns to support full TypeScript types
-- NON-DESTRUCTIVE: Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS

-- 1. Table: heures_supplementaires
-- Add missing columns
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS numero_ouvrier INTEGER;
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS tache_id TEXT REFERENCES taches(id);
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS quantite DECIMAL;
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS unite TEXT;
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS heure_enregistrement TIME;
ALTER TABLE heures_supplementaires ADD COLUMN IF NOT EXISTS timestamp BIGINT;

-- Rename 'type_supp' to 'type' if it exists and the new column doesn't
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='heures_supplementaires' AND column_name='type_supp') THEN
        ALTER TABLE heures_supplementaires RENAME COLUMN type_supp TO type;
    END IF;
END $$;

-- 2. Update Gazoil Config (JSONB for flexibility)
-- Assuming gazoil_config already exists with company_id as PK
ALTER TABLE gazoil_config ADD COLUMN IF NOT EXISTS config_json JSONB DEFAULT '{}';

-- 3. Create a helper function for RLS (ensure it exists)
CREATE OR REPLACE FUNCTION get_user_company_id() RETURNS TEXT AS $$
  SELECT company_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- Ensure RLS enabled on all relevant tables
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['ouvriers', 'taches', 'pointages', 'affectations', 'recolte_entries', 'serres', 'heures_supplementaires', 'gazoil_mouvements', 'gazoil_config']
  LOOP
    EXECUTE 'ALTER TABLE ' || tbl || ' ENABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;
