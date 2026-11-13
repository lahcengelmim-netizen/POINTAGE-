/**
 * Test unitaire et de conformité pour le calcul de rémunération des heures supplémentaires
 * Conforme aux règles formulées par Lahcen Pointeur :
 * 
 * RÈGLES :
 * 1. Mode Heure : Prix unitaire (DH/h) × Nombre d'heures
 *    Exemple : 30 DH × 2 = 60 DH.
 * 2. Mode Quart d'heure (15 min) : Prix unitaire (DH/quart) × Nombre de quarts
 *    Exemple : 10 DH × 4 = 40 DH.
 * 3. Ne jamais multiplier deux fois par 4 ou convertir automatiquement le prix sans respecter le mode choisi.
 * 4. Durée en heures décimales :
 *    - Mode Heure : duree_heures = nb_unites (ex: 2 -> 2.0 H)
 *    - Mode Quart d'heure : duree_heures = nb_unites / 4 (ex: 4 -> 1.0 H, 6 -> 1.5 H, 1 -> 0.25 H)
 */

interface HeureSuppCalculationInput {
  mode_calcul: 'heure' | 'quart_heure';
  tarif_unitaire: number | null;
  nb_unites: number;
}

interface HeureSuppCalculationOutput {
  mode_calcul: 'heure' | 'quart_heure';
  tarif_unitaire: number | null;
  nb_unites: number;
  duree_heures: number;
  remuneration: number | null;
}

function computeHeureSupplementaire(input: HeureSuppCalculationInput): HeureSuppCalculationOutput {
  const mode = input.mode_calcul === 'quart_heure' ? 'quart_heure' : 'heure';
  const nb = Number(input.nb_unites);
  const tarif = input.tarif_unitaire !== null ? Math.round(Number(input.tarif_unitaire) * 100) / 100 : null;

  if (isNaN(nb) || nb <= 0) {
    throw new Error('Quantité invalide');
  }

  // Durée en heures :
  // - Mode Heure : nb_unites
  // - Mode Quart : nb_unites / 4
  const duree_heures = mode === 'quart_heure'
    ? Math.round((nb / 4) * 100) / 100
    : Math.round(nb * 100) / 100;

  // Rémunération : FORMULE STRICTE
  // Rémunération = Prix unitaire × Nombre saisi.
  const remuneration = tarif !== null
    ? Math.round(tarif * nb * 100) / 100
    : null;

  return {
    mode_calcul: mode,
    tarif_unitaire: tarif,
    nb_unites: nb,
    duree_heures,
    remuneration,
  };
}

function runVerificationSuite() {
  console.log('======================================================================');
  console.log('VÉRIFICATION RIGOUREUSE DU CALCUL DE RÉMUNÉRATION (LAHCEN POINTEUR)');
  console.log('======================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, detail: string) {
    if (condition) {
      console.log(`✅ [PASS] ${title}`);
      console.log(`   ➡️ Preuve : ${detail}\n`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title}`);
      console.error(`   ➡️ Erreur : ${detail}\n`);
      failed++;
    }
  }

  // TEST 1 : Exemple exact Heure : 30 DH × 2 = 60 DH
  const res1 = computeHeureSupplementaire({
    mode_calcul: 'heure',
    tarif_unitaire: 30,
    nb_unites: 2,
  });
  assert(
    'Exemple 1 : Mode Heure (30 DH × 2 = 60 DH)',
    res1.remuneration === 60 && res1.duree_heures === 2.0 && res1.mode_calcul === 'heure',
    `Rémunération = ${res1.remuneration} DH, Durée = ${res1.duree_heures} H, Mode = ${res1.mode_calcul}`
  );

  // TEST 2 : Exemple exact Quart d'heure : 10 DH × 4 = 40 DH
  const res2 = computeHeureSupplementaire({
    mode_calcul: 'quart_heure',
    tarif_unitaire: 10,
    nb_unites: 4,
  });
  assert(
    'Exemple 2 : Mode Quart d\'heure (10 DH × 4 = 40 DH)',
    res2.remuneration === 40 && res2.duree_heures === 1.0 && res2.mode_calcul === 'quart_heure',
    `Rémunération = ${res2.remuneration} DH, Durée = ${res2.duree_heures} H (1h), Mode = ${res2.mode_calcul}`
  );

  // TEST 3 : Interdiction stricte de double multiplication par 4
  // Si le tarif est 10 DH/quart et le nombre est 4, la rémunération doit être 40 DH et JAMAIS 160 DH
  assert(
    'Règle stricte : Aucune double multiplication par 4',
    res2.remuneration !== 160 && res2.remuneration === 40,
    `Rémunération = ${res2.remuneration} DH (n'a PAS été multipliée deux fois par 4)`
  );

  // TEST 4 : Mode Quart d'heure avec 6 quarts (1h30) à 15 DH/quart : 15 × 6 = 90 DH
  const res4 = computeHeureSupplementaire({
    mode_calcul: 'quart_heure',
    tarif_unitaire: 15,
    nb_unites: 6,
  });
  assert(
    'Mode Quart d\'heure : 6 quarts (1.5 H) à 15 DH/quart = 90 DH',
    res4.remuneration === 90 && res4.duree_heures === 1.5,
    `Rémunération = ${res4.remuneration} DH, Durée = ${res4.duree_heures} H`
  );

  // TEST 5 : Mode Heure avec tarif décimal (ex: 35.5 DH × 3 = 106.5 DH)
  const res5 = computeHeureSupplementaire({
    mode_calcul: 'heure',
    tarif_unitaire: 35.5,
    nb_unites: 3,
  });
  assert(
    'Mode Heure avec tarif décimal : 35.5 DH × 3 = 106.5 DH',
    res5.remuneration === 106.5 && res5.duree_heures === 3,
    `Rémunération = ${res5.remuneration} DH, Durée = ${res5.duree_heures} H`
  );

  // TEST 6 : Mode Quart d'heure sans tarif renseigné (durée seule)
  const res6 = computeHeureSupplementaire({
    mode_calcul: 'quart_heure',
    tarif_unitaire: null,
    nb_unites: 8,
  });
  assert(
    'Mode Quart sans tarif : 8 quarts = 2.0 H, rémunération null',
    res6.remuneration === null && res6.duree_heures === 2.0,
    `Rémunération = ${res6.remuneration}, Durée = ${res6.duree_heures} H`
  );

  console.log(`======================================================================`);
  console.log(`BILAN DES TESTS : ${passed}/${passed + failed} RÉUSSIS`);
  console.log(`======================================================================`);

  if (failed > 0) process.exit(1);
}

runVerificationSuite();
