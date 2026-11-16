/**
 * Tests obligatoires et vérifications complètes — EXPORT RÉMUNÉRATION JOURNALIÈRE
 * Exécution : npx tsx tests/remuneration-export.test.ts
 */

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  REMUNERATION_EXCEL_COLUMNS,
  REMUNERATION_SHEET_NAME,
  TARIF_RECOLTE_PLATEAU,
  TARIF_STANDARD_HEURE,
  buildDailyRemunerationRows,
  buildRemunerationWorkbook,
  calculateRecolteRemuneration,
  calculateStandardRemuneration,
  calculateTraitementD3Remuneration,
  classifyRemunerationWorkType,
  computeEffectiveHours,
  formatDomaineDT,
  formatSerreCodeForExport,
  getRemunerationExportFilename,
} from '../src/utils/remunerationExporter';
import {
  AffectationTache,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
} from '../src/types';

console.log('=== TESTS OBLIGATOIRES EXPORT RÉMUNÉRATION JOURNALIÈRE ===');

// ---------------------------------------------------------------------------
// 1. TESTS OBLIGATOIRES SECTION 10 + EXEMPLES SECTIONS 3, 4, 5
// ---------------------------------------------------------------------------
assert.equal(computeEffectiveHours('07:00', '16:00', 1), 8, '07:00-16:00 avec 1h pause doit donner 8h');
assert.equal(calculateStandardRemuneration(8), 95, 'Standard 8H × 11,875 doit égaler 95 DH');
assert.equal(calculateRecolteRemuneration(80), 95, 'Récolte 80 × 1,1875 doit égaler 95 DH');
assert.equal(calculateRecolteRemuneration(70), 83.125, 'Récolte 70 × 1,1875 doit égaler 83,125 DH (sans minimum 80)');
assert.equal(calculateRecolteRemuneration(50), 59.375, 'Récolte 50 × 1,1875 doit égaler 59,375 DH (sans minimum 80)');
assert.equal(calculateRecolteRemuneration(100), 118.75, 'Récolte 100 × 1,1875 doit égaler 118,75 DH');
assert.equal(calculateTraitementD3Remuneration(5), 80, 'Traitement D3 5H × 16 doit égaler 80 DH');
assert.equal(calculateTraitementD3Remuneration(7), 112, 'Traitement D3 7H × 16 doit égaler 112 DH');
assert.equal(calculateTraitementD3Remuneration(9), 144, 'Traitement D3 9H × 16 doit égaler 144 DH');
console.log('[OK] 1. Toutes les formules obligatoires (8H=95, 80=95, 70=83.125, 50=59.375, 100=118.75, D3 5H=80, 7H=112, 9H=144) validées.');

// ---------------------------------------------------------------------------
// 2. IDENTIFICATION AUTOMATIQUE DU TYPE DE TRAVAIL (SECTION 6)
// ---------------------------------------------------------------------------
const domD1: Domaine = { id: 'dom_d1', nom: 'D1', ordre: 4 };
const domD2: Domaine = { id: 'dom_d2', nom: 'D2', ordre: 1 };
const domD3: Domaine = { id: 'dom_d3', nom: 'D3', ordre: 2 };
const domD4: Domaine = { id: 'dom_d4', nom: 'D4', ordre: 5 };
const domD5: Domaine = { id: 'dom_d5', nom: 'D5', ordre: 3 };

// Même dans D3, une tâche Effeuillage doit être STANDARD (11,875) et NON Traitement D3 (16)
assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_eff', code: 'E01', nom: 'EFFEUILLAGE' },
    domaine: domD3,
  }).categorie,
  'STANDARD',
  'Un ouvrier en D3 qui fait Effeuillage doit être STANDARD (11,875 DH/h)'
);

// Même dans D3, une tâche Récolte doit être RECOLTE (1,1875)
assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_rec', code: 'R01', nom: 'RECOLTE' },
    domaine: domD3,
  }).categorie,
  'RECOLTE',
  'Un ouvrier en D3 qui fait RECOLTE doit être RECOLTE'
);

// Traitement dans D3 -> TRAITEMENT_D3 (16 DH/h)
assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_phy', code: 'PHY01', nom: 'TRAITEMENT PHYTO' },
    domaine: domD3,
  }).categorie,
  'TRAITEMENT_D3',
  'Traitement en D3 doit être classé TRAITEMENT_D3'
);

