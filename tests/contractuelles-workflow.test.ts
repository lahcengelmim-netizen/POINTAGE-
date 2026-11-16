/**
 * Tests d'intégration et unitaires — Module Contractuelles V2 (Lahcen Pointeur)
 * Exécution : DISABLE_AUTO_LISTEN=1 npx tsx tests/contractuelles-workflow.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as XLSX from 'xlsx';
import {
  buildContractuellesWorkbook,
  computeWorkDurationHours,
  getOfficialPointageMontant,
  getProposedPointageMontant,
  isTarifModifie,
  normalizeStatutValidation,
} from '../src/utils/contractuelWorkflow';
import { ContractuelOuvrier, ContractuelPointage } from '../src/types';

process.env.DISABLE_AUTO_LISTEN = '1';

const DB_PATH = path.join(process.cwd(), 'data', 'recolte_db.json');

async function runTests() {
  console.log('=== TESTS WORKFLOW CONTRACTUELLES (UNITAIRES + API LIVE) ===');

  // ---------------------------------------------------------------------------
  // 1. TESTS UNITAIRES DES RÈGLES MÉTIER
  // ---------------------------------------------------------------------------
  assert.equal(computeWorkDurationHours('07:00', '16:00'), 9, '07:00 -> 16:00 = 9h');
  assert.equal(computeWorkDurationHours('07:30', '12:00'), 4.5, '07:30 -> 12:00 = 4.5h');
  assert.equal(computeWorkDurationHours('16:00', '07:00'), null, 'Fin <= début => null');
  assert.equal(computeWorkDurationHours('', '14:00'), null, 'Horaire incomplet => null');

  assert.equal(isTarifModifie(100, 100, true), false, 'Même tarif => tarif_modifie=false');
  assert.equal(isTarifModifie(100, 130, true), true, 'Tarif changé => tarif_modifie=true');
  assert.equal(isTarifModifie(100, 0, false), false, 'Absent => tarif_modifie=false');

  assert.equal(
    getOfficialPointageMontant({ present: false, statut_validation: 'VALIDE', montant_valide: 120 }),
    0,
    'ABSENT => 0 DH officiel même si montant_valide fourni'
  );
  assert.equal(
    getOfficialPointageMontant({ present: true, statut_validation: 'BROUILLON', montant_propose: 120 }),
    0,
    'BROUILLON => 0 DH officiel'
  );
  assert.equal(
    getOfficialPointageMontant({ present: true, statut_validation: 'SOUMIS', montant_propose: 120 }),
    0,
    'SOUMIS => 0 DH officiel tant que non validé Admin'
  );
  assert.equal(
    getOfficialPointageMontant({ present: true, statut_validation: 'REFUSE', montant_propose: 120 }),
    0,
    'REFUSE => 0 DH officiel'
  );
  assert.equal(
    getOfficialPointageMontant({ present: true, statut_validation: 'VALIDE', montant_valide: 135 }),
    135,
    'VALIDE + PRÉSENT => montant_valide retenu dans le calcul officiel'
  );

  assert.equal(normalizeStatutValidation('SOUMIS_PAR_CAPORAL'), 'SOUMIS');
  assert.equal(normalizeStatutValidation('VALIDÉ'), 'VALIDE');
  assert.equal(normalizeStatutValidation('REFUSÉ'), 'REFUSE');
  assert.equal(normalizeStatutValidation(''), 'BROUILLON');
  console.log('✓ Règles unitaires durée, écart tarif, présence/absence & statuts OK');

  // ---------------------------------------------------------------------------
  // 2. TESTS D'INTÉGRATION API EXPRESS (AVEC RESTAURATION PROPRE DE recolte_db.json)
  // ---------------------------------------------------------------------------
  const originalDbRaw = fs.readFileSync(DB_PATH, 'utf-8');
  let server: http.Server | null = null;

  try {
    const db = JSON.parse(originalDbRaw);
    if (!Array.isArray(db.contractuels_ouvriers)) db.contractuels_ouvriers = [];

    const testWorkers: ContractuelOuvrier[] = [
      {
        id: 'co_test_w1',
        company_id: 'cie_lahcen_pointeur',
        nom: 'TAZI',
        prenom: 'AMINA',
        nom_complet: 'TAZI AMINA',
        matricule: 'C-TEST-01',
        domaine_id: 'dom_d2',
        serre_id: 'serre_1',
        mode_remuneration: 'JOUR',
        prix_convenu: 100,
        unite: 'JOUR',
        actif: true,
        created_at: new Date().toISOString(),
      },
      {
        id: 'co_test_w2',
        company_id: 'cie_lahcen_pointeur',
        nom: 'CHRAIBI',
        prenom: 'NADIA',
        nom_complet: 'CHRAIBI NADIA',
        matricule: 'C-TEST-02',
        domaine_id: 'dom_d3',
        serre_id: 'serre_16',
        mode_remuneration: 'JOUR',
        prix_convenu: 120,
        unite: 'JOUR',
        actif: true,
        created_at: new Date().toISOString(),
      },
    ];
    db.contractuels_ouvriers.push(...testWorkers);
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');

    const { app } = await import('../server');
    server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as any;
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const caporalHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev_caporal_contractuel_token',
    };
    const adminHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer dev_admin_token',
    };

    const testDate = '2026-11-20';

    // 2.1 Liste complète des ouvriers visible par le caporal (y compris D2 et D3)
    const ouvRes = await fetch(`${baseUrl}/api/contractuels/ouvriers?actif=true`, {
      headers: caporalHeaders,
    }).then((r) => r.json());
    assert.equal(ouvRes.success, true);
    assert.ok(ouvRes.ouvriers.some((o: any) => o.id === 'co_test_w1'));
    assert.ok(ouvRes.ouvriers.some((o: any) => o.id === 'co_test_w2'));
    console.log('✓ Liste complète multi-domaines accessible au caporal');

    // 2.2 Accès du caporal aux tâches réelles de l'application
    const tachesRes = await fetch(`${baseUrl}/api/contractuels/taches`, {
      headers: caporalHeaders,
    }).then((r) => r.json());
    assert.equal(tachesRes.success, true);
    assert.ok(Array.isArray(tachesRes.taches) && tachesRes.taches.length >= 5);
    console.log(`✓ ${tachesRes.taches.length} tâches réelles accessibles au caporal`);

    // 2.3 Caporal enregistre un BROUILLON multi-tâches, multi-serres, horaires + modification tarif (100 -> 135)
    const draftRes = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w1',
        date: testDate,
        present: true,
        domaine_id: 'dom_d2',
        taches_ids: ['tch_recolte', 'tch_effeuillage'],
        taches_noms: ['R01 - RECOLTE', 'E01 - EFFEUILLAGE'],
        serres_ids: ['serre_1', 'serre_3'],
        serres_noms: ['Serre 1 (S01)', 'Serre 3 (S03)'],
        heure_debut: '07:00',
        heure_fin: '15:30',
        montant_propose: 135,
        motif_modification: 'Double tâche + rallonge horaire',
        statut_validation: 'BROUILLON',
      }),
    }).then((r) => r.json());

    assert.equal(draftRes.success, true);
    const pDraft = draftRes.pointage;
    assert.equal(pDraft.statut_validation, 'BROUILLON');
    assert.equal(pDraft.tarif_initial, 100);
    assert.equal(pDraft.montant_propose, 135);
    assert.equal(pDraft.tarif_modifie, true);
    assert.equal(pDraft.duree_heures, 8.5);
    assert.equal(pDraft.montant_valide, null);
    assert.equal(pDraft.montant_total_jour, 0, 'Brouillon non comptabilisé dans total officiel');
    assert.equal(pDraft.taches_ids.length, 2);
    assert.equal(pDraft.serres_ids.length, 2);
    // Vérifier non-multiplication du montant proposé sur les activités
    const actSum = pDraft.activites.reduce((s: number, a: any) => s + Number(a.montant_total), 0);
    assert.equal(Math.round(actSum * 100) / 100, 135, 'Somme activités = 135 DH (sans multiplication)');

    // Vérifier que le tarif de base du catalogue n'est JAMAIS écrasé
    const dbAfterDraft = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    const catalogW1 = dbAfterDraft.contractuels_ouvriers.find((o: any) => o.id === 'co_test_w1');
    assert.equal(catalogW1.prix_convenu, 100, 'Catalogue prix_convenu préservé à 100 DH');
    console.log('✓ Brouillon multi-tâches/serres/horaires + écart tarif & préservation catalogue OK');

    // 2.4 Caporal tente d'auto-valider via POST /pointages -> 403 INTERDIT
    const forbiddenAutoVal = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w1',
        date: testDate,
        present: true,
        montant_propose: 135,
        statut_validation: 'VALIDE',
      }),
    });
    assert.equal(forbiddenAutoVal.status, 403, 'Caporal bloqué (403) s’il tente statut=VALIDE');

    // 2.5 Caporal soumet pour validation Admin (SOUMIS)
    const submitRes = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w1',
        date: testDate,
        present: true,
        domaine_id: 'dom_d2',
        taches_ids: ['tch_recolte', 'tch_effeuillage'],
        taches_noms: ['R01 - RECOLTE', 'E01 - EFFEUILLAGE'],
        serres_ids: ['serre_1', 'serre_3'],
        serres_noms: ['Serre 1 (S01)', 'Serre 3 (S03)'],
        heure_debut: '07:00',
        heure_fin: '15:30',
        montant_propose: 135,
        motif_modification: 'Double tâche + rallonge horaire',
        statut_validation: 'SOUMIS',
      }),
    }).then((r) => r.json());
    assert.equal(submitRes.success, true);
    assert.equal(submitRes.pointage.statut_validation, 'SOUMIS');
    assert.equal(submitRes.pointage.montant_total_jour, 0, 'SOUMIS non encore compté en paie officielle');
    assert.equal(submitRes.pointage.historique_validations.length, 2, 'Historique cumule CREATION + SOUMISSION');

    // 2.6 Caporal pointe worker 2 ABSENT => 0 DH
    const absentRes = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w2',
        date: testDate,
        present: false,
        domaine_id: 'dom_d3',
        montant_propose: 999, // Doit être forcé à 0 si absent
        statut_validation: 'SOUMIS',
      }),
    }).then((r) => r.json());
    assert.equal(absentRes.success, true);
    assert.equal(absentRes.pointage.present, false);
    assert.equal(absentRes.pointage.montant_propose, 0);
    assert.equal(absentRes.pointage.montant_total_jour, 0);
    assert.equal(absentRes.pointage.tarif_modifie, false);
    console.log('✓ Soumission Caporal & règle ABSENT = 0 DH OK');

    // 2.7 Caporal tente d'appeler l'endpoint de validation Admin -> 403 INTERDIT
    const caporalValidateRes = await fetch(
      `${baseUrl}/api/contractuels/pointages/${submitRes.pointage.id}/validate`,
      {
        method: 'POST',
        headers: caporalHeaders,
        body: JSON.stringify({ decision: 'VALIDE', montant_valide: 135 }),
      }
    );
    assert.equal(caporalValidateRes.status, 403, 'Caporal bloqué (403) sur /validate');
    console.log('✓ Sécurité RBAC : Caporal bloqué sur validation/refus (HTTP 403)');

    // 2.8 Admin refuse d'abord avec un motif, puis Caporal corrige à 115 DH et re-soumet, puis Admin valide 115 DH
    const refuseRes = await fetch(
      `${baseUrl}/api/contractuels/pointages/${submitRes.pointage.id}/validate`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          decision: 'REFUSE',
          motif: 'Montant proposé trop élevé, ajuster à 115 DH',
        }),
      }
    ).then((r) => r.json());
    assert.equal(refuseRes.success, true);
    assert.equal(refuseRes.pointage.statut_validation, 'REFUSE');
    assert.equal(refuseRes.pointage.montant_total_jour, 0);
    assert.equal(refuseRes.pointage.historique_validations.length, 3);

    const resubmitRes = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w1',
        date: testDate,
        present: true,
        domaine_id: 'dom_d2',
        taches_ids: ['tch_recolte', 'tch_effeuillage'],
        taches_noms: ['R01 - RECOLTE', 'E01 - EFFEUILLAGE'],
        serres_ids: ['serre_1', 'serre_3'],
        serres_noms: ['Serre 1 (S01)', 'Serre 3 (S03)'],
        heure_debut: '07:00',
        heure_fin: '15:30',
        montant_propose: 115,
        motif_modification: 'Ajustement suite retour Admin',
        statut_validation: 'SOUMIS',
      }),
    }).then((r) => r.json());
    assert.equal(resubmitRes.success, true);
    assert.equal(resubmitRes.pointage.historique_validations.length, 4);

    const approveRes = await fetch(
      `${baseUrl}/api/contractuels/pointages/${resubmitRes.pointage.id}/validate`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          decision: 'VALIDE',
          montant_valide: 115,
          motif: 'Validé pour 115 DH',
        }),
      }
    ).then((r) => r.json());
    assert.equal(approveRes.success, true);
    assert.equal(approveRes.pointage.statut_validation, 'VALIDE');
    assert.equal(approveRes.pointage.montant_valide, 115);
    assert.equal(approveRes.pointage.montant_total_jour, 115);
    assert.equal(approveRes.pointage.historique_validations.length, 5, '5 entrées immuables conservées');
    assert.equal(approveRes.pointage.historique_validations[0].montant_propose, 135, 'Ancienne valeur 135 DH conservée dans historique');

    // 2.9 Caporal ne peut plus écraser ni supprimer un pointage déjà VALIDÉ
    const editLockedRes = await fetch(`${baseUrl}/api/contractuels/pointages`, {
      method: 'POST',
      headers: caporalHeaders,
      body: JSON.stringify({
        ouvrier_id: 'co_test_w1',
        date: testDate,
        present: true,
        montant_propose: 250,
        statut_validation: 'SOUMIS',
      }),
    });
    assert.equal(editLockedRes.status, 403, 'Pointage VALIDÉ verrouillé contre modification Caporal');

    const deleteLockedRes = await fetch(
      `${baseUrl}/api/contractuels/pointages/${approveRes.pointage.id}`,
      { method: 'DELETE', headers: caporalHeaders }
    );
    assert.equal(deleteLockedRes.status, 403, 'Pointage VALIDÉ verrouillé contre suppression Caporal');
    console.log('✓ Workflow complet BROUILLON -> SOUMIS -> REFUSE -> SOUMIS -> VALIDE + historique & verrouillage OK');

    // 2.10 GET /api/contractuels/pointages retourne les données hydratées et filtrables
    const listRes = await fetch(`${baseUrl}/api/contractuels/pointages?date=${testDate}`, {
      headers: adminHeaders,
    }).then((r) => r.json());
    assert.equal(listRes.success, true);
    const ptgW1 = listRes.pointages.find((p: any) => p.ouvrier_id === 'co_test_w1');
    assert.equal(ptgW1.statut_validation, 'VALIDE');
    assert.equal(ptgW1.montant_total_jour, 115);
    assert.equal(ptgW1.historique_validations.length, 5);

    // ---------------------------------------------------------------------------
    // 3. EXPORT EXCEL OFFICIEL : EXCLUSION DES NON-VALIDÉS
    // ---------------------------------------------------------------------------
    const unvalidatedPending: ContractuelPointage = {
      id: 'cp_pending_sample',
      company_id: 'cie_lahcen_pointeur',
      ouvrier_id: 'co_test_w2',
      matricule: 'C-TEST-02',
      nom_complet: 'CHRAIBI NADIA',
      date: testDate,
      present: true,
      domaine_id: 'dom_d3',
      tarif_initial: 120,
      montant_propose: 200,
      montant_valide: null,
      statut_validation: 'SOUMIS',
      montant_total_jour: 0,
      created_by_id: 'usr_cap',
      created_by_nom: 'Caporal',
      created_at: new Date().toISOString(),
      activites: [],
    };

    const { wb, officialTotalDH, proposedTotalDH } = buildContractuellesWorkbook({
      pointages: [ptgW1, unvalidatedPending],
      allOuvriers: testWorkers,
      date: testDate,
    });
    assert.equal(officialTotalDH, 115, 'Total officiel Excel = 115 DH uniquement (SOUMIS exclu)');
    assert.equal(proposedTotalDH, 315, 'Total proposé Excel = 115 + 200 = 315 DH');

    const recapRows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets['1. Récapitulatif']);
    const officialRow = recapRows.find((r) => r['Indicateur'] === 'Montant Officiel Validé (DH)');
    assert.equal(officialRow?.['Valeur'], 115);
    console.log('✓ Export Excel multi-feuilles (totaux officiels validés uniquement) OK');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    // Toujours restaurer data/recolte_db.json à l'identique
    fs.writeFileSync(DB_PATH, originalDbRaw, 'utf-8');
  }

  console.log('=== TOUS LES TESTS DU MODULE CONTRACTUELLES SONT PASSÉS AVEC SUCCÈS ===');
}

runTests().catch((err) => {
  console.error('ÉCHEC TEST CONTRACTUELLES:', err);
  process.exit(1);
});
