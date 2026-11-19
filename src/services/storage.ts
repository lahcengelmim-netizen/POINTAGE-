/**
 * Service de stockage local persistant (Multi-Tenant)
 * Prêt pour une transition future vers une API ou base de données SQL/Firestore
 */

import {
  Company,
  Ouvrier,
  Tache,
  Pointage,
  Domaine,
  HeureSupplementaire,
  TacheSupplementaire,
  TypeSupplementaire,
  GazoilMouvement,
  GazoilConfig,
  GazoilMouvementType,
  AffectationTache,
  TacheSerreConfig,
  UserAccount,
  UserRole,
  Serre,
  RecolteEntry,
  RecolteOperationType,
  RecolteFilter,
  RecolteStats,
} from '../types';
import { formatTacheLabel } from '../utils/tacheUtils';
import { hashPassword, generateSalt, verifyPassword } from '../utils/crypto';
import { supabase } from './supabaseClient';
import {
  OUTBOX_KEYS,
  enqueueOutboxOp,
  getOutboxOps,
  dequeueOutboxOpsById,
  markOutboxOpsFailed,
  migrateLegacySyncQueue,
  mergeCollectionWithConflictLog,
  addDeleteTombstone,
} from './syncOutbox';

export const STORAGE_KEYS = {
  COMPANIES: 'agripointage_companies_v1',
  ACTIVE_COMPANY: 'agripointage_active_company_v1',
  DOMAINES: 'agripointage_domaines_v1',
  DEFAULT_DOMAINE: 'agripointage_default_domaine_v1',
  OUVRIERS: 'agripointage_ouvriers_v1',
  TACHES: 'agripointage_taches_v1',
  POINTAGES: 'agripointage_pointages_v1',
  AFFECTATIONS: 'agripointage_affectations_v1',
  TACHE_SERRES: 'agripointage_tache_serres_v1',
  HEURES_SUPP: 'agripointage_heures_supp_v1',
  TACHES_SUPP: 'agripointage_taches_supp_v1',
  GAZOIL_CONFIG: 'agripointage_gazoil_config_v1',
  GAZOIL_MOUVEMENTS: 'agripointage_gazoil_mouvements_v1',
  LAST_BACKUP_DATE: 'agripointage_last_backup_date_v1',
  // Nouveaux modules Récolte & Multi-comptes
  USERS: 'agripointage_users_v1',
  CURRENT_USER: 'agripointage_current_user_v1',
  SERRES: 'agripointage_serres_v1',
  RECOLTE: 'agripointage_recolte_v1',
  SYNC_QUEUE: 'agripointage_sync_queue_v1',
  POINTAGE_SYNC_QUEUE: 'agripointage_pointage_sync_queue_v1',
};

function resolveQueueForTable(table: string): string {
  const lower = String(table || '').toLowerCase();
  if (lower === 'pointages' || lower === 'affectations' || lower === 'tache_serres') {
    return OUTBOX_KEYS.POINTAGE;
  }
  if (lower.includes('recolte')) return OUTBOX_KEYS.RECOLTE;
  if (lower.includes('gazoil')) return OUTBOX_KEYS.GAZOIL;
  if (lower.includes('heure') || lower.includes('tache_supp')) return OUTBOX_KEYS.SUPPLEMENTAIRES;
  return OUTBOX_KEYS.REFERENTIELS;
}

function resolveEntityId(table: string, data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (data.id) return String(data.id);
  if (table === 'tache_serres') {
    return `${data.company_id || ''}__${data.date || ''}__${data.tache_id || ''}`;
  }
  if (table === 'gazoil_config' && data.company_id) {
    return `gz_cfg_${data.company_id}`;
  }
  return '';
}

export function addToPointageSyncQueue(
  table: string,
  data: any,
  action: 'upsert' | 'delete' = 'upsert'
) {
  try {
    enqueueOutboxOp(OUTBOX_KEYS.POINTAGE, {
      table,
      entityId: resolveEntityId(table, data),
      action,
      data,
      companyId: data?.company_id,
    });
  } catch (err) {
    console.error('Erreur addToPointageSyncQueue:', err);
  }
}

export function addToSyncQueue(
  table: string,
  data: any,
  action: 'upsert' | 'delete' = 'upsert'
) {
  try {
    const targetQueue = resolveQueueForTable(table);
    enqueueOutboxOp(targetQueue, {
      table,
      entityId: resolveEntityId(table, data),
      action,
      data,
      companyId: data?.company_id,
    });
  } catch (err) {
    console.error('Erreur addToSyncQueue:', err);
  }
}


// Serres Domaine D3 (7 serres : SERRE 16 à SERRE 22)
export const DEFAULT_D3_SERRES: Serre[] = [
  { id: 'serre_16', company_id: 'cie_lahcen_pointeur', code: 'S16', nom: 'SERRE 16', actif: true, ordre: 16, domaine_id: 'dom_d3' },
  { id: 'serre_17', company_id: 'cie_lahcen_pointeur', code: 'S17', nom: 'SERRE 17', actif: true, ordre: 17, domaine_id: 'dom_d3' },
  { id: 'serre_18', company_id: 'cie_lahcen_pointeur', code: 'S18', nom: 'SERRE 18', actif: true, ordre: 18, domaine_id: 'dom_d3' },
  { id: 'serre_19', company_id: 'cie_lahcen_pointeur', code: 'S19', nom: 'SERRE 19', actif: true, ordre: 19, domaine_id: 'dom_d3' },
  { id: 'serre_20', company_id: 'cie_lahcen_pointeur', code: 'S20', nom: 'SERRE 20', actif: true, ordre: 20, domaine_id: 'dom_d3' },
  { id: 'serre_21', company_id: 'cie_lahcen_pointeur', code: 'S21', nom: 'SERRE 21', actif: true, ordre: 21, domaine_id: 'dom_d3' },
  { id: 'serre_22', company_id: 'cie_lahcen_pointeur', code: 'S22', nom: 'SERRE 22', actif: true, ordre: 22, domaine_id: 'dom_d3' },
];

// Serres Domaine D5 (20 serres : SERRE 23 à SERRE 42)
export const DEFAULT_D5_SERRES: Serre[] = [
  { id: 'serre_d5_23', company_id: 'cie_lahcen_pointeur', code: 'D5-S23', nom: 'SERRE 23', actif: true, ordre: 23, domaine_id: 'dom_d5' },
  { id: 'serre_d5_24', company_id: 'cie_lahcen_pointeur', code: 'D5-S24', nom: 'SERRE 24', actif: true, ordre: 24, domaine_id: 'dom_d5' },
  { id: 'serre_d5_25', company_id: 'cie_lahcen_pointeur', code: 'D5-S25', nom: 'SERRE 25', actif: true, ordre: 25, domaine_id: 'dom_d5' },
  { id: 'serre_d5_26', company_id: 'cie_lahcen_pointeur', code: 'D5-S26', nom: 'SERRE 26', actif: true, ordre: 26, domaine_id: 'dom_d5' },
  { id: 'serre_d5_27', company_id: 'cie_lahcen_pointeur', code: 'D5-S27', nom: 'SERRE 27', actif: true, ordre: 27, domaine_id: 'dom_d5' },
  { id: 'serre_d5_28', company_id: 'cie_lahcen_pointeur', code: 'D5-S28', nom: 'SERRE 28', actif: true, ordre: 28, domaine_id: 'dom_d5' },
  { id: 'serre_d5_29', company_id: 'cie_lahcen_pointeur', code: 'D5-S29', nom: 'SERRE 29', actif: true, ordre: 29, domaine_id: 'dom_d5' },
  { id: 'serre_d5_30', company_id: 'cie_lahcen_pointeur', code: 'D5-S30', nom: 'SERRE 30', actif: true, ordre: 30, domaine_id: 'dom_d5' },
  { id: 'serre_d5_31', company_id: 'cie_lahcen_pointeur', code: 'D5-S31', nom: 'SERRE 31', actif: true, ordre: 31, domaine_id: 'dom_d5' },
  { id: 'serre_d5_32', company_id: 'cie_lahcen_pointeur', code: 'D5-S32', nom: 'SERRE 32', actif: true, ordre: 32, domaine_id: 'dom_d5' },
  { id: 'serre_d5_33', company_id: 'cie_lahcen_pointeur', code: 'D5-S33', nom: 'SERRE 33', actif: true, ordre: 33, domaine_id: 'dom_d5' },
  { id: 'serre_d5_34', company_id: 'cie_lahcen_pointeur', code: 'D5-S34', nom: 'SERRE 34', actif: true, ordre: 34, domaine_id: 'dom_d5' },
  { id: 'serre_d5_35', company_id: 'cie_lahcen_pointeur', code: 'D5-S35', nom: 'SERRE 35', actif: true, ordre: 35, domaine_id: 'dom_d5' },
  { id: 'serre_d5_36', company_id: 'cie_lahcen_pointeur', code: 'D5-S36', nom: 'SERRE 36', actif: true, ordre: 36, domaine_id: 'dom_d5' },
  { id: 'serre_d5_37', company_id: 'cie_lahcen_pointeur', code: 'D5-S37', nom: 'SERRE 37', actif: true, ordre: 37, domaine_id: 'dom_d5' },
  { id: 'serre_d5_38', company_id: 'cie_lahcen_pointeur', code: 'D5-S38', nom: 'SERRE 38', actif: true, ordre: 38, domaine_id: 'dom_d5' },
  { id: 'serre_d5_39', company_id: 'cie_lahcen_pointeur', code: 'D5-S39', nom: 'SERRE 39', actif: true, ordre: 39, domaine_id: 'dom_d5' },
  { id: 'serre_d5_40', company_id: 'cie_lahcen_pointeur', code: 'D5-S40', nom: 'SERRE 40', actif: true, ordre: 40, domaine_id: 'dom_d5' },
  { id: 'serre_d5_41', company_id: 'cie_lahcen_pointeur', code: 'D5-S41', nom: 'SERRE 41', actif: true, ordre: 41, domaine_id: 'dom_d5' },
  { id: 'serre_d5_42', company_id: 'cie_lahcen_pointeur', code: 'D5-S42', nom: 'SERRE 42', actif: true, ordre: 42, domaine_id: 'dom_d5' },
];

// Serres par défaut (configurables par l'administrateur)
export const DEFAULT_SERRES: Serre[] = [
  { id: 'serre_1', company_id: 'cie_lahcen_pointeur', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' },
  { id: 'serre_2', company_id: 'cie_lahcen_pointeur', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' },
  { id: 'serre_3', company_id: 'cie_lahcen_pointeur', code: 'S03', nom: 'Serre 3', actif: true, ordre: 3, domaine_id: 'dom_d2' },
  { id: 'serre_4', company_id: 'cie_lahcen_pointeur', code: 'S04', nom: 'Serre 4', actif: true, ordre: 4, domaine_id: 'dom_d2' },
  { id: 'serre_5', company_id: 'cie_lahcen_pointeur', code: 'S05', nom: 'Serre 5', actif: true, ordre: 5, domaine_id: 'dom_d2' },
  { id: 'serre_6', company_id: 'cie_lahcen_pointeur', code: 'S06', nom: 'Serre 6', actif: true, ordre: 6, domaine_id: 'dom_d2' },
  { id: 'serre_7', company_id: 'cie_lahcen_pointeur', code: 'S07', nom: 'Serre 7', actif: true, ordre: 7, domaine_id: 'dom_d2' },
  { id: 'serre_8', company_id: 'cie_lahcen_pointeur', code: 'S08', nom: 'Serre 8', actif: true, ordre: 8, domaine_id: 'dom_d2' },
  { id: 'serre_9', company_id: 'cie_lahcen_pointeur', code: 'S09', nom: 'Serre 9', actif: true, ordre: 9, domaine_id: 'dom_d2' },
  { id: 'serre_10', company_id: 'cie_lahcen_pointeur', code: 'S10', nom: 'Serre 10', actif: true, ordre: 10, domaine_id: 'dom_d2' },
  { id: 'serre_11', company_id: 'cie_lahcen_pointeur', code: 'S11', nom: 'Serre 11', actif: true, ordre: 11, domaine_id: 'dom_d2' },
  { id: 'serre_12', company_id: 'cie_lahcen_pointeur', code: 'S12', nom: 'Serre 12', actif: true, ordre: 12, domaine_id: 'dom_d2' },
  { id: 'serre_13', company_id: 'cie_lahcen_pointeur', code: 'S13', nom: 'Serre 13', actif: true, ordre: 13, domaine_id: 'dom_d2' },
  { id: 'serre_14', company_id: 'cie_lahcen_pointeur', code: 'S14', nom: 'Serre 14', actif: true, ordre: 14, domaine_id: 'dom_d2' },
  { id: 'serre_15', company_id: 'cie_lahcen_pointeur', code: 'S15', nom: 'Serre 15', actif: true, ordre: 15, domaine_id: 'dom_d2' },
  ...DEFAULT_D3_SERRES,
  ...DEFAULT_D5_SERRES,
];

// export const DEFAULT_ADMIN_USER: UserAccount = {
//   id: 'usr_admin',
//   username: 'admin',
//   nom: 'Lahcen (Administrateur)',
//   role: 'admin',
//   passwordHash: 'b61978d5f5026f767bf462b4c46df078be576284c51b29a890d0725178a9d3c6', // 'admin123'
//   salt: 'lahcen_salt_admin',
//   actif: true,
//   createdAt: '2026-01-01T00:00:00.000Z',
// };
//
// export const DEFAULT_CAPORAL_USER: UserAccount = {
//   id: 'usr_caporal_1',
//   username: 'caporal1',
//   nom: 'Brahim (Caporal)',
//   role: 'caporal',
//   passwordHash: '60efbfa0610f5678397a76dcbfbba1f59bc5db9962e4f5e4c4fe995a982943dc', // 'caporal123'
//   salt: 'lahcen_salt_caporal',
//   actif: true,
//   createdAt: '2026-01-01T00:00:00.000Z',
// };
export const GUEST_USER: UserAccount = {
  id: 'usr_guest',
  username: 'guest',
  nom: 'Invité',
  role: 'admin',
  company_id: 'cie_lahcen_pointeur',
  passwordHash: '',
  salt: '',
  actif: true,
  createdAt: new Date().toISOString(),
};

// Domaines par défaut (Ordre spécifié : D2, D3, D5, D1, D4)
export const DEFAULT_DOMAINES: Domaine[] = [
  { id: 'dom_d2', nom: 'D2', ordre: 1 },
  { id: 'dom_d3', nom: 'D3', ordre: 2 },
  { id: 'dom_d5', nom: 'D5', ordre: 3 },
  { id: 'dom_d1', nom: 'D1', ordre: 4 },
  { id: 'dom_d4', nom: 'D4', ordre: 5 },
];
export const DEFAULT_DOMAINE_ID = 'dom_d2';

// Données initiales par défaut
const DEFAULT_COMPANY: Company = {
  id: 'cie_lahcen_pointeur',
  nom: 'Lahcen Pointeur',
  code: 'LAHCEN',
  ville: 'Exploitation',
  createdAt: new Date().toISOString(),
};

const DEFAULT_OUVRIERS: Ouvrier[] = [
  { id: 'ouv_1', company_id: 'cie_lahcen_pointeur', numero: 1, nom: 'Mohammed Amine', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_2', company_id: 'cie_lahcen_pointeur', numero: 2, nom: 'Fatima Zahra', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_3', company_id: 'cie_lahcen_pointeur', numero: 3, nom: 'Youssef El Idrissi', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_4', company_id: 'cie_lahcen_pointeur', numero: 4, nom: 'Hassan Benali', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_5', company_id: 'cie_lahcen_pointeur', numero: 5, nom: 'Khadija Mansouri', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_6', company_id: 'cie_lahcen_pointeur', numero: 6, nom: 'Brahim Oukacha', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_7', company_id: 'cie_lahcen_pointeur', numero: 7, nom: 'Aïcha Tazi', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_8', company_id: 'cie_lahcen_pointeur', numero: 8, nom: 'Omar Naciri', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_9', company_id: 'cie_lahcen_pointeur', numero: 9, nom: 'Salma Daoudi', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_10', company_id: 'cie_lahcen_pointeur', numero: 10, nom: 'Khalid Berrada', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_11', company_id: 'cie_lahcen_pointeur', numero: 11, nom: 'Zineb Alaoui', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_12', company_id: 'cie_lahcen_pointeur', numero: 12, nom: 'Mustapha Chaoui', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_13', company_id: 'cie_lahcen_pointeur', numero: 13, nom: 'Nadia El Fassi', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_14', company_id: 'cie_lahcen_pointeur', numero: 14, nom: 'Rachid Bouzid', actif: true, createdAt: new Date().toISOString() },
  { id: 'ouv_15', company_id: 'cie_lahcen_pointeur', numero: 15, nom: 'Samira Bennani', actif: true, createdAt: new Date().toISOString() },
];

const DEFAULT_TACHES: Tache[] = [
  { id: 'tch_instable', company_id: 'cie_lahcen_pointeur', code: 'INS01', nom: 'INSTABLE', couleur: '#16a34a', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_stationnaire', company_id: 'cie_lahcen_pointeur', code: 'STA01', nom: 'STATIONNAIRE', couleur: '#0284c7', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_ebourgeonnage_d5', company_id: 'cie_lahcen_pointeur', code: 'EBD05', nom: 'ÉBOURGEONNAGE D5', couleur: '#ea580c', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_traitement_phyto', company_id: 'cie_lahcen_pointeur', code: 'PHY01', nom: 'TRAITEMENT PHYTO', couleur: '#dc2626', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_recolte', company_id: 'cie_lahcen_pointeur', code: 'R01', nom: 'RECOLTE', couleur: '#16a34a', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_effeuillage', company_id: 'cie_lahcen_pointeur', code: 'E01', nom: 'EFFEUILLAGE', couleur: '#2563eb', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_entretien', company_id: 'cie_lahcen_pointeur', code: 'EN01', nom: 'ENTRETIEN', couleur: '#d97706', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
  { id: 'tch_plantation', company_id: 'cie_lahcen_pointeur', code: 'P01', nom: 'PLANTATION', couleur: '#7c3aed', ouvriers_autorises: 'tous', createdAt: new Date().toISOString() },
];

// Système simple d'abonnements pour mettre à jour les composants React en temps réel
type StorageListener = () => void;
const listeners: Set<StorageListener> = new Set();

export function subscribeToStorage(listener: StorageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.error('Erreur notification stockage', e);
    }
  });
}

// Gestion des erreurs de quota de stockage
let quotaErrorMessage: string | null = null;

export function getStorageQuotaError(): string | null {
  return quotaErrorMessage;
}

export function clearStorageQuotaError(): void {
  quotaErrorMessage = null;
  notifyListeners();
}

/**
 * Écriture sécurisée dans localStorage avec détection et signalement des erreurs de quota
 */
export function safeSetItem(key: string, value: string): { success: boolean; error?: string } {
  try {
    localStorage.setItem(key, value);
    if (quotaErrorMessage) {
      quotaErrorMessage = null;
    }
    return { success: true };
  } catch (err: unknown) {
    console.error(`Erreur d'écriture dans le stockage pour la clé ${key}:`, err);
    let msg = 'Erreur lors de l\'enregistrement des données.';
    const isQuota =
      err instanceof DOMException &&
      (err.code === 22 ||
        err.code === 1014 ||
        err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED');

    if (isQuota) {
      msg = 'Espace de stockage local saturé sur votre appareil. Veuillez exporter une sauvegarde JSON et libérer de la mémoire.';
      quotaErrorMessage = msg;
    } else if (err instanceof Error) {
      msg = `Erreur de stockage: ${err.message}`;
    }
    notifyListeners();
    return { success: false, error: msg };
  }
}

function isAnomalousDuplicateSerre23(s: Partial<Serre> | null | undefined): boolean {
  if (!s || s.id !== 'serre_23') return false;
  const dom = (s.domaine_id || '').trim().toLowerCase();
  const code = (s.code || '').trim().toUpperCase();
  return !dom || dom === 'dom_d3' || code === 'S23';
}

function migrateLegacySerre23References(): void {
  const replaceSerreIdToken = (val?: string | null): { next: string | null | undefined; changed: boolean } => {
    if (!val || !val.includes('serre_23')) return { next: val, changed: false };
    const tokens = val
      .split(',')
      .map((part) => (part.trim() === 'serre_23' ? 'serre_d5_23' : part.trim()))
      .filter(Boolean);
    const deduped = Array.from(new Set(tokens));
    const joined = deduped.join(',');
    return { next: joined, changed: joined !== val };
  };

  // 1. Pointages, Récoltes, Heures Sup, Tâches Sup
  const singleKeys = [
    STORAGE_KEYS.POINTAGES,
    STORAGE_KEYS.RECOLTE,
    STORAGE_KEYS.HEURES_SUPP,
    STORAGE_KEYS.TACHES_SUPP,
  ];
  singleKeys.forEach((key) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw || !raw.includes('serre_23')) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      let changed = false;
      const nextList = list.map((item: any) => {
        if (item && item.serre_id === 'serre_23') {
          changed = true;
          return {
            ...item,
            serre_id: 'serre_d5_23',
            ...(item.serre_nom !== undefined ? { serre_nom: item.serre_nom || 'SERRE 23' } : {}),
          };
        }
        return item;
      });
      if (changed) safeSetItem(key, JSON.stringify(nextList));
    } catch {
      // ignore
    }
  });

  // 2. Affectations (serre_id possiblement multi-valeurs + serres_ids)
  try {
    const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    if (rawAff && rawAff.includes('serre_23')) {
      const affs = JSON.parse(rawAff);
      if (Array.isArray(affs)) {
        let changed = false;
        const nextAffs = affs.map((a: any) => {
          if (!a) return a;
          let itemChanged = false;
          const updated = { ...a };
          const resStr = replaceSerreIdToken(a.serre_id);
          if (resStr.changed) {
            updated.serre_id = resStr.next;
            itemChanged = true;
          }
          if (Array.isArray(a.serres_ids) && a.serres_ids.includes('serre_23')) {
            updated.serres_ids = Array.from(
              new Set(a.serres_ids.map((id: string) => (id === 'serre_23' ? 'serre_d5_23' : id)))
            );
            itemChanged = true;
          }
          if (itemChanged) changed = true;
          return updated;
        });
        if (changed) safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(nextAffs));
      }
    }
  } catch {
    // ignore
  }

  // 3. TacheSerreConfig (serre_ids[])
  try {
    const rawTs = localStorage.getItem(STORAGE_KEYS.TACHE_SERRES);
    if (rawTs && rawTs.includes('serre_23')) {
      const configs = JSON.parse(rawTs);
      if (Array.isArray(configs)) {
        let changed = false;
        const nextConfigs = configs.map((c: any) => {
          if (c && Array.isArray(c.serre_ids) && c.serre_ids.includes('serre_23')) {
            changed = true;
            return {
              ...c,
              serre_ids: Array.from(
                new Set(c.serre_ids.map((id: string) => (id === 'serre_23' ? 'serre_d5_23' : id)))
              ),
            };
          }
          return c;
        });
        if (changed) safeSetItem(STORAGE_KEYS.TACHE_SERRES, JSON.stringify(nextConfigs));
      }
    }
  } catch {
    // ignore
  }
}

