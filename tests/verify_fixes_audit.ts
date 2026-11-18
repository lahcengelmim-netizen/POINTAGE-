import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import * as XLSX from 'xlsx';
import {
  buildContractuellesRemunerationRows,
  computeContractuelExportFields,
  formatContractuelOuvrierId,
  formatContractuelSerreCell,
} from '../src/services/contractuelService';
import { isValidSupabaseUrl, isSupabaseConfigured } from '../src/services/supabaseClient';
import type { ContractuelActivite, ContractuelOuvrier } from '../src/types';

async function httpRequest(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function runTests() {
  console.log('=== AUDIT & TESTS DE VALIDATION (PARTIES 1 À 4) ===');

  // ---------------------------------------------------------------------------
  // PARTIE 1 : 12 RÈGLES MÉTIER EXPORT CONTRACTUELLES (3. Rémunérations)
  // ---------------------------------------------------------------------------
  console.log('\n[PARTIE 1] Vérification des 12 règles métier Export Contractuelles...');

  // Règle 1 : ouvrierId au format NUMERO-DOMAINE
  assert.equal(formatContractuelOuvrierId('1', 'dom_d2'), '1-D2');
  assert.equal(formatContractuelOuvrierId('0055', 'D3'), '55-D3');
  assert.equal(formatContractuelOuvrierId('120-D5', 'dom_d5'), '120-D5');
  assert.equal(formatContractuelOuvrierId('12-D003', 'D3'), '12-D3');

  // Règle 2 & 4 : Serres multiples sans espaces & 'Toutes les serres' si non affectée
  assert.equal(
    formatContractuelSerreCell({
      domaine_id: 'dom_d2',
      serres_noms: ['S1', 'S3', 'D002S5'],
    }),
    'D002S1+D002S3+D002S5'
  );
  assert.equal(
    formatContractuelSerreCell({
      domaine_id: 'dom_d2',
      serre_id: 'serre_1',
      serre_nom: 'Non affectée',
      serres_texte: 'Non affectée',
      serres_ids: [],
    }),
    'Toutes les serres'
  );
  assert.equal(
    formatContractuelSerreCell({
      domaine_id: 'dom_d5',
      serres_ids: ['serre_d5_23', 'serre_d5_24'],
    }),
    'D005S23+D005S24'
  );

  const mockWorkers: ContractuelOuvrier[] = [
    {
      id: 'w1',
      company_id: 'cie_lahcen_pointeur',
      matricule: '1',
      nom: 'Ait',
      prenom: 'Ali',
      nom_complet: 'Ali Ait',
      domaine_id: 'dom_d2',
      mode_remuneration: 'JOUR',
      prix_convenu: 90,
      actif: true,
      created_at: '2026-11-15T00:00:00Z',
    },
    {
      id: 'w2',
      company_id: 'cie_lahcen_pointeur',
      matricule: '55',
      nom: 'Ben',
      prenom: 'Sara',
      nom_complet: 'Sara Ben',
      domaine_id: 'dom_d3',
      mode_remuneration: 'HEURE',
      prix_convenu: 15,
      actif: true,
      created_at: '2026-11-15T00:00:00Z',
    },
    {
      id: 'w3',
      company_id: 'cie_lahcen_pointeur',
      matricule: '120',
      nom: 'Charki',
      prenom: 'Nadia',
      nom_complet: 'Nadia Charki',
      domaine_id: 'dom_d5',
      mode_remuneration: 'JOUR',
      prix_convenu: 150,
      actif: true,
      created_at: '2026-11-15T00:00:00Z',
    },
  ];

  const mockActivities: Array<ContractuelActivite & { heureDeb?: string; heureFin?: string }> = [
    // 1) Travail standard 07:00-16:00 multi-serres
    {
      id: 'a1',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p1',
      ouvrier_id: 'w1',
      nom_complet: 'Ali Ait',
      matricule: '1',
      date: '2026-11-15',
      tache_id: 't1',
      tache_nom: 'Attachage',
      domaine_id: 'dom_d2',
      serre_id: 'serre_1',
      serre_nom: 'D002S1 + D002S3 + D002S5',
      serres_noms: ['S1', 'S3', 'S5'],
      mode_remuneration: 'JOUR',
      quantite: 1,
      unite: 'JOUR',
      prix_unitaire: 90,
      montant_total: 95,
      created_at: '2026-11-15T08:00:00Z',
      heureDeb: '07:00',
      heureFin: '16:00',
    },
    // 2) Récolte Cerise + aucune serre affectée + horaire 07:00-14:00 (dureeRep = 0)
    {
      id: 'a2',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p1',
      ouvrier_id: 'w1',
      nom_complet: 'Ali Ait',
      matricule: '1',
      date: '2026-11-15',
      tache_id: 't2',
      tache_nom: 'Récolte Cerise',
      domaine_id: 'dom_d2',
      serre_id: 'serre_1',
      serre_nom: 'Non affectée',
      serres_texte: 'Non affectée',
      serres_ids: [],
      mode_remuneration: 'UNITE',
      quantite: 40,
      unite: 'CAISSE',
      prix_unitaire: 2,
      montant_total: 152,
      created_at: '2026-11-15T08:00:00Z',
      heureDeb: '07:00',
      heureFin: '14:00',
    },
    // 3) Récolte Ronde
    {
      id: 'a3',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p1',
      ouvrier_id: 'w1',
      nom_complet: 'Ali Ait',
      matricule: '1',
      date: '2026-11-15',
      tache_id: 't3',
      tache_nom: 'Récolte Ronde',
      domaine_id: 'dom_d2',
      serre_id: 'serre_2',
      serre_nom: 'S2',
      mode_remuneration: 'UNITE',
      quantite: 80,
      unite: 'CAISSE',
      prix_unitaire: 1,
      montant_total: 95,
      created_at: '2026-11-15T08:00:00Z',
    },
    // 4) TTT D3 -> tarifExcep = 16, Unité = ''
    {
      id: 'a4',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p2',
      ouvrier_id: 'w2',
      nom_complet: 'Sara Ben',
      matricule: '55',
      date: '2026-11-15',
      tache_id: 't4',
      tache_nom: 'TTT',
      domaine_id: 'dom_d3',
      serre_id: 'serre_16',
      serre_nom: 'S16',
      mode_remuneration: 'HEURE',
      quantite: 8,
      unite: 'HEURE',
      prix_unitaire: 12,
      montant_total: 128,
      created_at: '2026-11-15T08:00:00Z',
    },
    // 5) Ébourgeonnage D5 -> Unité = '1', tarifExcep = 150, mode FORFAIT
    {
      id: 'a5',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p3',
      ouvrier_id: 'w3',
      nom_complet: 'Nadia Charki',
      matricule: '120',
      date: '2026-11-15',
      tache_id: 't5',
      tache_nom: 'Ébourgeonnage D5',
      domaine_id: 'dom_d5',
      serre_id: 'serre_d5_23',
      serre_nom: 'D005S23',
      mode_remuneration: 'JOUR',
      quantite: 1,
      unite: 'JOUR',
      prix_unitaire: 95,
      montant_total: 150,
      created_at: '2026-11-15T08:00:00Z',
    },
    // 6) Tâche à l'unité réelle (non récolte) -> Unité conservée
    {
      id: 'a6',
      company_id: 'cie_lahcen_pointeur',
      pointage_id: 'p2',
      ouvrier_id: 'w2',
      nom_complet: 'Sara Ben',
      matricule: '55',
      date: '2026-11-15',
      tache_id: 't6',
      tache_nom: 'Palissage',
      domaine_id: 'dom_d3',
      serre_id: 'serre_d3_4',
      serre_nom: 'S4',
      mode_remuneration: 'UNITE',
      quantite: 12,
      unite: 'LIGNE',
      prix_unitaire: 10,
      montant_total: 120,
      created_at: '2026-11-15T08:00:00Z',
    },
  ];

  const rows = buildContractuellesRemunerationRows(mockActivities, mockWorkers);
  assert.equal(rows.length, 6);

  // Vérification ligne 1 : Standard 07:00-16:00 + multi-serres
  assert.equal(rows[0]['ouvrierId'], '1-D2');
  assert.equal(rows[0]['Serre'], 'D002S1+D002S3+D002S5');
  assert.equal(rows[0]['Ruban'], 'Tous les Rubans');
  assert.equal(rows[0]['tarifExcep'], 95);
  assert.equal(rows[0]['dureeRep'], 1);
  assert.equal(rows[0]['Unité'], '');
  assert.equal(rows[0]['qteMetrique'], '');
  assert.equal(rows[0]['quantite'], '');

  // Vérification ligne 2 : Récolte Cerise + Non affectée + 07:00-14:00
  assert.equal(rows[1]['ouvrierId'], '1-D2');
  assert.equal(rows[1]['Serre'], 'Toutes les serres');
  assert.equal(rows[1]['Ruban'], 'Tous les Rubans');
  assert.equal(rows[1]['tarifExcep'], 3.8);
  assert.equal(rows[1]['dureeRep'], 0);
  assert.equal(rows[1]['Unité'], '');
  assert.equal(rows[1]['qteMetrique'], '');
  assert.equal(rows[1]['quantite'], '');

  // Vérification ligne 3 : Récolte Ronde
  assert.equal(rows[2]['Serre'], 'D002S2');
  assert.equal(rows[2]['tarifExcep'], 1.1875);
  assert.equal(rows[2]['Unité'], '');

  // Vérification ligne 4 : TTT D3
  assert.equal(rows[3]['ouvrierId'], '55-D3');
  assert.equal(rows[3]['Serre'], 'D003S16');
  assert.equal(rows[3]['tarifExcep'], 16);
  assert.equal(rows[3]['Unité'], '');

  // Vérification ligne 5 : Ébourgeonnage D5
  assert.equal(rows[4]['ouvrierId'], '120-D5');
  assert.equal(rows[4]['Serre'], 'D005S23');
  assert.equal(rows[4]['Mode'], 'FORFAIT');
  assert.equal(rows[4]['Unité'], '1');
  assert.equal(rows[4]['tarifExcep'], 150);

  // Vérification ligne 6 : Unité réelle conservée
  assert.equal(rows[5]['ouvrierId'], '55-D3');
  assert.equal(rows[5]['Serre'], 'D003S4');
  assert.equal(rows[5]['Unité'], 'LIGNE');
  assert.equal(rows[5]['qteMetrique'], '');
  assert.equal(rows[5]['quantite'], '');

  // Round-trip SheetJS sur la feuille '3. Rémunérations'
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, '3. Rémunérations');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const parsedWb = XLSX.read(buf, { type: 'buffer' });
  const sheetRows = XLSX.utils.sheet_to_json<Record<string, any>>(parsedWb.Sheets['3. Rémunérations'], { defval: '' });
  assert.equal(sheetRows.length, 6);
  assert.equal(sheetRows[0]['Serre'], 'D002S1+D002S3+D002S5');
  assert.equal(sheetRows[1]['Serre'], 'Toutes les serres');
  assert.equal(sheetRows[4]['tarifExcep'], 150);

  const computedCheck = computeContractuelExportFields(mockActivities[0]);
  assert.equal(computedCheck.ruban, 'Tous les Rubans');
  console.log('[OK] PARTIE 1 validée (12 règles métier + round-trip SheetJS).');

  // ---------------------------------------------------------------------------
  // PARTIE 2 : VALIDATION CONFIG SUPABASE CLIENT
  // ---------------------------------------------------------------------------
  console.log('\n[PARTIE 2] Vérification validation URL Supabase...');
  assert.equal(isValidSupabaseUrl('https://abcdef.supabase.co'), true);
  assert.equal(isValidSupabaseUrl('http://localhost:54321'), true);
  assert.equal(isValidSupabaseUrl(''), false);
  assert.equal(isValidSupabaseUrl('not-a-url'), false);
  assert.equal(isValidSupabaseUrl('ftp://invalid.example.com'), false);
  assert.equal(typeof isSupabaseConfigured, 'boolean');
  console.log('[OK] PARTIE 2 validée (isValidSupabaseUrl & isSupabaseConfigured).');

  // ---------------------------------------------------------------------------
  // PARTIE 3 & 4 : AUTH, RBAC, CLOISONNEMENT TENANT & SÉCURITÉ SERVEUR
  // ---------------------------------------------------------------------------
  console.log('\n[PARTIE 3 & 4] Démarrage serveur Express isolé (SKIP_AUTO_START=true)...');
  process.env.SKIP_AUTO_START = 'true';
  process.env.NODE_ENV = 'development';
  const prevAllowDev = process.env.ALLOW_DEV_TOKENS;

  const { app } = await import('../server');
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Impossible de résoudre le port éphémère du serveur test.');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    // A) Appels sans jeton -> tous 401
    delete process.env.ALLOW_DEV_TOKENS;
    const protectedEndpoints: Array<{ method: string; path: string }> = [
      { method: 'GET', path: '/api/stock' },
      { method: 'GET', path: '/api/heures-supplementaires' },
      { method: 'GET', path: '/api/taches-supplementaires' },
      { method: 'GET', path: '/api/contractuels/ouvriers' },
      { method: 'GET', path: '/api/contractuels/contrats' },
      { method: 'GET', path: '/api/users' },
      { method: 'GET', path: '/api/serres' },
      { method: 'GET', path: '/api/recolte' },
      { method: 'POST', path: '/api/recolte/sync' },
    ];

    for (const ep of protectedEndpoints) {
      const r = await httpRequest(baseUrl, ep.method, ep.path, {}, ep.method === 'POST' ? {} : undefined);
      assert.equal(r.status, 401, `Sans jeton ${ep.method} ${ep.path} doit renvoyer 401 (reçu ${r.status})`);
    }
    console.log('[OK] Appels sans jeton bloqués (401) sur tous les endpoints sensibles.');

    // B) Jeton invalide / factice -> 401
    const fakeRes = await httpRequest(baseUrl, 'GET', '/api/stock', {
      Authorization: 'Bearer invalid_fake_token_xyz',
    });
    assert.equal(fakeRes.status, 401, 'Jeton factice doit renvoyer 401');

    // C) Dev tokens refusés si ALLOW_DEV_TOKENS n'est pas activé
    const disabledDevRes = await httpRequest(baseUrl, 'GET', '/api/stock', {
      Authorization: 'Bearer dev_admin_token',
    });
    assert.equal(disabledDevRes.status, 401, 'dev_admin_token doit renvoyer 401 sans ALLOW_DEV_TOKENS=true');
    console.log('[OK] Jetons factices et dev tokens désactivés par défaut bloqués (401).');

    // D) Tests avec ALLOW_DEV_TOKENS=true en développement
    process.env.ALLOW_DEV_TOKENS = 'true';

    // D1) Contractuel token : accès contractuelles OK, stock & recolte bloqués
    const cOuv = await httpRequest(baseUrl, 'GET', '/api/contractuels/ouvriers', {
      Authorization: 'Bearer dev_contractuel_token',
    });
    assert.equal(cOuv.status, 200, `dev_contractuel_token /api/contractuels/ouvriers attendu 200, reçu ${cOuv.status}`);

    const cContrats = await httpRequest(baseUrl, 'GET', '/api/contractuels/contrats', {
      Authorization: 'Bearer dev_contractuel_token',
    });
    assert.equal(cContrats.status, 200, `dev_contractuel_token /api/contractuels/contrats attendu 200, reçu ${cContrats.status}`);

    const cStock = await httpRequest(baseUrl, 'GET', '/api/stock', {
      Authorization: 'Bearer dev_contractuel_token',
    });
    assert.ok(
      cStock.status === 401 || cStock.status === 403,
      `dev_contractuel_token /api/stock doit être refusé (401/403), reçu ${cStock.status}`
    );

    const cRecolte = await httpRequest(baseUrl, 'GET', '/api/recolte', {
      Authorization: 'Bearer dev_contractuel_token',
    });
    assert.ok(
      cRecolte.status === 401 || cRecolte.status === 403,
      `dev_contractuel_token /api/recolte doit être refusé (401/403), reçu ${cRecolte.status}`
    );
    console.log('[OK] Cloisonnement dev_contractuel_token validé.');

    // D2) Caporal Récolte token : contractuelles refusé (403), recolte autorisé (200)
    const capOuv = await httpRequest(baseUrl, 'GET', '/api/contractuels/ouvriers', {
      Authorization: 'Bearer dev_caporal_token',
    });
    assert.equal(capOuv.status, 403, `dev_caporal_token /api/contractuels/ouvriers attendu 403, reçu ${capOuv.status}`);

    const capRec = await httpRequest(baseUrl, 'GET', '/api/recolte', {
      Authorization: 'Bearer dev_caporal_token',
    });
    assert.equal(capRec.status, 200, `dev_caporal_token /api/recolte attendu 200, reçu ${capRec.status}`);
    console.log('[OK] Cloisonnement dev_caporal_token validé.');

    // D3) Isolation multi-tenant x-company-id -> 400
    const crossTenant = await httpRequest(baseUrl, 'GET', '/api/stock', {
      Authorization: 'Bearer dev_admin_token',
      'x-company-id': 'other_company',
    });
    assert.equal(crossTenant.status, 400, `x-company-id cross-tenant doit renvoyer 400, reçu ${crossTenant.status}`);
    console.log('[OK] Blocage cross-tenant x-company-id (400) validé.');

    // D4) Admin token : /api/users sans passwordHash ni salt + /api/stock + /api/taches-supplementaires
    const admUsers = await httpRequest(baseUrl, 'GET', '/api/users', {
      Authorization: 'Bearer dev_admin_token',
    });
    assert.equal(admUsers.status, 200);
    if (Array.isArray(admUsers.json?.users)) {
      for (const u of admUsers.json.users) {
        assert.equal('passwordHash' in u, false, 'passwordHash ne doit jamais être exposé dans /api/users');
        assert.equal('salt' in u, false, 'salt ne doit jamais être exposé dans /api/users');
      }
    }

    const admStock = await httpRequest(baseUrl, 'GET', '/api/stock', {
      Authorization: 'Bearer dev_admin_token',
    });
    assert.equal(admStock.status, 200);

    const admTaches = await httpRequest(baseUrl, 'GET', '/api/taches-supplementaires', {
      Authorization: 'Bearer dev_admin_token',
    });
    assert.equal(admTaches.status, 200);
    console.log('[OK] Accès Admin (/api/users sans secrets, /api/stock, /api/taches-supplementaires) validé.');

    // E) Validation mode PRODUCTION dans un processus enfant isolé (debug routes = 404, dev_admin_token = 401)
    const prodCheckScript = `
      import http from 'node:http';
      import assert from 'node:assert/strict';
      const { app } = await import('./server.ts');
      const s = await new Promise((resolve) => {
        const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
      });
      try {
        const port = s.address().port;
        const r1 = await fetch(\`http://127.0.0.1:\${port}/api/debug-supabase\`);
        assert.equal(r1.status, 404, '/api/debug-supabase doit renvoyer 404 en production');
        const r2 = await fetch(\`http://127.0.0.1:\${port}/api/debug-config\`);
        assert.equal(r2.status, 404, '/api/debug-config doit renvoyer 404 en production');
        const r3 = await fetch(\`http://127.0.0.1:\${port}/api/stock\`, {
          headers: { Authorization: 'Bearer dev_admin_token' }
        });
        assert.equal(r3.status, 401, 'dev_admin_token doit renvoyer 401 en production même avec ALLOW_DEV_TOKENS=true');
        console.log('[OK] Mode production validé (debug routes 404 + dev tokens bloqués 401).');
      } finally {
        await new Promise((r) => s.close(() => r()));
      }
    `;
    const prodChild = spawnSync('npx', ['tsx', '--input-type=module', '-e', prodCheckScript], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ALLOW_DEV_TOKENS: 'true',
        SKIP_AUTO_START: 'true',
      },
      encoding: 'utf8',
    });
    if (prodChild.status !== 0) {
      throw new Error(`Échec test production: ${prodChild.stderr || prodChild.stdout}`);
    }
    console.log(prodChild.stdout.trim());

    console.log('\n=== TOUS LES TESTS DE VALIDATION SONT PASSÉS (100% PASS) ===');
  } finally {
    if (prevAllowDev === undefined) delete process.env.ALLOW_DEV_TOKENS;
    else process.env.ALLOW_DEV_TOKENS = prevAllowDev;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

runTests().catch((err) => {
  console.error('❌ ÉCHEC DES TESTS :', err);
  process.exit(1);
});
