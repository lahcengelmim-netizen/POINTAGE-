/**
 * Tests obligatoires et vérifications complètes — EXPORT & IMPORT RÉMUNÉRATION JOURNALIÈRE
 * Exécution : npx tsx tests/remuneration-export.test.ts
 */

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  DEFAULT_ALL_SERRES_LABEL,
  DEFAULT_RUBAN_LABEL,
  REMUNERATION_EXCEL_COLUMNS,
  REMUNERATION_SHEET_NAME,
  TARIF_EBOURGEONNAGE_D5_FORFAIT,
  TARIF_RECOLTE_CERISE,
  TARIF_RECOLTE_RONDE,
  TARIF_STANDARD_HEURE,
  TARIF_TRAITEMENT_D3_HEURE,
  buildDailyRemunerationRows,
  buildRemunerationWorkbook,
  calculateEbourgeonnageD5Remuneration,
  calculateRecolteCeriseRemuneration,
  calculateRecolteRemuneration,
  calculateStandardRemuneration,
  calculateTraitementD3Remuneration,
  classifyRemunerationWorkType,
  computeEffectiveHours,
  formatDomaineDT,
  formatOuvrierIdForExport,
  formatSerreCodeForExport,
  getDureeRepForSchedule,
  getRemunerationExportFilename,
  parseRemunerationWorkbook,
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

console.log('=== TESTS OBLIGATOIRES TABLEAU DE RÉMUNÉRATION (RÈGLES 1 À 12) ===');

// ---------------------------------------------------------------------------
// 1. FORMULES DE CALCUL & DURÉES DE PAUSE (RÈGLES 5, 6, 7, 8, 9, 12)
// ---------------------------------------------------------------------------
assert.equal(getDureeRepForSchedule('07:00', '16:00'), 1, '07:00 à 16:00 => dureeRep = 1');
assert.equal(getDureeRepForSchedule('07:00', '14:00'), 0, '07:00 à 14:00 => dureeRep = 0');
assert.equal(computeEffectiveHours('07:00', '16:00', 1), 8, '07:00-16:00 avec 1h pause doit donner 8h');
assert.equal(computeEffectiveHours('07:00', '14:00', 0), 7, '07:00-14:00 avec 0h pause doit donner 7h');
assert.equal(calculateStandardRemuneration(8), 95, 'Standard 8H × 11,875 doit égaler 95 DH');
assert.equal(calculateStandardRemuneration(7), 83.125, 'Standard 7H × 11,875 doit égaler 83,125 DH');

// Récolte Ronde (1.1875 DH/caisse)
assert.equal(calculateRecolteRemuneration(80), 95, 'Récolte Ronde 80 × 1,1875 = 95 DH');
assert.equal(calculateRecolteRemuneration(70), 83.125, 'Récolte Ronde 70 × 1,1875 = 83,125 DH');
assert.equal(calculateRecolteRemuneration(50), 59.375, 'Récolte Ronde 50 × 1,1875 = 59,375 DH');
assert.equal(calculateRecolteRemuneration(100), 118.75, 'Récolte Ronde 100 × 1,1875 = 118,75 DH');

// Récolte Cerise (3.8 DH/caisse)
assert.equal(calculateRecolteCeriseRemuneration(10), 38, 'Récolte Cerise 10 × 3,8 = 38 DH');
assert.equal(calculateRecolteCeriseRemuneration(25), 95, 'Récolte Cerise 25 × 3,8 = 95 DH');

// TTT D3 (16 DH/h)
assert.equal(calculateTraitementD3Remuneration(5), 80, 'TTT D3 5H × 16 = 80 DH');
assert.equal(calculateTraitementD3Remuneration(7), 112, 'TTT D3 7H × 16 = 112 DH');
assert.equal(calculateTraitementD3Remuneration(9), 144, 'TTT D3 9H × 16 = 144 DH');

// Ébourgeonnage D5 (150 DH forfait, unite = 1)
assert.equal(calculateEbourgeonnageD5Remuneration(1), 150, 'Ébourgeonnage D5 forfait (unite=1) = 150 DH');

