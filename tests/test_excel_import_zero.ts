import fs from 'fs';
import * as XLSX from 'xlsx';

async function runExcelZeroImportTest() {
  console.log('====================================================');
  console.log('🧪 TEST MANDATAIRE — IMPORTATION EXCEL AVEC QUANTITÉ ZÉRO');
  console.log('====================================================\n');

  const BASE_URL = 'http://localhost:3000';
  const ADMIN_TOKEN = 'dev_admin_token';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` };

  // Clean stock DB first for deterministic test
  const db = JSON.parse(fs.readFileSync('./data/recolte_db.json', 'utf-8'));
  db.stock_produits = [];
  db.stock_mouvements = [];
  fs.writeFileSync('./data/recolte_db.json', JSON.stringify(db, null, 2));

  // 1. Create test Excel items
  const testItems = [
    { nom: 'AMMONITRATE', unite: 'KG', qte: 0 },
    { nom: 'MAP', unite: 'KG', qte: 0 },
    { nom: 'GROWEL', unite: 'KG', qte: 95 },
  ];

  // 2. Call API /api/stock/import-initial
  const importRes = await fetch(`${BASE_URL}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: `idem_mandatory_${Date.now()}`,
      items: testItems,
    }),
  }).then((r) => r.json());

  console.log('[Étape 1] Import initial de AMMONITRATE(0), MAP(0), GROWEL(95) :');
  console.log('  -> Succès API :', importRes.success);
  console.log('  -> Produits importés :', importRes.importedCount, '/ 3');
  if (!importRes.success || importRes.importedCount !== 3) {
    throw new Error('Échec de l\'importation initiale de 3 produits avec quantite 0');
  }

  // 3. Query stock catalog (/api/stock)
  const stockRes = await fetch(`${BASE_URL}/api/stock`, { headers }).then((r) => r.json());
  console.log('\n[Étape 2] Vérification du catalogue « Tous » :');
  console.log('  -> Nombre total de produits catalogués :', stockRes.produits.length);

  const ammo = stockRes.produits.find((p: any) => p.produit.nom === 'AMMONITRATE');
  const map = stockRes.produits.find((p: any) => p.produit.nom === 'MAP');
  const growel = stockRes.produits.find((p: any) => p.produit.nom === 'GROWEL');

  console.log('  -> AMMONITRATE :', ammo ? `Présent | Stock: ${ammo.stock_actuel} ${ammo.produit.unite} | État: ${ammo.etat}` : 'ABSENT ❌');
  console.log('  -> MAP         :', map ? `Présent | Stock: ${map.stock_actuel} ${map.produit.unite} | État: ${map.etat}` : 'ABSENT ❌');
  console.log('  -> GROWEL      :', growel ? `Présent | Stock: ${growel.stock_actuel} ${growel.produit.unite} | État: ${growel.etat}` : 'ABSENT ❌');

  if (!ammo || ammo.stock_actuel !== 0 || ammo.etat !== 'RUPTURE') throw new Error('AMMONITRATE invalide ou absent');
  if (!map || map.stock_actuel !== 0 || map.etat !== 'RUPTURE') throw new Error('MAP invalide ou absent');
  if (!growel || growel.stock_actuel !== 95 || growel.etat !== 'DISPONIBLE') throw new Error('GROWEL invalide ou absent');

  // 4. Verify AMMONITRATE and MAP are selectable for Entrée and can be replenished
  console.log('\n[Étape 3] Test de réapprovisionnement (+50 KG sur AMMONITRATE à stock 0) :');
  const entreeRes = await fetch(`${BASE_URL}/api/stock/entree`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: `idem_reassort_ammo_${Date.now()}`,
      produit_id: ammo.produit.id,
      quantite: 50,
      date: '2026-10-31',
      motif: 'Réapprovisionnement suite import 0',
    }),
  }).then((r) => r.json());

  console.log('  -> Entrée réussie :', entreeRes.success, '| Nouveau stock :', entreeRes.nouveau_stock);
  if (!entreeRes.success || entreeRes.nouveau_stock !== 50) throw new Error('Échec réapprovisionnement AMMONITRATE');

  // 5. Test duplicate re-import (must NOT overwrite or create 2nd product)
  console.log('\n[Étape 4] Protection anti-doublon (Réimportation de AMMONITRATE avec QTE=999) :');
  const reimportRes = await fetch(`${BASE_URL}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: `idem_duplicate_test_${Date.now()}`,
      items: [{ nom: 'AMMONITRATE', unite: 'KG', qte: 999 }],
    }),
  }).then((r) => r.json());

  console.log('  -> Détecté comme existant :', reimportRes.alreadyInitialized);
  console.log('  -> Nombre de nouveaux produits importés :', reimportRes.importedCount);

  const stockAfterDup = await fetch(`${BASE_URL}/api/stock`, { headers }).then((r) => r.json());
  const ammoAfterDup = stockAfterDup.produits.find((p: any) => p.produit.nom === 'AMMONITRATE');
  const ammoCount = stockAfterDup.produits.filter((p: any) => p.produit.nom === 'AMMONITRATE').length;

  console.log('  -> Occurrence unique de AMMONITRATE :', ammoCount === 1);
  console.log('  -> Stock de AMMONITRATE maintenu intact à :', ammoAfterDup.stock_actuel, 'KG (pas écrasé à 999)');

  if (reimportRes.importedCount !== 0 || ammoCount !== 1 || ammoAfterDup.stock_actuel !== 50) {
    throw new Error('La protection anti-doublon a échoué');
  }

  // 6. Test invalid input rejection (negative quantity, missing name, missing unit)
  console.log('\n[Étape 5] Test de rejet des lignes invalides (Nom vide, Quantité négative) :');
  const invalidRes = await fetch(`${BASE_URL}/api/stock/import-initial`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotencyKey: `idem_invalid_test_${Date.now()}`,
      items: [
        { nom: '', unite: 'KG', qte: 10 },
        { nom: 'PRODUIT NEGATIF', unite: 'KG', qte: -15 },
      ],
    }),
  }).then((r) => r.json());

  console.log('  -> Produits importés depuis lignes invalides :', invalidRes.importedCount, '(doit être 0)');
  if (invalidRes.importedCount !== 0) throw new Error('Des lignes invalides ont été importées');

  console.log('\n====================================================');
  console.log('✅ TOUS LES TESTS MANDATAIRES ONT RÉUSSI AVEC SUCCÈS !');
  console.log('====================================================\n');
}

runExcelZeroImportTest().catch((e) => {
  console.error('\n❌ ERREUR LORS DES TESTS :', e);
  process.exit(1);
});