// Traitement hors D3 -> INCERTAIN (alerte admin plutôt qu'un mauvais tarif)
assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_phy', code: 'PHY01', nom: 'TRAITEMENT PHYTO' },
    domaine: domD2,
  }).categorie,
  'INCERTAIN',
  'Traitement hors D3 doit déclencher INCERTAIN pour alerte administrateur'
);

// Affectation sans tâche -> INCERTAIN
assert.equal(
  classifyRemunerationWorkType({
    tache: null,
    domaine: domD3,
  }).categorie,
  'INCERTAIN',
  'Pointage sans tâche doit déclencher INCERTAIN'
);
console.log('[OK] 2. Identification automatique & alertes incertaines validées.');

// ---------------------------------------------------------------------------
// 3. NORMALISATION OFFICIELLE DES CODES DOMAINE (D00X) ET SERRES (D00XSY)
// ---------------------------------------------------------------------------
assert.equal(formatDomaineDT(domD1.nom, domD1.id), 'D001');
assert.equal(formatDomaineDT(domD2.nom, domD2.id), 'D002');
assert.equal(formatDomaineDT(domD3.nom, domD3.id), 'D003');
assert.equal(formatDomaineDT(domD4.nom, domD4.id), 'D004');
assert.equal(formatDomaineDT(domD5.nom, domD5.id), 'D005');
assert.equal(formatDomaineDT('D002', 'dom_d2'), 'D002');

const s2Obj: Serre = { id: 'serre_2', company_id: 'cie', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' };
const s16Obj: Serre = { id: 'serre_16', company_id: 'cie', code: 'S16', nom: 'SERRE 16', actif: true, ordre: 16, domaine_id: 'dom_d3' };
const s23Obj: Serre = { id: 'serre_d5_23', company_id: 'cie', code: 'D5-S23', nom: 'SERRE 23', actif: true, ordre: 23, domaine_id: 'dom_d5' };

// Correspondances exactes exigées
assert.equal(formatSerreCodeForExport({ rawSerre: 'Serre 2', serreObj: s2Obj, rowDomaineDT: 'D002' }).code, 'D002S2');
assert.equal(formatSerreCodeForExport({ rawSerre: 'S02', serreObj: s2Obj, rowDomaineDT: 'D002' }).code, 'D002S2');
assert.equal(formatSerreCodeForExport({ rawSerre: 'SERRE 16', serreObj: s16Obj, rowDomaineDT: 'D003' }).code, 'D003S16');
assert.equal(formatSerreCodeForExport({ rawSerre: 'S16', serreObj: s16Obj, rowDomaineDT: 'D003' }).code, 'D003S16');
assert.equal(formatSerreCodeForExport({ rawSerre: 'SERRE 23', serreObj: s23Obj, rowDomaineDT: 'D005' }).code, 'D005S23');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D5-S23', serreObj: s23Obj, rowDomaineDT: 'D005' }).code, 'D005S23');

// Anti double concaténation
assert.equal(formatSerreCodeForExport({ rawSerre: 'D002S2', serreObj: s2Obj, rowDomaineDT: 'D002' }).code, 'D002S2');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D003S16', serreObj: s16Obj, rowDomaineDT: 'D003' }).code, 'D003S16');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D005S23', serreObj: s23Obj, rowDomaineDT: 'D005' }).code, 'D005S23');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D5-S23', rowDomaineDT: 'D005' }).code, 'D005S23');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D2S02', rowDomaineDT: 'D002' }).code, 'D002S2');

// Vérification d'appartenance au bon Domaine (détection incohérence)
const mismatch16InD2 = formatSerreCodeForExport({ rawSerre: 'SERRE 16', serreObj: s16Obj, rowDomaineDT: 'D002' });
assert.equal(mismatch16InD2.code, 'D003S16');
assert.ok(mismatch16InD2.mismatchError, 'Une serre D003 sur une ligne D002 doit lever une erreur de correspondance');

const mismatch23InD3 = formatSerreCodeForExport({ rawSerre: 'SERRE 23', serreObj: s23Obj, rowDomaineDT: 'D003' });
assert.equal(mismatch23InD3.code, 'D005S23');
assert.ok(mismatch23InD3.mismatchError, 'Une serre D005 sur une ligne D003 doit lever une erreur de correspondance');

console.log('[OK] 3. Normalisation D00X & D00XSY (D002S2, D003S16, D005S23), anti-double-concaténation et contrôle Domaine/Serre validés.');