// Initialisation idempotente
export function initStorage(): void {
  try {
    const storedCompanies = localStorage.getItem(STORAGE_KEYS.COMPANIES);
    if (!storedCompanies) {
      safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify([DEFAULT_COMPANY]));
    } else if (storedCompanies.includes('Domaine Al Baraka')) {
      const cleaned = storedCompanies.replaceAll('Domaine Al Baraka', 'Lahcen Pointeur');
      safeSetItem(STORAGE_KEYS.COMPANIES, cleaned);
    }
    const activeCie = localStorage.getItem(STORAGE_KEYS.ACTIVE_COMPANY);
    if (!activeCie || activeCie === 'cie_al_baraka') {
      safeSetItem(STORAGE_KEYS.ACTIVE_COMPANY, DEFAULT_COMPANY.id);
    }
    const storedOuvriers = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
    if (storedOuvriers && storedOuvriers.includes('cie_al_baraka')) {
      safeSetItem(STORAGE_KEYS.OUVRIERS, storedOuvriers.replaceAll('cie_al_baraka', DEFAULT_COMPANY.id));
    }
    const storedTaches = localStorage.getItem(STORAGE_KEYS.TACHES);
    if (storedTaches && storedTaches.includes('cie_al_baraka')) {
      safeSetItem(STORAGE_KEYS.TACHES, storedTaches.replaceAll('cie_al_baraka', DEFAULT_COMPANY.id));
    }
    if (!localStorage.getItem(STORAGE_KEYS.OUVRIERS)) {
      safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(DEFAULT_OUVRIERS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.TACHES)) {
      safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(DEFAULT_TACHES));
    } else {
      // Migration douce : attribuer un code par défaut aux 4 tâches standard si absent
      try {
        const parsedTaches: Tache[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.TACHES) || '[]');
        let updated = false;
        parsedTaches.forEach((t) => {
          if (!t.code) {
            if (t.nom === 'RECOLTE') { t.code = 'R01'; updated = true; }
            else if (t.nom === 'EFFEUILLAGE') { t.code = 'E01'; updated = true; }
            else if (t.nom === 'ENTRETIEN') { t.code = 'EN01'; updated = true; }
            else if (t.nom === 'PLANTATION') { t.code = 'P01'; updated = true; }
            else if (t.nom === 'STATIONNAIRE') { t.code = 'STA01'; updated = true; }
            else if (t.nom === 'ÉBOURGEONNAGE D5') { t.code = 'EBD05'; updated = true; }
            else if (t.nom === 'TRAITEMENT PHYTO') { t.code = 'PHY01'; updated = true; }
            else if (t.nom === 'INSTABLE') { t.code = 'INS01'; updated = true; }
          }
        });

        // Assurer la présence des tâches officielles du barème pour la société active
        const existingNames = new Set(parsedTaches.map((t) => t.nom.toUpperCase().trim()));
        const financialDefaults = [
          { id: 'tch_stationnaire', company_id: DEFAULT_COMPANY.id, code: 'STA01', nom: 'STATIONNAIRE', couleur: '#0284c7', ouvriers_autorises: 'tous' as const, createdAt: new Date().toISOString() },
          { id: 'tch_ebourgeonnage_d5', company_id: DEFAULT_COMPANY.id, code: 'EBD05', nom: 'ÉBOURGEONNAGE D5', couleur: '#ea580c', ouvriers_autorises: 'tous' as const, createdAt: new Date().toISOString() },
          { id: 'tch_traitement_phyto', company_id: DEFAULT_COMPANY.id, code: 'PHY01', nom: 'TRAITEMENT PHYTO', couleur: '#dc2626', ouvriers_autorises: 'tous' as const, createdAt: new Date().toISOString() },
          { id: 'tch_instable', company_id: DEFAULT_COMPANY.id, code: 'INS01', nom: 'INSTABLE', couleur: '#16a34a', ouvriers_autorises: 'tous' as const, createdAt: new Date().toISOString() },
        ];
        financialDefaults.forEach((def) => {
          if (!existingNames.has(def.nom)) {
            parsedTaches.push(def);
            updated = true;
          }
        });

        if (updated) {
          safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(parsedTaches));
        }
      } catch {
        // ignore
      }
    }
    if (!localStorage.getItem(STORAGE_KEYS.DOMAINES)) {
      safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(DEFAULT_DOMAINES));
    }
    if (!localStorage.getItem(STORAGE_KEYS.DEFAULT_DOMAINE)) {
      safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, DEFAULT_DOMAINE_ID);
    }
    if (!localStorage.getItem(STORAGE_KEYS.POINTAGES)) {
      safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.AFFECTATIONS)) {
      safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify([]));
    }
    // MULTI-TÂCHES & MULTI-SERRES : Un ouvrier peut avoir plusieurs tâches avec chacune sa serre dans la journée.
    // Migration douce sans perte de données + synchronisation rétrocompatible avec POINTAGES
    try {
      const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
      const affs: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
      const rawPtgs = localStorage.getItem(STORAGE_KEYS.POINTAGES);
      const ptgs: Pointage[] = rawPtgs ? JSON.parse(rawPtgs) : [];

      // 1. Conserver toutes les affectations valides (uniquement filtrer les doublons d'id exacts)
      const cleanAffs: AffectationTache[] = [];
      const seenAffIds = new Set<string>();
      const workersWithAffs = new Set<string>();

      affs.forEach((a) => {
        if (a && a.id && a.tache_id && !seenAffIds.has(a.id)) {
          seenAffIds.add(a.id);
          workersWithAffs.add(`${a.company_id}_${a.date}_${a.ouvrier_id}`);
          cleanAffs.push(a);
        }
      });

      // 2. Synchroniser les pointages anciens ayant tache_id vers cleanAffs uniquement si l'ouvrier n'a pas encore d'affectation ce jour-là
      let affsModified = cleanAffs.length !== affs.length;
      ptgs.forEach((p) => {
        if (p.tache_id && p.present !== false) {
          const key = `${p.company_id}_${p.date}_${p.ouvrier_id}`;
          if (!workersWithAffs.has(key)) {
            workersWithAffs.add(key);
            cleanAffs.push({
              id: `aff_sync_${p.id}`,
              company_id: p.company_id,
              ouvrier_id: p.ouvrier_id,
              numero_ouvrier: p.numero_ouvrier,
              tache_id: p.tache_id,
              domaine_id: p.domaine_id,
              serre_id: p.serre_id || null,
              serre_nom: p.serre_nom || null,
              date: p.date,
              timestamp: p.timestamp || Date.now(),
            });
            affsModified = true;
          }
        }
      });

      // 3. Aligner pointages.tache_id sur la première affectation active pour rétrocompatibilité (sans jamais supprimer les autres affectations)
      const firstAffMap = new Map<string, string>();
      cleanAffs.forEach((a) => {
        const key = `${a.company_id}_${a.date}_${a.ouvrier_id}`;
        if (!firstAffMap.has(key)) {
          firstAffMap.set(key, a.tache_id);
        }
      });

      let ptgsModified = false;
      ptgs.forEach((p) => {
        const key = `${p.company_id}_${p.date}_${p.ouvrier_id}`;
        const firstTacheId = firstAffMap.get(key) || null;
        if (p.tache_id !== firstTacheId) {
          p.tache_id = firstTacheId;
          ptgsModified = true;
        }
      });

      if (affsModified) {
        safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(cleanAffs));
      }
      if (ptgsModified) {
        safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(ptgs));
      }
    } catch {
      // ignore
    }
    if (!localStorage.getItem(STORAGE_KEYS.HEURES_SUPP)) {
      safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.GAZOIL_CONFIG)) {
      safeSetItem(STORAGE_KEYS.GAZOIL_CONFIG, JSON.stringify({}));
    }
    if (!localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS)) {
      safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify([]));
    }
    // if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
    //   safeSetItem(STORAGE_KEYS.USERS, JSON.stringify([DEFAULT_ADMIN_USER, DEFAULT_CAPORAL_USER]));
    // }
    // if (!localStorage.getItem(STORAGE_KEYS.CURRENT_USER)) {
    //   safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(DEFAULT_ADMIN_USER));
    // }
    if (!localStorage.getItem(STORAGE_KEYS.TACHE_SERRES)) {
      safeSetItem(STORAGE_KEYS.TACHE_SERRES, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SERRES)) {
      safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(DEFAULT_SERRES));
    } else {
      // Migration idempotente vers la configuration officielle 42 serres :
      // D2 (15 serres: 1..15), D3 (7 serres: 16..22), D5 (20 serres: 23..42).
      // Supprime uniquement le doublon erroné serre_23 dans D3 et conserve toute serre personnalisée.
      try {
        const parsedSerres: Serre[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.SERRES) || '[]');
        let serresUpdated = false;
        const canonicalById = new Map(DEFAULT_SERRES.map((s) => [s.id, s]));

        // 1. Retirer l'enregistrement erroné serre_23 de D3, éliminer les doublons de D2 (serre 1..15) et normaliser domaine_id/ordre
        const cleanedSerres: Serre[] = [];
        const seenD2Numbers = new Set<number>();
        const seenIds = new Set<string>();

        for (const s of parsedSerres) {
          if (isAnomalousDuplicateSerre23(s)) {
            serresUpdated = true;
            continue;
          }
          if (seenIds.has(s.id)) {
            serresUpdated = true;
            continue;
          }
          seenIds.add(s.id);

          const dom = (s.domaine_id || 'dom_d2').trim().toLowerCase();
          if (dom === 'dom_d2' || dom === 'd2') {
            const nameNorm = (s.nom || '').trim().toUpperCase();
            const codeNorm = (s.code || '').trim().toUpperCase();
            const matchNum = nameNorm.match(/SERRE\s*(\d+)/) || codeNorm.match(/S0*(\d+)/);
            if (matchNum) {
              const num = parseInt(matchNum[1], 10);
              if (num >= 1 && num <= 15) {
                if (seenD2Numbers.has(num)) {
                  serresUpdated = true;
                  continue; // Skip duplicate D2 serre number
                }
                seenD2Numbers.add(num);
              }
            }
          }

          const canon = canonicalById.get(s.id);
          if (canon) {
            const needsDomaineFix = !s.domaine_id || (canon.domaine_id && s.domaine_id !== canon.domaine_id);
            const needsOrdreFix = s.ordre !== canon.ordre;
            if (needsDomaineFix || needsOrdreFix) {
              cleanedSerres.push({
                ...s,
                domaine_id: canon.domaine_id,
                ordre: canon.ordre,
              });
              serresUpdated = true;
              continue;
            }
          }
          cleanedSerres.push(s);
        }

        // 2. Injecter les serres canoniques manquantes (D2, D3, D5) sans créer de doublons
        DEFAULT_SERRES.forEach((defSerre) => {
          const targetDom = (defSerre.domaine_id || '').trim().toLowerCase();
          const exists = cleanedSerres.some((s) => {
            if (s.id === defSerre.id) return true;
            const sDom = (s.domaine_id || '').trim().toLowerCase();
            return (
              sDom === targetDom &&
              (s.code.trim().toUpperCase() === defSerre.code.toUpperCase() ||
                s.nom.trim().toUpperCase() === defSerre.nom.toUpperCase())
            );
          });
          if (!exists) {
            cleanedSerres.push(defSerre);
            serresUpdated = true;
          }
        });

        if (serresUpdated) {
          cleanedSerres.sort((a, b) => a.ordre - b.ordre);
          safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(cleanedSerres));
        }
      } catch {
        // ignore
      }
    }
    migrateLegacySerre23References();
    if (!localStorage.getItem(STORAGE_KEYS.RECOLTE)) {
      safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE)) {
      safeSetItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify([]));
    }
    migrateLegacySyncQueue();
  } catch (error) {
    console.error('Erreur lors de l\'initialisation du stockage:', error);
  }
}

// ------------------------- SOCIÉTÉS (MULTI-TENANT) -------------------------

export function getCompanies(): Company[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANIES);
    return raw ? JSON.parse(raw) : [DEFAULT_COMPANY];
  } catch {
    return [DEFAULT_COMPANY];
  }
}

export function getActiveCompanyId(): string {
  initStorage();
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_COMPANY) || DEFAULT_COMPANY.id;
}

export function setActiveCompanyId(companyId: string): void {
  safeSetItem(STORAGE_KEYS.ACTIVE_COMPANY, companyId);
  notifyListeners();
}

export function saveCompany(company: Partial<Company> & { nom: string }): Company {
  const list = getCompanies();
  const id = company.id || `cie_${Date.now()}`;
  const code = (company.code || company.nom.slice(0, 6)).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const existingIdx = list.findIndex((c) => c.id === id);

  const updated: Company = {
    id,
    nom: company.nom.trim(),
    code: code || 'DOM',
    ville: company.ville?.trim() || '',
    createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    list[existingIdx] = updated;
  } else {
    list.push(updated);
  }

  safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify(list));
  addToSyncQueue('companies', updated, 'upsert');
  notifyListeners();
  return updated;
}

