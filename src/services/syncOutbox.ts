export const LEGACY_SYNC_QUEUE_KEY = 'agripointage_sync_queue_v1';
export const LEGACY_POINTAGE_QUEUE_KEY = 'agripointage_pointage_sync_queue_v1';

export const OUTBOX_KEYS = {
  RECOLTE: 'agripointage_recolte_sync_queue_v2',
  REFERENTIELS: 'agripointage_referentiels_sync_queue_v1',
  POINTAGE: LEGACY_POINTAGE_QUEUE_KEY,
  GAZOIL: 'agripointage_gazoil_sync_queue_v1',
  SUPPLEMENTAIRES: 'agripointage_supplementaires_sync_queue_v1',
  CONTRACTUELS: 'agripointage_contractuels_sync_queue_v1',
  STOCK: 'agripointage_stock_sync_queue_v1',
  PAIEMENT: 'agripointage_paiement_sync_queue_v1',
  CONFLICTS: 'agripointage_sync_conflicts_v1',
  TOMBSTONES: 'agripointage_sync_tombstones_v1',
} as const;

export type OutboxQueueKey = (typeof OUTBOX_KEYS)[keyof typeof OUTBOX_KEYS];
export type OutboxAction = 'upsert' | 'delete';

export interface OutboxOp<T = any> {
  opId: string;
  table: string;
  entityId: string;
  action: OutboxAction;
  data: T;
  companyId?: string;
  updatedAt: number;
  createdAt: number;
  retryCount: number;
  lastError?: string | null;
}

export interface SyncConflictRecord {
  id: string;
  table: string;
  entityId: string;
  companyId?: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolvedWinner: 'local' | 'remote';
  localSnapshot: any;
  remoteSnapshot: any;
  recordedAt: string;
}

export interface TombstoneEntry {
  key: string; // `${table}::${entityId}`
  table: string;
  entityId: string;
  companyId?: string;
  deletedAt: number;
}

const MAX_CONFLICT_RECORDS = 100;
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

function getSafeStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage as Storage;
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // Ignore SSR / restricted storage
  }
  return null;
}

export function safeReadJson<T>(key: string, fallback: T): T {
  const storage = getSafeStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return (parsed === null || parsed === undefined ? fallback : parsed) as T;
  } catch {
    return fallback;
  }
}

export function safeWriteJson(key: string, value: unknown): boolean {
  const storage = getSafeStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`[syncOutbox] Échec écriture localStorage (${key}):`, err);
    return false;
  }
}

export function generateOpId(prefix = 'op'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function extractTimestampMs(item: any): number {
  if (!item || typeof item !== 'object') return 0;
  const candidates = [
    item.updated_at,
    item.updatedAt,
    item.timestamp,
    item.created_at,
    item.createdAt,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) {
      return c;
    }
    if (typeof c === 'string' && c.trim()) {
      const asNum = Number(c);
      if (Number.isFinite(asNum) && asNum > 1e11) return asNum;
      const ms = Date.parse(c);
      if (!Number.isNaN(ms) && ms > 0) return ms;
    }
  }
  return 0;
}

