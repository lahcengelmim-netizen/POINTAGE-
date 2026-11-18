/**
 * Service API client pour le module HEURES SUPPLÉMENTAIRES
 * - Communication avec PostgreSQL / Supabase backend (/api/heures-supplementaires)
 * - Supporte le rôle Caporal et Admin
 * - File locale hors ligne dédiée (OUTBOX_KEYS.SUPPLEMENTAIRES) avec reprise automatique
 * - Synchronisation et fusion ID par ID sans perte
 */

import { supabase } from './supabaseClient';
import { HeureSupplementaire } from '../types';
import * as storage from './storage';
import {
  OUTBOX_KEYS,
  enqueueOutboxOp,
  getOutboxOps,
  dequeueOutboxOpsById,
  markOutboxOpsFailed,
} from './syncOutbox';

function isOfflineOrTransientStatus(status?: number): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (status === undefined || status === 0) return true;
  return status >= 500 || status === 408 || status === 429;
}

async function getAuthHeaders(overrides?: { accessToken?: string; companyId?: string }): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const companyId =
      overrides?.companyId || storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
    if (companyId) {
      headers['x-company-id'] = companyId;
    }
    if (overrides?.accessToken) {
      headers['Authorization'] = `Bearer ${overrides.accessToken}`;
      return headers;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
      return headers;
    }
  } catch {
    // ignore
  }

  if (!import.meta.env.VITE_SUPABASE_URL) {
    const user = storage.getCurrentUser();
    if (user?.role === 'lecteur') {
      headers['Authorization'] = 'Bearer dev_lecteur_token';
    } else if (user?.role === 'caporal_contractuelles' || user?.module_attribue === 'contractuelles') {
      headers['Authorization'] = 'Bearer dev_caporal_contractuel_token';
    } else if (user?.role === 'caporal') {
      headers['Authorization'] = 'Bearer dev_caporal_token';
    } else {
      headers['Authorization'] = 'Bearer dev_admin_token';
    }
  }

  return headers;
}

// 1. Récupération et synchronisation des heures supplémentaires
export async function syncAndFetchHeuresSupplementairesServer(
  filters?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    ouvrierId?: string;
    domaineId?: string;
    serreId?: string;
  },
  options?: { accessToken?: string; companyId?: string; baseUrl?: string; ignoreNavigatorOnline?: boolean }
): Promise<{ success: boolean; supplementaires: HeureSupplementaire[]; error?: string }> {
  try {
    if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, supplementaires: [], error: 'Hors connexion' };
    }
    const headers = await getAuthHeaders(options);
    const params = new URLSearchParams();
    if (filters?.date) params.set('date', filters.date);
    if (filters?.startDate && filters?.endDate) {
      params.set('startDate', filters.startDate);
      params.set('endDate', filters.endDate);
    }
    if (filters?.ouvrierId) params.set('ouvrierId', filters.ouvrierId);
    if (filters?.domaineId && filters.domaineId !== 'ALL') params.set('domaineId', filters.domaineId);
    if (filters?.serreId && filters.serreId !== 'ALL') params.set('serreId', filters.serreId);

    const prefix = options?.baseUrl || '';
    const res = await fetch(`${prefix}/api/heures-supplementaires?${params.toString()}`, { headers });
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
      unite: h.mode_calcul === 'quart_heure' ? 'quart' : 'heure',
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

