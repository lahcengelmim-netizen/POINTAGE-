import { supabase } from './supabaseClient';
import {
  STORAGE_KEYS,
  getDefaultDomaineId,
  reconcileAffectationsFromRemote,
  reconcileCompaniesFromRemote,
  reconcileGazoilConfigFromRemote,
  reconcileGazoilMouvementsFromRemote,
  reconcileOuvriersFromRemote,
  reconcilePointagesFromRemote,
  reconcileRecoltesFromRemote,
  reconcileSerresFromRemote,
  reconcileTacheSerresFromRemote,
  reconcileTachesFromRemote,
  mergeHeuresSupplementairesServerData,
  mergeTachesSupplementairesServerData,
} from './storage';
import {
  OUTBOX_KEYS,
  dequeueOutboxOpsById,
  getOutboxOps,
  markOutboxOpsFailed,
  migrateLegacySyncQueue,
  OutboxOp,
} from './syncOutbox';
import { TacheSerreConfig } from '../types';

export interface SupabaseSyncOptions {
  client?: any;
  skipSessionCheck?: boolean;
  ignoreNavigatorOnline?: boolean;
  allowedTables?: Set<string>;
}

export interface CorePullResult {
  pulledCounts: Record<string, number>;
  errors: Array<{ table: string; error: string }>;
}

export interface CorePushResult {
  pushedCount: number;
  failedCount: number;
  errors: Array<{ table: string; entityId: string; error: string }>;
}

// Map local storage keys to Supabase table names
const TABLE_MAP: Record<string, string> = {
  [STORAGE_KEYS.COMPANIES]: 'companies',
  [STORAGE_KEYS.DOMAINES]: 'domaines',
  [STORAGE_KEYS.OUVRIERS]: 'ouvriers',
  [STORAGE_KEYS.TACHES]: 'taches',
  [STORAGE_KEYS.POINTAGES]: 'pointages',
  [STORAGE_KEYS.AFFECTATIONS]: 'affectations',
  [STORAGE_KEYS.TACHE_SERRES]: 'tache_serres',
  [STORAGE_KEYS.RECOLTE]: 'recolte_entries',
  [STORAGE_KEYS.SERRES]: 'serres',
  [STORAGE_KEYS.HEURES_SUPP]: 'heures_supplementaires',
  [STORAGE_KEYS.TACHES_SUPP]: 'taches_supplementaires',
  [STORAGE_KEYS.GAZOIL_CONFIG]: 'gazoil_config',
  [STORAGE_KEYS.GAZOIL_MOUVEMENTS]: 'gazoil_mouvements',
};

function isOnline(ignoreNavigatorOnline?: boolean): boolean {
  if (ignoreNavigatorOnline) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return true;
}

async function hasActiveSession(client: any, options?: SupabaseSyncOptions): Promise<boolean> {
  if (options?.skipSessionCheck) return true;
  if (!client?.auth?.getSession) return Boolean(options?.client);
  try {
    const { data: sessionData } = await client.auth.getSession();
    return Boolean(sessionData?.session);
  } catch {
    return false;
  }
}

function isBlockedSerre23Payload(tableName: string, data: any): boolean {
  if (tableName !== 'serres' || !data) return false;
  return (
    data.id === 'serre_23' &&
    (!data.domaine_id || data.domaine_id === 'dom_d3' || String(data.code || '').toUpperCase() === 'S23')
  );
}

export function normalizePayloadForSupabase(tableName: string, rawData: any): any {
  if (!rawData || typeof rawData !== 'object') return rawData;
  const data = { ...rawData };

  // Mapper createdAt -> created_at si présent
  if ('createdAt' in data) {
    if (!data.created_at && data.createdAt) {
      data.created_at = data.createdAt;
    }
    delete data.createdAt;
  }
  if ('updatedAt' in data) {
    if (!data.updated_at && data.updatedAt) {
      data.updated_at = data.updatedAt;
    }
    delete data.updatedAt;
  }

  if (tableName === 'affectations') {
    const { serres_ids: _ids, serres_noms: _noms, ...dbRow } = data;
    return dbRow;
  }

  if (tableName === 'recolte_entries') {
    const { sync_status: _sync, ...dbRow } = data;
    return dbRow;
  }

  if (tableName === 'gazoil_config') {
    return {
      company_id: data.company_id,
      stock_initial: data.stock_initial ?? data.stockInitial ?? 0,
      initial_set: data.initial_set ?? data.initialSet ?? false,
      seuil_alerte: data.seuil_alerte ?? data.seuilAlerte ?? 20,
      commande_active:
        data.commande_active !== undefined
          ? data.commande_active
          : data.commandeActive ?? null,
      notified_below_threshold:
        data.notified_below_threshold ?? data.notifiedBelowThreshold ?? false,
      updated_at: data.updated_at || new Date().toISOString(),
    };
  }

  if (tableName === 'domaines') {
    return {
      id: data.id,
      company_id: data.company_id,
      nom: data.nom,
      ordre: data.ordre ?? 1,
      updated_at: data.updated_at || new Date().toISOString(),
    };
  }

  if (tableName === 'companies') {
    return {
      id: data.id,
      nom: data.nom,
      code: data.code,
      ville: data.ville ?? null,
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || new Date().toISOString(),
    };
  }

  return data;
}