function normalizeQueueEntry(raw: any): OutboxOp | null {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.opId && raw.table) {
    return {
      opId: String(raw.opId),
      table: String(raw.table),
      entityId: String(raw.entityId || raw.data?.id || ''),
      action: raw.action === 'delete' ? 'delete' : 'upsert',
      data: raw.data,
      companyId: raw.companyId || raw.data?.company_id,
      updatedAt: Number(raw.updatedAt) || extractTimestampMs(raw.data) || Date.now(),
      createdAt: Number(raw.createdAt) || Date.now(),
      retryCount: Number(raw.retryCount) || 0,
      lastError: raw.lastError || null,
    };
  }
  // Ancien format { table, action?, data, timestamp? }
  if (raw.table && raw.data) {
    const entityId = String(
      raw.entityId ||
        raw.data.id ||
        (raw.table === 'tache_serres'
          ? `${raw.data.company_id || ''}__${raw.data.date || ''}__${raw.data.tache_id || ''}`
          : '')
    );
    return {
      opId: generateOpId(String(raw.table)),
      table: String(raw.table),
      entityId,
      action: raw.action === 'delete' ? 'delete' : 'upsert',
      data: raw.data,
      companyId: raw.companyId || raw.data?.company_id,
      updatedAt: Number(raw.timestamp) || extractTimestampMs(raw.data) || Date.now(),
      createdAt: Number(raw.timestamp) || Date.now(),
      retryCount: Number(raw.retryCount) || 0,
      lastError: null,
    };
  }
  // Format brut RecolteEntry sans enveloppe { table }
  if (raw.id && (raw.serre_id !== undefined || raw.caisses !== undefined || raw.type_operation !== undefined)) {
    return {
      opId: generateOpId('recolte'),
      table: 'recolte_entries',
      entityId: String(raw.id),
      action: 'upsert',
      data: raw,
      companyId: raw.company_id,
      updatedAt: extractTimestampMs(raw) || Date.now(),
      createdAt: extractTimestampMs(raw) || Date.now(),
      retryCount: 0,
      lastError: null,
    };
  }
  return null;
}

export function getOutboxOps(queueKey: string): OutboxOp[] {
  const raw = safeReadJson<any[]>(queueKey, []);
  if (!Array.isArray(raw)) return [];
  const normalized: OutboxOp[] = [];
  for (const item of raw) {
    const op = normalizeQueueEntry(item);
    if (op) normalized.push(op);
  }
  return normalized;
}

export function enqueueOutboxOp<T = any>(
  queueKey: string,
  params: {
    table: string;
    entityId: string;
    action?: OutboxAction;
    data: T;
    companyId?: string;
    updatedAt?: number;
  }
): OutboxOp<T> {
  const action: OutboxAction = params.action || 'upsert';
  const now = params.updatedAt || Date.now();
  const entityId = String(params.entityId || (params.data as any)?.id || '');
  const companyId = params.companyId || (params.data as any)?.company_id;

  const op: OutboxOp<T> = {
    opId: generateOpId(params.table),
    table: params.table,
    entityId,
    action,
    data: params.data,
    companyId,
    updatedAt: now,
    createdAt: now,
    retryCount: 0,
    lastError: null,
  };

  const current = getOutboxOps(queueKey);
  // Coalesce avec la dernière opération non encore transmise sur la même entité
  const filtered = current.filter(
    existing =>
      !(
        existing.table === op.table &&
        existing.entityId === op.entityId &&
        existing.entityId !== ''
      )
  );
  filtered.push(op);
  safeWriteJson(queueKey, filtered);

  if (action === 'delete' && entityId) {
    addDeleteTombstone(params.table, entityId, companyId, now);
  } else if (action === 'upsert' && entityId) {
    clearDeleteTombstone(params.table, entityId);
  }

  return op;
}

/**
 * Retire uniquement les opIds explicitement confirmés par le backend/Supabase
 * en relisant la file la plus récente juste avant l'écriture (aucune perte en cours de vol).
 */
export function dequeueOutboxOpsById(queueKey: string, confirmedOpIds: Iterable<string>): number {
  const confirmedSet = new Set(confirmedOpIds);
  if (confirmedSet.size === 0) return 0;

  const latest = getOutboxOps(queueKey);
  const remaining = latest.filter(op => !confirmedSet.has(op.opId));
  safeWriteJson(queueKey, remaining);
  return latest.length - remaining.length;
}

export function markOutboxOpsFailed(
  queueKey: string,
  failedOpIds: Iterable<string>,
  errorMessage: string
): void {
  const failedSet = new Set(failedOpIds);
  if (failedSet.size === 0) return;

  const latest = getOutboxOps(queueKey);
  const updated = latest.map(op =>
    failedSet.has(op.opId)
      ? {
          ...op,
          retryCount: (op.retryCount || 0) + 1,
          lastError: errorMessage,
        }
      : op
  );
  safeWriteJson(queueKey, updated);
}