// 2. Création d'une heure supplémentaire (avec mise en file hors ligne si réseau/serveur indisponible)
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
}): Promise<{ success: boolean; item?: HeureSupplementaire; error?: string; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch('/api/heures-supplementaires', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    lastStatus = res.status;

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
    if (isOfflineOrTransientStatus(lastStatus)) {
      const now = new Date();
      const localId = `hsup_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const duree = Number(data.duree_heures ?? data.heures ?? data.quantite ?? 0);
      const localItem: HeureSupplementaire = {
        id: localId,
        company_id: companyId,
        ouvrier_id: data.ouvrier_id,
        numero_ouvrier: data.numero_ouvrier,
        date: data.date,
        tache_id: data.tache_id || null,
        nom_tache: data.nom_tache || null,
        heure_debut: data.heure_debut || null,
        heure_fin: data.heure_fin || null,
        duree_heures: duree,
        heures: duree,
        quantite: duree,
        type: 'heures',
        unite: data.mode_calcul === 'quart_heure' ? 'quart' : 'heure',
        mode_calcul: data.mode_calcul || 'heure',
        tarif_unitaire: data.tarif_unitaire ?? null,
        nb_unites: data.nb_unites ?? null,
        remuneration: data.remuneration ?? null,
        montant_total: data.montant_total ?? data.remuneration ?? null,
        domaine_id: data.domaine_id || null,
        serre_id: data.serre_id || null,
        observation: data.observation || null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        timestamp: now.getTime(),
      };
      enqueueOutboxOp(OUTBOX_KEYS.SUPPLEMENTAIRES, {
        table: 'heures_supplementaires',
        entityId: localId,
        action: 'upsert',
        data: { ...localItem, ...data, id: localId, company_id: companyId },
        companyId,
      });
      storage.mergeHeuresSupplementairesServerData([localItem]);
      return { success: true, item: localItem, offlineQueued: true };
    }
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
): Promise<{ success: boolean; item?: HeureSupplementaire; error?: string; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/heures-supplementaires/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });
    lastStatus = res.status;

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
    if (isOfflineOrTransientStatus(lastStatus)) {
      const existing = storage.getAllHeuresSupplementaires(companyId).find((h) => h.id === id);
      if (existing) {
        const now = new Date();
        const updated: HeureSupplementaire = {
          ...existing,
          ...data,
          updated_at: now.toISOString(),
          timestamp: now.getTime(),
        };
        enqueueOutboxOp(OUTBOX_KEYS.SUPPLEMENTAIRES, {
          table: 'heures_supplementaires',
          entityId: id,
          action: 'upsert',
          data: updated,
          companyId,
        });
        storage.mergeHeuresSupplementairesServerData([updated]);
        return { success: true, item: updated, offlineQueued: true };
      }
    }
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

// 4. Suppression d'une heure supplémentaire
export async function deleteHeureSupplementaireServer(
  id: string
): Promise<{ success: boolean; error?: string; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/heures-supplementaires/${id}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la suppression de l\'heure supplémentaire.',
      };
    }

    storage.deleteHeureSupplementaire(id, { skipQueue: true });
    return { success: true };
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      storage.deleteHeureSupplementaire(id);
      return { success: true, offlineQueued: true };
    }
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function flushHeuresSupplementairesQueue(options?: {
  accessToken?: string;
  companyId?: string;
  baseUrl?: string;
  ignoreNavigatorOnline?: boolean;
}): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const summary = { syncedCount: 0, failedCount: 0, errors: [] as string[] };
  if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return summary;
  }

  const targetCompany = options?.companyId || storage.getActiveCompanyId();
  const ops = getOutboxOps(OUTBOX_KEYS.SUPPLEMENTAIRES).filter(
    (op) =>
      op.table === 'heures_supplementaires' &&
      (!op.companyId || !targetCompany || op.companyId === targetCompany)
  );
  if (ops.length === 0) return summary;

  const prefix = options?.baseUrl || '';
  const confirmedIds: string[] = [];

  for (const op of ops) {
    try {
      const headers = await getAuthHeaders({
        accessToken: options?.accessToken,
        companyId: op.companyId || targetCompany,
      });

      if (op.action === 'delete') {
        const res = await fetch(`${prefix}/api/heures-supplementaires/${encodeURIComponent(op.entityId)}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok && res.status !== 404) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        confirmedIds.push(op.opId);
        summary.syncedCount += 1;
      } else {
        const isOfflineCreate = op.entityId.startsWith('hsup_off_');
        const url = isOfflineCreate
          ? `${prefix}/api/heures-supplementaires`
          : `${prefix}/api/heures-supplementaires/${encodeURIComponent(op.entityId)}`;
        const method = isOfflineCreate ? 'POST' : 'PUT';
        const res = await fetch(url, {
          method,
          headers,
          body: JSON.stringify(op.data),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        if (data?.item) {
          if (isOfflineCreate && data.item.id !== op.entityId) {
            storage.deleteHeureSupplementaire(op.entityId, { skipQueue: true });
          }
          storage.mergeHeuresSupplementairesServerData([data.item]);
        }
        confirmedIds.push(op.opId);
        summary.syncedCount += 1;
      }
    } catch (err: any) {
      const msg = err?.message || 'Erreur synchronisation heures supplémentaires';
      summary.failedCount += 1;
      summary.errors.push(msg);
      markOutboxOpsFailed(OUTBOX_KEYS.SUPPLEMENTAIRES, [op.opId], msg);
    }
  }

  if (confirmedIds.length > 0) {
    dequeueOutboxOpsById(OUTBOX_KEYS.SUPPLEMENTAIRES, confirmedIds);
  }
  return summary;
}
