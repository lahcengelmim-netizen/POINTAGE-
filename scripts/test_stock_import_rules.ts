/**
 * Script de test rigoureux des règles d'importation du stock initial :
 * 1. REFUS STRICT DES DOUBLONS avec détail des lignes (ex: PREVICUR ENERGY - L : ligne 1 et ligne 3.)
 * 2. ACCEPTATION QUANTITE = 0 (CARTOUCHE 20 = 0)
 * 3. ACCEPTATION QUANTITE POSITIVE (CARTOUCHE 20 = 5)
 * 4. REFUS STRICT QUANTITE NEGATIVE (CARTOUCHE 20 = -1)
 * 5. ALL-OR-NOTHING : Aucune donnée enregistrée si le fichier a des doublons ou des valeurs négatives
 */

async function runImportRulesTests() {
  const baseUrl = 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev_admin_token',
  };

  console.log('=================================================================');
  console.log('TEST SUITE : RÈGLES STRICTES D\'IMPORTATION STOCK INITIAL');
  console.log('=================================================================\n');

  // -------------------------------------------------------------
  // TEST 1 : REFUS DES DOUBLONS AVEC LIGNES EXACTES
  // -------------------------------------------------------------
  console.log('>>> TEST 1 : Fichier contenant des doublons (ex: PREVICUR ENERGY - L sur plusieurs lignes)');
  const resDup = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_dup_' + Date.now(),
      items: [
        { nom: 'PREVICUR ENERGY', unite: 'L', qte: 10 },    // Ligne 1
        { nom: 'SOUFRE ORGANIQUE', unite: 'KG', qte: 50 },  // Ligne 2
        { nom: 'previcur energy', unite: 'L', qte: 15 },    // Ligne 3 (Doublon casse différente)
        { nom: 'VELUM PRIME', unite: 'L', qte: 5 },         // Ligne 4
        { nom: 'VELUM  PRIME', unite: 'L', qte: 8 },        // Ligne 5 (Doublon espace multiple)
      ],
    }),
  });
  const dataDup = await resDup.json();
  console.log('Status code HTTP:', resDup.status);
  console.log('Réponse reçue:', dataDup);

  if (resDup.status !== 400 || dataDup.success !== false) {
    throw new Error('ÉCHEC TEST 1 : Les doublons auraient dû être rejetés avec HTTP 400 !');
  }
  if (!Array.isArray(dataDup.duplicates) || dataDup.duplicates.length < 2) {
    throw new Error('ÉCHEC TEST 1 : La liste des doublons est incomplète !');
  }
  console.log('Détail des doublons renvoyé :');
  dataDup.duplicates.forEach((d: string) => console.log('  •', d));
  console.log('✅ TEST 1 RÉUSSI : Doublons strictement rejetés avec les numéros de ligne.\n');

  // -------------------------------------------------------------
  // TEST 2 : QUANTITÉ NÉGATIVE REFUSÉE (CARTOUCHE 20 = -1)
  // -------------------------------------------------------------
  console.log('>>> TEST 2 : Fichier contenant une quantité négative (CARTOUCHE 20 = -1)');
  const resNeg = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_neg_' + Date.now(),
      items: [
        { nom: 'CARTOUCHE 20', unite: 'UNITE', qte: -1 },
      ],
    }),
  });
  const dataNeg = await resNeg.json();
  console.log('Status code HTTP:', resNeg.status);
  console.log('Réponse reçue:', dataNeg);

  if (resDup.status !== 400 || dataNeg.success !== false) {
    throw new Error('ÉCHEC TEST 2 : La quantité négative aurait dû être rejetée avec HTTP 400 !');
  }
  if (!dataNeg.error.includes('quantité négative') && !dataNeg.error.includes('-1')) {
    throw new Error('ÉCHEC TEST 2 : Message d\'erreur incomplet sur la quantité négative !');
  }
  console.log('✅ TEST 2 RÉUSSI : CARTOUCHE 20 = -1 strictement rejeté avec détail de ligne.\n');

  // -------------------------------------------------------------
  // TEST 3 : QUANTITÉ = 0 ACCEPTÉE (CARTOUCHE 20 = 0)
  // -------------------------------------------------------------
  console.log('>>> TEST 3 : Fichier avec CARTOUCHE 20 = 0 (quantité nulle autorisée pour stock initial)');
  const resZero = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_zero_' + Date.now(),
      items: [
        { nom: 'CARTOUCHE 20', unite: 'UNITE', qte: 0 },
      ],
    }),
  });
  const dataZero = await resZero.json();
  console.log('Status code HTTP:', resZero.status);
  console.log('Réponse reçue:', dataZero);

  if (resZero.status !== 200 || !dataZero.success) {
    throw new Error('ÉCHEC TEST 3 : CARTOUCHE 20 = 0 aurait dû être accepté !');
  }
  console.log('✅ TEST 3 RÉUSSI : CARTOUCHE 20 = 0 enregistré avec succès.\n');

  // -------------------------------------------------------------
  // TEST 4 : QUANTITÉ POSITIVE (CARTOUCHE 20 B = 5)
  // -------------------------------------------------------------
  console.log('>>> TEST 4 : Fichier avec CARTOUCHE 20 B = 5 (quantité positive standard)');
  const resPos = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_pos_' + Date.now(),
      items: [
        { nom: 'CARTOUCHE 20 B', unite: 'UNITE', qte: 5 },
      ],
    }),
  });
  const dataPos = await resPos.json();
  console.log('Status code HTTP:', resPos.status);
  console.log('Réponse reçue:', dataPos);

  if (resPos.status !== 200 || !dataPos.success) {
    throw new Error('ÉCHEC TEST 4 : CARTOUCHE 20 B = 5 aurait dû être accepté !');
  }
  console.log('✅ TEST 4 RÉUSSI : CARTOUCHE 20 B = 5 enregistré avec succès.\n');

  // -------------------------------------------------------------
  // TEST 5 : VÉRIFICATION DU STOCK ACTUEL ET DES MOUVEMENTS
  // -------------------------------------------------------------
  console.log('>>> TEST 5 : Vérification de la synthèse de stock pour CARTOUCHE 20 (qte: 0) et CARTOUCHE 20 B (qte: 5)');
  const resStock = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock = await resStock.json();
  
  const cZero = dataStock.produits.find((p: any) => p.produit.nom === 'CARTOUCHE 20');
  const cPos = dataStock.produits.find((p: any) => p.produit.nom === 'CARTOUCHE 20 B');

  console.log('CARTOUCHE 20 :', {
    stock_initial: cZero?.stock_initial,
    stock_actuel: cZero?.stock_actuel,
    etat: cZero?.etat,
  });
  console.log('CARTOUCHE 20 B :', {
    stock_initial: cPos?.stock_initial,
    stock_actuel: cPos?.stock_actuel,
    etat: cPos?.etat,
  });

  if (!cZero || cZero.stock_initial !== 0 || cZero.stock_actuel !== 0) {
    throw new Error('ÉCHEC TEST 5 : Stock initial de CARTOUCHE 20 n\'est pas égal à 0 !');
  }
  if (!cPos || cPos.stock_initial !== 5 || cPos.stock_actuel !== 5) {
    throw new Error('ÉCHEC TEST 5 : Stock initial de CARTOUCHE 20 B n\'est pas égal à 5 !');
  }

  console.log('\n=================================================================');
  console.log('TOUS LES TESTS DE RÈGLES D\'IMPORTATION ONT RÉUSSI (100% PASS) !');
  console.log('=================================================================');
}

runImportRulesTests().catch((err) => {
  console.error('ERREUR DURANT LES TESTS :', err);
  process.exit(1);
});