export function hasPendingOutboxEntity(
  queueKey: string,
  table: string,
  entityId: string
): boolean {
  if (!entityId) return false;
  const ops = getOutboxOps(queueKey);
  return ops.some(op => op.table === table && op.entityId === entityId);
}

export function getPendingOutboxIdsForTable(queueKey: string, table: string): Set<string> {
  const ops = getOutboxOps(queueKey);
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.table === table && op.entityId) {
      ids.add(op.entityId);
    }
  }
  return ids;
}

// --------------------- TOMBSTONES DE SUPPRESSION ---------------------

export function getDeleteTombstones(table?: string): Map<string, TombstoneEntry> {
  const raw = safeReadJson<TombstoneEntry[]>(OUTBOX_KEYS.TOMBSTONES, []);
  const now = Date.now();
  const map = new Map<string, TombstoneEntry>();
  if (!Array.isArray(raw)) return map;

  for (const entry of raw) {
    if (!entry || !entry.table || !entry.entityId) continue;
    if (now - (entry.deletedAt || 0) > TOMBSTONE_TTL_MS) continue;
    if (!table || entry.table === table) {
      map.set(`${entry.table}::${entry.entityId}`, entry);
    }
  }
  return map;
}

export function addDeleteTombstone(
  table: string,
  entityId: string,
  companyId?: string,
  deletedAt = Date.now()
): void {
  if (!table || !entityId) return;
  const raw = safeReadJson<TombstoneEntry[]>(OUTBOX_KEYS.TOMBSTONES, []);
  const now = Date.now();
  const key = `${table}::${entityId}`;
  const filtered = (Array.isArray(raw) ? raw : []).filter(
    t => t && t.key !== key && now - (t.deletedAt || 0) <= TOMBSTONE_TTL_MS
  );
  filtered.push({ key, table, entityId, companyId, deletedAt });
  safeWriteJson(OUTBOX_KEYS.TOMBSTONES, filtered);
}

export function clearDeleteTombstone(table: string, entityId: string): void {
  if (!table || !entityId) return;
  const raw = safeReadJson<TombstoneEntry[]>(OUTBOX_KEYS.TOMBSTONES, []);
  if (!Array.isArray(raw) || raw.length === 0) return;
  const key = `${table}::${entityId}`;
  const next = raw.filter(t => t && t.key !== key);
  if (next.length !== raw.length) {
    safeWriteJson(OUTBOX_KEYS.TOMBSTONES, next);
  }
}

export function isDeletedTombstone(table: string, entityId: string): boolean {
  const map = getDeleteTombstones(table);
  return map.has(`${table}::${entityId}`);
}

// --------------------- JOURNAL DES CONFLITS ---------------------

export function recordSyncConflict(
  conflict: Omit<SyncConflictRecord, 'id' | 'recordedAt'>
): SyncConflictRecord {
  const entry: SyncConflictRecord = {
    ...conflict,
    id: generateOpId('conflict'),
    recordedAt: new Date().toISOString(),
  };
  const current = safeReadJson<SyncConflictRecord[]>(OUTBOX_KEYS.CONFLICTS, []);
  const list = Array.isArray(current) ? current : [];
  list.unshift(entry);
  if (list.length > MAX_CONFLICT_RECORDS) {
    list.length = MAX_CONFLICT_RECORDS;
  }
  safeWriteJson(OUTBOX_KEYS.CONFLICTS, list);
  return entry;
}

export function getSyncConflicts(companyId?: string): SyncConflictRecord[] {
  const raw = safeReadJson<SyncConflictRecord[]>(OUTBOX_KEYS.CONFLICTS, []);
  if (!Array.isArray(raw)) return [];
  if (!companyId) return raw;
  return raw.filter((c) => !c.companyId || c.companyId === companyId);
}

export function clearResolvedConflicts(): void {
  safeWriteJson(OUTBOX_KEYS.CONFLICTS, []);
}