// ------------------------- DOMAINES (D1 à D5) -------------------------

export function getDomaines(): Domaine[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DOMAINES);
    const list: Domaine[] = raw ? JSON.parse(raw) : DEFAULT_DOMAINES;
    return list.sort((a, b) => a.ordre - b.ordre);
  } catch {
    return DEFAULT_DOMAINES;
  }
}

export function getDefaultDomaineId(): string {
  initStorage();
  const id = localStorage.getItem(STORAGE_KEYS.DEFAULT_DOMAINE);
  if (id) {
    const list = getDomaines();
    if (list.some((d) => d.id === id)) return id;
  }
  return DEFAULT_DOMAINE_ID;
}

export function setDefaultDomaineId(id: string): void {
  initStorage();
  safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, id);
  notifyListeners();
}

export function saveDomaine(dom: { id?: string; nom: string; ordre?: number }): Domaine {
  initStorage();
  const list = getDomaines();
  const nomClean = dom.nom.trim();
  const id = dom.id || `dom_${Date.now()}`;
  const existingIdx = list.findIndex((d) => d.id === id);

  const maxOrdre = list.reduce((max, d) => Math.max(max, d.ordre), 0);
  const ordre =
    dom.ordre !== undefined ? dom.ordre : existingIdx >= 0 ? list[existingIdx].ordre : maxOrdre + 1;

  const updated: Domaine = {
    id,
    nom: nomClean || `D${list.length + 1}`,
    ordre,
  };

  if (existingIdx >= 0) {
    list[existingIdx] = updated;
  } else {
    list.push(updated);
  }

  safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(list));
  addToSyncQueue('domaines', { ...updated, company_id: getActiveCompanyId() }, 'upsert');
  notifyListeners();
  return updated;
}

export function updateDomainesOrder(domaines: Domaine[]): void {
  initStorage();
  const companyId = getActiveCompanyId();
  const updated = domaines.map((d, index) => ({
    ...d,
    ordre: index + 1,
  }));
  safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(updated));
  updated.forEach((d) => addToSyncQueue('domaines', { ...d, company_id: companyId }, 'upsert'));
  notifyListeners();
}

export function deleteDomaine(id: string): { success: boolean; error?: string } {
  initStorage();
  let list = getDomaines();
  if (list.length <= 1) {
    return {
      success: false,
      error: 'Impossible de supprimer : au moins un domaine doit rester configuré.',
    };
  }
  list = list.filter((d) => d.id !== id);
  safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(list));

  const defId = localStorage.getItem(STORAGE_KEYS.DEFAULT_DOMAINE);
  if (defId === id && list.length > 0) {
    safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, list[0].id);
  }

  addToSyncQueue('domaines', { id, company_id: getActiveCompanyId() }, 'delete');
  notifyListeners();
  return { success: true };
}

// ------------------------- OUVRIERS -------------------------

export function getOuvriers(companyId: string): Ouvrier[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
    const all: Ouvrier[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((o) => o.company_id === companyId)
      .sort((a, b) => a.numero - b.numero);
  } catch {
    return [];
  }
}

export function getActiveOuvriers(companyId: string): Ouvrier[] {
  return getOuvriers(companyId).filter((o) => o.actif);
}

export function getOuvrierByNumero(companyId: string, numero: number): Ouvrier | undefined {
  const activeWorkers = getActiveOuvriers(companyId);
  return activeWorkers.find((o) => o.numero === numero);
}

export interface SaveOuvrierResult {
  success: boolean;
  ouvrier?: Ouvrier;
  error?: string;
}

export function saveOuvrier(
  companyId: string,
  ouvrierData: { id?: string; numero: number; nom: string; actif?: boolean; telephone?: string; updated_at?: string }
): SaveOuvrierResult {
  const allRaw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
  const all: Ouvrier[] = allRaw ? JSON.parse(allRaw) : [];

  const numero = Number(ouvrierData.numero);
  if (!numero || isNaN(numero) || numero <= 0) {
    return { success: false, error: 'Le numéro doit être un entier positif (ex: 1, 2, 3...)' };
  }

  if (!ouvrierData.nom.trim()) {
    return { success: false, error: 'Le nom de l\'ouvrier est obligatoire' };
  }

  // Vérification de l'unicité du numéro au sein de la même société
  const duplicate = all.find(
    (o) => o.company_id === companyId && o.numero === numero && o.id !== ouvrierData.id
  );
  if (duplicate) {
    return {
      success: false,
      error: `Le numéro ${numero} est déjà attribué à "${duplicate.nom}" dans cette société.`,
    };
  }

  const id = ouvrierData.id || `ouv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const existingIdx = all.findIndex((o) => o.id === id);

  const updated: Ouvrier = {
    id,
    company_id: companyId,
    numero,
    nom: ouvrierData.nom.trim(),
    actif: ouvrierData.actif !== undefined ? ouvrierData.actif : true,
    telephone: ouvrierData.telephone?.trim() || undefined,
    createdAt: existingIdx >= 0 ? all[existingIdx].createdAt : new Date().toISOString(),
    updated_at: ouvrierData.updated_at || new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    all[existingIdx] = updated;
  } else {
    all.push(updated);
  }

  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(all));
  addToSyncQueue('ouvriers', updated);
  notifyListeners();
  return { success: true, ouvrier: updated };
}

export function toggleOuvrierActif(id: string): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
  const all: Ouvrier[] = allRaw ? JSON.parse(allRaw) : [];
  const idx = all.findIndex((o) => o.id === id);
  if (idx >= 0) {
    all[idx].actif = !all[idx].actif;
    safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(all));
    addToSyncQueue('ouvriers', all[idx], 'upsert');
    notifyListeners();
  }
}

export function deleteOuvrier(id: string): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
  let all: Ouvrier[] = allRaw ? JSON.parse(allRaw) : [];
  const target = all.find((o) => o.id === id);
  all = all.filter((o) => o.id !== id);
  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(all));
  addToSyncQueue('ouvriers', { id, company_id: target?.company_id || getActiveCompanyId() }, 'delete');
  notifyListeners();
}

export function bulkImportOuvriers(
  companyId: string,
  ouvriersAImporter: Array<{ numero: number; nom: string; telephone?: string }>,
  replaceList: boolean = false
): { addedCount: number; updatedCount: number; deactivatedCount: number } {
  initStorage();
  const allRaw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
  const all: Ouvrier[] = allRaw ? JSON.parse(allRaw) : [];

  let addedCount = 0;
  let updatedCount = 0;
  let deactivatedCount = 0;
  const touched: Ouvrier[] = [];

  const importedNums = new Set(ouvriersAImporter.map((item) => item.numero));

  if (replaceList) {
    // Remplacement : Désactiver les ouvriers existants absents du nouveau fichier
    all.forEach((o) => {
      if (o.company_id === companyId) {
        if (!importedNums.has(o.numero)) {
          if (o.actif) {
            o.actif = false;
            deactivatedCount++;
            touched.push(o);
          }
        }
      }
    });
  }

  ouvriersAImporter.forEach((item, index) => {
    const existing = all.find((o) => o.company_id === companyId && o.numero === item.numero);
    if (existing) {
      existing.nom = item.nom.trim();
      if (item.telephone) existing.telephone = item.telephone.trim();
      existing.actif = true; // Réactiver s'il était désactivé
      updatedCount++;
      touched.push(existing);
    } else {
      const id = `ouv_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 6)}`;
      const created: Ouvrier = {
        id,
        company_id: companyId,
        numero: item.numero,
        nom: item.nom.trim(),
        actif: true,
        telephone: item.telephone?.trim() || undefined,
        createdAt: new Date().toISOString(),
      };
      all.push(created);
      touched.push(created);
      addedCount++;
    }
  });

  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(all));
  touched.forEach((o) => addToSyncQueue('ouvriers', o, 'upsert'));
  notifyListeners();
  return { addedCount, updatedCount, deactivatedCount };
}

// ------------------------- TÂCHES -------------------------

export function getTaches(companyId: string): Tache[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHES);
    const all: Tache[] = raw ? JSON.parse(raw) : [];
    return all.filter((t) => t.company_id === companyId && t.actif !== false);
  } catch {
    return [];
  }
}

export function getAllTaches(companyId: string): Tache[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHES);
    const all: Tache[] = raw ? JSON.parse(raw) : [];
    return all.filter((t) => t.company_id === companyId);
  } catch {
    return [];
  }
}

export function saveTache(
  companyId: string,
  tacheData: {
    id?: string;
    code?: string;
    nom: string;
    couleur?: string;
    actif?: boolean;
    remuneration_mode?: string;
    unite_metrique?: string;
    tarif_unitaire?: number;
    tarif_heure?: number;
    ouvriers_autorises?: 'tous' | string[];
  }
): { success: boolean; tache?: Tache; error?: string } {
  const allRaw = localStorage.getItem(STORAGE_KEYS.TACHES);
  const all: Tache[] = allRaw ? JSON.parse(allRaw) : [];

  const nomNettoye = tacheData.nom.trim().toUpperCase();
  if (!nomNettoye) {
    return { success: false, error: 'Le nom de la tâche est obligatoire.' };
  }

  const codeClean = tacheData.code?.trim().toUpperCase() || undefined;

  // Règle : Le code est modifiable dans l'écran Gestion. Il doit être unique : si un code existe déjà, afficher une erreur et ne pas enregistrer.
  if (codeClean) {
    const duplicateCode = all.find(
      (t) =>
        t.company_id === companyId &&
        t.code &&
        t.code.trim().toUpperCase() === codeClean &&
        t.id !== tacheData.id
    );
    if (duplicateCode) {
      return {
        success: false,
        error: `Le code "${codeClean}" existe déjà pour la tâche "${duplicateCode.nom}". Chaque code doit être unique.`,
      };
    }
  }

  // Vérifier doublon de nom au sein de la même société
  const duplicate = all.find(
    (t) => t.company_id === companyId && t.nom === nomNettoye && t.id !== tacheData.id
  );
  if (duplicate) {
    return { success: false, error: `La tâche "${nomNettoye}" existe déjà.` };
  }

  const id = tacheData.id || `tch_${Date.now()}`;
  const existingIdx = all.findIndex((t) => t.id === id);

  const updated: Tache = {
    id,
    company_id: companyId,
    code: codeClean,
    nom: nomNettoye,
    couleur: tacheData.couleur || '#16a34a',
    actif: tacheData.actif !== undefined ? tacheData.actif : true,
    remuneration_mode: tacheData.remuneration_mode ?? (existingIdx >= 0 ? all[existingIdx].remuneration_mode : undefined),
    unite_metrique: tacheData.unite_metrique ?? (existingIdx >= 0 ? all[existingIdx].unite_metrique : undefined),
    tarif_unitaire: tacheData.tarif_unitaire ?? (existingIdx >= 0 ? all[existingIdx].tarif_unitaire : undefined),
    tarif_heure: tacheData.tarif_heure ?? (existingIdx >= 0 ? all[existingIdx].tarif_heure : undefined),
    ouvriers_autorises: tacheData.ouvriers_autorises || 'tous',
    createdAt: existingIdx >= 0 ? all[existingIdx].createdAt : new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    all[existingIdx] = updated;
  } else {
    all.push(updated);
  }

  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(all));
  addToSyncQueue('taches', updated);
  notifyListeners();
  return { success: true, tache: updated };
}

export function deleteTache(id: string): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.TACHES);
  let all: Tache[] = allRaw ? JSON.parse(allRaw) : [];
  const target = all.find((t) => t.id === id);
  all = all.filter((t) => t.id !== id);
  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(all));
  addToSyncQueue('taches', { id, company_id: target?.company_id || getActiveCompanyId() }, 'delete');
  notifyListeners();
}

const PALETTE_COULEURS = [
  '#16a34a', '#2563eb', '#d97706', '#7c3aed', '#dc2626',
  '#0891b2', '#059669', '#ca8a04', '#4f46e5', '#db2777',
  '#ea580c', '#0284c7', '#65a30d', '#9333ea', '#e11d48'
];

export interface TaskImportItem {
  code?: string;
  nom: string;
}

export function bulkImportTaches(
  companyId: string,
  tasksToImport: Array<string | TaskImportItem>,
  replaceAll: boolean = false
): { added: number; updated: number; deactivated: number; total: number; errors: string[] } {
  initStorage();
  const allRaw = localStorage.getItem(STORAGE_KEYS.TACHES);
  let all: Tache[] = allRaw ? JSON.parse(allRaw) : [];

  const parsedItems: Array<{ cleanCode?: string; cleanNom: string }> = [];
  tasksToImport.forEach((item) => {
    let rawCode: string | undefined = undefined;
    let rawNom: string = '';

    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (!trimmed) return;
      if (trimmed.includes(';')) {
        const parts = trimmed.split(';');
        rawCode = parts[0]?.trim();
        rawNom = parts.slice(1).join(';').trim();
      } else if (trimmed.includes(' - ')) {
        const parts = trimmed.split(' - ');
        rawCode = parts[0]?.trim();
        rawNom = parts.slice(1).join(' - ').trim();
      } else if (trimmed.includes('\t')) {
        const parts = trimmed.split('\t');
        rawCode = parts[0]?.trim();
        rawNom = parts.slice(1).join('\t').trim();
      } else {
        rawNom = trimmed;
      }
    } else {
      rawCode = item.code?.trim();
      rawNom = item.nom?.trim() || '';
    }

    const cleanNom = rawNom.toUpperCase();
    const cleanCode = rawCode ? rawCode.toUpperCase() : undefined;
    if (cleanNom) {
      parsedItems.push({ cleanCode, cleanNom });
    }
  });

  let added = 0;
  let updated = 0;
  let deactivated = 0;
  const errors: string[] = [];

  const importedCodes = new Set(parsedItems.map((p) => p.cleanCode).filter(Boolean));
  const importedNoms = new Set(parsedItems.map((p) => p.cleanNom));

  const touchedTaches: Tache[] = [];
  if (replaceAll) {
    // Mode remplacement : Désactiver les tâches existantes absentes du nouveau fichier
    all.forEach((t) => {
      if (t.company_id === companyId) {
        const hasMatchingCode = t.code && importedCodes.has(t.code.toUpperCase());
        const hasMatchingNom = importedNoms.has(t.nom.toUpperCase());
        if (!hasMatchingCode && !hasMatchingNom) {
          if (t.actif !== false) {
            t.actif = false;
            deactivated++;
            touchedTaches.push(t);
          }
        }
      }
    });
  }

  parsedItems.forEach((pi, index) => {
    const existing = all.find(
      (t) =>
        t.company_id === companyId &&
        ((pi.cleanCode && t.code && t.code.toUpperCase() === pi.cleanCode) ||
          t.nom.toUpperCase() === pi.cleanNom)
    );

    if (existing) {
      existing.nom = pi.cleanNom;
      if (pi.cleanCode) existing.code = pi.cleanCode;
      existing.actif = true; // Réactiver
      updated++;
      touchedTaches.push(existing);
    } else {
      const couleur = PALETTE_COULEURS[(all.length + added) % PALETTE_COULEURS.length];
      const created: Tache = {
        id: `tch_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 5)}`,
        company_id: companyId,
        code: pi.cleanCode,
        nom: pi.cleanNom,
        couleur,
        actif: true,
        ouvriers_autorises: 'tous',
        createdAt: new Date().toISOString(),
      };
      all.push(created);
      touchedTaches.push(created);
      added++;
    }
  });

  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(all));
  touchedTaches.forEach((t) => addToSyncQueue('taches', t, 'upsert'));
  notifyListeners();
  return {
    added,
    updated,
    deactivated,
    total: all.filter((t) => t.company_id === companyId && t.actif !== false).length,
    errors,
  };
}

// ------------------------- POINTAGES -------------------------

export function getPointages(companyId: string, date: string): Pointage[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
    const all: Pointage[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((p) => p.company_id === companyId && p.date === date)
      .sort((a, b) => b.timestamp - a.timestamp); // Plus récents en premier
  } catch {
    return [];
  }
}

export function getAllPointages(companyId: string): Pointage[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
    const all: Pointage[] = raw ? JSON.parse(raw) : [];
    return all.filter((p) => p.company_id === companyId);
  } catch {
    return [];
  }
}

export function getPointagesRange(
  companyId: string,
  startDate: string,
  endDate: string
): Pointage[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
    const all: Pointage[] = raw ? JSON.parse(raw) : [];
    return all.filter(
      (p) => p.company_id === companyId && p.date >= startDate && p.date <= endDate
    );
  } catch {
    return [];
  }
}

export interface AddPointageResult {
  success: boolean;
  pointage?: Pointage;
  error?: string;
  isDuplicate?: boolean;
}

export function addPointage(
  companyId: string,
  ouvrierId: string,
  date: string,
  tacheId: string | null = null,
  domaineId?: string,
  serreId?: string | null,
  serreNom?: string | null
): AddPointageResult {
  const allRaw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  const all: Pointage[] = allRaw ? JSON.parse(allRaw) : [];

  // Vérification de sécurité: l'ouvrier existe-t-il et est-il actif ?
  const ouvriers = getActiveOuvriers(companyId);
  const ouvrier = ouvriers.find((o) => o.id === ouvrierId);

  if (!ouvrier) {
    return {
      success: false,
      error: 'Ouvrier introuvable ou inactif dans cette exploitation.',
    };
  }

  // RÈGLE CRUCIALE: Aucun doublon de pointage pour un même ouvrier et une même date
  const existing = all.find(
    (p) => p.company_id === companyId && p.date === date && p.ouvrier_id === ouvrierId
  );

  const now = new Date();
  const heure = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const targetDomaineId = domaineId || getDefaultDomaineId();

  if (existing) {
    if (existing.present !== false) {
      return {
        success: false,
        isDuplicate: true,
        pointage: existing,
        error: `L'ouvrier #${ouvrier.numero} (${ouvrier.nom}) est DÉJÀ POINTÉ aujourd'hui à ${existing.heure} !`,
      };
    } else {
      // Était marqué absent : le repasser en présent sans doublon
      existing.present = true;
      existing.domaine_id = targetDomaineId;
      existing.tache_id = tacheId;
      existing.serre_id = serreId || null;
      existing.serre_nom = serreNom || null;
      existing.heure = heure;
      existing.timestamp = now.getTime();
      safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
      addToPointageSyncQueue('pointages', existing, 'upsert');

      if (tacheId) {
        const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
        const allAff: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
        const newAff: AffectationTache = {
          id: `aff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          company_id: companyId,
          ouvrier_id: ouvrierId,
          numero_ouvrier: ouvrier.numero,
          tache_id: tacheId,
          domaine_id: targetDomaineId,
          serre_id: serreId || null,
          serre_nom: serreNom || null,
          date,
          timestamp: now.getTime(),
        };
        allAff.push(newAff);
        safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(allAff));
        addToPointageSyncQueue('affectations', newAff, 'upsert');
      }

      notifyListeners();
      return { success: true, pointage: existing };
    }
  }

  const newPointage: Pointage = {
    id: `ptg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    company_id: companyId,
    ouvrier_id: ouvrierId,
    numero_ouvrier: ouvrier.numero,
    date,
    present: true,
    tache_id: tacheId,
    domaine_id: targetDomaineId,
    serre_id: serreId || null,
    serre_nom: serreNom || null,
    heure,
    timestamp: now.getTime(),
  };

  all.push(newPointage);
  safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
  addToPointageSyncQueue('pointages', newPointage, 'upsert');

  if (tacheId) {
    const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    const allAff: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
    const newAff: AffectationTache = {
      id: `aff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      company_id: companyId,
      ouvrier_id: ouvrierId,
      numero_ouvrier: ouvrier.numero,
      tache_id: tacheId,
      domaine_id: targetDomaineId,
      serre_id: serreId || null,
      serre_nom: serreNom || null,
      date,
      timestamp: now.getTime(),
    };
    allAff.push(newAff);
    safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(allAff));
    addToPointageSyncQueue('affectations', newAff, 'upsert');
  }

  notifyListeners();

  return { success: true, pointage: newPointage };
}

