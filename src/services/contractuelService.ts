/**
 * Service client pour le module indépendant CONTRACTUELLES (Lahcen Pointeur)
 * - Gestion des ouvriers contractuels et de leurs tarifs convenus
 * - Pointage journalier individuel avec sélection de tâches et serres
 * - Calculs automatiques des rémunérations (DH/jour, DH/tâche, DH/unité, DH/heure)
 * - Persistance Supabase PostgreSQL avec réplication locale et offline-sync
 * - Exportation Excel multi-feuilles professionnelle (5 feuilles SheetJS)
 */

import * as XLSX from 'xlsx';
import { supabase } from './supabaseClient';
import { getCurrentUser, getTaches } from './storage';
import {
  ContractuelContrat,
  ContractuelOuvrier,
  ContractuelPointage,
  ContractuelActivite,
  ContractuelFilter,
  ModeRemuneration,
  StatutValidationContractuel,
  Tache,
} from '../types';
import {
  buildContractuellesWorkbook,
  normalizeStatutValidation,
} from '../utils/contractuelWorkflow';
export { buildContractuellesWorkbook };

const STORAGE_KEYS_CONTRACTUELS = {
  CONTRATS: 'agripointage_contractuels_contrats_v1',
  OUVRIERS: 'agripointage_contractuels_ouvriers_v1',
  POINTAGES: 'agripointage_contractuels_pointages_v1',
  ACTIVITES: 'agripointage_contractuels_activites_v1',
  PENDING_POINTAGES: 'agripointage_contractuels_pending_sync_v1',
  LAST_SYNC_AT: 'agripointage_contractuels_last_sync_v1',
};

function isNetworkUnavailable(err?: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed') ||
    msg.includes('err_internet_disconnected')
  );
}

function readPendingPointagesQueue(): any[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.PENDING_POINTAGES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingPointagesQueue(queue: any[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.PENDING_POINTAGES, JSON.stringify(queue));
  } catch {
    // ignore
  }
}

function enqueuePendingPointage(payload: any): void {
  const queue = readPendingPointagesQueue();
  const keyOuv = payload.ouvrier_id;
  const keyDate = payload.date;
  const filtered = queue.filter((q) => !(q.ouvrier_id === keyOuv && q.date === keyDate));
  filtered.push({
    ...payload,
    queued_at: new Date().toISOString(),
    updated_at: payload.updated_at || new Date().toISOString(),
  });
  writePendingPointagesQueue(filtered);
}

export function getPendingContractuelPointagesCount(): number {
  return readPendingPointagesQueue().length;
}

export function getContractuelsLastSyncAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.LAST_SYNC_AT);
  } catch {
    return null;
  }
}

function markContractuelsSynced(): void {
  try {
    localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.LAST_SYNC_AT, new Date().toISOString());
  } catch {
    // ignore
  }
}

// Récupération des en-têtes d'autorisation avec Bearer Token (respect strict du rôle)
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
    // ignore
  }

  // Fallback dev local UNIQUEMENT quand Supabase n'est pas configuré
  if (!import.meta.env.VITE_SUPABASE_URL) {
    try {
      const user = getCurrentUser();
      if (user?.role === 'lecteur') {
        headers['Authorization'] = 'Bearer dev_lecteur_token';
        return headers;
      }
      if (user?.role === 'caporal_contractuelles' || user?.module_attribue === 'contractuelles') {
        headers['Authorization'] = 'Bearer dev_caporal_contractuel_token';
        return headers;
      }
      if (user?.role === 'caporal') {
        headers['Authorization'] = 'Bearer dev_caporal_token';
        return headers;
      }
    } catch {
      // ignore
    }
    headers['Authorization'] = 'Bearer dev_admin_token';
  }

  return headers;
}

// 0a. RÉCUPÉRATION DES TÂCHES RÉELLES DE L'APPLICATION (Supabase prioritaire, sans doublons)
export async function getContractuelTaches(
  companyId: string = 'cie_lahcen_pointeur'
): Promise<{ success: boolean; taches: Tache[]; fromCache?: boolean; error?: string }> {
  const localTaches = getTaches(companyId);
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/taches', { headers });
    const data = await res.json();
    if (res.ok && data.success && Array.isArray(data.taches)) {
      const map = new Map<string, Tache>();
      data.taches.forEach((t: Tache) => {
        if (t && t.id && !map.has(t.id)) {
          map.set(t.id, t);
        }
      });
      return { success: true, taches: Array.from(map.values()), fromCache: false };
    }
    if (res.status >= 400 && res.status < 500) {
      return { success: false, taches: [], error: data.error || 'Accès refusé aux tâches.' };
    }
    throw new Error(data.error || 'Erreur lors de la récupération des tâches.');
  } catch (err: any) {
    if (isNetworkUnavailable(err)) {
      return { success: true, taches: localTaches, fromCache: true };
    }
    return { success: false, taches: localTaches, fromCache: true, error: err?.message };
  }
}

