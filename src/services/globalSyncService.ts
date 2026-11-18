/**
 * Orchestrateur global de persistance et de synchronisation bidirectionnelle
 * LAHCEN POINTEUR / AGRIPOINTEUR
 *
 * - Garantit que Supabase (et le backend API Express associé) est la source de vérité persistante
 * - Utilise localStorage comme cache de lecture rapide et outbox persistante hors ligne
 * - Exécute toujours dans l'ordre :
 *   1. Migration d'éventuelles files historiques (LEGACY_SYNC_QUEUE_KEY)
 *   2. Vidage (push) des outboxes locales autorisées avant toute lecture distante
 *   3. Hydratation & fusion LWW non-destructive depuis le serveur / Supabase
 * - Respecte strictement le cloisonnement multi-entreprise (company_id) et RBAC
 *   (Admin, Caporal Récolte, Caporal Contractuelles, exclusion absolue de tariq).
 */

import { UserAccount } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import {
  migrateLegacySyncQueue,
  getAllPendingOutboxCounts,
  getSyncConflicts,
  SyncConflictRecord,
} from './syncOutbox';
import { syncRecolteWithServer } from './storage';
import {
  syncQueueToSupabase,
  pullAllCoreModulesFromSupabase,
} from './supabaseSync';
import {
  flushHeuresSupplementairesQueue,
  syncAndFetchHeuresSupplementairesServer,
} from './heuresSupplementairesService';
import {
  flushTachesSupplementairesQueue,
  fetchTachesSupplementairesServer,
} from './tachesSupplementairesService';
import {
  flushContractuelsSyncQueue,
  getContractuelContrats,
  getContractuelOuvriers,
  getContractuelPointages,
} from './contractuelService';
import {
  flushStockSyncQueue,
  getStockSynthese,
  getMouvements,
} from './stockService';
import {
  flushPaiementSyncQueue,
  syncLoadPaiementTariffsFromSupabase,
  syncLoadPaiementSnapshotsFromSupabase,
  syncLoadPaiementDayOverridesFromSupabase,
} from '../utils/paiementExporter';

export interface PermittedSyncScope {
  role: 'admin' | 'caporal' | 'caporal_contractuelles';
  isTariqOrContractuel: boolean;
  isAdmin: boolean;
  allowedCoreTables: Set<string>;
  canSyncPointage: boolean;
  canSyncReferentiels: boolean;
  canSyncGazoil: boolean;
  canSyncRecolte: boolean;
  canSyncSupplementaires: boolean;
  canSyncContractuels: boolean;
  canSyncStock: boolean;
  canSyncPaiement: boolean;
}

export function getPermittedSyncScope(user?: UserAccount | null): PermittedSyncScope {
  const usernameLower = String(user?.username || '').trim().toLowerCase();
  const isTariq = usernameLower === 'tariq';
  const isContractuel =
    isTariq ||
    user?.role === 'caporal_contractuelles' ||
    user?.module_attribue === 'contractuelles';

  if (!user) {
    return {
      role: 'caporal_contractuelles',
      isTariqOrContractuel: true,
      isAdmin: false,
      allowedCoreTables: new Set<string>(),
      canSyncPointage: false,
      canSyncReferentiels: false,
      canSyncGazoil: false,
      canSyncRecolte: false,
      canSyncSupplementaires: false,
      canSyncContractuels: false,
      canSyncStock: false,
      canSyncPaiement: false,
    };
  }

  if (isContractuel) {
    return {
      role: 'caporal_contractuelles',
      isTariqOrContractuel: true,
      isAdmin: false,
      // Contractuels : uniquement domaines & serres en lecture + module contractuelles
      allowedCoreTables: new Set(['domaines', 'serres']),
      canSyncPointage: false,
      canSyncReferentiels: false,
      canSyncGazoil: false,
      canSyncRecolte: false,
      canSyncSupplementaires: false,
      canSyncContractuels: true,
      canSyncStock: false,
      canSyncPaiement: false,
    };
  }

  if (user.role === 'caporal') {
    return {
      role: 'caporal',
      isTariqOrContractuel: false,
      isAdmin: false,
      // Caporal Récolte : référentiels lecture + récolte + heures/tâches supp
      allowedCoreTables: new Set([
        'domaines',
        'serres',
        'ouvriers',
        'taches',
        'recolte_entries',
        'heures_supplementaires',
        'taches_supplementaires',
      ]),
      canSyncPointage: false,
      canSyncReferentiels: false,
      canSyncGazoil: false,
      canSyncRecolte: true,
      canSyncSupplementaires: true,
      canSyncContractuels: false,
      canSyncStock: false,
      canSyncPaiement: false,
    };
  }

  // Administrateur actif
  return {
    role: 'admin',
    isTariqOrContractuel: false,
    isAdmin: true,
    allowedCoreTables: new Set([
      'companies',
      'domaines',
      'serres',
      'ouvriers',
      'taches',
      'pointages',
      'affectations',
      'tache_serres',
      'recolte_entries',
      'heures_supplementaires',
      'taches_supplementaires',
      'gazoil_config',
      'gazoil_mouvements',
    ]),
    canSyncPointage: true,
    canSyncReferentiels: true,
    canSyncGazoil: true,
    canSyncRecolte: true,
    canSyncSupplementaires: true,
    canSyncContractuels: true,
    canSyncStock: true,
    canSyncPaiement: true,
  };
}