export function updatePointage(
  pointageId: string,
  updates: { tache_id?: string | null; domaine_id?: string; serre_id?: string | null; serre_nom?: string | null }
): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  const all: Pointage[] = allRaw ? JSON.parse(allRaw) : [];
  const idx = all.findIndex((p) => p.id === pointageId);
  if (idx >= 0) {
    if (updates.tache_id !== undefined) {
      all[idx].tache_id = updates.tache_id;
    }
    if (updates.domaine_id !== undefined) {
      all[idx].domaine_id = updates.domaine_id;
    }
    if (updates.serre_id !== undefined) {
      all[idx].serre_id = updates.serre_id;
    }
    if (updates.serre_nom !== undefined) {
      all[idx].serre_nom = updates.serre_nom;
    }
    safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
    addToPointageSyncQueue('pointages', all[idx], 'upsert');
    notifyListeners();
  }
}

export function updatePointageTache(pointageId: string, tacheId: string | null): void {
  updatePointage(pointageId, { tache_id: tacheId });
}

export function updatePointageDomaine(pointageId: string, domaineId: string): void {
  updatePointage(pointageId, { domaine_id: domaineId });
}

export function deletePointage(pointageId: string): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  let all: Pointage[] = allRaw ? JSON.parse(allRaw) : [];
  const target = all.find((p) => p.id === pointageId);
  all = all.filter((p) => p.id !== pointageId);
  safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
  if (target) {
    addToPointageSyncQueue('pointages', { id: target.id }, 'delete');
  }

  // Supprimer également les affectations de tâches de cet ouvrier pour cette date
  if (target) {
    const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    const allAff: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
    const removedAffs = allAff.filter(
      (a) => a.company_id === target.company_id && a.ouvrier_id === target.ouvrier_id && a.date === target.date
    );
    const remainingAff = allAff.filter(
      (a) => !(a.company_id === target.company_id && a.ouvrier_id === target.ouvrier_id && a.date === target.date)
    );
    safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(remainingAff));
    removedAffs.forEach((a) => addToPointageSyncQueue('affectations', { id: a.id }, 'delete'));
  }

  notifyListeners();
}

export function removeWorkerAffectationsForDate(
  companyId: string,
  ouvrierId: string,
  date: string
): number {
  const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  let allAff: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
  const removed = allAff.filter(
    (a) => a.company_id === companyId && a.ouvrier_id === ouvrierId && a.date === date
  );
  allAff = allAff.filter(
    (a) => !(a.company_id === companyId && a.ouvrier_id === ouvrierId && a.date === date)
  );
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(allAff));
  removed.forEach((a) => addToPointageSyncQueue('affectations', { id: a.id, company_id: companyId }, 'delete'));
  return removed.length;
}

export function getWorkerAffectationsCount(
  companyId: string,
  ouvrierId: string,
  date: string
): number {
  const rawAff = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const allAff: AffectationTache[] = rawAff ? JSON.parse(rawAff) : [];
  return allAff.filter(
    (a) => a.company_id === companyId && a.ouvrier_id === ouvrierId && a.date === date
  ).length;
}

export function passerPointageEnAbsent(
  companyId: string,
  ouvrierId: string,
  date: string
): { success: boolean; tasksRemoved: number } {
  const allRaw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  let all: Pointage[] = allRaw ? JSON.parse(allRaw) : [];
  const idx = all.findIndex(
    (p) => p.company_id === companyId && p.date === date && p.ouvrier_id === ouvrierId
  );
  if (idx >= 0) {
    all[idx].present = false;
    all[idx].tache_id = null;
    all[idx].timestamp = Date.now();
    safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
    addToPointageSyncQueue('pointages', all[idx], 'upsert');
  } else {
    const ouvriers = getActiveOuvriers(companyId);
    const ouvrier = ouvriers.find((o) => o.id === ouvrierId);
    if (ouvrier) {
      const absentPtg: Pointage = {
        id: `ptg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        company_id: companyId,
        ouvrier_id: ouvrierId,
        numero_ouvrier: ouvrier.numero,
        date,
        present: false,
        domaine_id: getDefaultDomaineId(),
        heure: new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        timestamp: Date.now(),
      };
      all.push(absentPtg);
      safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
      addToPointageSyncQueue('pointages', absentPtg, 'upsert');
    }
  }

  const tasksRemoved = removeWorkerAffectationsForDate(companyId, ouvrierId, date);
  notifyListeners();
  return { success: true, tasksRemoved };
}

export function passerPointageEnPresent(
  companyId: string,
  ouvrierId: string,
  date: string,
  domaineId?: string
): { success: boolean } {
  const allRaw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  let all: Pointage[] = allRaw ? JSON.parse(allRaw) : [];
  const idx = all.findIndex(
    (p) => p.company_id === companyId && p.date === date && p.ouvrier_id === ouvrierId
  );
  const targetDomId = domaineId || getDefaultDomaineId();
  const now = new Date();
  const heure = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (idx >= 0) {
    all[idx].present = true;
    all[idx].domaine_id = targetDomId;
    all[idx].tache_id = null; // Remet la présence en Présent, sans tâche
    all[idx].timestamp = now.getTime();
    safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
    addToPointageSyncQueue('pointages', all[idx], 'upsert');
  } else {
    const ouvriers = getActiveOuvriers(companyId);
    const ouvrier = ouvriers.find((o) => o.id === ouvrierId);
    if (!ouvrier) return { success: false };
    const newPtg: Pointage = {
      id: `ptg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      company_id: companyId,
      ouvrier_id: ouvrierId,
      numero_ouvrier: ouvrier.numero,
      date,
      present: true,
      tache_id: null,
      domaine_id: targetDomId,
      heure,
      timestamp: now.getTime(),
    };
    all.push(newPtg);
    safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(all));
    addToPointageSyncQueue('pointages', newPtg, 'upsert');
  }
  notifyListeners();
  return { success: true };
}

export function getAffectations(companyId: string, date: string): AffectationTache[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
    return all.filter((a) => a.company_id === companyId && a.date === date);
  } catch {
    return [];
  }
}

export function getAllAffectations(companyId: string): AffectationTache[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
    return all.filter((a) => a.company_id === companyId);
  } catch {
    return [];
  }
}

export function getAffectationsRange(
  companyId: string,
  startDate: string,
  endDate: string
): AffectationTache[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
    const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
    return all.filter(
      (a) => a.company_id === companyId && a.date >= startDate && a.date <= endDate
    );
  } catch {
    return [];
  }
}