// 0. CATALOGUE DES CONTRATS & TARIFS DE RÉFÉRENCE

export async function getContractuelContrats(filter?: {
  actif?: boolean;
  searchQuery?: string;
}): Promise<{ success: boolean; contrats: ContractuelContrat[]; fromCache?: boolean; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filter?.actif) params.set('actif', 'true');
    if (filter?.searchQuery) params.set('searchQuery', filter.searchQuery);

    const res = await fetch(`/api/contractuels/contrats?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.contrats)) {
      if (!filter?.searchQuery && !filter?.actif) {
        localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS, JSON.stringify(data.contrats));
      }
      return { success: true, contrats: data.contrats, fromCache: false };
    }

    if (res.status >= 400 && res.status < 500) {
      return { success: false, contrats: [], error: data.error || 'Accès refusé aux contrats.' };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des contrats.');
  } catch (err: any) {
    if (!isNetworkUnavailable(err)) {
      return { success: false, contrats: [], error: err.message || 'Erreur serveur contrats.' };
    }
    console.warn('Mode hors ligne - cache local getContractuelContrats:', err.message);
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
    let list: ContractuelContrat[] = raw ? JSON.parse(raw) : [];
    if (filter?.actif) list = list.filter((c) => c.actif);
    if (filter?.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      list = list.filter((c) => c.designation.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q));
    }
    return { success: true, contrats: list, fromCache: true };
  }
}

export async function saveContractuelContrat(
  contratData: Partial<ContractuelContrat>
): Promise<{ success: boolean; contrat?: ContractuelContrat; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const isEdit = Boolean(contratData.id);
    const url = isEdit
      ? `/api/contractuels/contrats/${encodeURIComponent(contratData.id!)}`
      : '/api/contractuels/contrats';

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify(contratData),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur enregistrement contrat.');
    }

    // Mise à jour cache local
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
    const list: ContractuelContrat[] = raw ? JSON.parse(raw) : [];
    const saved = data.contrat as ContractuelContrat;

    const idx = list.findIndex((c) => c.id === saved.id);
    if (idx >= 0) {
      list[idx] = saved;
    } else {
      list.unshift(saved);
    }
    localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS, JSON.stringify(list));

    return { success: true, contrat: saved };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function importContractuelContrats(
  contrats: Partial<ContractuelContrat>[],
  modeDedoublonnage: 'update' | 'skip' = 'update'
): Promise<{
  success: boolean;
  message?: string;
  importedCount?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  contrats?: ContractuelContrat[];
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/contrats/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ contrats, mode_dedoublonnage: modeDedoublonnage }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur importation des contrats.');
    }

    // Actualiser le cache local
    if (Array.isArray(data.contrats)) {
      const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
      const list: ContractuelContrat[] = raw ? JSON.parse(raw) : [];
      data.contrats.forEach((newC: ContractuelContrat) => {
        const idx = list.findIndex((c) => c.id === newC.id);
        if (idx >= 0) list[idx] = newC;
        else list.push(newC);
      });
      localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS, JSON.stringify(list));
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelContrat(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/contractuels/contrats/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression contrat.');
    }

    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
    if (raw) {
      const list: ContractuelContrat[] = JSON.parse(raw);
      localStorage.setItem(
        STORAGE_KEYS_CONTRACTUELS.CONTRATS,
        JSON.stringify(list.filter((c) => c.id !== id))
      );
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 1. OUVRIERS CONTRACTUELS

export async function getContractuelOuvriers(filter?: {
  actif?: boolean;
  domaineId?: string;
}): Promise<{ success: boolean; ouvriers: ContractuelOuvrier[]; fromCache?: boolean; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filter?.actif) params.set('actif', 'true');
    if (filter?.domaineId && filter.domaineId !== 'ALL') params.set('domaineId', filter.domaineId);

    const res = await fetch(`/api/contractuels/ouvriers?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.ouvriers)) {
      if (!filter?.actif && (!filter?.domaineId || filter.domaineId === 'ALL')) {
        localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, JSON.stringify(data.ouvriers));
      } else {
        // Fusionner dans le cache sans supprimer les autres domaines
        const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
        const existing: ContractuelOuvrier[] = raw ? JSON.parse(raw) : [];
        const map = new Map<string, ContractuelOuvrier>(existing.map((o) => [o.id, o]));
        data.ouvriers.forEach((o: ContractuelOuvrier) => map.set(o.id, o));
        localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, JSON.stringify(Array.from(map.values())));
      }
      markContractuelsSynced();
      return { success: true, ouvriers: data.ouvriers, fromCache: false };
    }

    if (res.status >= 400 && res.status < 500) {
      return { success: false, ouvriers: [], error: data.error || 'Accès refusé aux ouvriers contractuels.' };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des ouvriers contractuels.');
  } catch (err: any) {
    if (!isNetworkUnavailable(err)) {
      return { success: false, ouvriers: [], error: err.message || 'Erreur serveur ouvriers contractuels.' };
    }
    console.warn('Mode hors ligne - cache local getContractuelOuvriers:', err.message);
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    let list: ContractuelOuvrier[] = raw ? JSON.parse(raw) : [];
    if (filter?.actif) list = list.filter((o) => o.actif);
    if (filter?.domaineId && filter.domaineId !== 'ALL') list = list.filter((o) => o.domaine_id === filter.domaineId);
    return { success: true, ouvriers: list, fromCache: true };
  }
}

