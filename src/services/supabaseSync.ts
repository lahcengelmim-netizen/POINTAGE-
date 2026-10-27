import { supabase } from './supabaseClient';
import { STORAGE_KEYS } from './storage';

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

export async function syncQueueToSupabase() {
  const queueRaw = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
  if (!queueRaw) return;

  const queue: any[] = JSON.parse(queueRaw);
  if (queue.length === 0) return;

  const successfulSyncs: any[] = [];

  for (const item of queue) {
    const tableName = TABLE_MAP[item.table] || item.table;
    try {
      const { error } = await supabase
        .from(tableName)
        .upsert(item.data, { onConflict: 'id' });

      if (error) throw error;
      successfulSyncs.push(item);
    } catch (error) {
      console.error(`Failed to sync item to ${tableName}:`, item, error);
      // Keep it in the queue for retry
    }
  }

  // Remove successful syncs from queue
  const remainingQueue = queue.filter(item => !successfulSyncs.includes(item));
  localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(remainingQueue));
}
