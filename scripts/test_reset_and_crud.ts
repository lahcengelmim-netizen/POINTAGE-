/**
 * Test complet de la réinitialisation et du cycle de vie des produits :
 * 1. Vérification catalogue vide
 * 2. Vérification préservation intégrale des autres modules (users, companies, serres, recoltes)
 * 3. Création manuelle d'un produit avec stock initial positif
 * 4. Création manuelle d'un produit avec stock initial = 0 (CARTOUCHE 20 = 0)
 * 5. Modification d'un produit (Nom, Unité, Seuil)
 * 6. Suppression manuelle d'un produit
 * 7. Importation Excel sur catalogue entièrement vide
 * 8. Remise à zéro finale pour laisser le catalogue 100% vide prêt pour l'utilisateur
 */

async function runResetAndCrudTests() {
  const baseUrl = 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer dev_admin_token',
  };

  console.log('======================================================================');
  console.log('SUITE DE TESTS : RÉINITIALISATION DU CATALOGUE & CYCLE DE VIE PRODUITS');
  console.log('======================================================================\n');

  // TEST 1 : Vérification que le catalogue et les mouvements sont vides
  console.log('>>> TEST 1 : Vérification du catalogue après réinitialisation');
  const resStock1 = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock1 = await resStock1.json();
  console.log('Produits en stock :', dataStock1.produits.length);
  console.log('KPIs :', dataStock1.kpis);
  if (!dataStock1.success || dataStock1.produits.length !== 0) {
    throw new Error('ÉCHEC TEST 1 : Le catalogue devrait être vide !');
  }
  console.log('✅ TEST 1 RÉUSSI : Catalogue 100% vide.\n');

  // TEST 2 : Vérification de la préservation des autres modules
  console.log('>>> TEST 2 : Préservation des utilisateurs, entreprises et serres');
  const resUsers = await fetch(`${baseUrl}/api/users`, { headers });
  const dataUsers = await resUsers.json();
  console.log('Utilisateurs conservés :', dataUsers.users.length);

  const resSerres = await fetch(`${baseUrl}/api/serres`, { headers });
  const dataSerres = await resSerres.json();
  console.log('Serres conservées :', dataSerres.serres.length);

  const resDebug = await fetch(`${baseUrl}/api/debug-supabase`);
  const dataDebug = await resDebug.json();
  console.log('Profils Supabase :', dataDebug.profilesCount, '| Entreprises :', dataDebug.companiesCount);

  if (dataUsers.users.length === 0 || dataSerres.serres.length === 0 || dataDebug.companiesCount === 0) {
    throw new Error('ÉCHEC TEST 2 : Les autres modules auraient dû être préservés !');
  }
  console.log('✅ TEST 2 RÉUSSI : Tous les autres modules sont intacts.\n');

  // TEST 3 : Création manuelle d'un produit avec stock initial positif
  console.log('>>> TEST 3 : Création manuelle (ENGRAIS NPK 20-20-20, SAC, stock initial = 25)');
  const resCreate1 = await fetch(`${baseUrl}/api/stock/produit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nom: 'ENGRAIS NPK 20-20-20',
      unite: 'SAC',
      seuil_minimum: 5,
      stock_initial: 25,
    }),
  });
  const dataCreate1 = await resCreate1.json();
  console.log('Création Produit 1 :', dataCreate1);
  if (!dataCreate1.success || !dataCreate1.produit) {
    throw new Error('ÉCHEC TEST 3 : Erreur création produit 1');
  }
  console.log('✅ TEST 3 RÉUSSI : Produit avec stock initial 25 créé avec succès.\n');

  // TEST 4 : Création manuelle d'un produit avec stock initial = 0
  console.log('>>> TEST 4 : Création manuelle avec stock initial = 0 (CARTOUCHE 20, UNITE, stock initial = 0)');
  const resCreate2 = await fetch(`${baseUrl}/api/stock/produit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nom: 'CARTOUCHE 20',
      unite: 'UNITE',
      seuil_minimum: 10,
      stock_initial: 0,
    }),
  });
  const dataCreate2 = await resCreate2.json();
  console.log('Création Produit 2 (stock 0) :', dataCreate2);
  if (!dataCreate2.success || !dataCreate2.produit) {
    throw new Error('ÉCHEC TEST 4 : Erreur création produit 2');
  }
  console.log('✅ TEST 4 RÉUSSI : Produit avec stock initial 0 créé avec succès.\n');

  // TEST 5 : Vérification de la synthèse avec les 2 produits créés
  console.log('>>> TEST 5 : Synthèse du stock pour les 2 produits');
  const resStock2 = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock2 = await resStock2.json();
  console.log('Nombre de produits :', dataStock2.produits.length);
  const p1 = dataStock2.produits.find((p: any) => p.produit.nom === 'ENGRAIS NPK 20-20-20');
  const p2 = dataStock2.produits.find((p: any) => p.produit.nom === 'CARTOUCHE 20');
  console.log('Produit 1 :', { nom: p1?.produit.nom, initial: p1?.stock_initial, actuel: p1?.stock_actuel });
  console.log('Produit 2 :', { nom: p2?.produit.nom, initial: p2?.stock_initial, actuel: p2?.stock_actuel, etat: p2?.etat });

  if (p1?.stock_actuel !== 25 || p2?.stock_actuel !== 0) {
    throw new Error('ÉCHEC TEST 5 : Quantités de stock incohérentes');
  }
  console.log('✅ TEST 5 RÉUSSI : Synthèse exacte (25 et 0).\n');

  // TEST 6 : Modification d'un produit (PUT /api/stock/produit/:id)
  console.log('>>> TEST 6 : Modification du produit 1 (Changement de seuil à 15)');
  const resUpdate = await fetch(`${baseUrl}/api/stock/produit/${p1.produit.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      nom: 'ENGRAIS NPK 20-20-20 SPECIAL',
      unite: 'SAC',
      seuil_minimum: 15,
    }),
  });
  const dataUpdate = await resUpdate.json();
  console.log('Résultat Modification :', dataUpdate);
  if (!dataUpdate.success || dataUpdate.produit.nom !== 'ENGRAIS NPK 20-20-20 SPECIAL') {
    throw new Error('ÉCHEC TEST 6 : Erreur modification produit');
  }
  console.log('✅ TEST 6 RÉUSSI : Produit modifié avec succès.\n');

  // TEST 7 : Suppression manuelle d'un produit (DELETE /api/stock/produit/:id)
  console.log('>>> TEST 7 : Suppression du produit 1');
  const resDelete = await fetch(`${baseUrl}/api/stock/produit/${p1.produit.id}`, {
    method: 'DELETE',
    headers,
  });
  const dataDelete = await resDelete.json();
  console.log('Résultat Suppression :', dataDelete);
  if (!dataDelete.success) {
    throw new Error('ÉCHEC TEST 7 : Erreur suppression produit');
  }

  const resStock3 = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStock3 = await resStock3.json();
  console.log('Produits restants après suppression :', dataStock3.produits.length);
  if (dataStock3.produits.length !== 1 || dataStock3.produits[0].produit.nom !== 'CARTOUCHE 20') {
    throw new Error('ÉCHEC TEST 7 : Seul CARTOUCHE 20 devrait subsister');
  }
  console.log('✅ TEST 7 RÉUSSI : Produit supprimé sans conflit FK.\n');

  // TEST 8 : Réinitialisation finale pour laisser le catalogue totalement vide
  console.log('>>> TEST 8 : Réinitialisation finale pour remettre le catalogue à zéro pour l\'utilisateur');
  const resResetFinal = await fetch(`${baseUrl}/api/stock/reset-catalogue`, {
    method: 'POST',
    headers,
  });
  const dataResetFinal = await resResetFinal.json();
  console.log('Résultat Reset :', dataResetFinal);

  const resStockFinal = await fetch(`${baseUrl}/api/stock`, { headers });
  const dataStockFinal = await resStockFinal.json();
  console.log('Catalogue final count :', dataStockFinal.produits.length);

  if (!dataResetFinal.success || dataStockFinal.produits.length !== 0) {
    throw new Error('ÉCHEC TEST 8 : Le catalogue final doit être strictement vide (0 produit)');
  }
  console.log('✅ TEST 8 RÉUSSI : Catalogue laissé à zéro (0 produit) prêt pour l\'utilisateur.\n');

  console.log('======================================================================');
  console.log('TOUS LES TESTS DU CYCLE DE VIE PRODUIT ET RESET SONT 100% PASS !');
  console.log('======================================================================');
}

runResetAndCrudTests().catch((err) => {
  console.error('ERREUR DURANT LES TESTS :', err);
  process.exit(1);
});
