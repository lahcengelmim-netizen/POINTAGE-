import { supabase } from './supabaseClient';
import {
  STORAGE_KEYS,
  getCurrentUser,
  reconcileSerresFromRemote,
  reconcileOuvriersFromRemote,
  reconcileTachesFromRemote,
  reconcilePointagesFromRemote,
  reconcileAffectationsFromRemote,
  reconcileTacheSerreConfigsFromRemote,
  reconcileGazoilFromRemote,
  setLastSyncAt,
} from './storage';

// Map local storage keys to Supabase table names
const TABLE_MAP: Record<string, string> = {
  [STORAGE_KEYS.OUVRIERS]: 'ouvriers',
  [STORAGE_KEYS.TACHES]: 'taches',
  [STORAGE_KEYS.DOMAINES]: 'domaines',
  [STORAGE_KEYS.POINTAGES]: 'pointages',
  [STORAGE_KEYS.AFFECTATIONS]: 'affectations',
  [STORAGE_KEYS.TACHE_SERRES]: 'tache_serre_configs',
  [STORAGE_KEYS.RECOLTE]: 'recolte_entries',
  [STORAGE_KEYS.SERRES]: 'serres',
  [STORAGE_KEYS.HEURES_SUPP]: 'heures_supplementaires',
  [STORAGE_KEYS.TACHES_SUPP]: 'taches_supplementaires',
  [STORAGE_KEYS.GAZOIL_MOUVEMENTS]: 'gazoil_mouvements',
  [STORAGE_KEYS.GAZOIL_CONFIG]: 'gazoil_configs',
};

function sanitizePayloadForSupabase(tableName: string, data: any): any {
  if (!data || typeof data !== 'object') return data;
  if (tableName === 'ouvriers') {
    const { createdAt, ...rest } = data;
    return {
      ...rest,
      created_at: rest.created_at || createdAt || new Date().toISOString(),
    };
  }
  if (tableName === 'taches') {
    const { createdAt, ...rest } = data;
    return {
      ...rest,
      actif: rest.actif !== false,
      ouvriers_autorises: rest.ouvriers_autorises || 'tous',
      created_at: rest.created_at || createdAt || new Date().toISOString(),
    };
  }
  if (tableName === 'affectations') {
    return {
      id: data.id,
      company_id: data.company_id,
      ouvrier_id: data.ouvrier_id,
      numero_ouvrier: data.numero_ouvrier,
      tache_id: data.tache_id,
      domaine_id: data.domaine_id || null,
      serre_id: data.serre_id ?? null,
      serre_nom: data.serre_nom ?? null,
      serres_ids: Array.isArray(data.serres_ids) ? data.serres_ids : undefined,
      serres_noms: Array.isArray(data.serres_noms) ? data.serres_noms : undefined,
      date: data.date,
      timestamp: data.timestamp || Date.now(),
    };
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

async function hasActiveWritableSession(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  const user = getCurrentUser();
  if (user?.role === 'lecteur') return false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    return Boolean(sessionData?.session?.access_token);
  } catch {
    return false;
  }
}

export async function pullTachesFromSupabase(companyId: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) return false;

    const { data, error } = await supabase
      .from('taches')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      reconcileTachesFromRemote(companyId, data);
      setLastSyncAt();
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Synchronisation lecture tâches différée:', err);
    return false;
  }
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
      setLastSyncAt();
    }
  } catch (err) {
    console.warn('Synchronisation lecture référentiels domaines/serres différée:', err);
  }
}