export function assignWorkerToTask(
  companyId: string,
  date: string,
  ouvrierId: string,
  tacheId: string,
  domaineId?: string,
  serreId?: string | null,
  serreNom?: string | null
): { success: boolean; error?: string; affectation?: AffectationTache } {
  initStorage();
  // RÈGLE : Un ouvrier absent ne peut pas être affecté à une tâche
  const pointages = getPointages(companyId, date);
  const pointage = pointages.find((p) => p.ouvrier_id === ouvrierId);
  if (!pointage || pointage.present === false) {
    return {
      success: false,
      error: "Cet ouvrier n'est pas pointé présent aujourd'hui. Un ouvrier absent ne peut pas être affecté à une tâche.",
    };
  }

  const targetDomaineId = domaineId || pointage.domaine_id || getDefaultDomaineId();
  const targetSerreId = serreId || null;
  const targetSerreNom = serreNom || null;

  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];

  // Éviter le doublon exact (même ouvrier + même tâche + même domaine + même serre le même jour)
  const exactDuplicate = all.find(
    (a) =>
      a.company_id === companyId &&
      a.date === date &&
      a.ouvrier_id === ouvrierId &&
      a.tache_id === tacheId &&
      (a.domaine_id || pointage.domaine_id || getDefaultDomaineId()) === targetDomaineId &&
      (a.serre_id || null) === targetSerreId
  );

  if (exactDuplicate) {
    return {
      success: false,
      error: 'Cette tâche avec cette serre est déjà enregistrée pour cet ouvrier aujourd\'hui.',
    };
  }

  const newAff: AffectationTache = {
    id: `aff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    company_id: companyId,
    ouvrier_id: ouvrierId,
    numero_ouvrier: pointage.numero_ouvrier,
    tache_id: tacheId,
    domaine_id: targetDomaineId,
    serre_id: targetSerreId,
    serre_nom: targetSerreNom,
    date,
    timestamp: Date.now(),
  };

  all.push(newAff);
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(all));
  addToPointageSyncQueue('affectations', newAff, 'upsert');

  // Rétrocompatibilité pointage.tache_id si non encore renseigné (sans affecter de serre au pointage du matin)
  if (!pointage.tache_id) {
    const rawPtgs = localStorage.getItem(STORAGE_KEYS.POINTAGES);
    const allPtgs: Pointage[] = rawPtgs ? JSON.parse(rawPtgs) : [];
    const ptgIdx = allPtgs.findIndex((p) => p.id === pointage.id);
    if (ptgIdx >= 0) {
      allPtgs[ptgIdx].tache_id = tacheId;
      safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(allPtgs));
      addToPointageSyncQueue('pointages', allPtgs[ptgIdx], 'upsert');
    }
  }

  notifyListeners();
  return { success: true, affectation: newAff };
}

export function updateAffectationTache(
  affectationId: string,
  updates: {
    tacheId?: string;
    domaineId?: string;
    serreId?: string | null;
    serreNom?: string | null;
  }
): { success: boolean; error?: string; affectation?: AffectationTache } {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
  const idx = all.findIndex((a) => a.id === affectationId);
  if (idx < 0) {
    return { success: false, error: 'Affectation introuvable.' };
  }

  const current = all[idx];
  const nextTacheId = updates.tacheId !== undefined ? updates.tacheId : current.tache_id;
  const nextDomaineId = updates.domaineId !== undefined ? updates.domaineId : current.domaine_id;
  const nextSerreId = updates.serreId !== undefined ? updates.serreId : (current.serre_id ?? null);
  const nextSerreNom = updates.serreNom !== undefined ? updates.serreNom : (current.serre_nom ?? null);

  const duplicate = all.find(
    (a) =>
      a.id !== affectationId &&
      a.company_id === current.company_id &&
      a.date === current.date &&
      a.ouvrier_id === current.ouvrier_id &&
      a.tache_id === nextTacheId &&
      (a.domaine_id || '') === (nextDomaineId || '') &&
      (a.serre_id || null) === (nextSerreId || null)
  );
  if (duplicate) {
    return {
      success: false,
      error: 'Une affectation identique existe déjà pour cet ouvrier aujourd\'hui.',
    };
  }

  const updated: AffectationTache = {
    ...current,
    tache_id: nextTacheId,
    domaine_id: nextDomaineId,
    serre_id: nextSerreId,
    serre_nom: nextSerreNom,
    timestamp: Date.now(),
  };

  all[idx] = updated;
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(all));
  addToPointageSyncQueue('affectations', updated, 'upsert');
  notifyListeners();
  return { success: true, affectation: updated };
}

export function removeAffectationById(affectationId: string): void {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
  const target = all.find((a) => a.id === affectationId);
  if (!target) return;

  const remaining = all.filter((a) => a.id !== affectationId);
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(remaining));
  addToPointageSyncQueue('affectations', { id: affectationId }, 'delete');

  // Mettre à jour pointage.tache_id pour rétrocompatibilité
  const nextForWorker = remaining.find(
    (a) => a.company_id === target.company_id && a.date === target.date && a.ouvrier_id === target.ouvrier_id
  );
  const rawPtgs = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  const allPtgs: Pointage[] = rawPtgs ? JSON.parse(rawPtgs) : [];
  const ptgIdx = allPtgs.findIndex(
    (p) => p.company_id === target.company_id && p.date === target.date && p.ouvrier_id === target.ouvrier_id
  );
  if (ptgIdx >= 0) {
    allPtgs[ptgIdx].tache_id = nextForWorker ? nextForWorker.tache_id : null;
    safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(allPtgs));
    addToPointageSyncQueue('pointages', allPtgs[ptgIdx], 'upsert');
  }

  notifyListeners();
}

export function removeWorkerFromTask(
  companyId: string,
  date: string,
  ouvrierId: string,
  tacheId: string
): void {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
  const removed = all.filter(
    (a) =>
      a.company_id === companyId &&
      a.date === date &&
      a.ouvrier_id === ouvrierId &&
      a.tache_id === tacheId
  );
  const remaining = all.filter(
    (a) =>
      !(
        a.company_id === companyId &&
        a.date === date &&
        a.ouvrier_id === ouvrierId &&
        a.tache_id === tacheId
      )
  );
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(remaining));
  removed.forEach((a) => addToPointageSyncQueue('affectations', { id: a.id }, 'delete'));
  notifyListeners();
}

export function getTacheSerresConfigs(companyId: string, date: string): TacheSerreConfig[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHE_SERRES);
    const all: TacheSerreConfig[] = raw ? JSON.parse(raw) : [];
    return all.filter((c) => c.company_id === companyId && c.date === date);
  } catch {
    return [];
  }
}

export function saveTacheSerreConfig(
  companyId: string,
  date: string,
  tacheId: string,
  domaineId: string,
  serreIds: string[],
  serreNoms: string[]
): TacheSerreConfig {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.TACHE_SERRES);
  const all: TacheSerreConfig[] = raw ? JSON.parse(raw) : [];
  const uniqueIds = Array.from(new Set(serreIds.filter(Boolean)));
  const uniqueNoms = Array.from(new Set(serreNoms.filter(Boolean)));

  const idx = all.findIndex(
    (c) => c.company_id === companyId && c.date === date && c.tache_id === tacheId
  );

  const nextConfig: TacheSerreConfig = {
    id: idx >= 0 ? all[idx].id : `ts_${companyId}_${date}_${tacheId}`,
    company_id: companyId,
    date,
    tache_id: tacheId,
    domaine_id: domaineId || getDefaultDomaineId(),
    serre_ids: uniqueIds,
    serre_noms: uniqueNoms,
    updated_at: Date.now(),
  };

  if (idx >= 0) {
    all[idx] = nextConfig;
  } else {
    all.push(nextConfig);
  }

  safeSetItem(STORAGE_KEYS.TACHE_SERRES, JSON.stringify(all));
  addToPointageSyncQueue('tache_serres', nextConfig, 'upsert');
  return nextConfig;
}

export function updateTacheAffectationsSerres(
  companyId: string,
  date: string,
  tacheId: string,
  domaineId: string,
  serreIds: string[],
  serreNoms: string[]
): { success: boolean; updatedCount: number } {
  initStorage();
  const uniqueIds = Array.from(new Set(serreIds.filter(Boolean)));
  const uniqueNoms = Array.from(new Set(serreNoms.filter(Boolean)));
  saveTacheSerreConfig(companyId, date, tacheId, domaineId, uniqueIds, uniqueNoms);

  const serreIdStr = uniqueIds.length > 0 ? uniqueIds.join(',') : null;
  const serreNomStr = uniqueNoms.length > 0 ? uniqueNoms.join(', ') : null;

  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];
  let updatedCount = 0;

  all.forEach((aff, idx) => {
    if (aff.company_id === companyId && aff.date === date && aff.tache_id === tacheId) {
      const updatedAff: AffectationTache = {
        ...aff,
        domaine_id: domaineId,
        serre_id: serreIdStr,
        serre_nom: serreNomStr,
        serres_ids: uniqueIds,
        serres_noms: uniqueNoms,
        timestamp: Date.now(),
      };
      all[idx] = updatedAff;
      addToPointageSyncQueue('affectations', updatedAff, 'upsert');
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(all));
  }
  notifyListeners();
  return { success: true, updatedCount };
}

export function setTaskWorkers(
  companyId: string,
  date: string,
  tacheId: string,
  selectedOuvrierIds: string[],
  options?: { domaineId?: string; serreIds?: string[]; serreNoms?: string[] }
): { success: boolean; error?: string } {
  initStorage();
  const pointages = getPointages(companyId, date);
  const pointageMap = new Map<string, Pointage>(pointages.map((p) => [p.ouvrier_id, p]));

  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const all: AffectationTache[] = raw ? JSON.parse(raw) : [];

  const taches = getTaches(companyId);
  const ouvriers = getActiveOuvriers(companyId);
  const ouvrierMap = new Map(ouvriers.map((o) => [o.id, o]));
  const tacheMap = new Map(taches.map((t) => [t.id, t]));

  // RÈGLE : UN OUVRIER = UNE SEULE TÂCHE PAR JOUR (dans la vue Tâches)
  for (const ouvId of selectedOuvrierIds) {
    const existingOther = all.find(
      (a) =>
        a.company_id === companyId &&
        a.date === date &&
        a.ouvrier_id === ouvId &&
        a.tache_id !== tacheId
    );
    if (existingOther) {
      const otherTask = tacheMap.get(existingOther.tache_id);
      const taskLabel = otherTask ? formatTacheLabel(otherTask) : 'une autre tâche';
      const o = ouvrierMap.get(ouvId);
      const ptg = pointageMap.get(ouvId);
      const nom = o ? o.nom : (ptg ? `Ouvrier #${ptg.numero_ouvrier}` : 'L\'ouvrier');
      return {
        success: false,
        error: `${nom} est déjà affecté à ${taskLabel} aujourd'hui. Retirez-le de cette tâche pour le mettre sur une autre.`,
      };
    }
  }

  // Résoudre le domaine et les serres associées à la tâche
  const existingTaskConfig = getTacheSerresConfigs(companyId, date).find(
    (c) => c.tache_id === tacheId
  );
  const existingTaskAffs = all.filter(
    (a) => a.company_id === companyId && a.date === date && a.tache_id === tacheId
  );
  const resolvedDomaineId =
    options?.domaineId ||
    existingTaskConfig?.domaine_id ||
    existingTaskAffs.find((a) => a.domaine_id)?.domaine_id ||
    getDefaultDomaineId();
  const resolvedSerreIds =
    options?.serreIds !== undefined
      ? Array.from(new Set(options.serreIds.filter(Boolean)))
      : existingTaskConfig?.serre_ids || [];
  const resolvedSerreNoms =
    options?.serreNoms !== undefined
      ? Array.from(new Set(options.serreNoms.filter(Boolean)))
      : existingTaskConfig?.serre_noms || [];

  if (options?.domaineId !== undefined || options?.serreIds !== undefined) {
    saveTacheSerreConfig(
      companyId,
      date,
      tacheId,
      resolvedDomaineId,
      resolvedSerreIds,
      resolvedSerreNoms
    );
  }

  const serreIdStr = resolvedSerreIds.length > 0 ? resolvedSerreIds.join(',') : null;
  const serreNomStr = resolvedSerreNoms.length > 0 ? resolvedSerreNoms.join(', ') : null;

  const existingByWorkerId = new Map<string, AffectationTache>();
  existingTaskAffs.forEach((a) => {
    if (!existingByWorkerId.has(a.ouvrier_id)) {
      existingByWorkerId.set(a.ouvrier_id, a);
    }
  });

  const uniqueWorkerIds = Array.from(new Set(selectedOuvrierIds));
  const keptAffIds = new Set<string>();

  const remainingOtherTasks = all.filter(
    (a) => !(a.company_id === companyId && a.date === date && a.tache_id === tacheId)
  );

  const nextTaskAffs: AffectationTache[] = [];
  uniqueWorkerIds.forEach((ouvId) => {
    const ptg = pointageMap.get(ouvId);
    if (ptg && ptg.present !== false) {
      const prev = existingByWorkerId.get(ouvId);
      const affObj: AffectationTache = {
        id: prev ? prev.id : `aff_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        company_id: companyId,
        ouvrier_id: ouvId,
        numero_ouvrier: ptg.numero_ouvrier,
        tache_id: tacheId,
        domaine_id: resolvedDomaineId || ptg.domaine_id || getDefaultDomaineId(),
        serre_id: serreIdStr ?? (prev?.serre_id || null),
        serre_nom: serreNomStr ?? (prev?.serre_nom || null),
        serres_ids: resolvedSerreIds.length > 0 ? resolvedSerreIds : prev?.serres_ids,
        serres_noms: resolvedSerreNoms.length > 0 ? resolvedSerreNoms : prev?.serres_noms,
        date,
        timestamp: Date.now(),
      };
      if (options?.serreIds !== undefined) {
        affObj.serre_id = serreIdStr;
        affObj.serre_nom = serreNomStr;
        affObj.serres_ids = resolvedSerreIds;
        affObj.serres_noms = resolvedSerreNoms;
      }
      keptAffIds.add(affObj.id);
      nextTaskAffs.push(affObj);
      addToPointageSyncQueue('affectations', affObj, 'upsert');
    }
  });

  // Synchroniser les suppressions vers Supabase si des ouvriers ont été retirés
  existingTaskAffs.forEach((oldAff) => {
    if (!keptAffIds.has(oldAff.id)) {
      addToPointageSyncQueue('affectations', { id: oldAff.id }, 'delete');
    }
  });

  safeSetItem(
    STORAGE_KEYS.AFFECTATIONS,
    JSON.stringify([...remainingOtherTasks, ...nextTaskAffs])
  );
  notifyListeners();
  return { success: true };
}

// ------------------------- HEURES SUPPLÉMENTAIRES -------------------------

export function getHeuresSupplementaires(companyId: string, date: string): HeureSupplementaire[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HEURES_SUPP);
    const all: HeureSupplementaire[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((h) => h.company_id === companyId && h.date === date)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
}

export interface AddHeureSuppResult {
  success: boolean;
  item?: HeureSupplementaire;
  error?: string;
  isDuplicate?: boolean;
  isUpdated?: boolean;
}

export function getAllHeuresSupplementaires(companyId: string): HeureSupplementaire[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HEURES_SUPP);
    const all: HeureSupplementaire[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((h) => h.company_id === companyId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
}

export function mergeHeuresSupplementairesServerData(serverRecords: HeureSupplementaire[]): void {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HEURES_SUPP);
    const localList: HeureSupplementaire[] = raw ? JSON.parse(raw) : [];

    const merged = mergeCollectionWithConflictLog<HeureSupplementaire>({
      table: 'heures_supplementaires',
      queueKey: OUTBOX_KEYS.SUPPLEMENTAIRES,
      localItems: localList,
      remoteItems: Array.isArray(serverRecords) ? serverRecords : [],
      getId: (item) => item.id,
      getCompanyId: (item) => item.company_id,
      preserveLocalNotInRemote: true,
    }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify(merged));
    notifyListeners();
  } catch (err) {
    console.error('Erreur fusion Heures Supplementaires:', err);
  }
}

export function saveHeureSupplementaire(
  companyId: string,
  ouvrierId: string,
  date: string,
  data: {
    id?: string;
    type: TypeSupplementaire;
    tache_id?: string | null;
    nom_tache?: string | null;
    quantite?: number | null;
    unite?: string;
    heures?: number | null;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
    created_by_id?: string | null;
    created_by_nom?: string | null;
    updated_by_id?: string | null;
    updated_by_nom?: string | null;
  }
): AddHeureSuppResult {
  initStorage();
  const allRaw = localStorage.getItem(STORAGE_KEYS.HEURES_SUPP);
  const all: HeureSupplementaire[] = allRaw ? JSON.parse(allRaw) : [];

  const ouvriers = getActiveOuvriers(companyId);
  const ouvrier = ouvriers.find((o) => o.id === ouvrierId) || getOuvriers(companyId).find((o: Ouvrier) => o.id === ouvrierId);

  if (!ouvrier) {
    return {
      success: false,
      error: 'Ouvrier introuvable dans cette exploitation.',
    };
  }

  const now = new Date();
  const heureStr = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Si un ID est fourni pour modification explicite d'une opération existante
  if (data.id) {
    const idx = all.findIndex((h) => h.id === data.id);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        type: data.type,
        tache_id: data.type === 'tache' ? data.tache_id : null,
        nom_tache: data.nom_tache !== undefined ? data.nom_tache : all[idx].nom_tache,
        quantite: data.quantite,
        unite: data.unite || (data.type === 'tache' ? 'ruban' : 'heure'),
        heures: data.type === 'heures' ? (data.quantite !== undefined ? data.quantite : data.heures) : null,
        domaine_id: data.domaine_id !== undefined ? data.domaine_id : all[idx].domaine_id,
        serre_id: data.serre_id !== undefined ? data.serre_id : all[idx].serre_id,
        observation: data.observation !== undefined ? data.observation : all[idx].observation,
        updated_at: now.toISOString(),
        updated_by_id: data.updated_by_id !== undefined ? data.updated_by_id : all[idx].updated_by_id,
        updated_by_nom: data.updated_by_nom !== undefined ? data.updated_by_nom : all[idx].updated_by_nom,
        timestamp: now.getTime(),
      };
      safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify(all));
      addToSyncQueue('heures_supplementaires', all[idx]);
      notifyListeners();
      return { success: true, item: all[idx], isUpdated: true };
    }
  }

  const finalDuration = Number(data.heures !== undefined && data.heures !== null ? data.heures : (data.quantite || 0));
  const newEntry: HeureSupplementaire = {
    id: `hsup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    company_id: companyId,
    ouvrier_id: ouvrierId,
    numero_ouvrier: ouvrier.numero,
    date,
    type: data.type,
    tache_id: data.type === 'tache' ? data.tache_id : null,
    nom_tache: data.nom_tache || null,
    quantite: data.quantite,
    unite: data.unite || (data.type === 'tache' ? 'ruban' : 'heure'),
    heures: data.type === 'heures' ? (data.quantite !== undefined ? data.quantite : data.heures) : null,
    duree_heures: finalDuration,
    domaine_id: data.domaine_id || null,
    serre_id: data.serre_id || null,
    observation: data.observation || null,
    created_by_id: data.created_by_id || null,
    created_by_nom: data.created_by_nom || null,
    heure_enregistrement: heureStr,
    timestamp: now.getTime(),
  };

  all.push(newEntry);
  safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify(all));
  addToSyncQueue('heures_supplementaires', newEntry);
  notifyListeners();

  return { success: true, item: newEntry };
}

export function addHeureSupplementaire(
  companyId: string,
  ouvrierId: string,
  date: string,
  heures?: number | null
): AddHeureSuppResult {
  return saveHeureSupplementaire(companyId, ouvrierId, date, {
    type: 'heures',
    quantite: heures,
    heures: heures,
    unite: 'heure',
  });
}

export function deleteHeureSupplementaire(
  id: string,
  options?: { skipQueue?: boolean }
): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.HEURES_SUPP);
  let all: HeureSupplementaire[] = allRaw ? JSON.parse(allRaw) : [];
  const target = all.find((h) => h.id === id);
  all = all.filter((h) => h.id !== id);
  safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify(all));
  if (!options?.skipQueue) {
    addToSyncQueue(
      'heures_supplementaires',
      { id, company_id: target?.company_id || getActiveCompanyId() },
      'delete'
    );
  } else {
    addDeleteTombstone('heures_supplementaires', id, target?.company_id || getActiveCompanyId());
  }
  notifyListeners();
}

// ------------------------- TÂCHES SUPPLÉMENTAIRES -------------------------

export function getTachesSupplementaires(companyId: string, date: string): TacheSupplementaire[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHES_SUPP);
    const all: TacheSupplementaire[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((t) => t.company_id === companyId && t.date === date)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
}

export function getAllTachesSupplementaires(companyId: string): TacheSupplementaire[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHES_SUPP);
    const all: TacheSupplementaire[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((t) => t.company_id === companyId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
}

export function mergeTachesSupplementairesServerData(serverRecords: TacheSupplementaire[]): void {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TACHES_SUPP);
    const localList: TacheSupplementaire[] = raw ? JSON.parse(raw) : [];

    const merged = mergeCollectionWithConflictLog<TacheSupplementaire>({
      table: 'taches_supplementaires',
      queueKey: OUTBOX_KEYS.SUPPLEMENTAIRES,
      localItems: localList,
      remoteItems: Array.isArray(serverRecords) ? serverRecords : [],
      getId: (item) => item.id,
      getCompanyId: (item) => item.company_id,
      preserveLocalNotInRemote: true,
    }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    safeSetItem(STORAGE_KEYS.TACHES_SUPP, JSON.stringify(merged));
    notifyListeners();
  } catch (err) {
    console.error('Erreur fusion Taches Supplementaires:', err);
  }
}

