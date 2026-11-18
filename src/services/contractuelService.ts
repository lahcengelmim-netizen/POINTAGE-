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
import {
  ContractuelContrat,
  ContractuelOuvrier,
  ContractuelPointage,
  ContractuelActivite,
  ContractuelFilter,
  ModeRemuneration,
} from '../types';
import {
  OUTBOX_KEYS,
  enqueueOutboxOp,
  getOutboxOps,
  dequeueOutboxOpsById,
  markOutboxOpsFailed,
  mergeCollectionWithConflictLog,
  isDeletedTombstone,
} from './syncOutbox';

const STORAGE_KEYS_CONTRACTUELS = {
  CONTRATS: 'agripointage_contractuels_contrats_v1',
  OUVRIERS: 'agripointage_contractuels_ouvriers_v1',
  POINTAGES: 'agripointage_contractuels_pointages_v1',
  ACTIVITES: 'agripointage_contractuels_activites_v1',
};

function readLocalList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalList<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (err) {
    console.warn(`[contractuelService] Erreur écriture locale ${key}:`, err);
  }
}

function getActiveCompanyId(): string | null {
  try {
    const rawUser = localStorage.getItem('agripointage_current_user_v1');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed?.company_id) return String(parsed.company_id).trim();
    }
    const rawComp = localStorage.getItem('agripointage_active_company_v1');
    if (rawComp) {
      const parsed = JSON.parse(rawComp);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed?.id) return String(parsed.id).trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function isOfflineOrTransientStatus(status?: number): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (status === undefined || status === 0) return true;
  return status >= 500 || status === 408 || status === 429;
}

// Récupération des en-têtes d'autorisation avec Bearer Token (session Supabase obligatoire)
async function getAuthHeaders(overrides?: { accessToken?: string; companyId?: string }): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const companyId = overrides?.companyId || getActiveCompanyId();
  if (companyId) {
    headers['x-company-id'] = companyId;
  }

  if (overrides?.accessToken) {
    headers['Authorization'] = `Bearer ${overrides.accessToken}`;
    return headers;
  }

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

// 0. CATALOGUE DES CONTRATS & TARIFS DE RÉFÉRENCE

export async function getContractuelContrats(
  filter?: {
    actif?: boolean;
    searchQuery?: string;
  },
  options?: {
    accessToken?: string;
    companyId?: string;
    baseUrl?: string;
    ignoreNavigatorOnline?: boolean;
  }
): Promise<{ success: boolean; contrats: ContractuelContrat[]; error?: string }> {
  const companyId = options?.companyId || getActiveCompanyId();
  try {
    if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({
      accessToken: options?.accessToken,
      companyId: companyId || undefined,
    });
    const params = new URLSearchParams();
    if (filter?.actif) params.set('actif', 'true');
    if (filter?.searchQuery) params.set('searchQuery', filter.searchQuery);

    const prefix = options?.baseUrl || '';
    const res = await fetch(`${prefix}/api/contractuels/contrats?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.contrats)) {
      const localList = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
      const merged =
        data.contrats.length > 0
          ? mergeCollectionWithConflictLog<ContractuelContrat>({
              table: 'contractuels_contrats',
              queueKey: OUTBOX_KEYS.CONTRACTUELS,
              localItems: localList,
              remoteItems: data.contrats,
              getId: (c) => c.id,
              getCompanyId: (c) => c.company_id,
              scopedCompanyId: companyId || undefined,
              preserveLocalNotInRemote: true,
            })
          : localList;
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.CONTRATS, merged);

      let result = merged;
      if (companyId) result = result.filter((c) => !c.company_id || c.company_id === companyId);
      if (filter?.actif) result = result.filter((c) => c.actif);
      if (filter?.searchQuery) {
        const q = filter.searchQuery.toLowerCase();
        result = result.filter((c) => c.designation.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q));
      }
      return { success: true, contrats: result };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des contrats.');
  } catch (err: any) {
    console.warn('Fallback stockage local getContractuelContrats:', err.message);
    let list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS).filter(
      (c) => !isDeletedTombstone('contractuels_contrats', c.id)
    );
    if (companyId) list = list.filter((c) => !c.company_id || c.company_id === companyId);
    if (filter?.actif) list = list.filter((c) => c.actif);
    if (filter?.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      list = list.filter((c) => c.designation.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q));
    }
    return { success: true, contrats: list };
  }
}

export async function saveContractuelContrat(
  contratData: Partial<ContractuelContrat>
): Promise<{ success: boolean; contrat?: ContractuelContrat; error?: string }> {
  const companyId = contratData.company_id || getActiveCompanyId() || 'cie_lahcen_pointeur';
  const nowIso = new Date().toISOString();
  const isEdit = Boolean(contratData.id);
  let lastStatus: number | undefined;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const url = isEdit
      ? `/api/contractuels/contrats/${encodeURIComponent(contratData.id!)}`
      : '/api/contractuels/contrats';

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify(contratData),
    });
    lastStatus = res.status;

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur enregistrement contrat.');
    }

    const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
    const saved = data.contrat as ContractuelContrat;
    const idx = list.findIndex((c) => c.id === saved.id);
    if (idx >= 0) list[idx] = saved;
    else list.unshift(saved);
    writeLocalList(STORAGE_KEYS_CONTRACTUELS.CONTRATS, list);

    return { success: true, contrat: saved };
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus) && contratData.designation) {
      const localId = contratData.id || `ctr_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const localRecord: ContractuelContrat = {
        id: localId,
        company_id: companyId,
        code: contratData.code,
        designation: contratData.designation,
        prix_unitaire: Number(contratData.prix_unitaire) || 0,
        unite: contratData.unite || 'JOUR',
        mode_remuneration: contratData.mode_remuneration || 'JOUR',
        domaine_id: contratData.domaine_id,
        description: contratData.description,
        actif: contratData.actif ?? true,
        created_at: contratData.created_at || nowIso,
        updated_at: nowIso,
      };
      const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
      const idx = list.findIndex((c) => c.id === localId);
      if (idx >= 0) list[idx] = localRecord;
      else list.unshift(localRecord);
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.CONTRATS, list);

      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_contrats',
        entityId: localId,
        action: 'upsert',
        data: localRecord,
        companyId,
      });
      return { success: true, contrat: localRecord };
    }
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

    if (Array.isArray(data.contrats)) {
      const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
      data.contrats.forEach((newC: ContractuelContrat) => {
        const idx = list.findIndex((c) => c.id === newC.id);
        if (idx >= 0) list[idx] = newC;
        else list.push(newC);
      });
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.CONTRATS, list);
    }

    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelContrat(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const companyId = getActiveCompanyId() || 'cie_lahcen_pointeur';
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/contractuels/contrats/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression contrat.');
    }

    const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
    writeLocalList(
      STORAGE_KEYS_CONTRACTUELS.CONTRATS,
      list.filter((c) => c.id !== id)
    );

    return data;
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS);
      writeLocalList(
        STORAGE_KEYS_CONTRACTUELS.CONTRATS,
        list.filter((c) => c.id !== id)
      );
      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_contrats',
        entityId: id,
        action: 'delete',
        data: { id, company_id: companyId },
        companyId,
      });
      return { success: true, message: 'Suppression mise en file hors ligne.' };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

