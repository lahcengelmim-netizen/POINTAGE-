/**
 * Suite de tests isolés obligatoires : EXPORT PAIEMENT EXCEL (Phase 3)
 * Couvre :
 *  1. Journée normale (8h = 95 DH) & heures incomplètes (4h=47,50 ; 3h=35,625 ; 1h=11,875 ; 0,5h=5,9375 ; 7h=83,125)
 *  2. Stationnaire (100 DH, non cumulé) & Gardien (100 DH, non cumulé)
 *  3. Ébourgeonnage D5 (150 DH, non cumulé)
 *  4. TTT D2 (7 × 15 = 105 DH) & TTT D3 (6 × 16 = 96 DH)
 *  5. Récolte Cerise (25 × 3,8 = 95 DH) & Récolte Ronde (80 × 1,1875 = 95 DH)
 *  6. Récolte générique ambiguë : bloquée tant que la variété n'est pas sélectionnée explicitement
 *  7. Statut conservé exactement tel qu'existant (BROUILLON reste BROUILLON, VALIDÉE reste VALIDÉE, jamais exclu)
 *  8. quantiteMetrique strictement vide sur tout travail payé au temps ; quantite toujours vide
 *  9. Modèle Excel original (.xlsx) 21 colonnes obligatoire : blocage si absent, rejet si invalide,
 *     préservation fidèle des 21 colonnes, styles, largeurs, hauteurs & mise en page + feuille Totaux par Ouvrier
 * 10. Historique illimité (> 120 snapshots conservés), non-rétroactivité stricte & ré-export figé sans recalcul
 * 11. RBAC strict (Caporal / Caporal Contractuelles / Tariq bloqués) & détection explicite des erreurs Supabase
 * 12. Synchronisation multi-appareils simulée (aucun écrasement par défaut lors d'erreur Supabase)
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  AffectationTache,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
  UserAccount,
} from '../src/types';
import {
  PAIEMENT_POINTAGE_COLUMNS,
  PAIEMENT_SHEET_POINTAGE,
  PAIEMENT_SHEET_TOTAUX,
  buildPaiementRows,
  classifySupabaseLoadErrors,
  createDefaultPaiementTariffs,
  exportPaiementExcel,
  isAdminPaiementAuthorized,
  loadPaiementExportHistory,
  loadPaiementTariffs,
  reexportPaiementSnapshotExcel,
  savePaiementExportSnapshot,
  savePaiementTariffs,
  syncLoadPaiementTariffsFromSupabase,
} from '../src/utils/paiementExporter';

const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in memStore ? memStore[k] : null),
  setItem: (k: string, v: string) => {
    memStore[k] = String(v);
  },
  removeItem: (k: string) => {
    delete memStore[k];
  },
  clear: () => {
    Object.keys(memStore).forEach((k) => delete memStore[k]);
  },
};

async function buildStyledOriginalTemplateBuffer(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(PAIEMENT_SHEET_POINTAGE, {
    pageSetup: { orientation: 'landscape', paperSize: 9 },
  });
  const headerRow = ws.addRow([...PAIEMENT_POINTAGE_COLUMNS]);
  headerRow.height = 26;
  headerRow.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

  const sampleRow = ws.addRow([
    'D002_2026-11-16_1-D2_1',
    '2026-11-16',
    '1-D2',
    'EXEMPLE MODELE',
    'D002',
    'D002S1',
    'Tous les Rubans',
    'TOMATE',
    'INS01',
    'TRAVAIL NORMAL',
    'JOUR',
    '',
    '',
    '07:00',
    '16:00',
    1,
    'JOURNEE',
    'BROUILLON',
    '',
    95,
    95,
  ]);
  sampleRow.height = 21;
  sampleRow.getCell(4).font = { name: 'Calibri', size: 11, color: { argb: 'FF111827' } };
  sampleRow.getCell(20).numFmt = '#,##0.####';
  sampleRow.getCell(21).numFmt = '#,##0.00##';
  ws.getColumn(4).width = 29;
  ws.getColumn(10).width = 24;
  ws.autoFilter = 'A1:U2';

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const COMPANY_ID = 'cie_lahcen_pointeur';
const DATE_TEST = '2026-11-18';
const DATE_FUTUR = '2026-11-19';

const adminUser: UserAccount = {
  id: 'usr_admin',
  username: 'admin',
  nom: 'Lahcen (Admin)',
  role: 'admin',
  company_id: COMPANY_ID,
  actif: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const caporalUser: UserAccount = {
  id: 'usr_caporal',
  username: 'caporal1',
  nom: 'Brahim (Caporal)',
  role: 'caporal',
  company_id: COMPANY_ID,
  module_attribue: 'recolte',
  actif: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const caporalContractuellesUser: UserAccount = {
  id: 'usr_tariq',
  username: 'tariq',
  nom: 'Tariq (Contractuelles)',
  role: 'caporal_contractuelles',
  company_id: COMPANY_ID,
  module_attribue: 'contractuelles',
  actif: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const domaines: Domaine[] = [
  { id: 'dom_d1', nom: 'D1', ordre: 1 },
  { id: 'dom_d2', nom: 'D2', ordre: 2 },
  { id: 'dom_d3', nom: 'D3', ordre: 3 },
  { id: 'dom_d4', nom: 'D4', ordre: 4 },
  { id: 'dom_d5', nom: 'D5', ordre: 5 },
];

const serres: Serre[] = [
  { id: 'serre_1', company_id: COMPANY_ID, code: 'S01', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' },
  { id: 'serre_16', company_id: COMPANY_ID, code: 'S16', nom: 'SERRE 16', actif: true, ordre: 16, domaine_id: 'dom_d3' },
  { id: 'serre_d5_23', company_id: COMPANY_ID, code: 'D5-S23', nom: 'SERRE 23', actif: true, ordre: 23, domaine_id: 'dom_d5' },
];

const taches: Tache[] = [
  { id: 'tch_normal', company_id: COMPANY_ID, code: 'INS01', nom: 'TRAVAIL NORMAL', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_stationnaire', company_id: COMPANY_ID, code: 'STA01', nom: 'STATIONNAIRE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_gardien', company_id: COMPANY_ID, code: 'GAR01', nom: 'GARDIEN', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_ebourg_d5', company_id: COMPANY_ID, code: 'EBD05', nom: 'ÉBOURGEONNAGE D5', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_ttt_d2', company_id: COMPANY_ID, code: 'TTT02', nom: 'TTT D2', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_ttt_d3', company_id: COMPANY_ID, code: 'TTT03', nom: 'TTT D3', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_rec_cerise', company_id: COMPANY_ID, code: 'RC01', nom: 'RÉCOLTE CERISE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_rec_ronde', company_id: COMPANY_ID, code: 'RR01', nom: 'RÉCOLTE RONDE', ouvriers_autorises: 'tous', createdAt: '' },
  { id: 'tch_rec_generic', company_id: COMPANY_ID, code: 'R01', nom: 'RÉCOLTE', ouvriers_autorises: 'tous', createdAt: '' },
];

const ouvriers: Ouvrier[] = [
  { id: 'ouv_1', company_id: COMPANY_ID, numero: 1, nom: 'Ali Travail Normal', actif: true, createdAt: '' },
  { id: 'ouv_2', company_id: COMPANY_ID, numero: 2, nom: 'Hassan Heures Partiel', actif: true, createdAt: '' },
  { id: 'ouv_3', company_id: COMPANY_ID, numero: 3, nom: 'Karim Stationnaire', actif: true, createdAt: '' },
  { id: 'ouv_4', company_id: COMPANY_ID, numero: 4, nom: 'Said Gardien', actif: true, createdAt: '' },
  { id: 'ouv_5', company_id: COMPANY_ID, numero: 5, nom: 'Nadia Ebourgeonnage', actif: true, createdAt: '' },
  { id: 'ouv_6', company_id: COMPANY_ID, numero: 6, nom: 'Youssef TTT D2', actif: true, createdAt: '' },
  { id: 'ouv_7', company_id: COMPANY_ID, numero: 7, nom: 'Omar TTT D3', actif: true, createdAt: '' },
  { id: 'ouv_8', company_id: COMPANY_ID, numero: 8, nom: 'Fatima Cerise', actif: true, createdAt: '' },
  { id: 'ouv_9', company_id: COMPANY_ID, numero: 9, nom: 'Khadija Ronde', actif: true, createdAt: '' },
  { id: 'ouv_10', company_id: COMPANY_ID, numero: 10, nom: 'Brahim Absent', actif: true, createdAt: '' },
  { id: 'ouv_11', company_id: COMPANY_ID, numero: 11, nom: 'Mounir Recolte Generique', actif: true, createdAt: '' },
];

async function runTests() {
  localStorage.clear();
  const templateBuffer = await buildStyledOriginalTemplateBuffer();
  assert.equal(PAIEMENT_POINTAGE_COLUMNS.length, 21, 'Strictement 21 colonnes');

  // ---------------- TEST 1 : Journée normale 8h + Heures incomplètes exactes ----------------
  {
    const cases: Array<{ deb: string; fin: string; pause: number; expectedH: number; expectedDH: number }> = [
      { deb: '07:00', fin: '16:00', pause: 1, expectedH: 8, expectedDH: 95 },
      { deb: '07:00', fin: '14:00', pause: 0, expectedH: 7, expectedDH: 83.125 },
      { deb: '07:00', fin: '11:00', pause: 0, expectedH: 4, expectedDH: 47.5 },
      { deb: '07:00', fin: '10:00', pause: 0, expectedH: 3, expectedDH: 35.625 },
      { deb: '07:00', fin: '08:00', pause: 0, expectedH: 1, expectedDH: 11.875 },
      { deb: '07:00', fin: '07:30', pause: 0, expectedH: 0.5, expectedDH: 5.9375 },
    ];
    for (const c of cases) {
      const ptg: any = {
        id: `p_${c.expectedH}`,
        company_id: COMPANY_ID,
        ouvrier_id: 'ouv_1',
        numero_ouvrier: 1,
        date: DATE_TEST,
        present: true,
        tache_id: 'tch_normal',
        domaine_id: 'dom_d2',
        heure: '07:00:00',
        heure_debut: c.deb,
        heure_fin: c.fin,
        dureeRep: c.pause,
        timestamp: 100,
      };
      const res = buildPaiementRows({
        companyId: COMPANY_ID,
        dateIso: DATE_TEST,
        ouvriers,
        taches,
        domaines,
        serres,
        pointages: [ptg],
        affectations: [],
        recoltes: [],
      });
      assert.equal(res.rows[0].dureeTravaillee, c.expectedH);
      assert.equal(res.rows[0].remuneration, c.expectedDH);
      assert.equal(res.rows[0].quantiteMetrique, '', 'quantiteMetrique vide sur horaire');
      assert.equal(res.rows[0].quantite, '');
    }
    console.log('✓ Test 1 OK : Journée normale 8h=95 DH & prorata (4h=47,50 | 3h=35,625 | 1h=11,875 | 0,5h=5,9375 | 7h=83,125)');
  }

  // ---------------- TEST 2 : Stationnaire (100), Gardien (100), Ébourgeonnage D5 (150) ----------------
  {
    const pointages: Pointage[] = [
      { id: 'p3', company_id: COMPANY_ID, ouvrier_id: 'ouv_3', numero_ouvrier: 3, date: DATE_TEST, present: true, tache_id: 'tch_stationnaire', domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 102 },
      { id: 'p4', company_id: COMPANY_ID, ouvrier_id: 'ouv_4', numero_ouvrier: 4, date: DATE_TEST, present: true, tache_id: 'tch_gardien', domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 103 },
      { id: 'p5', company_id: COMPANY_ID, ouvrier_id: 'ouv_5', numero_ouvrier: 5, date: DATE_TEST, present: true, tache_id: 'tch_ebourg_d5', domaine_id: 'dom_d5', serre_id: 'serre_d5_23', heure: '07:00:00', timestamp: 104 },
    ];
    const res = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations: [],
      recoltes: [],
    });
    assert.equal(res.rows.length, 3);
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 3)!.remuneration, 100);
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 4)!.remuneration, 100);
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 5)!.remuneration, 150);
    res.rows.forEach((r) => assert.equal(r.quantiteMetrique, ''));
    assert.equal(res.grandTotalDH, 350);
    console.log('✓ Test 2 OK : Stationnaire (100 DH), Gardien (100 DH), Ébourgeonnage D5 (150 DH) sans cumul avec 95 DH');
  }

  // ---------------- TEST 3 : TTT D2 (7 × 15 = 105 DH) & TTT D3 (6 × 16 = 96 DH) ----------------
  {
    const pointages: Pointage[] = [
      { id: 'p6', company_id: COMPANY_ID, ouvrier_id: 'ouv_6', numero_ouvrier: 6, date: DATE_TEST, present: true, tache_id: 'tch_ttt_d2', domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 105 },
      { id: 'p7', company_id: COMPANY_ID, ouvrier_id: 'ouv_7', numero_ouvrier: 7, date: DATE_TEST, present: true, tache_id: 'tch_ttt_d3', domaine_id: 'dom_d3', serre_id: 'serre_16', heure: '07:00:00', timestamp: 106 },
    ];
    const affectations: any[] = [
      { id: 'a6', company_id: COMPANY_ID, ouvrier_id: 'ouv_6', numero_ouvrier: 6, tache_id: 'tch_ttt_d2', domaine_id: 'dom_d2', date: DATE_TEST, heure_debut: '07:00', heure_fin: '14:00', dureeRep: 0, timestamp: 105 },
      { id: 'a7', company_id: COMPANY_ID, ouvrier_id: 'ouv_7', numero_ouvrier: 7, tache_id: 'tch_ttt_d3', domaine_id: 'dom_d3', serre_id: 'serre_16', date: DATE_TEST, heure_debut: '07:00', heure_fin: '13:00', dureeRep: 0, timestamp: 106 },
    ];
    const res = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations,
      recoltes: [],
    });
    const r6 = res.rows.find((r) => r.numeroOuvrier === 6)!;
    const r7 = res.rows.find((r) => r.numeroOuvrier === 7)!;
    assert.equal(r6.tarifExcep, 15);
    assert.equal(r6.remuneration, 105);
    assert.equal(r6.quantiteMetrique, '', 'quantiteMetrique vide sur TTT D2');
    assert.equal(r7.tarifExcep, 16);
    assert.equal(r7.remuneration, 96);
    assert.equal(r7.quantiteMetrique, '', 'quantiteMetrique vide sur TTT D3');
    console.log('✓ Test 3 OK : TTT D2 (7 × 15 = 105 DH) & TTT D3 (6 × 16 = 96 DH), quantiteMetrique vide');
  }

  // ---------------- TEST 4 : Récolte Cerise (25 × 3,8 = 95) & Ronde (80 × 1,1875 = 95) & Générique ambiguë ----------------
  {
    const pointages: Pointage[] = [
      { id: 'p8', company_id: COMPANY_ID, ouvrier_id: 'ouv_8', numero_ouvrier: 8, date: DATE_TEST, present: true, tache_id: 'tch_rec_cerise', domaine_id: 'dom_d2', serre_id: 'serre_1', heure: '07:00:00', timestamp: 107 },
      { id: 'p9', company_id: COMPANY_ID, ouvrier_id: 'ouv_9', numero_ouvrier: 9, date: DATE_TEST, present: true, tache_id: 'tch_rec_ronde', domaine_id: 'dom_d2', serre_id: 'serre_1', heure: '07:00:00', timestamp: 108 },
      { id: 'p11', company_id: COMPANY_ID, ouvrier_id: 'ouv_11', numero_ouvrier: 11, date: DATE_TEST, present: true, tache_id: 'tch_rec_generic', domaine_id: 'dom_d2', serre_id: 'serre_1', heure: '07:00:00', timestamp: 109 },
    ];
    const recoltes: RecolteEntry[] = [
      { id: 'r8', company_id: COMPANY_ID, date: DATE_TEST, serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'ouv_8', numero_ouvrier: 8, nom_ouvrier: 'Fatima Cerise', caisses: 25, notes: 'Tomate Cerise', created_by_id: 'usr_caporal', created_by_nom: 'Brahim', created_at: '' },
      { id: 'r9', company_id: COMPANY_ID, date: DATE_TEST, serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'ouv_9', numero_ouvrier: 9, nom_ouvrier: 'Khadija Ronde', caisses: 80, notes: 'Tomate Ronde', created_by_id: 'usr_caporal', created_by_nom: 'Brahim', created_at: '' },
      { id: 'r11', company_id: COMPANY_ID, date: DATE_TEST, serre_id: 'serre_1', serre_nom: 'Serre 1', ouvrier_id: 'ouv_11', numero_ouvrier: 11, nom_ouvrier: 'Mounir', caisses: 40, notes: 'Récolte matin', created_by_id: 'usr_caporal', created_by_nom: 'Brahim', created_at: '' },
    ];

    const resBlocked = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations: [],
      recoltes,
    });
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 8)!.remuneration, 95);
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 8)!.coefficient, 3.8);
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 8)!.quantiteMetrique, 25);
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 9)!.remuneration, 95);
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 9)!.tarifExcep, 1.1875);
    assert.equal(resBlocked.rows.find((r) => r.numeroOuvrier === 9)!.quantiteMetrique, 80);

    const ambiguousRow = resBlocked.rows.find((r) => r.numeroOuvrier === 11)!;
    assert.equal(ambiguousRow.needsVarietySelection, true, 'Récolte générique sans variété doit être bloquée');
    assert.equal(resBlocked.blockedVarietyRowsCount, 1);

    const blockedExp = await exportPaiementExcel({
      companyId: COMPANY_ID,
      preview: resBlocked,
      domaineFilter: 'ALL',
      domaines,
      currentUser: adminUser,
      templateBuffer,
      skipBrowserDownload: true,
      persistSnapshot: false,
    });
    assert.equal(blockedExp.success, false, 'Export bloqué si variété ambiguë non choisie');

    // Choix explicite Admin sur la ligne ambiguë
    const resResolved = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations: [],
      recoltes,
      varietyOverrides: { [ambiguousRow.rowKey]: 'RONDE' },
    });
    assert.equal(resResolved.blockedVarietyRowsCount, 0);
    assert.equal(resResolved.rows.find((r) => r.numeroOuvrier === 11)!.remuneration, 47.5); // 40 * 1.1875 = 47.5
    console.log('✓ Test 4 OK : Cerise (25×3,8=95), Ronde (80×1,1875=95) & blocage/déblocage explicite Récolte générique');
  }

  // ---------------- TEST 5 : Statut BROUILLON / VALIDÉE / personnalisé conservé intact ----------------
  {
    const pointages: any[] = [
      { id: 'ps1', company_id: COMPANY_ID, ouvrier_id: 'ouv_1', numero_ouvrier: 1, date: DATE_TEST, present: true, tache_id: 'tch_normal', domaine_id: 'dom_d2', statut: 'BROUILLON', heure: '07:00', timestamp: 10 },
      { id: 'ps2', company_id: COMPANY_ID, ouvrier_id: 'ouv_3', numero_ouvrier: 3, date: DATE_TEST, present: true, tache_id: 'tch_stationnaire', domaine_id: 'dom_d2', statut: 'VALIDÉE', heure: '07:00', timestamp: 11 },
      { id: 'ps3', company_id: COMPANY_ID, ouvrier_id: 'ouv_4', numero_ouvrier: 4, date: DATE_TEST, present: true, tache_id: 'tch_gardien', domaine_id: 'dom_d2', statut: 'EN_ATTENTE', heure: '07:00', timestamp: 12 },
    ];
    const res = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations: [],
      recoltes: [],
    });
    assert.equal(res.rows.length, 3, 'BROUILLON et autres statuts ne doivent jamais être exclus');
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 1)!.statut, 'BROUILLON');
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 1)!.remuneration, 95);
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 3)!.statut, 'VALIDÉE');
    assert.equal(res.rows.find((r) => r.numeroOuvrier === 4)!.statut, 'EN_ATTENTE');
    console.log('✓ Test 5 OK : Conservation stricte des statuts (BROUILLON reste BROUILLON, VALIDÉE reste VALIDÉE)');
  }

  // ---------------- TEST 6 : Modèle Excel original obligatoire, 21 colonnes strictes & styles préservés ----------------
  {
    const pointages: any[] = [
      { id: 'pe1', company_id: COMPANY_ID, ouvrier_id: 'ouv_1', numero_ouvrier: 1, date: DATE_TEST, present: true, tache_id: 'tch_normal', domaine_id: 'dom_d2', serre_id: 'serre_1', statut: 'BROUILLON', heure: '07:00', timestamp: 100 },
      { id: 'pe5', company_id: COMPANY_ID, ouvrier_id: 'ouv_5', numero_ouvrier: 5, date: DATE_TEST, present: true, tache_id: 'tch_ebourg_d5', domaine_id: 'dom_d5', serre_id: 'serre_d5_23', statut: 'VALIDÉE', heure: '07:00', timestamp: 101 },
      { id: 'pe10', company_id: COMPANY_ID, ouvrier_id: 'ouv_10', numero_ouvrier: 10, date: DATE_TEST, present: false, tache_id: 'tch_normal', domaine_id: 'dom_d2', heure: '07:00', timestamp: 102 },
    ];
    const preview = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages,
      affectations: [],
      recoltes: [],
    });

    // Sans modèle original -> BLOCAGE STRICT (pas de fichier inventé)
    const missingRes = await exportPaiementExcel({
      companyId: COMPANY_ID,
      preview,
      domaineFilter: 'ALL',
      domaines,
      currentUser: adminUser,
      templateBuffer: null,
      skipBrowserDownload: true,
    });
    assert.equal(missingRes.success, false);
    assert.equal(missingRes.needsTemplateImport, true);
    assert.equal(missingRes.usedTemplateFile, false);

    // Avec le modèle original -> export fidèle 21 colonnes exactes
    const okRes = await exportPaiementExcel({
      companyId: COMPANY_ID,
      preview,
      domaineFilter: 'ALL',
      domaines,
      currentUser: adminUser,
      templateBuffer,
      skipBrowserDownload: true,
      persistSnapshot: true,
    });
    assert.equal(okRes.success, true);
    assert.equal(okRes.usedTemplateFile, true);

    const wbRead = new ExcelJS.Workbook();
    await wbRead.xlsx.load(Buffer.from(okRes.buffer!) as unknown as ArrayBuffer);

    const wsPointage = wbRead.getWorksheet(PAIEMENT_SHEET_POINTAGE)!;
    const wsTotaux = wbRead.getWorksheet(PAIEMENT_SHEET_TOTAUX)!;
    assert.ok(wsPointage);
    assert.ok(wsTotaux);

    // Exactement 21 colonnes en en-tête et colonne 22 vide
    const headers = PAIEMENT_POINTAGE_COLUMNS.map((_, idx) => wsPointage.getRow(1).getCell(idx + 1).value);
    assert.deepEqual(headers, [...PAIEMENT_POINTAGE_COLUMNS]);
    assert.equal(wsPointage.getRow(1).getCell(22).value, null, 'Aucune 22e colonne ajoutée sur Pointage');

    // Propriétés visuelles du modèle conservées
    assert.equal(wsPointage.pageSetup.orientation, 'landscape');
    assert.equal(wsPointage.getColumn(4).width, 29);
    assert.equal(wsPointage.rowCount, 3, '1 en-tête + 2 lignes réelles (ligne exemple supprimée, absent exclu)');
    assert.equal(wsPointage.getRow(2).height, 21);
    assert.equal(wsPointage.getRow(2).getCell(18).value, 'BROUILLON');
    assert.equal(wsPointage.getRow(2).getCell(21).value, 95);
    assert.equal(wsPointage.getRow(3).getCell(18).value, 'VALIDÉE');
    assert.equal(wsPointage.getRow(3).getCell(21).value, 150);

    // Totaux sur la feuille complémentaire Totaux par Ouvrier (95 + 150 = 245)
    assert.equal(wsTotaux.getRow(5).getCell(3).value, 'TOTAL GÉNÉRAL');
    assert.equal(wsTotaux.getRow(5).getCell(10).value, 245);
    console.log('✓ Test 6 OK : Blocage si modèle absent + 21 colonnes & styles/mise en page du modèle conservés + Totaux par Ouvrier');
  }

  // ---------------- TEST 7 : Non-rétroactivité, historique illimité (>120) & re-téléchargement sans recalcul ----------------
  {
    const snapDateOld = getFrozenSnapshotSafe(COMPANY_ID, DATE_TEST)!;
    assert.ok(snapDateOld);

    // Modifier tarifs après l'export historique (Travail normal 95 -> 125 DH)
    const tariffUpdate = savePaiementTariffs(adminUser, COMPANY_ID, {
      ...createDefaultPaiementTariffs(),
      travailNormalJour: 125,
      ebourgeonnageD5Jour: 180,
    });
    assert.equal(tariffUpdate.success, true);
    assert.equal(loadPaiementTariffs(COMPANY_ID).version, 2);

    // Le ré-export du snapshot figé DOIT produire exactement 245 DH (95 + 150), JAMAIS 125 + 180 !
    const reexpRes = await reexportPaiementSnapshotExcel({
      snapshot: snapDateOld,
      currentUser: adminUser,
      templateBuffer,
      skipBrowserDownload: true,
    });
    assert.equal(reexpRes.success, true);
    assert.equal(reexpRes.grandTotalDH, 245);
    const wbRe = new ExcelJS.Workbook();
    await wbRe.xlsx.load(Buffer.from(reexpRes.buffer!) as unknown as ArrayBuffer);
    assert.equal(wbRe.getWorksheet(PAIEMENT_SHEET_POINTAGE)!.getRow(2).getCell(21).value, 95);
    assert.equal(wbRe.getWorksheet(PAIEMENT_SHEET_POINTAGE)!.getRow(3).getCell(21).value, 150);

    // Vérifier conservation > 120 snapshots (aucune troncature)
    for (let i = 1; i <= 125; i++) {
      const month = String(Math.floor((i - 1) / 28) + 1).padStart(2, '0');
      const day = String(((i - 1) % 28) + 1).padStart(2, '0');
      savePaiementExportSnapshot(adminUser, {
        companyId: COMPANY_ID,
        dateIso: `2025-${month}-${day}`,
        domaineFilter: 'ALL',
        filename: `EXPORT_PAIEMENT_TOUS_DOMAINES_2025-${month}-${day}.xlsx`,
        tariffsSnapshot: createDefaultPaiementTariffs(),
        rows: [],
        totalByWorker: [],
        grandTotalDH: 100,
        totalOuvriersDistincts: 1,
      });
    }
    const allHist = loadPaiementExportHistory(COMPANY_ID);
    assert.ok(allHist.length >= 126, `Historique illimité attendu (>=126), obtenu ${allHist.length}`);

    // Vérifier futur export applique le nouveau tarif 125 DH
    const futureRes = buildPaiementRows({
      companyId: COMPANY_ID,
      dateIso: DATE_FUTUR,
      ouvriers,
      taches,
      domaines,
      serres,
      pointages: [
        { id: 'pf', company_id: COMPANY_ID, ouvrier_id: 'ouv_1', numero_ouvrier: 1, date: DATE_FUTUR, present: true, tache_id: 'tch_normal', domaine_id: 'dom_d2', heure: '07:00', timestamp: 200 },
      ],
      affectations: [],
      recoltes: [],
    });
    assert.equal(futureRes.isHistoricalFrozen, false);
    assert.equal(futureRes.grandTotalDH, 125);
    console.log('✓ Test 7 OK : Historique illimité (>125), non-rétroactivité & re-téléchargement figé sans recalcul');
  }

  // ---------------- TEST 8 : Synchro multi-appareils & protection anti-écrasement par défaut ----------------
  {
    // Simuler une erreur Supabase lors du chargement : les tarifs locaux (125 DH) NE doivent PAS être écrasés !
    const failingClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: 'Network failure', code: 'ECONN' } }),
          }),
        }),
      }),
    } as any;

    const failedSync = await syncLoadPaiementTariffsFromSupabase(COMPANY_ID, failingClient);
    assert.equal(failedSync.ok, false);
    assert.equal(failedSync.config.travailNormalJour, 125, 'Erreur sync ne doit jamais réinitialiser à 95 DH');

    // Simuler un nouvel appareil (localStorage vide) lisant la version serveur v3 (130 DH)
    localStorage.clear();
    const okClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                company_id: COMPANY_ID,
                recolte_cerise_coeff: 4.1,
                recolte_ronde_tarif: 1.25,
                ttt_d2_heure: 16,
                ttt_d3_heure: 17,
                travail_normal_jour: 130,
                stationnaire_jour: 110,
                gardien_jour: 110,
                ebourgeonnage_d5_jour: 160,
                custom_task_tariffs: {},
                version: 3,
                updated_at: '2026-11-18T12:00:00Z',
                updated_by_nom: 'Lahcen',
              },
              error: null,
            }),
          }),
        }),
      }),
    } as any;

    const newDeviceSync = await syncLoadPaiementTariffsFromSupabase(COMPANY_ID, okClient);
    assert.equal(newDeviceSync.ok, true);
    assert.equal(newDeviceSync.source, 'remote');
    assert.equal(newDeviceSync.config.travailNormalJour, 130);
    assert.equal(newDeviceSync.config.ebourgeonnageD5Jour, 160);
    assert.equal(newDeviceSync.config.version, 3);
    console.log('✓ Test 8 OK : Synchro multi-appareils & protection anti-écrasement lors d’erreur Supabase');
  }

  // ---------------- TEST 9 : RBAC strict & détection explicite des erreurs Supabase ----------------
  {
    assert.equal(isAdminPaiementAuthorized(adminUser), true);
    assert.equal(isAdminPaiementAuthorized(caporalUser), false);
    assert.equal(isAdminPaiementAuthorized(caporalContractuellesUser), false);
    assert.equal(isAdminPaiementAuthorized(null), false);

    assert.equal(savePaiementTariffs(caporalUser, COMPANY_ID, { travailNormalJour: 999 }).success, false);
    assert.equal(savePaiementTariffs(caporalContractuellesUser, COMPANY_ID, { travailNormalJour: 999 }).success, false);

    const fakeSnap = {
      id: 'exp_test',
      companyId: COMPANY_ID,
      dateIso: DATE_TEST,
      domaineFilter: 'ALL',
      exportedAt: '2026-11-18T10:00:00Z',
      exportedById: 'usr_admin',
      exportedByNom: 'Admin',
      filename: 'test.xlsx',
      tariffsSnapshot: createDefaultPaiementTariffs(),
      rows: [],
      totalByWorker: [],
      grandTotalDH: 0,
      totalOuvriersDistincts: 0,
    };
    const capReexp = await reexportPaiementSnapshotExcel({
      snapshot: fakeSnap,
      currentUser: caporalUser,
      templateBuffer,
      skipBrowserDownload: true,
    });
    assert.equal(capReexp.success, false);

    const errExpired = classifySupabaseLoadErrors({ hasSession: false });
    assert.equal(errExpired.hasError, true);
    assert.equal(errExpired.isSessionExpired, true);
    assert.ok(errExpired.userMessage?.includes('ERREUR DE CHARGEMENT DES DONNÉES'));

    const errRls = classifySupabaseLoadErrors({
      hasSession: true,
      outcomes: [{ label: 'pointages', critical: true, error: { code: '42501', message: 'permission denied for table pointages' } }],
    });
    assert.equal(errRls.hasError, true);
    assert.equal(errRls.isRlsBlocked, true);

    const errNet = classifySupabaseLoadErrors({
      hasSession: true,
      thrownError: new Error('Failed to fetch'),
    });
    assert.equal(errNet.hasError, true);
    assert.equal(errNet.isNetworkError, true);
    console.log('✓ Test 9 OK : RBAC strict & détection explicite session expirée / RLS / réseau Supabase');
  }

  console.log('\nTOUS LES TESTS ISOLÉS PHASE 3 (EXPORT PAIEMENT EXCEL) SONT VALIDÉS À 100% !');
}

function getFrozenSnapshotSafe(companyId: string, dateIso: string) {
  return loadPaiementExportHistory(companyId).find((s) => s.dateIso === dateIso) || null;
}

runTests().catch((err) => {
  console.error('❌ ÉCHEC DES TESTS :', err);
  process.exit(1);
});