export async function saveContractuelOuvrier(
  ouvrierData: Partial<ContractuelOuvrier>
): Promise<{ success: boolean; ouvrier?: ContractuelOuvrier; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const isEdit = Boolean(ouvrierData.id);
    const url = isEdit
      ? `/api/contractuels/ouvriers/${encodeURIComponent(ouvrierData.id!)}`
      : '/api/contractuels/ouvriers';

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify(ouvrierData),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur enregistrement ouvrier contractuel.');
    }

    // Mise à jour cache local
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    let list: ContractuelOuvrier[] = raw ? JSON.parse(raw) : [];
    if (isEdit) {
      list = list.map((o) => (o.id === data.ouvrier.id ? data.ouvrier : o));
    } else {
      list.push(data.ouvrier);
    }
    localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, JSON.stringify(list));

    return { success: true, ouvrier: data.ouvrier };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelOuvrier(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/contractuels/ouvriers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression ouvrier contractuel.');
    }

    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    if (raw) {
      const list: ContractuelOuvrier[] = JSON.parse(raw);
      localStorage.setItem(
        STORAGE_KEYS_CONTRACTUELS.OUVRIERS,
        JSON.stringify(list.filter((o) => o.id !== id))
      );
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function importContractuelOuvriers(
  ouvriers: Array<{
    nom: string;
    prenom?: string;
    serre_nom?: string;
    prix_convenu: number;
    mode_remuneration?: ModeRemuneration;
    unite?: string;
    matricule?: string;
    domaine_id?: string;
  }>,
  modeDedoublonnage: 'update' | 'skip' = 'update'
): Promise<{
  success: boolean;
  message?: string;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  ouvriers?: ContractuelOuvrier[];
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/ouvriers/import', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ouvriers, mode_dedoublonnage: modeDedoublonnage }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur lors de l’importation des ouvriers contractuels.');
    }

    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    let list: ContractuelOuvrier[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(data.ouvriers)) {
      data.ouvriers.forEach((newO: ContractuelOuvrier) => {
        const idx = list.findIndex((o) => o.id === newO.id);
        if (idx >= 0) list[idx] = newO;
        else list.unshift(newO);
      });
      localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, JSON.stringify(list));
    }

    return {
      success: true,
      message: data.message,
      createdCount: data.createdCount,
      updatedCount: data.updatedCount,
      skippedCount: data.skippedCount,
      ouvriers: data.ouvriers,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 2. POINTAGES ET ACTIVITÉS JOURNALIÈRES

function reconcilePointagesCache(fetched: ContractuelPointage[], filter?: ContractuelFilter): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
    const existing: ContractuelPointage[] = raw ? JSON.parse(raw) : [];
    const fetchedIds = new Set(fetched.map((p) => p.id));

    // Retirer les anciennes copies de la même fenêtre filtrée pour refléter les suppressions distantes
    const keptOtherDates = existing.filter((p) => {
      if (fetchedIds.has(p.id)) return false;
      if (filter?.date && p.date !== filter.date) return true;
      if (filter?.startDate && filter?.endDate && (p.date < filter.startDate || p.date > filter.endDate)) return true;
      if (!filter?.date && !filter?.startDate && !filter?.domaine_id && !filter?.ouvrier_id && !filter?.statut_validation && !filter?.serre_id) {
        return false;
      }
      if (filter?.domaine_id && filter.domaine_id !== 'ALL' && p.domaine_id !== filter.domaine_id) return true;
      if (filter?.ouvrier_id && p.ouvrier_id !== filter.ouvrier_id) return true;
      return false;
    });

    const merged = [...keptOtherDates, ...fetched];
    localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(merged));
  } catch {
    // ignore
  }
}

