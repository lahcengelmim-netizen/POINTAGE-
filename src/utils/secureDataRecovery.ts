/**
 * Outil de Sauvetage Intégral en Lecture Seule — LAHCEN POINTEUR
 *
 * GARANTIES STRICTES :
 * - Aucune écriture dans window.localStorage (zéro setItem / removeItem / clear).
 * - Aucune création/modification de base IndexedDB (lecture seule via indexedDB.databases() + transaction 'readonly', sans onupgradeneeded).
 * - Aucune requête réseau vers Supabase ou le serveur, aucune synchronisation, aucune restauration.
 * - Exclusion/expurgation stricte des mots de passe, hashes, salts, tokens de session et secrets.
 */

export type ExportKeyStatus = 'EXPORTE' | 'EXPORTE_SANS_SECRETS' | 'EXCLU_SECURITE' | 'ERREUR_LECTURE';

export interface LocalStorageKeyInventory {
  key: string;
  category: string;
  status: ExportKeyStatus;
  record_count: number;
  size_bytes: number;
  sanitized: boolean;
  sanitized_fields?: string[];
  excluded_reason?: string;
  sha256: string;
}

export interface LocalStorageExportEntry {
  raw_value?: string;
  size_bytes: number;
  record_count: number;
  status: ExportKeyStatus;
  sanitized_fields?: string[];
  excluded_reason?: string;
  sha256: string;
}

export interface IndexedDBStoreExport {
  records: unknown[];
  record_count: number;
  size_bytes: number;
  sanitized_records_count: number;
}

export interface IndexedDBDatabaseExport {
  name: string;
  version: number;
  status: 'EXPORTE' | 'VIDE' | 'ERREUR_LECTURE';
  object_stores: string[];
  record_count: number;
  size_bytes: number;
  stores: Record<string, IndexedDBStoreExport>;
  error?: string;
}

export interface RecoverySourceStatus {
  source: string;
  accessible: boolean;
  item_count: number;
  record_count: number;
  size_bytes: number;
  details: string;
}

export interface RecoveryErrorItem {
  source: string;
  message: string;
}

export interface RecoveryAnalysisResult {
  analyzed_at: string;
  origin: string;
  href_path: string;
  user_agent: string;
  keys_snapshot_before: Array<{ key: string; size_bytes: number; sha256: string }>;
  localStorage_keys: LocalStorageKeyInventory[];
  localStorage_raw: Record<string, LocalStorageExportEntry>;
  indexedDB_supported: boolean;
  indexedDB_enumeration_supported: boolean;
  indexedDB_databases: IndexedDBDatabaseExport[];
  sources_detected: RecoverySourceStatus[];
  inaccessible_sources: Array<{ source: string; reason: string }>;
  sync_queues: {
    sync_queue_found: boolean;
    sync_queue_records: number;
    pointage_sync_queue_found: boolean;
    pointage_sync_queue_records: number;
  };
  totals: {
    localStorage_keys_count: number;
    localStorage_excluded_security_count: number;
    indexedDB_databases_count: number;
    total_records_count: number;
    total_bytes: number;
  };
  errors: RecoveryErrorItem[];
}

export interface RecoveryVerificationReport {
  json_valid: boolean;
  keys_before_count: number;
  keys_after_count: number;
  keys_unchanged: boolean;
  origin_data_unmodified: boolean;
  sync_queues_included: boolean;
  exported_records_match: boolean;
  errors_count: number;
}

