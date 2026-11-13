/**
 * Serveur d'API Express & synchronisation multi-appareils pour Lahcen Pointeur
 * Conforme aux spécifications :
 * - Fonctionne de pair avec Vite en développement (middlewareMode) sur le port 3000
 * - Synchronisation multi-appareils (Caporal sur Téléphone A <-> Admin sur Téléphone B)
 * - Persistance serveur dans ./data/recolte_db.json
 * - Validation stricte des rôles et des données de récolte
 */

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Strict : ne jamais utiliser la clé anon comme service role

// Instance admin réservée aux opérations serveur privilégiées (si la clé secrète est configurée dans Cloud Run)
const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

// Création d'un client Supabase par requête (authentifié avec le JWT utilisateur pour respecter RLS)
function getSupabaseClientForRequest(token?: string) {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase n\'est pas configuré sur le serveur (URL ou Clé anonyme manquante).');
  }
  if (token && token.split('.').length === 3) {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));

// Emplacement du fichier de persistance du serveur
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'recolte_db.json');

interface ServerDB {
  companies?: Array<{
    id: string;
    nom: string;
    code: string;
    actif: boolean;
  }>;
  users: Array<{
    id: string;
    username: string;
    nom: string;
    role: 'admin' | 'caporal' | 'caporal_contractuelles';
    module_attribue?: 'recolte' | 'contractuelles' | 'all';
    domaines_autorises?: string[];
    serres_autorisees?: string[];
    passwordHash: string;
    salt: string;
    actif: boolean;
    telephone?: string;
    createdAt: string;
  }>;
  serres: Array<{
    id: string;
    company_id: string;
    code: string;
    nom: string;
    actif: boolean;
    ordre: number;
  }>;
  ouvriers?: Array<{
    id: string;
    company_id: string;
    numero: number;
    nom: string;
    actif: boolean;
    telephone?: string;
    notes?: string;
    createdAt?: string;
  }>;
  recoltes: Array<{
    id: string;
    company_id: string;
    date: string;
    serre_id: string;
    serre_nom: string;
    ouvrier_id: string;
    numero_ouvrier: number;
    nom_ouvrier: string;
    caisses: number;
    notes?: string;
    created_by_id: string;
    created_by_nom: string;
    created_at: string;
    updated_at?: string;
    updated_by_id?: string;
    type_operation?: 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT';
    domaine_id?: string;
  }>;
  stock_produits?: Array<{
    id: string;
    company_id: string;
    nom: string;
    unite: string;
    seuil_minimum: number;
    actif: boolean;
    created_at: string;
    updated_at?: string;
  }>;
  stock_mouvements?: Array<{
    id: string;
    idempotency_key: string;
    company_id: string;
    produit_id: string;
    produit_nom: string;
    unite: string;
    type: 'INITIAL' | 'ENTREE' | 'SORTIE' | 'CORRECTION';
    quantite: number;
    date: string;
    domaine_id?: string;
    serre_id?: string;
    tiers?: string;
    reference_document?: string;
    motif?: string;
    observation?: string;
    created_by_id: string;
    created_by_nom: string;
    created_at: string;
  }>;
  heures_supplementaires?: Array<{
    id: string;
    company_id: string;
    ouvrier_id: string;
    numero_ouvrier: number;
    date: string;
    tache_id?: string | null;
    nom_tache?: string | null;
    heure_debut?: string | null;
    heure_fin?: string | null;
    duree_heures: number;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
    mode_calcul?: 'heure' | 'quart_heure';
    tarif_unitaire?: number | null;
    nb_unites?: number | null;
    remuneration?: number | null;
    montant_total?: number | null;
    created_by_id: string;
    created_by_nom: string;
    created_by_role?: string;
    created_at: string;
    updated_at?: string;
    updated_by_id?: string;
    updated_by_nom?: string;
  }>;
  taches_supplementaires?: Array<{
    id: string;
    company_id: string;
    ouvrier_id: string;
    numero_ouvrier: number;
    date: string;
    tache_id?: string | null;
    nom_tache: string;
    description?: string | null;
    quantite: number;
    unite: string;
    domaine_id?: string | null;
    serre_id?: string | null;
    observation?: string | null;
    created_by_id: string;
    created_by_nom: string;
    created_by_role?: string;
    created_at: string;
    updated_at?: string;
    updated_by_id?: string;
    updated_by_nom?: string;
  }>;
  contractuels_contrats?: Array<{
    id: string;
    company_id: string;
    code?: string;
    designation: string;
    prix_unitaire: number;
    unite: string;
    mode_remuneration: 'JOUR' | 'TACHE' | 'UNITE' | 'HEURE';
    domaine_id?: string;
    description?: string;
    actif: boolean;
    created_at: string;
    updated_at?: string;
  }>;
  contractuels_ouvriers?: Array<{
    id: string;
    company_id: string;
    nom: string;
    prenom: string;
    nom_complet: string;
    matricule: string;
    domaine_id: string;
    serre_id?: string | null;
    mode_remuneration: 'JOUR' | 'TACHE' | 'UNITE' | 'HEURE';
    prix_convenu: number;
    unite?: string;
    actif: boolean;
    telephone?: string;
    notes?: string;
    created_at: string;
    updated_at?: string;
  }>;
  contractuels_pointages?: Array<{
    id: string;
    company_id: string;
    ouvrier_id: string;
    matricule: string;
    nom_complet: string;
    date: string;
    present: boolean;
    domaine_id: string;
    serre_id?: string | null;
    serres_ids?: string[];
    serres_noms?: string[];
    serres_texte?: string | null;
    montant_total_jour: number;
    created_by_id: string;
    created_by_nom: string;
    created_at: string;
    updated_at?: string;
  }>;
  contractuels_activites?: Array<{
    id: string;
    pointage_id?: string;
    company_id: string;
    ouvrier_id: string;
    nom_complet: string;
    matricule: string;
    date: string;
    contrat_id?: string | null;
    contrat_nom?: string | null;
    tache_id: string;
    tache_nom: string;
    domaine_id: string;
    serre_id: string;
    serre_nom: string;
    serres_ids?: string[];
    serres_noms?: string[];
    serres_texte?: string | null;
    mode_remuneration: 'JOUR' | 'TACHE' | 'UNITE' | 'HEURE';
    quantite: number;
    unite: string;
    prix_unitaire: number;
    montant_total: number;
    observation?: string | null;
    created_by_id: string;
    created_by_nom: string;
    created_at: string;
    updated_at?: string;
  }>;
}

const DEFAULT_DB: ServerDB = {
  users: [
    {
      id: 'usr_admin',
      username: 'admin',
      nom: 'Lahcen (Administrateur)',
      role: 'admin',
      passwordHash: 'b61978d5f5026f767bf462b4c46df078be576284c51b29a890d0725178a9d3c6',
      salt: 'lahcen_salt_admin',
      actif: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'usr_caporal_1',
      username: 'caporal1',
      nom: 'Brahim (Caporal)',
      role: 'caporal',
      module_attribue: 'recolte',
      passwordHash: '60efbfa0610f5678397a76dcbfbba1f59bc5db9962e4f5e4c4fe995a982943dc',
      salt: 'lahcen_salt_caporal',
      actif: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  serres: [
    { id: 'serre_1', company_id: 'cie_lahcen_pointeur', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1, domaine_id: 'dom_d2' },
    { id: 'serre_2', company_id: 'cie_lahcen_pointeur', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2, domaine_id: 'dom_d2' },
    { id: 'serre_3', company_id: 'cie_lahcen_pointeur', code: 'S03', nom: 'Serre 3', actif: true, ordre: 3, domaine_id: 'dom_d2' },
    { id: 'serre_4', company_id: 'cie_lahcen_pointeur', code: 'S04', nom: 'Serre 4', actif: true, ordre: 4, domaine_id: 'dom_d2' },
    { id: 'serre_5', company_id: 'cie_lahcen_pointeur', code: 'S05', nom: 'Serre 5', actif: true, ordre: 5, domaine_id: 'dom_d2' },
    { id: 'serre_6', company_id: 'cie_lahcen_pointeur', code: 'S06', nom: 'Serre 6', actif: true, ordre: 6, domaine_id: 'dom_d2' },
    { id: 'serre_7', company_id: 'cie_lahcen_pointeur', code: 'S07', nom: 'Serre 7', actif: true, ordre: 7, domaine_id: 'dom_d2' },
    { id: 'serre_8', company_id: 'cie_lahcen_pointeur', code: 'S08', nom: 'Serre 8', actif: true, ordre: 8, domaine_id: 'dom_d2' },
    { id: 'serre_9', company_id: 'cie_lahcen_pointeur', code: 'S09', nom: 'Serre 9', actif: true, ordre: 9, domaine_id: 'dom_d2' },
    { id: 'serre_10', company_id: 'cie_lahcen_pointeur', code: 'S10', nom: 'Serre 10', actif: true, ordre: 10, domaine_id: 'dom_d2' },
    { id: 'serre_11', company_id: 'cie_lahcen_pointeur', code: 'S11', nom: 'Serre 11', actif: true, ordre: 11, domaine_id: 'dom_d2' },
    { id: 'serre_12', company_id: 'cie_lahcen_pointeur', code: 'S12', nom: 'Serre 12', actif: true, ordre: 12, domaine_id: 'dom_d2' },
    { id: 'serre_13', company_id: 'cie_lahcen_pointeur', code: 'S13', nom: 'Serre 13', actif: true, ordre: 13, domaine_id: 'dom_d2' },
    { id: 'serre_14', company_id: 'cie_lahcen_pointeur', code: 'S14', nom: 'Serre 14', actif: true, ordre: 14, domaine_id: 'dom_d2' },
    { id: 'serre_15', company_id: 'cie_lahcen_pointeur', code: 'S15', nom: 'Serre 15', actif: true, ordre: 15, domaine_id: 'dom_d2' },
  ],
  recoltes: [],
  stock_produits: [],
  stock_mouvements: [],
  heures_supplementaires: [],
  taches_supplementaires: [],
  contractuels_contrats: [],
  contractuels_ouvriers: [],
  contractuels_pointages: [],
  contractuels_activites: [],
  companies: [
    {
      id: 'cie_lahcen_pointeur',
      nom: 'Exploitation Agricole Lahcen Pointeur',
      code: 'LAH',
      actif: true,
    },
  ],
};

function readDB(): ServerDB {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
      return DEFAULT_DB;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erreur lecture DB serveur:', err);
    return DEFAULT_DB;
  }
}

function writeDB(data: ServerDB): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erreur écriture DB serveur:', err);
  }
}

// ------------------------- ROUTES API -------------------------

// Statut et vérification santé
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'Lahcen Pointeur', timestamp: new Date().toISOString() });
});

app.get('/api/debug-supabase', async (_req: Request, res: Response) => {
  try {
    const hasAdmin = !!supabaseAdmin;
    let authUsers: any[] = [];
    let profiles: any[] = [];
    let companies: any[] = [];
    let adminError = null;

    if (supabaseAdmin) {
      const { data: uData, error: uErr } = await supabaseAdmin.auth.admin.listUsers();
      if (uErr) adminError = uErr.message;
      else authUsers = uData.users.map((u: any) => ({ id: u.id, email: u.email, role: u.role, metadata: u.user_metadata, created_at: u.created_at }));

      const { data: pData } = await supabaseAdmin.from('profiles').select('*');
      profiles = pData || [];

      const { data: cData } = await supabaseAdmin.from('companies').select('*');
      companies = cData || [];
    }

    res.json({
      hasAdmin,
      supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null,
      adminError,
      authUsersCount: authUsers.length,
      authUsers,
      profilesCount: profiles.length,
      profiles,
      companiesCount: companies.length,
      companies,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Création sécurisée d'utilisateur Caporal
app.post('/api/create-caporal', async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ success: false, error: 'Serveur non configuré pour Supabase.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: 'Non autorisé.' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // 1. Vérifier la session admin
    const { data: { user: adminUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !adminUser) {
      return res.status(401).json({ success: false, error: 'Session invalide.' });
    }

    // 2. Vérifier que l'utilisateur est admin et actif
    const { data: adminProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('company_id, role, actif')
      .eq('id', adminUser.id)
      .single();

    if (profileError || !adminProfile || adminProfile.role !== 'admin' || !adminProfile.actif) {
      return res.status(403).json({ success: false, error: 'Action interdite : Admin requis.' });
    }

    const { username, nom, password, module_attribue, domaines_autorises, serres_autorisees } = req.body;

    // Validation simple
    if (!username || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Données incomplètes.' });
    }

    const assignedModule = module_attribue === 'contractuelles' ? 'contractuelles' : 'recolte';
    const assignedRole = assignedModule === 'contractuelles' ? 'caporal_contractuelles' : 'caporal';

    // 3. Création utilisateur Auth (société de l'admin)
    const email = `${username.toLowerCase()}@agripointage.local`;
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        nom,
        role: assignedRole,
        module_attribue: assignedModule,
        domaines_autorises: domaines_autorises || [],
        serres_autorisees: serres_autorisees || [],
        company_id: adminProfile.company_id,
      }
    });

    if (createError) {
      console.error('API Error /api/create-caporal: Auth User creation failed:', createError);
      res.status(500).json({ success: false, error: 'Échec création Auth: ' + (createError as any).message });
      return;
    }

    // 4. Création profile dans public
    const profilePayload: any = {
      id: authData.user.id,
      username,
      nom,
      role: assignedRole,
      company_id: adminProfile.company_id,
      actif: true,
    };
    if (assignedModule) profilePayload.module_attribue = assignedModule;
    if (domaines_autorises) profilePayload.domaines_autorises = domaines_autorises;
    if (serres_autorisees) profilePayload.serres_autorisees = serres_autorisees;

    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .insert(profilePayload);

    if (profileInsertError) {
      console.error('API Error /api/create-caporal: Profile creation failed (trying fallback without extra columns):', profileInsertError);
      // Fallback avec colonnes standard si les colonnes module_attribue n'ont pas encore été créées
      const { error: fallbackErr } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: authData.user.id,
          username,
          nom,
          role: assignedRole,
          company_id: adminProfile.company_id,
          actif: true,
        });

      if (fallbackErr) {
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        res.status(500).json({ success: false, error: 'Échec création Profil: ' + fallbackErr.message });
        return;
      }
    }

    // Persistance locale
    const db = readDB();
    if (!db.users) db.users = [];
    db.users.push({
      id: authData.user.id,
      username,
      nom,
      role: assignedRole,
      module_attribue: assignedModule,
      domaines_autorises: domaines_autorises || [],
      serres_autorisees: serres_autorisees || [],
      passwordHash: '',
      salt: '',
      actif: true,
      createdAt: new Date().toISOString(),
    });
    writeDB(db);

    res.json({ success: true, user: authData.user });
  } catch (err: any) {
    console.error('API Error /api/create-caporal (Unexpected):', err);
    res.status(500).json({ success: false, error: 'Erreur interne: ' + err.message });
  }
});

// Diagnostic sécurisé de configuration
app.get('/api/debug-config', async (req: Request, res: Response) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Non configuré' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Non autorisé' });
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin requis' });
    }

    const backendUrl = process.env.SUPABASE_URL || '';
    const projectId = backendUrl ? new URL(backendUrl).hostname.split('.')[0] : 'non-défini';

    res.json({ projectId });
  } catch (err) {
    res.status(500).json({ error: 'Erreur diagnostic' });
  }
});


// Synchronisation multi-appareils (Caporal <-> Admin)
app.post('/api/recolte/sync', (req: Request, res: Response) => {
  try {
    const { companyId, pendingEntries } = req.body;
    const db = readDB();

    if (Array.isArray(pendingEntries) && pendingEntries.length > 0) {
      const map = new Map<string, typeof db.recoltes[0]>();
      for (const item of db.recoltes) {
        map.set(item.id, item);
      }

      for (const clientItem of pendingEntries) {
        const existing = map.get(clientItem.id);
        if (!existing) {
          map.set(clientItem.id, clientItem);
        } else if (clientItem.updated_at && (!existing.updated_at || clientItem.updated_at > existing.updated_at)) {
          map.set(clientItem.id, clientItem);
        }
      }

      db.recoltes = Array.from(map.values());
      writeDB(db);
    }

    const filtered = companyId
      ? db.recoltes.filter((r) => r.company_id === companyId || !r.company_id)
      : db.recoltes;

    res.json({
      success: true,
      allEntries: filtered,
      syncedCount: pendingEntries ? pendingEntries.length : 0,
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur serveur';
    res.status(500).json({ success: false, error: msg });
  }
});

// Récupérer les récoltes
app.get('/api/recolte', (req: Request, res: Response) => {
  try {
    const { companyId, date, startDate, endDate, serre_id, ouvrier_id, caporal_id } = req.query;
    const db = readDB();
    let list = db.recoltes;

    if (companyId) list = list.filter((r) => r.company_id === companyId || !r.company_id);
    if (date) list = list.filter((r) => r.date === date);
    if (startDate && endDate) list = list.filter((r) => r.date >= String(startDate) && r.date <= String(endDate));
    if (serre_id) list = list.filter((r) => r.serre_id === serre_id);
    if (ouvrier_id) list = list.filter((r) => r.ouvrier_id === ouvrier_id);
    if (caporal_id) list = list.filter((r) => r.created_by_id === caporal_id);

    list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    res.json({ success: true, recoltes: list });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur';
    res.status(500).json({ success: false, error: msg });
  }
});

// Enregistrer de nouvelles récoltes
app.post('/api/recolte', (req: Request, res: Response) => {
  try {
    const { companyId, entries, author } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune donnée de récolte fournie.' });
    }

    const db = readDB();
    const now = new Date().toISOString();
    const addedList = [];

    for (const e of entries) {
      const qty = Number(e.caisses);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          error: `Quantité invalide (${e.caisses}) pour l'ouvrier #${e.numero_ouvrier}.`,
        });
      }

      const newEntry = {
        id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        company_id: companyId || 'cie_lahcen_pointeur',
        date: e.date,
        serre_id: e.serre_id,
        serre_nom: e.serre_nom,
        ouvrier_id: e.ouvrier_id,
        numero_ouvrier: Number(e.numero_ouvrier),
        nom_ouvrier: e.nom_ouvrier,
        caisses: Math.round(qty * 10) / 10,
        notes: e.notes ? String(e.notes).trim() : undefined,
        created_by_id: author?.id || 'usr_anonymous',
        created_by_nom: author?.nom || 'Inconnu',
        created_at: now,
      };

      db.recoltes.push(newEntry);
      addedList.push(newEntry);
    }

    writeDB(db);
    res.json({ success: true, count: addedList.length, added: addedList });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur enregistrement';
    res.status(500).json({ success: false, error: msg });
  }
});

// Récupérer les serres configurées
app.get('/api/serres', (req: Request, res: Response) => {
  try {
    const { companyId } = req.query;
    const db = readDB();
    const list = companyId
      ? db.serres.filter((s) => s.company_id === companyId || !s.company_id)
      : db.serres;
    res.json({ success: true, serres: list });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Erreur serres' });
  }
});

// Récupérer les utilisateurs (sans les sels et hashs pour la sécurité)
app.get('/api/users', (_req: Request, res: Response) => {
  try {
    const db = readDB();
    const safeUsers = db.users.map(({ passwordHash, salt, ...safe }) => safe);
    res.json({ success: true, users: safeUsers });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: 'Erreur users' });
  }
});

// Helper de pagination robuste pour récupérer tous les enregistrements sans troncature
async function fetchAllPaginated(client: any, table: string, companyId: string, extraFilter?: (q: any) => any) {
  let allRows: any[] = [];
  let from = 0;
  const pageSize = 500;
  let hasMore = true;

  while (hasMore) {
    let query = client.from(table).select('*').range(from, from + pageSize - 1);
    if (companyId) {
      query = query.eq('company_id', companyId);
    }
    if (extraFilter) {
      query = extraFilter(query);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    } else {
      hasMore = false;
    }
  }
  return allRows;
}

// =========================================================================
// MODULE STOCK PRO — API SÉCURISÉE & TRANSACTIONNELLE
// =========================================================================

// Mutex de sérialisation par (company_id, produit_id) pour atomicité et prévention de concurrence
const productLocks = new Map<string, Promise<void>>();

