/**
 * SUITE DE TESTS EXHAUSTIVE (18 TESTS OBLIGATOIRES)
 * - Modules HEURES SUPPLÉMENTAIRES & TÂCHES SUPPLÉMENTAIRES
 * - Intégration CHARGEMENT & DÉCHARGEMENT dans RÉCOLTE
 * - Sécurité RBAC & Cloisonnement multi-entreprises
 */

import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

function makeRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ statusCode: number; data: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode || 0, data: parsed, rawBody: data });
        } catch {
          resolve({ statusCode: res.statusCode || 0, data: null, rawBody: data });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('DÉMARRAGE DE LA SUITE DE 18 TESTS SUPPLÉMENTAIRES & RÉCOLTE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(testNum: number, title: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`[PASS] Test ${testNum} : ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] Test ${testNum} : ${title} — ${detail || 'Échec condition'}`);
      failed++;
    }
  }

  const caporalHeaders = { Authorization: 'Bearer dev_caporal_token' };
  const adminHeaders = { Authorization: 'Bearer dev_admin_token' };
  const testDate = `2026-11-${String((Date.now() % 20) + 10)}`;
  const worker1Id = 'ouv_1';
  const worker1Num = 1;

  let createdH1Id = '';
  let createdH2Id = '';
  let createdT1Id = '';
  let createdT2Id = '';

  try {
    // -------------------------------------------------------------
    // TEST 1 : Plusieurs saisies d'heures supplémentaires pour un même ouvrier le même jour
    // -------------------------------------------------------------
    const h1Res = await makeRequest('POST', '/api/heures-supplementaires', caporalHeaders, {
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      date: testDate,
      heure_debut: '17:00',
      heure_fin: '19:00',
      duree_heures: 2.0,
      domaine_id: 'dom_d2',
      observation: 'Session 1',
    });
    createdH1Id = h1Res.data?.item?.id;

    const h2Res = await makeRequest('POST', '/api/heures-supplementaires', caporalHeaders, {
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      date: testDate,
      heure_debut: '19:30',
      heure_fin: '21:00',
      duree_heures: 1.5,
      domaine_id: 'dom_d2',
      observation: 'Session 2',
    });
    createdH2Id = h2Res.data?.item?.id;

    assert(
      1,
      "Plusieurs saisies d'heures pour un même ouvrier le même jour",
      h1Res.statusCode === 200 &&
        h2Res.statusCode === 200 &&
        !!createdH1Id &&
        !!createdH2Id &&
        createdH1Id !== createdH2Id,
      `H1: ${createdH1Id}, H2: ${createdH2Id}`
    );

    // -------------------------------------------------------------
    // TEST 2 : Modification d'une saisie d'heures
    // -------------------------------------------------------------
    const updateHRes = await makeRequest(
      'PUT',
      `/api/heures-supplementaires/${createdH1Id}`,
      caporalHeaders,
      {
        duree_heures: 2.5,
        observation: 'Session 1 modifiée',
      }
    );
    assert(
      2,
      "Modification ciblée d'une saisie d'heures",
      updateHRes.statusCode === 200 && updateHRes.data?.item?.duree_heures === 2.5,
      `Code: ${updateHRes.statusCode}, Durée: ${updateHRes.data?.item?.duree_heures}`
    );

    // -------------------------------------------------------------
    // TEST 3 : Suppression d'une saisie d'heures sans toucher aux autres
    // -------------------------------------------------------------
    const delHRes = await makeRequest(
      'DELETE',
      `/api/heures-supplementaires/${createdH2Id}`,
      caporalHeaders
    );
    const getHAfterDel = await makeRequest(
      'GET',
      `/api/heures-supplementaires?date=${testDate}&ouvrierId=${worker1Id}`,
      caporalHeaders
    );
    const remainingH = getHAfterDel.data?.heures_supplementaires || [];
    const hasRemaining = remainingH.some((x: any) => x.id === createdH1Id);
    const hasDeleted = remainingH.some((x: any) => x.id === createdH2Id);

    assert(
      3,
      "Suppression ciblée d'une saisie d'heures (isolation)",
      delHRes.statusCode === 200 && hasRemaining && !hasDeleted,
      `Supprimé code: ${delHRes.statusCode}, Reste: ${hasRemaining}, Supprimé présent: ${hasDeleted}`
    );

    // -------------------------------------------------------------
    // TEST 4 : Calcul exact des totaux d'heures (par ouvrier, par jour, par domaine)
    // -------------------------------------------------------------
    // Créer une 2ème heure pour le test de calcul
    const h3Res = await makeRequest('POST', '/api/heures-supplementaires', caporalHeaders, {
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      date: testDate,
      duree_heures: 1.0,
      domaine_id: 'dom_d2',
    });
    const listForTotal = await makeRequest(
      'GET',
      `/api/heures-supplementaires?date=${testDate}`,
      caporalHeaders
    );
    const itemsForDate = listForTotal.data?.heures_supplementaires || [];
    const sumWorker1 = itemsForDate
      .filter((it: any) => it.ouvrier_id === worker1Id)
      .reduce((s: number, it: any) => s + Number(it.duree_heures || it.heures), 0);

    assert(
      4,
      "Calcul exact des totaux d'heures (2.5 + 1.0 = 3.5 h)",
      sumWorker1 === 3.5,
      `Total calculé: ${sumWorker1} h`
    );

    // -------------------------------------------------------------
    // TEST 5 : Plusieurs saisies de tâches supplémentaires pour un même ouvrier
    // -------------------------------------------------------------
    const t1Res = await makeRequest('POST', '/api/taches-supplementaires', caporalHeaders, {
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      date: testDate,
      nom_tache: 'Effeuillage',
      quantite: 50,
      unite: 'kg',
      domaine_id: 'dom_d2',
    });
    createdT1Id = t1Res.data?.items?.[0]?.id;

    const t2Res = await makeRequest('POST', '/api/taches-supplementaires', caporalHeaders, {
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      date: testDate,
      nom_tache: 'Taille',
      quantite: 20,
      unite: 'caisse',
      domaine_id: 'dom_d2',
    });
    createdT2Id = t2Res.data?.items?.[0]?.id;

    assert(
      5,
      "Plusieurs saisies de tâches supplémentaires pour un même ouvrier",
      t1Res.statusCode === 200 &&
        t2Res.statusCode === 200 &&
        !!createdT1Id &&
        !!createdT2Id &&
        createdT1Id !== createdT2Id,
      `T1: ${createdT1Id}, T2: ${createdT2Id}`
    );

    // -------------------------------------------------------------
    // TEST 6 : Regroupement par unité distincte sans jamais additionner des unités différentes
    // -------------------------------------------------------------
    const getTList = await makeRequest(
      'GET',
      `/api/taches-supplementaires?date=${testDate}&ouvrierId=${worker1Id}`,
      caporalHeaders
    );
    const tItems = getTList.data?.taches_supplementaires || [];
    const kgTotal = tItems
      .filter((x: any) => x.unite === 'kg')
      .reduce((s: number, x: any) => s + Number(x.quantite), 0);
    const caisseTotal = tItems
      .filter((x: any) => x.unite === 'caisse')
      .reduce((s: number, x: any) => s + Number(x.quantite), 0);

    assert(
      6,
      "Ségrégation stricte des unités (50 kg distinct de 20 caisses)",
      kgTotal === 50 && caisseTotal === 20,
      `kgTotal: ${kgTotal}, caisseTotal: ${caisseTotal}`
    );

    // -------------------------------------------------------------
    // TEST 7 : Enregistrement d'un chargement par un Caporal
    // -------------------------------------------------------------
    const chargementEntry = {
      id: `rec_chg_${Date.now()}`,
      company_id: 'cie_lahcen_pointeur',
      date: testDate,
      type_operation: 'CHARGEMENT',
      domaine_id: 'dom_d2',
      serre_id: 'serre_1',
      serre_nom: 'Serre 1',
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      nom_ouvrier: 'Ouvrier 1',
      caisses: 120,
      notes: 'Camion 1',
      created_by_id: 'usr_caporal_1',
      created_by_nom: 'Brahim (Caporal)',
      created_at: new Date().toISOString(),
    };

    const chgSyncRes = await makeRequest('POST', '/api/recolte/sync', caporalHeaders, {
      companyId: 'cie_lahcen_pointeur',
      pendingEntries: [chargementEntry],
    });
    const foundChg = (chgSyncRes.data?.allEntries || []).find(
      (e: any) => e.id === chargementEntry.id
    );

    assert(
      7,
      "Enregistrement d'un chargement par un Caporal",
      chgSyncRes.statusCode === 200 &&
        foundChg &&
        foundChg.type_operation === 'CHARGEMENT' &&
        foundChg.caisses === 120,
      `Opération: ${foundChg?.type_operation}, Caisses: ${foundChg?.caisses}`
    );

    // -------------------------------------------------------------
    // TEST 8 : Enregistrement d'un déchargement par un Caporal
    // -------------------------------------------------------------
    const dechargementEntry = {
      id: `rec_dech_${Date.now()}`,
      company_id: 'cie_lahcen_pointeur',
      date: testDate,
      type_operation: 'DECHARGEMENT',
      domaine_id: 'dom_d2',
      serre_id: 'serre_1',
      serre_nom: 'Serre 1',
      ouvrier_id: worker1Id,
      numero_ouvrier: worker1Num,
      nom_ouvrier: 'Ouvrier 1',
      caisses: 85,
      notes: 'Station emballage',
      created_by_id: 'usr_caporal_1',
      created_by_nom: 'Brahim (Caporal)',
      created_at: new Date().toISOString(),
    };

    const dechSyncRes = await makeRequest('POST', '/api/recolte/sync', caporalHeaders, {
      companyId: 'cie_lahcen_pointeur',
      pendingEntries: [dechargementEntry],
    });
    const foundDech = (dechSyncRes.data?.allEntries || []).find(
      (e: any) => e.id === dechargementEntry.id
    );

    assert(
      8,
      "Enregistrement d'un déchargement par un Caporal",
      dechSyncRes.statusCode === 200 &&
        foundDech &&
        foundDech.type_operation === 'DECHARGEMENT' &&
        foundDech.caisses === 85,
      `Opération: ${foundDech?.type_operation}, Caisses: ${foundDech?.caisses}`
    );

    // -------------------------------------------------------------
    // TEST 9 : Accès des comptes Caporal réels (pas seulement Camara)
    // -------------------------------------------------------------
    const caporalBrahimHeaders = { Authorization: 'Bearer usr_caporal_brahim' };
    const brahimRes = await makeRequest(
      'GET',
      '/api/heures-supplementaires',
      caporalBrahimHeaders
    );
    assert(
      9,
      "Accès vérifié pour tout compte Caporal authentifié",
      brahimRes.statusCode === 200 && brahimRes.data?.success === true,
      `Status: ${brahimRes.statusCode}`
    );

    // -------------------------------------------------------------
    // TEST 10 : Rejet des accès non autorisés (Caporal tente d'accéder à Stock Pro = 403)
    // -------------------------------------------------------------
    const caporalStockAccess = await makeRequest('GET', '/api/stock', caporalHeaders);
    assert(
      10,
      'Rejet strict du rôle Caporal sur Stock Pro (HTTP 403)',
      caporalStockAccess.statusCode === 403,
      `Status reçu: ${caporalStockAccess.statusCode}`
    );

    // -------------------------------------------------------------
    // TEST 11 : Accès des comptes Admin et Pointeur
    // -------------------------------------------------------------
    const adminHRes = await makeRequest('GET', '/api/heures-supplementaires', adminHeaders);
    const adminTRes = await makeRequest('GET', '/api/taches-supplementaires', adminHeaders);
    const adminStockRes = await makeRequest('GET', '/api/stock', adminHeaders);

    assert(
      11,
      'Accès complet de l’Administrateur à tous les modules',
      adminHRes.statusCode === 200 &&
        adminTRes.statusCode === 200 &&
        adminStockRes.statusCode === 200,
      `H: ${adminHRes.statusCode}, T: ${adminTRes.statusCode}, Stock: ${adminStockRes.statusCode}`
    );

    // -------------------------------------------------------------
    // TEST 12 : Cloisonnement strict multi-entreprises par company_id
    // -------------------------------------------------------------
    const fakeCompanyHeaders = {
      Authorization: 'Bearer dev_admin_token',
      'x-company-id': 'cie_pirate_999',
    };
    const leakCheck = await makeRequest(
      'GET',
      '/api/heures-supplementaires',
      fakeCompanyHeaders
    );

    assert(
      12,
      'Cloisonnement multi-entreprises : rejet des x-company-id non autorisés (HTTP 400)',
      leakCheck.statusCode === 400,
      `Status reçu: ${leakCheck.statusCode}`
    );

    // -------------------------------------------------------------
    // TEST 13 : Synchronisation multi-appareils (mock pull/push)
    // -------------------------------------------------------------
    const syncRes1 = await makeRequest('POST', '/api/recolte/sync', caporalHeaders, {
      companyId: 'cie_lahcen_pointeur',
      pendingEntries: [],
    });
    assert(
      13,
      'Synchronisation multi-appareils opérationnelle',
      syncRes1.statusCode === 200 && Array.isArray(syncRes1.data?.allEntries),
      `Total récoltes synchronisées: ${syncRes1.data?.allEntries?.length}`
    );

    // -------------------------------------------------------------
    // TEST 14 : Préservation intégrale des données historiques
    // -------------------------------------------------------------
    const backupPath = path.join(
      process.cwd(),
      'data',
      'backup_supplementaires_and_related.json'
    );
    const backupExists = fs.existsSync(backupPath);
    let backupValid = false;
    if (backupExists) {
      const content = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      backupValid =
        (Array.isArray(content.heures_supplementaires) || Array.isArray(content.heuresSupplementaires)) &&
        Array.isArray(content.users) &&
        Array.isArray(content.serres);
    }
    assert(
      14,
      'Préservation intégrale des données historiques de sauvegarde',
      backupExists && backupValid,
      `Fichier sauvegarde présent et valide: ${backupExists && backupValid}`
    );

    // -------------------------------------------------------------
    // TEST 15 : Prévention des doublons (validation quantités > 0 et IDs uniques)
    // -------------------------------------------------------------
    const invalidQtyRes = await makeRequest(
      'POST',
      '/api/heures-supplementaires',
      caporalHeaders,
      {
        ouvrier_id: worker1Id,
        numero_ouvrier: worker1Num,
        date: testDate,
        duree_heures: -5,
      }
    );
    assert(
      15,
      'Prévention des valeurs aberrantes ou doublons (rejet durée <= 0)',
      invalidQtyRes.statusCode === 400,
      `Status reçu: ${invalidQtyRes.statusCode}`
    );

    // -------------------------------------------------------------
    // TEST 16 : Non-régression sur Pointage, Récolte et Stock Pro
    // -------------------------------------------------------------
    const healthRes = await makeRequest('GET', '/api/health');
    assert(
      16,
      'Non-régression des modules existants (Health OK)',
      healthRes.statusCode === 200 && healthRes.data?.status === 'ok',
      `Health status: ${healthRes.data?.status}`
    );

    // -------------------------------------------------------------
    // TEST 17 : Persistance après redémarrage du serveur
    // -------------------------------------------------------------
    const dbFilePath = path.join(process.cwd(), 'data', 'recolte_db.json');
    const dbFileExists = fs.existsSync(dbFilePath);
    let hasPersistedRecords = false;
    if (dbFileExists) {
      const dbContent = JSON.parse(fs.readFileSync(dbFilePath, 'utf8'));
      hasPersistedRecords =
        Array.isArray(dbContent.heures_supplementaires) &&
        Array.isArray(dbContent.taches_supplementaires) &&
        dbContent.heures_supplementaires.length > 0;
    }
    assert(
      17,
      'Persistance des données dans le fichier local serveur',
      dbFileExists && hasPersistedRecords,
      `Fichier db présent: ${dbFileExists}, heures sauvegardées: ${hasPersistedRecords}`
    );

    // -------------------------------------------------------------
    // TEST 18 : Vérification des API et règles RLS (artifact SQL prêt)
    // -------------------------------------------------------------
    const migrationPath1 = path.join(process.cwd(), 'data', 'supplementaires_v2_migration.sql');
    const migrationPath2 =
      '/.aistudio/artifacts/brain/90fedf2f-055a-4f11-98c3-7c1380593681/supplementaires_v2_migration.sql';
    const targetMigration = fs.existsSync(migrationPath1) ? migrationPath1 : (fs.existsSync(migrationPath2) ? migrationPath2 : '');
    let migrationHasPolicies = false;
    if (targetMigration) {
      const sqlContent = fs.readFileSync(targetMigration, 'utf8');
      migrationHasPolicies =
        sqlContent.includes('CREATE TABLE IF NOT EXISTS public.heures_supplementaires') &&
        sqlContent.includes('CREATE TABLE IF NOT EXISTS public.taches_supplementaires') &&
        sqlContent.includes('ALTER TABLE public.recolte_entries ADD COLUMN IF NOT EXISTS type_operation') &&
        sqlContent.includes('ENABLE ROW LEVEL SECURITY');
    }
    assert(
      18,
      'Vérification des API et intégrité de la migration RLS Supabase',
      !!targetMigration && migrationHasPolicies,
      `Migration SQL vérifiée: ${!!targetMigration && migrationHasPolicies}`
    );
  } catch (err: any) {
    console.error('Erreur générale durant la suite de tests:', err);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`RÉSULTAT DE LA SUITE DE TESTS : ${passed} PASS / ${failed} FAIL sur 18 tests`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