export interface RecoveryBackupPayload {
  metadata: {
    app: string;
    tool_name: string;
    mode: 'LECTURE_SEULE_SANS_MODIFICATION';
    filename: string;
    created_at: string;
    local_date_time: string;
    origin: string;
    href_path: string;
    user_agent: string;
  };
  summary: {
    localStorage_keys_count: number;
    localStorage_excluded_security_count: number;
    indexedDB_databases_count: number;
    total_records_count: number;
    total_bytes: number;
    sync_queues: RecoveryAnalysisResult['sync_queues'];
    sources_detected: RecoverySourceStatus[];
    inaccessible_sources: Array<{ source: string; reason: string }>;
  };
  inventory: {
    localStorage: LocalStorageKeyInventory[];
    indexedDB: Array<{
      name: string;
      version: number;
      status: IndexedDBDatabaseExport['status'];
      object_stores: string[];
      record_count: number;
      size_bytes: number;
      error?: string;
    }>;
  };
  localStorage_raw: Record<string, LocalStorageExportEntry>;
  indexedDB_data: Record<
    string,
    {
      version: number;
      status: IndexedDBDatabaseExport['status'];
      stores: Record<string, IndexedDBStoreExport>;
      error?: string;
    }
  >;
  errors: RecoveryErrorItem[];
  verification: RecoveryVerificationReport;
  manifest_sha256: {
    algorithm: 'SHA-256';
    payload_sha256: string;
    per_localStorage_key_sha256: Record<string, string>;
  };
}

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'salt',
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'auth_token',
  'secret',
  'client_secret',
  'service_role_key',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
]);

function utf8BytesLength(input: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input).length;
  }
  return input.length;
}

/**
 * SHA-256 synchrone pur TypeScript/JS (fonctionne sur HTTP, HTTPS, Android WebView, Node, tests).
 */
export function computeSha256HexSync(message: string): string {
  const bytes =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(message)
      : Uint8Array.from(Array.from(message).map((c) => c.charCodeAt(0) & 0xff));

  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  view.setUint32(paddedLen - 8, hi, false);
  view.setUint32(paddedLen - 4, lo, false);

  const w = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((val) => val.toString(16).padStart(8, '0'))
    .join('');
}

export function categorizeLocalStorageKey(key: string): string {
  const k = key.toLowerCase();
  if (k.includes('ouvriers') && !k.includes('contractuels')) return 'RH — Ouvriers';
  if (k.includes('pointages') && !k.includes('contractuels') && !k.includes('sync_queue')) return 'RH — Pointages';
  if (k.includes('affectations') || k.includes('tache_serres')) return 'RH — Affectations & Serres';
  if (k.includes('taches') && !k.includes('supp')) return 'Administration — Tâches';
  if (k.includes('domaines') || k.includes('default_domaine')) return 'Administration — Domaines';
  if (k.includes('serres')) return 'Administration — Serres';
  if (k.includes('companies') || k.includes('active_company')) return 'Administration — Entreprises';
  if (k.includes('users') || k.includes('current_user') || k.includes('bio_')) return 'Administration — Comptes & Accès';
  if (k.includes('heures_supp') || k.includes('taches_supp')) return 'RH — Heures & Tâches Supplémentaires';
  if (k.includes('recolte')) return 'Récolte';
  if (k.includes('gazoil')) return 'Gazoil';
  if (k.includes('contractuels')) return 'Module Contractuelles';
  if (k.includes('remun') || k.includes('export_template') || k.includes('task_tarifs')) return 'Rémunération & Modèles Export';
  if (k.includes('sync_queue')) return 'File de Synchronisation';
  if (k.includes('backup') || k.includes('migration')) return 'Métadonnées Sauvegarde / Migration';
  if (/^sb-.*-auth-token/i.test(key) || /supabase\.auth/i.test(key)) return 'Session Auth Supabase (Exclue)';
  return 'Autre clé détectée';
}

function isAuthTokenKey(key: string): boolean {
  return (
    /^sb-[a-z0-9_-]+-auth-token/i.test(key) ||
    /^supabase\.auth\./i.test(key) ||
    /auth[-_]?token$/i.test(key)
  );
}

function sanitizeJsonValue(
  input: unknown,
  foundSensitive: Set<string>
): { sanitized: unknown; changed: boolean } {
  if (Array.isArray(input)) {
    let anyChanged = false;
    const out = input.map((item) => {
      const res = sanitizeJsonValue(item, foundSensitive);
      if (res.changed) anyChanged = true;
      return res.sanitized;
    });
    return { sanitized: out, changed: anyChanged };
  }

  if (input && typeof input === 'object') {
    let anyChanged = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(k.toLowerCase())) {
        foundSensitive.add(k);
        out[k] = '[EXPURGE_SECURITE]';
        anyChanged = true;
      } else {
        const res = sanitizeJsonValue(v, foundSensitive);
        if (res.changed) anyChanged = true;
        out[k] = res.sanitized;
      }
    }
    return { sanitized: out, changed: anyChanged };
  }

  return { sanitized: input, changed: false };
}