// ---------------------------------------------------------------------------
// 4. INTÉGRATION COMPLÈTE, GROUPEMENT, ABSENTS EXCLUS, MULTI-AFFECTATIONS & VALIDATIONS
// ---------------------------------------------------------------------------
const dateIso = '2026-11-15';
const ouvriers: Ouvrier[] = [
  { id: 'o1', company_id: 'cie', numero: 101, nom: 'ALI BENNANI', actif: true, createdAt: '' },
  { id: 'o2', company_id: 'cie', numero: 102, nom: 'FATIMA ZAHRA', actif: true, createdAt: '' },
  { id: 'o3', company_id: 'cie', numero: 103, nom: 'HASSAN ALAOUI', actif: true, createdAt: '' },
  { id: 'o4', company_id: 'cie', numero: 104, nom: 'ABSENT TEST', actif: true, createdAt: '' },
  { id: 'o5', company_id: 'cie', numero: 105, nom: 'SANS TACHE D3', actif: true, createdAt: '' },
];

const taches: Tache[] = [
  { id: 't_eff', company_id: 'cie', code: 'E01', nom: 'EFFEUILLAGE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_rec', company_id: 'cie', code: 'R01', nom: 'RECOLTE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_phy', company_id: 'cie', code: 'PHY01', nom: 'TRAITEMENT PHYTO', ouvriers_autorises: 'tous', createdAt: '' },
];

