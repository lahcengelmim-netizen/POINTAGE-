import assert from 'node:assert/strict';
import {
  analyzeBrowserDataReadOnly,
  buildAndVerifyRecoveryExport,
  computeSha256HexSync,
  formatBackupFilename,
} from '../src/utils/secureDataRecovery';

function createMockLocalStorage(initial: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial));
  let writeCalls = 0;

  return {
    getWriteCalls: () => writeCalls,
    storage: {
      get length() {
        return store.size;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      getItem(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      setItem(key: string, value: string) {
        writeCalls++;
        store.set(key, String(value));
      },
      removeItem(key: string) {
        writeCalls++;
        store.delete(key);
      },
      clear() {
        writeCalls++;
        store.clear();
      },
    },
  };
}

async function runTests() {
  const sampleOuvriers = JSON.stringify([
    { id: 'ouv_real_1', numero: 12, nom: 'Ahmed Benali', actif: true },
    { id: 'ouv_real_2', numero: 55, nom: 'Khadija Alaoui', actif: true },
  ]);
  const samplePointages = JSON.stringify([
    { id: 'ptg_1', date: '2026-11-16', ouvrier_id: 'ouv_real_1', present: true, domaine_id: 'dom_d2' },
  ]);
  const sampleSyncQueue = JSON.stringify([{ table: 'recoltes', id: 'rec_pending_1', caisses: 42 }]);
  const samplePointageQueue = JSON.stringify([
    { table: 'pointages', action: 'upsert', data: { id: 'ptg_1' } },
  ]);
  const sampleUsers = JSON.stringify([
    {
      id: 'usr_1',
      username: 'lahcen',
      nom: 'Lahcen Admin',
      role: 'admin',
      passwordHash: 'SHOULD_NOT_BE_EXPORTED_HASH',
      salt: 'SHOULD_NOT_BE_EXPORTED_SALT',
    },
  ]);
  const sampleContractuels = JSON.stringify([{ id: 'co_1', matricule: 'C01', nom: 'Salma' }]);
  const sampleRemun = JSON.stringify({ 'ouv_real_1': { tarif: 105, validated: true } });
  const sampleUnknownKey = JSON.stringify({ customNote: 'Historique terrain important' });
  const sampleSupabaseAuthToken = JSON.stringify({
    access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.secret',
    refresh_token: 'super-secret-refresh-token',
  });

  const mock = createMockLocalStorage({
    agripointage_ouvriers_v1: sampleOuvriers,
    agripointage_pointages_v1: samplePointages,
    agripointage_sync_queue_v1: sampleSyncQueue,
    agripointage_pointage_sync_queue_v1: samplePointageQueue,
    agripointage_users_v1: sampleUsers,
    agripointage_contractuels_ouvriers_v1: sampleContractuels,
    'agripointage_remuneration_overrides_v1:cie_lahcen_pointeur:2026-11-16': sampleRemun,
    custom_terrain_extra_key: sampleUnknownKey,
    'sb-kqlksjvtwcwovfgxijab-auth-token': sampleSupabaseAuthToken,
  });

  (globalThis as any).window = {
    localStorage: mock.storage,
    location: {
      origin: 'https://ais-pre-t3qcoa6ks6dzfrjb4phnnq-800391928486.europe-west2.run.app',
      pathname: '/',
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Android Chrome Test' },
    configurable: true,
  });

  // 1. Analyse lecture seule
  const analysis = await analyzeBrowserDataReadOnly();
  assert.equal(mock.getWriteCalls(), 0, 'Aucune écriture localStorage autorisée lors de l’analyse');
  assert.equal(analysis.totals.localStorage_keys_count, 9);
  assert.equal(analysis.totals.localStorage_excluded_security_count, 1);
  assert.equal(analysis.sync_queues.sync_queue_found, true);
  assert.equal(analysis.sync_queues.sync_queue_records, 1);
  assert.equal(analysis.sync_queues.pointage_sync_queue_found, true);
  assert.equal(analysis.sync_queues.pointage_sync_queue_records, 1);

  // 2. Export & vérification d'intégrité
  const exported = await buildAndVerifyRecoveryExport(analysis);
  assert.equal(mock.getWriteCalls(), 0, 'Aucune écriture localStorage autorisée lors de l’export');
  assert.equal(exported.filename, 'LAHCEN_POINTEUR_RECUPERATION_INTEGRALE.json');

  // 3. Vérifier valeurs brutes sans transformation pour clés métier + clé inconnue
  assert.equal(exported.payload.localStorage_raw['agripointage_ouvriers_v1'].raw_value, sampleOuvriers);
  assert.equal(exported.payload.localStorage_raw['agripointage_pointages_v1'].raw_value, samplePointages);
  assert.equal(exported.payload.localStorage_raw['agripointage_sync_queue_v1'].raw_value, sampleSyncQueue);
  assert.equal(
    exported.payload.localStorage_raw['agripointage_pointage_sync_queue_v1'].raw_value,
    samplePointageQueue
  );
  assert.equal(
    exported.payload.localStorage_raw['agripointage_contractuels_ouvriers_v1'].raw_value,
    sampleContractuels
  );
  assert.equal(
    exported.payload.localStorage_raw['agripointage_remuneration_overrides_v1:cie_lahcen_pointeur:2026-11-16']
      .raw_value,
    sampleRemun
  );
  assert.equal(exported.payload.localStorage_raw['custom_terrain_extra_key'].raw_value, sampleUnknownKey);

  // 4. Vérifier sécurité : aucun hash, salt ou JWT exporté
  assert.ok(!exported.jsonString.includes('SHOULD_NOT_BE_EXPORTED_HASH'));
  assert.ok(!exported.jsonString.includes('SHOULD_NOT_BE_EXPORTED_SALT'));
  assert.ok(!exported.jsonString.includes('super-secret-refresh-token'));
  assert.ok(!exported.jsonString.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.equal(
    exported.payload.localStorage_raw['sb-kqlksjvtwcwovfgxijab-auth-token'].status,
    'EXCLU_SECURITE'
  );
  assert.equal(exported.payload.localStorage_raw['agripointage_users_v1'].status, 'EXPORTE_SANS_SECRETS');

  // 5. Vérifier SHA-256 déterministe et format nom de fichier
  assert.equal(computeSha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(formatBackupFilename(), 'LAHCEN_POINTEUR_RECUPERATION_INTEGRALE.json');

  console.log('ALL SECURE DATA RECOVERY TESTS PASSED');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