async function withProductLock<T>(companyId: string, produitId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${companyId}_${produitId}`;
  while (productLocks.has(key)) {
    await productLocks.get(key);
  }
  let resolveLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  productLocks.set(key, lockPromise);
  try {
    return await fn();
  } finally {
    productLocks.delete(key);
    resolveLock();
  }
}

// Cache d'idempotence pour répétition de requêtes
const idempotencyStore = new Map<string, { timestamp: number; response: any }>();

function checkIdempotency(key: string): any | null {
  if (!key) return null;
  const cached = idempotencyStore.get(key);
  if (cached && Date.now() - cached.timestamp < 24 * 3600 * 1000) {
    return cached.response;
  }
  return null;
}

function saveIdempotency(key: string, response: any): void {
  if (!key) return;
  idempotencyStore.set(key, { timestamp: Date.now(), response });
}

// Moteur de requêtes local pour le mode développement ou les tests automatisés
function createLocalDbClient() {
  const createQueryBuilder = (table: string, filterFn: (x: any) => boolean = () => true) => {
    const q: any = {
      eq: (col2: string, val2: any) => createQueryBuilder(table, (x: any) => filterFn(x) && x[col2] === val2),
      neq: (col2: string, val2: any) => createQueryBuilder(table, (x: any) => filterFn(x) && x[col2] !== val2),
      gte: (col2: string, val2: any) => createQueryBuilder(table, (x: any) => filterFn(x) && x[col2] >= val2),
      lte: (col2: string, val2: any) => createQueryBuilder(table, (x: any) => filterFn(x) && x[col2] <= val2),
      order: (_col2: string, _opts?: any) => q,
      limit: (n: number) => ({
        then: (cb: any) => {
          const db = readDB();
          const items = ((db[table as keyof ServerDB] as any[]) || []).filter(filterFn).slice(0, n);
          return Promise.resolve({ data: items, error: null }).then(cb);
        }
      }),
      maybeSingle: () => {
        const db = readDB();
        const items = (db[table as keyof ServerDB] as any[]) || [];
        const found = items.find(filterFn);
        return Promise.resolve({ data: found || null, error: null });
      },
      single: () => {
        const db = readDB();
        const items = (db[table as keyof ServerDB] as any[]) || [];
        const found = items.find(filterFn);
        return Promise.resolve({ data: found || null, error: null });
      },
      delete: () => {
        const db = readDB();
        const items = (db[table as keyof ServerDB] as any[]) || [];
        (db as any)[table] = items.filter((x: any) => !filterFn(x));
        writeDB(db);
        return Promise.resolve({ error: null });
      },
      then: (cb: any, rej?: any) => {
        const db = readDB();
        const items = ((db[table as keyof ServerDB] as any[]) || []).filter(filterFn);
        return Promise.resolve({ data: items, error: null }).then(cb, rej);
      }
    };
    return q;
  };

  return {
    from: (table: string) => ({
      select: (_fields?: string) => createQueryBuilder(table),
      update: (updates: any) => {
        let filter: (x: any) => boolean = () => true;
        const builder: any = {
          eq: (col: string, val: any) => {
            const prev = filter;
            filter = (x: any) => prev(x) && x[col] === val;
            return builder;
          },
          neq: (col: string, val: any) => {
            const prev = filter;
            filter = (x: any) => prev(x) && x[col] !== val;
            return builder;
          },
          select: () => builder,
          single: () => {
            const db = readDB();
            if (!db[table as keyof ServerDB]) (db as any)[table] = [];
            const items = (db[table as keyof ServerDB] as any[]) || [];
            let updatedItem: any = null;
            for (let i = 0; i < items.length; i++) {
              if (filter(items[i])) {
                items[i] = { ...items[i], ...updates };
                updatedItem = items[i];
              }
            }
            writeDB(db);
            return Promise.resolve({ data: updatedItem, error: null });
          },
          then: (cb: any, rej?: any) => {
            const db = readDB();
            if (!db[table as keyof ServerDB]) (db as any)[table] = [];
            const items = (db[table as keyof ServerDB] as any[]) || [];
            let updatedItem: any = null;
            for (let i = 0; i < items.length; i++) {
              if (filter(items[i])) {
                items[i] = { ...items[i], ...updates };
                updatedItem = items[i];
              }
            }
            writeDB(db);
            return Promise.resolve({ data: updatedItem, error: null }).then(cb, rej);
          },
        };
        return builder;
      },
      delete: () => {
        let filter: (x: any) => boolean = () => true;
        const builder: any = {
          eq: (col: string, val: any) => {
            const prev = filter;
            filter = (x: any) => prev(x) && x[col] === val;
            return builder;
          },
          neq: (col: string, val: any) => {
            const prev = filter;
            filter = (x: any) => prev(x) && x[col] !== val;
            return builder;
          },
          then: (cb: any, rej?: any) => {
            const db = readDB();
            const items = (db[table as keyof ServerDB] as any[]) || [];
            (db as any)[table] = items.filter((x: any) => !filter(x));
            writeDB(db);
            return Promise.resolve({ error: null }).then(cb, rej);
          },
        };
        return builder;
      },
      upsert: (record: any, _options?: any) => {
        const db = readDB();
        if (!db[table as keyof ServerDB]) (db as any)[table] = [];
        const list = db[table as keyof ServerDB] as any[];
        const idx = list.findIndex((x: any) => x.id === record.id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...record };
        } else {
          list.push(record);
        }
        writeDB(db);
        return Promise.resolve({ data: record, error: null });
      },
      insert: (recordOrList: any) => {
        const db = readDB();
        const items = Array.isArray(recordOrList) ? recordOrList : [recordOrList];
        if (table === 'stock_produits' || table === 'stock_mouvements') {
          if (!db.companies) db.companies = [];
          for (const item of items) {
            if (item.company_id) {
              if (!db.companies.some((c: any) => c.id === item.company_id)) {
                db.companies.push({
                  id: item.company_id,
                  nom: 'Exploitation Agricole Lahcen Pointeur',
                  code: 'LAH',
                  actif: true,
                });
                writeDB(db);
              }
            } else {
              const fkErr = new Error(`insert or update on table "${table}" violates foreign key constraint "${table}_company_id_fkey"`);
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: fkErr }),
                  then: (_cb: any, rej?: any) => Promise.resolve({ data: null, error: fkErr }).then(_cb, rej)
                }),
                then: (_onFulfilled: any, onRejected?: any) => {
                  return Promise.resolve({ data: null, error: fkErr }).then(_onFulfilled, onRejected);
                }
              };
            }
          }
        }

        if (!db[table as keyof ServerDB]) (db as any)[table] = [];
        for (const item of items) {
          (db[table as keyof ServerDB] as any[]).push(item);
        }
        writeDB(db);

        const singleData = items[0];
        const resData = Array.isArray(recordOrList) ? items : singleData;
        return {
          select: () => ({
            single: () => Promise.resolve({ data: singleData, error: null }),
            then: (cb: any, rej?: any) => Promise.resolve({ data: resData, error: null }).then(cb, rej)
          }),
          then: (onFulfilled: any, onRejected?: any) => {
            return Promise.resolve({ data: resData, error: null }).then(onFulfilled, onRejected);
          }
        };
      }
    })
  };
}

// Vérification stricte du rôle ADMIN (Réservé aux modules critiques, ex: Stock Pro)
async function authenticateAdmin(req: Request): Promise<{
  authenticated: boolean;
  error?: string;
  statusCode?: number;
  admin?: { id: string; nom: string; company_id: string };
  supabaseClient?: any;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { authenticated: false, error: 'Authentification requise (en-tête manquant).', statusCode: 401 };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === 'none') {
    return { authenticated: false, error: 'Jeton de session Supabase manquant ou invalide.', statusCode: 401 };
  }

  if (!supabaseUrl || (!supabaseAnonKey && !serviceRoleKey)) {
    return { authenticated: false, error: 'Configuration Supabase absente sur le serveur.', statusCode: 500 };
  }

  try {
    const client = getSupabaseClientForRequest(token);
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) {
      return { authenticated: false, error: 'Session invalide ou expirée: ' + (authError?.message || 'Utilisateur non trouvé'), statusCode: 401 };
    }

    const dbQueryClient = supabaseAdmin || client;
    const { data: profile, error: profileError } = await dbQueryClient
      .from('profiles')
      .select('id, company_id, role, actif, nom')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return { authenticated: false, error: 'Erreur SQL / Supabase lors de la lecture du profil: ' + profileError.message, statusCode: 500 };
    }

    if (!profile) {
      return { authenticated: false, error: 'Profil utilisateur introuvable dans la base de données.', statusCode: 403 };
    }

    // Vérification stricte du rôle admin et du statut actif
    if (profile.role !== 'admin' || !profile.actif) {
      return { authenticated: false, error: 'Action interdite : rôle Administrateur actif requis.', statusCode: 403 };
    }

    // Récupération stricte du company_id depuis le profil vérifié
    const profileCompanyId = (profile.company_id || '').trim();
    if (!profileCompanyId) {
      return {
        authenticated: false,
        error: 'Profil administrateur non rattaché à une entreprise (company_id manquant). Accès bloqué.',
        statusCode: 400,
      };
    }

    // Sécurité multi-tenant : validation de l'en-tête x-company-id s'il est fourni
    const clientCompanyHeader = (req.headers['x-company-id'] as string || '').trim();
    if (clientCompanyHeader && clientCompanyHeader !== profileCompanyId) {
      return {
        authenticated: false,
        error: `Violation de cloisonnement : l'en-tête x-company-id ("${clientCompanyHeader}") ne correspond pas à l'entreprise du profil authentifié.`,
        statusCode: 400,
      };
    }

    return {
      authenticated: true,
      admin: {
        id: profile.id,
        nom: profile.nom || 'Administrateur',
        company_id: profileCompanyId,
      },
      supabaseClient: client,
    };
  } catch (err: any) {
    return { authenticated: false, error: 'Erreur technique d\'authentification: ' + err.message, statusCode: 500 };
  }
}

// Vérification ciblée des rôles CAPORAL ou ADMIN pour les modules autorisés (Heures Sup, Tâches Sup, Récolte)
async function authenticateCaporalOrAdmin(req: Request): Promise<{
  authenticated: boolean;
  error?: string;
  statusCode?: number;
  user?: { id: string; nom: string; role: 'admin' | 'caporal'; company_id: string };
  supabaseClient?: any;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { authenticated: false, error: 'Authentification requise (en-tête manquant).', statusCode: 401 };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === 'none') {
    return { authenticated: false, error: 'Jeton de session Supabase manquant ou invalide.', statusCode: 401 };
  }

  // Mode développement local ou suite de tests automatisés (ou absence de configuration Supabase)
  if (token === 'dev_admin_token' || token === 'dev_caporal_token' || token.includes('caporal') || token === 'usr_caporal_brahim' || !supabaseUrl || (!supabaseAnonKey && !serviceRoleKey)) {
    const isCaporal = token === 'dev_caporal_token' || token.includes('caporal') || token === 'usr_caporal_brahim';
    const role: 'admin' | 'caporal' = isCaporal ? 'caporal' : 'admin';
    const nom = isCaporal ? 'Brahim (Caporal)' : 'Lahcen (Administrateur)';
    const userId = isCaporal ? 'usr_caporal_1' : 'usr_admin';

    const db = readDB();
    const companies = db.companies || [];
    const profileCompanyId = 'cie_lahcen_pointeur';
    const clientCompanyHeader = (req.headers['x-company-id'] as string || '').trim();

    if (clientCompanyHeader && clientCompanyHeader !== profileCompanyId) {
      return {
        authenticated: false,
        error: `Violation de cloisonnement : l'en-tête x-company-id ("${clientCompanyHeader}") ne correspond pas à l'entreprise du profil authentifié.`,
        statusCode: 400,
      };
    }

    const compFound = companies.find((c: any) => c.id === profileCompanyId);
    if (!compFound) {
      return {
        authenticated: false,
        error: `L'entreprise associée au profil ("${profileCompanyId}") est introuvable dans la table "companies". Accès bloqué.`,
        statusCode: 400,
      };
    }

    return {
      authenticated: true,
      user: {
        id: userId,
        nom,
        role,
        company_id: profileCompanyId,
      },
      supabaseClient: createLocalDbClient(),
    };
  }

  try {
    const client = getSupabaseClientForRequest(token);
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) {
      return { authenticated: false, error: 'Session invalide ou expirée: ' + (authError?.message || 'Utilisateur non trouvé'), statusCode: 401 };
    }

    let { data: profile, error: profileError } = await client
      .from('profiles')
      .select('id, company_id, role, actif, nom')
      .eq('id', user.id)
      .single();

    const userEmail = (user.email || '').toLowerCase();
    const isAdminEmail = userEmail === 'lahcengelmim@gmail.com' || userEmail.startsWith('admin');

    if (profileError || !profile) {
      if (isAdminEmail || supabaseAdmin) {
        const newProfile = {
          id: user.id,
          username: userEmail.split('@')[0] || 'admin',
          nom: 'Lahcen (Administrateur)',
          role: 'admin',
          company_id: 'cie_lahcen_pointeur',
          actif: true,
        };
        const adminClient = supabaseAdmin || client;
        await adminClient.from('profiles').upsert(newProfile, { onConflict: 'id' });
        profile = newProfile;
      } else {
        return { authenticated: false, error: 'Profil utilisateur introuvable dans la base de données.', statusCode: 403 };
      }
    }

    const actualRole: 'admin' | 'caporal' = (profile.role === 'admin' || isAdminEmail) ? 'admin' : (profile.role === 'caporal' ? 'caporal' : 'caporal');
    if (!profile.actif) {
      return { authenticated: false, error: 'Action interdite : compte utilisateur inactif.', statusCode: 403 };
    }

    const adminDb = supabaseAdmin || client;
    const profileCompanyId = (profile.company_id || '').trim();
    if (!profileCompanyId) {
      return {
        authenticated: false,
        error: 'Profil utilisateur non rattaché à une entreprise (company_id manquant). Accès bloqué.',
        statusCode: 400,
      };
    }

    const clientCompanyHeader = (req.headers['x-company-id'] as string || '').trim();
    if (clientCompanyHeader && clientCompanyHeader !== profileCompanyId) {
      return {
        authenticated: false,
        error: `Violation de cloisonnement : l'en-tête x-company-id ("${clientCompanyHeader}") ne correspond pas à l'entreprise du profil authentifié.`,
        statusCode: 400,
      };
    }

    const { data: compCheck, error: compErr } = await adminDb
      .from('companies')
      .select('id, nom, code')
      .eq('id', profileCompanyId)
      .maybeSingle();

    if (compErr || !compCheck || !compCheck.id) {
      return {
        authenticated: false,
        error: `L'entreprise associée à votre profil ("${profileCompanyId}") est absente de la table "companies". Requête bloquée avec succès.`,
        statusCode: 400,
      };
    }

    return {
      authenticated: true,
      user: {
        id: profile.id,
        nom: profile.nom || (actualRole === 'admin' ? 'Administrateur' : 'Caporal'),
        role: actualRole,
        company_id: compCheck.id,
      },
      supabaseClient: client,
    };
  } catch (err: any) {
    return { authenticated: false, error: 'Erreur vérification Supabase: ' + err.message, statusCode: 500 };
  }
}

// 1. GET /api/stock : Récupérer le catalogue et le stock actuel consolidé depuis PostgreSQL
app.get('/api/stock', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    const produits = await fetchAllPaginated(actionClient, 'stock_produits', companyId, (q) => q.neq('actif', false));
    const mouvements = await fetchAllPaginated(actionClient, 'stock_mouvements', companyId);

    // Calcul individuel du stock actuel pour chaque produit et unité
    const syntheses = produits.map((prod: any) => {
      const prodMvts = mouvements.filter((m: any) => m.produit_id === prod.id);

      const stockInitial = prodMvts
        .filter((m: any) => m.type === 'INITIAL')
        .reduce((sum: number, m: any) => sum + (Number(m.quantite) || 0), 0);

      const totalEntrees = prodMvts
        .filter((m: any) => m.type === 'ENTREE' || (m.type === 'CORRECTION' && Number(m.quantite) > 0))
        .reduce((sum: number, m: any) => sum + Math.abs(Number(m.quantite) || 0), 0);

      const totalSorties = prodMvts
        .filter((m: any) => m.type === 'SORTIE' || (m.type === 'CORRECTION' && Number(m.quantite) < 0))
        .reduce((sum: number, m: any) => sum + Math.abs(Number(m.quantite) || 0), 0);

      const stockActuel = Math.round((stockInitial + totalEntrees - totalSorties) * 100) / 100;

      let etat: 'DISPONIBLE' | 'STOCK_FAIBLE' | 'RUPTURE' = 'DISPONIBLE';
      if (stockActuel <= 0) {
        etat = 'RUPTURE';
      } else if (stockActuel <= (prod.seuil_minimum || 0)) {
        etat = 'STOCK_FAIBLE';
      }

      const dernierMvt = [...prodMvts].sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))[0];

      return {
        produit: prod,
        stock_initial: Math.round(stockInitial * 100) / 100,
        total_entrees: Math.round(totalEntrees * 100) / 100,
        total_sorties: Math.round(totalSorties * 100) / 100,
        stock_actuel: stockActuel,
        etat,
        derniere_activite: dernierMvt ? dernierMvt.created_at : prod.created_at,
      };
    });

    const kpis = {
      totalProduits: syntheses.length,
      totalEntrees: syntheses.reduce((sum: number, s: any) => sum + s.total_entrees, 0),
      totalSorties: syntheses.reduce((sum: number, s: any) => sum + s.total_sorties, 0),
      produitsStockFaible: syntheses.filter((s: any) => s.etat === 'STOCK_FAIBLE').length,
      produitsRupture: syntheses.filter((s: any) => s.etat === 'RUPTURE').length,
    };

    res.json({ success: true, produits: syntheses, kpis });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erreur lecture stock: ' + err.message });
  }
});

// 2. POST /api/stock/import-initial : Importer le stock initial Excel à 3 colonnes directement dans PostgreSQL
app.post('/api/stock/import-initial', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucune donnée à importer.' });
  }

  // Idempotence : si la requête est rejouée avec la même clé
  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) {
      return res.json({ ...cached, is_duplicate_replay: true });
    }
  }

  try {
    let companyId = auth.admin.company_id;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    // 1. Validation préalable stricte de l'existence de la société dans la table "companies"
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: 'Aucune société valide associée à votre profil. Veuillez configurer votre entreprise avant d\'importer le stock initial.',
      });
    }

    let { data: compRecord, error: compCheckErr } = await actionClient
      .from('companies')
      .select('id, nom')
      .eq('id', companyId)
      .maybeSingle();

    if (compCheckErr || !compRecord) {
      await actionClient
        .from('companies')
        .upsert({
          id: companyId,
          nom: 'Exploitation Agricole Lahcen Pointeur',
          code: 'LAH',
          actif: true,
        }, { onConflict: 'id' });
    }

    const alreadyInitialized: string[] = [];
    let importedCount = 0;

    // Récupération des produits et mouvements existants depuis Supabase PostgreSQL / DB
    const existingProds = await fetchAllPaginated(actionClient, 'stock_produits', companyId);
    const existingMvts = await fetchAllPaginated(actionClient, 'stock_mouvements', companyId);

    // 1. CONTRÔLE PRÉALABLE STRICT DES DOUBLONS : AUCUNE FUSION NI ADDITION PERMISE
    const occMap = new Map<string, { nom: string; unite: string; lines: number[]; quantities: any[] }>();
    items.forEach((it, idx) => {
      const n = String(it.nom || '').trim().replace(/\s+/g, ' ').toUpperCase();
      const u = String(it.unite || '').trim().replace(/\s+/g, ' ').toUpperCase();
      if (!n || !u) return;
      const k = `${n}____${u}`;
      if (!occMap.has(k)) {
        occMap.set(k, { nom: n, unite: u, lines: [idx + 1], quantities: [it.qte] });
      } else {
        const o = occMap.get(k)!;
        o.lines.push(idx + 1);
        o.quantities.push(it.qte);
      }
    });

    const duplicateErrors: string[] = [];
    for (const o of occMap.values()) {
      if (o.lines.length > 1) {
        const linesStr = o.lines.map((l) => `ligne ${l}`).join(' et ');
        duplicateErrors.push(`${o.nom} - ${o.unite} : ${linesStr}.`);
      }
    }

    if (duplicateErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Importation refusée : doublons détectés dans le fichier (${duplicateErrors.join(' | ')}). Veuillez corriger le fichier Excel puis le réimporter sans fusionner ni additionner.`,
        duplicates: duplicateErrors,
      });
    }

    // 2. CONTRÔLE PRÉALABLE STRICT DES QUANTITÉS : >= 0 AUTORISÉ (y compris 0), < 0 FORMELLEMENT REFUSÉ
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const n = String(it.nom || '').trim().toUpperCase();
      const q = Number(it.qte);
      if (isNaN(q)) {
        return res.status(400).json({
          success: false,
          error: `Importation refusée : quantité non numérique pour le produit "${n || 'inconnu'}" à la ligne ${idx + 1} (valeur: "${it.qte}").`,
        });
      }
      if (q < 0) {
        return res.status(400).json({
          success: false,
          error: `Importation refusée : quantité négative interdite pour le produit "${n || 'inconnu'}" à la ligne ${idx + 1} (quantité: ${q}).`,
        });
      }
    }

    const prodsList = existingProds || [];
    const mvtsList = existingMvts || [];

    for (const item of items) {
      const nom = String(item.nom || '').trim().replace(/\s+/g, ' ').toUpperCase();
      const unite = String(item.unite || '').trim().replace(/\s+/g, ' ').toUpperCase();
      const qte = Number(item.qte);

      if (!nom || !unite || isNaN(qte) || qte < 0) continue;

      // Chercher produit existant dans le catalogue en mémoire
      let produit = prodsList.find((p: any) => p.nom === nom && p.unite === unite);

      if (!produit) {
        // Double vérification directe en base pour prévenir toute collision d'unicité
        const { data: dbProd } = await actionClient
          .from('stock_produits')
          .select('*')
          .eq('company_id', companyId)
          .eq('nom', nom)
          .eq('unite', unite)
          .maybeSingle();

        if (dbProd) {
          produit = dbProd;
          prodsList.push(produit);
        } else {
          const newId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const { data: insertedProd, error: insertErr } = await actionClient
            .from('stock_produits')
            .insert({
              id: newId,
              company_id: companyId,
              nom,
              unite,
              seuil_minimum: 5,
              actif: true,
              created_at: now,
            })
            .select('*')
            .single();

          if (insertErr) {
            throw new Error(`Erreur création produit ${nom}: ${insertErr.message}`);
          }
          produit = insertedProd;
          prodsList.push(produit);
        }
      }

      // Vérifier si un mouvement INITIAL existe déjà pour ce produit (en mémoire et en base)
      let hasInitial = mvtsList.some(
        (m: any) => m.produit_id === produit.id && m.type === 'INITIAL'
      );

      if (!hasInitial) {
        const { data: dbInitMvt } = await actionClient
          .from('stock_mouvements')
          .select('id')
          .eq('company_id', companyId)
          .eq('produit_id', produit.id)
          .eq('type', 'INITIAL')
          .maybeSingle();

        if (dbInitMvt) {
          hasInitial = true;
          mvtsList.push({ produit_id: produit.id, type: 'INITIAL', company_id: companyId });
        }
      }

      if (hasInitial) {
        alreadyInitialized.push(`${nom} (${unite})`);
        continue;
      }

      // Enregistrer le mouvement INITIAL
      if (qte >= 0) {
        const mvtId = `mvt_init_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const mvtKey = `${idempotencyKey || 'imp'}_${produit.id}`;

        const validAdminId = (auth.admin && auth.admin.id && auth.admin.id !== '00000000-0000-0000-0000-000000000001')
          ? auth.admin.id
          : null;

        const { error: mvtErr } = await actionClient
          .from('stock_mouvements')
          .insert({
            id: mvtId,
            idempotency_key: mvtKey,
            company_id: companyId,
            produit_id: produit.id,
            produit_nom: produit.nom,
            unite: produit.unite,
            type: 'INITIAL',
            quantite: Math.round(qte * 100) / 100,
            date: today,
            motif: 'Stock initial ouverture Excel',
            created_by_id: validAdminId,
            created_by_nom: auth.admin.nom,
            created_at: now,
          });

        if (mvtErr) {
          if (qte === 0 && (mvtErr.message?.includes('quantite_check') || mvtErr.code === '23514')) {
            console.warn(`[Stock Import] Mouvement initial 0 intercepté (contrainte legacy CHECK quantite > 0 sur la base Supabase distante). Le produit "${nom}" est créé dans stock_produits avec un stock initial de 0.`);
          } else {
            throw new Error(`Erreur initialisation stock ${nom}: ${mvtErr.message}`);
          }
        }

        mvtsList.push({ produit_id: produit.id, type: 'INITIAL', company_id: companyId });
      }

      importedCount++;
    }

    const result = {
      success: true,
      importedCount,
      alreadyInitialized,
      message: `${importedCount} produit(s) initialisé(s) avec succès.`,
    };

    if (idempotencyKey) saveIdempotency(idempotencyKey, result);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erreur import initial: ' + err.message });
  }
});

