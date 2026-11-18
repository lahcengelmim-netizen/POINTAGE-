import { supabase } from './supabaseClient';
import {
  STORAGE_KEYS,
  getActiveCompanyId,
  getDefaultDomaineId,
  isProvisionalDefaultOuvrier,
} from './storage';
import { normalizePayloadForSupabase, upsertWithColumnFallback } from './supabaseSync';

export interface MigrationOptions {
  force?: boolean;
  client?: any;
  companyId?: string;
}

export async function runDataMigration(
  options?: MigrationOptions
): Promise<{ success: boolean; message: string; counts?: Record<string, number> }> {
  const client = options?.client || supabase;
  const companyId = options?.companyId || getActiveCompanyId();
  const counts: Record<string, number> = {};

  try {
    // Migration incrémentale et idempotente : on ne bloque pas si force=true ou si une tentative précédente a échoué
    if (!options?.force) {
      const doneAt = localStorage.getItem('agripointage_migration_done');
      if (doneAt === 'v2_complete') {
        return { success: true, message: 'La migration complète est déjà effectuée.' };
      }
    }

    // Ordre parent -> enfant pour respecter strictement les clés étrangères Supabase
    const orderedSteps = [
      { key: STORAGE_KEYS.COMPANIES, table: 'companies', conflict: 'id' },
      { key: STORAGE_KEYS.DOMAINES, table: 'domaines', conflict: 'id' },
      { key: STORAGE_KEYS.OUVRIERS, table: 'ouvriers', conflict: 'id' },
      { key: STORAGE_KEYS.TACHES, table: 'taches', conflict: 'id' },
      { key: STORAGE_KEYS.SERRES, table: 'serres', conflict: 'id' },
      { key: STORAGE_KEYS.POINTAGES, table: 'pointages', conflict: 'id' },
      { key: STORAGE_KEYS.AFFECTATIONS, table: 'affectations', conflict: 'id' },
      { key: STORAGE_KEYS.TACHE_SERRES, table: 'tache_serres', conflict: 'id' },
      { key: STORAGE_KEYS.RECOLTE, table: 'recolte_entries', conflict: 'id' },
      { key: STORAGE_KEYS.HEURES_SUPP, table: 'heures_supplementaires', conflict: 'id' },
      { key: STORAGE_KEYS.TACHES_SUPP, table: 'taches_supplementaires', conflict: 'id' },
      { key: STORAGE_KEYS.GAZOIL_CONFIG, table: 'gazoil_config', conflict: 'company_id' },
      { key: STORAGE_KEYS.GAZOIL_MOUVEMENTS, table: 'gazoil_mouvements', conflict: 'id' },
    ];

    for (const step of orderedSteps) {
      const raw = localStorage.getItem(step.key);
      if (!raw) continue;

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      let rows: any[] = [];

      if (step.table === 'gazoil_config' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        rows = Object.entries(parsed).map(([cieId, cfg]: [string, any]) => ({
          ...(cfg || {}),
          company_id: cieId,
        }));
      } else if (Array.isArray(parsed)) {
        rows = parsed;
      } else {
        continue;
      }

      if (step.table === 'domaines') {
        rows = rows.map((d) => ({ ...d, company_id: d.company_id || companyId }));
      } else if (step.table === 'serres') {
        rows = rows.filter(
          (s: any) =>
            !(
              s?.id === 'serre_23' &&
              (!s.domaine_id || s.domaine_id === 'dom_d3' || String(s.code || '').toUpperCase() === 'S23')
            )
        );
      } else if (step.table === 'ouvriers') {
        const hasRealWorkers = rows.some((o) => !isProvisionalDefaultOuvrier(o));
        if (hasRealWorkers) {
          rows = rows.filter((o) => !isProvisionalDefaultOuvrier(o));
        }
      } else if (step.table === 'tache_serres') {
        // Éclater TacheSerreConfig (serre_ids[]) en lignes SQL tache_serres
        const expanded: any[] = [];
        for (const cfg of rows) {
          if (!cfg || !cfg.tache_id || !cfg.date || !Array.isArray(cfg.serre_ids)) continue;
          const cie = cfg.company_id || companyId;
          cfg.serre_ids.forEach((serreId: string, idx: number) => {
            if (!serreId) return;
            expanded.push({
              id: `${cie}__${cfg.date}__${cfg.tache_id}__${serreId}`,
              company_id: cie,
              date: cfg.date,
              tache_id: cfg.tache_id,
              domaine_id: cfg.domaine_id || getDefaultDomaineId(),
              serre_id: serreId,
              serre_nom: (Array.isArray(cfg.serre_noms) && cfg.serre_noms[idx]) || serreId,
              updated_at: new Date(cfg.updated_at || Date.now()).toISOString(),
            });
          });
        }
        rows = expanded;
      }

      let migratedTableCount = 0;
      for (const row of rows) {
        const payload = normalizePayloadForSupabase(step.table, row);
        const { error } = await upsertWithColumnFallback(client, step.table, payload, step.conflict);
        if (error) {
          throw new Error(`Erreur migration ${step.table}: ${error.message || error}`);
        }
        migratedTableCount += 1;
      }
      counts[step.table] = migratedTableCount;
    }

    localStorage.setItem('agripointage_migration_done', 'v2_complete');
    return { success: true, message: 'Migration globale réussie !', counts };
  } catch (error) {
    console.error('Migration failed:', error);
    return {
      success: false,
      message: `Erreur de migration: ${error instanceof Error ? error.message : 'Inconnue'}`,
      counts,
    };
  }
}