export function saveTacheSupplementaire(
  companyId: string,
  ouvrierId: string,
  date: string,
  data: {
    id?: string;
    tache_id?: string | null;
    nom_tache: string;
    description?: string | null;
    quantite: number;
    unite: string;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
    created_by_id?: string | null;
    created_by_nom?: string | null;
    updated_by_id?: string | null;
    updated_by_nom?: string | null;
  }
): { success: boolean; item?: TacheSupplementaire; error?: string } {
  initStorage();
  const allRaw = localStorage.getItem(STORAGE_KEYS.TACHES_SUPP);
  const all: TacheSupplementaire[] = allRaw ? JSON.parse(allRaw) : [];

  const ouvriers = getActiveOuvriers(companyId);
  const ouvrier = ouvriers.find((o) => o.id === ouvrierId) || getOuvriers(companyId).find((o: Ouvrier) => o.id === ouvrierId);

  if (!ouvrier) {
    return { success: false, error: 'Ouvrier introuvable dans cette exploitation.' };
  }

  const now = new Date();
  const heureStr = now.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (data.id) {
    const idx = all.findIndex((t) => t.id === data.id);
    if (idx >= 0) {
      all[idx] = {
        ...all[idx],
        tache_id: data.tache_id !== undefined ? data.tache_id : all[idx].tache_id,
        nom_tache: data.nom_tache || all[idx].nom_tache,
        description: data.description !== undefined ? data.description : all[idx].description,
        quantite: data.quantite,
        unite: data.unite.toLowerCase(),
        domaine_id: data.domaine_id !== undefined ? data.domaine_id : all[idx].domaine_id,
        serre_id: data.serre_id !== undefined ? data.serre_id : all[idx].serre_id,
        observation: data.observation !== undefined ? data.observation : all[idx].observation,
        updated_at: now.toISOString(),
        updated_by_id: data.updated_by_id || null,
        updated_by_nom: data.updated_by_nom || null,
        timestamp: now.getTime(),
      };
      safeSetItem(STORAGE_KEYS.TACHES_SUPP, JSON.stringify(all));
      addToSyncQueue('taches_supplementaires', all[idx]);
      notifyListeners();
      return { success: true, item: all[idx] };
    }
  }

  const newEntry: TacheSupplementaire = {
    id: `tsup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    company_id: companyId,
    ouvrier_id: ouvrierId,
    numero_ouvrier: ouvrier.numero,
    date,
    tache_id: data.tache_id || null,
    nom_tache: data.nom_tache,
    description: data.description || null,
    quantite: data.quantite,
    unite: data.unite.toLowerCase(),
    domaine_id: data.domaine_id || null,
    serre_id: data.serre_id || null,
    observation: data.observation || null,
    created_by_id: data.created_by_id || null,
    created_by_nom: data.created_by_nom || null,
    heure_enregistrement: heureStr,
    timestamp: now.getTime(),
  };

  all.push(newEntry);
  safeSetItem(STORAGE_KEYS.TACHES_SUPP, JSON.stringify(all));
  addToSyncQueue('taches_supplementaires', newEntry);
  notifyListeners();

  return { success: true, item: newEntry };
}

export function deleteTacheSupplementaire(
  id: string,
  options?: { skipQueue?: boolean }
): void {
  const allRaw = localStorage.getItem(STORAGE_KEYS.TACHES_SUPP);
  let all: TacheSupplementaire[] = allRaw ? JSON.parse(allRaw) : [];
  const target = all.find((t) => t.id === id);
  all = all.filter((t) => t.id !== id);
  safeSetItem(STORAGE_KEYS.TACHES_SUPP, JSON.stringify(all));
  if (!options?.skipQueue) {
    addToSyncQueue(
      'taches_supplementaires',
      { id, company_id: target?.company_id || getActiveCompanyId() },
      'delete'
    );
  } else {
    addDeleteTombstone('taches_supplementaires', id, target?.company_id || getActiveCompanyId());
  }
  notifyListeners();
}

// ------------------------- SUIVI DU GAZOIL -------------------------

const DEFAULT_GAZOIL_CONFIG: GazoilConfig = {
  stockInitial: 0,
  initialSet: false,
  seuilAlerte: 20,
  commandeActive: null,
  notifiedBelowThreshold: false,
};

export function requestBrowserNotificationPermission(): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }
}

function sendBrowserNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;

  if (Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: '/favicon.svg',
      });
    } catch (e) {
      console.warn('Erreur affichage notification:', e);
    }
  } else if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        try {
          new Notification(title, {
            body,
            icon: '/favicon.svg',
          });
        } catch (e) {
          console.warn('Erreur affichage notification:', e);
        }
      }
    }).catch(() => {});
  }
}

export function getGazoilConfig(companyId: string): GazoilConfig {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_CONFIG);
    const map = raw ? JSON.parse(raw) : {};
    return map[companyId] || { ...DEFAULT_GAZOIL_CONFIG };
  } catch (e) {
    console.error('Erreur getGazoilConfig:', e);
    return { ...DEFAULT_GAZOIL_CONFIG };
  }
}

export function saveGazoilConfig(
  companyId: string,
  partial: Partial<GazoilConfig>,
  options?: { skipQueue?: boolean }
): GazoilConfig {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_CONFIG);
    const map = raw ? JSON.parse(raw) : {};
    const current = map[companyId] || { ...DEFAULT_GAZOIL_CONFIG };
    const updated: GazoilConfig = { ...current, ...partial };
    map[companyId] = updated;
    safeSetItem(STORAGE_KEYS.GAZOIL_CONFIG, JSON.stringify(map));
    if (!options?.skipQueue) {
      addToSyncQueue('gazoil_config', { id: `gz_cfg_${companyId}`, company_id: companyId, ...updated, updated_at: new Date().toISOString() }, 'upsert');
    }
    notifyListeners();
    return updated;
  } catch (e) {
    console.error('Erreur saveGazoilConfig:', e);
    return { ...DEFAULT_GAZOIL_CONFIG, ...partial };
  }
}

export function setStockInitialGazoil(companyId: string, stockInitial: number): GazoilConfig {
  const current = getGazoilConfig(companyId);
  const updated = saveGazoilConfig(companyId, {
    stockInitial: Math.max(0, stockInitial),
    initialSet: true,
  });

  // Vérifier alertes
  checkAndNotifyStockBas(companyId);
  return updated;
}

export function setSeuilAlerteGazoil(companyId: string, seuilAlerte: number): GazoilConfig {
  const updated = saveGazoilConfig(companyId, {
    seuilAlerte: Math.max(0, seuilAlerte),
  });
  checkAndNotifyStockBas(companyId);
  return updated;
}

export function getGazoilMouvements(companyId: string): GazoilMouvement[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS);
    const all: GazoilMouvement[] = raw ? JSON.parse(raw) : [];
    return all
      .filter((m) => m.company_id === companyId)
      .sort((a, b) => b.timestamp - a.timestamp); // Du plus récent au plus ancien
  } catch (e) {
    console.error('Erreur getGazoilMouvements:', e);
    return [];
  }
}

export function calculerStockGazoil(companyId: string) {
  const config = getGazoilConfig(companyId);
  const mouvements = getGazoilMouvements(companyId);

  let totalEntrees = 0;
  let totalSorties = 0;

  for (const m of mouvements) {
    if (m.type === 'entree') {
      totalEntrees += m.quantite;
    } else if (m.type === 'sortie') {
      totalSorties += m.quantite;
    }
  }

  // Formule demandée : Stock actuel = stock initial + total des entrées − total des sorties
  const stockActuel = Math.max(0, config.stockInitial + totalEntrees - totalSorties);
  const isStockBas = config.initialSet && stockActuel <= config.seuilAlerte;

  return {
    stockInitial: config.stockInitial,
    totalEntrees,
    totalSorties,
    stockActuel,
    seuilAlerte: config.seuilAlerte,
    isStockBas,
    initialSet: config.initialSet,
    commandeActive: config.commandeActive,
  };
}

export function checkAndNotifyStockBas(companyId: string): void {
  const status = calculerStockGazoil(companyId);
  const config = getGazoilConfig(companyId);

  if (!config.initialSet) return;

  const commandeEnCours = !!config.commandeActive?.active;

  if (status.isStockBas) {
    // Si pas encore notifié pour ce passage sous le seuil et pas de commande en cours
    if (!config.notifiedBelowThreshold && !commandeEnCours) {
      sendBrowserNotification(
        'Stock gazoil bas',
        `Stock gazoil bas : ${status.stockActuel} L (seuil : ${config.seuilAlerte} L)`
      );
      // Marquer comme notifié
      saveGazoilConfig(companyId, { notifiedBelowThreshold: true });
    }
  } else {
    // Le stock est repassé au-dessus du seuil : réarmer la notification
    if (config.notifiedBelowThreshold) {
      saveGazoilConfig(companyId, { notifiedBelowThreshold: false });
    }
  }
}

export function addGazoilMouvement(
  companyId: string,
  mvt: {
    type: GazoilMouvementType;
    date: string; // YYYY-MM-DD
    quantite: number;
    engin_ou_tache?: string;
    remarque?: string;
  }
): { success: boolean; error?: string; mvt?: GazoilMouvement } {
  initStorage();

  const quantite = Math.round(Number(mvt.quantite) * 100) / 100;
  if (isNaN(quantite) || quantite <= 0) {
    return { success: false, error: 'Veuillez saisir une quantité en litres supérieure à 0.' };
  }

  const currentStatus = calculerStockGazoil(companyId);

  // Empêcher une sortie supérieure au stock disponible avec message clair
  if (mvt.type === 'sortie') {
    if (quantite > currentStatus.stockActuel) {
      return {
        success: false,
        error: `Impossible d'enregistrer la sortie : la quantité demandée (${quantite} L) dépasse le stock disponible (${currentStatus.stockActuel} L).`,
      };
    }
  }

  const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS);
  const all: GazoilMouvement[] = raw ? JSON.parse(raw) : [];

  const newEntry: GazoilMouvement = {
    id: `gz_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    company_id: companyId,
    type: mvt.type,
    date: mvt.date,
    quantite,
    engin_ou_tache: mvt.engin_ou_tache?.trim() || undefined,
    remarque: mvt.remarque?.trim() || undefined,
    timestamp: Date.now(),
  };

  all.push(newEntry);
  safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify(all));
  addToSyncQueue('gazoil_mouvements', newEntry, 'upsert');

  // Règle : Le badge commande disparaît automatiquement quand une entrée de gazoil est enregistrée
  const config = getGazoilConfig(companyId);
  if (mvt.type === 'entree' && config.commandeActive) {
    saveGazoilConfig(companyId, { commandeActive: null });
  }

  notifyListeners();

  // Vérifier et notifier si nécessaire
  checkAndNotifyStockBas(companyId);

  return { success: true, mvt: newEntry };
}

export function deleteGazoilMouvement(companyId: string, id: string): void {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS);
  let all: GazoilMouvement[] = raw ? JSON.parse(raw) : [];
  all = all.filter((m) => m.id !== id);
  safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify(all));
  addToSyncQueue('gazoil_mouvements', { id, company_id: companyId }, 'delete');
  notifyListeners();
  checkAndNotifyStockBas(companyId);
}

export function lancerCommandeGazoil(
  companyId: string,
  quantite: number,
  dateStr: string,
  fournisseurTel?: string
): void {
  saveGazoilConfig(companyId, {
    commandeActive: {
      active: true,
      quantite,
      date: dateStr,
      fournisseur_tel: fournisseurTel?.trim() || undefined,
      timestamp: Date.now(),
    },
  });
}

export function cloturerCommandeGazoil(companyId: string): void {
  saveGazoilConfig(companyId, {
    commandeActive: null,
  });
}

// ------------------------- BACKUP & RESTORE -------------------------

export interface BackupCounts {
  ouvriers: number;
  taches: number;
  pointages: number;
  affectations: number;
  heuresSupplementaires: number;
  domaines: number;
  companies: number;
  gazoilMouvements: number;
  users?: number;
  serres?: number;
  recoltes?: number;
}

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  schemaVersion?: number | string;
  exportedAt?: string;
  counts: BackupCounts;
  data?: Record<string, unknown>;
}

/**
 * Validation stricte du JSON de sauvegarde avant toute tentative de restauration.
 * Vérifie l'intégrité structurelle, les types et la cohérence sans altérer le stockage existant.
 */
export function validateBackupData(parsed: unknown): BackupValidationResult {
  const defaultCounts: BackupCounts = {
    ouvriers: 0,
    taches: 0,
    pointages: 0,
    affectations: 0,
    heuresSupplementaires: 0,
    domaines: 0,
    companies: 0,
    gazoilMouvements: 0,
    users: 0,
    serres: 0,
    recoltes: 0,
  };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'Le fichier ne contient pas un objet JSON valide.',
      counts: defaultCounts,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Vérifier qu'au moins un jeu de données clé est présent
  const hasCoreData =
    'ouvriers' in obj ||
    'pointages' in obj ||
    'taches' in obj ||
    'domaines' in obj ||
    'companies' in obj ||
    'recoltes' in obj;

  if (!hasCoreData) {
    return {
      valid: false,
      error: 'Le fichier JSON ne contient aucune donnée reconnue pour Lahcen Pointeur (ouvriers, pointages, tâches, récolte).',
      counts: defaultCounts,
    };
  }

  // Validation détaillée de chaque collection
  if ('ouvriers' in obj) {
    if (!Array.isArray(obj.ouvriers)) {
      return { valid: false, error: 'La section "ouvriers" doit être une liste.', counts: defaultCounts };
    }
    for (let i = 0; i < obj.ouvriers.length; i++) {
      const o = obj.ouvriers[i];
      if (!o || typeof o !== 'object' || !o.id || !o.nom || o.numero === undefined) {
        return {
          valid: false,
          error: `Ouvrier invalide à l'index ${i} : champs 'id', 'nom' ou 'numero' manquants.`,
          counts: defaultCounts,
        };
      }
    }
    defaultCounts.ouvriers = obj.ouvriers.length;
  }

  if ('taches' in obj) {
    if (!Array.isArray(obj.taches)) {
      return { valid: false, error: 'La section "taches" doit être une liste.', counts: defaultCounts };
    }
    for (let i = 0; i < obj.taches.length; i++) {
      const t = obj.taches[i];
      if (!t || typeof t !== 'object' || !t.id || !t.code || !t.nom) {
        return {
          valid: false,
          error: `Tâche invalide à l'index ${i} : champs 'id', 'code' ou 'nom' manquants.`,
          counts: defaultCounts,
        };
      }
    }
    defaultCounts.taches = obj.taches.length;
  }

  if ('pointages' in obj) {
    if (!Array.isArray(obj.pointages)) {
      return { valid: false, error: 'La section "pointages" doit être une liste.', counts: defaultCounts };
    }
    for (let i = 0; i < obj.pointages.length; i++) {
      const p = obj.pointages[i];
      if (!p || typeof p !== 'object' || !p.id || !p.ouvrier_id || !p.date || typeof p.present !== 'boolean') {
        return {
          valid: false,
          error: `Pointage invalide à l'index ${i} : id, ouvrier_id, date ou statut de présence manquant.`,
          counts: defaultCounts,
        };
      }
    }
    defaultCounts.pointages = obj.pointages.length;
  }

  if ('affectations' in obj && obj.affectations !== undefined) {
    if (!Array.isArray(obj.affectations)) {
      return { valid: false, error: 'La section "affectations" doit être une liste.', counts: defaultCounts };
    }
    defaultCounts.affectations = obj.affectations.length;
  }

  if ('heuresSupplementaires' in obj && obj.heuresSupplementaires !== undefined) {
    if (!Array.isArray(obj.heuresSupplementaires)) {
      return { valid: false, error: 'La section "heuresSupplementaires" doit être une liste.', counts: defaultCounts };
    }
    defaultCounts.heuresSupplementaires = obj.heuresSupplementaires.length;
  }

  if ('domaines' in obj && obj.domaines !== undefined) {
    if (!Array.isArray(obj.domaines)) {
      return { valid: false, error: 'La section "domaines" doit être une liste.', counts: defaultCounts };
    }
    defaultCounts.domaines = obj.domaines.length;
  }

  if ('companies' in obj && obj.companies !== undefined) {
    if (!Array.isArray(obj.companies)) {
      return { valid: false, error: 'La section "companies" doit être une liste.', counts: defaultCounts };
    }
    defaultCounts.companies = obj.companies.length;
  }

  if ('gazoilMouvements' in obj && obj.gazoilMouvements !== undefined) {
    if (!Array.isArray(obj.gazoilMouvements)) {
      return { valid: false, error: 'La section "gazoilMouvements" doit être une liste.', counts: defaultCounts };
    }
    defaultCounts.gazoilMouvements = obj.gazoilMouvements.length;
  }

  if ('users' in obj && obj.users !== undefined && Array.isArray(obj.users)) {
    defaultCounts.users = obj.users.length;
  }

  if ('serres' in obj && obj.serres !== undefined && Array.isArray(obj.serres)) {
    defaultCounts.serres = obj.serres.length;
  }

  if ('recoltes' in obj && obj.recoltes !== undefined && Array.isArray(obj.recoltes)) {
    defaultCounts.recoltes = obj.recoltes.length;
  }

  return {
    valid: true,
    schemaVersion: (obj.schemaVersion as number | string) || (obj.version as string) || '1.0',
    exportedAt: (obj.exportedAt as string) || (obj.lastBackupDate as string) || undefined,
    counts: defaultCounts,
    data: obj,
  };
}

export function exportBackupJSON(): string {
  initStorage();
  const now = new Date().toISOString();
  safeSetItem(STORAGE_KEYS.LAST_BACKUP_DATE, now);

  const ouvriers = JSON.parse(localStorage.getItem(STORAGE_KEYS.OUVRIERS) || '[]');
  const taches = JSON.parse(localStorage.getItem(STORAGE_KEYS.TACHES) || '[]');
  const pointages = JSON.parse(localStorage.getItem(STORAGE_KEYS.POINTAGES) || '[]');
  const affectations = JSON.parse(localStorage.getItem(STORAGE_KEYS.AFFECTATIONS) || '[]');
  const heuresSupplementaires = JSON.parse(localStorage.getItem(STORAGE_KEYS.HEURES_SUPP) || '[]');
  const domaines = JSON.parse(localStorage.getItem(STORAGE_KEYS.DOMAINES) || '[]');
  const companies = JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANIES) || '[]');
  const gazoilMouvements = JSON.parse(localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS) || '[]');
  const gazoilConfig = JSON.parse(localStorage.getItem(STORAGE_KEYS.GAZOIL_CONFIG) || '{}');
  const activeCompany = localStorage.getItem(STORAGE_KEYS.ACTIVE_COMPANY) || DEFAULT_COMPANY.id;
  const defaultDomaine = localStorage.getItem(STORAGE_KEYS.DEFAULT_DOMAINE) || DEFAULT_DOMAINE_ID;
  const users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]');
  const serres = JSON.parse(localStorage.getItem(STORAGE_KEYS.SERRES) || '[]');
  const recoltes = JSON.parse(localStorage.getItem(STORAGE_KEYS.RECOLTE) || '[]');

  const data = {
    app: 'Lahcen Pointeur',
    schemaVersion: 3,
    version: '3.0',
    exportedAt: now,
    summary: {
      ouvriers: ouvriers.length,
      taches: taches.length,
      pointages: pointages.length,
      affectations: affectations.length,
      heuresSupplementaires: heuresSupplementaires.length,
      domaines: domaines.length,
      companies: companies.length,
      gazoilMouvements: gazoilMouvements.length,
      users: users.length,
      serres: serres.length,
      recoltes: recoltes.length,
    },
    companies,
    activeCompany,
    domaines,
    defaultDomaine,
    ouvriers,
    taches,
    pointages,
    affectations,
    heuresSupplementaires,
    gazoilConfig,
    gazoilMouvements,
    users,
    serres,
    recoltes,
    lastBackupDate: now,
  };
  notifyListeners();
  return JSON.stringify(data, null, 2);
}

export function getLastBackupDate(): string | null {
  return localStorage.getItem(STORAGE_KEYS.LAST_BACKUP_DATE);
}

export function recordBackupDate(): void {
  safeSetItem(STORAGE_KEYS.LAST_BACKUP_DATE, new Date().toISOString());
  notifyListeners();
}

/**
 * Restauration atomique avec rollback garanti et vérification post-restauration.
 * Si une quelconque erreur de parsing, de validation ou de quota survient :
 * l'ancien état exact est restauré sans altération.
 */
export function importBackupJSON(jsonStr: string): {
  success: boolean;
  message: string;
  counts?: BackupCounts;
} {
  // 1. Validation initiale sans toucher au stockage
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      success: false,
      message: 'Erreur de syntaxe JSON : le fichier sélectionné est corrompu ou illisible.',
    };
  }

  const validation = validateBackupData(parsed);
  if (!validation.valid || !validation.data) {
    return {
      success: false,
      message: `Validation échouée : ${validation.error || 'Format invalide'}. Aucune modification n'a été apportée à vos données.`,
      counts: validation.counts,
    };
  }

  const data = validation.data;

  // 2. Création d'un instantané (snapshot) complet pour rollback garanti
  const snapshot: Record<string, string | null> = {};
  for (const key of Object.values(STORAGE_KEYS)) {
    snapshot[key] = localStorage.getItem(key);
  }

  try {
    // 3. Écriture atomique avec safeSetItem
    if (data.companies !== undefined) safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify(data.companies));
    if (data.activeCompany !== undefined && typeof data.activeCompany === 'string') safeSetItem(STORAGE_KEYS.ACTIVE_COMPANY, data.activeCompany);
    if (data.domaines !== undefined) safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(data.domaines));
    if (data.defaultDomaine !== undefined && typeof data.defaultDomaine === 'string') safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, data.defaultDomaine);
    if (data.ouvriers !== undefined) safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(data.ouvriers));
    if (data.taches !== undefined) safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(data.taches));
    if (data.pointages !== undefined) safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify(data.pointages));
    if (data.affectations !== undefined) safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify(data.affectations));
    if (data.heuresSupplementaires !== undefined) safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify(data.heuresSupplementaires));
    if (data.gazoilConfig !== undefined) safeSetItem(STORAGE_KEYS.GAZOIL_CONFIG, JSON.stringify(data.gazoilConfig));
    if (data.gazoilMouvements !== undefined) safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify(data.gazoilMouvements));
    if (data.users !== undefined) safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(data.users));
    if (data.serres !== undefined) safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(data.serres));
    if (data.recoltes !== undefined) safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify(data.recoltes));
    if (data.lastBackupDate !== undefined && typeof data.lastBackupDate === 'string') {
      safeSetItem(STORAGE_KEYS.LAST_BACKUP_DATE, data.lastBackupDate);
    } else {
      safeSetItem(STORAGE_KEYS.LAST_BACKUP_DATE, new Date().toISOString());
    }

    // Vérifier si un dépassement de quota est survenu
    if (quotaErrorMessage) {
      throw new Error("L'espace de stockage local du navigateur est saturé lors de la restauration.");
    }

    // 4. Vérification post-restauration
    const testOuvriers = JSON.parse(localStorage.getItem(STORAGE_KEYS.OUVRIERS) || '[]');
    const testPointages = JSON.parse(localStorage.getItem(STORAGE_KEYS.POINTAGES) || '[]');
    if (data.ouvriers && testOuvriers.length !== (data.ouvriers as unknown[]).length) {
      throw new Error('Vérification post-restauration échouée : divergence sur le nombre d’ouvriers.');
    }
    if (data.pointages && testPointages.length !== (data.pointages as unknown[]).length) {
      throw new Error('Vérification post-restauration échouée : divergence sur le nombre de pointages.');
    }

    notifyListeners();
    return {
      success: true,
      message: `Données restaurées avec succès (${validation.counts.ouvriers} ouvriers, ${validation.counts.taches} tâches, ${validation.counts.pointages} pointages, ${validation.counts.affectations} affectations, ${validation.counts.heuresSupplementaires} heures sup, ${validation.counts.recoltes || 0} récoltes).`,
      counts: validation.counts,
    };
  } catch (err: unknown) {
    // 5. ROLLBACK INTÉGRAL EN CAS D'ERREUR
    console.error('Erreur durant la restauration, exécution du rollback complet:', err);
    for (const [key, val] of Object.entries(snapshot)) {
      if (val === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, val);
      }
    }
    notifyListeners();
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return {
      success: false,
      message: `Restauration interrompue et état précédent remis en place sans perte : ${msg}`,
      counts: validation.counts,
    };
  }
}

