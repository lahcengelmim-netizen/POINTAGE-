import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = 'http://localhost:3000';

async function runComprehensiveImportTest() {
  console.log('======================================================================');
  console.log('TEST COMPREHENSIF ET ISOLE — IMPORT INITIAL STOCK (EXCEL & API)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`✅ [SUCCESS] ${testName}`);
      console.log(`   Détails : ${detail}\n`);
      passed++;
    } else {
      console.error(`❌ [FAILURE] ${testName}`);
      console.error(`   Détails : ${detail}\n`);
      failed++;
    }
  }

  // 1. Test des permissions Admin et Caporal sur le module Stock
  try {
    const adminRes = await fetch(`${BASE_URL}/api/stock`, {
      headers: { Authorization: 'Bearer dev_admin_token' }
    });
    const caporalRes = await fetch(`${BASE_URL}/api/stock`, {
      headers: { Authorization: 'Bearer usr_caporal_brahim' }
    });

    const adminOk = adminRes.status === 200;
    const caporalBlocked = caporalRes.status === 403;

    assert(
      adminOk && caporalBlocked,
      '1. Permissions RBAC Module Stock (Admin vs Caporal)',
      `Admin status: ${adminRes.status} (Attendu: 200) | Caporal status: ${caporalRes.status} (Attendu: 403)`
    );
  } catch (err: any) {
    assert(false, '1. Permissions RBAC Module Stock', err.message);
  }

  // 2. Test de l'API POST /api/stock/import-initial avec des données de test isolées (accents et décimales)
  const testIdempotencyKey = `idem_test_${Date.now()}`;
  const testItems = [
    { nom: 'ENGRAIS TEST NPK', unite: 'KG', qte: 150.5 },
    { nom: 'SEMENCE TOMATE TEST', unite: 'UNITÉ', qte: 25.25 },
    { nom: 'FONGICIDE TEST', unite: 'L', qte: 10 }
  ];

  try {
    const importRes = await fetch(`${BASE_URL}/api/stock/import-initial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token'
      },
      body: JSON.stringify({
        idempotencyKey: testIdempotencyKey,
        items: testItems
      })
    });
    const importBody = await importRes.json();

    assert(
      importRes.status === 200 && importBody.success && importBody.importedCount === 3,
      '2. Enregistrement réel des produits de test (entiers et décimaux)',
      `Statut HTTP: ${importRes.status} | Succès: ${importBody.success} | Produits importés: ${importBody.importedCount} | Message: "${importBody.message}"`
    );

    // 3. Test de l'idempotence (rejeu de la même clé d'idempotence)
    const replayRes = await fetch(`${BASE_URL}/api/stock/import-initial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token'
      },
      body: JSON.stringify({
        idempotencyKey: testIdempotencyKey,
        items: testItems
      })
    });
    const replayBody = await replayRes.json();

    assert(
      replayRes.status === 200 && replayBody.success && replayBody.is_duplicate_replay === true,
      '3. Vérification de l\'idempotence et gestion des doublons',
      `Rejeu détecté (is_duplicate_replay): ${replayBody.is_duplicate_replay} | Message: "${replayBody.message || replayBody.motif || 'Rejeu validé'}"`
    );

    // 4. Vérification de la présence des produits dans le stock consolidé (GET /api/stock)
    const getRes = await fetch(`${BASE_URL}/api/stock`, {
      headers: { Authorization: 'Bearer dev_admin_token' }
    });
    const getBody = await getRes.json();
    
    const foundEngrais = getBody.produits?.find((p: any) => p.produit.nom === 'ENGRAIS TEST NPK');
    const foundSemence = getBody.produits?.find((p: any) => p.produit.nom === 'SEMENCE TOMATE TEST');

    assert(
      getRes.status === 200 && foundEngrais && foundSemence && foundEngrais.stock_initial === 150.5 && foundSemence.stock_initial === 25.25,
      '4. Validation du stock consolidé après import (décimales conservées)',
      `Engrais stock initial: ${foundEngrais?.stock_initial} (Attendu: 150.5) | Semence stock initial: ${foundSemence?.stock_initial} (Attendu: 25.25)`
    );

    // Nettoyage sécurisé des éléments de test créés (suppression uniquement des items de test sans toucher au reste)
    // Nous pouvons utiliser l'API ou laisser les tests dans l'environnement de dev isolé
  } catch (err: any) {
    assert(false, '2, 3, 4. Tests API Import Initial & Idempotence', err.message);
  }

  console.log('======================================================================');
  console.log(`BILAN DES TESTS D'IMPORT INITIAL : ${passed} RÉUSSIS, ${failed} ÉCHECS`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runComprehensiveImportTest();