export interface GlobalSyncOptions {
  companyId: string;
  user: UserAccount;
  supabaseClient?: any;
  baseUrl?: string;
  accessToken?: string;
  ignoreNavigatorOnline?: boolean;
  skipSessionCheck?: boolean;
  dateIso?: string;
}

export interface GlobalSyncReport {
  companyId: string;
  role: string;
  pushed: {
    core: number;
    recolte: number;
    heuresSupp: number;
    tachesSupp: number;
    contractuels: number;
    stock: number;
    paiement: number;
  };
  pulled: {
    core: Record<string, number>;
    recolte: number;
    heuresSupp: number;
    tachesSupp: number;
    contractuelsContrats: number;
    contractuelsOuvriers: number;
    contractuelsPointages: number;
    stockProduits: number;
    stockMouvements: number;
    paiementTariffsOk: boolean;
    paiementSnapshots: number;
  };
  pendingCounts: ReturnType<typeof getAllPendingOutboxCounts>;
  conflictsCount: number;
  errors: Array<{ module: string; error: string }>;
  syncedAt: string;
}

const inFlightSyncByCompany = new Map<string, Promise<GlobalSyncReport>>();

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function syncBidirectionalAll(options: GlobalSyncOptions): Promise<GlobalSyncReport> {
  const companyId = (options.companyId || options.user?.company_id || '').trim();
  const mutexKey = `${companyId}__${options.user?.id || 'anon'}`;
  const existing = inFlightSyncByCompany.get(mutexKey);
  if (existing) {
    return existing;
  }

  const run = executeBidirectionalSync({ ...options, companyId });
  inFlightSyncByCompany.set(mutexKey, run);
  try {
    return await run;
  } finally {
    inFlightSyncByCompany.delete(mutexKey);
  }
}