console.log('[OK] 1. Formules tarifaires et durées de pause (07-16h=>1, 07-14h=>0) validées.');

// ---------------------------------------------------------------------------
// 2. FORMAT OUVRIER ID & IDENTIFICATION AUTOMATIQUE (RÈGLES 1, 6, 7, 8, 9)
// ---------------------------------------------------------------------------
assert.equal(formatOuvrierIdForExport(1, 'D2'), '1-D2');
assert.equal(formatOuvrierIdForExport(55, 'D3'), '55-D3');
assert.equal(formatOuvrierIdForExport(120, 'D5'), '120-D5');

const domD1: Domaine = { id: 'dom_d1', nom: 'D1', ordre: 4 };
const domD2: Domaine = { id: 'dom_d2', nom: 'D2', ordre: 1 };
const domD3: Domaine = { id: 'dom_d3', nom: 'D3', ordre: 2 };
const domD4: Domaine = { id: 'dom_d4', nom: 'D4', ordre: 5 };
const domD5: Domaine = { id: 'dom_d5', nom: 'D5', ordre: 3 };

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_eff', code: 'E01', nom: 'EFFEUILLAGE' },
    domaine: domD3,
  }).categorie,
  'STANDARD'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_rec', code: 'R01', nom: 'RECOLTE RONDE' },
    domaine: domD3,
  }).categorie,
  'RECOLTE'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_cer', code: 'RC01', nom: 'RECOLTE CERISE' },
    domaine: domD2,
  }).categorie,
  'RECOLTE_CERISE'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_ttt', code: 'TTT', nom: 'TTT' },
    domaine: domD3,
  }).categorie,
  'TRAITEMENT_D3'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_eb', code: 'EB01', nom: 'ÉBOURGEONNAGE' },
    domaine: domD5,
  }).categorie,
  'EBOURGEONNAGE_D5'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: { id: 't_phy', code: 'PHY01', nom: 'TRAITEMENT PHYTO' },
    domaine: domD2,
  }).categorie,
  'INCERTAIN'
);

assert.equal(
  classifyRemunerationWorkType({
    tache: null,
    domaine: domD3,
  }).categorie,
  'INCERTAIN'
);

console.log('[OK] 2. Formats ouvrierId (1-D2, 55-D3, 120-D5) et classifications validés.');

// ---------------------------------------------------------------------------
// 3. NORMALISATION DOMAINE (D00X) & SERRES (D00XSY)
// ---------------------------------------------------------------------------
assert.equal(formatDomaineDT(domD1.nom, domD1.id), 'D001');
assert.equal(formatDomaineDT(domD2.nom, domD2.id), 'D002');
assert.equal(formatDomaineDT(domD3.nom, domD3.id), 'D003');
assert.equal(formatDomaineDT(domD4.nom, domD4.id), 'D004');
assert.equal(formatDomaineDT(domD5.nom, domD5.id), 'D005');

