-- =====================================================================
-- MIGRATION CORRECTIVE DÉFINITIVE : INTÉGRITÉ RÉFÉRENTIELLE COMPANY_ID
-- Résolution de l'erreur stock_produits_company_id_fkey
-- Non-destructive, idempotent et respectueux des données existantes
-- =====================================================================

-- 1. S'assurer que la société d'exploitation principale existe dans public.companies
INSERT INTO public.companies (id, nom, code, ville)
VALUES ('cie_lahcen_pointeur', 'Exploitation Agricole Lahcen Pointeur', 'LAH', 'Guelmim')
ON CONFLICT (id) DO UPDATE 
SET nom = EXCLUDED.nom, code = EXCLUDED.code;

-- 2. Aligner les profils existants ayant un company_id NULL ou orphelin vers la société réelle
UPDATE public.profiles
SET company_id = 'cie_lahcen_pointeur'
WHERE company_id IS NULL 
   OR company_id NOT IN (SELECT id FROM public.companies);

-- 3. Autoriser les Administrateurs à créer / insérer une société dans public.companies (si manquante)
DROP POLICY IF EXISTS "companies_insert" ON public.companies;
CREATE POLICY "companies_insert" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin' AND actif = true
    )
  );

-- 4. Élargir la lecture des entreprises pour l'Administrateur actif
DROP POLICY IF EXISTS "companies_select" ON public.companies;
CREATE POLICY "companies_select" ON public.companies
  FOR SELECT TO authenticated
  USING (
    id = (SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND role = 'admin' AND actif = true
    )
  );

-- 5. Vérifier la contrainte de clé étrangère sur stock_produits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'stock_produits_company_id_fkey'
      AND table_name = 'stock_produits'
  ) THEN
    ALTER TABLE public.stock_produits
      ADD CONSTRAINT stock_produits_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
  END IF;
END $$;
