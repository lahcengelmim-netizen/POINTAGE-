/**
 * Test de validation pour la Recherche Rapide et l'Ajout Direct de Produit depuis Entrées et Sorties :
 * 1. Création directe de produit (SULFAT D'AMMONIUM, KG, stock initial = 50)
 * 2. Contrôle anti-doublon (tentative de recréation d'un produit existant)
 * 3. Enregistrement d'une Entrée de stock pour ce nouveau produit (+100 KG)
 * 4. Enregistrement d'une Sortie de stock (-30 KG sur Domaine D2)
 * 5. Vérification du stock final (50 + 100 - 30 = 120 KG)
 */

async function runQuickSearchAndAddTests() {
  const baseUrl = 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev_admin_token',
  };

  console.log('========================================================================');
  console.log('TEST SUITE : RECHERCHE RAPIDE ET AJOUT DIRECT DE PRODUITS (ENTRÉES/SORTIES)');
  console.log('========================================================================\n');

  // TEST 1 : Création d'un produit en direct (SULFAT D'AMMONIUM, KG, stock_initial = 50)
  console.log('>>> TEST 1 : Création directe d\'un nouveau produit (SULFAT D\'AMMONIUM, KG, stock initial = 50)');
  const resCreate = await fetch(`${baseUrl}/api/stock/produit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nom: "SULFAT D'AMMONIUM",
      unite: 'KG',
      seuil_minimum: 10,
      stock_initial: 50,
    }),
  });
  const dataCreate = await resCreate.json();
  console.log('Réponse création :', dataCreate);
  if (!dataCreate.success || !dataCreate.produit) {
    throw new Error('ÉCHEC TEST 1 : Impossible de créer le produit en direct !');
  }
  const prodId = dataCreate.produit.id;
  console.log('✅ TEST 1 RÉUSSI : Produit créé avec succès, ID =', prodId, '\n');

  // TEST 2 : Vérification du contrôle anti-doublon
  console.log('>>> TEST 2 : Tentative de création d\'un doublon (SULFAT D\'AMMONIUM, KG)');
  const resDup = await fetch(`${baseUrl}/api/stock/produit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nom: "sulfat d'ammonium",
      unite: 'kg',
      seuil_minimum: 10,
    }),
  });
  const dataDup = await resDup.json();
  console.log('Réponse tentative doublon (Status HTTP:', resDup.status, ') :', dataDup);
  if (resDup.status !== 400 || dataDup.success !== false) {
    throw new Error('ÉCHEC TEST 2 : Le doublon aurait dû être bloqué avec HTTP 400 !');
  }
  console.log('✅ TEST 2 RÉUSSI : Le doublon a été strictement refusé par l\'API.\n');

  // TEST 3 : Enregistrement d'une Entrée de stock pour ce nouveau produit (+100 KG)
  console.log('>>> TEST 3 : Enregistrement d\'une Entrée de stock (+100 KG)');
  const resEntree = await fetch(`${baseUrl}/api/stock/entree`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      produit_id: prodId,
      quantite: 100,
      date: new Date().toISOString().slice(0, 10),
      tiers: 'Fournisseur Souss Agro',
      reference_document: 'BL-99881',
      motif: 'Réapprovisionnement direct',
    }),
  });
  const dataEntree = await resEntree.json();
  console.log('Réponse Entrée :', dataEntree);
  if (!dataEntree.success || dataEntree.nouveau_stock !== 150) {
    throw new Error(`ÉCHEC TEST 3 : Stock après entrée incorrect (attendu 150, reçu ${dataEntree.nouveau_stock})`);
  }
  console.log('✅ TEST 3 RÉUSSI : Entrée enregistrée (+100 KG -> Stock = 150 KG).\n');

  // TEST 4 : Enregistrement d'une Sortie de stock pour ce produit (-30 KG sur Domaine D2)
  console.log('>>> TEST 4 : Enregistrement d\'une Sortie de stock (-30 KG sur Domaine D2)');
  const resSortie = await fetch(`${baseUrl}/api/stock/sortie`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      produit_id: prodId,
      quantite: 30,
      date: new Date().toISOString().slice(0, 10),
      domaine_id: 'dom_d2',
      serre_id: 'Serre 1',
      motif: 'Fertilisation tomate',
    }),
  });
  const dataSortie = await resSortie.json();
  console.log('Réponse Sortie :', dataSortie);
  if (!dataSortie.success || dataSortie.nouveau_stock !== 120) {
    throw new Error(`ÉCHEC TEST 4 : Stock après sortie incorrect (attendu 120, reçu ${dataSortie.nouveau_stock})`);
  }
  console.log('✅ TEST 4 RÉUSSI : Sortie enregistrée (-30 KG -> Stock = 120 KG).\n');

  // TEST 5 : Vérification de la synthèse globale et nettoyage du test
  console.log('>>> TEST 5 : Vérification de la synthèse du catalogue');
  const resStock = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock = await resStock.json();
  const prodFound = dataStock.produits.find((p: any) => p.produit.id === prodId);
  console.log('Synthèse du produit :', prodFound);

  if (!prodFound || prodFound.stock_actuel !== 120) {
    throw new Error('ÉCHEC TEST 5 : Synthèse du stock finale incorrecte !');
  }

  // Nettoyage sécurisé du produit de test
  await fetch(`${baseUrl}/api/stock/produit/${prodId}`, { method: 'DELETE', headers });
  console.log('✅ TEST 5 RÉUSSI : Produit de test nettoyé proprement.\n');

  console.log('========================================================================');
  console.log('TOUS LES TESTS DE RECHERCHE ET AJOUT DIRECT DE PRODUITS SONT 100% PASS !');
  console.log('========================================================================');
}

runQuickSearchAndAddTests().catch((err) => {
  console.error('ERREUR TEST :', err);
  process.exit(1);
});