// 1. OUVRIERS CONTRACTUELS

export async function getContractuelOuvriers(
  filter?: {
    actif?: boolean;
    domaineId?: string;
  },
  options?: {
    accessToken?: string;
    companyId?: string;
    baseUrl?: string;
    ignoreNavigatorOnline?: boolean;
  }
): Promise<{ success: boolean; ouvriers: ContractuelOuvrier[]; error?: string }> {
  const companyId = options?.companyId || getActiveCompanyId();
  try {
    if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({
      accessToken: options?.accessToken,
      companyId: companyId || undefined,
    });
    const params = new URLSearchParams();
    if (filter?.actif) params.set('actif', 'true');
    if (filter?.domaineId && filter.domaineId !== 'ALL') params.set('domaineId', filter.domaineId);

    const prefix = options?.baseUrl || '';
    const res = await fetch(`${prefix}/api/contractuels/ouvriers?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.ouvriers)) {
      const localList = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
      const merged =
        data.ouvriers.length > 0
          ? mergeCollectionWithConflictLog<ContractuelOuvrier>({
              table: 'contractuels_ouvriers',
              queueKey: OUTBOX_KEYS.CONTRACTUELS,
              localItems: localList,
              remoteItems: data.ouvriers,
              getId: (o) => o.id,
              getCompanyId: (o) => o.company_id,
              scopedCompanyId: companyId || undefined,
              preserveLocalNotInRemote: true,
            })
          : localList;
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, merged);

      let result = merged;
      if (companyId) result = result.filter((o) => !o.company_id || o.company_id === companyId);
      if (filter?.actif) result = result.filter((o) => o.actif);
      if (filter?.domaineId && filter.domaineId !== 'ALL') {
        result = result.filter((o) => o.domaine_id === filter.domaineId);
      }
      return { success: true, ouvriers: result };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des ouvriers contractuels.');
  } catch (err: any) {
    console.warn('Fallback stockage local getContractuelOuvriers:', err.message);
    let list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS).filter(
      (o) => !isDeletedTombstone('contractuels_ouvriers', o.id)
    );
    if (companyId) list = list.filter((o) => !o.company_id || o.company_id === companyId);
    if (filter?.actif) list = list.filter((o) => o.actif);
    if (filter?.domaineId && filter.domaineId !== 'ALL') list = list.filter((o) => o.domaine_id === filter.domaineId);
    return { success: true, ouvriers: list };
  }
}

export async function saveContractuelOuvrier(
  ouvrierData: Partial<ContractuelOuvrier>
): Promise<{ success: boolean; ouvrier?: ContractuelOuvrier; error?: string }> {
  const companyId = ouvrierData.company_id || getActiveCompanyId() || 'cie_lahcen_pointeur';
  const nowIso = new Date().toISOString();
  const isEdit = Boolean(ouvrierData.id);
  let lastStatus: number | undefined;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const url = isEdit
      ? `/api/contractuels/ouvriers/${encodeURIComponent(ouvrierData.id!)}`
      : '/api/contractuels/ouvriers';

    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers,
      body: JSON.stringify(ouvrierData),
    });
    lastStatus = res.status;

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur enregistrement ouvrier contractuel.');
    }

    let list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    if (isEdit) {
      list = list.map((o) => (o.id === data.ouvrier.id ? data.ouvrier : o));
    } else {
      list.push(data.ouvrier);
    }
    writeLocalList(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, list);

    return { success: true, ouvrier: data.ouvrier };
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus) && (ouvrierData.nom || ouvrierData.nom_complet)) {
      const localId = ouvrierData.id || `ouv_ctr_off_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const fullName = ouvrierData.nom_complet || `${ouvrierData.nom || ''} ${ouvrierData.prenom || ''}`.trim();
      const localRecord: ContractuelOuvrier = {
        id: localId,
        company_id: companyId,
        nom: ouvrierData.nom || fullName,
        prenom: ouvrierData.prenom || '',
        nom_complet: fullName,
        matricule: ouvrierData.matricule || `CTR-${Date.now().toString().slice(-4)}`,
        domaine_id: ouvrierData.domaine_id || 'dom_d2',
        serre_id: ouvrierData.serre_id ?? null,
        mode_remuneration: ouvrierData.mode_remuneration || 'JOUR',
        prix_convenu: Number(ouvrierData.prix_convenu) || 0,
        unite: ouvrierData.unite || 'JOUR',
        actif: ouvrierData.actif ?? true,
        telephone: ouvrierData.telephone,
        notes: ouvrierData.notes,
        created_at: ouvrierData.created_at || nowIso,
        updated_at: nowIso,
      };
      let list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
      if (isEdit) {
        list = list.map((o) => (o.id === localId ? localRecord : o));
      } else {
        list.push(localRecord);
      }
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, list);
      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_ouvriers',
        entityId: localId,
        action: 'upsert',
        data: localRecord,
        companyId,
      });
      return { success: true, ouvrier: localRecord };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelOuvrier(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const companyId = getActiveCompanyId() || 'cie_lahcen_pointeur';
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/contractuels/ouvriers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression ouvrier contractuel.');
    }

    const list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
    writeLocalList(
      STORAGE_KEYS_CONTRACTUELS.OUVRIERS,
      list.filter((o) => o.id !== id)
    );

    return { success: true };
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      const list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS);
      writeLocalList(
        STORAGE_KEYS_CONTRACTUELS.OUVRIERS,
        list.filter((o) => o.id !== id)
      );
      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_ouvriers',
        entityId: id,
        action: 'delete',
        data: { id, company_id: companyId },
        companyId,
      });
      return { success: true };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function importContractuelOuvriers(
  ouvriers: Array<{
    nom: string;
    prenom?: string;
    nom_complet?: string;
    serre_nom?: string;
    prix_convenu: number;
    mode_remuneration?: ModeRemuneration;
    unite?: string;
    matricule?: string;
    domaine_id?: string;
    notes?: string;
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

export async function getContractuelPointages(
  filter?: ContractuelFilter,
  options?: {
    accessToken?: string;
    companyId?: string;
    baseUrl?: string;
    ignoreNavigatorOnline?: boolean;
  }
): Promise<{
  success: boolean;
  pointages: ContractuelPointage[];
  activites?: ContractuelActivite[];
  error?: string;
}> {
  const companyId = options?.companyId || getActiveCompanyId();
  try {
    if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({
      accessToken: options?.accessToken,
      companyId: companyId || undefined,
    });
    const params = new URLSearchParams();
    if (filter?.date) params.set('date', filter.date);
    if (filter?.startDate) params.set('startDate', filter.startDate);
    if (filter?.endDate) params.set('endDate', filter.endDate);
    if (filter?.domaine_id && filter.domaine_id !== 'ALL') params.set('domaineId', filter.domaine_id);
    if (filter?.serre_id && filter.serre_id !== 'ALL') params.set('serreId', filter.serre_id);
    if (filter?.ouvrier_id) params.set('ouvrierId', filter.ouvrier_id);

    const prefix = options?.baseUrl || '';
    const res = await fetch(`${prefix}/api/contractuels/pointages?${params.toString()}`, { headers });
    const data = await res.json();

    if (res.ok && data.success && Array.isArray(data.pointages)) {
      const localList = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      const merged =
        data.pointages.length > 0
          ? mergeCollectionWithConflictLog<ContractuelPointage>({
              table: 'contractuels_pointages',
              queueKey: OUTBOX_KEYS.CONTRACTUELS,
              localItems: localList,
              remoteItems: data.pointages,
              getId: (p) => p.id,
              getCompanyId: (p) => p.company_id,
              scopedCompanyId: companyId || undefined,
              preserveLocalNotInRemote: true,
            })
          : localList;
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.POINTAGES, merged);

      const serverActs = Array.isArray(data.activites) ? (data.activites as ContractuelActivite[]) : [];
      if (serverActs.length > 0) {
        const localActs = readLocalList<ContractuelActivite>(STORAGE_KEYS_CONTRACTUELS.ACTIVITES);
        const mergedActs = mergeCollectionWithConflictLog<ContractuelActivite>({
          table: 'contractuels_activites',
          queueKey: OUTBOX_KEYS.CONTRACTUELS,
          localItems: localActs,
          remoteItems: serverActs,
          getId: (a) => a.id,
          getCompanyId: (a) => a.company_id,
          scopedCompanyId: companyId || undefined,
          preserveLocalNotInRemote: true,
        });
        writeLocalList(STORAGE_KEYS_CONTRACTUELS.ACTIVITES, mergedActs);
      }

      // Filtrer sur la vue demandée à partir de l'état fusionné
      let viewPointages = merged.filter((p) => !isDeletedTombstone('contractuels_pointages', p.id));
      if (companyId) viewPointages = viewPointages.filter((p) => !p.company_id || p.company_id === companyId);
      if (filter?.date) viewPointages = viewPointages.filter((p) => p.date === filter.date);
      if (filter?.startDate && filter?.endDate) {
        viewPointages = viewPointages.filter((p) => p.date >= filter.startDate! && p.date <= filter.endDate!);
      }
      if (filter?.domaine_id && filter.domaine_id !== 'ALL') {
        viewPointages = viewPointages.filter((p) => p.domaine_id === filter.domaine_id);
      }
      if (filter?.ouvrier_id) viewPointages = viewPointages.filter((p) => p.ouvrier_id === filter.ouvrier_id);

      return { success: true, pointages: viewPointages, activites: serverActs };
    }

    throw new Error(data.error || 'Erreur lors de la récupération des pointages contractuels.');
  } catch (err: any) {
    console.warn('Fallback stockage local getContractuelPointages:', err.message);
    let listP = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES).filter(
      (p) => !isDeletedTombstone('contractuels_pointages', p.id)
    );
    if (companyId) listP = listP.filter((p) => !p.company_id || p.company_id === companyId);
    if (filter?.date) listP = listP.filter((p) => p.date === filter.date);
    if (filter?.startDate && filter?.endDate) {
      listP = listP.filter((p) => p.date >= filter.startDate! && p.date <= filter.endDate!);
    }
    if (filter?.domaine_id && filter.domaine_id !== 'ALL') listP = listP.filter((p) => p.domaine_id === filter.domaine_id);
    if (filter?.ouvrier_id) listP = listP.filter((p) => p.ouvrier_id === filter.ouvrier_id);
    return { success: true, pointages: listP };
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
  serre_id?: string | null;
  serres_ids?: string[];
  serres_noms?: string[];
  serres_texte?: string | null;
  activites?: Partial<ContractuelActivite>[];
}): Promise<{ success: boolean; pointage?: ContractuelPointage; message?: string; error?: string }> {
  const companyId = getActiveCompanyId() || 'cie_lahcen_pointeur';
  const nowIso = new Date().toISOString();
  let lastStatus: number | undefined;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch('/api/contractuels/pointages', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    lastStatus = res.status;

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur enregistrement pointage contractuel.');
    }

    let listP = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
    listP = listP.filter((p) => !(p.date === payload.date && p.ouvrier_id === payload.ouvrier_id));
    if (data.pointage) {
      listP.push(data.pointage);
    }
    writeLocalList(STORAGE_KEYS_CONTRACTUELS.POINTAGES, listP);

    return data;
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus) && payload.ouvrier_id && payload.date) {
      const pointageId = `ptg_ctr_off_${payload.date}_${payload.ouvrier_id}`;
      const builtActs: ContractuelActivite[] = (payload.activites || []).map((a, idx) => {
        const q = Number(a.quantite) || 0;
        const pu = Number(a.prix_unitaire) || 0;
        return {
          id: a.id || `act_ctr_off_${Date.now()}_${idx}`,
          pointage_id: pointageId,
          company_id: companyId,
          ouvrier_id: payload.ouvrier_id,
          nom_complet: payload.nom_complet || '',
          matricule: payload.matricule || '',
          date: payload.date,
          contrat_id: a.contrat_id || null,
          contrat_nom: a.contrat_nom || null,
          tache_id: a.tache_id || a.contrat_id || 'tache_libre',
          tache_nom: a.tache_nom || a.contrat_nom || 'Tâche contractuelle',
          domaine_id: a.domaine_id || payload.domaine_id || 'dom_d2',
          serre_id: a.serre_id ?? payload.serre_id ?? null,
          serre_nom: a.serre_nom || a.serres_texte || undefined,
          serres_ids: a.serres_ids || payload.serres_ids,
          serres_noms: a.serres_noms || payload.serres_noms,
          serres_texte: a.serres_texte ?? payload.serres_texte ?? null,
          mode_remuneration: a.mode_remuneration || 'JOUR',
          quantite: q,
          unite: a.unite || 'JOUR',
          prix_unitaire: pu,
          montant_total: a.montant_total ?? Math.round(q * pu * 100) / 100,
          observation: a.observation ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      const localPointage: ContractuelPointage = {
        id: pointageId,
        company_id: companyId,
        ouvrier_id: payload.ouvrier_id,
        matricule: payload.matricule || '',
        nom_complet: payload.nom_complet || '',
        date: payload.date,
        present: payload.present,
        domaine_id: payload.domaine_id || 'dom_d2',
        serre_id: payload.serre_id ?? null,
        serres_ids: payload.serres_ids,
        serres_noms: payload.serres_noms,
        serres_texte: payload.serres_texte ?? null,
        activites: builtActs,
        montant_total_jour:
          payload.montant_total_jour ??
          builtActs.reduce((sum, a) => sum + (Number(a.montant_total) || 0), 0),
        created_at: nowIso,
        updated_at: nowIso,
      };

      let listP = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      listP = listP.filter((p) => !(p.date === payload.date && p.ouvrier_id === payload.ouvrier_id));
      listP.push(localPointage);
      writeLocalList(STORAGE_KEYS_CONTRACTUELS.POINTAGES, listP);

      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_pointages',
        entityId: pointageId,
        action: 'upsert',
        data: payload,
        companyId,
      });
      return {
        success: true,
        pointage: localPointage,
        message: 'Enregistré localement (synchronisation en attente).',
      };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelPointage(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const companyId = getActiveCompanyId() || 'cie_lahcen_pointeur';
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/contractuels/pointages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression pointage contractuel.');
    }

    const listP = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
    writeLocalList(
      STORAGE_KEYS_CONTRACTUELS.POINTAGES,
      listP.filter((p) => p.id !== id)
    );

    return data;
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      const listP = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES);
      writeLocalList(
        STORAGE_KEYS_CONTRACTUELS.POINTAGES,
        listP.filter((p) => p.id !== id)
      );
      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_pointages',
        entityId: id,
        action: 'delete',
        data: { id, company_id: companyId },
        companyId,
      });
      return { success: true, message: 'Suppression pointage mise en file hors ligne.' };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function deleteContractuelActivite(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const companyId = getActiveCompanyId() || 'cie_lahcen_pointeur';
  let lastStatus: number | undefined;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('Hors connexion');
    }
    const headers = await getAuthHeaders({ companyId });
    const res = await fetch(`/api/contractuels/activites/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    lastStatus = res.status;
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur suppression activité contractuelle.');
    }
    return data;
  } catch (err: any) {
    if (isOfflineOrTransientStatus(lastStatus)) {
      enqueueOutboxOp(OUTBOX_KEYS.CONTRACTUELS, {
        table: 'contractuels_activites',
        entityId: id,
        action: 'delete',
        data: { id, company_id: companyId },
        companyId,
      });
      return { success: true, message: 'Suppression activité mise en file hors ligne.' };
    }
    return { success: false, error: err.message || 'Erreur réseau.' };
  }
}

export async function flushContractuelsSyncQueue(options?: {
  accessToken?: string;
  companyId?: string;
  baseUrl?: string;
  ignoreNavigatorOnline?: boolean;
}): Promise<{ syncedCount: number; failedCount: number; errors: string[] }> {
  const resSummary = { syncedCount: 0, failedCount: 0, errors: [] as string[] };
  if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return resSummary;
  }

  const allOps = getOutboxOps(OUTBOX_KEYS.CONTRACTUELS);
  if (allOps.length === 0) return resSummary;

  const targetCompany = options?.companyId || getActiveCompanyId() || undefined;
  const scopedOps = allOps.filter((op) => !targetCompany || !op.companyId || op.companyId === targetCompany);
  if (scopedOps.length === 0) return resSummary;

  const prefix = options?.baseUrl || '';
  const confirmedIds: string[] = [];

  for (const op of scopedOps) {
    try {
      const headers = await getAuthHeaders({
        accessToken: options?.accessToken,
        companyId: op.companyId || targetCompany,
      });

      let url = '';
      let method: 'POST' | 'PUT' | 'DELETE' = 'POST';
      let body: string | undefined;

      if (op.table === 'contractuels_contrats') {
        if (op.action === 'delete') {
          url = `${prefix}/api/contractuels/contrats/${encodeURIComponent(op.entityId)}`;
          method = 'DELETE';
        } else {
          const isOfflineTemp = op.entityId.startsWith('ctr_off_');
          url = isOfflineTemp
            ? `${prefix}/api/contractuels/contrats`
            : `${prefix}/api/contractuels/contrats/${encodeURIComponent(op.entityId)}`;
          method = isOfflineTemp ? 'POST' : 'PUT';
          const payload = isOfflineTemp ? { ...op.data, id: undefined } : op.data;
          body = JSON.stringify(payload);
        }
      } else if (op.table === 'contractuels_ouvriers') {
        if (op.action === 'delete') {
          url = `${prefix}/api/contractuels/ouvriers/${encodeURIComponent(op.entityId)}`;
          method = 'DELETE';
        } else {
          const isOfflineTemp = op.entityId.startsWith('ouv_ctr_off_');
          url = isOfflineTemp
            ? `${prefix}/api/contractuels/ouvriers`
            : `${prefix}/api/contractuels/ouvriers/${encodeURIComponent(op.entityId)}`;
          method = isOfflineTemp ? 'POST' : 'PUT';
          const payload = isOfflineTemp ? { ...op.data, id: undefined } : op.data;
          body = JSON.stringify(payload);
        }
      } else if (op.table === 'contractuels_pointages') {
        if (op.action === 'delete') {
          url = `${prefix}/api/contractuels/pointages/${encodeURIComponent(op.entityId)}`;
          method = 'DELETE';
        } else {
          url = `${prefix}/api/contractuels/pointages`;
          method = 'POST';
          body = JSON.stringify(op.data);
        }
      } else if (op.table === 'contractuels_activites' && op.action === 'delete') {
        url = `${prefix}/api/contractuels/activites/${encodeURIComponent(op.entityId)}`;
        method = 'DELETE';
      } else {
        confirmedIds.push(op.opId);
        continue;
      }

      const resJson = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 && op.action === 'delete') {
          confirmedIds.push(op.opId);
          resSummary.syncedCount += 1;
          continue;
        }
        throw new Error(resJson.error || `HTTP ${response.status}`);
      }

      // Réconcilier l'ID provisoire hors ligne vers l'ID serveur canonique dans le cache local
      if (op.action === 'upsert') {
        if (op.table === 'contractuels_contrats' && resJson.contrat) {
          const list = readLocalList<ContractuelContrat>(STORAGE_KEYS_CONTRACTUELS.CONTRATS)
            .filter((c) => c.id !== op.entityId && c.id !== resJson.contrat.id);
          list.unshift(resJson.contrat);
          writeLocalList(STORAGE_KEYS_CONTRACTUELS.CONTRATS, list);
        } else if (op.table === 'contractuels_ouvriers' && resJson.ouvrier) {
          const list = readLocalList<ContractuelOuvrier>(STORAGE_KEYS_CONTRACTUELS.OUVRIERS)
            .filter((o) => o.id !== op.entityId && o.id !== resJson.ouvrier.id);
          list.push(resJson.ouvrier);
          writeLocalList(STORAGE_KEYS_CONTRACTUELS.OUVRIERS, list);
        } else if (op.table === 'contractuels_pointages' && resJson.pointage) {
          const list = readLocalList<ContractuelPointage>(STORAGE_KEYS_CONTRACTUELS.POINTAGES).filter(
            (p) =>
              p.id !== op.entityId &&
              p.id !== resJson.pointage.id &&
              !(p.date === resJson.pointage.date && p.ouvrier_id === resJson.pointage.ouvrier_id)
          );
          list.push(resJson.pointage);
          writeLocalList(STORAGE_KEYS_CONTRACTUELS.POINTAGES, list);
        }
      }

      confirmedIds.push(op.opId);
      resSummary.syncedCount += 1;
    } catch (err: any) {
      const msg = err?.message || 'Erreur synchronisation contractuels';
      resSummary.failedCount += 1;
      resSummary.errors.push(msg);
      markOutboxOpsFailed(OUTBOX_KEYS.CONTRACTUELS, [op.opId], msg);
    }
  }

  if (confirmedIds.length > 0) {
    dequeueOutboxOpsById(OUTBOX_KEYS.CONTRACTUELS, confirmedIds);
  }
  return resSummary;
}

// 3. HELPERS MÉTIER & EXPORT EXCEL DÉDIÉ (5 FEUILLES SHEETJS)

function stripAccentsUpper(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

export function normalizeContractuelDomaineShort(domaineId?: string | null): string {
  const clean = stripAccentsUpper(domaineId).replace(/^DOM_/, '');
  const match = clean.match(/^D0*(\d+)$/);
  if (match) return `D${parseInt(match[1], 10)}`;
  if (/^\d+$/.test(clean)) return `D${parseInt(clean, 10)}`;
  return clean || 'D2';
}

export function normalizeContractuelDomaineFull(domaineId?: string | null): string {
  const shortCode = normalizeContractuelDomaineShort(domaineId);
  const match = shortCode.match(/^D(\d+)$/);
  if (match) return `D${match[1].padStart(3, '0')}`;
  return shortCode;
}

export function formatContractuelOuvrierId(
  matricule?: string | null,
  domaineId?: string | null,
  workerFallback?: Partial<ContractuelOuvrier>
): string {
  const domShort = normalizeContractuelDomaineShort(domaineId || workerFallback?.domaine_id);
  const raw = String(matricule || workerFallback?.matricule || '').trim().toUpperCase();

  if (!raw) {
    const idDigits = String(workerFallback?.id || '').match(/\d+/);
    const numPart = idDigits ? String(parseInt(idDigits[0], 10)) : '0';
    return `${numPart}-${domShort}`;
  }

  const alreadyWithDomain = raw.match(/^(.+?)-(?:DOM_)?D0*(\d+)$/i);
  if (alreadyWithDomain) {
    const prefix = alreadyWithDomain[1].trim();
    const domNum = parseInt(alreadyWithDomain[2], 10);
    return `${prefix}-D${domNum}`;
  }

  if (/^\d+$/.test(raw)) {
    return `${parseInt(raw, 10)}-${domShort}`;
  }

  return `${raw}-${domShort}`;
}

function isUnassignedSerreLabel(value?: string | null): boolean {
  const norm = stripAccentsUpper(value);
  return (
    !norm ||
    norm === 'NON AFFECTEE' ||
    norm === 'AUCUNE' ||
    norm === 'AUCUNE SERRE' ||
    norm === 'SERRE NON DEFINIE' ||
    norm === '—' ||
    norm === '-' ||
    norm === 'TOUTES LES SERRES'
  );
}

function formatSingleContractuelSerreCode(rawSerre: string, domaineFull: string): string {
  const clean = stripAccentsUpper(rawSerre);
  if (!clean) return '';

  // Déjà au format D00XS12 ou D2-S12 / D5S23 -> normaliser sans double préfixe
  const fullMatch = clean.match(/^D0*(\d+)[-_\s]*S0*(\d+)$/);
  if (fullMatch) {
    return `D${String(parseInt(fullMatch[1], 10)).padStart(3, '0')}S${parseInt(fullMatch[2], 10)}`;
  }

  // Format serre_d5_23 -> extraire domaine & numéro
  const serreDomIdMatch = clean.match(/^SERRE[_-]D0*(\d+)[_-](\d+)$/);
  if (serreDomIdMatch) {
    return `D${String(parseInt(serreDomIdMatch[1], 10)).padStart(3, '0')}S${parseInt(serreDomIdMatch[2], 10)}`;
  }

  // Format SERRE 1, S01, S1, serre_1
  const numMatch = clean.match(/(?:SERRE[_\s]*|S0*)(\d+)$/) || clean.match(/(\d+)/);
  if (numMatch) {
    return `${domaineFull}S${parseInt(numMatch[1], 10)}`;
  }

  return clean;
}

export function formatContractuelSerreCell(act: Partial<ContractuelActivite>): string {
  const domFull = normalizeContractuelDomaineFull(act.domaine_id);

  const hasExplicitIds = Array.isArray(act.serres_ids) && act.serres_ids.length > 0;
  const hasExplicitNoms = Array.isArray(act.serres_noms) && act.serres_noms.some((s) => !isUnassignedSerreLabel(s));

  const rawTextCandidates: string[] = [];
  if (hasExplicitNoms) {
    act.serres_noms!.forEach((s) => {
      if (!isUnassignedSerreLabel(s)) rawTextCandidates.push(String(s));
    });
  } else if (hasExplicitIds) {
    act.serres_ids!.forEach((id) => {
      if (!isUnassignedSerreLabel(id)) rawTextCandidates.push(String(id));
    });
  } else {
    const textSource = !isUnassignedSerreLabel(act.serres_texte)
      ? act.serres_texte!
      : !isUnassignedSerreLabel(act.serre_nom)
        ? act.serre_nom!
        : (act.serre_id && !isUnassignedSerreLabel(act.serre_id) && (act.serre_nom || act.serres_texte) && !isUnassignedSerreLabel(act.serre_nom || act.serres_texte))
          ? act.serre_id
          : '';

    if (textSource) {
      String(textSource)
        .split(/[,;/+&]+/)
        .map((t) => t.trim())
        .filter((t) => t && !isUnassignedSerreLabel(t))
        .forEach((t) => rawTextCandidates.push(t));
    }
  }

  if (rawTextCandidates.length === 0) {
    return 'Toutes les serres';
  }

  const formatted: string[] = [];
  const seen = new Set<string>();
  for (const item of rawTextCandidates) {
    const code = formatSingleContractuelSerreCode(item, domFull);
    if (code && !seen.has(code)) {
      seen.add(code);
      formatted.push(code);
    }
  }

  return formatted.length > 0 ? formatted.join('+') : 'Toutes les serres';
}

function normalizeTimeValue(raw?: string | null): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{0,2})$/);
  if (!m) return null;
  const hh = String(parseInt(m[1], 10)).padStart(2, '0');
  const mm = String(m[2] ? parseInt(m[2], 10) : 0).padStart(2, '0');
  return `${hh}:${mm}`;
}

function extractScheduleTimes(act: Partial<ContractuelActivite> & Record<string, any>): {
  heureDeb: string;
  heureFin: string;
  dureeRep: 0 | 1;
} {
  let deb = normalizeTimeValue(act.heureDeb || act.heure_debut);
  let fin = normalizeTimeValue(act.heureFin || act.heure_fin);

  if (!deb || !fin) {
    const searchText = `${act.observation || ''} ${act.tache_nom || ''} ${act.contrat_nom || ''}`;
    const rangeMatch = searchText.match(/(\d{1,2}\s*[:hH]\s*\d{0,2})\s*[-–àa/]+\s*(\d{1,2}\s*[:hH]\s*\d{0,2})/);
    if (rangeMatch) {
      deb = deb || normalizeTimeValue(rangeMatch[1]);
      fin = fin || normalizeTimeValue(rangeMatch[2]);
    }
  }

  const heureDeb = deb || '07:00';
  const heureFin = fin || '16:00';

  let dureeRep: 0 | 1 = 1;
  if (heureDeb === '07:00' && heureFin === '14:00') {
    dureeRep = 0;
  } else if (heureDeb === '07:00' && heureFin === '16:00') {
    dureeRep = 1;
  } else if (act.dureeRep === 0 || act.dureeRep === '0') {
    dureeRep = 0;
  }

  return { heureDeb, heureFin, dureeRep };
}

export function computeContractuelExportFields(
  act: Partial<ContractuelActivite> & Record<string, any>,
  workerMap?: Map<string, ContractuelOuvrier>
) {
  const worker = act.ouvrier_id && workerMap ? workerMap.get(act.ouvrier_id) : undefined;
  const domShort = normalizeContractuelDomaineShort(act.domaine_id || worker?.domaine_id);
  const ouvrierId = formatContractuelOuvrierId(act.matricule, act.domaine_id, worker);
  const serre = formatContractuelSerreCell({
    ...act,
    domaine_id: act.domaine_id || worker?.domaine_id || 'dom_d2',
  });
  const ruban = 'Tous les Rubans';
  const { heureDeb, heureFin, dureeRep } = extractScheduleTimes(act);

  const taskText = stripAccentsUpper(`${act.tache_nom || ''} ${act.contrat_nom || ''}`);
  const modeRaw = stripAccentsUpper(act.mode_remuneration || worker?.mode_remuneration || 'JOUR');

  const isEbourgeonnageD5 =
    taskText.includes('EBOURGEON') && (domShort === 'D5' || /\bD0*5\b/.test(taskText));
  const isTTT = /\bTTT\b/.test(taskText) || taskText.includes('TRAITEMENT');
  const isTTTD3 = isTTT && (domShort === 'D3' || /\bD0*3\b/.test(taskText));
  const isRecolte = taskText.includes('RECOLTE');
  const isRecolteCerise = isRecolte && taskText.includes('CERISE');
  const isRecolteRonde = isRecolte && taskText.includes('RONDE');

  let tarifExcep = Number(act.prix_unitaire) || 0;
  let unite = '';
  let effectiveMode = act.mode_remuneration || 'JOUR';

  if (isEbourgeonnageD5) {
    tarifExcep = 150;
    unite = '1';
    effectiveMode = 'FORFAIT' as any;
  } else if (isTTTD3) {
    tarifExcep = 16;
    unite = '';
  } else if (isTTT) {
    unite = '';
  } else if (isRecolteCerise) {
    tarifExcep = 3.8;
    unite = '';
  } else if (isRecolteRonde) {
    tarifExcep = 1.1875;
    unite = '';
  } else if (isRecolte) {
    tarifExcep = Number(act.prix_unitaire) > 0 ? Number(act.prix_unitaire) : 1.1875;
    unite = '';
  } else if (modeRaw === 'UNITE') {
    unite = act.unite ? String(act.unite).trim() : '';
  } else if (modeRaw === 'JOUR' || modeRaw === 'HEURE') {
    unite = '';
    if (heureDeb === '07:00' && heureFin === '16:00') {
      tarifExcep = 95;
    } else if (tarifExcep <= 0) {
      tarifExcep = 95;
    }
  } else {
    unite = '';
  }

  return {
    ouvrierId,
    domShort,
    serre,
    ruban,
    effectiveMode,
    unite,
    qteMetrique: '',
    quantite: '',
    heureDeb,
    heureFin,
    dureeRep,
    tarifExcep,
  };
}

export function buildContractuellesRemunerationRows(
  allActivites: ContractuelActivite[],
  allOuvriers: ContractuelOuvrier[]
) {
  const workerMap = new Map<string, ContractuelOuvrier>();
  allOuvriers.forEach((o) => workerMap.set(o.id, o));

  return allActivites.map((act) => {
    const computed = computeContractuelExportFields(act, workerMap);
    return {
      'Date': act.date,
      'ouvrierId': computed.ouvrierId,
      'Ouvrier': act.nom_complet,
      'Contrat': act.contrat_nom || '—',
      'Domaine': computed.domShort,
      'Serre': computed.serre,
      'Ruban': computed.ruban,
      'Tâche Réalisée': act.tache_nom || act.contrat_nom || '',
      'Mode': computed.effectiveMode,
      'Unité': computed.unite,
      'qteMetrique': computed.qteMetrique,
      'quantite': computed.quantite,
      'heureDeb': computed.heureDeb,
      'heureFin': computed.heureFin,
      'dureeRep': computed.dureeRep,
      'tarifExcep': computed.tarifExcep,
      'Montant Total (DH)': act.montant_total,
      'Observation': act.observation || '',
      'Saisi par': act.created_by_nom || 'Caporal',
    };
  });
}

export function exportContractuellesExcel(params: {
  pointages: ContractuelPointage[];
  allOuvriers: ContractuelOuvrier[];
  date?: string;
  filterDesc?: string;
}) {
  const { pointages, allOuvriers, date, filterDesc } = params;
  const dateFormatted = date || new Date().toISOString().slice(0, 10);

  // Tous les ouvriers actifs pour cette sélection
  const totalOuvriers = allOuvriers.length;
  const presentsCount = pointages.filter((p) => p.present).length;
  const absentsCount = totalOuvriers - presentsCount;

  // Extraire toutes les activités à plat
  const allActivites: ContractuelActivite[] = [];
  pointages.forEach((p) => {
    if (p.present && p.activites && p.activites.length > 0) {
      p.activites.forEach((a) => allActivites.push(a));
    }
  });

  const montantTotalJourDH = pointages.reduce(
    (sum, p) => sum + (Number(p.montant_total_jour) || 0),
    0
  );

  const wb = XLSX.utils.book_new();

  // -------------------------------------------------------------
  // FEUILLE 1 : RÉCAPITULATIF
  // -------------------------------------------------------------
  const recapData = [
    { 'Indicateur': 'Exploitation Agricole', 'Valeur': 'Lahcen Pointeur' },
    { 'Indicateur': 'Module', 'Valeur': 'Gestion des Contractuelles' },
    { 'Indicateur': 'Date d\'analyse', 'Valeur': dateFormatted },
    { 'Indicateur': 'Période / Filtre', 'Valeur': filterDesc || 'Tous les domaines' },
    { 'Indicateur': 'Total Ouvriers Contractuels', 'Valeur': totalOuvriers },
    { 'Indicateur': 'Nombre de Présents', 'Valeur': presentsCount },
    { 'Indicateur': 'Nombre d\'Absents', 'Valeur': absentsCount > 0 ? absentsCount : 0 },
    { 'Indicateur': 'Nombre de Tâches Réalisées', 'Valeur': allActivites.length },
    { 'Indicateur': 'Montant Total Journalier (DH)', 'Valeur': Math.round(montantTotalJourDH * 100) / 100 },
  ];
  const wsRecap = XLSX.utils.json_to_sheet(recapData);
  XLSX.utils.book_append_sheet(wb, wsRecap, '1. Récapitulatif');

  // -------------------------------------------------------------
  // FEUILLE 2 : POINTAGE DÉTAILLÉ
  // -------------------------------------------------------------
  const detailPointageData = allOuvriers.map((ouvrier) => {
    const ptg = pointages.find((p) => p.ouvrier_id === ouvrier.id);
    const isPresent = ptg ? ptg.present : false;
    const domNom = ptg?.domaine_id ? ptg.domaine_id.replace('dom_', '').toUpperCase() : ouvrier.domaine_id.replace('dom_', '').toUpperCase();
    const serre = ptg?.serres_texte || ptg?.serre_id || ouvrier.serre_id || '—';
    const nbTaches = ptg?.activites?.length || 0;
    const montant = ptg?.montant_total_jour || 0;

    return {
      'Date': dateFormatted,
      'Matricule': ouvrier.matricule,
      'Nom de l\'Ouvrier': ouvrier.nom,
      'Prénom': ouvrier.prenom,
      'Nom Complet': ouvrier.nom_complet,
      'Domaine': domNom,
      'Serres': serre,
      'Présence': isPresent ? 'Présent' : 'Absent',
      'Nb Tâches': nbTaches,
      'Mode Rémunération': ouvrier.mode_remuneration,
      'Tarif Convenu (DH)': ouvrier.prix_convenu,
      'Total Jour (DH)': montant,
    };
  });
  const wsPointage = XLSX.utils.json_to_sheet(detailPointageData);
  XLSX.utils.book_append_sheet(wb, wsPointage, '2. Pointage Détaillé');

  // -------------------------------------------------------------
  // FEUILLE 3 : DÉTAIL DES RÉMUNÉRATIONS (12 RÈGLES MÉTIER STRICTES)
  // -------------------------------------------------------------
  const detailRemunerationsData = buildContractuellesRemunerationRows(allActivites, allOuvriers);

  const wsRemun = XLSX.utils.json_to_sheet(
    detailRemunerationsData.length > 0
      ? detailRemunerationsData
      : [{ 'Information': 'Aucune activité enregistrée pour cette sélection.' }]
  );
  XLSX.utils.book_append_sheet(wb, wsRemun, '3. Rémunérations');

  // -------------------------------------------------------------
  // FEUILLE 4 : RÉCAPITULATIF PAR SERRE
  // -------------------------------------------------------------
  const serreMap = new Map<string, { ouvriers: Set<string>; tachesCount: number; totalDH: number; domaine: string }>();
  allActivites.forEach((act) => {
    // Si l'activité a plusieurs serres, l'attribuer à chaque serre sélectionnée
    const serreNames = (Array.isArray(act.serres_noms) && act.serres_noms.length > 0)
      ? act.serres_noms
      : [act.serre_nom || act.serre_id || 'Serre Non Définie'];

    serreNames.forEach((sName) => {
      if (!serreMap.has(sName)) {
        serreMap.set(sName, {
          ouvriers: new Set<string>(),
          tachesCount: 0,
          totalDH: 0,
          domaine: act.domaine_id.replace('dom_', '').toUpperCase(),
        });
      }
      const entry = serreMap.get(sName)!;
      entry.ouvriers.add(act.ouvrier_id);
      entry.tachesCount += 1;
      // Note : répartition comptable par serre
      entry.totalDH = Math.round((entry.totalDH + act.montant_total / serreNames.length) * 100) / 100;
    });
  });

  const recapSerreData: any[] = [];
  serreMap.forEach((val, serreName) => {
    recapSerreData.push({
      'Serre': serreName,
      'Domaine': val.domaine,
      'Nombre d\'Ouvriers Distincts': val.ouvriers.size,
      'Nombre de Tâches': val.tachesCount,
      'Total Rémunération Estimé (DH)': val.totalDH,
    });
  });

  const wsSerre = XLSX.utils.json_to_sheet(
    recapSerreData.length > 0 ? recapSerreData : [{ 'Information': 'Aucune serre affectée.' }]
  );
  XLSX.utils.book_append_sheet(wb, wsSerre, '4. Récapitulatif Serres');

  // -------------------------------------------------------------
  // FEUILLE 5 : HISTORIQUE PAR OUVRIER
  // -------------------------------------------------------------
  const histoWorkerData = allOuvriers.map((ouvrier) => {
    const workerActs = allActivites.filter((a) => a.ouvrier_id === ouvrier.id);
    const workerTotalDH = workerActs.reduce((sum, a) => sum + (Number(a.montant_total) || 0), 0);
    const ptg = pointages.find((p) => p.ouvrier_id === ouvrier.id);
    const isPresent = ptg ? ptg.present : false;

    return {
      'Matricule': ouvrier.matricule,
      'Nom Complet': ouvrier.nom_complet,
      'Téléphone': ouvrier.telephone || '—',
      'Statut Jour': isPresent ? 'Présent' : 'Absent',
      'Nombre Tâches Aujourd\'hui': workerActs.length,
      'Mode Habituel': ouvrier.mode_remuneration,
      'Tarif Convenu (DH)': ouvrier.prix_convenu,
      'Total Rémunération Jour (DH)': Math.round(workerTotalDH * 100) / 100,
    };
  });
  const wsWorker = XLSX.utils.json_to_sheet(histoWorkerData);
  XLSX.utils.book_append_sheet(wb, wsWorker, '5. Historique Ouvrier');

  // Téléchargement du fichier
  const fileName = `contractuelles-lahcen-${dateFormatted}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