const s1Obj: Serre = { id: 'serre_1', company_id: 'cie', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' };
const s2Obj: Serre = { id: 'serre_2', company_id: 'cie', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' };
const s3Obj: Serre = { id: 'serre_3', company_id: 'cie', code: 'S03', nom: 'Serre 3', actif: true, ordre: 3, domaine_id: 'dom_d2' };
const s5Obj: Serre = { id: 'serre_5', company_id: 'cie', code: 'S05', nom: 'Serre 5', actif: true, ordre: 5, domaine_id: 'dom_d2' };
const s16Obj: Serre = { id: 'serre_16', company_id: 'cie', code: 'S16', nom: 'SERRE 16', actif: true, ordre: 16, domaine_id: 'dom_d3' };
const s23Obj: Serre = { id: 'serre_d5_23', company_id: 'cie', code: 'D5-S23', nom: 'SERRE 23', actif: true, ordre: 23, domaine_id: 'dom_d5' };

assert.equal(formatSerreCodeForExport({ rawSerre: 'Serre 2', serreObj: s2Obj, rowDomaineDT: 'D002' }).code, 'D002S2');
assert.equal(formatSerreCodeForExport({ rawSerre: 'SERRE 16', serreObj: s16Obj, rowDomaineDT: 'D003' }).code, 'D003S16');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D5-S23', serreObj: s23Obj, rowDomaineDT: 'D005' }).code, 'D005S23');
assert.equal(formatSerreCodeForExport({ rawSerre: 'D002S2', serreObj: s2Obj, rowDomaineDT: 'D002' }).code, 'D002S2');

const mismatch16InD2 = formatSerreCodeForExport({ rawSerre: 'SERRE 16', serreObj: s16Obj, rowDomaineDT: 'D002' });
assert.ok(mismatch16InD2.mismatchError, 'Incohérence Serre/Domaine détectée');
console.log('[OK] 3. Normalisation D00X & D00XSY validée.');

// ---------------------------------------------------------------------------
// 4. INTÉGRATION COMPLÈTE DES 12 RÈGLES DANS buildDailyRemunerationRows
// ---------------------------------------------------------------------------
const dateIso = '2026-11-15';
const ouvriers: Ouvrier[] = [
  { id: 'o1', company_id: 'cie', numero: 1, nom: 'ALI BENNANI', actif: true, createdAt: '' },
  { id: 'o2', company_id: 'cie', numero: 2, nom: 'NADIA EL FASSI', actif: true, createdAt: '' },
  { id: 'o102', company_id: 'cie', numero: 102, nom: 'FATIMA ZAHRA', actif: true, createdAt: '' },
  { id: 'o106', company_id: 'cie', numero: 106, nom: 'SAMIRA CERISE', actif: true, createdAt: '' },
  { id: 'o55', company_id: 'cie', numero: 55, nom: 'HASSAN ALAOUI', actif: true, createdAt: '' },
  { id: 'o120', company_id: 'cie', numero: 120, nom: 'OMAR NACIRI', actif: true, createdAt: '' },
  { id: 'o104', company_id: 'cie', numero: 104, nom: 'ABSENT TEST', actif: true, createdAt: '' },
  { id: 'o105', company_id: 'cie', numero: 105, nom: 'SANS TACHE D3', actif: true, createdAt: '' },
];

const taches: Tache[] = [
  { id: 't_eff', company_id: 'cie', code: 'E01', nom: 'EFFEUILLAGE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_rec', company_id: 'cie', code: 'R01', nom: 'RECOLTE RONDE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_cer', company_id: 'cie', code: 'RC01', nom: 'RECOLTE CERISE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_ttt', company_id: 'cie', code: 'TTT', nom: 'TTT', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 't_eb', company_id: 'cie', code: 'EB01', nom: 'ÉBOURGEONNAGE', ouvriers_autorises: 'tous', createdAt: '' },
];

const serres: Serre[] = [s1Obj, s2Obj, s3Obj, s5Obj, s16Obj, s23Obj];

const pointages: Pointage[] = [
  { id: 'p1', company_id: 'cie', ouvrier_id: 'o1', numero_ouvrier: 1, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 1 },
  { id: 'p2', company_id: 'cie', ouvrier_id: 'o2', numero_ouvrier: 2, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 2 },
  { id: 'p102', company_id: 'cie', ouvrier_id: 'o102', numero_ouvrier: 102, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 3 },
  { id: 'p106', company_id: 'cie', ouvrier_id: 'o106', numero_ouvrier: 106, date: dateIso, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 4 },
  { id: 'p55', company_id: 'cie', ouvrier_id: 'o55', numero_ouvrier: 55, date: dateIso, present: true, domaine_id: 'dom_d3', heure: '07:00:00', timestamp: 5 },
  { id: 'p120', company_id: 'cie', ouvrier_id: 'o120', numero_ouvrier: 120, date: dateIso, present: true, domaine_id: 'dom_d5', heure: '07:00:00', timestamp: 6 },
  // Absent -> ne doit pas apparaître
  { id: 'p104', company_id: 'cie', ouvrier_id: 'o104', numero_ouvrier: 104, date: dateIso, present: false, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 7 },
  // Sans tâche -> anomalie bloquante avant résolution
  { id: 'p105', company_id: 'cie', ouvrier_id: 'o105', numero_ouvrier: 105, date: dateIso, present: true, domaine_id: 'dom_d3', heure: '07:00:00', timestamp: 8 },
];

const affectations: AffectationTache[] = [
  // 1-D2 : serres multiples S1, S3, S5 -> D002S1+D002S3+D002S5
  { id: 'a1', company_id: 'cie', ouvrier_id: 'o1', numero_ouvrier: 1, tache_id: 't_eff', domaine_id: 'dom_d2', serres_ids: ['serre_1', 'serre_3', 'serre_5'], date: dateIso, timestamp: 10 },
  // 2-D2 : aucune serre affectée manuellement -> "Toutes les serres"
  { id: 'a2', company_id: 'cie', ouvrier_id: 'o2', numero_ouvrier: 2, tache_id: 't_eff', domaine_id: 'dom_d2', serre_id: null, serre_nom: null, date: dateIso, timestamp: 11 },
  // 102-D2 : Récolte Ronde (S1 + S2 -> D002S1+D002S2)
  { id: 'a102', company_id: 'cie', ouvrier_id: 'o102', numero_ouvrier: 102, tache_id: 't_rec', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', date: dateIso, timestamp: 12 },
  // 106-D2 : Récolte Cerise (S1 -> D002S1)
  { id: 'a106', company_id: 'cie', ouvrier_id: 'o106', numero_ouvrier: 106, tache_id: 't_cer', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', date: dateIso, timestamp: 13 },
  // 55-D3 : TTT D3 + Effeuillage D5 (multi-affectation)
  { id: 'a55_d3', company_id: 'cie', ouvrier_id: 'o55', numero_ouvrier: 55, tache_id: 't_ttt', domaine_id: 'dom_d3', serre_id: 'serre_16', serre_nom: 'SERRE 16', date: dateIso, timestamp: 14 },
  { id: 'a55_d5', company_id: 'cie', ouvrier_id: 'o55', numero_ouvrier: 55, tache_id: 't_eff', domaine_id: 'dom_d5', serre_id: 'serre_d5_23', serre_nom: 'SERRE 23', date: dateIso, timestamp: 15 },
  // 120-D5 : Ébourgeonnage D5 (forfait 150 DH, unite = 1)
  { id: 'a120', company_id: 'cie', ouvrier_id: 'o120', numero_ouvrier: 120, tache_id: 't_eb', domaine_id: 'dom_d5', serre_id: 'serre_d5_23', serre_nom: 'SERRE 23', date: dateIso, timestamp: 16 },
];

const recoltes: RecolteEntry[] = [
  { id: 'r1', company_id: 'cie', date: dateIso, type_operation: 'RECOLTE', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'o102', numero_ouvrier: 102, nom_ouvrier: 'FATIMA ZAHRA', caisses: 30, created_by_id: 'c1', created_by_nom: 'Brahim', created_at: '' },
  { id: 'r2', company_id: 'cie', date: dateIso, type_operation: 'RECOLTE', domaine_id: 'dom_d2', serre_id: 'serre_2', serre_nom: 'Serre 2', ouvrier_id: 'o102', numero_ouvrier: 102, nom_ouvrier: 'FATIMA ZAHRA', caisses: 20, created_by_id: 'c1', created_by_nom: 'Brahim', created_at: '' },
  { id: 'r3', company_id: 'cie', date: dateIso, type_operation: 'RECOLTE', domaine_id: 'dom_d2', serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'o106', numero_ouvrier: 106, nom_ouvrier: 'SAMIRA CERISE', caisses: 25, created_by_id: 'c1', created_by_nom: 'Brahim', created_at: '' },
];

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

assert.equal(initialPreview.canExportWithoutError, false, 'Export bloqué tant que TTT D3 sans heures et o105 sans tâche');
assert.equal(initialPreview.rows.some((r) => String(r.ouvrierId).startsWith('104-')), false, 'Absent #104 exclu');
assert.equal(initialPreview.validationIssues.length, 2, '2 anomalies attendues (55-D3 TTT sans heures + 105-D3 sans tâche)');

// Vérification Règle 1, 2, 3, 4, 5, 9, 10, 11, 12 sur 1-D2
const row1D2 = initialPreview.rows.find((r) => r.ouvrierId === '1-D2')!;
assert.ok(row1D2, 'ouvrierId doit être 1-D2');
assert.equal(row1D2.DT, 'D002');
assert.equal(row1D2.serreId, 'D002S1+D002S3+D002S5', 'Serres multiples sans espaces autour de +');
assert.equal(row1D2.rubanId, DEFAULT_RUBAN_LABEL, 'Ruban doit toujours être "Tous les Rubans"');
assert.equal(row1D2.heureDeb, '07:00');
assert.equal(row1D2.heureFin, '16:00');
assert.equal(row1D2.dureeRep, 1);
assert.equal(row1D2.quantite, null, 'Colonne quantite doit rester vide');
assert.equal(row1D2.quantiteMetrique, null, 'qteMetrique doit être vide pour le travail au temps');
assert.equal(row1D2.unite, null, 'unite doit être vide pour les travaux non rémunérés à l\'unité');
assert.equal(row1D2.tarifExcep, TARIF_STANDARD_HEURE);
assert.equal(row1D2.remuneration, 95);

// Vérification Règle 4 : ouvrier sans serre -> "Toutes les serres"
const row2D2 = initialPreview.rows.find((r) => r.ouvrierId === '2-D2')!;
assert.equal(row2D2.serreId, DEFAULT_ALL_SERRES_LABEL, 'Sans serre affectée => "Toutes les serres"');
assert.equal(row2D2.rubanId, DEFAULT_RUBAN_LABEL);
assert.equal(row2D2.unite, null);
assert.equal(row2D2.quantite, null);
assert.equal(row2D2.quantiteMetrique, null);

// Vérification Règle 7 : Récolte Ronde (1,1875 DH)
const row102D2 = initialPreview.rows.find((r) => r.ouvrierId === '102-D2')!;
assert.equal(row102D2.serreId, 'D002S1+D002S2');
assert.equal(row102D2.rubanId, DEFAULT_RUBAN_LABEL);
assert.equal(row102D2.uniteMetrique, 'PLATEAUX');
assert.equal(row102D2.quantiteMetrique, 50, 'Récolte stocke les caisses dans quantiteMetrique');
assert.equal(row102D2.quantite, null, 'Colonne quantite doit rester vide pour Récolte');
assert.equal(row102D2.unite, null, 'Récolte : ne pas remplir unite');
assert.equal(row102D2.tarifExcep, TARIF_RECOLTE_RONDE);
assert.equal(row102D2.remuneration, 59.375);

// Vérification Règle 6 : Récolte Cerise (3,8 DH)
const row106D2 = initialPreview.rows.find((r) => r.ouvrierId === '106-D2')!;
assert.equal(row106D2.effectiveCategorie, 'RECOLTE_CERISE');
assert.equal(row106D2.uniteMetrique, 'PLATEAUX');
assert.equal(row106D2.quantiteMetrique, 25);
assert.equal(row106D2.quantite, null);
assert.equal(row106D2.unite, null, 'Récolte Cerise : ne pas remplir unite');
assert.equal(row106D2.tarifExcep, TARIF_RECOLTE_CERISE);
assert.equal(row106D2.remuneration, 95);

// Vérification Règle 9 : Ébourgeonnage D5 (unite = 1, tarifExcep = 150, mode = forfait)
const row120D5 = initialPreview.rows.find((r) => r.ouvrierId === '120-D5')!;
assert.equal(row120D5.effectiveCategorie, 'EBOURGEONNAGE_D5');
assert.equal(row120D5.modeRemuneration, 'forfait');
assert.equal(row120D5.uniteMetrique, 'FORFAIT');
assert.equal(row120D5.unite, 1);
assert.equal(row120D5.tarifExcep, TARIF_EBOURGEONNAGE_D5_FORFAIT);
assert.equal(row120D5.remuneration, 150);
assert.equal(row120D5.quantiteMetrique, null);
assert.equal(row120D5.quantite, null);

// Vérification Règles 8, 12 + résolution des overrides
const row55D3 = initialPreview.rows.find((r) => r.ouvrierId === '55-D3')!;
const row55D5 = initialPreview.rows.find((r) => r.ouvrierId === '55-D5')!;
const row105D3 = initialPreview.rows.find((r) => r.ouvrierId === '105-D3')!;
assert.equal(row55D3.serreId, 'D003S16');
assert.equal(row55D5.serreId, 'D005S23');

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
    // 2-D2 passe en horaire 07:00 à 14:00 -> dureeRep doit devenir 0, 7h = 83.125 DH
    [row2D2.rowKey]: { heureDeb: '07:00', heureFin: '14:00', quantite: 7 },
    // 55-D3 TTT 5H -> 80 DH, unite = null, quantiteMetrique = null
    [row55D3.rowKey]: { quantite: 5 },
    // 105-D3 confirmé en travail à l'unité (12 unités × 10 DH = 120 DH)
    [row105D3.rowKey]: { categorie: 'UNITE', unite: 12, tarifExcep: 10 },
  },
});

assert.equal(resolvedPreview.canExportWithoutError, true, 'Toutes les validations résolues => prêt à exporter');
assert.equal(resolvedPreview.validationIssues.length, 0);

const resolved2D2 = resolvedPreview.rows.find((r) => r.ouvrierId === '2-D2')!;
assert.equal(resolved2D2.dureeRep, 0, '07:00 à 14:00 => dureeRep = 0');
assert.equal(resolved2D2.remuneration, 83.125);
assert.equal(resolved2D2.quantite, null);
assert.equal(resolved2D2.quantiteMetrique, null);

const resolved55D3 = resolvedPreview.rows.find((r) => r.ouvrierId === '55-D3')!;
assert.equal(resolved55D3.tarifExcep, TARIF_TRAITEMENT_D3_HEURE);
assert.equal(resolved55D3.remuneration, 80);
assert.equal(resolved55D3.unite, null, 'TTT : ne pas remplir unite');
assert.equal(resolved55D3.quantiteMetrique, null, 'TTT : ne pas remplir qteMetrique');
assert.equal(resolved55D3.quantite, null, 'Colonne quantite doit rester vide');

const resolved105D3 = resolvedPreview.rows.find((r) => r.ouvrierId === '105-D3')!;
assert.equal(resolved105D3.modeRemuneration, 'unite');
assert.equal(resolved105D3.unite, 12, 'Travail à l\'unité renseigne unite selon données réelles');
assert.equal(resolved105D3.tarifExcep, 10);
assert.equal(resolved105D3.remuneration, 120);
assert.equal(resolved105D3.quantiteMetrique, null);
assert.equal(resolved105D3.quantite, null);

// Préservation des données originales de l'application
assert.equal(domD2.nom, 'D2');
assert.equal(domD3.nom, 'D3');
assert.equal(domD5.nom, 'D5');
assert.equal(serres[1].code, 'S02');
assert.equal(serres[1].nom, 'Serre 2');

console.log('[OK] 4. Toutes les règles (1-12) vérifiées sur buildDailyRemunerationRows sans altérer les données source.');

// ---------------------------------------------------------------------------
// 5. ROUND-TRIP EXCEL EXPORT & IMPORT/CONTRÔLE (RÈGLES 1 À 12)
// ---------------------------------------------------------------------------
const wb = buildRemunerationWorkbook(resolvedPreview.rows);
assert.deepEqual(wb.SheetNames, [REMUNERATION_SHEET_NAME], 'La feuille Excel doit s\'appeler "Pointage"');

const binary = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const parsedWb = XLSX.read(binary, { type: 'buffer' });
const sheet = parsedWb.Sheets[REMUNERATION_SHEET_NAME];
const matrix = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1 });
assert.equal(matrix[0].length, 21);
assert.deepEqual(matrix[0], [...REMUNERATION_EXCEL_COLUMNS]);