export async function getContractuelPointages(filter?: ContractuelFilter): Promise<{
  success: boolean;
  pointages: ContractuelPointage[];
  activites?: ContractuelActivite[];
  fromCache?: boolean;
  pendingCount?: number;
  error?: string;
}> {
  const pendingQueue = readPendingPointagesQueue();
  try {
    const headers = await getAuthHeaders();
    const params = new URLSearchParams();
    if (filter?.date) params.set('date', filter.date);
    if (filter?.startDate) params.set('startDate', filter.startDate);
    if (filter?.endDate) params.set('endDate', filter.endDate);
    if (filter?.domaine_id && filter.domaine_id !== 'ALL') params.set('domaineId', filter.domaine_id);
    if (filter?.serre_id && filter.serre_id !== 'ALL') params.set('serreId', filter.serre_id);
    if (filter?.ouvrier_id) params.set('ouvrierId', filter.ouvrier_id);
    if (filter?.statut_validation && filter.statut_validation !== 'ALL') {
      params.set('statutValidation', filter.statut_validation);
    }

    const res = await fetch(`/api/contractuels/pointages?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.pointages)) {
      reconcilePointagesCache(data.pointages, filter);
      markContractuelsSynced();
      return {
        success: true,
        pointages: data.pointages,
        activites: data.activites || [],
        fromCache: false,
        pendingCount: pendingQueue.length,
      };
    }

    if (res.status >= 400 && res.status < 500) {
      return {
        success: false,
        pointages: [],
        error: data.error || 'Accès refusé aux pointages contractuels.',
      };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des pointages contractuels.');
  } catch (err: any) {
    if (!isNetworkUnavailable(err)) {
      return {
        success: false,
        pointages: [],
        error: err.message || 'Erreur serveur lors de la lecture des pointages contractuels.',
      };
    }
    console.warn('Mode hors ligne - cache local getContractuelPointages:', err.message);
    const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
    let listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
    if (filter?.date) listP = listP.filter((p) => p.date === filter.date);
    if (filter?.startDate && filter?.endDate) {
      listP = listP.filter((p) => p.date >= filter.startDate! && p.date <= filter.endDate!);
    }
    if (filter?.domaine_id && filter.domaine_id !== 'ALL') listP = listP.filter((p) => p.domaine_id === filter.domaine_id);
    if (filter?.ouvrier_id) listP = listP.filter((p) => p.ouvrier_id === filter.ouvrier_id);
    if (filter?.serre_id && filter.serre_id !== 'ALL') {
      listP = listP.filter(
        (p) =>
          p.serre_id === filter.serre_id ||
          (Array.isArray(p.serres_ids) && p.serres_ids.includes(filter.serre_id!))
      );
    }
    if (filter?.statut_validation && filter.statut_validation !== 'ALL') {
      listP = listP.filter(
        (p) => normalizeStatutValidation(p.statut_validation) === normalizeStatutValidation(filter.statut_validation)
      );
    }
    return {
      success: true,
      pointages: listP,
      fromCache: true,
      pendingCount: pendingQueue.length,
    };
  }
}

export async function saveContractuelPointage(payload: {
  ouvrier_id: string;
  matricule?: string;
  nom_complet?: string;
  date: string;
  present: boolean;
  domaine_id?: string;
  montant_total_jour?: number;
  tarif_initial?: number;
  montant_propose?: number;
  motif_modification?: string | null;
  statut_validation?: StatutValidationContractuel;
  serre_id?: string | null;
  serres_ids?: string[];
  serres_noms?: string[];
  serres_texte?: string | null;
  taches_ids?: string[];
  taches_noms?: string[];
  taches_texte?: string | null;
  heure_debut?: string | null;
  heure_fin?: string | null;
  duree_heures?: number | null;
  activites?: Partial<ContractuelActivite>[];
}): Promise<{
  success: boolean;
  pointage?: ContractuelPointage;
  message?: string;
  queuedOffline?: boolean;
  error?: string;
}> {
  const queueOfflineDraft = () => {
    const nowIso = new Date().toISOString();
    const draftPayload = { ...payload, updated_at: nowIso };
    enqueuePendingPointage(draftPayload);
    try {
      const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      let listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
      const existing = listP.find(
        (p) => p.date === payload.date && p.ouvrier_id === payload.ouvrier_id
      );
      const draftPointage: ContractuelPointage = {
        ...(existing || {}),
        id: existing?.id || `cp_${payload.date}_${payload.ouvrier_id}`,
        company_id: existing?.company_id || 'cie_lahcen_pointeur',
        ouvrier_id: payload.ouvrier_id,
        matricule: payload.matricule || existing?.matricule || '',
        nom_complet: payload.nom_complet || existing?.nom_complet || '',
        date: payload.date,
        present: payload.present,
        domaine_id: payload.domaine_id || existing?.domaine_id || 'dom_d2',
        serre_id: payload.serre_id ?? existing?.serre_id ?? null,
        serres_ids: payload.serres_ids || existing?.serres_ids || [],
        serres_noms: payload.serres_noms || existing?.serres_noms || [],
        serres_texte: payload.serres_texte ?? existing?.serres_texte ?? null,
        taches_ids: payload.taches_ids || existing?.taches_ids || [],
        taches_noms: payload.taches_noms || existing?.taches_noms || [],
        taches_texte: payload.taches_texte ?? existing?.taches_texte ?? null,
        heure_debut: payload.heure_debut ?? existing?.heure_debut ?? null,
        heure_fin: payload.heure_fin ?? existing?.heure_fin ?? null,
        duree_heures: payload.duree_heures ?? existing?.duree_heures ?? null,
        tarif_initial: payload.tarif_initial ?? existing?.tarif_initial ?? 0,
        montant_propose: payload.present ? (payload.montant_propose ?? payload.tarif_initial ?? 0) : 0,
        statut_validation: payload.statut_validation || existing?.statut_validation || 'BROUILLON',
        montant_total_jour: existing?.statut_validation === 'VALIDE' ? existing.montant_total_jour : 0,
        created_at: existing?.created_at || nowIso,
        updated_at: nowIso,
      };
      listP = listP.filter(
        (p) => !(p.date === payload.date && p.ouvrier_id === payload.ouvrier_id)
      );
      listP.push(draftPointage);
      localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(listP));
      return draftPointage;
    } catch {
      return undefined;
    }
  };

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const draft = queueOfflineDraft();
    return {
      success: false,
      queuedOffline: true,
      pointage: draft,
      error: 'Mode hors ligne : pointage mis en file d\'attente locale et sera synchronisé automatiquement dès le retour du réseau.',
    };
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/pointages', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      // NE JAMAIS masquer une erreur HTTP serveur (400/401/403/409/500) en file offline !
      return {
        success: false,
        error: data.error || `Erreur serveur HTTP ${res.status} lors de l'enregistrement.`,
      };
    }

    // Retirer de la file d'attente si précédemment en attente
    const pending = readPendingPointagesQueue();
    const cleanedPending = pending.filter(
      (q) => !(q.ouvrier_id === payload.ouvrier_id && q.date === payload.date)
    );
    if (cleanedPending.length !== pending.length) {
      writePendingPointagesQueue(cleanedPending);
    }

    // Miroir local
    try {
      const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      let listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
      listP = listP.filter(
        (p) => !(p.date === payload.date && p.ouvrier_id === payload.ouvrier_id)
      );
      if (data.pointage) {
        listP.push(data.pointage);
      }
      localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(listP));
      markContractuelsSynced();
    } catch {
      // ignore
    }

    return data;
  } catch (err: any) {
    if (isNetworkUnavailable(err)) {
      const draft = queueOfflineDraft();
      return {
        success: false,
        queuedOffline: true,
        pointage: draft,
        error: 'Connexion interrompue : pointage enregistré en file locale en attente de synchronisation.',
      };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function syncPendingContractuelPointages(): Promise<{
  success: boolean;
  syncedCount: number;
  conflictCount: number;
  remainingCount: number;
  error?: string;
}> {
  const queue = readPendingPointagesQueue();
  if (queue.length === 0) {
    return { success: true, syncedCount: 0, conflictCount: 0, remainingCount: 0 };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: false,
      syncedCount: 0,
      conflictCount: 0,
      remainingCount: queue.length,
      error: 'Hors connexion',
    };
  }

  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pointages: queue }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        syncedCount: 0,
        conflictCount: 0,
        remainingCount: queue.length,
        error: data.error || `Erreur synchronisation (${res.status})`,
      };
    }

    const results: any[] = Array.isArray(data.results) ? data.results : [];
    const remaining: any[] = [];
    let conflictCount = 0;

    for (const qItem of queue) {
      const r = results.find(
        (resItem) =>
          resItem.ouvrier_id === qItem.ouvrier_id &&
          resItem.date === qItem.date
      );
      if (!r) {
        remaining.push(qItem);
      } else if (r.status === 'conflict_valide' || r.status === 'conflict_stale') {
        conflictCount++;
        // Ne pas renvoyer en boucle une donnée locale obsolète qui perd contre le serveur VALIDE/plus récent
      } else if (r.status === 'error') {
        remaining.push(qItem);
      }
    }

    writePendingPointagesQueue(remaining);

    if (Array.isArray(data.pointages) && data.pointages.length > 0) {
      const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      const listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
      const map = new Map<string, ContractuelPointage>(listP.map((p) => [p.id, p]));
      data.pointages.forEach((p: ContractuelPointage) => map.set(p.id, p));
      localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(Array.from(map.values())));
    }
    markContractuelsSynced();

    return {
      success: true,
      syncedCount: Number(data.syncedCount || 0),
      conflictCount,
      remainingCount: remaining.length,
    };
  } catch (err: any) {
    return {
      success: false,
      syncedCount: 0,
      conflictCount: 0,
      remainingCount: queue.length,
      error: err.message || 'Erreur réseau lors de la synchronisation.',
    };
  }
}