// --------------------- MIGRATION DE L'ANCIENNE FILE PARTAGÉE ---------------------

function resolveTargetQueueForLegacyTable(table: string): string {
  const lower = String(table || '').toLowerCase();
  if (lower.includes('recolte')) return OUTBOX_KEYS.RECOLTE;
  if (lower.includes('gazoil')) return OUTBOX_KEYS.GAZOIL;
  if (lower.includes('pointage') || lower.includes('affectation') || lower.includes('tache_serre')) {
    return OUTBOX_KEYS.POINTAGE;
  }
  if (lower.includes('heure') || lower.includes('tache_supp')) {
    return OUTBOX_KEYS.SUPPLEMENTAIRES;
  }
  if (lower.includes('contractuel')) return OUTBOX_KEYS.CONTRACTUELS;
  if (lower.includes('stock')) return OUTBOX_KEYS.STOCK;
  if (lower.includes('paiement')) return OUTBOX_KEYS.PAIEMENT;
  return OUTBOX_KEYS.REFERENTIELS;
}

/**
 * Sépare proprement les éléments de l'ancienne file partagée `agripointage_sync_queue_v1`
 * vers les files typées dédiées sans jamais écraser ni perdre d'éléments non migrés.
 */
export function migrateLegacySyncQueue(): { migrated: number; keptUnrecognized: number } {
  const raw = safeReadJson<any[]>(LEGACY_SYNC_QUEUE_KEY, []);
  if (!Array.isArray(raw) || raw.length === 0) {
    return { migrated: 0, keptUnrecognized: 0 };
  }

  let migrated = 0;
  const unrecognized: any[] = [];

  for (const item of raw) {
    const normalized = normalizeQueueEntry(item);
    if (!normalized) {
      unrecognized.push(item);
      continue;
    }
    const targetQueue = resolveTargetQueueForLegacyTable(normalized.table);
    enqueueOutboxOp(targetQueue, {
      table: normalized.table,
      entityId: normalized.entityId,
      action: normalized.action,
      data: normalized.data,
      companyId: normalized.companyId,
      updatedAt: normalized.updatedAt,
    });
    migrated += 1;
  }

  safeWriteJson(LEGACY_SYNC_QUEUE_KEY, unrecognized);
  return { migrated, keptUnrecognized: unrecognized.length };
}

// --------------------- FUSION DETERMINISTE AVEC DETECTION DE CONFLIT ---------------------

export interface MergeCollectionOptions<T> {
  table: string;
  queueKey: string;
  localItems: T[];
  remoteItems: T[];
  getId: (item: T) => string;
  getCompanyId?: (item: T) => string | undefined;
  scopedCompanyId?: string;
  /**
   * Si true et remoteItems est vide mais qu'une erreur réseau s'est produite,
   * ne jamais appeler cette fonction ; en cas de remote vide volontaire, les items en attente locale sont toujours préservés.
   */
  preserveLocalNotInRemote?: boolean;
  isProvisionalLocal?: (item: T) => boolean;
}