async function executeBidirectionalSync(options: GlobalSyncOptions): Promise<GlobalSyncReport> {
  const { companyId, user } = options;
  const scope = getPermittedSyncScope(user);
  const errors: Array<{ module: string; error: string }> = [];

  const report: GlobalSyncReport = {
    companyId,
    role: scope.role,
    pushed: {
      core: 0,
      recolte: 0,
      heuresSupp: 0,
      tachesSupp: 0,
      contractuels: 0,
      stock: 0,
      paiement: 0,
    },
    pulled: {
      core: {},
      recolte: 0,
      heuresSupp: 0,
      tachesSupp: 0,
      contractuelsContrats: 0,
      contractuelsOuvriers: 0,
      contractuelsPointages: 0,
      stockProduits: 0,
      stockMouvements: 0,
      paiementTariffsOk: false,
      paiementSnapshots: 0,
    },
    pendingCounts: getAllPendingOutboxCounts(),
    conflictsCount: getSyncConflicts(companyId).length,
    errors,
    syncedAt: new Date().toISOString(),
  };

  if (!companyId || !user) {
    report.errors.push({ module: 'global', error: 'Entreprise ou utilisateur manquant.' });
    return report;
  }

  if (!options.ignoreNavigatorOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
    return report;
  }

  // 1. Migrer l'éventuelle ancienne file générique vers les outboxes typées
  migrateLegacySyncQueue();

  const sbClient = options.supabaseClient ?? (isSupabaseConfigured ? supabase : null);
  const supaPushAllowedTables = new Set<string>();
  if (scope.canSyncPointage) {
    supaPushAllowedTables.add('pointages');
    supaPushAllowedTables.add('affectations');
    supaPushAllowedTables.add('tache_serres');
  }
  if (scope.canSyncReferentiels) {
    supaPushAllowedTables.add('companies');
    supaPushAllowedTables.add('domaines');
    supaPushAllowedTables.add('serres');
    supaPushAllowedTables.add('ouvriers');
    supaPushAllowedTables.add('taches');
  }
  if (scope.canSyncGazoil) {
    supaPushAllowedTables.add('gazoil_config');
    supaPushAllowedTables.add('gazoil_mouvements');
  }

  // 2. PHASE PUSH : vider les outboxes autorisées AVANT toute hydratation distante
  if (sbClient && supaPushAllowedTables.size > 0) {
    try {
      const corePush = await syncQueueToSupabase({
        client: sbClient,
        skipSessionCheck: options.skipSessionCheck ?? Boolean(options.supabaseClient),
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
        allowedTables: supaPushAllowedTables,
      });
      report.pushed.core = corePush.pushedCount;
      for (const e of corePush.errors) {
        errors.push({ module: `core:${e.table}`, error: e.error });
      }
    } catch (err: any) {
      errors.push({ module: 'core_push', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncRecolte) {
    try {
      const recRes = await syncRecolteWithServer(companyId, {
        accessToken: options.accessToken,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.recolte = recRes.syncedCount || 0;
      if (recRes.success && Array.isArray(recRes.allEntries)) {
        report.pulled.recolte = recRes.allEntries.length;
      } else if (recRes.error) {
        errors.push({ module: 'recolte', error: recRes.error });
      }
    } catch (err: any) {
      errors.push({ module: 'recolte', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncSupplementaires) {
    try {
      const hPush = await flushHeuresSupplementairesQueue({
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.heuresSupp = hPush.syncedCount;
      hPush.errors.forEach((e) => errors.push({ module: 'heures_supp_push', error: e }));

      const tPush = await flushTachesSupplementairesQueue({
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.tachesSupp = tPush.syncedCount;
      tPush.errors.forEach((e) => errors.push({ module: 'taches_supp_push', error: e }));
    } catch (err: any) {
      errors.push({ module: 'supplementaires_push', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncContractuels) {
    try {
      const ctrPush = await flushContractuelsSyncQueue({
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.contractuels = ctrPush.syncedCount;
      ctrPush.errors.forEach((e) => errors.push({ module: 'contractuels_push', error: e }));
    } catch (err: any) {
      errors.push({ module: 'contractuels_push', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncStock) {
    try {
      const stkPush = await flushStockSyncQueue({
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.stock = stkPush.syncedCount;
      stkPush.errors.forEach((e) => errors.push({ module: 'stock_push', error: e }));
    } catch (err: any) {
      errors.push({ module: 'stock_push', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncPaiement && sbClient) {
    try {
      const paiPush = await flushPaiementSyncQueue(user, companyId, sbClient, {
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      });
      report.pushed.paiement = paiPush.syncedCount;
      paiPush.errors.forEach((e) => errors.push({ module: 'paiement_push', error: e }));
    } catch (err: any) {
      errors.push({ module: 'paiement_push', error: err?.message || String(err) });
    }
  }

  // 3. PHASE PULL : hydrater et fusionner les sources autorisées depuis Supabase / backend
  if (sbClient && scope.allowedCoreTables.size > 0) {
    try {
      const corePull = await pullAllCoreModulesFromSupabase(companyId, {
        client: sbClient,
        skipSessionCheck: options.skipSessionCheck ?? Boolean(options.supabaseClient),
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
        allowedTables: scope.allowedCoreTables,
      });
      report.pulled.core = corePull.pulledCounts;
      for (const e of corePull.errors) {
        errors.push({ module: `core_pull:${e.table}`, error: e.error });
      }
    } catch (err: any) {
      errors.push({ module: 'core_pull', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncSupplementaires) {
    try {
      const [hPull, tPull] = await Promise.all([
        syncAndFetchHeuresSupplementairesServer(
          {},
          {
            accessToken: options.accessToken,
            companyId,
            baseUrl: options.baseUrl,
            ignoreNavigatorOnline: options.ignoreNavigatorOnline,
          }
        ),
        fetchTachesSupplementairesServer(
          {},
          {
            accessToken: options.accessToken,
            companyId,
            baseUrl: options.baseUrl,
            ignoreNavigatorOnline: options.ignoreNavigatorOnline,
          }
        ),
      ]);
      if (hPull.success) {
        report.pulled.heuresSupp = hPull.supplementaires.length;
      } else if (hPull.error) {
        errors.push({ module: 'heures_supp_pull', error: hPull.error });
      }
      if (tPull.success) {
        report.pulled.tachesSupp = tPull.taches_supplementaires.length;
      } else if (tPull.error) {
        errors.push({ module: 'taches_supp_pull', error: tPull.error });
      }
    } catch (err: any) {
      errors.push({ module: 'supplementaires_pull', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncContractuels) {
    try {
      const reqOpts = {
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
        ignoreNavigatorOnline: options.ignoreNavigatorOnline,
      };
      const [cRes, oRes, pRes] = await Promise.all([
        getContractuelContrats(undefined, reqOpts),
        getContractuelOuvriers(undefined, reqOpts),
        getContractuelPointages(undefined, reqOpts),
      ]);
      report.pulled.contractuelsContrats = cRes.contrats.length;
      report.pulled.contractuelsOuvriers = oRes.ouvriers.length;
      report.pulled.contractuelsPointages = pRes.pointages.length;
    } catch (err: any) {
      errors.push({ module: 'contractuels_pull', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncStock) {
    try {
      const reqOpts = {
        accessToken: options.accessToken,
        companyId,
        baseUrl: options.baseUrl,
      };
      const [sRes, mRes] = await Promise.all([
        getStockSynthese(reqOpts),
        getMouvements(undefined, reqOpts),
      ]);
      if (sRes.success) {
        report.pulled.stockProduits = sRes.produits.length;
      } else if (sRes.error) {
        errors.push({ module: 'stock_pull_synthese', error: sRes.error });
      }
      if (mRes.success) {
        report.pulled.stockMouvements = mRes.mouvements.length;
      } else if (mRes.error) {
        errors.push({ module: 'stock_pull_mouvements', error: mRes.error });
      }
    } catch (err: any) {
      errors.push({ module: 'stock_pull', error: err?.message || String(err) });
    }
  }

  if (scope.canSyncPaiement && sbClient) {
    try {
      const targetDate = options.dateIso || getTodayIso();
      const [tarRes, snapRes] = await Promise.all([
        syncLoadPaiementTariffsFromSupabase(companyId, sbClient),
        syncLoadPaiementSnapshotsFromSupabase(companyId, sbClient),
        syncLoadPaiementDayOverridesFromSupabase(companyId, targetDate, sbClient),
      ]);
      report.pulled.paiementTariffsOk = tarRes.ok;
      report.pulled.paiementSnapshots = snapRes.snapshots.length;
    } catch (err: any) {
      errors.push({ module: 'paiement_pull', error: err?.message || String(err) });
    }
  }

  report.pendingCounts = getAllPendingOutboxCounts();
  report.conflictsCount = getSyncConflicts(companyId).length;
  report.syncedAt = new Date().toISOString();
  return report;
}

/**
 * Hydratation complète d'un nouvel appareil (ou après déconnexion/reconnexion).
 */
export async function hydrateFreshDeviceFromRemote(
  options: GlobalSyncOptions
): Promise<GlobalSyncReport> {
  return syncBidirectionalAll(options);
}

/**
 * Résumé lisible en mémoire/hors ligne des files d'attente et conflits enregistrés.
 */
export function getGlobalPendingSyncSummary(companyId?: string): {
  counts: ReturnType<typeof getAllPendingOutboxCounts>;
  totalPending: number;
  conflicts: SyncConflictRecord[];
} {
  const counts = getAllPendingOutboxCounts();
  const conflicts = getSyncConflicts(companyId);
  return {
    counts,
    totalPending: counts.total,
    conflicts,
  };
}