// Vérifier que la colonne `quantite` (index 12) est bien vide dans chaque ligne du fichier Excel
for (const excelRow of matrix.slice(1)) {
  assert.equal(excelRow[12] ?? '', '', 'La colonne quantite (col 13) doit être vide dans le fichier Excel');
  assert.equal(excelRow[6], DEFAULT_RUBAN_LABEL, 'La colonne rubanId (col 7) doit toujours être "Tous les Rubans"');
  assert.match(String(excelRow[2]), /^\d+-D\d+$/, 'ouvrierId Excel doit être au format NUMERO-DOMAINE');
}

// Import et validation automatique via parseRemunerationWorkbook
const importValid = parseRemunerationWorkbook(parsedWb);
assert.equal(importValid.success, true, `Import Excel doit réussir sans erreur (erreurs: ${importValid.errors.join(' | ')})`);
assert.equal(importValid.validRowsCount, resolvedPreview.rows.length);
assert.equal(importValid.errorRowsCount, 0);

const imp1D2 = importValid.rows.find((r) => r.ouvrierId === '1-D2')!;
assert.equal(imp1D2.serreId, 'D002S1+D002S3+D002S5');
assert.equal(imp1D2.dureeRep, 1);
assert.equal(imp1D2.remuneration, 95);
assert.equal(imp1D2.quantite, null);
assert.equal(imp1D2.quantiteMetrique, null);