export async function validateContractuelPointage(
  id: string,
  params: {
    decision: 'VALIDE' | 'REFUSE';
    montant_valide?: number;
    motif?: string;
  }
): Promise<{ success: boolean; pointage?: ContractuelPointage; message?: string; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/contractuels/pointages/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur lors de la validation administrateur.');
    }

    try {
      const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      let listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
      if (data.pointage) {
        listP = listP.map((p) => (p.id === id ? data.pointage : p));
        localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(listP));
      }
      markContractuelsSynced();
    } catch {
      // ignore
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function validateContractuelPointagesBatch(
  items: Array<{
    id: string;
    decision: 'VALIDE' | 'REFUSE';
    montant_valide?: number;
    motif?: string;
  }>
): Promise<{
  success: boolean;
  count?: number;
  pointages?: ContractuelPointage[];
  message?: string;
  error?: string;
}> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/contractuels/pointages/validate-batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur validation en lot.');
    }

    if (Array.isArray(data.pointages)) {
      try {
        const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
        const listP: ContractuelPointage[] = rawP ? JSON.parse(rawP) : [];
        const map = new Map<string, ContractuelPointage>(listP.map((p) => [p.id, p]));
        data.pointages.forEach((p: ContractuelPointage) => map.set(p.id, p));
        localStorage.setItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES, JSON.stringify(Array.from(map.values())));
        markContractuelsSynced();
      } catch {
        // ignore
      }
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelPointage(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/contractuels/pointages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression pointage contractuel.');
    }

    const rawP = localStorage.getItem(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
    if (rawP) {
      const listP: ContractuelPointage[] = JSON.parse(rawP);
      localStorage.setItem(
        STORAGE_KEYS_CONTRACTUELS.POINTAGES,
        JSON.stringify(listP.filter((p) => p.id !== id))
      );
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelActivite(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/contractuels/activites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression activité contractuelle.');
    }
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 3. EXPORT EXCEL DÉDIÉ (5 FEUILLES SHEETJS — MONTANTS OFFICIELS VALIDÉS UNIQUEMENT)
export function exportContractuellesExcel(params: {
  pointages: ContractuelPointage[];
  allOuvriers: ContractuelOuvrier[];
  date?: string;
  filterDesc?: string;
}) {
  const { wb, fileName } = buildContractuellesWorkbook(params);
  XLSX.writeFile(wb, fileName);
}