function countRecordsInParsed(parsed: unknown): number {
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return 0;
    // Si c'est un objet entité unique (entreprise, utilisateur courant, config)
    if ('id' in obj || 'stockInitial' in obj || 'username' in obj || 'credentialId' in obj) {
      return 1;
    }
    // Sinon c'est une map/dictionnaire (ex: overrides, validations, gazoilConfig par entreprise)
    return keys.length;
  }
  if (typeof parsed === 'string' && parsed.trim().length > 0) return 1;
  if (typeof parsed === 'number' || typeof parsed === 'boolean') return 1;
  return 0;
}

function snapshotLocalStorageKeys(): Array<{ key: string; raw: string; size_bytes: number; sha256: string }> {
  const out: Array<{ key: string; raw: string; size_bytes: number; sha256: string }> = [];
  if (typeof window === 'undefined' || !window.localStorage) return out;
  const len = window.localStorage.length;
  for (let i = 0; i < len; i++) {
    const key = window.localStorage.key(i);
    if (key === null) continue;
    const raw = window.localStorage.getItem(key) ?? '';
    out.push({
      key,
      raw,
      size_bytes: utf8BytesLength(raw),
      sha256: computeSha256HexSync(raw),
    });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

async function readExistingIndexedDBs(): Promise<{
  supported: boolean;
  enumerationSupported: boolean;
  databases: IndexedDBDatabaseExport[];
  errors: RecoveryErrorItem[];
}> {
  const errors: RecoveryErrorItem[] = [];
  if (typeof window === 'undefined' || !('indexedDB' in window) || !window.indexedDB) {
    return { supported: false, enumerationSupported: false, databases: [], errors };
  }

  const idb = window.indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string; version?: number }>>;
  };

  if (typeof idb.databases !== 'function') {
    return {
      supported: true,
      enumerationSupported: false,
      databases: [],
      errors: [
        {
          source: 'IndexedDB',
          message:
            'L’API indexedDB.databases() n’est pas disponible sur ce navigateur ; aucune ouverture aveugle effectuée afin d’éviter toute création de base.',
        },
      ],
    };
  }

  let dbList: Array<{ name?: string; version?: number }> = [];
  try {
    dbList = await idb.databases();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ source: 'IndexedDB', message: `Erreur énumération IndexedDB : ${msg}` });
    return { supported: true, enumerationSupported: true, databases: [], errors };
  }

  const exportedDbs: IndexedDBDatabaseExport[] = [];

  for (const info of dbList) {
    const dbName = info?.name;
    if (!dbName) continue;

    // Ne jamais exposer d'éventuelles bases purement auth tiers contenant des secrets
    try {
      const dbResult = await new Promise<IndexedDBDatabaseExport>((resolve) => {
        let openedDb: IDBDatabase | null = null;
        let abortedUpgrade = false;

        const req = idb.open(dbName);

        req.onupgradeneeded = () => {
          // Sécurité absolue : ne jamais créer ni mettre à jour une base IndexedDB
          abortedUpgrade = true;
          try {
            req.transaction?.abort();
          } catch {
            // ignore
          }
        };

        req.onerror = () => {
          resolve({
            name: dbName,
            version: info.version || 0,
            status: 'ERREUR_LECTURE',
            object_stores: [],
            record_count: 0,
            size_bytes: 0,
            stores: {},
            error: abortedUpgrade
              ? 'Ouverture annulée (onupgradeneeded détecté — protection lecture seule).'
              : req.error?.message || 'Erreur ouverture IndexedDB',
          });
        };

        req.onsuccess = () => {
          openedDb = req.result;
          const storeNames = Array.from(openedDb.objectStoreNames || []);
          if (storeNames.length === 0) {
            const ver = openedDb.version;
            openedDb.close();
            resolve({
              name: dbName,
              version: ver,
              status: 'VIDE',
              object_stores: [],
              record_count: 0,
              size_bytes: 0,
              stores: {},
            });
            return;
          }

          try {
            const tx = openedDb.transaction(storeNames, 'readonly');
            const storesOut: Record<string, IndexedDBStoreExport> = {};
            let totalRecords = 0;
            let totalBytes = 0;
            let pending = storeNames.length;
            let finished = false;

            const finalize = (errMsg?: string) => {
              if (finished) return;
              finished = true;
              const ver = openedDb ? openedDb.version : info.version || 0;
              try {
                openedDb?.close();
              } catch {
                // ignore
              }
              if (errMsg) {
                resolve({
                  name: dbName,
                  version: ver,
                  status: 'ERREUR_LECTURE',
                  object_stores: storeNames,
                  record_count: totalRecords,
                  size_bytes: totalBytes,
                  stores: storesOut,
                  error: errMsg,
                });
              } else {
                resolve({
                  name: dbName,
                  version: ver,
                  status: totalRecords === 0 ? 'VIDE' : 'EXPORTE',
                  object_stores: storeNames,
                  record_count: totalRecords,
                  size_bytes: totalBytes,
                  stores: storesOut,
                });
              }
            };

            tx.onerror = () => finalize(tx.error?.message || 'Erreur transaction lecture seule');
            tx.onabort = () => finalize('Transaction lecture seule interrompue');

            for (const storeName of storeNames) {
              const store = tx.objectStore(storeName);
              const getAllReq = store.getAll();
              getAllReq.onsuccess = () => {
                const rawRecords = Array.isArray(getAllReq.result) ? getAllReq.result : [];
                let sanitizedCount = 0;
                const cleanRecords = rawRecords.map((rec) => {
                  const found = new Set<string>();
                  const res = sanitizeJsonValue(rec, found);
                  if (res.changed) sanitizedCount++;
                  return res.sanitized;
                });
                const serialized = JSON.stringify(cleanRecords);
                const bytes = utf8BytesLength(serialized);
                storesOut[storeName] = {
                  records: cleanRecords,
                  record_count: cleanRecords.length,
                  size_bytes: bytes,
                  sanitized_records_count: sanitizedCount,
                };
                totalRecords += cleanRecords.length;
                totalBytes += bytes;
                pending--;
                if (pending === 0) finalize();
              };
              getAllReq.onerror = () => {
                storesOut[storeName] = {
                  records: [],
                  record_count: 0,
                  size_bytes: 0,
                  sanitized_records_count: 0,
                };
                pending--;
                if (pending === 0) finalize();
              };
            }
          } catch (txErr: unknown) {
            const msg = txErr instanceof Error ? txErr.message : String(txErr);
            const ver = openedDb?.version || info.version || 0;
            try {
              openedDb?.close();
            } catch {
              // ignore
            }
            resolve({
              name: dbName,
              version: ver,
              status: 'ERREUR_LECTURE',
              object_stores: storeNames,
              record_count: 0,
              size_bytes: 0,
              stores: {},
              error: msg,
            });
          }
        };
      });

      if (dbResult.error) {
        errors.push({ source: `IndexedDB:${dbName}`, message: dbResult.error });
      }
      exportedDbs.push(dbResult);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ source: `IndexedDB:${dbName}`, message: msg });
    }
  }

  return {
    supported: true,
    enumerationSupported: true,
    databases: exportedDbs,
    errors,
  };
}