const imp120D5 = importValid.rows.find((r) => r.ouvrierId === '120-D5')!;
assert.equal(imp120D5.modeRemuneration, 'forfait');
assert.equal(imp120D5.unite, 1);
assert.equal(imp120D5.tarifExcep, 150);

const imp105D3 = importValid.rows.find((r) => r.ouvrierId === '105-D3')!;
assert.equal(imp105D3.modeRemuneration, 'unite');
assert.equal(imp105D3.unite, 12);

// Tests négatifs sur l'import Excel : vérification que toute violation est bloquée
const badMatrix: (string | number)[][] = [
  [...REMUNERATION_EXCEL_COLUMNS],
  [
    'D002_2026-11-15_1_1',
    '2026-11-15',
    '1', // Erreur Règle 1: manque -D2
    'ALI BENNANI',
    'D002',
    'D002S1 + D002S3', // Erreur Règle 2: espaces autour de +
    'Ruban Rouge', // Erreur Règle 3: pas "Tous les Rubans"
    '',
    'E01',
    'EFFEUILLAGE',
    'HEURE',
    8, // Erreur Règle 10: qteMetrique rempli pour travail au temps
    8, // Erreur Règle 11: quantite non vide
    '07:00',
    '16:00',
    0, // Erreur Règle 12: 07:00-16:00 doit avoir dureeRep = 1
    'JOURNEE',
    'BROUILLON',
    '',
    TARIF_STANDARD_HEURE,
    95,
  ],
];
const badWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(badWb, XLSX.utils.aoa_to_sheet(badMatrix), REMUNERATION_SHEET_NAME);
const importInvalid = parseRemunerationWorkbook(badWb);
assert.equal(importInvalid.success, false, 'Un fichier non conforme aux règles doit être rejeté');
assert.equal(importInvalid.errorRowsCount, 1);
assert.ok(importInvalid.errors.length >= 6, 'Doit remonter toutes les violations (ouvrierId, serreId, rubanId, quantite, quantiteMetrique, dureeRep)');

const d2Filename = getRemunerationExportFilename('2026-11-15', 'dom_d2', [domD2, domD3, domD5]);
assert.equal(d2Filename, 'D002_2026-11-15_BROUILLON.xlsx');

console.log('[OK] 5. Export + Import Excel (round-trip et contrôles négatifs) 100% validés.');
console.log('=== TOUS LES TESTS TABLEAU DE RÉMUNÉRATION SONT VALIDÉS (100% PASS) ===');
