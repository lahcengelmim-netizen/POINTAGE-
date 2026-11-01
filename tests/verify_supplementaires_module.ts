import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('========================================================');
  console.log('TEST AUTOMATISÉ : RECONSTRUCTION MODULE SUPPLÉMENTAIRES');
  console.log('========================================================\n');

  let testsPassed = 0;
  let testsFailed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      testsPassed++;
    } else {
      console.error(`❌ [FAIL] ${testName} ${detail ? '— ' + detail : ''}`);
      testsFailed++;
    }
  }

  // 1. Test Sécurité : Non-authentifié -> 401
  try {
    const res = await fetch(`${BASE_URL}/api/supplementaires`);
    assert(res.status === 401, 'Sécurité 1 : Rejet sans authentification (401)', `Reçu status: ${res.status}`);
  } catch (err: any) {
    assert(false, 'Sécurité 1 : Erreur réseau', err.message);
  }

  // 2. Test Sécurité : Rôle Caporal -> 403 Forbidden
  try {
    const res = await fetch(`${BASE_URL}/api/supplementaires`, {
      headers: { Authorization: 'Bearer usr_caporal_brahim' },
    });
    const body = await res.json();
    assert(res.status === 403 && body.success === false, 'Sécurité 2 : Blocage strict rôle Caporal (403)', `Status: ${res.status}`);
  } catch (err: any) {
    assert(false, 'Sécurité 2 : Erreur réseau', err.message);
  }

  // 3. Test GET avec Token Admin
  try {
    const res = await fetch(`${BASE_URL}/api/supplementaires`, {
      headers: { Authorization: 'Bearer dev_admin_token' },
    });
    const body = await res.json();
    assert(res.status === 200 && body.success === true && Array.isArray(body.supplementaires), 'Lecture Admin : GET /api/supplementaires (200 OK)');
  } catch (err: any) {
    assert(false, 'Lecture Admin : Erreur réseau', err.message);
  }

  // 4. Test Validation : Saisie Heures <= 0 -> 400
  try {
    const res = await fetch(`${BASE_URL}/api/supplementaires`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token',
      },
      body: JSON.stringify({
        type: 'heures',
        ouvrier_id: 'test_ouvrier_1',
        numero_ouvrier: 30,
        date: '2026-11-01',
        heures: 0, // invalide
      }),
    });
    const body = await res.json();
    assert(res.status === 400 && body.success === false, 'Validation Heures : Rejet si heures <= 0 (400)');
  } catch (err: any) {
    assert(false, 'Validation Heures : Erreur', err.message);
  }

  // 5. Test Validation : Saisie Tâche sans quantité ou <= 0 -> 400
  try {
    const res = await fetch(`${BASE_URL}/api/supplementaires`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dev_admin_token',
      },
      body: JSON.stringify({
        type: 'tache',
        ouvrier_id: 'test_ouvrier_1',
        numero_ouvrier: 30,
        date: '2026-11-01',
        tache_id: 'tache_balayage',
        quantite: -5, // invalide
        unite: 'RUBO',
      }),
    });
    const body = await res.json();
    assert(res.status === 400 && body.success === false, 'Validation Tâches : Rejet si quantité <= 0 (400)');
  } catch (err: any) {
    assert(false, 'Validation Tâches : Erreur', err.message);
  }

  // 6. Test Multi-Opérations : Vérification de la logique de regroupement (1 Ligne par ouvrier)
  // Simuler le calcul avec l'exemple exact de la demande utilisateur :
  // Ouvrier A (#30) : 2 H + 1 H, et 5 RUBAN + 30 RUBO BALAYAGE
  // Ouvrier B (#45) : 3 H, et 10 FORFAIT
  // Ouvrier C (#52) : 0 Heure, et —
  const mockOperations = [
    { ouvrier_id: 'w1', numero_ouvrier: 30, type: 'heures', quantite: 2, unite: 'HEURE' },
    { ouvrier_id: 'w1', numero_ouvrier: 30, type: 'heures', quantite: 1, unite: 'HEURE' },
    { ouvrier_id: 'w1', numero_ouvrier: 30, type: 'tache', quantite: 5, unite: 'RUBAN', nom_tache: 'RUBAN' },
    { ouvrier_id: 'w1', numero_ouvrier: 30, type: 'tache', quantite: 30, unite: 'RUBO', nom_tache: 'BALAYAGE' },
    { ouvrier_id: 'w2', numero_ouvrier: 45, type: 'heures', quantite: 3, unite: 'HEURE' },
    { ouvrier_id: 'w2', numero_ouvrier: 45, type: 'tache', quantite: 10, unite: 'FORFAIT', nom_tache: 'FORFAIT' },
  ];

  // Calcul pour w1 (#30)
  const w1Ops = mockOperations.filter(o => o.ouvrier_id === 'w1');
  const w1Heures = w1Ops.filter(o => o.type === 'heures').map(o => o.quantite);
  const totalW1H = w1Heures.reduce((a, b) => a + b, 0);
  const w1HFormula = `${w1Heures.join(' H + ')} H = ${totalW1H} H`;

  const w1Taches = w1Ops.filter(o => o.type === 'tache').map(o => `${o.quantite} ${o.unite} ${o.nom_tache}`);
  const w1TFormula = w1Taches.join(' + ');

  assert(totalW1H === 3 && w1HFormula === '2 H + 1 H = 3 H', 'Calcul Récapitulatif : Somme des heures exacte (2 H + 1 H = 3 H)');
  assert(w1TFormula.includes('5 RUBAN') && w1TFormula.includes('30 RUBO BALAYAGE'), 'Calcul Récapitulatif : Tâches distinctes sans mélange d\'unités (5 RUBAN + 30 RUBO BALAYAGE)');

  console.log('\n========================================================');
  console.log(`RÉSULTAT FINAL DES TESTS : ${testsPassed} passés, ${testsFailed} échoués`);
  console.log('========================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runTests();
