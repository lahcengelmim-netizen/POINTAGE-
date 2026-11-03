/**
 * Service API client pour le module TÂCHES SUPPLÉMENTAIRES
 * - Communication avec PostgreSQL / Supabase backend (/api/taches-supplementaires)
 * - Gestion du rôle Caporal et Admin
 * - Synchronisation et fusion ID par ID sans suppression
 */

import { supabase } from './supabaseClient';
import { TacheSupplementaire } from '../types';
import * as storage from './storage';

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
      return headers;
    }
  } catch {
    // fallback
  }

  // Token dev fallback
  headers['Authorization'] = 'Bearer dev_caporal_token';
  return headers;
}

export async function fetchTachesSupplementairesServer(filters?: {
  date?: string;
  startDate?: string;
  endDate?: string;
  ouvrierId?: string;
  domaineId?: string;
  serreId?: string;
  tacheId?: string;
}): Promise<{ success: boolean; taches_supplementaires: TacheSupplementaire[]; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filters?.date) params.set('date', filters.date);
    if (filters?.startDate && filters?.endDate) {
      params.set('startDate', filters.startDate);
      params.set('endDate', filters.endDate);
    }
    if (filters?.ouvrierId) params.set('ouvrierId', filters.ouvrierId);
    if (filters?.domaineId && filters.domaineId !== 'ALL') params.set('domaineId', filters.domaineId);
    if (filters?.serreId && filters.serreId !== 'ALL') params.set('serreId', filters.serreId);
    if (filters?.tacheId) params.set('tacheId', filters.tacheId);

    const res = await fetch(`/api/taches-supplementaires?${params.toString()}`, { headers });
    const data = await res.json();

    if (!res.ok || !data.success) {
      return {
        success: false,
        taches_supplementaires: [],
        error: data.error || 'Impossible de lire les tâches supplémentaires.',
      };
    }

    const serverList: TacheSupplementaire[] = data.taches_supplementaires || [];
    if (serverList.length > 0) {
      storage.mergeTachesSupplementairesServerData(serverList);
    }

    return { success: true, taches_supplementaires: serverList };
  } catch (err: any) {
    return {
      success: false,
      taches_supplementaires: [],
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function createTachesSupplementairesServer(data: {
  ouvriers?: Array<{ id: string; numero: number }>;
  ouvrier_id?: string;
  numero_ouvrier?: number;
  date: string;
  tache_id?: string | null;
  nom_tache: string;
  description?: string | null;
  quantite: number;
  unite: string;
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
}): Promise<{ success: boolean; items?: TacheSupplementaire[]; error?: string; count?: number }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/taches-supplementaires', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de l\'enregistrement de la tâche supplémentaire.',
      };
    }

    if (result.items && Array.isArray(result.items)) {
      storage.mergeTachesSupplementairesServerData(result.items);
    }

    return { success: true, items: result.items, count: result.count };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function updateTacheSupplementaireServer(
  id: string,
  data: {
    date?: string;
    quantite?: number;
    unite?: string;
    nom_tache?: string;
    description?: string | null;
    tache_id?: string | null;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
  }
): Promise<{ success: boolean; item?: TacheSupplementaire; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/taches-supplementaires/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la modification de la tâche.',
      };
    }

    if (result.item) {
      storage.mergeTachesSupplementairesServerData([result.item]);
    }

    return { success: true, item: result.item };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function deleteTacheSupplementaireServer(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/taches-supplementaires/${id}`, {
      method: 'DELETE',
      headers,
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la suppression de la tâche.',
      };
    }

    storage.deleteTacheSupplementaire(id);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}