/**
 * Analyse et lecture complète sans aucune écriture ni modification des données d'origine.
 */
export async function analyzeBrowserDataReadOnly(): Promise<RecoveryAnalysisResult> {
  const errors: RecoveryErrorItem[] = [];
  const snapshotBefore = snapshotLocalStorageKeys();

  const localStorageInventory: LocalStorageKeyInventory[] = [];
  const localStorageRaw: Record<string, LocalStorageExportEntry> = {};

  let totalLocalBytes = 0;
  let totalLocalRecords = 0;
  let excludedSecurityCount = 0;

  let syncQueueFound = false;
  let syncQueueRecords = 0;
  let pointageSyncQueueFound = false;
  let pointageSyncQueueRecords = 0;

  for (const item of snapshotBefore) {
    const { key, raw, size_bytes, sha256 } = item;
    const category = categorizeLocalStorageKey(key);

    if (isAuthTokenKey(key)) {
      excludedSecurityCount++;
      localStorageInventory.push({
        key,
        category,
        status: 'EXCLU_SECURITE',
        record_count: 0,
        size_bytes,
        sanitized: true,
        excluded_reason: 'Jeton de session / authentification exclu par politique de sécurité.',
        sha256,
      });
      localStorageRaw[key] = {
        size_bytes,
        record_count: 0,
        status: 'EXCLU_SECURITE',
        excluded_reason: 'Jeton de session / authentification exclu par politique de sécurité.',
        sha256,
      };
      continue;
    }

    let recordCount = 0;
    let status: ExportKeyStatus = 'EXPORTE';
    let exportedRaw = raw;
    let sanitizedFields: string[] | undefined;

    try {
      const parsed = JSON.parse(raw);
      recordCount = countRecordsInParsed(parsed);

      const foundSensitive = new Set<string>();
      const checkSanitized = sanitizeJsonValue(parsed, foundSensitive);
      if (checkSanitized.changed) {
        status = 'EXPORTE_SANS_SECRETS';
        exportedRaw = JSON.stringify(checkSanitized.sanitized);
        sanitizedFields = Array.from(foundSensitive);
      }

      if (key === 'agripointage_sync_queue_v1') {
        syncQueueFound = true;
        syncQueueRecords = Array.isArray(parsed) ? parsed.length : recordCount;
      } else if (key === 'agripointage_pointage_sync_queue_v1') {
        pointageSyncQueueFound = true;
        pointageSyncQueueRecords = Array.isArray(parsed) ? parsed.length : recordCount;
      }
    } catch {
      // Valeur texte brute non-JSON (ex: string simple)
      recordCount = raw.trim().length > 0 ? 1 : 0;
    }

    totalLocalBytes += size_bytes;
    totalLocalRecords += recordCount;

    localStorageInventory.push({
      key,
      category,
      status,
      record_count: recordCount,
      size_bytes,
      sanitized: status === 'EXPORTE_SANS_SECRETS',
      ...(sanitizedFields ? { sanitized_fields: sanitizedFields } : {}),
      sha256,
    });

    localStorageRaw[key] = {
      raw_value: exportedRaw,
      size_bytes,
      record_count: recordCount,
      status,
      ...(sanitizedFields ? { sanitized_fields: sanitizedFields } : {}),
      sha256,
    };
  }

  const idbResult = await readExistingIndexedDBs();
  errors.push(...idbResult.errors);

  const idbTotalRecords = idbResult.databases.reduce((acc, db) => acc + db.record_count, 0);
  const idbTotalBytes = idbResult.databases.reduce((acc, db) => acc + db.size_bytes, 0);

  const sourcesDetected: RecoverySourceStatus[] = [
    {
      source: 'window.localStorage',
      accessible: typeof window !== 'undefined' && Boolean(window.localStorage),
      item_count: localStorageInventory.length,
      record_count: totalLocalRecords,
      size_bytes: totalLocalBytes,
      details: `${localStorageInventory.length} clé(s) lue(s) en lecture seule (${excludedSecurityCount} clé(s) d'authentification exclue(s) par sécurité).`,
    },
    {
      source: 'IndexedDB',
      accessible: idbResult.supported && idbResult.enumerationSupported,
      item_count: idbResult.databases.length,
      record_count: idbTotalRecords,
      size_bytes: idbTotalBytes,
      details: !idbResult.supported
        ? 'IndexedDB non supporté dans cet environnement.'
        : !idbResult.enumerationSupported
        ? 'API indexedDB.databases() indisponible sur ce navigateur.'
        : `${idbResult.databases.length} base(s) détectée(s), ${idbTotalRecords} enregistrement(s).`,
    },
    {
      source: 'Files d’attente de synchronisation',
      accessible: true,
      item_count: (syncQueueFound ? 1 : 0) + (pointageSyncQueueFound ? 1 : 0),
      record_count: syncQueueRecords + pointageSyncQueueRecords,
      size_bytes:
        (localStorageRaw['agripointage_sync_queue_v1']?.size_bytes || 0) +
        (localStorageRaw['agripointage_pointage_sync_queue_v1']?.size_bytes || 0),
      details: `sync_queue=${syncQueueRecords}, pointage_sync_queue=${pointageSyncQueueRecords}.`,
    },
  ];

  const inaccessibleSources = [
    {
      source: 'Supabase Live (base distante)',
      reason:
        'Non requêtée par cet outil afin de fonctionner sans session/connexion Supabase et sans déclencher d’écriture ou de mutation.',
    },
    {
      source: 'Autres origines / autres navigateurs',
      reason:
        'La politique de sécurité navigateur (Same-Origin Policy) isole le localStorage par URL exacte et par navigateur.',
    },
  ];

  return {
    analyzed_at: new Date().toISOString(),
    origin: typeof window !== 'undefined' && window.location ? window.location.origin : 'unknown',
    href_path: typeof window !== 'undefined' && window.location ? window.location.pathname : '/',
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    keys_snapshot_before: snapshotBefore.map(({ key, size_bytes, sha256 }) => ({
      key,
      size_bytes,
      sha256,
    })),
    localStorage_keys: localStorageInventory,
    localStorage_raw: localStorageRaw,
    indexedDB_supported: idbResult.supported,
    indexedDB_enumeration_supported: idbResult.enumerationSupported,
    indexedDB_databases: idbResult.databases,
    sources_detected: sourcesDetected,
    inaccessible_sources: inaccessibleSources,
    sync_queues: {
      sync_queue_found: syncQueueFound,
      sync_queue_records: syncQueueRecords,
      pointage_sync_queue_found: pointageSyncQueueFound,
      pointage_sync_queue_records: pointageSyncQueueRecords,
    },
    totals: {
      localStorage_keys_count: localStorageInventory.length,
      localStorage_excluded_security_count: excludedSecurityCount,
      indexedDB_databases_count: idbResult.databases.length,
      total_records_count: totalLocalRecords + idbTotalRecords,
      total_bytes: totalLocalBytes + idbTotalBytes,
    },
    errors,
  };
}