export function resetAllDataToDefault(): void {
  safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify([DEFAULT_COMPANY]));
  safeSetItem(STORAGE_KEYS.ACTIVE_COMPANY, DEFAULT_COMPANY.id);
  safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(DEFAULT_DOMAINES));
  safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, DEFAULT_DOMAINE_ID);
  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify(DEFAULT_OUVRIERS));
  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(DEFAULT_TACHES));
  safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.GAZOIL_CONFIG, JSON.stringify({}));
  safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify([]));
  notifyListeners();
}

/**
 * Effacement complet et irréversible de toutes les données locales
 */
export function clearAllDataPermanently(): void {
  localStorage.removeItem(STORAGE_KEYS.OUVRIERS);
  localStorage.removeItem(STORAGE_KEYS.TACHES);
  localStorage.removeItem(STORAGE_KEYS.POINTAGES);
  localStorage.removeItem(STORAGE_KEYS.AFFECTATIONS);
  localStorage.removeItem(STORAGE_KEYS.HEURES_SUPP);
  localStorage.removeItem(STORAGE_KEYS.GAZOIL_CONFIG);
  localStorage.removeItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS);
  localStorage.removeItem(STORAGE_KEYS.LAST_BACKUP_DATE);

  // Recréer structure minimale vide
  safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify([DEFAULT_COMPANY]));
  safeSetItem(STORAGE_KEYS.ACTIVE_COMPANY, DEFAULT_COMPANY.id);
  safeSetItem(STORAGE_KEYS.DOMAINES, JSON.stringify(DEFAULT_DOMAINES));
  safeSetItem(STORAGE_KEYS.DEFAULT_DOMAINE, DEFAULT_DOMAINE_ID);
  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify(DEFAULT_TACHES));
  safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.HEURES_SUPP, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.GAZOIL_CONFIG, JSON.stringify({}));
  safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.USERS, JSON.stringify([GUEST_USER]));
  safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(GUEST_USER));
  safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(DEFAULT_SERRES));
  safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify([]));
  safeSetItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify([]));
  notifyListeners();
}

// ------------------------- GESTION MULTI-COMPTES & AUTHENTIFICATION -------------------------

export function getUsers(): UserAccount[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USERS);
    const users: UserAccount[] = raw ? JSON.parse(raw) : [];
    if (users.length === 0) {
      return [GUEST_USER];
    }
    return users;
  } catch (e) {
    console.error('Erreur getUsers:', e);
    return [GUEST_USER];
  }
}

export function getUserById(id: string): UserAccount | undefined {
  return getUsers().find((u) => u.id === id);
}

export async function saveUser(data: {
  id?: string;
  username: string;
  nom: string;
  role: UserRole;
  password?: string;
  actif?: boolean;
  telephone?: string;
}): Promise<{ success: boolean; error?: string; user?: UserAccount }> {
  initStorage();
  const usernameClean = data.username.trim().toLowerCase();
  const nomClean = data.nom.trim();

  if (!usernameClean || usernameClean.length < 3) {
    return { success: false, error: "L'identifiant doit comporter au moins 3 caractères." };
  }
  if (!nomClean) {
    return { success: false, error: 'Le nom de la personne est obligatoire.' };
  }

  const allUsers = getUsers();
  const existingWithUsername = allUsers.find(
    (u) => u.username.toLowerCase() === usernameClean && u.id !== data.id
  );
  if (existingWithUsername) {
    return { success: false, error: `L'identifiant "${usernameClean}" est déjà utilisé.` };
  }

  let userToSave: UserAccount;

  if (data.id) {
    // Modification d'un utilisateur existant
    const idx = allUsers.findIndex((u) => u.id === data.id);
    if (idx === -1) {
      return { success: false, error: 'Utilisateur introuvable.' };
    }
    const current = allUsers[idx];
    let passwordHash = current.passwordHash;
    let salt = current.salt;

    if (data.password && data.password.trim()) {
      salt = generateSalt();
      passwordHash = await hashPassword(data.password.trim(), salt);
    }

    userToSave = {
      ...current,
      username: usernameClean,
      nom: nomClean,
      role: current.id === 'usr_admin' ? 'admin' : data.role, // Le compte admin principal reste admin
      actif: current.id === 'usr_admin' ? true : (data.actif ?? current.actif),
      telephone: data.telephone?.trim() || undefined,
      passwordHash,
      salt,
    };
    allUsers[idx] = userToSave;
  } else {
    // Création d'un nouvel utilisateur (caporal ou sous-admin)
    if (!data.password || data.password.trim().length < 4) {
      return { success: false, error: 'Le mot de passe doit comporter au moins 4 caractères.' };
    }
    const salt = generateSalt();
    const passwordHash = await hashPassword(data.password.trim(), salt);

    userToSave = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: usernameClean,
      nom: nomClean,
      role: data.role,
      company_id: (data as any).company_id || getActiveCompanyId(),
      passwordHash,
      salt,
      actif: data.actif ?? true,
      telephone: data.telephone?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    allUsers.push(userToSave);
  }

  safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(allUsers));
  notifyListeners();
  return { success: true, user: userToSave };
}

export function toggleUserActif(id: string): { success: boolean; error?: string; actif?: boolean } {
  if (id === 'usr_admin') {
    return { success: false, error: 'Impossible de désactiver le compte administrateur principal.' };
  }
  const allUsers = getUsers();
  const user = allUsers.find((u) => u.id === id);
  if (!user) {
    return { success: false, error: 'Utilisateur introuvable.' };
  }
  user.actif = !user.actif;
  safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(allUsers));
  notifyListeners();
  return { success: true, actif: user.actif };
}

export function deleteUser(id: string): { success: boolean; error?: string } {
  if (id === 'usr_admin') {
    return { success: false, error: 'Impossible de supprimer le compte administrateur principal.' };
  }
  const allUsers = getUsers().filter((u) => u.id !== id);
  safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(allUsers));
  notifyListeners();
  return { success: true };
}

export async function authenticateUser(
  username: string,
  passwordPlain: string
): Promise<{ success: boolean; error?: string; user?: UserAccount }> {
  initStorage();
  const cleanUsername = username.trim().toLowerCase();
  const allUsers = getUsers();
  const user = allUsers.find((u) => u.username.toLowerCase() === cleanUsername);

  if (!user) {
    return { success: false, error: 'Identifiant ou mot de passe incorrect.' };
  }
  if (!user.actif) {
    return { success: false, error: 'Ce compte a été désactivé par l’administrateur.' };
  }

  const isValid = await verifyPassword(passwordPlain.trim(), user.salt || '', user.passwordHash || '');
  if (!isValid) {
    return { success: false, error: 'Identifiant ou mot de passe incorrect.' };
  }

  // Mettre à jour lastLogin
  user.lastLogin = new Date().toISOString();
  safeSetItem(STORAGE_KEYS.USERS, JSON.stringify(allUsers));
  setCurrentUser(user);
  return { success: true, user };
}

export function getCurrentUser(): UserAccount {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (!raw) return GUEST_USER;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id ? parsed : GUEST_USER;
  } catch {
    return GUEST_USER;
  }
}

export function setCurrentUser(user: UserAccount): void {
  safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  notifyListeners();
}

export function logoutUser(): void {
  // Déconnexion : retour au compte invité/admin ou réinitialisation
  safeSetItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(GUEST_USER));
  notifyListeners();
}

// ------------------------- GESTION DES SERRES (GREENHOUSES) -------------------------

export function getSerres(companyId: string): Serre[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SERRES);
    const all: Serre[] = raw ? JSON.parse(raw) : [];
    const filtered = all.filter(
      (s) => !isAnomalousDuplicateSerre23(s) && (s.company_id === companyId || !s.company_id)
    );
    if (filtered.length === 0) {
      return DEFAULT_SERRES;
    }
    return filtered.sort((a, b) => a.ordre - b.ordre);
  } catch (e) {
    console.error('Erreur getSerres:', e);
    return DEFAULT_SERRES;
  }
}

export function reconcileSerresFromRemote(
  remoteSerres: Serre[],
  remoteDomaines?: Domaine[]
): void {
  initStorage();
  let changed = false;

  if (Array.isArray(remoteDomaines) && remoteDomaines.length > 0) {
    try {
      const localDomsRaw = localStorage.getItem(STORAGE_KEYS.DOMAINES);
      const localDoms: Domaine[] = localDomsRaw ? JSON.parse(localDomsRaw) : [...DEFAULT_DOMAINES];
      const domMap = new Map<string, Domaine>(localDoms.map((d) => [d.id, d]));
      remoteDomaines.forEach((rd) => {
        if (rd && rd.id) {
          domMap.set(rd.id, { id: rd.id, nom: rd.nom, ordre: rd.ordre });
        }
      });
      const nextDoms = Array.from(domMap.values()).sort((a, b) => a.ordre - b.ordre);
      const nextJson = JSON.stringify(nextDoms);
      if (nextJson !== localDomsRaw) {
        safeSetItem(STORAGE_KEYS.DOMAINES, nextJson);
        changed = true;
      }
    } catch {
      // ignore
    }
  }

  if (Array.isArray(remoteSerres) && remoteSerres.length > 0) {
    try {
      const localRaw = localStorage.getItem(STORAGE_KEYS.SERRES);
      const localList: Serre[] = localRaw ? JSON.parse(localRaw) : [];
      const mergedMap = new Map<string, Serre>();

      // Conserver d'abord les serres locales valides (sauf anomalie serre_23)
      for (const ls of localList) {
        if (ls && ls.id && !isAnomalousDuplicateSerre23(ls)) {
          mergedMap.set(ls.id, ls);
        }
      }

      // Fusionner les serres officielles distantes (en excluant toute anomalie serre_23)
      const remoteIds = new Set<string>();
      for (const rs of remoteSerres) {
        if (!rs || !rs.id || isAnomalousDuplicateSerre23(rs)) continue;
        remoteIds.add(rs.id);
        mergedMap.set(rs.id, {
          ...mergedMap.get(rs.id),
          ...rs,
        });
      }

      // Retirer les serres canoniques obsolètes (ex: serre_23) si le serveur fait autorité
      if (remoteIds.size > 0 && mergedMap.has('serre_23') && !remoteIds.has('serre_23')) {
        mergedMap.delete('serre_23');
      }

      const mergedList = Array.from(mergedMap.values()).sort((a, b) => a.ordre - b.ordre);
      const nextJson = JSON.stringify(mergedList);
      if (nextJson !== localRaw) {
        safeSetItem(STORAGE_KEYS.SERRES, nextJson);
        changed = true;
      }
    } catch {
      // ignore
    }
  }

  if (changed) {
    notifyListeners();
  }
}

export function getSerresForDomaine(
  serres: Serre[],
  domaineId: string,
  domaines: Domaine[] = []
): Serre[] {
  const activeSerres = (serres || []).filter(
    (s) => s.actif !== false && !isAnomalousDuplicateSerre23(s)
  );
  if (!domaineId) return [];

  const domObj = domaines.find((d) => d.id === domaineId);
  const domNomUpper = (domObj?.nom || '').trim().toUpperCase();
  const domIdLower = domaineId.trim().toLowerCase();
  const isD2 = domIdLower === 'dom_d2' || domNomUpper === 'D2';

  return activeSerres
    .filter((s) => {
      const sDom = (s.domaine_id || '').trim();
      if (!sDom) {
        // Les serres historiques enregistrées sans domaine_id appartiennent uniquement à D2
        return isD2;
      }
      const sDomLower = sDom.toLowerCase();
      const sDomUpper = sDom.toUpperCase();
      return (
        sDomLower === domIdLower ||
        (domNomUpper !== '' && (sDomUpper === domNomUpper || sDomUpper === `DOM_${domNomUpper}`))
      );
    })
    .sort((a, b) => a.ordre - b.ordre);
}

export function saveSerre(
  companyId: string,
  data: { id?: string; code: string; nom: string; actif?: boolean; domaine_id?: string | null }
): { success: boolean; error?: string; serre?: Serre } {
  initStorage();
  const codeClean = data.code.trim().toUpperCase();
  const nomClean = data.nom.trim();

  if (!codeClean) {
    return { success: false, error: 'Le code de la serre est obligatoire (ex: S01).' };
  }
  if (!nomClean) {
    return { success: false, error: 'Le nom de la serre est obligatoire.' };
  }

  const raw = localStorage.getItem(STORAGE_KEYS.SERRES);
  const all: Serre[] = raw ? JSON.parse(raw) : [...DEFAULT_SERRES];

  // Vérifier unicité du code
  const duplicate = all.find(
    (s) => s.code.toUpperCase() === codeClean && s.id !== data.id && (s.company_id === companyId || !s.company_id)
  );
  if (duplicate) {
    return { success: false, error: `Le code "${codeClean}" est déjà utilisé par "${duplicate.nom}".` };
  }

  let resultSerre: Serre;

  if (data.id) {
    const idx = all.findIndex((s) => s.id === data.id && (s.company_id === companyId || !s.company_id));
    if (idx === -1) {
      resultSerre = {
        id: data.id,
        company_id: companyId,
        code: codeClean,
        nom: nomClean,
        actif: data.actif ?? true,
        ordre: all.length + 1,
        domaine_id: data.domaine_id ?? null,
      };
      all.push(resultSerre);
    } else {
      resultSerre = {
        ...all[idx],
        company_id: all[idx].company_id || companyId,
        code: codeClean,
        nom: nomClean,
        actif: data.actif ?? all[idx].actif,
        domaine_id: data.domaine_id !== undefined ? data.domaine_id : all[idx].domaine_id,
      };
      all[idx] = resultSerre;
    }
  } else {
    resultSerre = {
      id: `serre_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      company_id: companyId,
      code: codeClean,
      nom: nomClean,
      actif: data.actif ?? true,
      ordre: all.length + 1,
      domaine_id: data.domaine_id ?? null,
    };
    all.push(resultSerre);
  }

  safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(all));
  addToSyncQueue('serres', resultSerre, 'upsert');
  notifyListeners();
  return { success: true, serre: resultSerre };
}

export function deleteSerre(id: string): { success: boolean; error?: string } {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.SERRES);
  let all: Serre[] = raw ? JSON.parse(raw) : [];
  const target = all.find((s) => s.id === id);
  all = all.filter((s) => s.id !== id);
  safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(all));
  addToSyncQueue('serres', { id, company_id: target?.company_id || getActiveCompanyId() }, 'delete');
  notifyListeners();
  return { success: true };
}

export function toggleSerreActif(id: string): void {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.SERRES);
  const all: Serre[] = raw ? JSON.parse(raw) : [];
  const target = all.find((s) => s.id === id);
  if (target) {
    target.actif = !target.actif;
    safeSetItem(STORAGE_KEYS.SERRES, JSON.stringify(all));
    addToSyncQueue('serres', target, 'upsert');
    notifyListeners();
  }
}

// ------------------------- MODULE RÉCOLTE (HARVEST) -------------------------

export function getRecoltes(companyId: string, filter?: RecolteFilter): RecolteEntry[] {
  initStorage();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.RECOLTE);
    let all: RecolteEntry[] = raw ? JSON.parse(raw) : [];

    all = all.filter((r) => r.company_id === companyId || !r.company_id);

    if (filter) {
      if (filter.date) {
        all = all.filter((r) => r.date === filter.date);
      }
      if (filter.startDate && filter.endDate) {
        all = all.filter((r) => r.date >= filter.startDate! && r.date <= filter.endDate!);
      }
      if (filter.serre_id) {
        all = all.filter((r) => r.serre_id === filter.serre_id);
      }
      if (filter.ouvrier_id) {
        all = all.filter((r) => r.ouvrier_id === filter.ouvrier_id);
      }
      if (filter.created_by_id) {
        all = all.filter((r) => r.created_by_id === filter.created_by_id);
      }
    }

    // Du plus récent au plus ancien
    return all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  } catch (e) {
    console.error('Erreur getRecoltes:', e);
    return [];
  }
}

export function addRecolteEntries(
  companyId: string,
  entries: Array<{
    date: string;
    serre_id: string;
    serre_nom: string;
    ouvrier_id: string;
    numero_ouvrier: number;
    nom_ouvrier: string;
    caisses: number;
    notes?: string;
    type_operation?: RecolteOperationType;
    domaine_id?: string | null;
  }>,
  author: { id: string; nom: string }
): { success: boolean; error?: string; count: number; added: RecolteEntry[] } {
  initStorage();

  if (!entries || entries.length === 0) {
    return { success: false, error: 'Aucun ouvrier sélectionné pour l\'opération.', count: 0, added: [] };
  }

  // Validation stricte des quantités
  for (const item of entries) {
    const qty = Number(item.caisses);
    if (isNaN(qty) || qty <= 0) {
      return {
        success: false,
        error: `Quantité invalide (${item.caisses}) pour l'ouvrier #${item.numero_ouvrier} ${item.nom_ouvrier}. Le nombre de caisses doit être supérieur à 0.`,
        count: 0,
        added: [],
      };
    }
  }

  const raw = localStorage.getItem(STORAGE_KEYS.RECOLTE);
  const all: RecolteEntry[] = raw ? JSON.parse(raw) : [];

  const now = new Date().toISOString();
  const addedList: RecolteEntry[] = [];

  for (const item of entries) {
    const newEntry: RecolteEntry = {
      id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      company_id: companyId,
      date: item.date,
      type_operation: item.type_operation || 'RECOLTE',
      domaine_id: item.domaine_id || null,
      serre_id: item.serre_id,
      serre_nom: item.serre_nom,
      ouvrier_id: item.ouvrier_id,
      numero_ouvrier: Number(item.numero_ouvrier),
      nom_ouvrier: item.nom_ouvrier,
      caisses: Math.round(Number(item.caisses) * 10) / 10,
      notes: item.notes?.trim() || undefined,
      created_by_id: author.id,
      created_by_nom: author.nom,
      created_at: now,
      sync_status: 'pending',
    };
    all.push(newEntry);
    addedList.push(newEntry);
  }

  safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify(all));

  // Ajouter à la file d'attente de synchronisation réseau
  queuePendingSync(addedList);

  notifyListeners();

  // Déclencher la synchronisation en arrière-plan si réseau disponible
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    syncRecolteWithServer(companyId).catch(() => {});
  }

  return { success: true, count: addedList.length, added: addedList };
}

