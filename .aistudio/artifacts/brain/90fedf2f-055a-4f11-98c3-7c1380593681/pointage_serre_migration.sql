-- Migration SQL additive et rétrocompatible pour l'affectation par serre dans public.pointages
ALTER TABLE IF EXISTS public.pointages 
  ADD COLUMN IF NOT EXISTS serre_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS serre_nom VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_pointages_serre_id 
ON public.pointages(company_id, date, serre_id);
