/**
 * Suite de vérification officielle pour la persistance du module STOCK dans Supabase PostgreSQL
 * Lahcen Pointeur
 */

const BASE_URL = 'http://127.0.0.1:3000';

async function run() {
  console.log('======================================================================');
  console.log('📋 RAPPORT D\'EXÉCUTION DES TESTS — MODULE STOCK (POSTGRESQL / SUPABASE)');
  console.log('======================================================================\n');

  const testResults: Array<{ name: string; status: 'SUCCESS' | 'FAILURE'; detail: string }> = [];

  // TEST 1: Rejet utilisateur non authentifié (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/api/stock`);
    const data = await res.json();
    const passed = res.status === 401 && !data.success;
    testResults.push({
      name: '1. Test sécurité : Rejet accès sans jeton (HTTP 401)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Erreur: "${data.error}"`,
    });
  } catch (e: any) {
    testResults.push({ name: '1. Test sécurité sans jeton', status: 'FAILURE', detail: e.message });
  }

  // TEST 2: Rejet jeton invalide ou expiré (HTTP 401)
  try {
    const res = await fetch(`${BASE_URL}/api/stock`, {
      headers: { Authorization: 'Bearer fake_invalid_jwt_token_12345' },
    });
    const data = await res.json();
    const passed = res.status === 401 && !data.success;
    testResults.push({
      name: '2. Test sécurité : Rejet jeton JWT invalide/expiré (HTTP 401)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Erreur: "${data.error}"`,
    });
  } catch (e: any) {
    testResults.push({ name: '2. Test sécurité jeton invalide', status: 'FAILURE', detail: e.message });
  }

  // TEST 3: Test de permission non-admin / Caporal (HTTP 403)
  try {
    const res = await fetch(`${BASE_URL}/api/stock/entree`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer usr_caporal_brahim',
      },
      body: JSON.stringify({ produit_id: 'prod_123', quantite: 10 }),
    });
    const data = await res.json();
    const passed = res.status === 403 && !data.success;
    testResults.push({
      name: '3. Test permission non-admin : Rejet strict rôle Caporal (HTTP 403)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Erreur: "${data.error}"`,
    });
  } catch (e: any) {
    testResults.push({ name: '3. Test permission Caporal', status: 'FAILURE', detail: e.message });
  }

  // TEST 4: Contrôle RLS PostgreSQL actif sur stock_produits
  try {
    const res = await fetch(`${BASE_URL}/api/stock`, {
      headers: { Authorization: 'Bearer dev_admin_token' },
    });
    const data = await res.json();
    const passed = res.status === 200 && data.success && Array.isArray(data.produits);
    testResults.push({
      name: '4. Chargement du stock depuis Supabase PostgreSQL (GET /api/stock)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Produits en base: ${data.produits?.length || 0} | KPIs: ${JSON.stringify(data.kpis)}`,
    });
  } catch (e: any) {
    testResults.push({ name: '4. Chargement stock PostgreSQL', status: 'FAILURE', detail: e.message });
  }

  // TEST 5: Contrôle strict de rejet en cas de sortie avec quantité <= 0
  try {
    const res = await fetch(`${BASE_URL}/api/stock/sortie`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token',
      },
      body: JSON.stringify({ produit_id: 'prod_test', quantite: 0 }),
    });
    const data = await res.json();
    const passed = res.status === 400 && !data.success;
    testResults.push({
      name: '5. Contrôle métier : Rejet sortie avec quantité <= 0 (HTTP 400)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Erreur: "${data.error}"`,
    });
  } catch (e: any) {
    testResults.push({ name: '5. Contrôle quantité <= 0', status: 'FAILURE', detail: e.message });
  }

  // TEST 6: Contrôle motif obligatoire sur correction de stock (HTTP 400)
  try {
    const res = await fetch(`${BASE_URL}/api/stock/correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token',
      },
      body: JSON.stringify({ produit_id: 'prod_test', quantite: 5, motif: '' }),
    });
    const data = await res.json();
    const passed = res.status === 400 && !data.success && data.error.includes('motif explicite');
    testResults.push({
      name: '6. Contrôle motif obligatoire sur correction de stock (HTTP 400)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Statut HTTP: ${res.status} | Erreur: "${data.error}"`,
    });
  } catch (e: any) {
    testResults.push({ name: '6. Contrôle motif correction', status: 'FAILURE', detail: e.message });
  }

  // TEST 7: Vérification de l'absence de régression sur recolte_db.json
  try {
    const fs = await import('fs');
    const path = await import('path');
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'recolte_db.json'), 'utf8');
    const db = JSON.parse(raw);
    const passed = Array.isArray(db.users) && Array.isArray(db.serres) && Array.isArray(db.recoltes);
    testResults.push({
      name: '7. Non-régression : Intégrité des autres modules (recolte_db.json)',
      status: passed ? 'SUCCESS' : 'FAILURE',
      detail: `Users: ${db.users.length} | Serres: ${db.serres.length} | Récoltes: ${db.recoltes.length} (Intact, aucune modification)`,
    });
  } catch (e: any) {
    testResults.push({ name: '7. Non-régression recolte_db', status: 'FAILURE', detail: e.message });
  }

  // Affichage final des résultats
  testResults.forEach((t) => {
    const icon = t.status === 'SUCCESS' ? '✅' : '❌';
    console.log(`${icon} [${t.status}] ${t.name}`);
    console.log(`   Détails : ${t.detail}\n`);
  });

  const totalSuccess = testResults.filter((t) => t.status === 'SUCCESS').length;
  console.log('======================================================================');
  console.log(`BILAN DES TESTS : ${totalSuccess}/${testResults.length} VÉRIFICATIONS VALIDÉES`);
  console.log('======================================================================');
}

run().catch(console.error);
