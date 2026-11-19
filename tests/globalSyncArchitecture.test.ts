/**
 * Suite de tests d'intégration réels : Architecture de sauvegarde & synchronisation globale
 * Exécutable avec : npx tsx tests/globalSyncArchitecture.test.ts
 *
 * Vérifie de bout en bout (sans toucher à la base Supabase de production) :
 * 1. Push & Pull complets multi-modules (Référentiels, Pointage, Gazoil, Récolte, Supp, Contractuels, Stock, Paiement)
 * 2. Outboxes typées isolées & défilement atomique par opId (résistance aux écritures concurrentes)
 * 3. Hydratation complète sur un nouvel appareil (localStorage vide) & suppression des ouvriers démo provisoires
 * 4. Survie aux déconnexions/reconnexions, redémarrage serveur et changement d'URL
 * 5. Résilience aux erreurs transitoires (retryCount++ sans perte ni duplication, idempotence Stock)
 * 6. Protection absolue contre l'écrasement par [] ou erreur réseau/Supabase
 * 7. Résolution déterministe de conflits LWW avec journalisation des versions évincées
 * 8. Cloisonnement strict company_id & RBAC (Admin, Caporal Récolte, Caporal Contractuelles, Tariq)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.SKIP_AUTO_START = 'true';
process.env.ALLOW_DEV_TOKENS = 'true';

// 1. Polyfill localStorage multi-appareils commutable
let activeStore: Record<string, string> = {};
function switchDeviceStorage(store: Record<string, string>) {
  activeStore = store;
}
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in activeStore ? activeStore[k] : null),
  setItem: (k: string, v: string) => {
    activeStore[k] = String(v);
  },
  removeItem: (k: string) => {
    delete activeStore[k];
  },
  clear: () => {
    Object.keys(activeStore).forEach((k) => delete activeStore[k]);
  },
  key: (idx: number) => Object.keys(activeStore)[idx] ?? null,
  get length() {
    return Object.keys(activeStore).length;
  },
};

function setOnlineState(isOnline: boolean) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: isOnline },
    configurable: true,
    writable: true,
  });
}

// Sauvegarder ./data/recolte_db.json pour le restaurer strictement en fin de test
const dbFilePath = path.join(process.cwd(), 'data', 'recolte_db.json');
const dbBackupRaw = fs.existsSync(dbFilePath) ? fs.readFileSync(dbFilePath, 'utf-8') : null;

// Mock Supabase complet en mémoire avec pagination range(), filtres, onConflict et injection d'erreurs
function createMockSupabase() {
  const tables: Record<string, any[]> = {
    companies: [
      { id: 'cie_lahcen_pointeur', nom: 'Exploitation Agricole Lahcen Pointeur', code: 'LAH', actif: true },
      { id: 'cie_autre_entreprise', nom: 'Autre Exploitation', code: 'AUT', actif: true },
    ],
    profiles: [],
    domaines: [],
    serres: [],
    ouvriers: [],
    taches: [],
    pointages: [],
    affectations: [],
    tache_serres: [],
    recolte_entries: [],
    heures_supplementaires: [],
    taches_supplementaires: [],
    gazoil_config: [],
    gazoil_mouvements: [],
    paiement_tariffs: [],
    paiement_export_snapshots: [],
    paiement_day_overrides: [],
  };

  const failWrites = new Set<string>();
  const failReads = new Set<string>();

  function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
  }

  function makeSelectBuilder(table: string) {
    const filters: Array<(r: any) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let rangeBounds: { from: number; to: number } | null = null;
    let limitCount: number | null = null;

    const execute = () => {
      if (failReads.has(table)) {
        return { data: null, error: { message: `Simulated read failure on ${table}`, code: '503' } };
      }
      let rows = clone(tables[table] || []).filter((r) => filters.every((fn) => fn(r)));
      if (orderCol) {
        rows.sort((a, b) => {
          const av = a[orderCol!];
          const bv = b[orderCol!];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          const cmp = av < bv ? -1 : 1;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (rangeBounds) {
        rows = rows.slice(rangeBounds.from, rangeBounds.to + 1);
      }
      if (limitCount !== null) {
        rows = rows.slice(0, limitCount);
      }
      return { data: rows, error: null };
    };

    const q: any = {
      eq: (col: string, val: any) => {
        filters.push((r) => r?.[col] === val);
        return q;
      },
      neq: (col: string, val: any) => {
        filters.push((r) => r?.[col] !== val);
        return q;
      },
      gte: (col: string, val: any) => {
        filters.push((r) => r?.[col] >= val);
        return q;
      },
      lte: (col: string, val: any) => {
        filters.push((r) => r?.[col] <= val);
        return q;
      },
      in: (col: string, vals: any[]) => {
        filters.push((r) => Array.isArray(vals) && vals.includes(r?.[col]));
        return q;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return q;
      },
      range: (from: number, to: number) => {
        rangeBounds = { from, to };
        return q;
      },
      limit: (n: number) => {
        limitCount = n;
        return q;
      },
      maybeSingle: () => {
        const res = execute();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        return Promise.resolve({ data: res.data?.[0] || null, error: null });
      },
      single: () => {
        const res = execute();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        return Promise.resolve({ data: res.data?.[0] || null, error: null });
      },
      then: (cb: any, rej?: any) => Promise.resolve(execute()).then(cb, rej),
    };
    return q;
  }

  return {
    tables,
    failWrites,
    failReads,
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'mock_jwt_session', user: { id: 'usr_admin' } } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (!tables[table]) tables[table] = [];
      return {
        select: () => makeSelectBuilder(table),
        upsert: (payload: any, opts?: { onConflict?: string }) => {
          const exec = () => {
            if (failWrites.has(table)) {
              return { data: null, error: { message: `Simulated write error on ${table}`, code: '500' } };
            }
            const rows = Array.isArray(payload) ? payload : [payload];
            const conflictCols = (opts?.onConflict || 'id')
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            for (const row of rows) {
              const idx = tables[table].findIndex((existing) =>
                conflictCols.every((c) => row[c] !== undefined && existing[c] === row[c])
              );
              if (idx >= 0) {
                tables[table][idx] = clone({ ...tables[table][idx], ...row });
              } else {
                tables[table].push(clone(row));
              }
            }
            return { data: clone(payload), error: null };
          };
          return {
            select: () => ({
              single: () => Promise.resolve(exec()),
              maybeSingle: () => Promise.resolve(exec()),
              then: (cb: any, rej?: any) => Promise.resolve(exec()).then(cb, rej),
            }),
            then: (cb: any, rej?: any) => Promise.resolve(exec()).then(cb, rej),
          };
        },
        insert: (payload: any) => {
          const exec = () => {
            if (failWrites.has(table)) {
              return { data: null, error: { message: `Simulated insert error on ${table}`, code: '500' } };
            }
            const rows = Array.isArray(payload) ? payload : [payload];
            for (const row of rows) {
              if (row.id && tables[table].some((e) => e.id === row.id)) {
                return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
              }
              tables[table].push(clone(row));
            }
            return { data: clone(payload), error: null };
          };
          return {
            select: () => ({
              single: () => Promise.resolve(exec()),
              maybeSingle: () => Promise.resolve(exec()),
              then: (cb: any, rej?: any) => Promise.resolve(exec()).then(cb, rej),
            }),
            then: (cb: any, rej?: any) => Promise.resolve(exec()).then(cb, rej),
          };
        },
        delete: () => {
          const filters: Array<(r: any) => boolean> = [];
          const exec = () => {
            if (failWrites.has(table)) {
              return { error: { message: `Simulated delete error on ${table}`, code: '500' } };
            }
            tables[table] = tables[table].filter((r) => !filters.every((fn) => fn(r)));
            return { error: null };
          };
          const builder: any = {
            eq: (col: string, val: any) => {
              filters.push((r) => r?.[col] === val);
              return builder;
            },
            neq: (col: string, val: any) => {
              filters.push((r) => r?.[col] !== val);
              return builder;
            },
            in: (col: string, vals: any[]) => {
              filters.push((r) => Array.isArray(vals) && vals.includes(r?.[col]));
              return builder;
            },
            then: (cb: any, rej?: any) => Promise.resolve(exec()).then(cb, rej),
          };
          return builder;
        },
      };
    },
  };
}

async function runTests() {
  const { app } = await import('../server');
  const storage = await import('../src/services/storage');
  const syncOutbox = await import('../src/services/syncOutbox');
  const globalSync = await import('../src/services/globalSyncService');
  const paiementExp = await import('../src/utils/paiementExporter');

  // Démarrer le serveur Express réel sur port éphémère (Instance 1)
  let server1: any = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  let baseUrl = `http://127.0.0.1:${(server1.address() as AddressInfo).port}`;
  let server2: any = null;

  try {
    const mockSupabase = createMockSupabase();
    const companyId = 'cie_lahcen_pointeur';
    const testDate = '2026-11-18';

    const adminUser = {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'lahcen',
      nom: 'Lahcen (Admin)',
      role: 'admin' as const,
      module_attribue: 'all' as const,
      company_id: companyId,
      actif: true,
      createdAt: '2026-11-01T08:00:00Z',
    };

    const tariqUser = {
      id: '22222222-2222-4222-8222-222222222222',
      username: 'tariq',
      nom: 'Tariq (Caporal Contractuelles)',
      role: 'caporal_contractuelles' as const,
      module_attribue: 'contractuelles' as const,
      company_id: companyId,
      actif: true,
      createdAt: '2026-11-01T08:00:00Z',
    };

    const caporalRecolteUser = {
      id: '33333333-3333-4333-8333-333333333333',
      username: 'brahim',
      nom: 'Brahim (Caporal Récolte)',
      role: 'caporal' as const,
      module_attribue: 'recolte' as const,
      company_id: companyId,
      actif: true,
      createdAt: '2026-11-01T08:00:00Z',
    };

    const deviceAStore: Record<string, string> = {};
    switchDeviceStorage(deviceAStore);
    storage.initStorage();
    storage.setActiveCompanyId(companyId);
    storage.setCurrentUser(adminUser);

    // =========================================================================
    // TEST 1 : Saisies hors ligne sur Référentiels, Pointage, Gazoil, Paiement -> Sync Supabase
    // =========================================================================
    setOnlineState(false);

    const domRes = storage.saveDomaine({ id: 'dom_test_1', nom: 'Domaine Test Sync', ordre: 9 });
    assert.ok(domRes.id);

    const serreRes = storage.saveSerre(companyId, {
      id: 'serre_test_999',
      code: 'D2-S999',
      nom: 'Serre Test 999',
      actif: true,
      domaine_id: 'dom_test_1',
    });
    assert.equal(serreRes.success, true);

    const ouvrierRes = storage.saveOuvrier(companyId, {
      id: 'ouv_sync_101',
      numero: 101,
      nom: 'ALAMI RACHID',
      actif: true,
    });
    assert.equal(ouvrierRes.success, true);

    const tacheRes = storage.saveTache(companyId, {
      id: 'tch_sync_cerise',
      nom: 'Récolte Cerise Sync',
      remuneration_mode: 'METRIQUE',
      unite_metrique: 'Caisse',
      tarif_unitaire: 3.8,
      tarif_heure: 11.875,
      actif: true,
    });
    assert.equal(tacheRes.success, true);

    const ptgRes = storage.addPointage(
      companyId,
      'ouv_sync_101',
      testDate,
      'tch_sync_cerise',
      'dom_test_1',
      'serre_test_1',
      'Serre Test 99'
    );
    assert.equal(ptgRes.success, true);

    const tsRes = storage.saveTacheSerreConfig(
      companyId,
      testDate,
      'tch_sync_cerise',
      'dom_test_1',
      ['serre_test_1'],
      ['Serre Test 99']
    );
    assert.ok(tsRes.id);

    storage.setStockInitialGazoil(companyId, 500);
    storage.addGazoilMouvement(companyId, {
      type: 'sortie',
      date: testDate,
      quantite: 45,
      engin_ou_tache: 'Tracteur 1',
      remarque: 'Plein hors ligne',
    });

    const tarConfig = {
      ...paiementExp.createDefaultPaiementTariffs(),
      travailNormalJour: 125,
      version: 4,
      updatedAt: '2026-11-18T10:00:00Z',
    };
    const paiTarQueue = await paiementExp.syncSavePaiementTariffsToSupabase(
      adminUser,
      companyId,
      tarConfig,
      mockSupabase as any
    );
    assert.equal(paiTarQueue.syncedToSupabase, false, 'Hors ligne doit mettre en file PAIEMENT sans mentir');

    const snapshotTest: any = {
      id: 'snap_test_immutable_1',
      companyId,
      dateIso: testDate,
      domaineFilter: 'ALL',
      exportedAt: '2026-11-18T10:05:00Z',
      exportedById: adminUser.id,
      exportedByNom: adminUser.nom,
      filename: `EXPORT_PAIEMENT_TOUS_DOMAINES_${testDate}.xlsx`,
      tariffsSnapshot: tarConfig,
      rows: [
        {
          docId: 'D002_2026-11-18_101-D2_1',
          dateTrava: testDate,
          ouvrierId: '101-D2',
          nomOuvrier: 'ALAMI RACHID',
          DT: 'D002',
          serreId: 'D002S99',
          rubanId: 'Tous les Rubans',
          cultureId: 'TOMATE',
          tacheTypeId: 'Récolte Cerise Sync',
          tache: 'Récolte Cerise Sync',
          uniteMetrique: 'Caisse',
          quantiteMetrique: 25,
          quantite: '',
          heureDeb: '07:00',
          heureFin: '14:00',
          dureeRep: 0,
          dureeTravaillee: 7,
          periodeJo: 'JOURNEE',
          statut: 'BROUILLON',
          equipeId: 'EQ1',
          tarifExcep: 3.8,
          remuneration: 95,
          rowKey: 'rk_101',
          sourceType: 'RECOLTE',
          tacheNomOriginal: 'Récolte Cerise Sync',
          effectiveHours: 7,
          isBlockedMissingVariety: false,
        },
      ],
      totalByWorker: [
        {
          workerKey: 'num_101',
          ouvrierId: '101-D2',
          numeroOuvrier: 101,
          nomOuvrier: 'ALAMI RACHID',
          domaineDT: 'D002',
          taches: ['Récolte Cerise Sync'],
          tarifsAppliques: ['3.8 DH / caisse (Coeff 3.8)'],
          coefficients: ['3.8'],
          totalHeures: 7,
          totalRecolte: 25,
          rowsCount: 1,
          totalDH: 95,
        },
      ],
      grandTotalDH: 95,
      totalOuvriersDistincts: 1,
    };
    await paiementExp.syncSavePaiementSnapshotToSupabase(adminUser, snapshotTest, mockSupabase as any);
    await paiementExp.syncSavePaiementDayOverrideToSupabase(
      adminUser,
      companyId,
      testDate,
      'hours',
      'rk_101',
      { heureDeb: '07:30', heureFin: '16:30', dureeRep: 1 },
      mockSupabase as any
    );

    const beforeOnlineCounts = syncOutbox.getAllPendingOutboxCounts();
    assert.ok(beforeOnlineCounts.referentiels > 0, 'REFERENTIELS outbox doit être non vide');
    assert.ok(beforeOnlineCounts.pointage > 0, 'POINTAGE outbox doit être non vide');
    assert.ok(beforeOnlineCounts.gazoil > 0, 'GAZOIL outbox doit être non vide');
    assert.ok(beforeOnlineCounts.paiement >= 3, 'PAIEMENT outbox doit contenir tarifs, snapshot et override');

    // =========================================================================
    // TEST 2 : Saisies hors ligne API Express (Récolte, Heures/Tâches Supp, Contractuels, Stock Pro avec idempotence)
    // =========================================================================
    storage.addRecolteEntries(
      companyId,
      [
        {
          date: testDate,
          serre_id: 'serre_test_1',
          serre_nom: 'Serre Test 99',
          ouvrier_id: 'ouv_sync_101',
          numero_ouvrier: 101,
          nom_ouvrier: 'ALAMI RACHID',
          caisses: 25,
        },
      ],
      { id: adminUser.id, nom: adminUser.nom }
    );

    syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.SUPPLEMENTAIRES, {
      table: 'heures_supplementaires',
      entityId: 'hsup_off_1',
      action: 'upsert',
      companyId,
      data: {
        ouvrier_id: 'ouv_sync_101',
        numero_ouvrier: 101,
        nom_ouvrier: 'ALAMI RACHID',
        date: testDate,
        mode_calcul: 'heure',
        duree_heures: 2,
        nb_unites: 2,
        tarif_unitaire: 15,
        observation: 'HS hors ligne',
      },
    });

    syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.SUPPLEMENTAIRES, {
      table: 'taches_supplementaires',
      entityId: 'tsup_off_1',
      action: 'upsert',
      companyId,
      data: {
        ouvrier_id: 'ouv_sync_101',
        numero_ouvrier: 101,
        nom_ouvrier: 'ALAMI RACHID',
        date: testDate,
        nom_tache: 'Désherbage Allée',
        quantite: 4,
        unite: 'Lignes',
      },
    });

    syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.CONTRACTUELS, {
      table: 'contractuels_ouvriers',
      entityId: 'ouv_ctr_off_test_1',
      action: 'upsert',
      companyId,
      data: {
        company_id: companyId,
        nom: 'BENSAID',
        prenom: 'Karim',
        nom_complet: 'BENSAID Karim',
        matricule: 'CTR-901',
        domaine_id: 'dom_d2',
        mode_remuneration: 'JOUR',
        prix_convenu: 110,
        unite: 'JOUR',
      },
    });

    // Créer le produit stock au préalable pour disposer d'un produit_id valide
    const createProdRes = await fetch(`${baseUrl}/api/stock/produit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token',
        'x-company-id': companyId,
      },
      body: JSON.stringify({
        nom: 'Engrais NPK Sync',
        unite: 'SAC',
        seuil_minimum: 5,
        stock_initial: 0,
      }),
    });
    const createProdJson = await createProdRes.json();
    assert.equal(createProdJson.success, true, `Création produit stock préalable réussie: ${JSON.stringify(createProdJson)}`);
    const stockProduitId = createProdJson.produit.id;

    syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.STOCK, {
      table: 'stock_mouvements',
      entityId: 'stk_off_entree_1',
      action: 'upsert',
      companyId,
      data: {
        endpoint: '/api/stock/entree',
        payload: {
          produit_id: stockProduitId,
          produit_nom: 'Engrais NPK Sync',
          unite: 'SAC',
          quantite: 20,
          date: testDate,
          tiers: 'Fournisseur Test',
          idempotencyKey: 'idem_stock_test_unique_1',
        },
      },
    });

    // Reconnexion réseau -> synchronisation bidirectionnelle complète
    setOnlineState(true);
    const syncReport1 = await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });

    assert.equal(syncReport1.errors.length, 0, `Aucune erreur attendue au sync complet: ${JSON.stringify(syncReport1.errors)}`);
    const totalPendingAfterSync = Object.values(syncReport1.pendingCounts).reduce((sum, n) => sum + (n || 0), 0);
    assert.equal(totalPendingAfterSync, 0, 'Toutes les outboxes doivent être vidées après confirmation serveur');

    // Vérifier la persistance réelle dans MockSupabase
    assert.ok(mockSupabase.tables.domaines.some((d) => d.id === 'dom_test_1'), 'Domaine synchronisé vers Supabase');
    assert.ok(mockSupabase.tables.ouvriers.some((o) => o.id === 'ouv_sync_101'), 'Ouvrier synchronisé vers Supabase');
    assert.ok(mockSupabase.tables.pointages.some((p) => p.ouvrier_id === 'ouv_sync_101'), 'Pointage synchronisé vers Supabase');
    assert.ok(mockSupabase.tables.gazoil_mouvements.length >= 1, 'Mouvement gazoil synchronisé vers Supabase');
    assert.equal(mockSupabase.tables.paiement_tariffs[0]?.travail_normal_jour, 125, 'Tarifs Admin synchronisés');
    assert.equal(mockSupabase.tables.paiement_export_snapshots[0]?.id, 'snap_test_immutable_1', 'Snapshot figé synchronisé');
    assert.equal(mockSupabase.tables.paiement_day_overrides.length, 1, 'Override horaire synchronisé');

    // Vérifier idempotence Stock Pro : renvoyer exactement la même clé idempotence ne doit PAS doubler la quantité (20 reste 20)
    syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.STOCK, {
      table: 'stock_mouvements',
      entityId: 'stk_off_entree_dup',
      action: 'upsert',
      companyId,
      data: {
        endpoint: '/api/stock/entree',
        payload: {
          produit_id: stockProduitId,
          produit_nom: 'Engrais NPK Sync',
          unite: 'SAC',
          quantite: 20,
          date: testDate,
          tiers: 'Fournisseur Test',
          idempotencyKey: 'idem_stock_test_unique_1',
        },
      },
    });
    const syncIdemReport = await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.equal(syncIdemReport.pendingCounts.stock, 0);
    const stockCheckRes = await fetch(`${baseUrl}/api/stock`, {
      headers: { Authorization: 'Bearer dev_admin_token', 'x-company-id': companyId },
    });
    const stockJson = await stockCheckRes.json();
    const npkProd = (stockJson.produits || []).find(
      (p: any) => (p.produit?.nom || p.nom) === 'ENGRAIS NPK SYNC'
    );
    assert.ok(npkProd, 'Produit stock présent sur serveur');
    assert.equal(npkProd.stock_actuel, 20, 'IdempotencyKey doit empêcher la double incrémentation du stock');

    // =========================================================================
    // TEST 3 : Résistance du défilement atomique aux écritures concurrentes en cours de vol
    // =========================================================================
    const opA = syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.RECOLTE, {
      table: 'recolte_entries',
      entityId: 'rec_conc_a',
      action: 'upsert',
      companyId,
      data: { id: 'rec_conc_a' },
    });
    const batchSnapshot = syncOutbox.getOutboxOps(syncOutbox.OUTBOX_KEYS.RECOLTE);
    // Écriture concurrente pendant que batchSnapshot est traité
    const opB = syncOutbox.enqueueOutboxOp(syncOutbox.OUTBOX_KEYS.RECOLTE, {
      table: 'recolte_entries',
      entityId: 'rec_conc_b',
      action: 'upsert',
      companyId,
      data: { id: 'rec_conc_b' },
    });
    syncOutbox.dequeueOutboxOpsById(syncOutbox.OUTBOX_KEYS.RECOLTE, batchSnapshot.map((o) => o.opId));
    const remainingConcurrent = syncOutbox.getOutboxOps(syncOutbox.OUTBOX_KEYS.RECOLTE);
    assert.equal(remainingConcurrent.length, 1, 'L écriture concurrente ne doit pas être effacée par le défilement du lot');
    assert.equal(remainingConcurrent[0].opId, opB.opId);
    assert.notEqual(opA.opId, opB.opId);
    syncOutbox.dequeueOutboxOpsById(syncOutbox.OUTBOX_KEYS.RECOLTE, [opB.opId]);

    // =========================================================================
    // TEST 4 : Hydratation complète sur un NOUVEL APPAREIL (Device B avec localStorage vierge)
    //          + Purge automatique des ouvriers démo provisoires dès présence de vrais ouvriers
    // =========================================================================
    const deviceBStore: Record<string, string> = {};
    switchDeviceStorage(deviceBStore);
    // Simuler un appareil neuf contenant uniquement les ouvriers démo provisoires via initStorage() avant hydratation
    storage.initStorage();
    storage.setActiveCompanyId(companyId);
    storage.setCurrentUser(adminUser);

    const hydrateReport = await globalSync.hydrateFreshDeviceFromRemote({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.equal(hydrateReport.errors.length, 0, `Hydratation Device B sans erreur: ${JSON.stringify(hydrateReport.errors)}`);

    const bOuvriers = storage.getOuvriers(companyId);
    assert.ok(bOuvriers.some((o) => o.id === 'ouv_sync_101' && o.nom === 'ALAMI RACHID'), 'Ouvrier réel restauré sur Appareil B');
    assert.ok(!bOuvriers.some((o) => o.id === 'ouv_1' && o.nom === 'Mohammed Amine'), 'Ouvrier démo provisoire écarté');
    assert.ok(storage.getPointages(companyId, testDate).some((p) => p.ouvrier_id === 'ouv_sync_101'), 'Pointage matin restauré');
    assert.ok(storage.getHeuresSupplementaires(companyId, testDate).some((h) => h.numero_ouvrier === 101), 'Heures supp restaurées');
    assert.ok(
      storage.getTachesSupplementaires(companyId, testDate).some((t) => (t.nom_tache || '').toUpperCase() === 'DÉSHERBAGE ALLÉE'),
      'Tâches supp restaurées'
    );
    assert.equal(storage.calculerStockGazoil(companyId).stockActuel, 455, 'Calcul Gazoil 500 - 45 = 455L restauré sur Appareil B');
    assert.equal(paiementExp.loadPaiementTariffs(companyId).travailNormalJour, 125, 'Tarifs Paiement restaurés sur Appareil B');
    assert.equal(paiementExp.loadPaiementExportHistory(companyId).length, 1, 'Historique snapshot figé restauré sur Appareil B');
    assert.equal(paiementExp.loadHoursOverridesForDate(companyId, testDate).rk_101?.heureDeb, '07:30', 'Overrides horaires restaurés sur Appareil B');

    // =========================================================================
    // TEST 5 : Survie à déconnexion/reconnexion, redémarrage serveur & changement d'URL Cloud Run
    // =========================================================================
    setOnlineState(false);
    const offlineOuvRes = storage.saveOuvrier(companyId, {
      id: 'ouv_before_logout',
      numero: 102,
      nom: 'IDRISSI SALMA',
      actif: true,
    });
    assert.equal(offlineOuvRes.success, true);
    storage.logoutUser(); // Déconnexion locale

    // Vérifier que la file hors ligne n'est PAS supprimée au logout
    assert.ok(syncOutbox.getAllPendingOutboxCounts().referentiels > 0, 'La file outbox survit au logout');

    // Fermer server1 et redémarrer server2 sur un nouveau port (simule redéploiement / nouvelle URL Cloud Run)
    await new Promise<void>((resolve) => server1.close(() => resolve()));
    server1 = null;
    server2 = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const baseUrl2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}`;
    assert.notEqual(baseUrl, baseUrl2);

    // Reconnexion avec session & nouvelle URL
    storage.setCurrentUser(adminUser);
    setOnlineState(true);
    const syncAfterRestart = await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl: baseUrl2,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.equal(syncAfterRestart.errors.length, 0);
    assert.ok(mockSupabase.tables.ouvriers.some((o) => o.id === 'ouv_before_logout'), 'Donnée saisie avant logout poussée après reconnexion & changement URL');

    // =========================================================================
    // TEST 6 : Résilience aux pannes temporaires (retryCount++ sans perte ni écrasement)
    // =========================================================================
    mockSupabase.failWrites.add('pointages');
    storage.addPointage(companyId, 'ouv_before_logout', testDate, 'tch_sync_cerise', 'dom_test_1');

    const failedRun = await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl: baseUrl2,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.ok(failedRun.errors.length >= 1, 'L erreur Supabase doit remonter explicitement');
    const queuedAfterFail = syncOutbox.getOutboxOps(syncOutbox.OUTBOX_KEYS.POINTAGE);
    assert.equal(queuedAfterFail.length, 1, 'Opération en échec reste en file d attente');
    assert.ok((queuedAfterFail[0].retryCount || 0) >= 1, 'retryCount incrémenté');

    mockSupabase.failWrites.delete('pointages');
    const recoveredRun = await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl: baseUrl2,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.equal(recoveredRun.errors.length, 0);
    assert.equal(syncOutbox.getOutboxOps(syncOutbox.OUTBOX_KEYS.POINTAGE).length, 0, 'Opération dépilée uniquement après confirmation');

    // =========================================================================
    // TEST 7 : Jamais de remise à zéro [] en cas d'erreur de lecture ou réponse distante vide
    // =========================================================================
    const countBeforeError = storage.getOuvriers(companyId).length;
    assert.ok(countBeforeError >= 2);
    mockSupabase.failReads.add('ouvriers');
    await globalSync.syncBidirectionalAll({
      companyId,
      user: adminUser,
      supabaseClient: mockSupabase as any,
      baseUrl: baseUrl2,
      accessToken: 'dev_admin_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    mockSupabase.failReads.delete('ouvriers');
    assert.equal(storage.getOuvriers(companyId).length, countBeforeError, 'Erreur de lecture ne doit jamais vider les données locales');

    storage.reconcileOuvriersFromRemote(companyId, []);
    assert.equal(storage.getOuvriers(companyId).length, countBeforeError, 'Réponse vide [] ne doit jamais effacer des ouvriers non vides');

    // =========================================================================
    // TEST 8 : Conflit LWW déterministe + Journalisation des versions dans CONFLICTS
    // =========================================================================
    storage.saveOuvrier(companyId, {
      id: 'ouv_conflict_1',
      numero: 109,
      nom: 'LOCAL PLUS ANCIEN',
      actif: true,
      updated_at: '2026-11-18T11:00:00Z',
    });
    storage.reconcileOuvriersFromRemote(companyId, [
      {
        id: 'ouv_conflict_1',
        company_id: companyId,
        numero: 109,
        nom: 'DISTANT PLUS RECENT',
        actif: true,
        createdAt: '2026-11-18T11:05:00Z',
        updated_at: '2026-11-18T11:05:00Z',
      },
    ]);
    const winner = storage.getOuvriers(companyId).find((o) => o.id === 'ouv_conflict_1');
    assert.equal(winner?.nom, 'DISTANT PLUS RECENT', 'La version horodatée la plus récente doit gagner');
    const conflicts = syncOutbox.getSyncConflicts(companyId);
    assert.ok(
      conflicts.some((c) => c.table === 'ouvriers' && c.entityId === 'ouv_conflict_1' && c.resolvedWinner === 'remote'),
      'La version locale évincée doit être tracée dans le journal des conflits'
    );

    // =========================================================================
    // TEST 9 : Isolation stricte company_id & RBAC (Admin / Caporal Récolte / Tariq Contractuelles)
    // =========================================================================
    const scopeTariq = globalSync.getPermittedSyncScope(tariqUser);
    assert.equal(scopeTariq.isTariqOrContractuel, true);
    assert.equal(scopeTariq.canSyncPointage, false);
    assert.equal(scopeTariq.canSyncRecolte, false);
    assert.equal(scopeTariq.canSyncStock, false);
    assert.equal(scopeTariq.canSyncPaiement, false);
    assert.equal(scopeTariq.canSyncContractuels, true);
    assert.ok(scopeTariq.allowedCoreTables.has('serres'));
    assert.ok(!scopeTariq.allowedCoreTables.has('pointages'));

    const scopeCaporal = globalSync.getPermittedSyncScope(caporalRecolteUser);
    assert.equal(scopeCaporal.canSyncRecolte, true);
    assert.equal(scopeCaporal.canSyncSupplementaires, true);
    assert.equal(scopeCaporal.canSyncContractuels, false);
    assert.equal(scopeCaporal.canSyncPaiement, false);
    assert.equal(scopeCaporal.canSyncStock, false);

    // Vérifier que Tariq ne reçoit JAMAIS pointages/ouvriers/recoltes sur un appareil neuf
    const deviceTariqStore: Record<string, string> = {};
    switchDeviceStorage(deviceTariqStore);
    storage.setCurrentUser(tariqUser);
    storage.setActiveCompanyId(companyId);
    const tariqReport = await globalSync.syncBidirectionalAll({
      companyId,
      user: tariqUser,
      supabaseClient: mockSupabase as any,
      baseUrl: baseUrl2,
      accessToken: 'dev_contractuel_token',
      ignoreNavigatorOnline: true,
      skipSessionCheck: true,
      dateIso: testDate,
    });
    assert.equal(tariqReport.pulled.core.pointages, undefined, 'Tariq ne doit jamais tirer pointages');
    assert.equal(tariqReport.pulled.paiementSnapshots, 0, 'Tariq ne doit jamais tirer snapshots paiement');

    // Rejet cross-tenant sur API Express
    const crossTenantRes = await fetch(`${baseUrl2}/api/stock`, {
      headers: { Authorization: 'Bearer dev_admin_token', 'x-company-id': 'cie_autre_entreprise' },
    });
    assert.equal(crossTenantRes.status, 400, 'Violation de cloisonnement x-company-id rejetée');

    // Caporal Récolte bloqué sur Contractuelles (HTTP 403)
    const caporalCtrRes = await fetch(`${baseUrl2}/api/contractuels/pointages`, {
      headers: { Authorization: 'Bearer dev_caporal_token', 'x-company-id': companyId },
    });
    assert.equal(caporalCtrRes.status, 403, 'Caporal Récolte bloqué sur Contractuelles');

    console.log('✅ TOUS LES TESTS DE SYNCHRONISATION GLOBALE ONT RÉUSSI (9/9 scénarios vérifiés)');
  } finally {
    if (server1) await new Promise<void>((r) => server1.close(() => r()));
    if (server2) await new Promise<void>((r) => server2.close(() => r()));
    if (dbBackupRaw !== null) {
      fs.writeFileSync(dbFilePath, dbBackupRaw, 'utf-8');
    } else if (fs.existsSync(dbFilePath)) {
      fs.unlinkSync(dbFilePath);
    }
  }
}

runTests().catch((err) => {
  console.error('❌ ÉCHEC DES TESTS DE SYNCHRONISATION GLOBALE:', err);
  process.exit(1);
});
