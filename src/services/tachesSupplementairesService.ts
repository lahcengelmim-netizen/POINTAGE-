/**
 * Service API client pour le module TÂCHES SUPPLÉMENTAIRES
 * - Communication avec PostgreSQL / Supabase backend (/api/taches-supplementaires)
 * - Gestion du rôle Caporal et Admin
 * - File locale hors ligne dédiée (OUTBOX_KEYS.SUPPLEMENTAIRES) avec reprise automatique
 */

import { supabase } from './supabaseClient';
import { TacheSupplementaire } from '../types';
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

export async function fetchTachesSupplementairesServer(
  filters?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    ouvrierId?: string;
    domaineId?: string;
    serreId?: string;
    tacheId?: string;
  },
  options?: { accessToken?: string; companyId?: string; baseUrl?: string; ignoreNavigatorOnline?: boolean }
): Promise<{ success: boolean; taches_supplementaires: TacheSupplementaire[]; error?: string }> {
  try {
    if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { success: false, taches_supplementaires: [], error: 'Hors connexion' };
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
    if (filters?.tacheId) params.set('tacheId', filters.tacheId);

    const prefix = options?.baseUrl || '';
    const res = await fetch(`${prefix}/api/taches-supplementaires?${params.toString()}`, { headers });
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
  ouvriers?: Array<{ id: string; numero: number; quantite?: number }>;
  ouvrier_id?: string;
  numero_ouvrier?: number;
  date: string;
  tache_id?: string | null;
  nom_tache: string;
  description?: string | null;
  quantite?: number;
  unite: string;
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
  idempotencyKey?: string;
}): Promise<{ success: boolean; items?: TacheSupplementaire[]; error?: string; count?: number; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch('/api/taches-supplementaires', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });
    lastStatus = res.status;

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
    if (isOfflineOrTransientStatus(lastStatus)) {
      const now = new Date();
      const targetWorkers =
        Array.isArray(data.ouvriers) && data.ouvriers.length > 0
          ? data.ouvriers
          : data.ouvrier_id
            ? [{ id: data.ouvrier_id, numero: data.numero_ouvrier || 0, quantite: data.quantite }]
            : [];

      const createdOffline: TacheSupplementaire[] = targetWorkers.map((w, idx) => {
        const localId = `tsup_off_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        return {
          id: localId,
          company_id: companyId,
          ouvrier_id: w.id,
          numero_ouvrier: w.numero,
          date: data.date,
          tache_id: data.tache_id || null,
          nom_tache: data.nom_tache,
          description: data.description || null,
          quantite: Number(w.quantite ?? data.quantite ?? 0),
          unite: data.unite,
          domaine_id: data.domaine_id || null,
          serre_id: data.serre_id || null,
          observation: data.observation || null,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          timestamp: now.getTime(),
        };
      });

      if (createdOffline.length > 0) {
        storage.mergeTachesSupplementairesServerData(createdOffline);
        const opEntityId = createdOffline[0].id;
        enqueueOutboxOp(OUTBOX_KEYS.SUPPLEMENTAIRES, {
          table: 'taches_supplementaires',
          entityId: opEntityId,
          action: 'upsert',
          data: {
            ...data,
            offlineLocalIds: createdOffline.map((i) => i.id),
            idempotencyKey: data.idempotencyKey || `tsup_idem_${opEntityId}`,
          },
          companyId,
        });
        return { success: true, items: createdOffline, count: createdOffline.length, offlineQueued: true };
      }
    }
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
): Promise<{ success: boolean; item?: TacheSupplementaire; error?: string; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/taches-supplementaires/${id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(data),
    });
    lastStatus = res.status;

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
    if (isOfflineOrTransientStatus(lastStatus)) {
      const existing = storage.getAllTachesSupplementaires(companyId).find((t) => t.id === id);
      if (existing) {
        const now = new Date();
        const updated: TacheSupplementaire = {
          ...existing,
          ...data,
          updated_at: now.toISOString(),
          timestamp: now.getTime(),
        };
        enqueueOutboxOp(OUTBOX_KEYS.SUPPLEMENTAIRES, {
          table: 'taches_supplementaires',
          entityId: id,
          action: 'upsert',
          data: updated,
          companyId,
        });
        storage.mergeTachesSupplementairesServerData([updated]);
        return { success: true, item: updated, offlineQueued: true };
      }
    }
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function deleteTacheSupplementaireServer(
  id: string
): Promise<{ success: boolean; error?: string; offlineQueued?: boolean }> {
  const companyId = storage.getCurrentUser()?.company_id || storage.getActiveCompanyId();
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/taches-supplementaires/${id}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;

    const result = await res.json();
    if (!res.ok || !result.success) {
      return {
        success: false,
        error: result.error || 'Échec de la suppression de la tâche.',
      };
    }

    storage.deleteTacheSupplementaire(id, { skipQueue: true });
    return { success: true };
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      storage.deleteTacheSupplementaire(id);
      return { success: true, offlineQueued: true };
    }
    return {
      success: false,
      error: err.message || 'Erreur de connexion au serveur.',
    };
  }
}

export async function flushTachesSupplementairesQueue(options?: {
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
      op.table === 'taches_supplementaires' &&
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
        const res = await fetch(`${prefix}/api/taches-supplementaires/${encodeURIComponent(op.entityId)}`, {
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
        const isOfflineCreate = op.entityId.startsWith('tsup_off_') || Array.isArray(op.data?.offlineLocalIds);
        const url = isOfflineCreate
          ? `${prefix}/api/taches-supplementaires`
          : `${prefix}/api/taches-supplementaires/${encodeURIComponent(op.entityId)}`;
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
        const result = await res.json().catch(() => ({}));
        if (Array.isArray(op.data?.offlineLocalIds)) {
          op.data.offlineLocalIds.forEach((lid: string) =>
            storage.deleteTacheSupplementaire(lid, { skipQueue: true })
          );
        }
        if (Array.isArray(result?.items)) {
          storage.mergeTachesSupplementairesServerData(result.items);
        } else if (result?.item) {
          storage.mergeTachesSupplementairesServerData([result.item]);
        }
        confirmedIds.push(op.opId);
        summary.syncedCount += 1;
      }
    } catch (err: any) {
      const msg = err?.message || 'Erreur synchronisation tâches supplémentaires';
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