const serres: Serre[] = [
  { id: 'serre_1', company_id: 'cie', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' },
  { id: 'serre_2', company_id: 'cie', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' },
  { id: 'serre_16', company_id: 'cie', code: 'S16', nom: 'SERRE 16', actif: true, ordre: 16, domaine_id: 'dom_d3' },
  { id: 'serre_d5_23', company_id: 'cie', code: 'D5-S23', nom: 'SERRE 23', actif: true, ordre: 23, domaine_id: 'dom_d5' },
];

const pointages: Pointage[] = [
  { id: 'p1', company_id: 'cie', ouvrier_id: 'o1', numero_ouvrier: 101, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 1 },
  { id: 'p2', company_id: 'cie', ouvrier_id: 'o2', numero_ouvrier: 102, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 2 },
  { id: 'p3', company_id: 'cie', ouvrier_id: 'o3', numero_ouvrier: 103, date: dateIso, present: true, domaine_id: 'dom_d3', heure: '07:00:00', timestamp: 3 },
  // o4 explicitly absent -> MUST NOT APPEAR
  { id: 'p4', company_id: 'cie', ouvrier_id: 'o4', numero_ouvrier: 104, date: dateIso, present: false, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 4 },
  // o5 present without task in D3 -> flagged
  { id: 'p5', company_id: 'cie', ouvrier_id: 'o5', numero_ouvrier: 105, date: dateIso, present: true, domaine_id: 'dom_d3', heure: '07:00:00', timestamp: 5 },
];

const affectations: AffectationTache[] = [
  // o1 Standard Effeuillage sur Serre 1 & Serre 2 (D2) -> D002S1, D002S2
  { id: 'a1', company_id: 'cie', ouvrier_id: 'o1', numero_ouvrier: 101, tache_id: 't_eff', domaine_id: 'dom_d2', serre_id: 'serre_1,serre_2', serre_nom: 'Serre 1, Serre 2', date: dateIso, timestamp: 10 },
  // o2 Récolte en D2 (Serre 1 + Serre 2) -> 50 caisses total (< 80), serres D002S1, D002S2
  { id: 'a2', company_id: 'cie', ouvrier_id: 'o2', numero_ouvrier: 102, tache_id: 't_rec', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', date: dateIso, timestamp: 11 },
  // o3 possède DEUX affectations dans la journée : Traitement D3 (S16 -> D003S16) + Standard Effeuillage en D5 (S23 -> D005S23)
  { id: 'a3', company_id: 'cie', ouvrier_id: 'o3', numero_ouvrier: 103, tache_id: 't_phy', domaine_id: 'dom_d3', serre_id: 'serre_16', serre_nom: 'SERRE 16', date: dateIso, timestamp: 12 },
  { id: 'a4', company_id: 'cie', ouvrier_id: 'o3', numero_ouvrier: 103, tache_id: 't_eff', domaine_id: 'dom_d5', serre_id: 'serre_d5_23', serre_nom: 'SERRE 23', date: dateIso, timestamp: 13 },
];

const recoltes: RecolteEntry[] = [
  { id: 'r1', company_id: 'cie', date: dateIso, type_operation: 'RECOLTE', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'o2', numero_ouvrier: 102, nom_ouvrier: 'FATIMA ZAHRA', caisses: 30, created_by_id: 'c1', created_by_nom: 'Brahim', created_at: '' },
  { id: 'r2', company_id: 'cie', date: dateIso, type_operation: 'RECOLTE', domaine_id: 'dom_d2', serre_id: 'serre_2', serre_nom: 'Serre 2', ouvrier_id: 'o2', numero_ouvrier: 102, nom_ouvrier: 'FATIMA ZAHRA', caisses: 20, created_by_id: 'c1', created_by_nom: 'Brahim', created_at: '' },
];

// A. Vérifier d'abord que sans heures D3 et avec o5 sans tâche, la validation bloque bien
const initialPreview = buildDailyRemunerationRows({
  dateIso,
  domaineFilter: 'ALL',
  ouvriers,
  taches,
  domaines: [domD2, domD3, domD5],
  serres,
  pointages,
  affectations,
  recoltes,
});

assert.equal(initialPreview.canExportWithoutError, false, 'Export doit être bloqué si D3 sans heures ou affectation sans tâche');
assert.equal(initialPreview.rows.some((r) => r.ouvrierId === 104), false, 'Ouvrier absent #104 ne doit jamais être présent');
assert.equal(initialPreview.validationIssues.length, 2, '2 anomalies attendues (o3 D3 sans heures + o5 sans tâche)');

// Vérifier les codes ouvriers, DT normalisés D00X et codes serres D00XSY
const rowO1 = initialPreview.rows.find((r) => r.ouvrierId === 101)!;
assert.equal(rowO1.DT, 'D002');
assert.equal(rowO1.serreId, 'D002S1, D002S2');
assert.equal(rowO1.uniteMetrique, 'HEURE');
assert.equal(rowO1.quantite, 8);
assert.equal(rowO1.dureeRep, 1);
assert.equal(rowO1.tarifExcep, TARIF_STANDARD_HEURE);
assert.equal(rowO1.remuneration, 95);

const rowO2 = initialPreview.rows.find((r) => r.ouvrierId === 102)!;
assert.equal(rowO2.DT, 'D002');
assert.equal(rowO2.uniteMetrique, 'PLATEAUX');
assert.equal(rowO2.quantite, 50);
assert.equal(rowO2.tarifExcep, TARIF_RECOLTE_PLATEAU);
assert.equal(rowO2.remuneration, 59.375);
assert.equal(rowO2.serreId, 'D002S1, D002S2');

const o3Rows = initialPreview.rows.filter((r) => r.ouvrierId === 103);
assert.equal(o3Rows.length, 2, 'Multi-affectations incompatibles de #103 (Traitement D3 + Effeuillage D5) conservées séparément');
const rowO3D3Init = o3Rows.find((r) => r.DT === 'D003')!;
const rowO3D5Init = o3Rows.find((r) => r.DT === 'D005')!;
assert.equal(rowO3D3Init.serreId, 'D003S16');
assert.equal(rowO3D5Init.serreId, 'D005S23');

// B. Vérifier que les données originales de l'application n'ont PAS été modifiées (règle "export Excel uniquement")
assert.equal(domD2.nom, 'D2');
assert.equal(domD3.nom, 'D3');
assert.equal(domD5.nom, 'D5');
assert.equal(serres[1].code, 'S02');
assert.equal(serres[1].nom, 'Serre 2');
assert.equal(serres[2].code, 'S16');
assert.equal(serres[3].code, 'D5-S23');

// C. Vérifier la détection d'incohérence Domaine/Serre dans buildDailyRemunerationRows (ex: serre_16 de D3 assignée sur dom_d2)
const badAffs: AffectationTache[] = [
  { id: 'bad_a1', company_id: 'cie', ouvrier_id: 'o1', numero_ouvrier: 101, tache_id: 't_eff', domaine_id: 'dom_d2', serre_id: 'serre_16', serre_nom: 'SERRE 16', date: dateIso, timestamp: 15 },
];
const mismatchPreview = buildDailyRemunerationRows({
  dateIso,
  domaineFilter: 'dom_d2',
  ouvriers: [ouvriers[0]],
  taches,
  domaines: [domD2, domD3, domD5],
  serres,
  pointages: [pointages[0]],
  affectations: badAffs,
  recoltes: [],
});
assert.equal(mismatchPreview.canExportWithoutError, false, 'Une serre D003 sur D002 doit bloquer l\'export');
assert.ok(mismatchPreview.rows[0].validationErrors.some((e) => e.includes('D003S16') && e.includes('D003')));

// D. Appliquer les ajustements admin (5H sur Traitement D3 de o3, Standard 8H confirmé pour o5)
const rowO5 = initialPreview.rows.find((r) => r.ouvrierId === 105)!;

const resolvedPreview = buildDailyRemunerationRows({
  dateIso,
  domaineFilter: 'ALL',
  ouvriers,
  taches,
  domaines: [domD2, domD3, domD5],
  serres,
  pointages,
  affectations,
  recoltes,
  overrides: {
    [rowO3D3Init.rowKey]: { quantite: 5 },
    [rowO5.rowKey]: { categorie: 'STANDARD' },
  },
});

assert.equal(resolvedPreview.canExportWithoutError, true, 'Toutes les validations résolues => prêt à exporter');
assert.equal(resolvedPreview.validationIssues.length, 0);

// Vérifier total ouvrier #103 : 5*16 (80) + 8*11.875 (95) = 175 DH
const totalO3 = resolvedPreview.totalByWorker.find((w) => w.ouvrierId === 103)!;
assert.equal(totalO3.totalDH, 175, 'Total ouvrier #103 (Traitement D3 5H=80 + Standard D5 8H=95) doit égaler 175 DH');

// Vérifier total général : o1(95) + o2(59.375) + o3(80+95) + o5(95) = 424.375 DH
assert.equal(resolvedPreview.grandTotalDH, 424.375, 'Total général attendu = 424,375 DH');
console.log('[OK] 4. Groupement multi-affectations, exclusion absents, conservation codes/serres et préservation des données source validés.');

// ---------------------------------------------------------------------------
// 5. VÉRIFICATION MODÈLE EXCEL 21 COLONNES & FEUILLE "Pointage" (ROUND-TRIP XLSX)
// ---------------------------------------------------------------------------
const wb = buildRemunerationWorkbook(resolvedPreview.rows);
assert.deepEqual(wb.SheetNames, [REMUNERATION_SHEET_NAME], 'La feuille Excel doit s\'appeler exactement "Pointage"');

const binary = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const parsedWb = XLSX.read(binary, { type: 'buffer' });
const sheet = parsedWb.Sheets['Pointage'];
assert.ok(sheet, 'Feuille "Pointage" lisible après génération');

const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
assert.equal(matrix[0].length, 21, 'Exactement 21 colonnes requises');
assert.deepEqual(matrix[0], [...REMUNERATION_EXCEL_COLUMNS], 'Ordre exact des 21 colonnes vérifié');
assert.equal(matrix.length, resolvedPreview.rows.length + 1, 'Nombre de lignes exact (en-tête + données)');

// Vérifier les valeurs exactes des colonnes DT (index 4) et serreId (index 5) dans le fichier Excel relu
const dataRows = matrix.slice(1);
const excelRowO1 = dataRows.find((r) => r[2] === 101)!;
assert.equal(excelRowO1[4], 'D002');
assert.equal(excelRowO1[5], 'D002S1, D002S2');

const excelRowO3D3 = dataRows.find((r) => r[2] === 103 && r[4] === 'D003')!;
assert.equal(excelRowO3D3[5], 'D003S16');

const excelRowO3D5 = dataRows.find((r) => r[2] === 103 && r[4] === 'D005')!;
assert.equal(excelRowO3D5[5], 'D005S23');

// Vérifier qu'aucun code D2/D3/D5 nu n'apparaît dans DT
for (const r of dataRows) {
  assert.match(String(r[4]), /^D\d{3}$/, `DT doit être au format D00X (reçu: ${r[4]})`);
}

const d2Filename = getRemunerationExportFilename('2026-11-15', 'dom_d2', [domD2, domD3, domD5]);
assert.equal(d2Filename, 'D002_2026-11-15_BROUILLON.xlsx', 'Format du nom de fichier conforme au modèle D002_2026-11-15_BROUILLON');
console.log('[OK] 5. Round-trip Excel (.xlsx) validé : feuille "Pointage", DT=D00X, serreId=D00XSY, 21 colonnes exactes.');
console.log('=== TOUS LES TESTS EXPORT RÉMUNÉRATION SONT VALIDÉS (100% PASS) ===');