export function updateRecolteEntry(
  id: string,
  partial: {
    caisses?: number;
    notes?: string;
    date?: string;
    serre_id?: string;
    serre_nom?: string;
    type_operation?: RecolteOperationType;
    domaine_id?: string | null;
  },
  updatedBy: { id: string; nom: string }
): { success: boolean; error?: string; entry?: RecolteEntry } {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.RECOLTE);
  const all: RecolteEntry[] = raw ? JSON.parse(raw) : [];
  const idx = all.findIndex((r) => r.id === id);

  if (idx === -1) {
    return { success: false, error: 'Enregistrement introuvable.' };
  }

  if (partial.caisses !== undefined) {
    const qty = Number(partial.caisses);
    if (isNaN(qty) || qty <= 0) {
      return { success: false, error: 'La quantité doit être un nombre supérieur à 0.' };
    }
  }

  const current = all[idx];
  const updated: RecolteEntry = {
    ...current,
    caisses: partial.caisses !== undefined ? Math.round(Number(partial.caisses) * 10) / 10 : current.caisses,
    notes: partial.notes !== undefined ? (partial.notes.trim() || undefined) : current.notes,
    date: partial.date || current.date,
    type_operation: partial.type_operation || current.type_operation || 'RECOLTE',
    domaine_id: partial.domaine_id !== undefined ? partial.domaine_id : current.domaine_id,
    serre_id: partial.serre_id || current.serre_id,
    serre_nom: partial.serre_nom || current.serre_nom,
    updated_at: new Date().toISOString(),
    updated_by_id: updatedBy.id,
    sync_status: 'pending',
  };

  all[idx] = updated;
  safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify(all));

  queuePendingSync([updated]);
  notifyListeners();

  if (typeof navigator !== 'undefined' && navigator.onLine) {
    syncRecolteWithServer(updated.company_id).catch(() => {});
  }

  return { success: true, entry: updated };
}

export function deleteRecolteEntry(id: string): { success: boolean; error?: string } {
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.RECOLTE);
  let all: RecolteEntry[] = raw ? JSON.parse(raw) : [];
  const target = all.find((r) => r.id === id);
  const companyId = target?.company_id || getActiveCompanyId();
  all = all.filter((r) => r.id !== id);
  safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify(all));
  enqueueOutboxOp(OUTBOX_KEYS.RECOLTE, {
    table: 'recolte_entries',
    entityId: id,
    action: 'delete',
    data: { id, company_id: companyId },
    companyId,
  });
  notifyListeners();
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    syncRecolteWithServer(companyId).catch(() => {});
  }
  return { success: true };
}

export function calculateRecolteStats(entries: RecolteEntry[]): RecolteStats {
  let totalCaisses = 0;
  const ouvriersSet = new Set<string>();
  const serresSet = new Set<string>();

  for (const e of entries) {
    totalCaisses += e.caisses || 0;
    ouvriersSet.add(e.ouvrier_id);
    if (e.serre_id) serresSet.add(e.serre_id);
  }

  return {
    totalCaisses: Math.round(totalCaisses * 10) / 10,
    totalOuvriersDistincts: ouvriersSet.size,
    totalSerres: serresSet.size,
    totalOperations: entries.length,
  };
}

// ------------------------- RÉCONCILIATION MULTI-APPAREILS (TOUS MODULES) -------------------------

const DEFAULT_WORKER_NAME_BY_ID = new Map(DEFAULT_OUVRIERS.map((o) => [o.id, o.nom]));

export function isProvisionalDefaultOuvrier(o: Partial<Ouvrier> | null | undefined): boolean {
  if (!o || !o.id) return false;
  const defaultNom = DEFAULT_WORKER_NAME_BY_ID.get(o.id);
  return Boolean(defaultNom && o.nom === defaultNom);
}

export function reconcileCompaniesFromRemote(remoteCompanies: Company[]): void {
  if (!Array.isArray(remoteCompanies) || remoteCompanies.length === 0) return;
  initStorage();
  const local = getCompanies();
  const merged = mergeCollectionWithConflictLog<Company>({
    table: 'companies',
    queueKey: OUTBOX_KEYS.REFERENTIELS,
    localItems: local,
    remoteItems: remoteCompanies,
    getId: (c) => c.id,
    preserveLocalNotInRemote: true,
  });
  safeSetItem(STORAGE_KEYS.COMPANIES, JSON.stringify(merged));
  notifyListeners();
}

export function reconcileOuvriersFromRemote(companyId: string, remoteOuvriers: Ouvrier[]): void {
  if (!Array.isArray(remoteOuvriers) || remoteOuvriers.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.OUVRIERS);
  const allLocal: Ouvrier[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((o) => o.company_id !== companyId);
  const companyLocal = allLocal.filter((o) => o.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<Ouvrier>({
    table: 'ouvriers',
    queueKey: OUTBOX_KEYS.REFERENTIELS,
    localItems: companyLocal,
    remoteItems: remoteOuvriers.filter((o) => !o.company_id || o.company_id === companyId).map((o) => ({ ...o, company_id: o.company_id || companyId })),
    getId: (o) => o.id,
    getCompanyId: (o) => o.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
    isProvisionalLocal: isProvisionalDefaultOuvrier,
  }).sort((a, b) => a.numero - b.numero);

  safeSetItem(STORAGE_KEYS.OUVRIERS, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

export function reconcileTachesFromRemote(companyId: string, remoteTaches: Tache[]): void {
  if (!Array.isArray(remoteTaches) || remoteTaches.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.TACHES);
  const allLocal: Tache[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((t) => t.company_id !== companyId);
  const companyLocal = allLocal.filter((t) => t.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<Tache>({
    table: 'taches',
    queueKey: OUTBOX_KEYS.REFERENTIELS,
    localItems: companyLocal,
    remoteItems: remoteTaches.filter((t) => !t.company_id || t.company_id === companyId).map((t) => ({ ...t, company_id: t.company_id || companyId })),
    getId: (t) => t.id,
    getCompanyId: (t) => t.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  });

  safeSetItem(STORAGE_KEYS.TACHES, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

export function reconcilePointagesFromRemote(companyId: string, remotePointages: Pointage[]): void {
  if (!Array.isArray(remotePointages) || remotePointages.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.POINTAGES);
  const allLocal: Pointage[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((p) => p.company_id !== companyId);
  const companyLocal = allLocal.filter((p) => p.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<Pointage>({
    table: 'pointages',
    queueKey: OUTBOX_KEYS.POINTAGE,
    localItems: companyLocal,
    remoteItems: remotePointages.filter((p) => !p.company_id || p.company_id === companyId).map((p) => ({ ...p, company_id: p.company_id || companyId })),
    getId: (p) => p.id,
    getCompanyId: (p) => p.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  });

  safeSetItem(STORAGE_KEYS.POINTAGES, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

export function reconcileAffectationsFromRemote(companyId: string, remoteAffs: AffectationTache[]): void {
  if (!Array.isArray(remoteAffs) || remoteAffs.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.AFFECTATIONS);
  const allLocal: AffectationTache[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((a) => a.company_id !== companyId);
  const companyLocal = allLocal.filter((a) => a.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<AffectationTache>({
    table: 'affectations',
    queueKey: OUTBOX_KEYS.POINTAGE,
    localItems: companyLocal,
    remoteItems: remoteAffs.filter((a) => !a.company_id || a.company_id === companyId).map((a) => ({ ...a, company_id: a.company_id || companyId })),
    getId: (a) => a.id,
    getCompanyId: (a) => a.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  });

  safeSetItem(STORAGE_KEYS.AFFECTATIONS, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

export function reconcileTacheSerresFromRemote(companyId: string, remoteConfigs: TacheSerreConfig[]): void {
  if (!Array.isArray(remoteConfigs) || remoteConfigs.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.TACHE_SERRES);
  const allLocal: TacheSerreConfig[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((c) => c.company_id !== companyId);
  const companyLocal = allLocal.filter((c) => c.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<TacheSerreConfig>({
    table: 'tache_serres',
    queueKey: OUTBOX_KEYS.POINTAGE,
    localItems: companyLocal,
    remoteItems: remoteConfigs.map((c) => ({
      ...c,
      id: c.id || `ts_${c.company_id || companyId}_${c.date}_${c.tache_id}`,
      company_id: c.company_id || companyId,
    })),
    getId: (c) => c.id,
    getCompanyId: (c) => c.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  });

  safeSetItem(STORAGE_KEYS.TACHE_SERRES, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

export function reconcileRecoltesFromRemote(companyId: string, remoteEntries: RecolteEntry[]): void {
  if (!Array.isArray(remoteEntries) || remoteEntries.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.RECOLTE);
  const allLocal: RecolteEntry[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((r) => r.company_id !== companyId);
  const companyLocal = allLocal.filter((r) => r.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<RecolteEntry>({
    table: 'recolte_entries',
    queueKey: OUTBOX_KEYS.RECOLTE,
    localItems: companyLocal,
    remoteItems: remoteEntries
      .filter((r) => !r.company_id || r.company_id === companyId)
      .map((r) => ({ ...r, company_id: r.company_id || companyId, sync_status: 'synced' as const })),
    getId: (r) => r.id,
    getCompanyId: (r) => r.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  });

  // Conserver sync_status = 'pending' uniquement pour les entrées encore dans l'outbox RECOLTE
  const pendingIds = new Set(
    getOutboxOps(OUTBOX_KEYS.RECOLTE)
      .filter((o) => o.action === 'upsert')
      .map((o) => o.entityId)
  );
  const finalCompany = mergedCompany.map((r) => ({
    ...r,
    sync_status: pendingIds.has(r.id) ? ('pending' as const) : ('synced' as const),
  }));

  safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify([...otherCompanies, ...finalCompany]));
  notifyListeners();
}

export function reconcileGazoilConfigFromRemote(companyId: string, remoteConfig: any): void {
  if (!remoteConfig || typeof remoteConfig !== 'object') return;
  const pending = getOutboxOps(OUTBOX_KEYS.GAZOIL).some(
    (op) => op.table === 'gazoil_config' && op.companyId === companyId
  );
  if (pending) return;

  const normalized: Partial<GazoilConfig> = {
    stockInitial:
      remoteConfig.stockInitial ?? remoteConfig.stock_initial ?? DEFAULT_GAZOIL_CONFIG.stockInitial,
    initialSet:
      remoteConfig.initialSet ?? remoteConfig.initial_set ?? DEFAULT_GAZOIL_CONFIG.initialSet,
    seuilAlerte:
      remoteConfig.seuilAlerte ?? remoteConfig.seuil_alerte ?? DEFAULT_GAZOIL_CONFIG.seuilAlerte,
    commandeActive:
      remoteConfig.commandeActive !== undefined
        ? remoteConfig.commandeActive
        : remoteConfig.commande_active ?? null,
    notifiedBelowThreshold:
      remoteConfig.notifiedBelowThreshold ?? remoteConfig.notified_below_threshold ?? false,
  };
  saveGazoilConfig(companyId, normalized, { skipQueue: true });
}

export function reconcileGazoilMouvementsFromRemote(
  companyId: string,
  remoteMouvements: GazoilMouvement[]
): void {
  if (!Array.isArray(remoteMouvements) || remoteMouvements.length === 0) return;
  initStorage();
  const raw = localStorage.getItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS);
  const allLocal: GazoilMouvement[] = raw ? JSON.parse(raw) : [];
  const otherCompanies = allLocal.filter((m) => m.company_id !== companyId);
  const companyLocal = allLocal.filter((m) => m.company_id === companyId);

  const mergedCompany = mergeCollectionWithConflictLog<GazoilMouvement>({
    table: 'gazoil_mouvements',
    queueKey: OUTBOX_KEYS.GAZOIL,
    localItems: companyLocal,
    remoteItems: remoteMouvements
      .filter((m) => !m.company_id || m.company_id === companyId)
      .map((m) => ({ ...m, company_id: m.company_id || companyId })),
    getId: (m) => m.id,
    getCompanyId: (m) => m.company_id,
    scopedCompanyId: companyId,
    preserveLocalNotInRemote: true,
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  safeSetItem(STORAGE_KEYS.GAZOIL_MOUVEMENTS, JSON.stringify([...otherCompanies, ...mergedCompany]));
  notifyListeners();
}

// ------------------------- SYNCHRONISATION MULTI-APPAREILS (SERVEUR / PWA) -------------------------

function queuePendingSync(entries: RecolteEntry[]): void {
  try {
    migrateLegacySyncQueue();
    for (const e of entries) {
      enqueueOutboxOp(OUTBOX_KEYS.RECOLTE, {
        table: 'recolte_entries',
        entityId: e.id,
        action: 'upsert',
        data: e,
        companyId: e.company_id,
      });
    }
  } catch (err) {
    console.error('Erreur queuePendingSync:', err);
  }
}

export async function syncRecolteWithServer(
  companyId: string,
  options?: { accessToken?: string; baseUrl?: string; ignoreNavigatorOnline?: boolean }
): Promise<{
  success: boolean;
  syncedCount: number;
  receivedCount: number;
  error?: string;
}> {
  if (!options?.ignoreNavigatorOnline && typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, syncedCount: 0, receivedCount: 0, error: 'Hors connexion' };
  }

  try {
    migrateLegacySyncQueue();

    let accessToken = options?.accessToken;
    if (!accessToken) {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token;
    }
    if (!accessToken) {
      return { success: false, syncedCount: 0, receivedCount: 0, error: 'Session authentifiée requise' };
    }

    const allOps = getOutboxOps(OUTBOX_KEYS.RECOLTE);
    const scopedOps = allOps.filter(
      (op) => op.table === 'recolte_entries' && (!op.companyId || op.companyId === companyId)
    );
    const pendingEntries = scopedOps
      .filter((op) => op.action === 'upsert' && op.data)
      .map((op) => op.data as RecolteEntry);
    const deletedIds = scopedOps
      .filter((op) => op.action === 'delete' && op.entityId)
      .map((op) => op.entityId);

    const apiPrefix = options?.baseUrl || '';
    const response = await fetch(`${apiPrefix}/api/recolte/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'x-company-id': companyId,
      },
      body: JSON.stringify({
        companyId,
        pendingEntries,
        deletedIds,
        lastSyncTimestamp: 0, // Récupération complète non destructive pour les changements d'appareil
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Serveur indisponible');
      markOutboxOpsFailed(
        OUTBOX_KEYS.RECOLTE,
        scopedOps.map((o) => o.opId),
        `HTTP ${response.status}: ${errText}`
      );
      return { success: false, syncedCount: 0, receivedCount: 0, error: 'Serveur indisponible' };
    }

    const result = await response.json();
    if (!result.success) {
      markOutboxOpsFailed(
        OUTBOX_KEYS.RECOLTE,
        scopedOps.map((o) => o.opId),
        result.error || 'Sync refusée'
      );
      return { success: false, syncedCount: 0, receivedCount: 0, error: result.error };
    }

    // Défilement atomique uniquement des opérations confirmées par opId (ne perd aucun ajout en cours de vol)
    dequeueOutboxOpsById(
      OUTBOX_KEYS.RECOLTE,
      scopedOps.map((o) => o.opId)
    );

    const serverEntries: RecolteEntry[] = Array.isArray(result.allEntries) ? result.allEntries : [];
    if (serverEntries.length > 0) {
      reconcileRecoltesFromRemote(companyId, serverEntries);
    } else {
      // Mettre simplement à jour le sync_status des entrées locales non en attente
      const rawLocal = localStorage.getItem(STORAGE_KEYS.RECOLTE);
      const localEntries: RecolteEntry[] = rawLocal ? JSON.parse(rawLocal) : [];
      const stillPending = new Set(getOutboxOps(OUTBOX_KEYS.RECOLTE).map((o) => o.entityId));
      const updatedLocal = localEntries.map((item) =>
        item.company_id === companyId
          ? { ...item, sync_status: stillPending.has(item.id) ? ('pending' as const) : ('synced' as const) }
          : item
      );
      safeSetItem(STORAGE_KEYS.RECOLTE, JSON.stringify(updatedLocal));
      notifyListeners();
    }

    return {
      success: true,
      syncedCount: scopedOps.length,
      receivedCount: serverEntries.length,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur réseau';
    const allOps = getOutboxOps(OUTBOX_KEYS.RECOLTE).filter(
      (op) => op.table === 'recolte_entries' && (!op.companyId || op.companyId === companyId)
    );
    markOutboxOpsFailed(OUTBOX_KEYS.RECOLTE, allOps.map((o) => o.opId), msg);
    return { success: false, syncedCount: 0, receivedCount: 0, error: msg };
  }
}