export function formatBackupFilename(): string {
  return 'LAHCEN_POINTEUR_RECUPERATION_INTEGRALE.json';
}

/**
 * Construit le JSON d'export complet et vérifie l'intégrité avant de déclarer le succès.
 */
export async function buildAndVerifyRecoveryExport(
  existingAnalysis?: RecoveryAnalysisResult
): Promise<{
  filename: string;
  jsonString: string;
  payload: RecoveryBackupPayload;
  verifiedOk: boolean;
}> {
  const analysis = existingAnalysis || (await analyzeBrowserDataReadOnly());
  const now = new Date();
  const filename = formatBackupFilename();

  // Vérifier après lecture que toutes les clés et leurs empreintes n'ont pas changé
  const snapshotAfter = snapshotLocalStorageKeys();
  const beforeMap = new Map(analysis.keys_snapshot_before.map((k) => [k.key, k.sha256]));
  const afterMap = new Map(snapshotAfter.map((k) => [k.key, k.sha256]));

  const keysUnchanged =
    beforeMap.size === afterMap.size &&
    Array.from(beforeMap.entries()).every(([k, hash]) => afterMap.get(k) === hash);

  const exportedKeysCount = Object.keys(analysis.localStorage_raw).length;
  const exportedRecordsCount =
    Object.values(analysis.localStorage_raw).reduce((s, e) => s + e.record_count, 0) +
    analysis.indexedDB_databases.reduce((s, db) => s + db.record_count, 0);

  const syncQueuesIncluded =
    (!analysis.sync_queues.sync_queue_found || 'agripointage_sync_queue_v1' in analysis.localStorage_raw) &&
    (!analysis.sync_queues.pointage_sync_queue_found ||
      'agripointage_pointage_sync_queue_v1' in analysis.localStorage_raw);

  const verification: RecoveryVerificationReport = {
    json_valid: false,
    keys_before_count: analysis.keys_snapshot_before.length,
    keys_after_count: snapshotAfter.length,
    keys_unchanged: keysUnchanged,
    origin_data_unmodified: keysUnchanged,
    sync_queues_included: syncQueuesIncluded,
    exported_records_match:
      exportedKeysCount === analysis.totals.localStorage_keys_count &&
      exportedRecordsCount === analysis.totals.total_records_count,
    errors_count: analysis.errors.length,
  };

  const perKeySha: Record<string, string> = {};
  for (const item of analysis.localStorage_keys) {
    perKeySha[item.key] = item.sha256;
  }

  const indexedDBData: RecoveryBackupPayload['indexedDB_data'] = {};
  for (const db of analysis.indexedDB_databases) {
    indexedDBData[db.name] = {
      version: db.version,
      status: db.status,
      stores: db.stores,
      ...(db.error ? { error: db.error } : {}),
    };
  }

  const basePayloadWithoutDigest = {
    metadata: {
      app: 'Lahcen Pointeur / AgriPointage',
      tool_name: 'RÉCUPÉRATION DES DONNÉES — MODE SÉCURISÉ',
      mode: 'LECTURE_SEULE_SANS_MODIFICATION' as const,
      filename,
      created_at: now.toISOString(),
      local_date_time: now.toLocaleString('fr-FR'),
      origin: analysis.origin,
      href_path: analysis.href_path,
      user_agent: analysis.user_agent,
    },
    summary: {
      localStorage_keys_count: analysis.totals.localStorage_keys_count,
      localStorage_excluded_security_count: analysis.totals.localStorage_excluded_security_count,
      indexedDB_databases_count: analysis.totals.indexedDB_databases_count,
      total_records_count: analysis.totals.total_records_count,
      total_bytes: analysis.totals.total_bytes,
      sync_queues: analysis.sync_queues,
      sources_detected: analysis.sources_detected,
      inaccessible_sources: analysis.inaccessible_sources,
    },
    inventory: {
      localStorage: analysis.localStorage_keys,
      indexedDB: analysis.indexedDB_databases.map((db) => ({
        name: db.name,
        version: db.version,
        status: db.status,
        object_stores: db.object_stores,
        record_count: db.record_count,
        size_bytes: db.size_bytes,
        ...(db.error ? { error: db.error } : {}),
      })),
    },
    localStorage_raw: analysis.localStorage_raw,
    indexedDB_data: indexedDBData,
    errors: analysis.errors,
    verification: {
      ...verification,
      json_valid: true,
    },
  };

  const canonicalDataString = JSON.stringify({
    localStorage_raw: basePayloadWithoutDigest.localStorage_raw,
    indexedDB_data: basePayloadWithoutDigest.indexedDB_data,
  });
  const payloadSha256 = computeSha256HexSync(canonicalDataString);

  const payload: RecoveryBackupPayload = {
    ...basePayloadWithoutDigest,
    manifest_sha256: {
      algorithm: 'SHA-256',
      payload_sha256: payloadSha256,
      per_localStorage_key_sha256: perKeySha,
    },
  };

  const jsonString = JSON.stringify(payload, null, 2);

  // Vérification finale par parsing aller-retour
  let roundTripOk = false;
  try {
    const parsedBack = JSON.parse(jsonString) as RecoveryBackupPayload;
    roundTripOk =
      Boolean(parsedBack?.metadata?.filename === filename) &&
      Object.keys(parsedBack?.localStorage_raw || {}).length === exportedKeysCount;
  } catch {
    roundTripOk = false;
  }

  payload.verification.json_valid = roundTripOk;
  const finalJsonString = JSON.stringify(payload, null, 2);

  const verifiedOk =
    roundTripOk &&
    verification.keys_unchanged &&
    verification.origin_data_unmodified &&
    verification.sync_queues_included &&
    verification.exported_records_match;

  return {
    filename,
    jsonString: finalJsonString,
    payload,
    verifiedOk,
  };
}