function normalizeRemoteRowForLocal(tableName: string, row: any): any {
  if (!row || typeof row !== 'object') return row;
  if (
    (tableName === 'companies' || tableName === 'ouvriers' || tableName === 'taches') &&
    row.created_at &&
    !row.createdAt
  ) {
    return { ...row, createdAt: row.created_at };
  }
  return row;
}

function extractUnknownColumnName(error: any): string | null {
  const msg = String(error?.message || error?.details || '');
  const pgrst = msg.match(/Could not find the '([^']+)' column/i);
  if (pgrst?.[1]) return pgrst[1];
  const pg = msg.match(/column "([^"]+)" of relation "[^"]+" does not exist/i);
  if (pg?.[1]) return pg[1];
  return null;
}

export async function upsertWithColumnFallback(
  client: any,
  tableName: string,
  payload: Record<string, any>,
  onConflict: string = 'id'
): Promise<{ error: any | null }> {
  const currentPayload = { ...payload };
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await client.from(tableName).upsert(currentPayload, { onConflict });
    if (!res?.error) return { error: null };
    const unknownCol = extractUnknownColumnName(res.error);
    if (unknownCol && unknownCol in currentPayload) {
      delete currentPayload[unknownCol];
      continue;
    }
    return { error: res.error };
  }
  return { error: new Error(`Échec upsert ${tableName} après repli colonnes`) };
}

async function syncTacheSerreConfigOp(client: any, op: OutboxOp): Promise<void> {
  const cfg = op.data as TacheSerreConfig;
  if (!cfg || !cfg.company_id || !cfg.date || !cfg.tache_id) return;

  // Supprimer les anciennes associations de serres pour cette tâche/date afin d'éviter des restes obsolètes
  const delRes = await client
    .from('tache_serres')
    .delete()
    .eq('company_id', cfg.company_id)
    .eq('date', cfg.date)
    .eq('tache_id', cfg.tache_id);
  if (delRes?.error) throw delRes.error;

  const serreIds = Array.isArray(cfg.serre_ids) ? cfg.serre_ids : [];
  const serreNoms = Array.isArray(cfg.serre_noms) ? cfg.serre_noms : [];

  for (let i = 0; i < serreIds.length; i++) {
    const serreId = serreIds[i];
    if (!serreId) continue;
    const row = {
      id: `${cfg.company_id}__${cfg.date}__${cfg.tache_id}__${serreId}`,
      company_id: cfg.company_id,
      date: cfg.date,
      tache_id: cfg.tache_id,
      domaine_id: cfg.domaine_id || getDefaultDomaineId(),
      serre_id: serreId,
      serre_nom: serreNoms[i] || serreId,
      updated_at: new Date(cfg.updated_at || Date.now()).toISOString(),
    };
    const { error } = await upsertWithColumnFallback(client, 'tache_serres', row, 'id');
    if (error) throw error;
  }
}