export function mergeCollectionWithConflictLog<T>(options: MergeCollectionOptions<T>): T[] {
  const {
    table,
    queueKey,
    localItems,
    remoteItems,
    getId,
    getCompanyId,
    scopedCompanyId,
    preserveLocalNotInRemote = true,
    isProvisionalLocal,
  } = options;

  const pendingOps = getOutboxOps(queueKey).filter(op => op.table === table);
  const pendingUpsertIds = new Set<string>();
  const pendingDeleteIds = new Set<string>();
  for (const op of pendingOps) {
    if (!op.entityId) continue;
    if (op.action === 'delete') pendingDeleteIds.add(op.entityId);
    else pendingUpsertIds.add(op.entityId);
  }

  const tombstones = getDeleteTombstones(table);
  const merged = new Map<string, T>();

  const hasRealRemote = remoteItems.some(r => !(isProvisionalLocal && isProvisionalLocal(r)));

  for (const local of localItems) {
    const id = getId(local);
    if (!id) continue;
    if (isProvisionalLocal && isProvisionalLocal(local) && hasRealRemote) {
      continue;
    }
    if (pendingDeleteIds.has(id) || tombstones.has(`${table}::${id}`)) {
      continue;
    }
    merged.set(id, local);
  }

  for (const remote of remoteItems) {
    const id = getId(remote);
    if (!id) continue;
    if (pendingDeleteIds.has(id)) {
      continue;
    }
    const tombstone = tombstones.get(`${table}::${id}`);
    const remoteTs = extractTimestampMs(remote);
    if (tombstone && (!remoteTs || tombstone.deletedAt >= remoteTs)) {
      continue;
    }

    const existingLocal = merged.get(id);
    if (!existingLocal) {
      merged.set(id, remote);
      continue;
    }

    if (pendingUpsertIds.has(id)) {
      const localTs = extractTimestampMs(existingLocal);
      if (remoteTs > localTs && localTs > 0) {
        // Les deux côtés ont modifié l'entité : la file locale en attente est priorisée si timestamps égaux/plus récents,
        // sinon le distant plus récent gagne et la version locale en attente est journalisée dans les conflits.
        recordSyncConflict({
          table,
          entityId: id,
          companyId: getCompanyId ? getCompanyId(remote) || getCompanyId(existingLocal) : scopedCompanyId,
          localUpdatedAt: localTs,
          remoteUpdatedAt: remoteTs,
          resolvedWinner: 'remote',
          localSnapshot: existingLocal,
          remoteSnapshot: remote,
        });
        merged.set(id, remote);
      } else {
        // Garder le local en attente d'envoi
        if (remoteTs > 0 && localTs > 0 && Math.abs(remoteTs - localTs) > 1000 && JSON.stringify(existingLocal) !== JSON.stringify(remote)) {
          recordSyncConflict({
            table,
            entityId: id,
            companyId: getCompanyId ? getCompanyId(existingLocal) : scopedCompanyId,
            localUpdatedAt: localTs,
            remoteUpdatedAt: remoteTs,
            resolvedWinner: 'local',
            localSnapshot: existingLocal,
            remoteSnapshot: remote,
          });
        }
        merged.set(id, existingLocal);
      }
      continue;
    }

    // Aucun changement local en attente : le serveur est source de vérité, sauf si local est strictement plus récent avec horodatage
    const localTs = extractTimestampMs(existingLocal);
    if (localTs > 0 && remoteTs > 0 && localTs > remoteTs) {
      merged.set(id, existingLocal);
    } else {
      merged.set(id, remote);
    }
  }

  if (!preserveLocalNotInRemote) {
    const remoteIdSet = new Set(remoteItems.map(getId));
    for (const [id, item] of Array.from(merged.entries())) {
      const inScope =
        !scopedCompanyId || !getCompanyId || getCompanyId(item) === scopedCompanyId;
      if (inScope && !remoteIdSet.has(id) && !pendingUpsertIds.has(id)) {
        merged.delete(id);
      }
    }
  }

  return Array.from(merged.values());
}

export function getAllPendingOutboxCounts(): Record<string, number> {
  return {
    recolte: getOutboxOps(OUTBOX_KEYS.RECOLTE).length,
    referentiels: getOutboxOps(OUTBOX_KEYS.REFERENTIELS).length,
    pointage: getOutboxOps(OUTBOX_KEYS.POINTAGE).length,
    gazoil: getOutboxOps(OUTBOX_KEYS.GAZOIL).length,
    supplementaires: getOutboxOps(OUTBOX_KEYS.SUPPLEMENTAIRES).length,
    contractuels: getOutboxOps(OUTBOX_KEYS.CONTRACTUELS).length,
    stock: getOutboxOps(OUTBOX_KEYS.STOCK).length,
    paiement: getOutboxOps(OUTBOX_KEYS.PAIEMENT).length,
  };
}
