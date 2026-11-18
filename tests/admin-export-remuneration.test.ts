/**
 * Tests obligatoires complets — EXPORT RÉMUNÉRATION ADMIN (LAHCEN POINTEUR)
 * Audit & Corrections complètes :
 * - ouvrierId métier strict (NUMERO-DOMAINE, jamais UUID/ID technique)
 * - serreId exact (D002S2, D3S16, D5S23, D002S1+D002S3, Toutes les serres)
 * - Heures réelles jamais inventées (07:00-16:00 pause 1 => 95 DH, 07:00-14:00 pause 0 => 83.125 DH)
 * - quantite toujours vide ; quantiteMetrique vide hors caisse
 * - Traitement Phyto 105 DH uniquement D2 (D3=16 DH/h, D1/D4/D5=EN COURS)
 * - Ébourgeonnage 150 DH uniquement D5
 * - Récolte Cerise 3.8 DH / Ronde 1.1875 DH
 * - Modèle Excel original obligatoire (arrêt si absent, refus si invalide, aucun ajout artificiel)
 *
 * Exécution : npx tsx tests/admin-export-remuneration.test.ts
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  ADMIN_EXPORT_ALL_SERRES_LABEL,
  ADMIN_EXPORT_EXCEL_COLUMNS,
  ADMIN_EXPORT_RUBAN_LABEL,
  ADMIN_EXPORT_SHEET_NAME,
  ADMIN_TARIF_EBOURGEONNAGE_D5,
  ADMIN_TARIF_RECOLTE_CERISE,
  ADMIN_TARIF_RECOLTE_RONDE,
  ADMIN_TARIF_STANDARD_HEURE,
  ADMIN_TARIF_STATIONNAIRE_JOUR,
  ADMIN_TARIF_TRAITEMENT_PHYTO_JOUR,
  ADMIN_TARIF_TTT_D3_HEURE,
  AdminRowValidation,
  buildAdminExportRemunerationRows,
  exportAdminRemunerationExcel,
  formatAdminOuvrierId,
  getAdminExportRemunerationFilename,
  isAdminExportAuthorized,
  validateAdminExcelTemplate,
} from '../src/utils/adminExportRemuneration';
import * as storage from '../src/services/storage';
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

async function buildTemplateBuffer(options?: {
  sheetName?: string;
  extraSheet?: boolean;
  extraCol22?: boolean;
  withFrozenView?: boolean;
  withAutoFilter?: boolean;
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(options?.sheetName || ADMIN_EXPORT_SHEET_NAME, {
    views: options?.withFrozenView ? [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }] : [],
    pageSetup: { orientation: 'landscape', paperSize: 9 },
  });
  const headers = [...ADMIN_EXPORT_EXCEL_COLUMNS];
  if (options?.extraCol22) headers.push('EXTRA_COL' as any);
  ws.addRow(headers).font = { bold: true, size: 12 };

  const exRow = ws.addRow([
    'EXEMPLE_14_NOV',
    '2026-11-14',
    '999-D2',
    'FAUX OUVRIER EXEMPLE DU MODELE',
    'D002',
    'D002S1',
    'Tous les Rubans',
    '',
    'EX01',
    'TACHE EXEMPLE',
    '',
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
  exRow.height = 22;
  exRow.getCell(21).numFmt = '#,##0.00';
  exRow.getCell(21).font = { bold: true, color: { argb: 'FF1E293B' } };
  ws.getColumn(4).width = 33;

  if (options?.withAutoFilter) {
    ws.autoFilter = 'A1:U2';
  }
  if (options?.extraSheet) {
    wb.addWorksheet('Feuille2');
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function runTests() {
  console.log('=== TESTS COMPLETS POST-AUDIT : EXPORT RÉMUNÉRATION ADMIN ===');

  const DATE = '2026-11-17';
  const OTHER_DATE = '2026-11-14';
  const EMPTY_DATE = '2026-11-20';
  const COMPANY_ID = 'cie_lahcen_pointeur';

  // ---------------------------------------------------------------------------
  // 1. CONTRÔLE D'ACCÈS STRICT ADMINISTRATEUR (RBAC)
  // ---------------------------------------------------------------------------
  const adminUser: UserAccount = {
    id: 'u_admin',
    username: 'lahcen',
    nom: 'Lahcen',
    role: 'admin',
    company_id: COMPANY_ID,
    actif: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
  const caporalUser: UserAccount = {
    id: 'u_cap',
    username: 'brahim',
    nom: 'Brahim',
    role: 'caporal',
    company_id: COMPANY_ID,
    actif: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
  const caporalContractUser: UserAccount = {
    id: 'u_tariq',
    username: 'tariq',
    nom: 'Tariq',
    role: 'caporal_contractuelles',
    module_attribue: 'contractuelles',
    company_id: COMPANY_ID,
    actif: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  assert.equal(isAdminExportAuthorized(adminUser), true);
  assert.equal(isAdminExportAuthorized(caporalUser), false);
  assert.equal(isAdminExportAuthorized(caporalContractUser), false);
  assert.equal(isAdminExportAuthorized({ ...adminUser, actif: false }), false);
  assert.equal(isAdminExportAuthorized(null), false);
  console.log('[OK] 1. Contrôle d’accès Admin strict validé.');

  // ---------------------------------------------------------------------------
  // 2. FORMAT OUVRIER ID STRICT (JAMAIS D'UUID NI ID TECHNIQUE)
  // ---------------------------------------------------------------------------
  assert.equal(formatAdminOuvrierId(1, 'D2'), '1-D2');
  assert.equal(formatAdminOuvrierId('55', 'D3'), '55-D3');
  assert.equal(formatAdminOuvrierId('120-D5', 'D5'), '120-D5');
  assert.equal(formatAdminOuvrierId('a1b2c3d4-0000-4000-8000-000000000001', 'D2'), '');
  assert.equal(formatAdminOuvrierId('ouv_1700000000_12', 'D2'), '');
  console.log('[OK] 2. formatAdminOuvrierId strict (NUMERO-DOMAINE, rejet UUID/ID technique) validé.');

  // ---------------------------------------------------------------------------
  // 3. INTÉGRATION RÉELLE SOURCE POINTAGE MATIN (storage) — AUCUNE HEURE INVENTÉE
  // ---------------------------------------------------------------------------
  const memStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
    setItem: (k: string, v: string) => memStore.set(k, String(v)),
    removeItem: (k: string) => memStore.delete(k),
    clear: () => memStore.clear(),
  };

  storage.initStorage();
  const realOuvriers = storage.getOuvriers(COMPANY_ID);
  const realTaches = storage.getTaches(COMPANY_ID);
  const realDomaines = storage.getDomaines();
  const realSerres = storage.getSerres(COMPANY_ID);

  const worker1 = realOuvriers.find((o) => o.numero === 1)!;
  const worker2 = realOuvriers.find((o) => o.numero === 2)!;
  const taskInstable = realTaches.find((t) => t.code === 'INS01')!;
  const taskEffeuillage = realTaches.find((t) => t.code === 'E01')!;

  const pRes1 = storage.addPointage(COMPANY_ID, worker1.id, DATE, taskInstable.id, 'dom_d2', 'serre_2', 'Serre 2');
  assert.equal(pRes1.success, true);
  const pRes2 = storage.addPointage(COMPANY_ID, worker2.id, DATE, taskEffeuillage.id, 'dom_d2', null, null);
  assert.equal(pRes2.success, true);

  const loadedPointages = storage.getPointages(COMPANY_ID, DATE);
  const loadedAffs = storage.getAffectations(COMPANY_ID, DATE);

  const fromStoragePreview = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'D2',
    ouvriers: realOuvriers,
    taches: realTaches,
    domaines: realDomaines,
    serres: realSerres,
    pointages: loadedPointages,
    affectations: loadedAffs,
    recoltes: [],
  });

  assert.equal(fromStoragePreview.rows.length, 2);
  const sRow1 = fromStoragePreview.rows.find((r) => r.numeroOuvrier === 1)!;
  const sRow2 = fromStoragePreview.rows.find((r) => r.numeroOuvrier === 2)!;

  // Pointage Matin ne saisissant pas encore heureDeb/heureFin, INSTABLE reste EN COURS (aucune heure inventée)
  assert.equal(sRow1.ouvrierId, '1-D2');
  assert.equal(sRow1.serreId, 'D002S2');
  assert.equal(sRow1.heureDeb, '');
  assert.equal(sRow1.heureFin, '');
  assert.equal(sRow1.dureeRep, '');
  assert.equal(sRow1.statut, 'EN COURS');
  assert.equal(sRow1.tarifExcep, '');
  assert.equal(sRow1.remuneration, '');
  assert.equal(sRow1.quantite, '');
  assert.equal(sRow1.quantiteMetrique, '');

  assert.equal(sRow2.ouvrierId, '2-D2');
  assert.equal(sRow2.serreId, ADMIN_EXPORT_ALL_SERRES_LABEL);
  assert.equal(sRow2.statut, 'EN COURS');
  assert.equal(fromStoragePreview.grandTotalValidatedDH, 0);
  console.log('[OK] 3. Source Pointage Matin réelle sans heures inventées (EN COURS si heureDeb/heureFin absentes) validée.');

  // ---------------------------------------------------------------------------
  // 4. TOUS LES CAS MÉTIER & RÈGLES DE TARIFICATION STRICTES
  // ---------------------------------------------------------------------------
  const domaines: Domaine[] = [
    { id: 'dom_d1', nom: 'D1', ordre: 1 },
    { id: 'dom_d2', nom: 'D2', ordre: 2 },
    { id: 'dom_d3', nom: 'D3', ordre: 3 },
    { id: 'dom_d4', nom: 'D4', ordre: 4 },
    { id: 'dom_d5', nom: 'D5', ordre: 5 },
  ];

  const serres: Serre[] = [
    { id: 's_1', company_id: COMPANY_ID, code: 'S1', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' },
    { id: 's_2', company_id: COMPANY_ID, code: 'S2', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' },
    { id: 's_3', company_id: COMPANY_ID, code: 'S3', nom: 'Serre 3', actif: true, ordre: 3, domaine_id: 'dom_d2' },
    { id: 's_5', company_id: COMPANY_ID, code: 'S5', nom: 'Serre 5', actif: true, ordre: 5, domaine_id: 'dom_d2' },
    { id: 's_16', company_id: COMPANY_ID, code: 'S16', nom: 'Serre 16', actif: true, ordre: 16, domaine_id: 'dom_d3' },
    { id: 's_23', company_id: COMPANY_ID, code: 'S23', nom: 'Serre 23', actif: true, ordre: 23, domaine_id: 'dom_d5' },
  ];

  const taches: Tache[] = [
    { id: 't_ins', company_id: COMPANY_ID, code: 'INS01', nom: 'INSTABLE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_eff', company_id: COMPANY_ID, code: 'E01', nom: 'EFFEUILLAGE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_cer', company_id: COMPANY_ID, code: 'RC01', nom: 'RECOLTE CERISE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_ron', company_id: COMPANY_ID, code: 'RR01', nom: 'RECOLTE RONDE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_ttt', company_id: COMPANY_ID, code: 'TTT03', nom: 'TTT D3', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_eb', company_id: COMPANY_ID, code: 'EBD05', nom: 'EBOURGEONNAGE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_sta', company_id: COMPANY_ID, code: 'STA01', nom: 'STATIONNAIRE', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
    { id: 't_phy', company_id: COMPANY_ID, code: 'PHY01', nom: 'TRAITEMENT PHYTO', ouvriers_autorises: 'tous', createdAt: '2026-01-01' },
  ];

  const ouvriers: Ouvrier[] = [
    { id: 'o_1', company_id: COMPANY_ID, numero: 1, nom: 'Ahmed Benali', actif: true, createdAt: '2026-01-01' },
    { id: 'o_2', company_id: COMPANY_ID, numero: 2, nom: 'Khadija Tazi', actif: true, createdAt: '2026-01-01' },
    { id: 'o_10', company_id: COMPANY_ID, numero: 10, nom: 'Youssef Mansouri', actif: true, createdAt: '2026-01-01' },
    { id: 'o_11', company_id: COMPANY_ID, numero: 11, nom: 'Nadia Fassi', actif: true, createdAt: '2026-01-01' },
    { id: 'o_55', company_id: COMPANY_ID, numero: 55, nom: 'Hassan Chaoui', actif: true, createdAt: '2026-01-01' },
    { id: 'o_120', company_id: COMPANY_ID, numero: 120, nom: 'Fatima Naciri', actif: true, createdAt: '2026-01-01' },
    { id: 'o_200', company_id: COMPANY_ID, numero: 200, nom: 'Rachid Bouzid', actif: true, createdAt: '2026-01-01' },
    { id: 'o_201', company_id: COMPANY_ID, numero: 201, nom: 'Salma Berrada', actif: true, createdAt: '2026-01-01' },
    { id: 'o_202', company_id: COMPANY_ID, numero: 202, nom: 'Omar Alaoui', actif: true, createdAt: '2026-01-01' },
    { id: 'o_999', company_id: COMPANY_ID, numero: 999, nom: 'Ouvrier Absent', actif: true, createdAt: '2026-01-01' },
  ];

  const pointages: Pointage[] = [
    { id: 'p_1', company_id: COMPANY_ID, ouvrier_id: 'o_1', numero_ouvrier: 1, date: DATE, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 1001 },
    { id: 'p_2', company_id: COMPANY_ID, ouvrier_id: 'o_2', numero_ouvrier: 2, date: DATE, present: true, domaine_id: 'dom_d2', heure: '07:05:00', timestamp: 1002 },
    { id: 'p_10', company_id: COMPANY_ID, ouvrier_id: 'o_10', numero_ouvrier: 10, date: DATE, present: true, domaine_id: 'dom_d2', heure: '07:06:00', timestamp: 1003 },
    { id: 'p_11', company_id: COMPANY_ID, ouvrier_id: 'o_11', numero_ouvrier: 11, date: DATE, present: true, domaine_id: 'dom_d2', heure: '07:07:00', timestamp: 1004 },
    { id: 'p_55', company_id: COMPANY_ID, ouvrier_id: 'o_55', numero_ouvrier: 55, date: DATE, present: true, domaine_id: 'dom_d3', heure: '07:08:00', timestamp: 1005 },
    { id: 'p_120', company_id: COMPANY_ID, ouvrier_id: 'o_120', numero_ouvrier: 120, date: DATE, present: true, domaine_id: 'dom_d5', heure: '07:09:00', timestamp: 1006 },
    { id: 'p_200', company_id: COMPANY_ID, ouvrier_id: 'o_200', numero_ouvrier: 200, date: DATE, present: true, domaine_id: 'dom_d1', heure: '07:10:00', timestamp: 1007 },
    { id: 'p_201', company_id: COMPANY_ID, ouvrier_id: 'o_201', numero_ouvrier: 201, date: DATE, present: true, domaine_id: 'dom_d2', heure: '07:11:00', timestamp: 1008 },
    { id: 'p_202', company_id: COMPANY_ID, ouvrier_id: 'o_202', numero_ouvrier: 202, date: DATE, present: true, domaine_id: 'dom_d5', heure: '07:12:00', timestamp: 1009 },
    // Absent et autre date exclus
    { id: 'p_999', company_id: COMPANY_ID, ouvrier_id: 'o_999', numero_ouvrier: 999, date: DATE, present: false, domaine_id: 'dom_d2', heure: '07:12:00', timestamp: 1010 },
    { id: 'p_old', company_id: COMPANY_ID, ouvrier_id: 'o_1', numero_ouvrier: 1, date: OTHER_DATE, present: true, domaine_id: 'dom_d2', heure: '07:00:00', timestamp: 900 },
  ];

  const affectations: AffectationTache[] = [
    // Ouvrier 1 : INSTABLE 07:00 -> 16:00 (pause 1h -> 8h * 11.875 = 95 DH) sur serres D002S1+D002S3
    // + 2e tâche EFFEUILLAGE sans tarif confirmé (-> EN COURS)
    {
      id: 'a_1a',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_1',
      numero_ouvrier: 1,
      tache_id: 't_ins',
      domaine_id: 'dom_d2',
      serres_ids: ['s_1', 's_3'],
      serres_noms: ['Serre 1', 'Serre 3'],
      date: DATE,
      timestamp: 1001,
      heure_debut: '07:00',
      heure_fin: '16:00',
    } as any,
    {
      id: 'a_1b',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_1',
      numero_ouvrier: 1,
      tache_id: 't_eff',
      domaine_id: 'dom_d2',
      serre_id: 's_2',
      date: DATE,
      timestamp: 1002,
    },
    // Ouvrier 11 : INSTABLE 07:00 -> 14:00 (pause 0h -> 7h * 11.875 = 83.125 DH)
    {
      id: 'a_11',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_11',
      numero_ouvrier: 11,
      tache_id: 't_ins',
      domaine_id: 'dom_d2',
      serre_id: 's_2',
      date: DATE,
      timestamp: 1003,
      heure_debut: '07:00',
      heure_fin: '14:00',
    } as any,
    // Ouvrier 2 : Récolte Cerise sans serre -> Toutes les serres (35 * 3.8 = 133 DH)
    {
      id: 'a_2',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_2',
      numero_ouvrier: 2,
      tache_id: 't_cer',
      domaine_id: 'dom_d2',
      serre_id: null,
      date: DATE,
      timestamp: 1004,
    },
    // Ouvrier 10 : Récolte Ronde 80 caisses (80 * 1.1875 = 95 DH)
    {
      id: 'a_10',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_10',
      numero_ouvrier: 10,
      tache_id: 't_ron',
      domaine_id: 'dom_d2',
      serre_id: 's_3',
      date: DATE,
      timestamp: 1005,
    },
    // Ouvrier 55 : TTT D3 sans heures -> EN COURS ; serreId exact D3S16
    {
      id: 'a_55',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_55',
      numero_ouvrier: 55,
      tache_id: 't_ttt',
      domaine_id: 'dom_d3',
      serre_id: 's_16',
      date: DATE,
      timestamp: 1006,
    },
    // Ouvrier 120 : Ébourgeonnage D5 (150 DH forfait, uniteMetrique = '1') ; serreId exact D5S23
    {
      id: 'a_120',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_120',
      numero_ouvrier: 120,
      tache_id: 't_eb',
      domaine_id: 'dom_d5',
      serre_id: 's_23',
      date: DATE,
      timestamp: 1007,
    },
    // Ouvrier 200 en D1 : Stationnaire (100 DH)
    {
      id: 'a_200',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_200',
      numero_ouvrier: 200,
      tache_id: 't_sta',
      domaine_id: 'dom_d1',
      serre_id: null,
      date: DATE,
      timestamp: 1008,
    },
    // Ouvrier 201 en D2 : Traitement Phyto sur D2 -> 105 DH
    {
      id: 'a_201',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_201',
      numero_ouvrier: 201,
      tache_id: 't_phy',
      domaine_id: 'dom_d2',
      serre_id: 's_5',
      date: DATE,
      timestamp: 1009,
    },
    // Ouvrier 202 en D5 : Traitement Phyto sur D5 -> NE DOIT PAS recevoir 105 DH -> EN COURS
    {
      id: 'a_202',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_202',
      numero_ouvrier: 202,
      tache_id: 't_phy',
      domaine_id: 'dom_d5',
      serre_id: 's_23',
      date: DATE,
      timestamp: 1010,
    },
    // Autre date (exclu)
    {
      id: 'a_other',
      company_id: COMPANY_ID,
      ouvrier_id: 'o_1',
      numero_ouvrier: 1,
      tache_id: 't_ins',
      domaine_id: 'dom_d2',
      serre_id: 's_1',
      date: OTHER_DATE,
      timestamp: 900,
    },
  ];

  const recoltes: RecolteEntry[] = [
    {
      id: 'rec_2',
      company_id: COMPANY_ID,
      date: DATE,
      type_operation: 'RECOLTE',
      domaine_id: 'dom_d2',
      serre_id: '',
      serre_nom: '',
      ouvrier_id: 'o_2',
      numero_ouvrier: 2,
      nom_ouvrier: 'Khadija Tazi',
      caisses: 35,
      notes: 'Tomate Cerise',
      created_by_id: 'u_cap',
      created_by_nom: 'Equipe Brahim',
      created_at: `${DATE}T12:00:00Z`,
    },
    {
      id: 'rec_10',
      company_id: COMPANY_ID,
      date: DATE,
      type_operation: 'RECOLTE',
      domaine_id: 'dom_d2',
      serre_id: 's_3',
      serre_nom: 'Serre 3',
      ouvrier_id: 'o_10',
      numero_ouvrier: 10,
      nom_ouvrier: 'Youssef Mansouri',
      caisses: 80,
      notes: 'Tomate Ronde',
      created_by_id: 'u_cap',
      created_by_nom: 'Equipe Brahim',
      created_at: `${DATE}T12:15:00Z`,
    },
    // Même si une récolte existe par erreur sur ouvrier 11 (INSTABLE), quantiteMetrique doit rester vide sur INSTABLE !
    {
      id: 'rec_11_ignored',
      company_id: COMPANY_ID,
      date: DATE,
      type_operation: 'RECOLTE',
      domaine_id: 'dom_d2',
      serre_id: 's_2',
      serre_nom: 'Serre 2',
      ouvrier_id: 'o_11',
      numero_ouvrier: 11,
      nom_ouvrier: 'Nadia Fassi',
      caisses: 20,
      notes: 'Ne doit pas polluer INSTABLE',
      created_by_id: 'u_cap',
      created_by_nom: 'Equipe Brahim',
      created_at: `${DATE}T12:20:00Z`,
    },
  ];

  const snapshotBefore = JSON.stringify({ ouvriers, taches, domaines, serres, pointages, affectations, recoltes });

  const initialPreview = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
  });

  // Vérification immutabilité totale des sources
  assert.equal(
    JSON.stringify({ ouvriers, taches, domaines, serres, pointages, affectations, recoltes }),
    snapshotBefore
  );

  // 10 lignes au total (o_1 x2 + 8 autres présents ; absent 999 et autre date exclus)
  assert.equal(initialPreview.rows.length, 10);
  assert.equal(initialPreview.checks.valideeCount, 7);
  assert.equal(initialPreview.checks.enCoursCount, 3, 'Effeuillage (sans tarif) + TTT D3 (sans heures) + Phyto D5 (105 uniquement D2)');
  assert.equal(initialPreview.canExport, true);

  // Vérification exacte des serres (D002S2, D3S16, D5S23, D002S1+D002S3, Toutes les serres) & rubanId
  const insRow8h = initialPreview.rows.find((r) => r.numeroOuvrier === 1 && r.tacheTypeId === 'INS01')!;
  const effRow = initialPreview.rows.find((r) => r.numeroOuvrier === 1 && r.tacheTypeId === 'E01')!;
  const insRow7h = initialPreview.rows.find((r) => r.numeroOuvrier === 11)!;
  const cerRow = initialPreview.rows.find((r) => r.numeroOuvrier === 2)!;
  const ronRow = initialPreview.rows.find((r) => r.numeroOuvrier === 10)!;
  const tttRow = initialPreview.rows.find((r) => r.numeroOuvrier === 55)!;
  const ebD5Row = initialPreview.rows.find((r) => r.numeroOuvrier === 120)!;
  const staRow = initialPreview.rows.find((r) => r.numeroOuvrier === 200)!;
  const phyD2Row = initialPreview.rows.find((r) => r.numeroOuvrier === 201)!;
  const phyD5Row = initialPreview.rows.find((r) => r.numeroOuvrier === 202)!;

  assert.equal(insRow8h.ouvrierId, '1-D2');
  assert.equal(insRow8h.serreId, 'D002S1+D002S3');
  assert.equal(insRow8h.rubanId, ADMIN_EXPORT_RUBAN_LABEL);
  assert.equal(insRow8h.dureeRep, 1);
  assert.equal(insRow8h.effectiveHours, 8);
  assert.equal(insRow8h.tarifExcep, ADMIN_TARIF_STANDARD_HEURE);
  assert.equal(insRow8h.remuneration, 95);
  assert.equal(insRow8h.quantite, '');
  assert.equal(insRow8h.quantiteMetrique, '');

  assert.equal(effRow.serreId, 'D002S2');
  assert.equal(effRow.statut, 'EN COURS');
  assert.equal(effRow.tarifExcep, '');
  assert.equal(effRow.remuneration, '');

  assert.equal(insRow7h.serreId, 'D002S2');
  assert.equal(insRow7h.dureeRep, 0);
  assert.equal(insRow7h.effectiveHours, 7);
  assert.equal(insRow7h.tarifExcep, 11.875);
  assert.equal(insRow7h.remuneration, 83.125);
  assert.equal(insRow7h.quantite, '', 'quantite doit rester vide');
  assert.equal(insRow7h.quantiteMetrique, '', 'quantiteMetrique vide sur rémunération au temps');

  assert.equal(cerRow.serreId, ADMIN_EXPORT_ALL_SERRES_LABEL);
  assert.equal(cerRow.uniteMetrique, 'PLATEAUX');
  assert.equal(cerRow.quantiteMetrique, 35);
  assert.equal(cerRow.quantite, '');
  assert.equal(cerRow.tarifExcep, ADMIN_TARIF_RECOLTE_CERISE);
  assert.equal(cerRow.remuneration, 133);

  assert.equal(ronRow.serreId, 'D002S3');
  assert.equal(ronRow.uniteMetrique, 'PLATEAUX');
  assert.equal(ronRow.quantiteMetrique, 80);
  assert.equal(ronRow.quantite, '');
  assert.equal(ronRow.tarifExcep, ADMIN_TARIF_RECOLTE_RONDE);
  assert.equal(ronRow.remuneration, 95);

  assert.equal(tttRow.ouvrierId, '55-D3');
  assert.equal(tttRow.DT, 'D003');
  assert.equal(tttRow.serreId, 'D3S16');
  assert.equal(tttRow.statut, 'EN COURS');
  assert.equal(tttRow.uniteMetrique, 'HEURE');
  assert.equal(tttRow.tarifExcep, '');
  assert.equal(tttRow.remuneration, '');

  assert.equal(ebD5Row.ouvrierId, '120-D5');
  assert.equal(ebD5Row.DT, 'D005');
  assert.equal(ebD5Row.serreId, 'D5S23');
  assert.equal(ebD5Row.uniteMetrique, '1');
  assert.equal(ebD5Row.statut, 'VALIDÉE');
  assert.equal(ebD5Row.tarifExcep, ADMIN_TARIF_EBOURGEONNAGE_D5);
  assert.equal(ebD5Row.remuneration, 150);
  assert.equal(ebD5Row.quantite, '');
  assert.equal(ebD5Row.quantiteMetrique, '');

  assert.equal(staRow.tarifExcep, ADMIN_TARIF_STATIONNAIRE_JOUR);
  assert.equal(staRow.remuneration, 100);

  assert.equal(phyD2Row.DT, 'D002');
  assert.equal(phyD2Row.statut, 'VALIDÉE');
  assert.equal(phyD2Row.tarifExcep, ADMIN_TARIF_TRAITEMENT_PHYTO_JOUR);
  assert.equal(phyD2Row.remuneration, 105);

  assert.equal(phyD5Row.DT, 'D005');
  assert.equal(phyD5Row.serreId, 'D5S23');
  assert.equal(phyD5Row.statut, 'EN COURS', 'Traitement Phyto hors D2 ne doit jamais recevoir 105 DH automatiquement');
  assert.equal(phyD5Row.tarifExcep, '');
  assert.equal(phyD5Row.remuneration, '');

  // Total Validé Général (exclut EN COURS) :
  // 95 (o_1) + 83.125 (o_11) + 133 (o_2) + 95 (o_10) + 150 (o_120) + 100 (o_200) + 105 (o_201) = 761.125 DH
  assert.equal(initialPreview.grandTotalValidatedDH, 761.125);
  assert.equal(initialPreview.checks.totalsMatchValidated, true);
  console.log('[OK] 4. Tous les tarifs, serres (D002S2, D3S16, D5S23), pauses (8h=95, 7h=83.125), quantités vides et exclusions EN COURS validés.');

  // ---------------------------------------------------------------------------
  // 5. ANOMALIES BLOQUANTES : UUID ouvrier / Serre introuvable / Domaine incohérent
  // ---------------------------------------------------------------------------
  const badUuidPreview = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'ALL',
    ouvriers: [{ id: '11111111-2222-3333-4444-555555555555', company_id: COMPANY_ID, numero: 0, nom: 'Sans Matricule', actif: true, createdAt: '2026-01-01' }],
    taches,
    domaines,
    serres,
    pointages: [{ id: 'p_bad', company_id: COMPANY_ID, ouvrier_id: '11111111-2222-3333-4444-555555555555', numero_ouvrier: 0, date: DATE, present: true, domaine_id: 'dom_d2', serre_id: '99999999-aaaa-bbbb-cccc-111111111111', heure: '07:00', timestamp: 1 }],
    affectations: [],
    recoltes: [],
  });
  assert.equal(badUuidPreview.rows.length, 1);
  assert.equal(badUuidPreview.rows[0].ouvrierId, '', 'Jamais d’UUID ou ID technique dans ouvrierId');
  assert.equal(badUuidPreview.rows[0].serreId, ADMIN_EXPORT_ALL_SERRES_LABEL, 'Aucun code serre inventé pour un UUID inconnu');
  assert.equal(badUuidPreview.canExport, false, 'Anomalie bloquante si ouvrierId absent ou serre introuvable');
  assert.ok(badUuidPreview.checks.blockingIssues[0].messages.length >= 2);
  console.log('[OK] 5. Blocage strict sur UUID ouvrier / serre inconnue (sans aucune fabrication) validé.');

  // ---------------------------------------------------------------------------
  // 6. VALIDATION EXPLICITE ADMIN & VERROUILLAGE ANTI-ÉCRASEMENT
  // ---------------------------------------------------------------------------
  const validations: Record<string, AdminRowValidation> = {
    [tttRow.rowKey]: {
      rowKey: tttRow.rowKey,
      statut: 'VALIDÉE',
      calcMode: 'HEURE_TTT',
      tarifExcep: ADMIN_TARIF_TTT_D3_HEURE,
      heures: 5,
      heureDeb: '07:00',
      dureeRep: 0,
      uniteMetrique: 'HEURE',
      locked: true,
    },
    [effRow.rowKey]: {
      rowKey: effRow.rowKey,
      statut: 'VALIDÉE',
      calcMode: 'STANDARD_HORAIRE',
      tarifExcep: 12,
      heureDeb: '07:00',
      heureFin: '14:00',
      dureeRep: 0,
      locked: true,
    },
  };

  const afterValidation = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
    validations,
  });

  assert.equal(afterValidation.checks.valideeCount, 9);
  assert.equal(afterValidation.checks.enCoursCount, 1);
  // 761.125 + 80 (TTT D3 5h*16) + 84 (Effeuillage 7h*12) = 925.125 DH
  assert.equal(afterValidation.grandTotalValidatedDH, 925.125);

  const afterCatalog = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
    validations,
    taskTariffCatalog: {
      t_eff: {
        tacheKey: 't_eff',
        calcMode: 'FORFAIT_JOUR',
        tarifExcep: 999,
        updatedAt: '2026-11-17T12:00:00Z',
      },
    },
  });
  assert.equal(afterCatalog.rows.find((r) => r.rowKey === effRow.rowKey)!.tarifExcep, 12);

  // Filtre D2 et date vide
  const onlyD2 = buildAdminExportRemunerationRows({
    dateIso: DATE,
    domaineFilter: 'D2',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
    validations,
  });
  assert.ok(onlyD2.rows.every((r) => r.DT === 'D002'));
  assert.equal(onlyD2.rows.length, 6);

  const emptyDatePreview = buildAdminExportRemunerationRows({
    dateIso: EMPTY_DATE,
    domaineFilter: 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
  });
  assert.equal(emptyDatePreview.rows.length, 0);
  assert.equal(emptyDatePreview.canExport, false);
  console.log('[OK] 6. Validation explicite, verrouillage anti-écrasement, filtre domaine et date vide validés.');

  // ---------------------------------------------------------------------------
  // 7. MODÈLE EXCEL ORIGINAL OBLIGATOIRE : ARRÊT SI ABSENT, REFUS SI ALTÉRÉ, CONSERVATION FIDÈLE
  // ---------------------------------------------------------------------------
  // 7a. Arrêt strict si aucun fichier modèle n'est fourni (aucun modèle inventé !)
  const missingTplRes = await exportAdminRemunerationExcel({
    rows: initialPreview.rows,
    dateIso: DATE,
    domaineFilter: 'ALL',
    domaines,
    currentUser: adminUser,
    templateBuffer: null,
    skipBrowserDownload: true,
  });
  assert.equal(missingTplRes.success, false, 'Génération Excel DOIT s’arrêter si le modèle original est absent');
  assert.equal(missingTplRes.needsTemplateImport, true);
  assert.equal(missingTplRes.usedTemplateFile, false);

  // 7b. Refus strict d'un fichier non conforme (mauvais nom de feuille, 2 feuilles, 22 colonnes)
  assert.equal((await validateAdminExcelTemplate(await buildTemplateBuffer({ sheetName: 'AutreFeuille' }))).valid, false);
  assert.equal((await validateAdminExcelTemplate(await buildTemplateBuffer({ extraSheet: true }))).valid, false);
  assert.equal((await validateAdminExcelTemplate(await buildTemplateBuffer({ extraCol22: true }))).valid, false);

  // 7c. Modèle conforme SANS autoFilter ni frozen view -> ne doit PAS en ajouter artificiellement
  const plainTplBuf = await buildTemplateBuffer({ withAutoFilter: false, withFrozenView: false });
  assert.equal((await validateAdminExcelTemplate(plainTplBuf)).valid, true);

  const exportRes = await exportAdminRemunerationExcel({
    rows: initialPreview.rows,
    dateIso: DATE,
    domaineFilter: 'ALL',
    domaines,
    currentUser: adminUser,
    templateBuffer: plainTplBuf,
    skipBrowserDownload: true,
  });

  assert.equal(exportRes.success, true);
  assert.equal(exportRes.usedTemplateFile, true);
  assert.equal(exportRes.valideeCount, 7);
  assert.equal(exportRes.enCoursCount, 3);
  assert.equal(exportRes.filename, getAdminExportRemunerationFilename(DATE, 'ALL', domaines));
  assert.ok(exportRes.buffer && exportRes.buffer.byteLength > 1000);

  const readBack = new ExcelJS.Workbook();
  const rbAb = new ArrayBuffer(exportRes.buffer!.byteLength);
  new Uint8Array(rbAb).set(exportRes.buffer!);
  await readBack.xlsx.load(rbAb);
  assert.deepEqual(readBack.worksheets.map((w) => w.name), [ADMIN_EXPORT_SHEET_NAME]);

  const rbWs = readBack.getWorksheet(ADMIN_EXPORT_SHEET_NAME)!;
  assert.equal(rbWs.pageSetup.orientation, 'landscape', 'Mise en page du modèle conservée');
  assert.equal(rbWs.getColumn(4).width, 33, 'Largeur colonne modèle conservée');
  assert.equal(rbWs.autoFilter, undefined, 'Aucun autoFilter ajouté artificiellement');
  assert.ok(!rbWs.views || rbWs.views.length === 0 || rbWs.views.every((v) => v.state !== 'frozen'), 'Aucun freeze pane ajouté artificiellement');
  assert.equal(rbWs.rowCount, 11, '1 en-tête + 10 lignes réelles (exemples du modèle supprimés)');

  const headerVals: string[] = [];
  for (let c = 1; c <= 21; c++) {
    headerVals.push(String(rbWs.getRow(1).getCell(c).value || ''));
  }
  assert.deepEqual(headerVals, [...ADMIN_EXPORT_EXCEL_COLUMNS], '21 colonnes exactes dans l’ordre');

  for (let r = 2; r <= rbWs.rowCount; r++) {
    const rowVals = rbWs.getRow(r);
    assert.notEqual(String(rowVals.getCell(2).value), '2026-11-14');
    assert.notEqual(String(rowVals.getCell(4).value), 'FAUX OUVRIER EXEMPLE DU MODELE');
    assert.equal(String(rowVals.getCell(2).value), DATE);
    assert.match(String(rowVals.getCell(3).value), /^\d+-D\d+$/);
    assert.equal(String(rowVals.getCell(7).value), ADMIN_EXPORT_RUBAN_LABEL);
    assert.equal(rowVals.getCell(13).value, null, 'quantite (col 13) doit toujours être vide');

    if (String(rowVals.getCell(18).value) === 'EN COURS') {
      assert.equal(rowVals.getCell(20).value, null);
      assert.equal(rowVals.getCell(21).value, null);
    } else {
      assert.equal(String(rowVals.getCell(18).value), 'VALIDÉE');
      assert.equal(typeof rowVals.getCell(20).value, 'number');
      assert.equal(typeof rowVals.getCell(21).value, 'number');
    }
  }

  // RBAC refus à l'export même avec modèle valide
  const capAttempt = await exportAdminRemunerationExcel({
    rows: initialPreview.rows,
    dateIso: DATE,
    domaineFilter: 'ALL',
    domaines,
    currentUser: caporalUser,
    templateBuffer: plainTplBuf,
    skipBrowserDownload: true,
  });
  assert.equal(capAttempt.success, false);

  console.log('=== EXEMPLE RÉEL RELU DANS LE FICHIER EXCEL GÉNÉRÉ (2026-11-17) ===');
  for (let r = 1; r <= Math.min(5, rbWs.rowCount); r++) {
    const vals: string[] = [];
    for (let c = 1; c <= 21; c++) {
      const v = rbWs.getRow(r).getCell(c).value;
      vals.push(v === null || v === undefined ? '' : String(v));
    }
    console.log(`Ligne ${r}:`, vals.join(' | '));
  }
  console.log('=== TOUS LES TESTS EXPORT RÉMUNÉRATION ADMIN PASSÉS AVEC SUCCÈS ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