export async function fetchAllFromSupabase(
  client: any,
  tableName: string,
  filters?: { companyId?: string; idEquals?: string; orderCol?: string; ascending?: boolean }
): Promise<{ data: any[] | null; error: any | null }> {
  const pageSize = 1000;
  let from = 0;
  const allRows: any[] = [];

  while (true) {
    let query = client.from(tableName).select('*');
    if (filters?.companyId) {
      query = query.eq('company_id', filters.companyId);
    }
    if (filters?.idEquals) {
      query = query.eq('id', filters.idEquals);
    }
    if (filters?.orderCol) {
      query = query.order(filters.orderCol, { ascending: filters.ascending ?? true });
    }
    if (typeof query.range === 'function') {
      query = query.range(from, from + pageSize - 1);
    }

    const res = await query;
    if (res?.error) {
      return { data: null, error: res.error };
    }
    const pageData = Array.isArray(res?.data) ? res.data : [];
    allRows.push(...pageData);
    if (typeof query.range !== 'function' || pageData.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return { data: allRows, error: null };
}

export async function pullReferentielsSerresFromSupabase(
  companyId: string,
  options?: SupabaseSyncOptions
): Promise<void> {
  if (!isOnline(options?.ignoreNavigatorOnline)) return;
  const client = options?.client || supabase;
  try {
    const okSession = await hasActiveSession(client, options);
    if (!okSession) return;

    const [domRes, serresRes] = await Promise.all([
      fetchAllFromSupabase(client, 'domaines', { companyId, orderCol: 'ordre', ascending: true }),
      fetchAllFromSupabase(client, 'serres', { companyId, orderCol: 'ordre', ascending: true }),
    ]);

    const remoteDomaines = !domRes.error && Array.isArray(domRes.data) ? domRes.data : undefined;
    const remoteSerres = !serresRes.error && Array.isArray(serresRes.data) ? serresRes.data : [];

    if (remoteSerres.length > 0 || (remoteDomaines && remoteDomaines.length > 0)) {
      reconcileSerresFromRemote(remoteSerres as any, remoteDomaines as any);
    }
  } catch (err) {
    console.warn('Synchronisation lecture référentiels domaines/serres différée:', err);
  }
}

async function processTypedOutboxQueue(
  queueKey: string,
  options?: SupabaseSyncOptions
): Promise<CorePushResult> {
  const result: CorePushResult = { pushedCount: 0, failedCount: 0, errors: [] };
  if (!isOnline(options?.ignoreNavigatorOnline)) return result;

  const client = options?.client || supabase;
  const okSession = await hasActiveSession(client, options);
  if (!okSession) return result;

  const ops = getOutboxOps(queueKey);
  if (ops.length === 0) return result;

  const confirmedIds: string[] = [];
  const failedIds: string[] = [];

  for (const op of ops) {
    const tableName = TABLE_MAP[op.table] || op.table;
    if (options?.allowedTables && !options.allowedTables.has(tableName)) {
      continue;
    }
    if (isBlockedSerre23Payload(tableName, op.data)) {
      confirmedIds.push(op.opId);
      continue;
    }

    try {
      if (tableName === 'tache_serres' && op.action === 'upsert') {
        await syncTacheSerreConfigOp(client, op);
        confirmedIds.push(op.opId);
        result.pushedCount += 1;
        continue;
      }

      if (op.action === 'delete' && op.entityId) {
        let delQuery = client.from(tableName).delete().eq('id', op.entityId);
        if (op.companyId && tableName !== 'companies' && typeof delQuery.eq === 'function') {
          delQuery = delQuery.eq('company_id', op.companyId);
        }
        const { error } = await delQuery;
        if (error) throw error;
        confirmedIds.push(op.opId);
        result.pushedCount += 1;
      } else if (op.data) {
        const normalized = normalizePayloadForSupabase(tableName, op.data);
        const conflictCol = tableName === 'gazoil_config' ? 'company_id' : 'id';
        const { error } = await upsertWithColumnFallback(client, tableName, normalized, conflictCol);
        if (error) throw error;
        confirmedIds.push(op.opId);
        result.pushedCount += 1;
      }
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.warn(`Sync différée échouée (${tableName}/${op.entityId}):`, msg);
      failedIds.push(op.opId);
      result.failedCount += 1;
      result.errors.push({ table: tableName, entityId: op.entityId, error: msg });
      markOutboxOpsFailed(queueKey, [op.opId], msg);
    }
  }

  if (confirmedIds.length > 0) {
    dequeueOutboxOpsById(queueKey, confirmedIds);
  }

  return result;
}

export async function syncPointageQueueToSupabase(
  options?: SupabaseSyncOptions
): Promise<CorePushResult> {
  migrateLegacySyncQueue();
  return processTypedOutboxQueue(OUTBOX_KEYS.POINTAGE, options);
}

export async function syncReferentielsQueueToSupabase(
  options?: SupabaseSyncOptions
): Promise<CorePushResult> {
  migrateLegacySyncQueue();
  return processTypedOutboxQueue(OUTBOX_KEYS.REFERENTIELS, options);
}

export async function syncGazoilQueueToSupabase(
  options?: SupabaseSyncOptions
): Promise<CorePushResult> {
  migrateLegacySyncQueue();
  return processTypedOutboxQueue(OUTBOX_KEYS.GAZOIL, options);
}

export async function syncQueueToSupabase(options?: SupabaseSyncOptions): Promise<CorePushResult> {
  migrateLegacySyncQueue();
  const [ptgRes, refRes, gzRes] = await Promise.all([
    processTypedOutboxQueue(OUTBOX_KEYS.POINTAGE, options),
    processTypedOutboxQueue(OUTBOX_KEYS.REFERENTIELS, options),
    processTypedOutboxQueue(OUTBOX_KEYS.GAZOIL, options),
  ]);

  return {
    pushedCount: ptgRes.pushedCount + refRes.pushedCount + gzRes.pushedCount,
    failedCount: ptgRes.failedCount + refRes.failedCount + gzRes.failedCount,
    errors: [...ptgRes.errors, ...refRes.errors, ...gzRes.errors],
  };
}

function groupRemoteTacheSerreRows(companyId: string, rows: any[]): TacheSerreConfig[] {
  const grouped = new Map<string, TacheSerreConfig>();
  for (const r of rows) {
    if (!r || !r.date || !r.tache_id) continue;
    const key = `${r.company_id || companyId}__${r.date}__${r.tache_id}`;
    const existing = grouped.get(key);
    const updatedMs = r.updated_at ? Date.parse(r.updated_at) || Date.now() : Date.now();
    if (!existing) {
      grouped.set(key, {
        id: `ts_${r.company_id || companyId}_${r.date}_${r.tache_id}`,
        company_id: r.company_id || companyId,
        date: r.date,
        tache_id: r.tache_id,
        domaine_id: r.domaine_id || getDefaultDomaineId(),
        serre_ids: r.serre_id ? [r.serre_id] : [],
        serre_noms: r.serre_nom ? [r.serre_nom] : [],
        updated_at: updatedMs,
      });
    } else {
      if (r.serre_id && !existing.serre_ids.includes(r.serre_id)) {
        existing.serre_ids.push(r.serre_id);
        existing.serre_noms.push(r.serre_nom || r.serre_id);
      }
      if (updatedMs > existing.updated_at) {
        existing.updated_at = updatedMs;
      }
    }
  }
  return Array.from(grouped.values());
}

/**
 * Hydrate et réconcilie de manière non destructive l'ensemble des tables Supabase de l'entreprise.
 * Une erreur ou réponse vide ne détruit jamais les données locales existantes.
 */
export async function pullAllCoreModulesFromSupabase(
  companyId: string,
  options?: SupabaseSyncOptions
): Promise<CorePullResult> {
  const report: CorePullResult = { pulledCounts: {}, errors: [] };
  if (!isOnline(options?.ignoreNavigatorOnline)) return report;

  const client = options?.client || supabase;
  const okSession = await hasActiveSession(client, options);
  if (!okSession) return report;

  const isAllowed = (table: string) =>
    !options?.allowedTables || options.allowedTables.has(table);

  // 1. Companies
  if (isAllowed('companies')) {
    const res = await fetchAllFromSupabase(client, 'companies', { idEquals: companyId });
    if (res.error) {
      report.errors.push({ table: 'companies', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      const normalized = res.data.map((r) => normalizeRemoteRowForLocal('companies', r));
      reconcileCompaniesFromRemote(normalized);
      report.pulledCounts.companies = normalized.length;
    }
  }

  // 2. Domaines & Serres
  if (isAllowed('domaines') || isAllowed('serres')) {
    const [domRes, serresRes] = await Promise.all([
      isAllowed('domaines')
        ? fetchAllFromSupabase(client, 'domaines', { companyId, orderCol: 'ordre', ascending: true })
        : Promise.resolve({ data: null, error: null }),
      isAllowed('serres')
        ? fetchAllFromSupabase(client, 'serres', { companyId, orderCol: 'ordre', ascending: true })
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (domRes.error) {
      report.errors.push({ table: 'domaines', error: domRes.error.message || String(domRes.error) });
    }
    if (serresRes.error) {
      report.errors.push({ table: 'serres', error: serresRes.error.message || String(serresRes.error) });
    }
    const remoteDoms = !domRes.error && Array.isArray(domRes.data) ? domRes.data : undefined;
    const remoteSerres = !serresRes.error && Array.isArray(serresRes.data) ? serresRes.data : [];
    if (remoteSerres.length > 0 || (remoteDoms && remoteDoms.length > 0)) {
      reconcileSerresFromRemote(remoteSerres, remoteDoms);
      if (remoteDoms) report.pulledCounts.domaines = remoteDoms.length;
      if (remoteSerres.length > 0) report.pulledCounts.serres = remoteSerres.length;
    }
  }

  // 3. Ouvriers
  if (isAllowed('ouvriers')) {
    const res = await fetchAllFromSupabase(client, 'ouvriers', { companyId, orderCol: 'numero', ascending: true });
    if (res.error) {
      report.errors.push({ table: 'ouvriers', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      const normalized = res.data.map((r) => normalizeRemoteRowForLocal('ouvriers', r));
      reconcileOuvriersFromRemote(companyId, normalized);
      report.pulledCounts.ouvriers = normalized.length;
    }
  }

  // 4. Tâches
  if (isAllowed('taches')) {
    const res = await fetchAllFromSupabase(client, 'taches', { companyId });
    if (res.error) {
      report.errors.push({ table: 'taches', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      const normalized = res.data.map((r) => normalizeRemoteRowForLocal('taches', r));
      reconcileTachesFromRemote(companyId, normalized);
      report.pulledCounts.taches = normalized.length;
    }
  }

  // 5. Pointages
  if (isAllowed('pointages')) {
    const res = await fetchAllFromSupabase(client, 'pointages', { companyId });
    if (res.error) {
      report.errors.push({ table: 'pointages', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      reconcilePointagesFromRemote(companyId, res.data);
      report.pulledCounts.pointages = res.data.length;
    }
  }

  // 6. Affectations
  if (isAllowed('affectations')) {
    const res = await fetchAllFromSupabase(client, 'affectations', { companyId });
    if (res.error) {
      report.errors.push({ table: 'affectations', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      reconcileAffectationsFromRemote(companyId, res.data);
      report.pulledCounts.affectations = res.data.length;
    }
  }

  // 7. Tâche Serres
  if (isAllowed('tache_serres')) {
    const res = await fetchAllFromSupabase(client, 'tache_serres', { companyId });
    if (res.error) {
      report.errors.push({ table: 'tache_serres', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      const grouped = groupRemoteTacheSerreRows(companyId, res.data);
      reconcileTacheSerresFromRemote(companyId, grouped);
      report.pulledCounts.tache_serres = grouped.length;
    }
  }

  // 8. Récolte Entries
  if (isAllowed('recolte_entries')) {
    const res = await fetchAllFromSupabase(client, 'recolte_entries', { companyId });
    if (res.error) {
      report.errors.push({ table: 'recolte_entries', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      reconcileRecoltesFromRemote(companyId, res.data);
      report.pulledCounts.recolte_entries = res.data.length;
    }
  }

  // 9. Heures supplémentaires & Tâches supplémentaires (direct Supabase fallback + merge)
  if (isAllowed('heures_supplementaires')) {
    const res = await fetchAllFromSupabase(client, 'heures_supplementaires', { companyId });
    if (res.error) {
      report.errors.push({ table: 'heures_supplementaires', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      mergeHeuresSupplementairesServerData(res.data);
      report.pulledCounts.heures_supplementaires = res.data.length;
    }
  }

  if (isAllowed('taches_supplementaires')) {
    const res = await fetchAllFromSupabase(client, 'taches_supplementaires', { companyId });
    if (res.error) {
      report.errors.push({ table: 'taches_supplementaires', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      mergeTachesSupplementairesServerData(res.data);
      report.pulledCounts.taches_supplementaires = res.data.length;
    }
  }

  // 10. Gazoil Config & Mouvements
  if (isAllowed('gazoil_config')) {
    const res = await fetchAllFromSupabase(client, 'gazoil_config', { companyId });
    if (res.error) {
      report.errors.push({ table: 'gazoil_config', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      reconcileGazoilConfigFromRemote(companyId, res.data[0]);
      report.pulledCounts.gazoil_config = res.data.length;
    }
  }

  if (isAllowed('gazoil_mouvements')) {
    const res = await fetchAllFromSupabase(client, 'gazoil_mouvements', { companyId });
    if (res.error) {
      report.errors.push({ table: 'gazoil_mouvements', error: res.error.message || String(res.error) });
    } else if (res.data && res.data.length > 0) {
      reconcileGazoilMouvementsFromRemote(companyId, res.data);
      report.pulledCounts.gazoil_mouvements = res.data.length;
    }
  }

  return report;
}