export async function pullAllCompanyDataFromSupabase(
  companyId: string,
  _date?: string
): Promise<{ success: boolean; fromCache: boolean }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, fromCache: true };
  }
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      return { success: false, fromCache: true };
    }

    const [
      domRes,
      serresRes,
      ouvRes,
      tachesRes,
      ptgRes,
      affRes,
      tsRes,
      gzCfgRes,
      gzMvtRes,
    ] = await Promise.all([
      supabase.from('domaines').select('id, nom, ordre').eq('company_id', companyId).order('ordre', { ascending: true }),
      supabase.from('serres').select('*').eq('company_id', companyId).order('ordre', { ascending: true }),
      supabase.from('ouvriers').select('*').eq('company_id', companyId).order('numero', { ascending: true }),
      supabase.from('taches').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
      supabase.from('pointages').select('*').eq('company_id', companyId),
      supabase.from('affectations').select('*').eq('company_id', companyId),
      supabase.from('tache_serre_configs').select('*').eq('company_id', companyId),
      supabase.from('gazoil_configs').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('gazoil_mouvements').select('*').eq('company_id', companyId).order('timestamp', { ascending: false }),
    ]);

    const remoteDomaines = !domRes.error && Array.isArray(domRes.data) ? domRes.data : undefined;
    const remoteSerres = !serresRes.error && Array.isArray(serresRes.data) ? serresRes.data : [];
    if (remoteSerres.length > 0 || (remoteDomaines && remoteDomaines.length > 0)) {
      reconcileSerresFromRemote(remoteSerres as any, remoteDomaines as any);
    }

    if (!ouvRes.error && Array.isArray(ouvRes.data)) {
      reconcileOuvriersFromRemote(companyId, ouvRes.data);
    }
    if (!tachesRes.error && Array.isArray(tachesRes.data)) {
      reconcileTachesFromRemote(companyId, tachesRes.data);
    }
    if (!ptgRes.error && Array.isArray(ptgRes.data)) {
      reconcilePointagesFromRemote(companyId, ptgRes.data);
    }
    if (!affRes.error && Array.isArray(affRes.data)) {
      reconcileAffectationsFromRemote(companyId, affRes.data);
    }
    if (!tsRes.error && Array.isArray(tsRes.data)) {
      reconcileTacheSerreConfigsFromRemote(companyId, tsRes.data);
    }
    if (!gzCfgRes.error || !gzMvtRes.error) {
      reconcileGazoilFromRemote(
        companyId,
        !gzCfgRes.error ? gzCfgRes.data : null,
        !gzMvtRes.error && Array.isArray(gzMvtRes.data) ? gzMvtRes.data : []
      );
    }

    setLastSyncAt();
    return { success: true, fromCache: false };
  } catch (err) {
    console.warn('Pull global Supabase différé:', err);
    return { success: false, fromCache: true };
  }
}

async function processSyncQueueKey(storageKey: string): Promise<void> {
  if (!(await hasActiveWritableSession())) return;

  const queueRaw = localStorage.getItem(storageKey);
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
    } catch (error: any) {
      // Si RLS refuse définitivement (ex: lecteur 42501), ne pas boucler indéfiniment
      if (error?.code === '42501') {
        console.error(`Accès refusé RLS sur ${tableName}:`, error.message);
        continue;
      }
      console.warn(`Sync différée pour ${tableName}:`, error);
      remaining.push(item);
    }
  }

  localStorage.setItem(storageKey, JSON.stringify(remaining));
  if (remaining.length < queue.length) {
    setLastSyncAt();
  }
}

export async function syncPointageQueueToSupabase() {
  await processSyncQueueKey(STORAGE_KEYS.POINTAGE_SYNC_QUEUE);
}

export async function syncQueueToSupabase() {
  await processSyncQueueKey(STORAGE_KEYS.POINTAGE_SYNC_QUEUE);
  await processSyncQueueKey(STORAGE_KEYS.SYNC_QUEUE);
}

export function subscribeCompanyRealtime(
  companyId: string,
  onRemoteChange: (table: string) => void
): () => void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl || !companyId) {
    return () => {};
  }

  const tables = [
    'ouvriers',
    'taches',
    'serres',
    'domaines',
    'pointages',
    'affectations',
    'tache_serre_configs',
    'recolte_entries',
    'gazoil_mouvements',
    'gazoil_configs',
    'heures_supplementaires',
    'taches_supplementaires',
  ];

  const channel = supabase.channel(`lahcen_company_${companyId}_${Date.now()}`);

  tables.forEach((table) => {
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `company_id=eq.${companyId}`,
      },
      () => {
        onRemoteChange(table);
      }
    );
  });

  channel.subscribe();

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

export function subscribeContractuelsRealtime(
  companyId: string,
  onRemoteChange: (table: string) => void
): () => void {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl || !companyId) {
    return () => {};
  }

  const tables = [
    'contractuels_ouvriers',
    'contractuels_contrats',
    'contractuels_pointages',
    'contractuels_activites',
    'contractuels_validation_logs',
    'taches',
  ];

  const channel = supabase.channel(`lahcen_contractuels_${companyId}_${Date.now()}`);

  tables.forEach((table) => {
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: `company_id=eq.${companyId}`,
      },
      () => {
        onRemoteChange(table);
      }
    );
  });

  channel.subscribe();

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}