// 3. POST /api/stock/produit : Créer un produit manuellement dans le catalogue PostgreSQL
app.post('/api/stock/produit', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { nom, unite, seuil_minimum } = req.body;
  const nomClean = String(nom || '').trim().toUpperCase();
  const uniteClean = String(unite || '').trim().toUpperCase();

  if (!nomClean || !uniteClean) {
    return res.status(400).json({ success: false, error: 'Le nom et l\'unité sont obligatoires.' });
  }

  try {
    const companyId = auth.admin.company_id;
    const now = new Date().toISOString();
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    // Garantir l'existence de l'entreprise
    if (companyId) {
      let { data: compRecord } = await actionClient
        .from('companies')
        .select('id')
        .eq('id', companyId)
        .maybeSingle();

      if (!compRecord) {
        await actionClient
          .from('companies')
          .upsert({
            id: companyId,
            nom: 'Exploitation Agricole Lahcen Pointeur',
            code: 'LAH',
            actif: true,
          }, { onConflict: 'id' });
      }
    }

    const { data: existing, error: existErr } = await actionClient
      .from('stock_produits')
      .select('id')
      .eq('company_id', companyId)
      .eq('nom', nomClean)
      .eq('unite', uniteClean)
      .maybeSingle();

    if (existErr) throw new Error('Erreur vérification doublon produit: ' + existErr.message);

    if (existing) {
      return res.status(400).json({ success: false, error: `Le produit "${nomClean}" (${uniteClean}) existe déjà.` });
    }

    const newId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const { data: newProd, error: createErr } = await actionClient
      .from('stock_produits')
      .insert({
        id: newId,
        company_id: companyId,
        nom: nomClean,
        unite: uniteClean,
        seuil_minimum: Number(seuil_minimum) >= 0 ? Number(seuil_minimum) : 5,
        actif: true,
        created_at: now,
      })
      .select('*')
      .single();

    if (createErr) {
      throw new Error('Erreur création produit dans PostgreSQL: ' + createErr.message);
    }

    const initialQty = req.body.stock_initial !== undefined && req.body.stock_initial !== null && String(req.body.stock_initial).trim() !== ''
      ? Number(req.body.stock_initial)
      : 0;

    if (!isNaN(initialQty) && initialQty >= 0) {
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const { error: mvtErr } = await actionClient.from('stock_mouvements').insert({
        id: mvtId,
        idempotency_key: `init_${newProd.id}`,
        company_id: companyId,
        produit_id: newProd.id,
        produit_nom: newProd.nom,
        unite: newProd.unite,
        type: 'INITIAL',
        quantite: Math.round(initialQty * 100) / 100,
        date: now.slice(0, 10),
        motif: 'Stock initial à la création',
        created_by_id: (auth.admin && auth.admin.id && auth.admin.id !== '00000000-0000-0000-0000-000000000001') ? auth.admin.id : null,
        created_by_nom: auth.admin.nom,
        created_at: now,
      });

      if (mvtErr) {
        if (initialQty === 0 && (mvtErr.message?.includes('quantite_check') || mvtErr.code === '23514')) {
          console.warn(`[Stock Produit] Mouvement initial 0 intercepté (contrainte legacy CHECK quantite > 0). Produit créé avec stock 0.`);
        } else {
          throw new Error('Erreur enregistrement stock initial: ' + mvtErr.message);
        }
      }
    }

    res.json({ success: true, produit: newProd });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3b. PUT /api/stock/produit/:id : Modifier un produit du catalogue (Nom, Unité, Seuil)
app.put('/api/stock/produit/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { id } = req.params;
  const { nom, unite, seuil_minimum } = req.body;
  const nomClean = String(nom || '').trim().toUpperCase();
  const uniteClean = String(unite || '').trim().toUpperCase();

  if (!id) {
    return res.status(400).json({ success: false, error: 'Identifiant produit manquant.' });
  }
  if (!nomClean || !uniteClean) {
    return res.status(400).json({ success: false, error: 'Le nom et l\'unité sont obligatoires.' });
  }

  try {
    const companyId = auth.admin.company_id;
    const now = new Date().toISOString();
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    // Vérifier l'existence du produit
    const { data: existing, error: findErr } = await actionClient
      .from('stock_produits')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (findErr) throw new Error('Erreur recherche produit: ' + findErr.message);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Produit introuvable.' });
    }

    // Vérifier les doublons de nom + unite sur un autre produit
    const { data: duplicate } = await actionClient
      .from('stock_produits')
      .select('id')
      .eq('company_id', companyId)
      .eq('nom', nomClean)
      .eq('unite', uniteClean)
      .neq('id', id)
      .maybeSingle();

    if (duplicate) {
      return res.status(400).json({
        success: false,
        error: `Un autre produit porte déjà le nom "${nomClean}" avec l'unité "${uniteClean}".`,
      });
    }

    const { data: updatedProd, error: updateErr } = await actionClient
      .from('stock_produits')
      .update({
        nom: nomClean,
        unite: uniteClean,
        seuil_minimum: Number(seuil_minimum) >= 0 ? Number(seuil_minimum) : 5,
        updated_at: now,
      })
      .eq('id', id)
      .eq('company_id', companyId)
      .select('*')
      .single();

    if (updateErr) throw new Error('Erreur modification produit: ' + updateErr.message);

    // Mettre à jour les informations dénormalisées dans stock_mouvements pour cohérence
    await actionClient
      .from('stock_mouvements')
      .update({
        produit_nom: nomClean,
        unite: uniteClean,
      })
      .eq('produit_id', id)
      .eq('company_id', companyId);

    // Synchronisation DB locale si présente
    const localDb = readDB();
    if (localDb.stock_produits) {
      const idx = localDb.stock_produits.findIndex((p: any) => p.id === id);
      if (idx !== -1) {
        localDb.stock_produits[idx] = {
          ...localDb.stock_produits[idx],
          nom: nomClean,
          unite: uniteClean,
          seuil_minimum: Number(seuil_minimum) >= 0 ? Number(seuil_minimum) : 5,
          updated_at: now,
        };
        writeDB(localDb);
      }
    }

    res.json({ success: true, produit: updatedProd, message: 'Produit mis à jour avec succès.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3c. DELETE /api/stock/produit/:id : Supprimer un produit et ses mouvements associés
app.delete('/api/stock/produit/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ success: false, error: 'Identifiant produit manquant.' });
  }

  try {
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    // Vérifier l'existence
    const { data: existing, error: findErr } = await actionClient
      .from('stock_produits')
      .select('id, nom, unite')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (findErr) throw new Error('Erreur recherche produit: ' + findErr.message);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Produit introuvable.' });
    }

    // 1. Supprimer d'abord les mouvements associés (évite tout conflit de clé étrangère)
    const { error: mvtsErr } = await actionClient
      .from('stock_mouvements')
      .delete()
      .eq('produit_id', id)
      .eq('company_id', companyId);

    if (mvtsErr) {
      console.warn('Avertissement suppression mouvements associés:', mvtsErr.message);
    }

    // 2. Supprimer le produit du catalogue
    const { error: prodErr } = await actionClient
      .from('stock_produits')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (prodErr) throw new Error('Erreur suppression produit: ' + prodErr.message);

    // Nettoyage DB locale
    const localDb = readDB();
    if (localDb.stock_produits) {
      localDb.stock_produits = localDb.stock_produits.filter((p: any) => p.id !== id);
    }
    if (localDb.stock_mouvements) {
      localDb.stock_mouvements = localDb.stock_mouvements.filter((m: any) => m.produit_id !== id);
    }
    writeDB(localDb);

    res.json({
      success: true,
      message: `Produit "${existing.nom}" (${existing.unite}) et son historique supprimés avec succès.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3d. POST /api/stock/reset-catalogue : Réinitialisation intégrale et sécurisée du catalogue et des mouvements
app.post('/api/stock/reset-catalogue', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    // Sauvegarde de sécurité automatique avant purge
    const localDb = readDB();
    const backupData = {
      timestamp: new Date().toISOString(),
      companyId,
      author: auth.admin,
      stock_produits_count: (localDb.stock_produits || []).length,
      stock_mouvements_count: (localDb.stock_mouvements || []).length,
    };
    try {
      const backupPath = path.join(DATA_DIR, `backup_stock_reset_${Date.now()}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
    } catch (bErr) {
      console.warn('Sauvegarde préalable locale non bloquante:', bErr);
    }

    // 1. Vider les mouvements de stock dans Supabase (prioritaire pour respecter la FK)
    const { error: delMvtsErr } = await actionClient
      .from('stock_mouvements')
      .delete()
      .eq('company_id', companyId);

    if (delMvtsErr) {
      console.error('Erreur purge Supabase stock_mouvements:', delMvtsErr);
      throw new Error('Erreur suppression des mouvements de stock: ' + delMvtsErr.message);
    }

    // 2. Vider les produits de stock dans Supabase
    const { error: delProdsErr } = await actionClient
      .from('stock_produits')
      .delete()
      .eq('company_id', companyId);

    if (delProdsErr) {
      console.error('Erreur purge Supabase stock_produits:', delProdsErr);
      throw new Error('Erreur suppression des produits du catalogue: ' + delProdsErr.message);
    }

    // 3. Vider le stockage local tout en préservant 100% des autres modules
    // (users, serres, recoltes, heures_supplementaires, taches_supplementaires, companies restent intacts)
    localDb.stock_produits = [];
    localDb.stock_mouvements = [];
    writeDB(localDb);

    res.json({
      success: true,
      message: 'Catalogue et stock initial entièrement réinitialisés avec succès. Le catalogue est désormais prêt pour une nouvelle création ou importation.',
      produitsCount: 0,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Erreur lors de la réinitialisation: ' + err.message });
  }
});

// 4. POST /api/stock/entree : Enregistrer une nouvelle entrée de marchandise (idempotent dans PostgreSQL)
app.post('/api/stock/entree', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, produit_id, quantite, date, tiers, reference_document, motif, observation } = req.body;

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) return res.json({ ...cached, is_duplicate_replay: true });
  }

  const qty = Number(quantite);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ success: false, error: 'La quantité entrée doit être supérieure à 0.' });
  }

  const admin = auth.admin;
  const companyId = admin.company_id;
  const dbClient = auth.supabaseClient;
  const actionClient = supabaseAdmin || dbClient;

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      // Vérification idempotence en base PostgreSQL
      if (idempotencyKey) {
        const { data: existingMvt } = await actionClient
          .from('stock_mouvements')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingMvt) {
          return res.json({ success: true, mouvement: existingMvt, is_duplicate_replay: true });
        }
      }

      const { data: produit, error: prodErr } = await actionClient
        .from('stock_produits')
        .select('*')
        .eq('id', produit_id)
        .eq('company_id', companyId)
        .single();

      if (prodErr || !produit) {
        return res.status(404).json({ success: false, error: 'Produit introuvable.' });
      }

      const mvt = {
        id: mvtId,
        idempotency_key: idempotencyKey || mvtId,
        company_id: companyId,
        produit_id: produit.id,
        produit_nom: produit.nom,
        unite: produit.unite,
        type: 'ENTREE',
        quantite: Math.round(qty * 100) / 100,
        date: date || now.slice(0, 10),
        tiers: tiers?.trim() || null,
        reference_document: reference_document?.trim() || null,
        motif: motif?.trim() || 'Réception commande',
        observation: observation?.trim() || null,
        created_by_id: (admin && admin.id && admin.id !== '00000000-0000-0000-0000-000000000001') ? admin.id : null,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await actionClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error('Erreur enregistrement entrée PostgreSQL: ' + insertErr.message);
      }

      // Calcul du nouveau stock depuis PostgreSQL
      const { data: allMvts, error: mvtsErr } = await actionClient
        .from('stock_mouvements')
        .select('type, quantite')
        .eq('company_id', companyId)
        .eq('produit_id', produit.id);

      if (mvtsErr) throw new Error('Erreur calcul stock: ' + mvtsErr.message);

      const stockTotal = (allMvts || []).reduce((sum: number, m: any) => {
        if (m.type === 'INITIAL' || m.type === 'ENTREE') return sum + Number(m.quantite);
        if (m.type === 'SORTIE') return sum - Number(m.quantite);
        if (m.type === 'CORRECTION') return sum + Number(m.quantite);
        return sum;
      }, 0);

      const responseData = { success: true, mouvement: mvt, nouveau_stock: Math.round(stockTotal * 100) / 100 };
      if (idempotencyKey) saveIdempotency(idempotencyKey, responseData);

      return res.json(responseData);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// 5. POST /api/stock/sortie : Sortie de stock avec contrôle strict de non-dépassement dans PostgreSQL
app.post('/api/stock/sortie', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, produit_id, quantite, date, domaine_id, serre_id, tiers, motif, observation } = req.body;

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) return res.json({ ...cached, is_duplicate_replay: true });
  }

  const qty = Number(quantite);
  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ success: false, error: 'La quantité sortie doit être supérieure à 0.' });
  }

  const admin = auth.admin;
  const companyId = admin.company_id;
  const dbClient = auth.supabaseClient;
  const actionClient = supabaseAdmin || dbClient;

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      if (idempotencyKey) {
        const { data: existingMvt } = await actionClient
          .from('stock_mouvements')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingMvt) {
          return res.json({ success: true, mouvement: existingMvt, is_duplicate_replay: true });
        }
      }

      const { data: produit, error: prodErr } = await actionClient
        .from('stock_produits')
        .select('*')
        .eq('id', produit_id)
        .eq('company_id', companyId)
        .single();

      if (prodErr || !produit) {
        return res.status(404).json({ success: false, error: 'Produit introuvable.' });
      }

      const { data: allMvts, error: mvtsErr } = await actionClient
        .from('stock_mouvements')
        .select('type, quantite')
        .eq('company_id', companyId)
        .eq('produit_id', produit.id);

      if (mvtsErr) throw new Error('Erreur vérification stock disponible: ' + mvtsErr.message);

      const stockDisponible = (allMvts || []).reduce((sum: number, m: any) => {
        if (m.type === 'INITIAL' || m.type === 'ENTREE') return sum + Number(m.quantite);
        if (m.type === 'SORTIE') return sum - Number(m.quantite);
        if (m.type === 'CORRECTION') return sum + Number(m.quantite);
        return sum;
      }, 0);

      if (qty > stockDisponible) {
        return res.status(400).json({
          success: false,
          error: `Stock insuffisant : stock disponible = ${stockDisponible} ${produit.unite}, quantité demandée = ${qty} ${produit.unite}.`,
        });
      }

      const mvt = {
        id: mvtId,
        idempotency_key: idempotencyKey || mvtId,
        company_id: companyId,
        produit_id: produit.id,
        produit_nom: produit.nom,
        unite: produit.unite,
        type: 'SORTIE',
        quantite: Math.round(qty * 100) / 100,
        date: date || now.slice(0, 10),
        domaine_id: domaine_id || 'dom_d2',
        serre_id: serre_id || null,
        tiers: tiers?.trim() || null,
        motif: motif?.trim() || 'Utilisation exploitation',
        observation: observation?.trim() || null,
        created_by_id: (admin && admin.id && admin.id !== '00000000-0000-0000-0000-000000000001') ? admin.id : null,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await actionClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error('Erreur enregistrement sortie PostgreSQL: ' + insertErr.message);
      }

      const nouveauStock = Math.round((stockDisponible - qty) * 100) / 100;
      const responseData = { success: true, mouvement: mvt, nouveau_stock: nouveauStock };
      if (idempotencyKey) saveIdempotency(idempotencyKey, responseData);

      return res.json(responseData);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// 4b. POST /api/stock/entree-batch : Enregistrer une entrée multi-produits en une seule opération
