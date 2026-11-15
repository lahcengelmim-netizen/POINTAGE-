import { supabase } from './supabaseClient';
import { STORAGE_KEYS, reconcileSerresFromRemote } from './storage';

// Map local storage keys to Supabase table names
const TABLE_MAP: Record<string, string> = {
  [STORAGE_KEYS.OUVRIERS]: 'ouvriers',
  [STORAGE_KEYS.TACHES]: 'taches',
  [STORAGE_KEYS.POINTAGES]: 'pointages',
  [STORAGE_KEYS.AFFECTATIONS]: 'affectations',
  [STORAGE_KEYS.RECOLTE]: 'recolte_entries',
  [STORAGE_KEYS.SERRES]: 'serres',
  [STORAGE_KEYS.HEURES_SUPP]: 'heures_supplementaires',
  [STORAGE_KEYS.GAZOIL_MOUVEMENTS]: 'gazoil_mouvements',
};

function sanitizePayloadForSupabase(tableName: string, data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (tableName === 'affectations') {
    const { serres_ids: _ids, serres_noms: _noms, ...dbRow } = data;
    return dbRow;
  }
  return data;
}

function isBlockedSerre23Payload(tableName: string, data: any): boolean {
  if (tableName !== 'serres' || !data) return false;
  return (
    data.id === 'serre_23' &&
    (!data.domaine_id || data.domaine_id === 'dom_d3' || String(data.code || '').toUpperCase() === 'S23')
  );
}

export async function pullReferentielsSerresFromSupabase(companyId: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return;

    const [domRes, serresRes] = await Promise.all([
      supabase
        .from('domaines')
        .select('id, nom, ordre')
        .eq('company_id', companyId)
        .order('ordre', { ascending: true }),
      supabase
        .from('serres')
        .select('*')
        .eq('company_id', companyId)
        .order('ordre', { ascending: true }),
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

export async function syncPointageQueueToSupabase() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const queueRaw = localStorage.getItem(STORAGE_KEYS.POINTAGE_SYNC_QUEUE);
  if (!queueRaw) return;

  let queue: any[] = [];
  try {
    queue = JSON.parse(queueRaw);
  } catch {
    return;
  }
  if (!Array.isArray(queue) || queue.length === 0) return;

  const remaining: any[] = [];

  for (const item of queue) {
    if (!item || !item.table) continue;
    const tableName = TABLE_MAP[item.table] || item.table;
    if (isBlockedSerre23Payload(tableName, item.data)) continue;
    try {
      if (item.action === 'delete' && item.data?.id) {
        const { error } = await supabase.from(tableName).delete().eq('id', item.data.id);
        if (error) throw error;
      } else if (item.data) {
        const payload = sanitizePayloadForSupabase(tableName, item.data);
        const { error } = await supabase
          .from(tableName)
          .upsert(payload, { onConflict: 'id' });
        if (error) throw error;
      }
    } catch (error) {
      console.warn(`Sync différée pour ${tableName}:`, error);
      remaining.push(item);
    }
  }

  localStorage.setItem(STORAGE_KEYS.POINTAGE_SYNC_QUEUE, JSON.stringify(remaining));
}

export async function syncQueueToSupabase() {
  await syncPointageQueueToSupabase();

  const queueRaw = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
  if (!queueRaw) return;

  const queue: any[] = JSON.parse(queueRaw);
  if (queue.length === 0) return;

  const successfulSyncs: any[] = [];

  for (const item of queue) {
    if (!item || !item.table) continue; // Ignorer les entrées Recolte gérées par syncRecolteWithServer
    const tableName = TABLE_MAP[item.table] || item.table;
    if (isBlockedSerre23Payload(tableName, item.data)) {
      successfulSyncs.push(item);
      continue;
    }
    try {
      const payload = sanitizePayloadForSupabase(tableName, item.data);
      const { error } = await supabase
        .from(tableName)
        .upsert(payload, { onConflict: 'id' });

      if (error) throw error;
      successfulSyncs.push(item);
    } catch (error) {
      console.error(`Failed to sync item to ${tableName}:`, item, error);
    }
  }

  if (successfulSyncs.length > 0) {
    const remainingQueue = queue.filter(item => !successfulSyncs.includes(item));
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(remainingQueue));
  }
}
