/**
 * Service API client pour le module HEURES SUPPLÉMENTAIRES
 * - Communication avec PostgreSQL / Supabase backend (/api/heures-supplementaires)
 * - Supporte le rôle Caporal et Admin
 * - Calcul automatique des durées (heure_debut -> heure_fin)
 * - Synchronisation et fusion ID par ID sans suppression
 */

import { supabase } from './supabaseClient';
import { HeureSupplementaire } from '../types';
import * as storage from './storage';

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Aucune session active : le serveur rejettera avec HTTP 401
  }

  return headers;
}

// 1. Récupération et synchronisation des heures supplémentaires
export async function syncAndFetchHeuresSupplementairesServer(filters?: {
  date?: string;
  startDate?: string;
  endDate?: string;
  ouvrierId?: string;
  domaineId?: string;
  serreId?: string;
}): Promise<{ success: boolean; supplementaires: HeureSupplementaire[]; error?: string }> {
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

    const res = await fetch(`/api/heures-supplementaires?${params.toString()}`, { headers });
    const data = await res.json();

    if (!res.ok || !data.success) {
      return {
        success: false,
        supplementaires: [],
        error: data.error || 'Impossible de lire les heures supplémentaires.',
      };
    }

    const serverList: HeureSupplementaire[] = (data.heures_supplementaires || []).map((h: any) => ({
      ...h,
      type: 'heures',
      quantite: h.duree_heures || h.heures,
      heures: h.duree_heures || h.heures,
      unite: 'heure',
    }));

    if (serverList.length > 0) {
      storage.mergeHeuresSupplementairesServerData(serverList);
    }

    return { success: true, supplementaires: serverList };
  } catch (err: any) {
    return {
      success: false,
      supplementaires: [],
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

// 2. Création d'une heure supplémentaire
export async function createHeureSupplementaireServer(data: {
  ouvrier_id: string;
  numero_ouvrier: number;
  date: string;
  heure_debut?: string | null;
  heure_fin?: string | null;
  duree_heures?: number | null;
  heures?: number | null;
  tache_id?: string | null;
  nom_tache?: string | null;
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
  type?: any;
  quantite?: number | null;
  unite?: string;
  mode_calcul?: 'heure' | 'quart_heure';
  tarif_unitaire?: number | null;
  nb_unites?: number | null;
  remuneration?: number | null;
  montant_total?: number | null;
}): Promise<{ success: boolean; item?: HeureSupplementaire; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/heures-supplementaires', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de l\'enregistrement de l\'heure supplémentaire.',
      };
    }

    const formattedItem: HeureSupplementaire = {
      ...result.item,
      type: 'heures',
      quantite: result.item.duree_heures || result.item.heures,
      heures: result.item.duree_heures || result.item.heures,
      unite: result.item.mode_calcul === 'quart_heure' ? 'quart' : 'heure',
    };

    storage.mergeHeuresSupplementairesServerData([formattedItem]);
    return { success: true, item: formattedItem };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

// 3. Modification d'une heure supplémentaire
export async function updateHeureSupplementaireServer(
  id: string,
  data: {
    date?: string;
    heure_debut?: string | null;
    heure_fin?: string | null;
    duree_heures?: number | null;
    heures?: number | null;
    tache_id?: string | null;
    nom_tache?: string | null;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
    type?: any;
    quantite?: number | null;
    unite?: string;
    mode_calcul?: 'heure' | 'quart_heure';
    tarif_unitaire?: number | null;
    nb_unites?: number | null;
    remuneration?: number | null;
    montant_total?: number | null;
  }
): Promise<{ success: boolean; item?: HeureSupplementaire; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/heures-supplementaires/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la modification de l\'heure supplémentaire.',
      };
    }

    const formattedItem: HeureSupplementaire = {
      ...result.item,
      type: 'heures',
      quantite: result.item.duree_heures || result.item.heures,
      heures: result.item.duree_heures || result.item.heures,
      unite: result.item.mode_calcul === 'quart_heure' ? 'quart' : 'heure',
    };

    storage.mergeHeuresSupplementairesServerData([formattedItem]);
    return { success: true, item: formattedItem };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

// 4. Suppression d'une heure supplémentaire
export async function deleteHeureSupplementaireServer(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/heures-supplementaires/${id}`, {
      method: 'DELETE',
      headers,
    });

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la suppression de l\'heure supplémentaire.',
      };
    }

    storage.deleteHeureSupplementaire(id);
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}