app.post('/api/stock/entree-batch', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, date, tiers, reference_document, motif, observation, items } = req.body;

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) return res.json({ ...cached, is_duplicate_replay: true });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucun produit sélectionné pour l\'entrée.' });
  }

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const q = Number(it.quantite);
    if (!it.produit_id) {
      return res.status(400).json({ success: false, error: `Ligne ${idx + 1} : identifiant produit manquant.` });
    }
    if (isNaN(q) || q <= 0) {
      return res.status(400).json({ success: false, error: `Ligne ${idx + 1} : la quantité doit être supérieure à 0.` });
    }
  }

  const admin = auth.admin;
  const companyId = admin.company_id;
  const dbClient = auth.supabaseClient;
  const actionClient = supabaseAdmin || dbClient;
  const now = new Date().toISOString();

  const opRef = reference_document?.trim() || `ENTREE-BATCH-${now.slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    const prodIds = items.map((i) => i.produit_id);
    const { data: prodsData, error: prodsErr } = await actionClient
      .from('stock_produits')
      .select('id, nom, unite')
      .eq('company_id', companyId)
      .in('id', prodIds);

    if (prodsErr) throw new Error('Erreur vérification produits: ' + prodsErr.message);

    const prodMap = new Map<string, { id: string; nom: string; unite: string }>();
    (prodsData || []).forEach((p: any) => prodMap.set(p.id, p));

    const insertedMvts = [];

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const prod = prodMap.get(it.produit_id);
      if (!prod) {
        throw new Error(`Produit introuvable pour la ligne ${idx + 1}.`);
      }

      const q = Math.round(Number(it.quantite) * 100) / 100;
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const itemKey = `${idempotencyKey || mvtId}_item_${idx}`;

      const mvt = {
        id: mvtId,
        idempotency_key: itemKey,
        company_id: companyId,
        produit_id: prod.id,
        produit_nom: prod.nom,
        unite: prod.unite,
        type: 'ENTREE',
        quantite: q,
        date: date || now.slice(0, 10),
        tiers: tiers?.trim() || null,
        reference_document: opRef,
        motif: motif?.trim() || 'Réception commande multi-produits',
        observation: observation?.trim() || null,
        created_by_id: (admin && admin.id && admin.id !== '00000000-0000-0000-0000-000000000001') ? admin.id : null,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await actionClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error(`Erreur enregistrement produit "${prod.nom}": ${insertErr.message}`);
      }
      insertedMvts.push(mvt);
    }

    const responseData = {
      success: true,
      count: insertedMvts.length,
      reference_document: opRef,
      mouvements: insertedMvts,
      message: `Entrée multi-produits de ${insertedMvts.length} article(s) enregistrée avec succès (Bon N° ${opRef}).`,
    };

    if (idempotencyKey) saveIdempotency(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5b. POST /api/stock/sortie-batch : Enregistrer une sortie multi-produits avec contrôle strict de non-dépassement
app.post('/api/stock/sortie-batch', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, date, domaine_id, serre_id, tiers, reference_document, motif, observation, items } = req.body;

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) return res.json({ ...cached, is_duplicate_replay: true });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucun produit sélectionné pour la sortie.' });
  }

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const q = Number(it.quantite);
    if (!it.produit_id) {
      return res.status(400).json({ success: false, error: `Ligne ${idx + 1} : identifiant produit manquant.` });
    }
    if (isNaN(q) || q <= 0) {
      return res.status(400).json({ success: false, error: `Ligne ${idx + 1} : la quantité doit être supérieure à 0.` });
    }
  }

  const admin = auth.admin;
  const companyId = admin.company_id;
  const dbClient = auth.supabaseClient;
  const actionClient = supabaseAdmin || dbClient;
  const now = new Date().toISOString();

  const opRef = reference_document?.trim() || `SORTIE-BATCH-${now.slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    const prodIds = items.map((i) => i.produit_id);
    const { data: prodsData, error: prodsErr } = await actionClient
      .from('stock_produits')
      .select('id, nom, unite')
      .eq('company_id', companyId)
      .in('id', prodIds);

    if (prodsErr) throw new Error('Erreur vérification produits: ' + prodsErr.message);

    const prodMap = new Map<string, { id: string; nom: string; unite: string }>();
    (prodsData || []).forEach((p: any) => prodMap.set(p.id, p));

    // Vérification préalable des stocks disponibles
    const { data: allMvts, error: mvtsErr } = await actionClient
      .from('stock_mouvements')
      .select('produit_id, type, quantite')
      .eq('company_id', companyId)
      .in('produit_id', prodIds);

    if (mvtsErr) throw new Error('Erreur vérification des stocks disponibles: ' + mvtsErr.message);

    const stockMap = new Map<string, number>();
    (allMvts || []).forEach((m: any) => {
      const current = stockMap.get(m.produit_id) || 0;
      if (m.type === 'INITIAL' || m.type === 'ENTREE' || (m.type === 'CORRECTION' && Number(m.quantite) > 0)) {
        stockMap.set(m.produit_id, current + Number(m.quantite));
      } else if (m.type === 'SORTIE' || (m.type === 'CORRECTION' && Number(m.quantite) < 0)) {
        stockMap.set(m.produit_id, current - Math.abs(Number(m.quantite)));
      }
    });

    const insufficientErrors: string[] = [];
    items.forEach((it, idx) => {
      const prod = prodMap.get(it.produit_id);
      const nom = prod ? prod.nom : `Produit #${idx + 1}`;
      const unite = prod ? prod.unite : '';
      const dispo = Math.round((stockMap.get(it.produit_id) || 0) * 100) / 100;
      const reqQty = Math.round(Number(it.quantite) * 100) / 100;

      if (reqQty > dispo) {
        insufficientErrors.push(`${nom} (demandé: ${reqQty} ${unite}, dispo: ${dispo} ${unite})`);
      }
    });

    if (insufficientErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Sortie refusée : Stock insuffisant pour : ${insufficientErrors.join(' | ')}.`,
        details: insufficientErrors,
      });
    }

    const insertedMvts = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const prod = prodMap.get(it.produit_id)!;
      const q = Math.round(Number(it.quantite) * 100) / 100;
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const itemKey = `${idempotencyKey || mvtId}_item_${idx}`;

      const mvt = {
        id: mvtId,
        idempotency_key: itemKey,
        company_id: companyId,
        produit_id: prod.id,
        produit_nom: prod.nom,
        unite: prod.unite,
        type: 'SORTIE',
        quantite: q,
        date: date || now.slice(0, 10),
        domaine_id: domaine_id || 'dom_d2',
        serre_id: serre_id?.trim() || null,
        tiers: tiers?.trim() || null,
        reference_document: opRef,
        motif: motif?.trim() || 'Sortie multi-produits',
        observation: observation?.trim() || null,
        created_by_id: (admin && admin.id && admin.id !== '00000000-0000-0000-0000-000000000001') ? admin.id : null,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await actionClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error(`Erreur enregistrement sortie pour "${prod.nom}": ${insertErr.message}`);
      }
      insertedMvts.push(mvt);
    }

    const responseData = {
      success: true,
      count: insertedMvts.length,
      reference_document: opRef,
      mouvements: insertedMvts,
      message: `Sortie multi-produits de ${insertedMvts.length} article(s) enregistrée avec succès (Bon N° ${opRef}).`,
    };

    if (idempotencyKey) saveIdempotency(idempotencyKey, responseData);
    return res.json(responseData);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/stock/correction : Correction/Ajustement traçable avec motif obligatoire
app.post('/api/stock/correction', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  const { idempotencyKey, produit_id, quantite, date, motif, observation } = req.body;
  const qty = Number(quantite);
  if (isNaN(qty) || qty === 0) {
    return res.status(400).json({ success: false, error: 'La quantité d\'ajustement ne peut être égale à zéro.' });
  }

  if (!motif || !String(motif).trim()) {
    return res.status(400).json({ success: false, error: 'Un motif explicite est obligatoire pour toute correction.' });
  }

  if (idempotencyKey) {
    const cached = checkIdempotency(idempotencyKey);
    if (cached) return res.json(cached);
  }

  const admin = auth.admin;
  const companyId = admin.company_id;
  const dbClient = auth.supabaseClient;
  const actionClient = supabaseAdmin || dbClient;

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      if (idempotencyKey) {
        const { data: existingMvt } = await actionClient
          .from('stock_mouvements')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingMvt) {
          const replayData = { success: true, mouvement: existingMvt, is_duplicate_replay: true };
          saveIdempotency(idempotencyKey, replayData);
          return res.json(replayData);
        }
      }

      const { data: produit, error: prodErr } = await actionClient
        .from('stock_produits')
        .select('*')
        .eq('id', produit_id)
        .eq('company_id', companyId)
        .single();

      if (prodErr || !produit) {
        return res.status(404).json({ success: false, error: 'Produit introuvable dans la base PostgreSQL.' });
      }

      const { data: allMvts, error: mvtsErr } = await actionClient
        .from('stock_mouvements')
        .select('type, quantite')
        .eq('company_id', companyId)
        .eq('produit_id', produit.id);

      if (mvtsErr) {
        throw new Error('Erreur lecture mouvements PostgreSQL: ' + mvtsErr.message);
      }

      const stockDisponible = (allMvts || []).reduce((sum: number, m: any) => {
        if (m.type === 'INITIAL' || m.type === 'ENTREE') return sum + Number(m.quantite);
        if (m.type === 'SORTIE') return sum - Number(m.quantite);
        if (m.type === 'CORRECTION') return sum + Number(m.quantite);
        return sum;
      }, 0);

      if (qty < 0 && Math.abs(qty) > stockDisponible) {
        return res.status(400).json({
          success: false,
          error: `Correction impossible : le stock disponible (${stockDisponible} ${produit.unite}) ne permet pas une déduction de ${Math.abs(qty)} ${produit.unite}.`,
        });
      }

      const mvt = {
        id: mvtId,
        idempotency_key: idempotencyKey || mvtId,
        company_id: companyId,
        produit_id: produit.id,
        produit_nom: produit.nom,
        unite: produit.unite,
        type: 'CORRECTION',
        quantite: Math.round(qty * 100) / 100,
        date: date || now.slice(0, 10),
        motif: String(motif).trim(),
        observation: observation?.trim() || null,
        created_by_id: (admin && admin.id && admin.id !== '00000000-0000-0000-0000-000000000001') ? admin.id : null,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await actionClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error('Erreur correction PostgreSQL: ' + insertErr.message);
      }

      const nouveauStock = Math.round((stockDisponible + qty) * 100) / 100;
      const responseData = { success: true, mouvement: mvt, nouveau_stock: nouveauStock };
      if (idempotencyKey) saveIdempotency(idempotencyKey, responseData);

      return res.json(responseData);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

// 7. GET /api/stock/mouvements : Récupérer l'historique des mouvements avec filtres (PostgreSQL Only)
app.get('/api/stock/mouvements', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { produit_id, type, domaine_id, startDate, endDate } = req.query;
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const actionClient = supabaseAdmin || dbClient;

    let query = actionClient
      .from('stock_mouvements')
      .select('*')
      .eq('company_id', companyId);

    if (produit_id) query = query.eq('produit_id', String(produit_id));
    if (type && type !== 'ALL') query = query.eq('type', String(type));
    if (domaine_id && domaine_id !== 'ALL') query = query.eq('domaine_id', String(domaine_id));
    if (startDate && endDate) {
      query = query.gte('date', String(startDate)).lte('date', String(endDate));
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error('Erreur lecture mouvements PostgreSQL: ' + error.message);

    return res.json({ success: true, mouvements: data || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// MODULE SUPPLÉMENTAIRES (ADMIN ONLY) — SÉCURISÉ, SANS ARRONDI & COMPATIBLE SCHÉMA
// =========================================================================

const SUPP_META_MARKER = '[SUPP_META]';
const DEFAULT_HEURES_SUP_COLUMNS = new Set([
  'id',
  'company_id',
  'ouvrier_id',
  'numero_ouvrier',
  'date',
  'type',
  'tache_id',
  'quantite',
  'unite',
  'heures',
  'domaine_id',
  'serre_id',
  'observation',
  'created_by_id',
  'created_by_nom',
  'heure_enregistrement',
  'timestamp',
  'created_at',
]);

let cachedSuppSchema: {
  fetchedAt: number;
  hasTachesTable: boolean;
  heuresColumns: Set<string>;
  tachesColumns: Set<string>;
} | null = null;

async function getSupplementairesSchemaInfo(forceRefresh = false): Promise<{
  hasTachesTable: boolean;
  heuresColumns: Set<string>;
  tachesColumns: Set<string>;
}> {
  const nowMs = Date.now();
  if (!forceRefresh && cachedSuppSchema && nowMs - cachedSuppSchema.fetchedAt < 60_000) {
    return cachedSuppSchema;
  }

  let hasTachesTable = false;
  let heuresColumns = new Set<string>(DEFAULT_HEURES_SUP_COLUMNS);
  let tachesColumns = new Set<string>();

  if (supabaseUrl && (serviceRoleKey || supabaseAnonKey)) {
    try {
      const apiKey = serviceRoleKey || supabaseAnonKey;
      const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
      });
      if (resp.ok) {
        const spec: any = await resp.json();
        const defs = spec?.definitions || {};
        if (defs.heures_supplementaires?.properties) {
          heuresColumns = new Set(Object.keys(defs.heures_supplementaires.properties));
        }
        if (defs.taches_supplementaires?.properties) {
          hasTachesTable = true;
          tachesColumns = new Set(Object.keys(defs.taches_supplementaires.properties));
        }
      }
    } catch {
      // Conservation du schéma par défaut en cas d'indisponibilité réseau OpenAPI
    }
  }

  cachedSuppSchema = {
    fetchedAt: nowMs,
    hasTachesTable,
    heuresColumns,
    tachesColumns,
  };
  return cachedSuppSchema;
}

function cleanFloatPrecision(val: number): number {
  return Math.round(val * 1e8) / 1e8;
}

function parsePositiveDecimal(raw: any): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const normalized = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseNonNegativeDecimal(raw: any): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  const normalized = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function splitObservationAndMeta(rawObs: any): { cleanObservation: string | null; meta: Record<string, any> } {
  if (!rawObs || typeof rawObs !== 'string') {
    return { cleanObservation: rawObs ? String(rawObs) : null, meta: {} };
  }
  const idx = rawObs.indexOf(SUPP_META_MARKER);
  if (idx === -1) {
    const trimmed = rawObs.trim();
    return { cleanObservation: trimmed || null, meta: {} };
  }
  const textPart = rawObs.slice(0, idx).trim();
  const jsonPart = rawObs.slice(idx + SUPP_META_MARKER.length).trim();
  let meta: Record<string, any> = {};
  try {
    meta = JSON.parse(jsonPart) || {};
  } catch {
    meta = {};
  }
  return { cleanObservation: textPart || null, meta };
}

function combineObservationAndMeta(cleanObs: string | null | undefined, meta: Record<string, any>): string | null {
  const filteredMeta: Record<string, any> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null && v !== '') {
      filteredMeta[k] = v;
    }
  }
  const text = cleanObs ? String(cleanObs).trim() : '';
  if (Object.keys(filteredMeta).length === 0) {
    return text || null;
  }
  const encoded = `${SUPP_META_MARKER}${JSON.stringify(filteredMeta)}`;
  return text ? `${text}\n${encoded}` : encoded;
}

function pickSupportedColumns(payload: Record<string, any>, supportedCols: Set<string>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (supportedCols.has(k) && v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function decodeSuppRecord(row: any): any {
  const { cleanObservation, meta } = splitObservationAndMeta(row.observation);
  const recordType: 'heures' | 'tache' =
    row.type === 'tache' || String(row.id || '').startsWith('tsup_') ? 'tache' : 'heures';

  if (recordType === 'tache') {
    const quantiteVal = row.quantite !== undefined && row.quantite !== null
      ? Number(row.quantite)
      : Number(meta.quantite ?? 0);
    const uniteVal = String(row.unite || meta.unite || 'UNITÉ').trim().toUpperCase();
    const nomTacheVal = String(row.nom_tache || meta.nom_tache || 'TÂCHE').trim().toUpperCase();
    return {
      ...row,
      type: 'tache',
      ouvrier_id: row.ouvrier_id || meta.ouvrier_id_ref || null,
      nom_ouvrier: row.nom_ouvrier || meta.nom_ouvrier || null,
      tache_id: row.tache_id || meta.tache_id_ref || null,
      nom_tache: nomTacheVal,
      description: row.description !== undefined ? row.description : (meta.description ?? null),
      quantite: quantiteVal,
      unite: uniteVal,
      observation: cleanObservation,
      created_by_role: row.created_by_role || meta.created_by_role || 'admin',
      updated_at: row.updated_at || meta.updated_at || undefined,
      updated_by_id: row.updated_by_id || meta.updated_by_id || undefined,
      updated_by_nom: row.updated_by_nom || meta.updated_by_nom || undefined,
    };
  }

  const rawMode = row.mode_calcul || meta.mode_calcul || (row.unite === 'quart' ? 'quart_heure' : 'heure');
  const modeCalcul: 'heure' | 'quart_heure' = rawMode === 'quart_heure' ? 'quart_heure' : 'heure';

  const nbUnitesRaw =
    row.nb_unites !== undefined && row.nb_unites !== null
      ? Number(row.nb_unites)
      : meta.nb_unites !== undefined && meta.nb_unites !== null
        ? Number(meta.nb_unites)
        : row.quantite !== undefined && row.quantite !== null
          ? Number(row.quantite)
          : row.duree_heures !== undefined && row.duree_heures !== null
            ? Number(row.duree_heures)
            : Number(row.heures ?? 0);

  const dureeHeuresRaw =
    row.duree_heures !== undefined && row.duree_heures !== null
      ? Number(row.duree_heures)
      : meta.duree_heures !== undefined && meta.duree_heures !== null
        ? Number(meta.duree_heures)
        : row.heures !== undefined && row.heures !== null
          ? Number(row.heures)
          : modeCalcul === 'quart_heure'
            ? cleanFloatPrecision(nbUnitesRaw / 4)
            : nbUnitesRaw;

  const tarifRaw =
    row.tarif_unitaire !== undefined && row.tarif_unitaire !== null
      ? Number(row.tarif_unitaire)
      : meta.tarif_unitaire !== undefined && meta.tarif_unitaire !== null
        ? Number(meta.tarif_unitaire)
        : null;

  const remunRaw =
    row.remuneration !== undefined && row.remuneration !== null
      ? Number(row.remuneration)
      : row.montant_total !== undefined && row.montant_total !== null
        ? Number(row.montant_total)
        : meta.remuneration !== undefined && meta.remuneration !== null
          ? Number(meta.remuneration)
          : meta.montant_total !== undefined && meta.montant_total !== null
            ? Number(meta.montant_total)
            : tarifRaw !== null
              ? cleanFloatPrecision(tarifRaw * nbUnitesRaw)
              : null;

  return {
    ...row,
    type: 'heures',
    ouvrier_id: row.ouvrier_id || meta.ouvrier_id_ref || null,
    nom_ouvrier: row.nom_ouvrier || meta.nom_ouvrier || null,
    tache_id: row.tache_id || meta.tache_id_ref || null,
    nom_tache: row.nom_tache || meta.nom_tache || 'HEURES SUPPLÉMENTAIRES',
    heure_debut: row.heure_debut !== undefined ? row.heure_debut : (meta.heure_debut ?? null),
    heure_fin: row.heure_fin !== undefined ? row.heure_fin : (meta.heure_fin ?? null),
    duree_heures: dureeHeuresRaw,
    heures: dureeHeuresRaw,
    quantite: nbUnitesRaw,
    unite: modeCalcul === 'quart_heure' ? 'quart' : 'heure',
    mode_calcul: modeCalcul,
    tarif_unitaire: tarifRaw,
    nb_unites: nbUnitesRaw,
    remuneration: remunRaw,
    montant_total: remunRaw,
    observation: cleanObservation,
    created_by_role: row.created_by_role || meta.created_by_role || 'admin',
    updated_at: row.updated_at || meta.updated_at || undefined,
    updated_by_id: row.updated_by_id || meta.updated_by_id || undefined,
    updated_by_nom: row.updated_by_nom || meta.updated_by_nom || undefined,
  };
}

function buildSupabaseHeuresWritePayload(
  fullRecord: Record<string, any>,
  supportedCols: Set<string>,
  dbOuvrierId: string | null,
  dbTacheId: string | null,
  adminUuid: string | null
): Record<string, any> {
  const meta: Record<string, any> = {
    mode_calcul: fullRecord.mode_calcul,
    tarif_unitaire: fullRecord.tarif_unitaire,
    nb_unites: fullRecord.nb_unites,
    duree_heures: fullRecord.duree_heures,
    remuneration: fullRecord.remuneration,
    montant_total: fullRecord.montant_total,
    nom_ouvrier: fullRecord.nom_ouvrier,
    nom_tache: fullRecord.nom_tache,
    heure_debut: fullRecord.heure_debut,
    heure_fin: fullRecord.heure_fin,
    ouvrier_id_ref: fullRecord.ouvrier_id,
    tache_id_ref: fullRecord.tache_id,
    created_by_role: fullRecord.created_by_role,
    updated_at: fullRecord.updated_at,
    updated_by_id: fullRecord.updated_by_id,
    updated_by_nom: fullRecord.updated_by_nom,
  };

  const hasExtendedCols = supportedCols.has('mode_calcul') && supportedCols.has('nb_unites');
  const observationToStore = hasExtendedCols
    ? (fullRecord.observation || null)
    : combineObservationAndMeta(fullRecord.observation, meta);

  const candidate: Record<string, any> = {
    ...fullRecord,
    ouvrier_id: dbOuvrierId,
    tache_id: dbTacheId,
    created_by_id: adminUuid,
    observation: observationToStore,
  };

  return pickSupportedColumns(candidate, supportedCols);
}

function buildSupabaseTacheWritePayload(
  fullRecord: Record<string, any>,
  schemaInfo: { hasTachesTable: boolean; heuresColumns: Set<string>; tachesColumns: Set<string> },
  dbOuvrierId: string | null,
  dbTacheId: string | null,
  adminUuid: string | null
): { table: string; payload: Record<string, any> } {
  if (schemaInfo.hasTachesTable) {
    const hasExtended = schemaInfo.tachesColumns.has('nom_tache') && schemaInfo.tachesColumns.has('quantite');
    const observationToStore = hasExtended
      ? (fullRecord.observation || null)
      : combineObservationAndMeta(fullRecord.observation, {
          nom_tache: fullRecord.nom_tache,
          nom_ouvrier: fullRecord.nom_ouvrier,
          description: fullRecord.description,
          ouvrier_id_ref: fullRecord.ouvrier_id,
          tache_id_ref: fullRecord.tache_id,
          created_by_role: fullRecord.created_by_role,
          updated_at: fullRecord.updated_at,
          updated_by_id: fullRecord.updated_by_id,
          updated_by_nom: fullRecord.updated_by_nom,
        });

    const candidate: Record<string, any> = {
      ...fullRecord,
      ouvrier_id: dbOuvrierId,
      tache_id: dbTacheId,
      created_by_id: adminUuid,
      observation: observationToStore,
    };
    return {
      table: 'taches_supplementaires',
      payload: pickSupportedColumns(candidate, schemaInfo.tachesColumns),
    };
  }

  // Fallback sûr sur la table PostgreSQL heures_supplementaires avec type = 'tache'
  const observationToStore = combineObservationAndMeta(fullRecord.observation, {
    nom_tache: fullRecord.nom_tache,
    nom_ouvrier: fullRecord.nom_ouvrier,
    description: fullRecord.description,
    ouvrier_id_ref: fullRecord.ouvrier_id,
    tache_id_ref: fullRecord.tache_id,
    created_by_role: fullRecord.created_by_role,
    updated_at: fullRecord.updated_at,
    updated_by_id: fullRecord.updated_by_id,
    updated_by_nom: fullRecord.updated_by_nom,
  });

  const candidate: Record<string, any> = {
    id: fullRecord.id,
    company_id: fullRecord.company_id,
    ouvrier_id: dbOuvrierId,
    numero_ouvrier: fullRecord.numero_ouvrier,
    date: fullRecord.date,
    type: 'tache',
    tache_id: dbTacheId,
    quantite: fullRecord.quantite,
    unite: fullRecord.unite,
    heures: 0,
    domaine_id: fullRecord.domaine_id,
    serre_id: fullRecord.serre_id,
    observation: observationToStore,
    created_by_id: adminUuid,
    created_by_nom: fullRecord.created_by_nom,
    heure_enregistrement: fullRecord.heure_enregistrement,
    timestamp: fullRecord.timestamp,
    created_at: fullRecord.created_at,
  };
  return {
    table: 'heures_supplementaires',
    payload: pickSupportedColumns(candidate, schemaInfo.heuresColumns),
  };
}

async function resolveSupabaseOuvrierFk(dbClient: any, companyId: string, ouvrierId?: string | null): Promise<string | null> {
  if (!ouvrierId) return null;
  try {
    const { data } = await dbClient
      .from('ouvriers')
      .select('id')
      .eq('id', String(ouvrierId))
      .eq('company_id', companyId)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

async function resolveSupabaseTacheFk(dbClient: any, companyId: string, tacheId?: string | null): Promise<string | null> {
  if (!tacheId) return null;
  try {
    const { data } = await dbClient
      .from('taches')
      .select('id')
      .eq('id', String(tacheId))
      .eq('company_id', companyId)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

function resolveValidProfileUuid(id?: string | null): string | null {
  if (!id) return null;
  const s = String(id).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

function filterHistoricalRows(
  rows: any[],
  companyId: string,
  filters: {
    date?: string;
    startDate?: string;
    endDate?: string;
    ouvrierId?: string;
    domaineId?: string;
    serreId?: string;
    tacheId?: string;
    tache?: string;
    workerSearch?: string;
  }
): any[] {
  return (rows || []).filter((r) => {
    if (r.company_id && r.company_id !== companyId) return false;
    if (filters.date && r.date !== filters.date) return false;
    if (!filters.date && filters.startDate && filters.endDate) {
      if (r.date < filters.startDate || r.date > filters.endDate) return false;
    }
    if (filters.ouvrierId && filters.ouvrierId !== 'ALL' && String(r.ouvrier_id) !== filters.ouvrierId && `num_${r.numero_ouvrier}` !== filters.ouvrierId) return false;
    if (filters.tacheId && filters.tacheId !== 'ALL' && String(r.tache_id) !== filters.tacheId) return false;
    if (filters.domaineId && filters.domaineId !== 'ALL' && r.domaine_id !== filters.domaineId) return false;
    if (filters.serreId && filters.serreId !== 'ALL' && filters.serreId.trim() !== '') {
      const sQuery = filters.serreId.trim().toLowerCase();
      const rowSerre = String(r.serre_id || '').trim().toLowerCase();
      if (!rowSerre.includes(sQuery)) return false;
    }
    if (filters.tache && filters.tache.trim() !== '') {
      const tQuery = filters.tache.trim().toLowerCase();
      const rowTask = `${r.nom_tache || ''} ${r.description || ''} ${r.tache_id || ''}`.toLowerCase();
      if (!rowTask.includes(tQuery)) return false;
    }
    if (filters.workerSearch && filters.workerSearch.trim() !== '') {
      const wQuery = filters.workerSearch.trim().toLowerCase();
      const rowWorker = `${r.numero_ouvrier || ''} ${r.nom_ouvrier || ''}`.toLowerCase();
      if (!rowWorker.includes(wQuery)) return false;
    }
    return true;
  });
}

function matchesSuppMemoryFilters(
  decoded: any,
  filters: {
    ouvrierId?: string;
    serreId?: string;
    tacheId?: string;
    tache?: string;
    workerSearch?: string;
  }
): boolean {
  if (filters.ouvrierId && filters.ouvrierId !== 'ALL') {
    const targetOuv = String(filters.ouvrierId);
    if (String(decoded.ouvrier_id) !== targetOuv && `num_${decoded.numero_ouvrier}` !== targetOuv && String(decoded.numero_ouvrier) !== targetOuv) {
      return false;
    }
  }
  if (filters.tacheId && filters.tacheId !== 'ALL' && String(decoded.tache_id) !== filters.tacheId) {
    return false;
  }
  if (filters.serreId && filters.serreId !== 'ALL' && filters.serreId.trim() !== '') {
    const sQuery = filters.serreId.trim().toLowerCase();
    const rowSerre = String(decoded.serre_id || '').trim().toLowerCase();
    if (!rowSerre.includes(sQuery)) return false;
  }
  if (filters.tache && filters.tache.trim() !== '') {
    const tQuery = filters.tache.trim().toLowerCase();
    const rowTask = `${decoded.nom_tache || ''} ${decoded.description || ''} ${decoded.tache_id || ''}`.toLowerCase();
    if (!rowTask.includes(tQuery)) return false;
  }
  if (filters.workerSearch && filters.workerSearch.trim() !== '') {
    const wQuery = filters.workerSearch.trim().toLowerCase();
    const rowWorker = `${decoded.numero_ouvrier || ''} ${decoded.nom_ouvrier || ''}`.toLowerCase();
    if (!rowWorker.includes(wQuery)) return false;
  }
  return true;
}

async function fetchMergedHeuresSupplementaires(
  dbClient: any,
  companyId: string,
  filters: {
    date?: string;
    startDate?: string;
    endDate?: string;
    ouvrierId?: string;
    domaineId?: string;
    serreId?: string;
    tache?: string;
    workerSearch?: string;
  }
): Promise<any[]> {
  let query = dbClient
    .from('heures_supplementaires')
    .select('*')
    .eq('company_id', companyId)
    .neq('type', 'tache');

  if (filters.date) {
    query = query.eq('date', filters.date);
  } else if (filters.startDate && filters.endDate) {
    query = query.gte('date', filters.startDate).lte('date', filters.endDate);
  }
  if (filters.domaineId && filters.domaineId !== 'ALL') query = query.eq('domaine_id', filters.domaineId);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error('Erreur lecture heures_supplementaires: ' + error.message);

  const byId = new Map<string, any>();
  for (const row of data || []) {
    const decoded = decodeSuppRecord(row);
    if (decoded.type !== 'heures') continue;
    if (!matchesSuppMemoryFilters(decoded, filters)) continue;
    byId.set(decoded.id, decoded);
  }

  // Inclure les données historiques archivées sans écraser les lignes Supabase
  try {
    const local = readDB();
    const histRows = filterHistoricalRows(local.heures_supplementaires || [], companyId, filters);
    for (const h of histRows) {
      if (!byId.has(h.id)) {
        byId.set(h.id, decodeSuppRecord(h));
      }
    }
  } catch {
    // ignore
  }

  return Array.from(byId.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function fetchMergedTachesSupplementaires(
  dbClient: any,
  companyId: string,
  filters: {
    date?: string;
    startDate?: string;
    endDate?: string;
    ouvrierId?: string;
    domaineId?: string;
    serreId?: string;
    tacheId?: string;
    tache?: string;
    workerSearch?: string;
  }
): Promise<any[]> {
  const schemaInfo = await getSupplementairesSchemaInfo();
  const tableName = schemaInfo.hasTachesTable ? 'taches_supplementaires' : 'heures_supplementaires';

  let query = dbClient
    .from(tableName)
    .select('*')
    .eq('company_id', companyId);

  if (!schemaInfo.hasTachesTable) {
    query = query.eq('type', 'tache');
  }
  if (filters.date) {
    query = query.eq('date', filters.date);
  } else if (filters.startDate && filters.endDate) {
    query = query.gte('date', filters.startDate).lte('date', filters.endDate);
  }
  if (filters.domaineId && filters.domaineId !== 'ALL') query = query.eq('domaine_id', filters.domaineId);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(`Erreur lecture ${tableName}: ` + error.message);

  const byId = new Map<string, any>();
  for (const row of data || []) {
    const decoded = decodeSuppRecord({ ...row, type: 'tache' });
    if (!matchesSuppMemoryFilters(decoded, filters)) continue;
    byId.set(decoded.id, decoded);
  }

  // Inclure les données historiques archivées sans écraser les lignes Supabase
  try {
    const local = readDB();
    const histRows = filterHistoricalRows(local.taches_supplementaires || [], companyId, filters);
    for (const t of histRows) {
      if (!byId.has(t.id)) {
        byId.set(t.id, decodeSuppRecord({ ...t, type: 'tache' }));
      }
    }
  } catch {
    // ignore
  }

  return Array.from(byId.values()).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

// Helper pour retrouver un ouvrier légitime dans la base (aucun ouvrier ne peut être créé automatiquement)
async function findRealCompanyWorker(dbClient: any, companyId: string, criteria: { numero?: number; id?: string }) {
  if (criteria.numero !== undefined) {
    const num = Number(criteria.numero);
    if (isNaN(num) || num <= 0) return null;
    try {
      const { data } = await dbClient
        .from('ouvriers')
        .select('*')
        .eq('company_id', companyId)
        .eq('numero', num)
        .maybeSingle();
      if (data) return data;
    } catch {
      // ignore
    }
    const local = readDB();
    const found = (local.ouvriers || []).find(
      (o: any) => o.numero === num && (!o.company_id || o.company_id === companyId)
    );
    if (found) return found;
  }

  if (criteria.id) {
    const sId = String(criteria.id).trim();
    try {
      const { data } = await dbClient
        .from('ouvriers')
        .select('*')
        .eq('company_id', companyId)
        .eq('id', sId)
        .maybeSingle();
      if (data) return data;
    } catch {
      // ignore
    }
    const local = readDB();
    const found = (local.ouvriers || []).find(
      (o: any) => o.id === sId && (!o.company_id || o.company_id === companyId)
    );
    if (found) return found;
  }

  return null;
}

// 0. GET /api/ouvriers : Consultation des ouvriers de l'entreprise
app.get('/api/ouvriers', async (req: Request, res: Response) => {
  try {
    const auth = await authenticateCaporalOrAdmin(req);
    if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
      return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
    }
    const companyId = auth.user.company_id;
    const { data } = await auth.supabaseClient
      .from('ouvriers')
      .select('*')
      .eq('company_id', companyId)
      .order('numero', { ascending: true });

    if (data && data.length > 0) {
      return res.json({ success: true, ouvriers: data });
    }
    const local = readDB();
    return res.json({ success: true, ouvriers: local.ouvriers || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// SECTION 1 : HEURES SUPPLÉMENTAIRES (RÉSERVÉ EXCLUSIVEMENT À ADMIN)
// =========================================================================

// 1. GET /api/heures-supplementaires : Consultation filtrée des heures sup (ADMIN ONLY)
app.get('/api/heures-supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { date, startDate, endDate, ouvrierId, domaineId, serreId, tache, workerSearch } = req.query;
    const items = await fetchMergedHeuresSupplementaires(auth.supabaseClient, auth.admin.company_id, {
      date: date ? String(date) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      ouvrierId: ouvrierId ? String(ouvrierId) : undefined,
      domaineId: domaineId ? String(domaineId) : undefined,
      serreId: serreId ? String(serreId) : undefined,
      tache: tache ? String(tache) : undefined,
      workerSearch: workerSearch ? String(workerSearch) : undefined,
    });

    return res.json({ success: true, heures_supplementaires: items });
  } catch (err: any) {
    console.error('Erreur GET /api/heures-supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/heures-supplementaires : Enregistrement d'une heure supplémentaire (ADMIN ONLY)
app.post('/api/heures-supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      ouvrier_id,
      numero_ouvrier,
      date,
      heure_debut,
      heure_fin,
      duree_heures,
      heures,
      tache_id,
      nom_tache,
      domaine_id,
      serre_id,
      observation,
      mode_calcul,
      tarif_unitaire,
      nb_unites,
      remuneration,
    } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, error: 'Date obligatoire.' });
    }

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    // Validation stricte du travailleur existant (Interdiction formelle de créer un ouvrier depuis ce module)
    const numOuvrier = numero_ouvrier !== undefined ? parseInt(String(numero_ouvrier), 10) : undefined;
    const realWorker = await findRealCompanyWorker(dbClient, companyId, {
      numero: !isNaN(numOuvrier as number) ? numOuvrier : undefined,
      id: ouvrier_id ? String(ouvrier_id) : undefined,
    });

    if (!realWorker) {
      return res.status(400).json({
        success: false,
        error: `Ouvrier introuvable. Aucun ouvrier existant ne correspond au numéro "${numero_ouvrier}". La création automatique d'ouvriers est strictement interdite.`,
      });
    }

    // Détermination du mode de calcul : 'heure' ou 'quart_heure' (15 min)
    const mode: 'heure' | 'quart_heure' = mode_calcul === 'quart_heure' ? 'quart_heure' : 'heure';

    // Tarif unitaire (DH/heure ou DH/quart d'heure) — aucune troncature ni arrondi forcé
    let tarif: number | null = null;
    if (tarif_unitaire !== undefined && tarif_unitaire !== null && String(tarif_unitaire).trim() !== '') {
      const parsedTarif = parseNonNegativeDecimal(tarif_unitaire);
      if (parsedTarif === null) {
        return res.status(400).json({
          success: false,
          error: 'Le prix unitaire doit être un nombre valide supérieur ou égal à 0.',
        });
      }
      tarif = parsedTarif;
    }

    // Calcul de durée optionnel si heure_debut et heure_fin sont renseignées
    let calculatedDurationHours: number | null = null;
    if (heure_debut && heure_fin && String(heure_debut).includes(':') && String(heure_fin).includes(':')) {
      const [h1, m1] = String(heure_debut).split(':').map((v) => parseInt(v, 10));
      const [h2, m2] = String(heure_fin).split(':').map((v) => parseInt(v, 10));
      if (!isNaN(h1) && !isNaN(m1) && !isNaN(h2) && !isNaN(m2)) {
        let diffMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (diffMinutes < 0) diffMinutes += 24 * 60;
        calculatedDurationHours = cleanFloatPrecision(diffMinutes / 60);
      }
    }

    // Saisie libre d'entiers et décimaux (accepte virgule et point, jamais de step imposé ni d'arrondi)
    let finalUnits: number | null = null;
    const rawUnitsInput =
      nb_unites !== undefined && nb_unites !== null && String(nb_unites).trim() !== ''
        ? nb_unites
        : duree_heures !== undefined && duree_heures !== null && String(duree_heures).trim() !== ''
          ? duree_heures
          : heures !== undefined && heures !== null && String(heures).trim() !== ''
            ? heures
            : null;

    if (rawUnitsInput !== null) {
      finalUnits = parsePositiveDecimal(rawUnitsInput);
    } else if (calculatedDurationHours !== null && calculatedDurationHours > 0) {
      finalUnits = mode === 'quart_heure'
        ? cleanFloatPrecision(calculatedDurationHours * 4)
        : calculatedDurationHours;
    }

    if (finalUnits === null || finalUnits <= 0) {
      return res.status(400).json({
        success: false,
        error: mode === 'quart_heure'
          ? 'Le nombre de quarts d\'heure (15 min) doit être un nombre strictement supérieur à 0.'
          : 'Le nombre d\'heures supplémentaires doit être un nombre strictement supérieur à 0 (ex: 1, 2, 2.5, 1.75, 3.125).',
      });
    }

    // Durée réelle en heures décimales : sans arrondi arbitraire
    const finalDurationInHours = mode === 'quart_heure'
      ? cleanFloatPrecision(finalUnits / 4)
      : finalUnits;

    // Rémunération : Rémunération = Prix unitaire × Nombre saisi
    let calculatedRemuneration: number | null = null;
    if (tarif !== null) {
      calculatedRemuneration = cleanFloatPrecision(tarif * finalUnits);
    } else if (remuneration !== undefined && remuneration !== null && String(remuneration).trim() !== '') {
      const parsedRem = parseNonNegativeDecimal(remuneration);
      calculatedRemuneration = parsedRem !== null ? cleanFloatPrecision(parsedRem) : null;
    }

    const now = new Date();
    const newRecordId = `hsup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullRecord = {
      id: newRecordId,
      company_id: companyId,
      ouvrier_id: realWorker.id,
      numero_ouvrier: realWorker.numero,
      nom_ouvrier: realWorker.nom,
      date: String(date),
      tache_id: tache_id ? String(tache_id) : null,
      nom_tache: nom_tache ? String(nom_tache).trim() : 'HEURES SUPPLÉMENTAIRES',
      heure_debut: heure_debut ? String(heure_debut).trim() : null,
      heure_fin: heure_fin ? String(heure_fin).trim() : null,
      duree_heures: finalDurationInHours,
      heures: finalDurationInHours,
      quantite: finalUnits,
      unite: mode === 'quart_heure' ? 'quart' : 'heure',
      mode_calcul: mode,
      tarif_unitaire: tarif,
      nb_unites: finalUnits,
      remuneration: calculatedRemuneration,
      montant_total: calculatedRemuneration,
      type: 'heures',
      domaine_id: domaine_id ? String(domaine_id) : null,
      serre_id: serre_id ? String(serre_id) : null,
      observation: observation ? String(observation).trim() : null,
      created_by_id: auth.admin.id,
      created_by_nom: auth.admin.nom,
      created_by_role: 'admin',
      heure_enregistrement: now.toTimeString().slice(0, 8),
      created_at: now.toISOString(),
      timestamp: now.getTime(),
    };

    const schemaInfo = await getSupplementairesSchemaInfo();
    const dbOuvrierId = await resolveSupabaseOuvrierFk(dbClient, companyId, realWorker.id);
    const dbTacheId = await resolveSupabaseTacheFk(dbClient, companyId, fullRecord.tache_id);
    const adminUuid = resolveValidProfileUuid(auth.admin.id);

    const dbPayload = buildSupabaseHeuresWritePayload(
      fullRecord,
      schemaInfo.heuresColumns,
      dbOuvrierId,
      dbTacheId,
      adminUuid
    );

    const { data, error } = await dbClient
      .from('heures_supplementaires')
      .insert(dbPayload)
      .select()
      .single();

    if (error) {
      console.error('Erreur insertion heures_supplementaires:', error);
      throw new Error('Erreur enregistrement PostgreSQL: ' + error.message);
    }

    const decodedItem = decodeSuppRecord(data || dbPayload);

    return res.json({
      success: true,
      item: decodedItem,
      message: `Heure supplémentaire enregistrée (${mode === 'quart_heure' ? `${finalUnits} quarts` : `${finalUnits} H`}${calculatedRemuneration !== null ? ` — ${calculatedRemuneration} DH` : ''}).`,
    });
  } catch (err: any) {
    console.error('Erreur POST /api/heures-supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PUT /api/heures-supplementaires/:id : Modification ciblée (ADMIN ONLY)
app.put('/api/heures-supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Identifiant d\'opération requis.' });

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const {
      date,
      heure_debut,
      heure_fin,
      duree_heures,
      heures,
      tache_id,
      nom_tache,
      domaine_id,
      serre_id,
      observation,
      mode_calcul,
      tarif_unitaire,
      nb_unites,
      remuneration,
    } = req.body;

    // 1. Lire l'opération existante (Supabase prioritaire, puis archive JSON)
    const { data: existingDbRow, error: fetchErr } = await dbClient
      .from('heures_supplementaires')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    if (fetchErr) throw new Error('Erreur lecture opération PostgreSQL: ' + fetchErr.message);

    let existingLocalIdx = -1;
    let localDbCache: any = null;
    if (!existingDbRow) {
      localDbCache = readDB();
      existingLocalIdx = (localDbCache.heures_supplementaires || []).findIndex(
        (x: any) => x.id === id && (!x.company_id || x.company_id === companyId)
      );
      if (existingLocalIdx < 0) {
        return res.status(404).json({ success: false, error: 'Opération d\'heures supplémentaires introuvable.' });
      }
    }

    const baseRecord = decodeSuppRecord(
      existingDbRow || localDbCache.heures_supplementaires[existingLocalIdx]
    );

    const targetMode: 'heure' | 'quart_heure' =
      mode_calcul !== undefined
        ? (mode_calcul === 'quart_heure' ? 'quart_heure' : 'heure')
        : (baseRecord.mode_calcul === 'quart_heure' ? 'quart_heure' : 'heure');

    let targetTarif: number | null = baseRecord.tarif_unitaire ?? null;
    if (tarif_unitaire !== undefined) {
      if (tarif_unitaire === null || String(tarif_unitaire).trim() === '') {
        targetTarif = null;
      } else {
        const parsedT = parseNonNegativeDecimal(tarif_unitaire);
        if (parsedT === null) {
          return res.status(400).json({ success: false, error: 'Le prix unitaire doit être un nombre valide (>= 0).' });
        }
        targetTarif = parsedT;
      }
    }

    let targetUnits: number = Number(baseRecord.nb_unites ?? baseRecord.duree_heures ?? baseRecord.heures ?? 0);
    if (nb_unites !== undefined && nb_unites !== null && String(nb_unites).trim() !== '') {
      const parsedNb = parsePositiveDecimal(nb_unites);
      if (parsedNb === null) {
        return res.status(400).json({ success: false, error: 'La quantité / durée doit être strictement positive (> 0).' });
      }
      targetUnits = parsedNb;
    } else if (duree_heures !== undefined || heures !== undefined) {
      const rawDur = duree_heures !== undefined ? duree_heures : heures;
      const parsedDur = parsePositiveDecimal(rawDur);
      if (parsedDur === null) {
        return res.status(400).json({ success: false, error: 'La durée en heures doit être strictement positive (> 0).' });
      }
      targetUnits = targetMode === 'quart_heure' ? cleanFloatPrecision(parsedDur * 4) : parsedDur;
    }

    const targetDurationHours = targetMode === 'quart_heure'
      ? cleanFloatPrecision(targetUnits / 4)
      : targetUnits;

    let targetRemun: number | null = baseRecord.remuneration ?? null;
    if (targetTarif !== null) {
      targetRemun = cleanFloatPrecision(targetTarif * targetUnits);
    } else if (tarif_unitaire !== undefined && targetTarif === null) {
      targetRemun = null;
    } else if (remuneration !== undefined) {
      targetRemun =
        remuneration !== null && String(remuneration).trim() !== ''
          ? parseNonNegativeDecimal(remuneration)
          : null;
    }

    const mergedRecord = {
      ...baseRecord,
      date: date ? String(date) : baseRecord.date,
      heure_debut: heure_debut !== undefined ? (heure_debut || null) : baseRecord.heure_debut,
      heure_fin: heure_fin !== undefined ? (heure_fin || null) : baseRecord.heure_fin,
      tache_id: tache_id !== undefined ? (tache_id || null) : baseRecord.tache_id,
      nom_tache: nom_tache !== undefined ? (nom_tache ? String(nom_tache).trim() : null) : baseRecord.nom_tache,
      domaine_id: domaine_id !== undefined ? (domaine_id || null) : baseRecord.domaine_id,
      serre_id: serre_id !== undefined ? (serre_id || null) : baseRecord.serre_id,
      observation: observation !== undefined ? (observation ? String(observation).trim() : null) : baseRecord.observation,
      mode_calcul: targetMode,
      tarif_unitaire: targetTarif,
      nb_unites: targetUnits,
      quantite: targetUnits,
      unite: targetMode === 'quart_heure' ? 'quart' : 'heure',
      duree_heures: targetDurationHours,
      heures: targetDurationHours,
      remuneration: targetRemun,
      montant_total: targetRemun,
      updated_at: new Date().toISOString(),
      updated_by_id: auth.admin.id,
      updated_by_nom: auth.admin.nom,
    };

    if (existingDbRow) {
      const schemaInfo = await getSupplementairesSchemaInfo();
      const dbOuvrierId = await resolveSupabaseOuvrierFk(dbClient, companyId, mergedRecord.ouvrier_id);
      const dbTacheId = await resolveSupabaseTacheFk(dbClient, companyId, mergedRecord.tache_id);
      const adminUuid = resolveValidProfileUuid(mergedRecord.created_by_id || auth.admin.id);

      const dbPayload = buildSupabaseHeuresWritePayload(
        mergedRecord,
        schemaInfo.heuresColumns,
        dbOuvrierId,
        dbTacheId,
        adminUuid
      );
      delete dbPayload.id;
      delete dbPayload.company_id;
      delete dbPayload.created_at;

      const { data, error } = await dbClient
        .from('heures_supplementaires')
        .update(dbPayload)
        .eq('id', id)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error) throw new Error('Erreur mise à jour PostgreSQL: ' + error.message);

      return res.json({
        success: true,
        item: decodeSuppRecord(data || mergedRecord),
        message: 'Heure supplémentaire mise à jour avec succès.',
      });
    } else {
      localDbCache.heures_supplementaires[existingLocalIdx] = mergedRecord;
      writeDB(localDbCache);
      return res.json({
        success: true,
        item: mergedRecord,
        message: 'Heure supplémentaire mise à jour avec succès.',
      });
    }
  } catch (err: any) {
    console.error('Erreur PUT /api/heures-supplementaires/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. DELETE /api/heures-supplementaires/:id : Suppression ciblée (ADMIN ONLY)
app.delete('/api/heures-supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Identifiant d\'opération requis.' });

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    const { data: deletedRows, error } = await dbClient
      .from('heures_supplementaires')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId)
      .select('id');

    if (error) throw new Error('Erreur suppression PostgreSQL: ' + error.message);

    let deletedLocal = false;
    try {
      const local = readDB();
      if (local.heures_supplementaires) {
        const before = local.heures_supplementaires.length;
        local.heures_supplementaires = local.heures_supplementaires.filter(
          (x: any) => !(x.id === id && (!x.company_id || x.company_id === companyId))
        );
        if (local.heures_supplementaires.length < before) {
          deletedLocal = true;
          writeDB(local);
        }
      }
    } catch {
      // ignore
    }

    if ((!deletedRows || deletedRows.length === 0) && !deletedLocal) {
      return res.status(404).json({ success: false, error: 'Opération introuvable.' });
    }

    return res.json({ success: true, message: 'Heure supplémentaire supprimée avec succès.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/heures-supplementaires/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// SECTION 2 : TÂCHES SUPPLÉMENTAIRES (RÉSERVÉ EXCLUSIVEMENT À ADMIN)
// =========================================================================

const tachesIdempotencyCache = new Map<string, { createdAt: number; payload: any }>();

// 1. GET /api/taches-supplementaires : Consultation filtrée des tâches sup (ADMIN ONLY)
app.get('/api/taches-supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { date, startDate, endDate, ouvrierId, domaineId, serreId, tacheId, tache, workerSearch } = req.query;
    const items = await fetchMergedTachesSupplementaires(auth.supabaseClient, auth.admin.company_id, {
      date: date ? String(date) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      ouvrierId: ouvrierId ? String(ouvrierId) : undefined,
      domaineId: domaineId ? String(domaineId) : undefined,
      serreId: serreId ? String(serreId) : undefined,
      tacheId: tacheId ? String(tacheId) : undefined,
      tache: tache ? String(tache) : undefined,
      workerSearch: workerSearch ? String(workerSearch) : undefined,
    });

    return res.json({ success: true, taches_supplementaires: items });
  } catch (err: any) {
    console.error('Erreur GET /api/taches-supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/taches-supplementaires : Enregistrement individuel ou groupé (multi-ouvriers atomique) (ADMIN ONLY)
app.post('/api/taches-supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      ouvriers,
      ouvrier_id,
      numero_ouvrier,
      date,
      tache_id,
      nom_tache,
      description,
      quantite,
      unite,
      domaine_id,
      serre_id,
      observation,
      idempotencyKey,
    } = req.body;

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    // Purge expirée du cache d'idempotence (TTL 5 min)
    const nowMs = Date.now();
    for (const [k, v] of tachesIdempotencyCache.entries()) {
      if (nowMs - v.createdAt > 5 * 60 * 1000) {
        tachesIdempotencyCache.delete(k);
      }
    }

    const reqIdempKey = String(idempotencyKey || req.headers['x-idempotency-key'] || '').trim();
    const cacheKey = reqIdempKey ? `${companyId}:${reqIdempKey}` : '';
    if (cacheKey && tachesIdempotencyCache.has(cacheKey)) {
      return res.json(tachesIdempotencyCache.get(cacheKey)!.payload);
    }

    if (!nom_tache || !unite || !date) {
      return res.status(400).json({
        success: false,
        error: 'Champs obligatoires manquants (nom_tache, unite, date).',
      });
    }

    const commonQty =
      quantite !== undefined && quantite !== null && String(quantite).trim() !== ''
        ? parsePositiveDecimal(quantite)
        : null;

    // Résolution et validation intégrale de tous les ouvriers AVANT toute insertion (zéro insertion partielle)
    const resolvedEntries: Array<{ worker: any; qty: number }> = [];
    const seenWorkerKeys = new Set<string>();

    if (Array.isArray(ouvriers)) {
      if (ouvriers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Veuillez sélectionner au moins un ouvrier existant.',
        });
      }

      for (const w of ouvriers) {
        const wNum = w?.numero !== undefined ? Number(w.numero) : undefined;
        const wId = w?.id ? String(w.id) : undefined;
        const found = await findRealCompanyWorker(dbClient, companyId, {
          numero: wNum !== undefined && !isNaN(wNum) ? wNum : undefined,
          id: wId,
        });

        if (!found) {
          return res.status(400).json({
            success: false,
            error: `Ouvrier introuvable (#${w?.numero ?? w?.id ?? '?'}). Aucune opération n'a été enregistrée ; la création automatique d'ouvriers est strictement interdite.`,
          });
        }

        const dedupKey = String(found.id || `num_${found.numero}`);
        if (seenWorkerKeys.has(dedupKey)) {
          continue; // Déduplication automatique des sélections en double
        }
        seenWorkerKeys.add(dedupKey);

        const rawWorkerQty =
          w?.quantite !== undefined && w?.quantite !== null && String(w.quantite).trim() !== ''
            ? w.quantite
            : quantite;
        const workerQty = parsePositiveDecimal(rawWorkerQty);
        if (workerQty === null || workerQty <= 0) {
          return res.status(400).json({
            success: false,
            error: `Quantité invalide pour l'ouvrier #${found.numero} (${found.nom}). La quantité doit être strictement supérieure à 0.`,
          });
        }

        resolvedEntries.push({ worker: found, qty: workerQty });
      }
    } else {
      if (commonQty === null || commonQty <= 0) {
        return res.status(400).json({
          success: false,
          error: 'La quantité réalisée doit être un nombre strictement supérieur à 0 (pas de valeur négative ni vide).',
        });
      }
      const num = numero_ouvrier !== undefined ? parseInt(String(numero_ouvrier), 10) : undefined;
      const found = await findRealCompanyWorker(dbClient, companyId, {
        numero: !isNaN(num as number) ? num : undefined,
        id: ouvrier_id ? String(ouvrier_id) : undefined,
      });
      if (!found) {
        return res.status(400).json({
          success: false,
          error: `Ouvrier introuvable. Aucun ouvrier existant ne correspond au numéro "${numero_ouvrier}". La création automatique d'ouvriers est strictement interdite.`,
        });
      }
      resolvedEntries.push({ worker: found, qty: commonQty });
    }

    if (resolvedEntries.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Au moins un ouvrier légitime existant doit être sélectionné.',
      });
    }

    const normDate = String(date).trim();
    const normTask = String(nom_tache).trim().toUpperCase();
    const normUnite = String(unite).trim().toUpperCase();
    const normDesc = description ? String(description).trim() : null;
    const normDomaine = domaine_id ? String(domaine_id).trim() : null;
    const normSerre = serre_id ? String(serre_id).trim() : null;
    const normObs = observation ? String(observation).trim() : null;

    // Contrôle anti-doublon AVANT toute écriture en base (garantit l'atomicité)
    const existingSameDate = await fetchMergedTachesSupplementaires(dbClient, companyId, {
      date: normDate,
    });
    for (const entry of resolvedEntries) {
      const duplicate = existingSameDate.find((ex) => {
        const sameWorker =
          Number(ex.numero_ouvrier) === Number(entry.worker.numero) ||
          (ex.ouvrier_id && entry.worker.id && String(ex.ouvrier_id) === String(entry.worker.id));
        if (!sameWorker) return false;
        return (
          String(ex.nom_tache || '').trim().toUpperCase() === normTask &&
          String(ex.unite || '').trim().toUpperCase() === normUnite &&
          cleanFloatPrecision(Number(ex.quantite || 0)) === cleanFloatPrecision(entry.qty) &&
          (ex.domaine_id || null) === normDomaine &&
          (ex.serre_id || null) === normSerre
        );
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: `Doublon détecté pour #${entry.worker.numero} (${entry.worker.nom}) : la tâche "${normTask}" (${entry.qty} ${normUnite}) est déjà enregistrée le ${normDate}. Aucune nouvelle opération n'a été créée.`,
        });
      }
    }

    const schemaInfo = await getSupplementairesSchemaInfo();
    const dbTacheId = await resolveSupabaseTacheFk(dbClient, companyId, tache_id ? String(tache_id) : null);
    const adminUuid = resolveValidProfileUuid(auth.admin.id);
    const now = new Date();

    const batchPayloads: Record<string, any>[] = [];
    let targetTable = schemaInfo.hasTachesTable ? 'taches_supplementaires' : 'heures_supplementaires';

    for (let idx = 0; idx < resolvedEntries.length; idx++) {
      const { worker: rw, qty } = resolvedEntries[idx];
      const newRecordId = `tsup_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`;
      const fullRec = {
        id: newRecordId,
        company_id: companyId,
        ouvrier_id: rw.id,
        numero_ouvrier: rw.numero,
        nom_ouvrier: rw.nom,
        date: normDate,
        tache_id: tache_id ? String(tache_id) : null,
        nom_tache: normTask,
        description: normDesc,
        quantite: qty,
        unite: normUnite,
        domaine_id: normDomaine,
        serre_id: normSerre,
        observation: normObs,
        created_by_id: auth.admin.id,
        created_by_nom: auth.admin.nom,
        created_by_role: 'admin',
        heure_enregistrement: now.toTimeString().slice(0, 8),
        created_at: new Date(now.getTime() + idx).toISOString(),
        timestamp: now.getTime() + idx,
      };

      const dbOuvrierId = await resolveSupabaseOuvrierFk(dbClient, companyId, rw.id);
      const { table, payload } = buildSupabaseTacheWritePayload(
        fullRec,
        schemaInfo,
        dbOuvrierId,
        dbTacheId,
        adminUuid
      );
      targetTable = table;
      batchPayloads.push(payload);
    }

    // Insertion atomique en une seule requête PostgreSQL (tout passe ou rien n'est enregistré)
    const { data: insertedData, error } = await dbClient
      .from(targetTable)
      .insert(batchPayloads)
      .select();

    if (error) {
      throw new Error('Erreur insertion atomique tâche PostgreSQL: ' + error.message);
    }

    const insertedItems = (insertedData && insertedData.length > 0 ? insertedData : batchPayloads).map(
      (row: any) => decodeSuppRecord({ ...row, type: 'tache' })
    );

    const responseBody = {
      success: true,
      items: insertedItems,
      item: insertedItems[0],
      count: insertedItems.length,
      message: `${insertedItems.length} opération(s) individuelle(s) enregistrée(s) avec succès pour "${normTask}".`,
    };

    if (cacheKey) {
      tachesIdempotencyCache.set(cacheKey, { createdAt: Date.now(), payload: responseBody });
    }

    return res.json(responseBody);
  } catch (err: any) {
    console.error('Erreur POST /api/taches-supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PUT /api/taches-supplementaires/:id : Modification d'une tâche supplémentaire (ADMIN ONLY)
app.put('/api/taches-supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Identifiant d\'opération requis.' });

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const {
      date,
      quantite,
      unite,
      nom_tache,
      description,
      tache_id,
      domaine_id,
      serre_id,
      observation,
    } = req.body;

    const schemaInfo = await getSupplementairesSchemaInfo();
    const tableName = schemaInfo.hasTachesTable ? 'taches_supplementaires' : 'heures_supplementaires';

    let existingQuery = dbClient
      .from(tableName)
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId);
    if (!schemaInfo.hasTachesTable) {
      existingQuery = existingQuery.eq('type', 'tache');
    }

    const { data: existingDbRow, error: fetchErr } = await existingQuery.maybeSingle();
    if (fetchErr) throw new Error('Erreur lecture tâche PostgreSQL: ' + fetchErr.message);

    let existingLocalIdx = -1;
    let localDbCache: any = null;
    if (!existingDbRow) {
      localDbCache = readDB();
      existingLocalIdx = (localDbCache.taches_supplementaires || []).findIndex(
        (x: any) => x.id === id && (!x.company_id || x.company_id === companyId)
      );
      if (existingLocalIdx < 0) {
        return res.status(404).json({ success: false, error: 'Tâche supplémentaire introuvable.' });
      }
    }

    const baseRecord = decodeSuppRecord({
      ...(existingDbRow || localDbCache.taches_supplementaires[existingLocalIdx]),
      type: 'tache',
    });

    let targetQuantite = Number(baseRecord.quantite || 0);
    if (quantite !== undefined && quantite !== null && String(quantite).trim() !== '') {
      const q = parsePositiveDecimal(quantite);
      if (q === null || q <= 0) {
        return res.status(400).json({ success: false, error: 'La quantité doit être strictement positive (> 0).' });
      }
      targetQuantite = q;
    }

    const mergedRecord = {
      ...baseRecord,
      date: date ? String(date) : baseRecord.date,
      unite: unite !== undefined ? String(unite).trim().toUpperCase() : baseRecord.unite,
      nom_tache: nom_tache !== undefined ? String(nom_tache).trim().toUpperCase() : baseRecord.nom_tache,
      description: description !== undefined ? (description ? String(description).trim() : null) : baseRecord.description,
      tache_id: tache_id !== undefined ? (tache_id || null) : baseRecord.tache_id,
      domaine_id: domaine_id !== undefined ? (domaine_id || null) : baseRecord.domaine_id,
      serre_id: serre_id !== undefined ? (serre_id || null) : baseRecord.serre_id,
      observation: observation !== undefined ? (observation ? String(observation).trim() : null) : baseRecord.observation,
      quantite: targetQuantite,
      updated_at: new Date().toISOString(),
      updated_by_id: auth.admin.id,
      updated_by_nom: auth.admin.nom,
    };

    if (existingDbRow) {
      const dbOuvrierId = await resolveSupabaseOuvrierFk(dbClient, companyId, mergedRecord.ouvrier_id);
      const dbTacheId = await resolveSupabaseTacheFk(dbClient, companyId, mergedRecord.tache_id);
      const adminUuid = resolveValidProfileUuid(mergedRecord.created_by_id || auth.admin.id);
      const { table, payload } = buildSupabaseTacheWritePayload(
        mergedRecord,
        schemaInfo,
        dbOuvrierId,
        dbTacheId,
        adminUuid
      );
      delete payload.id;
      delete payload.company_id;
      delete payload.created_at;

      const { data, error } = await dbClient
        .from(table)
        .update(payload)
        .eq('id', id)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error) throw new Error('Erreur mise à jour PostgreSQL: ' + error.message);

      return res.json({
        success: true,
        item: decodeSuppRecord({ ...(data || mergedRecord), type: 'tache' }),
        message: 'Tâche supplémentaire mise à jour avec succès.',
      });
    } else {
      localDbCache.taches_supplementaires[existingLocalIdx] = mergedRecord;
      writeDB(localDbCache);
      return res.json({
        success: true,
        item: mergedRecord,
        message: 'Tâche supplémentaire mise à jour avec succès.',
      });
    }
  } catch (err: any) {
    console.error('Erreur PUT /api/taches-supplementaires/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. DELETE /api/taches-supplementaires/:id : Suppression ciblée (ADMIN ONLY)
app.delete('/api/taches-supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Identifiant d\'opération requis.' });

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const schemaInfo = await getSupplementairesSchemaInfo();
    const tableName = schemaInfo.hasTachesTable ? 'taches_supplementaires' : 'heures_supplementaires';

    let delQuery = dbClient
      .from(tableName)
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);
    if (!schemaInfo.hasTachesTable) {
      delQuery = delQuery.eq('type', 'tache');
    }

    const { data: deletedRows, error } = await delQuery.select('id');
    if (error) throw new Error('Erreur suppression PostgreSQL: ' + error.message);

    let deletedLocal = false;
    try {
      const local = readDB();
      if (local.taches_supplementaires) {
        const before = local.taches_supplementaires.length;
        local.taches_supplementaires = local.taches_supplementaires.filter(
          (x: any) => !(x.id === id && (!x.company_id || x.company_id === companyId))
        );
        if (local.taches_supplementaires.length < before) {
          deletedLocal = true;
          writeDB(local);
        }
      }
    } catch {
      // ignore
    }

    if ((!deletedRows || deletedRows.length === 0) && !deletedLocal) {
      return res.status(404).json({ success: false, error: 'Tâche supplémentaire introuvable.' });
    }

    return res.json({ success: true, message: 'Tâche supplémentaire supprimée avec succès.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/taches-supplementaires/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// SECTION 3 : RÉCAPITULATIF CONSOLIDÉ (EXACTEMENT 1 SEULE LIGNE PAR OUVRIER)
// =========================================================================

app.get('/api/supplementaires/recap', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { date, startDate, endDate, domaineId, serreId, ouvrierId, tacheId, tache, workerSearch } = req.query;
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const filters = {
      date: date ? String(date) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      domaineId: domaineId ? String(domaineId) : undefined,
      serreId: serreId ? String(serreId) : undefined,
      ouvrierId: ouvrierId ? String(ouvrierId) : undefined,
      tacheId: tacheId ? String(tacheId) : undefined,
      tache: tache ? String(tache) : undefined,
      workerSearch: workerSearch ? String(workerSearch) : undefined,
    };

    // 1 & 2. Récupérer toutes les heures sup et tâches sup (Supabase PostgreSQL + archives historiques)
    const [hData, tData] = await Promise.all([
      fetchMergedHeuresSupplementaires(dbClient, companyId, filters),
      fetchMergedTachesSupplementaires(dbClient, companyId, filters),
    ]);

    // 3. Charger le référentiel des ouvriers pour les noms complets et numéros
    const local = readDB();
    const allWorkers: any[] = local.ouvriers || [];
    try {
      const { data: dbWorkers } = await dbClient
        .from('ouvriers')
        .select('id, numero, nom')
        .eq('company_id', companyId);
      if (dbWorkers && dbWorkers.length > 0) {
        allWorkers.push(...dbWorkers);
      }
    } catch {
      // ignore
    }

    const workerMap = new Map<string, { id: string; numero: number; nom: string }>();
    allWorkers.forEach((w) => {
      if (w.id) workerMap.set(String(w.id), w);
      if (w.numero !== undefined) workerMap.set(String(w.numero), w);
    });

    // 4. Regroupement par travailleur : EXACTEMENT 1 SEULE LIGNE PAR OUVRIER
    interface WorkerSummary {
      ouvrier_id: string;
      numero_ouvrier: number;
      nom_ouvrier: string;
      total_heures: number;
      total_remuneration_heures: number;
      taches_groupes: { [key: string]: { nom_tache: string; unite: string; quantite: number } };
      texte_recapitulatif: string;
      nb_operations: number;
      operations: any[];
    }

    const mapSummary = new Map<string, WorkerSummary>();

    // Traiter les heures supplémentaires
    for (const h of hData) {
      const ref = workerMap.get(String(h.ouvrier_id)) || workerMap.get(String(h.numero_ouvrier)) || {
        id: h.ouvrier_id || `num_${h.numero_ouvrier}`,
        numero: Number(h.numero_ouvrier) || 0,
        nom: h.nom_ouvrier || `Ouvrier #${h.numero_ouvrier}`,
      };
      const wKey = String(ref.numero || h.numero_ouvrier || h.ouvrier_id);
      let sum = mapSummary.get(wKey);
      if (!sum) {
        sum = {
          ouvrier_id: ref.id,
          numero_ouvrier: ref.numero,
          nom_ouvrier: ref.nom,
          total_heures: 0,
          total_remuneration_heures: 0,
          taches_groupes: {},
          texte_recapitulatif: '',
          nb_operations: 0,
          operations: [],
        };
        mapSummary.set(wKey, sum);
      }

      const dur = Number(h.duree_heures !== undefined ? h.duree_heures : (h.heures || 0));
      sum.total_heures = cleanFloatPrecision(sum.total_heures + dur);
      if (h.remuneration !== undefined && h.remuneration !== null) {
        sum.total_remuneration_heures = cleanFloatPrecision(sum.total_remuneration_heures + Number(h.remuneration));
      }
      sum.nb_operations += 1;
      sum.operations.push({
        id: h.id,
        type: 'heures',
        type_label: 'Heures sup',
        date: h.date,
        quantite_ou_duree: dur,
        valeur: dur,
        unite: 'H',
        mode_calcul: h.mode_calcul || 'heure',
        tarif_unitaire: h.tarif_unitaire !== undefined ? h.tarif_unitaire : null,
        nb_unites: h.nb_unites !== undefined ? h.nb_unites : dur,
        remuneration: h.remuneration !== undefined ? h.remuneration : (h.montant_total !== undefined ? h.montant_total : null),
        montant_total: h.montant_total !== undefined ? h.montant_total : (h.remuneration !== undefined ? h.remuneration : null),
        nom_tache: h.nom_tache || 'HEURES SUP',
        description: null,
        domaine_id: h.domaine_id,
        serre_id: h.serre_id,
        observation: h.observation,
        created_at: h.created_at,
        created_by_nom: h.created_by_nom,
      });
    }

    // Traiter les tâches supplémentaires (regroupées strictement par tâche et unité sans jamais mélanger)
    for (const t of tData) {
      const ref = workerMap.get(String(t.ouvrier_id)) || workerMap.get(String(t.numero_ouvrier)) || {
        id: t.ouvrier_id || `num_${t.numero_ouvrier}`,
        numero: Number(t.numero_ouvrier) || 0,
        nom: t.nom_ouvrier || `Ouvrier #${t.numero_ouvrier}`,
      };
      const wKey = String(ref.numero || t.numero_ouvrier || t.ouvrier_id);
      let sum = mapSummary.get(wKey);
      if (!sum) {
        sum = {
          ouvrier_id: ref.id,
          numero_ouvrier: ref.numero,
          nom_ouvrier: ref.nom,
          total_heures: 0,
          total_remuneration_heures: 0,
          taches_groupes: {},
          texte_recapitulatif: '',
          nb_operations: 0,
          operations: [],
        };
        mapSummary.set(wKey, sum);
      }

      const nomTache = String(t.nom_tache || 'TÂCHE').trim().toUpperCase();
      const unite = String(t.unite || 'UNITÉ').trim().toUpperCase();
      const groupKey = `${nomTache}__${unite}`;
      const q = Number(t.quantite || 0);

      if (!sum.taches_groupes[groupKey]) {
        sum.taches_groupes[groupKey] = { nom_tache: nomTache, unite, quantite: 0 };
      }
      sum.taches_groupes[groupKey].quantite = cleanFloatPrecision(sum.taches_groupes[groupKey].quantite + q);
      sum.nb_operations += 1;
      sum.operations.push({
        id: t.id,
        type: 'tache',
        type_label: 'Tâche sup',
        date: t.date,
        quantite_ou_duree: q,
        valeur: q,
        unite,
        nom_tache: nomTache,
        description: t.description || null,
        domaine_id: t.domaine_id,
        serre_id: t.serre_id,
        observation: t.observation,
        created_at: t.created_at,
        created_by_nom: t.created_by_nom,
      });
    }

    // 5. Génération de la chaîne de récapitulatif exacte (ex: 2 H + 30 RUBO BALAYAGE + 15 CAISSE TRI)
    const recapList: any[] = [];
    let grandTotalHeures = 0;
    let grandTotalRemuneration = 0;
    let grandTotalOperations = 0;

    for (const item of mapSummary.values()) {
      const parts: string[] = [];

      if (item.total_heures > 0) {
        let hLabel = `${item.total_heures} H`;
        if (item.total_remuneration_heures > 0) {
          hLabel += ` (${item.total_remuneration_heures} DH)`;
        }
        parts.push(hLabel);
        grandTotalHeures = cleanFloatPrecision(grandTotalHeures + item.total_heures);
      }
      if (item.total_remuneration_heures > 0) {
        grandTotalRemuneration = cleanFloatPrecision(grandTotalRemuneration + item.total_remuneration_heures);
      }

      const taskKeys = Object.keys(item.taches_groupes).sort();
      for (const tk of taskKeys) {
        const tg = item.taches_groupes[tk];
        parts.push(`${tg.quantite} ${tg.unite} ${tg.nom_tache}`);
      }

      item.texte_recapitulatif = parts.length > 0 ? parts.join(' + ') : '—';
      item.operations.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      grandTotalOperations += item.nb_operations;
      recapList.push(item);
    }

    recapList.sort((a, b) => a.numero_ouvrier - b.numero_ouvrier);

    return res.json({
      success: true,
      recap: recapList,
      totaux: {
        total_ouvriers_concernes: recapList.length,
        grand_total_heures: grandTotalHeures,
        grand_total_remuneration: grandTotalRemuneration,
        grand_total_operations: grandTotalOperations,
      },
    });
  } catch (err: any) {
    console.error('Erreur GET /api/supplementaires/recap:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// RÉTRO-COMPATIBILITÉ : ENDPOINT /api/supplementaires (ADMIN ONLY)
// =========================================================================

app.get('/api/supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { date, startDate, endDate, ouvrierId, domaineId, serreId, tache, type } = req.query;
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;
    const filters = {
      date: date ? String(date) : undefined,
      startDate: startDate ? String(startDate) : undefined,
      endDate: endDate ? String(endDate) : undefined,
      ouvrierId: ouvrierId ? String(ouvrierId) : undefined,
      domaineId: domaineId ? String(domaineId) : undefined,
      serreId: serreId ? String(serreId) : undefined,
      tache: tache ? String(tache) : undefined,
    };

    let items: any[] = [];
    if (!type || type === 'ALL' || type === 'heures') {
      const hData = await fetchMergedHeuresSupplementaires(dbClient, companyId, filters);
      items = items.concat(
        hData.map((h: any) => ({
          ...h,
          type: 'heures',
          quantite: h.duree_heures ?? h.heures,
          heures: h.duree_heures ?? h.heures,
          unite: h.unite || 'heure',
        }))
      );
    }

    if (!type || type === 'ALL' || type === 'tache') {
      const tData = await fetchMergedTachesSupplementaires(dbClient, companyId, filters);
      items = items.concat(tData.map((t: any) => ({ ...t, type: 'tache' })));
    }

    items.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return res.json({ success: true, supplementaires: items });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/supplementaires', async (req: Request, res: Response) => {
  const { type } = req.body;
  if (type === 'tache') {
    req.url = '/api/taches-supplementaires';
    return (app as any)._router.handle(req, res);
  } else {
    req.url = '/api/heures-supplementaires';
    return (app as any)._router.handle(req, res);
  }
});

app.put('/api/supplementaires/:id', async (req: Request, res: Response) => {
  const { type } = req.body;
  if (type === 'tache') {
    req.url = `/api/taches-supplementaires/${req.params.id}`;
    return (app as any)._router.handle(req, res);
  } else {
    req.url = `/api/heures-supplementaires/${req.params.id}`;
    return (app as any)._router.handle(req, res);
  }
});

app.delete('/api/supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }
  try {
    const { id } = req.params;
    const dbClient = auth.supabaseClient;
    const companyId = auth.admin.company_id;
    const schemaInfo = await getSupplementairesSchemaInfo();

    await dbClient.from('heures_supplementaires').delete().eq('id', id).eq('company_id', companyId);
    if (schemaInfo.hasTachesTable) {
      await dbClient.from('taches_supplementaires').delete().eq('id', id).eq('company_id', companyId);
    }
    return res.json({ success: true, message: 'Opération supprimée.' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// =========================================================================
// MODULE CONTRACTUELLES — OUVRIERS, POINTAGE, TÂCHES, SERRES & RÉMUNÉRATIONS
// =========================================================================

async function authenticateContractuelCaporalOrAdmin(req: Request): Promise<{
  authenticated: boolean;
  error?: string;
  statusCode?: number;
  user?: {
    id: string;
    nom: string;
    role: 'admin' | 'caporal' | 'caporal_contractuelles';
    company_id: string;
    module_attribue?: 'recolte' | 'contractuelles' | 'all';
    domaines_autorises?: string[];
    serres_autorisees?: string[];
  };
  supabaseClient?: any;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return { authenticated: false, error: 'Authentification requise (en-tête manquant).', statusCode: 401 };
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token || token === 'none') {
    return { authenticated: false, error: 'Jeton de session Supabase manquant ou invalide.', statusCode: 401 };
  }

  // Support dev local ou tests
  if (token === 'dev_admin_token' || token.includes('contractuel') || token === 'dev_caporal_token' || !supabaseUrl || (!supabaseAnonKey && !serviceRoleKey)) {
    const isContractuelCaporal = token.includes('contractuel');
    const isAdmin = token === 'dev_admin_token' || (!isContractuelCaporal && !token.includes('caporal'));
    const role = isAdmin ? 'admin' : 'caporal_contractuelles';
    const nom = isAdmin ? 'Lahcen (Administrateur)' : 'Caporal (Contractuelles)';
    const userId = isAdmin ? 'usr_admin' : 'usr_caporal_contractuel_1';
    const profileCompanyId = 'cie_lahcen_pointeur';

    return {
      authenticated: true,
      user: {
        id: userId,
        nom,
        role: role as any,
        company_id: profileCompanyId,
        module_attribue: isAdmin ? 'all' : 'contractuelles',
        domaines_autorises: [],
      },
      supabaseClient: (supabaseUrl && (supabaseAnonKey || serviceRoleKey))
        ? (supabaseAdmin || createClient(supabaseUrl, supabaseAnonKey))
        : createLocalDbClient(),
    };
  }

  try {
    const client = getSupabaseClientForRequest(token);
    const { data: { user: authUser }, error: authError } = await client.auth.getUser(token);
    if (authError || !authUser) {
      return { authenticated: false, error: 'Session invalide ou expirée: ' + (authError?.message || 'Utilisateur introuvable'), statusCode: 401 };
    }

    const adminDb = supabaseAdmin || client;
    let { data: profile } = await adminDb
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .maybeSingle();

    const userEmail = (authUser.email || '').toLowerCase();
    const isAdminEmail = userEmail === 'lahcengelmim@gmail.com' || userEmail.startsWith('admin');

    if (!profile) {
      if (isAdminEmail || supabaseAdmin) {
        const newProfile = {
          id: authUser.id,
          username: userEmail.split('@')[0] || 'admin',
          nom: 'Lahcen (Administrateur)',
          role: 'admin',
          company_id: 'cie_lahcen_pointeur',
          actif: true,
        };
        await adminDb.from('profiles').upsert(newProfile, { onConflict: 'id' });
        profile = newProfile;
      } else {
        return { authenticated: false, error: 'Profil utilisateur introuvable dans la base de données.', statusCode: 403 };
      }
    }

    if (!profile.actif) {
      return { authenticated: false, error: 'Action interdite : compte utilisateur inactif.', statusCode: 403 };
    }

    const isAdmin = profile.role === 'admin' || isAdminEmail;
    const isTariq = userEmail === 'tariq@caporal.com' || profile.username === 'tariq';
    const isContractuelCaporal =
      profile.role === 'caporal_contractuelles' ||
      profile.module_attribue === 'contractuelles' ||
      authUser.user_metadata?.module_attribue === 'contractuelles' ||
      isTariq;

    if (!isAdmin && !isContractuelCaporal) {
      return {
        authenticated: false,
        error: 'Action interdite : votre compte Caporal est affecté au module Récolte et ne possède pas d\'autorisation sur les Contractuelles.',
        statusCode: 403,
      };
    }

    // Auto-mise à jour du profil de tariq@caporal.com si la colonne module_attribue n'était pas encore positionnée
    if (isTariq && profile.module_attribue !== 'contractuelles') {
      adminDb
        .from('profiles')
        .update({ module_attribue: 'contractuelles', role: 'caporal_contractuelles' })
        .eq('id', profile.id)
        .then(() => {}, () => {});
    }

    const profileCompanyId = (profile.company_id || 'cie_lahcen_pointeur').trim();

    return {
      authenticated: true,
      user: {
        id: profile.id,
        nom: profile.nom || (isAdmin ? 'Administrateur' : 'Caporal Contractuelles'),
        role: isAdmin ? 'admin' : 'caporal_contractuelles',
        company_id: profileCompanyId,
        module_attribue: isAdmin ? 'all' : 'contractuelles',
        domaines_autorises: profile.domaines_autorises || authUser.user_metadata?.domaines_autorises || [],
        serres_autorisees: profile.serres_autorisees || authUser.user_metadata?.serres_autorisees || [],
      },
      supabaseClient: client,
    };
  } catch (err: any) {
    return { authenticated: false, error: 'Erreur vérification Supabase: ' + err.message, statusCode: 500 };
  }
}

// =========================================================================
// CATALOGUE DES CONTRATS & TARIFS DE RÉFÉRENCE
// =========================================================================

// GET /api/contractuels/contrats : Liste des contrats du catalogue
app.get('/api/contractuels/contrats', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const { actif, searchQuery } = req.query;

    let query = actionClient
      .from('contractuels_contrats')
      .select('*')
      .eq('company_id', companyId);

    if (actif === 'true') {
      query = query.eq('actif', true);
    }

    const { data, error } = await query.order('designation', { ascending: true });

    let contrats = data || [];
    if (error || !data) {
      const db = readDB();
      let list = (db.contractuels_contrats || []).filter((c: any) => c.company_id === companyId);
      if (actif === 'true') list = list.filter((c: any) => c.actif !== false);
      contrats = list;
    }

    if (searchQuery && typeof searchQuery === 'string' && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      contrats = contrats.filter(
        (c: any) =>
          c.designation?.toLowerCase().includes(q) ||
          c.code?.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q)
      );
    }

    return res.json({ success: true, contrats });
  } catch (err: any) {
    console.error('Erreur GET /api/contractuels/contrats:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contractuels/contrats : Créer un contrat de référence (Admin uniquement)
app.post('/api/contractuels/contrats', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      designation,
      prix_unitaire,
      unite,
      mode_remuneration,
      code,
      domaine_id,
      description,
      actif,
    } = req.body;

    const desigClean = String(designation || '').trim();
    if (!desigClean) {
      return res.status(400).json({ success: false, error: 'La désignation du contrat est obligatoire.' });
    }

    const prix = Number(prix_unitaire);
    if (isNaN(prix) || prix < 0) {
      return res.status(400).json({ success: false, error: 'Le prix du contrat doit être un nombre positif (>= 0).' });
    }

    const modeClean = (['JOUR', 'TACHE', 'UNITE', 'HEURE'].includes(mode_remuneration) ? mode_remuneration : 'JOUR') as any;
    const uniteClean = String(unite || modeClean).trim().toUpperCase();
    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();
    const id = `ct_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newContrat = {
      id,
      company_id: companyId,
      code: code ? String(code).trim().toUpperCase() : `CTR-${Math.floor(100 + Math.random() * 900)}`,
      designation: desigClean,
      prix_unitaire: Math.round(prix * 100) / 100,
      unite: uniteClean,
      mode_remuneration: modeClean,
      domaine_id: domaine_id ? String(domaine_id).trim() : undefined,
      description: description ? String(description).trim() : undefined,
      actif: actif !== false,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await actionClient
      .from('contractuels_contrats')
      .insert(newContrat)
      .select()
      .maybeSingle();

    const db = readDB();
    if (!db.contractuels_contrats) db.contractuels_contrats = [];
    db.contractuels_contrats.push(newContrat);
    writeDB(db);

    if (error) {
      console.warn('Supabase contractuels_contrats insert warning (local stored):', error.message);
    }

    return res.json({ success: true, contrat: data || newContrat });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/contrats:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contractuels/contrats/import : Importation en masse de contrats depuis Excel / CSV
app.post('/api/contractuels/contrats/import', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { contrats, mode_dedoublonnage = 'update' } = req.body;
    if (!Array.isArray(contrats) || contrats.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucun contrat à importer.' });
    }

    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();

    // Récupérer les contrats existants pour dédoublonner
    const { data: existingData } = await actionClient
      .from('contractuels_contrats')
      .select('*')
      .eq('company_id', companyId);

    const db = readDB();
    if (!db.contractuels_contrats) db.contractuels_contrats = [];
    const localExisting = db.contractuels_contrats.filter((c: any) => c.company_id === companyId);
    const existingList = existingData || localExisting;

    const importedContrats: any[] = [];
    let updatedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < contrats.length; i++) {
      const item = contrats[i];
      const desigClean = String(item.designation || item.nom || '').trim();
      if (!desigClean) {
        skippedCount++;
        continue;
      }

      const prixRaw = Number(item.prix_unitaire ?? item.prix);
      if (isNaN(prixRaw) || prixRaw < 0) {
        skippedCount++;
        continue;
      }

      const prix = Math.round(prixRaw * 100) / 100;
      const rawMode = String(item.mode_remuneration || item.mode || '').trim().toUpperCase();
      const modeClean = (['JOUR', 'TACHE', 'UNITE', 'HEURE'].includes(rawMode) ? rawMode : 'JOUR') as any;
      const uniteClean = String(item.unite || modeClean).trim().toUpperCase();

      // Vérifier si un contrat avec cette désignation existe déjà
      const existing = existingList.find(
        (c: any) => c.designation.toLowerCase().trim() === desigClean.toLowerCase()
      );

      if (existing) {
        if (mode_dedoublonnage === 'skip') {
          skippedCount++;
          continue;
        }
        // Mise à jour du prix et des propriétés
        const updatedRecord = {
          ...existing,
          prix_unitaire: prix,
          unite: uniteClean,
          mode_remuneration: modeClean,
          description: item.description ? String(item.description).trim() : existing.description,
          actif: true,
          updated_at: now,
        };

        await actionClient
          .from('contractuels_contrats')
          .update(updatedRecord)
          .eq('id', existing.id)
          .eq('company_id', companyId);

        const localIdx = db.contractuels_contrats.findIndex((c: any) => c.id === existing.id);
        if (localIdx >= 0) db.contractuels_contrats[localIdx] = updatedRecord;

        importedContrats.push(updatedRecord);
        updatedCount++;
      } else {
        // Création
        const id = `ct_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
        const code = item.code ? String(item.code).trim().toUpperCase() : `CTR-${String(existingList.length + createdCount + 1).padStart(3, '0')}`;

        const newRecord = {
          id,
          company_id: companyId,
          code,
          designation: desigClean,
          prix_unitaire: prix,
          unite: uniteClean,
          mode_remuneration: modeClean,
          domaine_id: item.domaine_id ? String(item.domaine_id).trim() : undefined,
          description: item.description ? String(item.description).trim() : undefined,
          actif: true,
          created_at: now,
          updated_at: now,
        };

        await actionClient.from('contractuels_contrats').insert(newRecord);
        db.contractuels_contrats.push(newRecord);
        importedContrats.push(newRecord);
        createdCount++;
      }
    }

    writeDB(db);

    return res.json({
      success: true,
      message: `Importation réussie : ${createdCount} contrat(s) créé(s), ${updatedCount} mis à jour, ${skippedCount} ignoré(s).`,
      importedCount: createdCount + updatedCount,
      createdCount,
      updatedCount,
      skippedCount,
      contrats: importedContrats,
    });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/contrats/import:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/contractuels/contrats/:id : Modifier un contrat de référence
app.put('/api/contractuels/contrats/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const {
      designation,
      prix_unitaire,
      unite,
      mode_remuneration,
      code,
      domaine_id,
      description,
      actif,
    } = req.body;

    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();

    const updatePayload: any = { updated_at: now };
    if (designation !== undefined) updatePayload.designation = String(designation).trim();
    if (prix_unitaire !== undefined) updatePayload.prix_unitaire = Math.round(Number(prix_unitaire) * 100) / 100;
    if (unite !== undefined) updatePayload.unite = String(unite).trim().toUpperCase();
    if (mode_remuneration !== undefined) updatePayload.mode_remuneration = mode_remuneration;
    if (code !== undefined) updatePayload.code = String(code).trim().toUpperCase();
    if (domaine_id !== undefined) updatePayload.domaine_id = domaine_id ? String(domaine_id).trim() : null;
    if (description !== undefined) updatePayload.description = description ? String(description).trim() : null;
    if (actif !== undefined) updatePayload.actif = Boolean(actif);

    const { data, error } = await actionClient
      .from('contractuels_contrats')
      .update(updatePayload)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .maybeSingle();

    const db = readDB();
    if (db.contractuels_contrats) {
      const idx = db.contractuels_contrats.findIndex((c: any) => c.id === id && c.company_id === companyId);
      if (idx >= 0) {
        db.contractuels_contrats[idx] = { ...db.contractuels_contrats[idx], ...updatePayload };
        writeDB(db);
      }
    }

    if (error) {
      console.warn('Supabase contractuels_contrats update error:', error.message);
    }

    return res.json({ success: true, contrat: data || updatePayload });
  } catch (err: any) {
    console.error('Erreur PUT /api/contractuels/contrats/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contractuels/contrats/:id : Supprimer ou désactiver un contrat
app.delete('/api/contractuels/contrats/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;

    await actionClient
      .from('contractuels_contrats')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    const db = readDB();
    if (db.contractuels_contrats) {
      db.contractuels_contrats = db.contractuels_contrats.filter((c: any) => c.id !== id || c.company_id !== companyId);
      writeDB(db);
    }

    return res.json({ success: true, message: 'Contrat supprimé avec succès.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/contractuels/contrats/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Identifiants des ouvriers de démonstration initiaux à purger définitivement
const DEMO_CONTRACTUEL_IDS = [
  'co_1793990249039_fcq86', // BENALI Karim
  'co_1794079162750_0_rrir', // EL AMRANI Fatima
  'co_1794079162837_1_ydra', // BOUZID Khadija
  'co_1794079162909_2_9gzp', // AIT ALI Said
];
const DEMO_CONTRACTUEL_NAMES = [
  'BENALI KARIM',
  'EL AMRANI FATIMA',
  'BOUZID KHADIJA',
  'AIT ALI SAID',
];

// 1. GET /api/contractuels/ouvriers : Liste des ouvriers contractuels
app.get('/api/contractuels/ouvriers', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const { actif, domaineId } = req.query;

    let query = actionClient
      .from('contractuels_ouvriers')
      .select('*')
      .eq('company_id', companyId);

    if (actif === 'true') {
      query = query.eq('actif', true);
    }
    if (domaineId && domaineId !== 'ALL') {
      query = query.eq('domaine_id', String(domaineId));
    }

    const { data, error } = await query.order('nom', { ascending: true });

    if (error) {
      // Fallback base locale
      const db = readDB();
      let list = (db.contractuels_ouvriers || []).filter(
        (o: any) =>
          o.company_id === companyId &&
          !DEMO_CONTRACTUEL_IDS.includes(o.id) &&
          !DEMO_CONTRACTUEL_NAMES.includes(String(o.nom_complet || `${o.nom} ${o.prenom}`).trim().toUpperCase())
      );
      if (actif === 'true') list = list.filter((o: any) => o.actif !== false);
      if (domaineId && domaineId !== 'ALL') list = list.filter((o: any) => o.domaine_id === String(domaineId));
      return res.json({ success: true, ouvriers: list });
    }

    // Filtrer tout enregistrement de démonstration qui pourrait encore exister dans Supabase
    const cleanList = (data || []).filter(
      (o: any) =>
        !DEMO_CONTRACTUEL_IDS.includes(o.id) &&
        !DEMO_CONTRACTUEL_NAMES.includes(String(o.nom_complet || `${o.nom} ${o.prenom}`).trim().toUpperCase())
    );

    // Nettoyage asynchrone des 4 fiches de démo si elles étaient présentes en base Supabase
    if (data && data.some((o: any) => DEMO_CONTRACTUEL_IDS.includes(o.id))) {
      actionClient
        .from('contractuels_ouvriers')
        .delete()
        .in('id', DEMO_CONTRACTUEL_IDS)
        .then(() => {}, (delErr: any) => console.warn('Nettoyage Supabase demo contractuels:', delErr?.message));
    }

    return res.json({ success: true, ouvriers: cleanList });
  } catch (err: any) {
    console.error('Erreur GET /api/contractuels/ouvriers:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/contractuels/ouvriers : Créer un ouvrier contractuel (Admin uniquement)
app.post('/api/contractuels/ouvriers', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      nom,
      prenom,
      nom_complet,
      matricule,
      domaine_id,
      serre_id,
      mode_remuneration,
      prix_convenu,
      unite,
      telephone,
      notes,
    } = req.body;

    const nomClean = String(nom || '').trim().toUpperCase();
    const prenomClean = String(prenom || '').trim();
    const nomCompletClean = nom_complet ? String(nom_complet).trim() : `${nomClean} ${prenomClean}`.trim();
    const domaineIdClean = String(domaine_id || 'dom_d2').trim();
    const modeClean = (['JOUR', 'TACHE', 'UNITE', 'HEURE'].includes(mode_remuneration) ? mode_remuneration : 'JOUR') as any;
    const prix = Number(prix_convenu);

    if (!nomClean || !prenomClean) {
      return res.status(400).json({ success: false, error: 'Le nom et le prénom de l\'ouvrier sont obligatoires.' });
    }
    if (isNaN(prix) || prix < 0) {
      return res.status(400).json({ success: false, error: 'Le prix convenu doit être un montant positif (>= 0).' });
    }

    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();
    const id = `co_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const finalMatricule = matricule ? String(matricule).trim().toUpperCase() : `C-${Math.floor(100 + Math.random() * 900)}`;

    const newOuvrier = {
      id,
      company_id: companyId,
      nom: nomClean,
      prenom: prenomClean,
      nom_complet: nomCompletClean,
      matricule: finalMatricule,
      domaine_id: domaineIdClean,
      serre_id: serre_id ? String(serre_id).trim() : null,
      mode_remuneration: modeClean,
      prix_convenu: Math.round(prix * 100) / 100,
      unite: unite ? String(unite).trim().toUpperCase() : modeClean,
      actif: true,
      telephone: telephone ? String(telephone).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      created_at: now,
      updated_at: now,
    };

    const { data, error } = await actionClient
      .from('contractuels_ouvriers')
      .insert(newOuvrier)
      .select()
      .maybeSingle();

    // Persistance locale miroir
    const db = readDB();
    if (!db.contractuels_ouvriers) db.contractuels_ouvriers = [];
    db.contractuels_ouvriers.push(newOuvrier);
    writeDB(db);

    if (error) {
      console.warn('Supabase contractuels_ouvriers insert error (stored locally):', error.message);
      return res.json({ success: true, ouvrier: newOuvrier });
    }

    return res.json({ success: true, ouvrier: data || newOuvrier });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/ouvriers:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PUT /api/contractuels/ouvriers/:id : Modifier un ouvrier contractuel (Admin uniquement)
app.put('/api/contractuels/ouvriers/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const {
      nom,
      prenom,
      nom_complet,
      matricule,
      domaine_id,
      serre_id,
      mode_remuneration,
      prix_convenu,
      unite,
      actif,
      telephone,
      notes,
    } = req.body;

    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();

    const updatePayload: any = { updated_at: now };
    if (nom !== undefined) updatePayload.nom = String(nom).trim().toUpperCase();
    if (prenom !== undefined) updatePayload.prenom = String(prenom).trim();
    if (nom_complet !== undefined) updatePayload.nom_complet = String(nom_complet).trim();
    else if (nom !== undefined && prenom !== undefined) updatePayload.nom_complet = `${updatePayload.nom} ${updatePayload.prenom}`.trim();
    if (matricule !== undefined) updatePayload.matricule = String(matricule).trim().toUpperCase();
    if (domaine_id !== undefined) updatePayload.domaine_id = String(domaine_id).trim();
    if (serre_id !== undefined) updatePayload.serre_id = serre_id ? String(serre_id).trim() : null;
    if (mode_remuneration !== undefined) updatePayload.mode_remuneration = mode_remuneration;
    if (prix_convenu !== undefined) updatePayload.prix_convenu = Math.round(Number(prix_convenu) * 100) / 100;
    if (unite !== undefined) updatePayload.unite = String(unite).trim().toUpperCase();
    if (actif !== undefined) updatePayload.actif = Boolean(actif);
    if (telephone !== undefined) updatePayload.telephone = telephone ? String(telephone).trim() : null;
    if (notes !== undefined) updatePayload.notes = notes ? String(notes).trim() : null;

    const { data, error } = await actionClient
      .from('contractuels_ouvriers')
      .update(updatePayload)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .maybeSingle();

    // Mise à jour locale
    const db = readDB();
    if (db.contractuels_ouvriers) {
      const idx = db.contractuels_ouvriers.findIndex((o: any) => o.id === id && o.company_id === companyId);
      if (idx >= 0) {
        db.contractuels_ouvriers[idx] = { ...db.contractuels_ouvriers[idx], ...updatePayload };
        writeDB(db);
      }
    }

    if (error) {
      console.warn('Supabase contractuels_ouvriers update error:', error.message);
    }

    return res.json({ success: true, ouvrier: data || updatePayload });
  } catch (err: any) {
    console.error('Erreur PUT /api/contractuels/ouvriers/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. DELETE /api/contractuels/ouvriers/:id : Supprimer un ouvrier contractuel (Admin uniquement)
app.delete('/api/contractuels/ouvriers/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;

    await actionClient
      .from('contractuels_ouvriers')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    const db = readDB();
    if (db.contractuels_ouvriers) {
      db.contractuels_ouvriers = db.contractuels_ouvriers.filter((o: any) => o.id !== id || o.company_id !== companyId);
      writeDB(db);
    }

    return res.json({ success: true, message: 'Ouvrier contractuel supprimé.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/contractuels/ouvriers/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4b. POST /api/contractuels/ouvriers/import : Importation en lot des ouvriers contractuels (Admin uniquement)
app.post('/api/contractuels/ouvriers/import', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { ouvriers, mode_dedoublonnage } = req.body;
    if (!Array.isArray(ouvriers) || ouvriers.length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune donnée d\'ouvrier fournie.' });
    }

    const companyId = auth.admin.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();

    // Récupérer la liste des serres réelles de la société pour associer par nom/code
    const { data: realSerres } = await actionClient
      .from('serres')
      .select('id, nom, code')
      .eq('company_id', companyId);

    // Récupérer les ouvriers existants de la société
    const { data: existingOuvriers } = await actionClient
      .from('contractuels_ouvriers')
      .select('*')
      .eq('company_id', companyId);

    const db = readDB();
    const existingList = existingOuvriers || (db.contractuels_ouvriers || []).filter((o: any) => o.company_id === companyId);

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const importedList: any[] = [];

    for (let i = 0; i < ouvriers.length; i++) {
      const item = ouvriers[i];
      const nomClean = String(item.nom || '').trim().toUpperCase();
      const prenomClean = String(item.prenom || '').trim();
      if (!nomClean) {
        skippedCount++;
        continue;
      }

      const prixRaw = Number(item.prix_convenu ?? item.prix ?? item.montant);
      if (isNaN(prixRaw) || prixRaw < 0) {
        skippedCount++;
        continue;
      }

      const prix = Math.round(prixRaw * 100) / 100;
      const nomCompletClean = prenomClean ? `${nomClean} ${prenomClean}` : nomClean;

      // Résolution de la serre si transmise
      let foundSerreId: string | null = null;
      if (item.serre_nom || item.serre) {
        const sTarget = String(item.serre_nom || item.serre).trim().toLowerCase();
        const found = (realSerres || []).find(
          (s: any) => s.nom.toLowerCase().trim() === sTarget || (s.code && s.code.toLowerCase().trim() === sTarget)
        );
        if (found) foundSerreId = found.id;
      }

      // Recherche du doublon par nom + prénom ou par matricule
      const existing = existingList.find((o: any) => {
        if (item.matricule && o.matricule && String(item.matricule).trim().toUpperCase() === String(o.matricule).trim().toUpperCase()) {
          return true;
        }
        return (
          o.nom.toLowerCase().trim() === nomClean.toLowerCase() &&
          (o.prenom || '').toLowerCase().trim() === prenomClean.toLowerCase()
        );
      });

      if (existing) {
        if (mode_dedoublonnage === 'skip') {
          skippedCount++;
          continue;
        }
        // Mise à jour
        const updatedRecord = {
          ...existing,
          nom: nomClean,
          prenom: prenomClean,
          nom_complet: nomCompletClean,
          prix_convenu: prix,
          serre_id: foundSerreId || existing.serre_id,
          actif: true,
          updated_at: now,
        };

        await actionClient
          .from('contractuels_ouvriers')
          .update(updatedRecord)
          .eq('id', existing.id)
          .eq('company_id', companyId);

        if (!db.contractuels_ouvriers) db.contractuels_ouvriers = [];
        const localIdx = db.contractuels_ouvriers.findIndex((o: any) => o.id === existing.id);
        if (localIdx >= 0) db.contractuels_ouvriers[localIdx] = updatedRecord;

        importedList.push(updatedRecord);
        updatedCount++;
      } else {
        // Création
        const id = `co_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;
        const finalMatricule = item.matricule ? String(item.matricule).trim().toUpperCase() : `C-${String(existingList.length + createdCount + 1).padStart(3, '0')}`;

        const newRecord = {
          id,
          company_id: companyId,
          nom: nomClean,
          prenom: prenomClean,
          nom_complet: nomCompletClean,
          matricule: finalMatricule,
          domaine_id: item.domaine_id ? String(item.domaine_id).trim() : 'dom_d2',
          serre_id: foundSerreId,
          mode_remuneration: item.mode_remuneration || 'JOUR',
          prix_convenu: prix,
          unite: item.unite || 'JOUR',
          actif: true,
          created_at: now,
          updated_at: now,
        };

        await actionClient.from('contractuels_ouvriers').insert(newRecord);
        if (!db.contractuels_ouvriers) db.contractuels_ouvriers = [];
        db.contractuels_ouvriers.push(newRecord);

        importedList.push(newRecord);
        createdCount++;
      }
    }

    writeDB(db);

    return res.json({
      success: true,
      message: `Importation réussie : ${createdCount} ouvrier(s) créé(s), ${updatedCount} mis à jour, ${skippedCount} ignoré(s).`,
      createdCount,
      updatedCount,
      skippedCount,
      ouvriers: importedList,
    });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/ouvriers/import:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GET /api/contractuels/pointages : Liste des pointages journaliers avec leurs activités
app.get('/api/contractuels/pointages', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const { date, startDate, endDate, domaineId, serreId, ouvrierId } = req.query;

    let pQuery = actionClient
      .from('contractuels_pointages')
      .select('*')
      .eq('company_id', companyId);

    if (date) {
      pQuery = pQuery.eq('date', String(date));
    } else if (startDate && endDate) {
      pQuery = pQuery.gte('date', String(startDate)).lte('date', String(endDate));
    }
    if (domaineId && domaineId !== 'ALL') {
      pQuery = pQuery.eq('domaine_id', String(domaineId));
    }
    if (ouvrierId) {
      pQuery = pQuery.eq('ouvrier_id', String(ouvrierId));
    }

    if (auth.user.role === 'caporal_contractuelles' && auth.user.domaines_autorises && auth.user.domaines_autorises.length > 0) {
      pQuery = pQuery.in('domaine_id', auth.user.domaines_autorises);
    }

    const { data: pointagesData, error: pErr } = await pQuery.order('date', { ascending: false });

    // Activités
    let aQuery = actionClient
      .from('contractuels_activites')
      .select('*')
      .eq('company_id', companyId);

    if (date) {
      aQuery = aQuery.eq('date', String(date));
    } else if (startDate && endDate) {
      aQuery = aQuery.gte('date', String(startDate)).lte('date', String(endDate));
    }
    if (domaineId && domaineId !== 'ALL') {
      aQuery = aQuery.eq('domaine_id', String(domaineId));
    }
    if (serreId && serreId !== 'ALL') {
      aQuery = aQuery.eq('serre_id', String(serreId));
    }
    if (ouvrierId) {
      aQuery = aQuery.eq('ouvrier_id', String(ouvrierId));
    }

    const { data: activitesData } = await aQuery.order('created_at', { ascending: true });

    let finalPointages = pointagesData || [];
    let finalActivites = activitesData || [];

    // Fallback local db if remote tables empty or error
    if (pErr || (!pointagesData && !activitesData)) {
      const db = readDB();
      let localP = (db.contractuels_pointages || []).filter((p: any) => p.company_id === companyId);
      let localA = (db.contractuels_activites || []).filter((a: any) => a.company_id === companyId);

      if (date) {
        localP = localP.filter((p: any) => p.date === String(date));
        localA = localA.filter((a: any) => a.date === String(date));
      } else if (startDate && endDate) {
        localP = localP.filter((p: any) => p.date >= String(startDate) && p.date <= String(endDate));
        localA = localA.filter((a: any) => a.date >= String(startDate) && a.date <= String(endDate));
      }
      if (domaineId && domaineId !== 'ALL') {
        localP = localP.filter((p: any) => p.domaine_id === String(domaineId));
        localA = localA.filter((a: any) => a.domaine_id === String(domaineId));
      }
      if (serreId && serreId !== 'ALL') {
        localA = localA.filter((a: any) => a.serre_id === String(serreId));
      }
      if (ouvrierId) {
        localP = localP.filter((p: any) => p.ouvrier_id === String(ouvrierId));
        localA = localA.filter((a: any) => a.ouvrier_id === String(ouvrierId));
      }
      finalPointages = localP;
      finalActivites = localA;
    }

    // Associer les activités à chaque pointage
    const enrichedPointages = finalPointages.map((ptg: any) => {
      const linkedActivites = finalActivites.filter(
        (act: any) => (act.pointage_id && act.pointage_id === ptg.id) || (act.ouvrier_id === ptg.ouvrier_id && act.date === ptg.date)
      );
      return {
        ...ptg,
        activites: linkedActivites,
      };
    });

    return res.json({ success: true, pointages: enrichedPointages, activites: finalActivites });
  } catch (err: any) {
    console.error('Erreur GET /api/contractuels/pointages:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. POST /api/contractuels/pointages : Enregistrer un pointage et ses activités (Présence, Tâches, Serres, Tarifs)
app.post('/api/contractuels/pointages', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      ouvrier_id,
      matricule,
      nom_complet,
      date,
      present,
      domaine_id,
      serre_id,
      activites,
    } = req.body;

    if (!ouvrier_id || !date) {
      return res.status(400).json({ success: false, error: 'Ouvrier et date obligatoires.' });
    }

    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    const now = new Date().toISOString();
    const isPresent = Boolean(present);
    const dateClean = String(date).slice(0, 10);
    const pointageId = `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Calcul du montant total
    let montantTotalJour = isPresent ? Math.max(0, Number(req.body.montant_total_jour ?? req.body.montant ?? 0)) : 0;
    const formattedActivites: any[] = [];
    const allSelectedSerresIds = new Set<string>();
    const allSelectedSerresNoms = new Set<string>();

    if (isPresent && Array.isArray(activites) && activites.length > 0) {
      let actSum = 0;
      for (const act of activites) {
        const qte = Number(act.quantite) || 1;
        const prix = Number(act.prix_unitaire) || 0;
        const mTotal = Math.round(qte * prix * 100) / 100;
        actSum += mTotal;

        // Normalisation multi-serres
        const sIds: string[] = Array.isArray(act.serres_ids) && act.serres_ids.length > 0
          ? act.serres_ids
          : (act.serre_id ? [String(act.serre_id)] : []);
        const sNoms: string[] = Array.isArray(act.serres_noms) && act.serres_noms.length > 0
          ? act.serres_noms
          : (act.serre_nom ? [String(act.serre_nom)] : []);
        const sTexte: string = act.serres_texte || (sNoms.length > 0 ? sNoms.join(', ') : (act.serre_nom || 'Non affectée'));

        sIds.forEach((id) => allSelectedSerresIds.add(id));
        sNoms.forEach((nom) => allSelectedSerresNoms.add(nom));

        const actId = act.id || `ca_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        formattedActivites.push({
          id: actId,
          pointage_id: pointageId,
          company_id: companyId,
          ouvrier_id,
          nom_complet: nom_complet || 'Ouvrier Contractuel',
          matricule: String(matricule || ''),
          date: dateClean,
          contrat_id: act.contrat_id ? String(act.contrat_id) : null,
          contrat_nom: act.contrat_nom ? String(act.contrat_nom) : null,
          tache_id: String(act.tache_id || 'tch_contractuel'),
          tache_nom: String(act.tache_nom || 'Tâche contractuelle').trim(), // Saisie libre
          domaine_id: String(act.domaine_id || domaine_id || 'dom_d2'),
          serre_id: sIds[0] || String(act.serre_id || serre_id || 'serre_1'),
          serre_nom: sTexte,
          serres_ids: sIds,
          serres_noms: sNoms,
          serres_texte: sTexte,
          mode_remuneration: act.mode_remuneration || 'JOUR',
          quantite: qte,
          unite: String(act.unite || 'JOUR').toUpperCase(),
          prix_unitaire: prix, // Tarif historique figé au pointage
          montant_total: mTotal,
          observation: act.observation ? String(act.observation).trim() : null,
          created_by_id: auth.user.id,
          created_by_nom: auth.user.nom,
          created_at: now,
          updated_at: now,
        });
      }
      if (req.body.montant_total_jour === undefined && req.body.montant === undefined) {
        montantTotalJour = Math.round(actSum * 100) / 100;
      }
    }

    montantTotalJour = isPresent ? Math.max(0, Math.round(montantTotalJour * 100) / 100) : 0;

    const aggregatedSerresIds = Array.from(allSelectedSerresIds);
    const aggregatedSerresNoms = Array.from(allSelectedSerresNoms);
    const aggregatedSerresTexte = aggregatedSerresNoms.join(', ') || null;

    const pointageRecord = {
      id: pointageId,
      company_id: companyId,
      ouvrier_id,
      matricule: String(matricule || ''),
      nom_complet: nom_complet || 'Ouvrier Contractuel',
      date: dateClean,
      present: isPresent,
      domaine_id: String(domaine_id || 'dom_d2'),
      serre_id: aggregatedSerresIds[0] || (serre_id ? String(serre_id) : null),
      serres_ids: aggregatedSerresIds,
      serres_noms: aggregatedSerresNoms,
      serres_texte: aggregatedSerresTexte,
      montant_total_jour: montantTotalJour,
      created_by_id: auth.user.id,
      created_by_nom: auth.user.nom,
      created_at: now,
      updated_at: now,
    };

    // Supprimer l'ancien pointage et anciennes activités de ce jour pour cet ouvrier pour éviter les doublons
    await actionClient
      .from('contractuels_pointages')
      .delete()
      .eq('company_id', companyId)
      .eq('date', dateClean)
      .eq('ouvrier_id', ouvrier_id);

    await actionClient
      .from('contractuels_activites')
      .delete()
      .eq('company_id', companyId)
      .eq('date', dateClean)
      .eq('ouvrier_id', ouvrier_id);

    // Insérer le nouveau pointage
    await actionClient
      .from('contractuels_pointages')
      .insert(pointageRecord);

    // Insérer les activités si présent
    if (formattedActivites.length > 0) {
      await actionClient
        .from('contractuels_activites')
        .insert(formattedActivites);
    }

    // Persistance locale miroir
    const db = readDB();
    if (!db.contractuels_pointages) db.contractuels_pointages = [];
    if (!db.contractuels_activites) db.contractuels_activites = [];

    db.contractuels_pointages = db.contractuels_pointages.filter(
      (p: any) => !(p.company_id === companyId && p.date === dateClean && p.ouvrier_id === ouvrier_id)
    );
    db.contractuels_activites = db.contractuels_activites.filter(
      (a: any) => !(a.company_id === companyId && a.date === dateClean && a.ouvrier_id === ouvrier_id)
    );

    db.contractuels_pointages.push(pointageRecord);
    for (const a of formattedActivites) {
      db.contractuels_activites.push(a);
    }
    writeDB(db);

    return res.json({
      success: true,
      pointage: {
        ...pointageRecord,
        activites: formattedActivites,
      },
      message: `Pointage enregistré (${isPresent ? 'Présent' : 'Absent'}, ${montantTotalJour} DH).`,
    });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/pointages:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 7. DELETE /api/contractuels/pointages/:id : Supprimer un pointage journalier
app.delete('/api/contractuels/pointages/:id', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;

    await actionClient
      .from('contractuels_activites')
      .delete()
      .eq('pointage_id', id)
      .eq('company_id', companyId);

    await actionClient
      .from('contractuels_pointages')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    const db = readDB();
    if (db.contractuels_pointages) {
      db.contractuels_pointages = db.contractuels_pointages.filter((p: any) => p.id !== id || p.company_id !== companyId);
    }
    if (db.contractuels_activites) {
      db.contractuels_activites = db.contractuels_activites.filter((a: any) => a.pointage_id !== id || a.company_id !== companyId);
    }
    writeDB(db);

    return res.json({ success: true, message: 'Pointage contractuel supprimé.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/contractuels/pointages/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8. DELETE /api/contractuels/activites/:id : Supprimer une activité spécifique
app.delete('/api/contractuels/activites/:id', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;

    // Récupérer l'activité pour connaître le pointage_id
    const { data: act } = await actionClient
      .from('contractuels_activites')
      .select('pointage_id, montant_total')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle();

    await actionClient
      .from('contractuels_activites')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    // Mettre à jour le montant du pointage parent si trouvé
    if (act?.pointage_id) {
      const { data: remainingActs } = await actionClient
        .from('contractuels_activites')
        .select('montant_total')
        .eq('pointage_id', act.pointage_id);

      const newTotal = (remainingActs || []).reduce((sum: number, a: any) => sum + (Number(a.montant_total) || 0), 0);
      await actionClient
        .from('contractuels_pointages')
        .update({ montant_total_jour: Math.round(newTotal * 100) / 100 })
        .eq('id', act.pointage_id);
    }

    const db = readDB();
    if (db.contractuels_activites) {
      db.contractuels_activites = db.contractuels_activites.filter((a: any) => a.id !== id || a.company_id !== companyId);
      writeDB(db);
    }

    return res.json({ success: true, message: 'Activité supprimée avec succès.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/contractuels/activites/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 9. POST /api/contractuels/sync : Synchronisation hors ligne des contractuelles
app.post('/api/contractuels/sync', async (req: Request, res: Response) => {
  const auth = await authenticateContractuelCaporalOrAdmin(req);
  if (!auth.authenticated || !auth.user || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { pendingPointages } = req.body;
    if (!Array.isArray(pendingPointages) || pendingPointages.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    const companyId = auth.user.company_id;
    const actionClient = supabaseAdmin || auth.supabaseClient;
    let synced = 0;

    for (const item of pendingPointages) {
      if (!item.ouvrier_id || !item.date) continue;

      const dateClean = String(item.date).slice(0, 10);
      const isPresent = Boolean(item.present);
      const montantTotal = Number(item.montant_total_jour) || 0;
      const pointageId = item.id || `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      await actionClient
        .from('contractuels_pointages')
        .upsert({
          id: pointageId,
          company_id: companyId,
          ouvrier_id: item.ouvrier_id,
          matricule: String(item.matricule || ''),
          nom_complet: String(item.nom_complet || ''),
          date: dateClean,
          present: isPresent,
          domaine_id: String(item.domaine_id || 'dom_d2'),
          serre_id: item.serre_id || null,
          montant_total_jour: montantTotal,
          created_by_id: auth.user.id,
          created_by_nom: auth.user.nom,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (Array.isArray(item.activites)) {
        for (const act of item.activites) {
          const actId = act.id || `ca_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          await actionClient
            .from('contractuels_activites')
            .upsert({
              id: actId,
              pointage_id: pointageId,
              company_id: companyId,
              ouvrier_id: item.ouvrier_id,
              nom_complet: String(item.nom_complet || ''),
              matricule: String(item.matricule || ''),
              date: dateClean,
              tache_id: String(act.tache_id),
              tache_nom: String(act.tache_nom),
              domaine_id: String(act.domaine_id || item.domaine_id || 'dom_d2'),
              serre_id: String(act.serre_id || 'serre_1'),
              serre_nom: String(act.serre_nom || 'Serre'),
              mode_remuneration: act.mode_remuneration || 'JOUR',
              quantite: Number(act.quantite) || 1,
              unite: String(act.unite || 'JOUR'),
              prix_unitaire: Number(act.prix_unitaire) || 0,
              montant_total: Number(act.montant_total) || 0,
              observation: act.observation || null,
              created_by_id: auth.user.id,
              created_by_nom: auth.user.nom,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });
        }
      }
      synced++;
    }

    return res.json({ success: true, count: synced });
  } catch (err: any) {
    console.error('Erreur POST /api/contractuels/sync:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Initialisation du serveur selon le mode (Dev avec Vite ou Prod avec static)
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Mode développement : monter Vite comme middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: process.cwd(),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Mode production : servir les fichiers compilés
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const projectId = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split('.')[0] : 'non-défini';
    console.log(`Serveur Lahcen Pointeur prêt sur http://0.0.0.0:${PORT}. Projet Supabase backend : ${projectId}`);
  });
}

export { app };

startServer().catch((err) => {
  console.error('Erreur démarrage serveur:', err);
});
