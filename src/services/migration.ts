import { supabase } from './supabaseClient';
import { STORAGE_KEYS } from './storage';

export async function runDataMigration(): Promise<{ success: boolean; message: string }> {
  try {
    // Check if migration already ran
    const migrationFlag = localStorage.getItem('agripointage_migration_done');
    if (migrationFlag) {
      return { success: true, message: 'La migration a déjà été effectuée.' };
    }

    const tablesToMigrate = [
      { key: STORAGE_KEYS.COMPANIES, table: 'companies' },
      { key: STORAGE_KEYS.OUVRIERS, table: 'ouvriers' },
      { key: STORAGE_KEYS.TACHES, table: 'taches' },
      { key: STORAGE_KEYS.POINTAGES, table: 'pointages' },
      { key: STORAGE_KEYS.AFFECTATIONS, table: 'affectations' },
      { key: STORAGE_KEYS.SERRES, table: 'serres' },
      { key: STORAGE_KEYS.HEURES_SUPP, table: 'heures_supplementaires' },
      { key: STORAGE_KEYS.GAZOIL_MOUVEMENTS, table: 'gazoil_mouvements' },
    ];

    for (const item of tablesToMigrate) {
      const raw = localStorage.getItem(item.key);
      if (!raw) continue;

      const data = JSON.parse(raw);
      if (!Array.isArray(data)) continue;

      console.log(`Migrating ${data.length} items to ${item.table}...`);
      
      // Batch size for Supabase upsert (e.g., 500 records per batch)
      const batchSize = 500;
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const { error } = await supabase.from(item.table).upsert(batch, { onConflict: 'id' });
        if (error) {
          console.error(`Error migrating batch to ${item.table}:`, error);
          throw error;
        }
      }
    }

    localStorage.setItem('agripointage_migration_done', 'true');
    return { success: true, message: 'Migration réussie !' };
  } catch (error) {
    console.error('Migration failed:', error);
    return { success: false, message: `Erreur de migration: ${error instanceof Error ? error.message : 'Inconnue'}` };
  }
}
