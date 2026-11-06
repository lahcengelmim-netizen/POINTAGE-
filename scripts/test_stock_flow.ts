/**
 * Script de test complet pour le déblocage et le suivi de stock
 * 1. Importation produit MAP
 * 2. Importation d'autres produits (ex: ENGRAIS NPK, SOUFRE)
 * 3. Vérification des quantités initiales
 * 4. Entrée de stock
 * 5. Sortie de stock
 * 6. Vérification du stock restant et cohérence
 * 7. Historique des mouvements
 */

async function runTests() {
  const baseUrl = 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev_admin_token',
  };

  console.log('--- TEST 1 : IMPORTATION DU PRODUIT MAP ---');
  const resMap = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_map_' + Date.now(),
      items: [{ nom: 'MAP', unite: 'KG', qte: 500 }],
    }),
  });
  const dataMap = await resMap.json();
  console.log('Résultat Import MAP:', dataMap);
  if (!dataMap.success) throw new Error('Échec TEST 1: ' + JSON.stringify(dataMap));

  console.log('\n--- TEST 2 : IMPORTATION D\'AUTRES PRODUITS (ENGRAIS NPK, SOUFRE) ---');
  const resOthers = await fetch(`${baseUrl}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: 'test_others_' + Date.now(),
      items: [
        { nom: 'ENGRAIS NPK', unite: 'SAC', qte: 100 },
        { nom: 'SOUFRE MOUILLABLE', unite: 'LITRE', qte: 250 },
      ],
    }),
  });
  const dataOthers = await resOthers.json();
  console.log('Résultat Import Autres:', dataOthers);
  if (!dataOthers.success) throw new Error('Échec TEST 2: ' + JSON.stringify(dataOthers));

  console.log('\n--- TEST 3 : VÉRIFICATION DU STOCK INITIAL CONSOLIDÉ ---');
  const resStock1 = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock1 = await resStock1.json();
  console.log('Total produits au catalogue:', dataStock1.produits.length);
  const mapProd = dataStock1.produits.find((p: any) => p.produit.nom === 'MAP');
  console.log('MAP initial:', mapProd?.stock_initial, 'actuel:', mapProd?.stock_actuel, 'unité:', mapProd?.produit.unite);
  if (!mapProd || typeof mapProd.stock_actuel !== 'number') {
    throw new Error('Échec TEST 3: Produit MAP introuvable');
  }

  const stockAvantEntree = mapProd.stock_actuel;
  const qteEntree = 200;
  const qteSortie = 150;
  const stockAttenduApresEntree = Math.round((stockAvantEntree + qteEntree) * 100) / 100;
  const stockAttenduApresSortie = Math.round((stockAttenduApresEntree - qteSortie) * 100) / 100;

  console.log('\n--- TEST 4 : EFFECTUER UNE ENTRÉE DE STOCK (+200 KG MAP) ---');
  const resEntree = await fetch(`${baseUrl}/api/stock/entree`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      produit_id: mapProd.produit.id,
      quantite: qteEntree,
      tiers: 'Fournisseur Souss Agro',
      motif: 'Livraison complémentaire',
      reference_document: 'BL-98421',
    }),
  });
  const dataEntree = await resEntree.json();
  console.log('Résultat Entrée complet:', dataEntree.success, 'Nouveau stock:', dataEntree.nouveau_stock);
  if (!dataEntree.success || dataEntree.nouveau_stock !== stockAttenduApresEntree) {
    throw new Error(`Échec TEST 4: Nouveau stock après entrée incorrect (attendu ${stockAttenduApresEntree}, reçu ${dataEntree.nouveau_stock})`);
  }

  console.log('\n--- TEST 5 : EFFECTUER UNE SORTIE DE STOCK (-150 KG MAP SUR SERRE 3) ---');
  const resSortie = await fetch(`${baseUrl}/api/stock/sortie`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      produit_id: mapProd.produit.id,
      quantite: qteSortie,
      domaine_id: 'dom_d2',
      serre_id: 'serre_3',
      motif: 'Fertigation tomate Serre 3',
    }),
  });
  const dataSortie = await resSortie.json();
  console.log('Résultat Sortie:', dataSortie.success, 'Nouveau stock après sortie:', dataSortie.nouveau_stock);
  if (!dataSortie.success || dataSortie.nouveau_stock !== stockAttenduApresSortie) {
    throw new Error(`Échec TEST 5: Nouveau stock après sortie incorrect (attendu ${stockAttenduApresSortie}, reçu ${dataSortie.nouveau_stock})`);
  }

  console.log('\n--- TEST 6 : VÉRIFICATION DU STOCK RESTANT ET SYNTHÈSE GLOBALE ---');
  const resStock2 = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock2 = await resStock2.json();
  const mapFinal = dataStock2.produits.find((p: any) => p.produit.nom === 'MAP');
  console.log('MAP Synthèse Finale:');
  console.log('  Stock initial :', mapFinal.stock_initial);
  console.log('  Total entrées  :', mapFinal.total_entrees);
  console.log('  Total sorties  :', mapFinal.total_sorties);
  console.log('  Stock restant  :', mapFinal.stock_actuel);
  console.log('  État           :', mapFinal.etat);
  if (mapFinal.stock_actuel !== stockAttenduApresSortie) {
    throw new Error(`Échec TEST 6: Stock restant incorrect (attendu ${stockAttenduApresSortie}, reçu ${mapFinal.stock_actuel})`);
  }

  console.log('\n--- TEST 7 : VÉRIFICATION DE L\'HISTORIQUE DES MOUVEMENTS ---');
  const resMvts = await fetch(`${baseUrl}/api/stock/mouvements?produit_id=${mapProd.produit.id}`, { headers });
  const dataMvts = await resMvts.json();
  console.log('Nombre total de mouvements pour MAP:', dataMvts.mouvements.length);
  dataMvts.mouvements.slice(0, 5).forEach((m: any, idx: number) => {
    console.log(`  [Mvt ${idx + 1}] Type: ${m.type} | Qte: ${m.quantite} ${m.unite} | Motif: ${m.motif} | Date: ${m.date} | Par: ${m.created_by_nom}`);
  });
  if (dataMvts.mouvements.length < 3) {
    throw new Error('Échec TEST 7: Mouvements insuffisants');
  }

  console.log('\n======================================================');
  console.log('TOUS LES 7 TESTS ONT RÉUSSI AVEC SUCCÈS TOTAL (PASS) !');
  console.log('======================================================');
}

runTests().catch((err) => {
  console.error('ERREUR TEST:', err);
  process.exit(1);
});
