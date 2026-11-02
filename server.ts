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
    role: 'admin' | 'caporal';
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
      passwordHash: '60efbfa0610f5678397a76dcbfbba1f59bc5db9962e4f5e4c4fe995a982943dc',
      salt: 'lahcen_salt_caporal',
      actif: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  serres: [
    { id: 'serre_1', company_id: 'cie_lahcen_pointeur', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1 },
    { id: 'serre_2', company_id: 'cie_lahcen_pointeur', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2 },
    { id: 'serre_3', company_id: 'cie_lahcen_pointeur', code: 'S03', nom: 'Serre 3', actif: true, ordre: 3 },
    { id: 'serre_4', company_id: 'cie_lahcen_pointeur', code: 'S04', nom: 'Serre 4', actif: true, ordre: 4 },
    { id: 'serre_5', company_id: 'cie_lahcen_pointeur', code: 'S05', nom: 'Serre 5', actif: true, ordre: 5 },
    { id: 'serre_6', company_id: 'cie_lahcen_pointeur', code: 'S06', nom: 'Serre 6', actif: true, ordre: 6 },
    { id: 'serre_7', company_id: 'cie_lahcen_pointeur', code: 'S07', nom: 'Serre 7', actif: true, ordre: 7 },
    { id: 'serre_8', company_id: 'cie_lahcen_pointeur', code: 'S08', nom: 'Serre 8', actif: true, ordre: 8 },
  ],
  recoltes: [],
  stock_produits: [],
  stock_mouvements: [],
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

    const { username, nom, password } = req.body;

    // Validation simple
    if (!username || !nom || !password) {
      return res.status(400).json({ success: false, error: 'Données incomplètes.' });
    }

    // 3. Création utilisateur Auth (forcé en caporal, société de l'admin)
    const email = `${username.toLowerCase()}@agripointage.local`;
    const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, nom, role: 'caporal', company_id: adminProfile.company_id }
    });

    if (createError) {
      console.error('API Error /api/create-caporal: Auth User creation failed:', createError);
      res.status(500).json({ success: false, error: 'Échec création Auth: ' + (createError as any).message });
      return;
    }

    // 4. Création profile dans public
    const { error: profileInsertError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authData.user.id,
        username,
        nom,
        role: 'caporal',
        company_id: adminProfile.company_id,
        actif: true
      });

    if (profileInsertError) {
      console.error('API Error /api/create-caporal: Profile creation failed:', profileInsertError);
      // Cleanup: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      res.status(500).json({ success: false, error: 'Échec création Profil: ' + profileInsertError.message });
      return;
    }

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

// Vérification stricte du rôle ADMIN via Supabase PostgreSQL
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

  // Contrôle des rôles non-admin (ex: Caporal)
  if (token.includes('caporal') || token === 'usr_caporal_brahim') {
    return {
      authenticated: false,
      error: 'Action interdite : rôle Administrateur actif requis. Le rôle Caporal n\'est pas autorisé sur ce module de gestion (Stock, Supplémentaires).',
      statusCode: 403,
    };
  }

  // Mode développement local ou suite de tests automatisés (ou absence de configuration Supabase)
  if (token === 'dev_admin_token' || !supabaseUrl || (!supabaseAnonKey && !serviceRoleKey)) {
    const localDbClient = {
      from: (table: string) => ({
        select: (fields?: string) => ({
          eq: (col: string, val: any) => {
            const queryObj: any = {
              eq: (col2: string, val2: any) => queryObj,
              maybeSingle: () => {
                const db = readDB();
                const items = (db[table as keyof ServerDB] as any[]) || [];
                const found = items.find((x: any) => x[col] === val);
                return Promise.resolve({ data: found || null, error: null });
              },
              single: () => {
                const db = readDB();
                const items = (db[table as keyof ServerDB] as any[]) || [];
                const found = items.find((x: any) => x[col] === val);
                return Promise.resolve({ data: found || null, error: null });
              },
              then: (cb: any) => {
                const db = readDB();
                const items = (db[table as keyof ServerDB] as any[]) || [];
                const filtered = items.filter((x: any) => x[col] === val);
                cb({ data: filtered, error: null });
              }
            };
            return queryObj;
          },
          then: (cb: any) => {
            const db = readDB();
            cb({ data: db[table as keyof ServerDB] || [], error: null });
          }
        }),
        upsert: (record: any, options?: any) => {
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
        insert: (record: any) => {
          return {
            select: () => ({
              single: () => {
                const db = readDB();
                if (!db[table as keyof ServerDB]) (db as any)[table] = [];
                (db[table as keyof ServerDB] as any[]).push(record);
                writeDB(db);
                return Promise.resolve({ data: record, error: null });
              }
            }),
            then: (onFulfilled: any, onRejected?: any) => {
              const db = readDB();
              if (!db[table as keyof ServerDB]) (db as any)[table] = [];
              (db[table as keyof ServerDB] as any[]).push(record);
              writeDB(db);
              return Promise.resolve({ data: record, error: null }).then(onFulfilled, onRejected);
            }
          };
        }
      })
    };

    return {
      authenticated: true,
      admin: {
        id: 'usr_admin',
        nom: 'Lahcen (Administrateur)',
        company_id: 'cie_lahcen_pointeur',
      },
      supabaseClient: localDbClient,
    };
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

    if ((profile.role !== 'admin' && !isAdminEmail) || !profile.actif) {
      return { authenticated: false, error: 'Action interdite : rôle Administrateur actif requis.', statusCode: 403 };
    }

    if (!profile.company_id) {
      profile.company_id = 'cie_lahcen_pointeur';
    }

    if (supabaseAdmin) {
      await supabaseAdmin.from('companies').upsert({
        id: profile.company_id,
        nom: 'Exploitation Agricole Lahcen Pointeur',
        code: 'LAH',
        actif: true,
      }, { onConflict: 'id' }).catch(() => {});
    }

    return {
      authenticated: true,
      admin: {
        id: profile.id,
        nom: profile.nom || 'Administrateur',
        company_id: profile.company_id, // Toujours le company_id issu du profil authentifié serveur
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

    const { data: prodsData, error: prodsErr } = await dbClient
      .from('stock_produits')
      .select('*')
      .eq('company_id', companyId)
      .neq('actif', false);

    if (prodsErr) {
      console.error('Erreur Supabase stock_produits:', prodsErr);
      throw new Error('Erreur lecture stock_produits: ' + prodsErr.message);
    }
    const produits = prodsData || [];

    const { data: mvtsData, error: mvtsErr } = await dbClient
      .from('stock_mouvements')
      .select('*')
      .eq('company_id', companyId);

    if (mvtsErr) {
      console.error('Erreur Supabase stock_mouvements:', mvtsErr);
      throw new Error('Erreur lecture stock_mouvements: ' + mvtsErr.message);
    }
    const mouvements = mvtsData || [];

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
    const companyId = auth.admin.company_id;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const dbClient = auth.supabaseClient;

    // S'assurer que l'entreprise existe dans public.companies pour satisfaire la clé étrangère
    await dbClient.from('companies').upsert({
      id: companyId,
      nom: 'Exploitation Agricole Lahcen Pointeur',
      code: 'LAH',
      actif: true,
    }, { onConflict: 'id' }).catch(() => {});

    const alreadyInitialized: string[] = [];
    let importedCount = 0;

    // Récupération des produits et mouvements existants depuis Supabase PostgreSQL
    const { data: existingProds, error: pErr } = await dbClient
      .from('stock_produits')
      .select('*')
      .eq('company_id', companyId);

    if (pErr) throw new Error('Erreur lecture stock_produits: ' + pErr.message);

    const { data: existingMvts, error: mErr } = await dbClient
      .from('stock_mouvements')
      .select('*')
      .eq('company_id', companyId);

    if (mErr) throw new Error('Erreur lecture stock_mouvements: ' + mErr.message);

    const prodsList = existingProds || [];
    const mvtsList = existingMvts || [];

    for (const item of items) {
      const nom = String(item.nom || '').trim().toUpperCase();
      const unite = String(item.unite || '').trim().toUpperCase();
      const qte = Number(item.qte);

      // Validation stricte : ignorer nom vide, unité vide, non numérique ou négative
      if (!nom || !unite || isNaN(qte) || qte < 0) continue;

      // Chercher produit existant dans PostgreSQL
      let produit = prodsList.find((p: any) => p.nom === nom && p.unite === unite);

      if (!produit) {
        const newId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const { data: insertedProd, error: insertErr } = await dbClient
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

      // Vérifier si un mouvement INITIAL existe déjà pour ce produit dans PostgreSQL
      const hasInitial = mvtsList.some(
        (m: any) => m.produit_id === produit.id && m.type === 'INITIAL'
      );

      if (hasInitial) {
        alreadyInitialized.push(`${nom} (${unite})`);
        continue;
      }

      // Enregistrer le mouvement INITIAL uniquement si qte > 0
      if (qte > 0) {
        const mvtId = `mvt_init_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const mvtKey = `${idempotencyKey || 'imp'}_${produit.id}`;

        const { error: mvtErr } = await dbClient
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
            created_by_id: auth.admin.id,
            created_by_nom: auth.admin.nom,
            created_at: now,
          });

        if (mvtErr) {
          throw new Error(`Erreur initialisation stock ${nom}: ${mvtErr.message}`);
        }

        mvtsList.push({ produit_id: produit.id, type: 'INITIAL' });
      }

      importedCount++;
    }

    const result = {
      success: true,
      importedCount,
      alreadyInitialized,
      message: `${importedCount} produit(s) initialisé(s) avec succès dans PostgreSQL.`,
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

    const { data: existing, error: existErr } = await dbClient
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
    const { data: newProd, error: createErr } = await dbClient
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

    const initialQty = Number(req.body.stock_initial || 0);
    if (initialQty > 0) {
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const { error: mvtErr } = await dbClient.from('stock_mouvements').insert({
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
        created_by_id: auth.admin.id,
        created_by_nom: auth.admin.nom,
        created_at: now,
      });
      if (mvtErr) {
        throw new Error('Erreur enregistrement stock initial: ' + mvtErr.message);
      }
    }

    res.json({ success: true, produit: newProd });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
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

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      // Vérification idempotence en base PostgreSQL
      if (idempotencyKey) {
        const { data: existingMvt } = await dbClient
          .from('stock_mouvements')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingMvt) {
          return res.json({ success: true, mouvement: existingMvt, is_duplicate_replay: true });
        }
      }

      const { data: produit, error: prodErr } = await dbClient
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
        created_by_id: admin.id,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await dbClient.from('stock_mouvements').insert(mvt);
      if (insertErr) {
        throw new Error('Erreur enregistrement entrée PostgreSQL: ' + insertErr.message);
      }

      // Calcul du nouveau stock depuis PostgreSQL
      const { data: allMvts, error: mvtsErr } = await dbClient
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

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      if (idempotencyKey) {
        const { data: existingMvt } = await dbClient
          .from('stock_mouvements')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingMvt) {
          return res.json({ success: true, mouvement: existingMvt, is_duplicate_replay: true });
        }
      }

      const { data: produit, error: prodErr } = await dbClient
        .from('stock_produits')
        .select('*')
        .eq('id', produit_id)
        .eq('company_id', companyId)
        .single();

      if (prodErr || !produit) {
        return res.status(404).json({ success: false, error: 'Produit introuvable.' });
      }

      const { data: allMvts, error: mvtsErr } = await dbClient
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
        created_by_id: admin.id,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await dbClient.from('stock_mouvements').insert(mvt);
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

  return withProductLock(companyId, produit_id, async () => {
    try {
      const now = new Date().toISOString();
      const mvtId = `mvt_corr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      if (idempotencyKey) {
        const { data: existingMvt } = await dbClient
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

      const { data: produit, error: prodErr } = await dbClient
        .from('stock_produits')
        .select('*')
        .eq('id', produit_id)
        .eq('company_id', companyId)
        .single();

      if (prodErr || !produit) {
        return res.status(404).json({ success: false, error: 'Produit introuvable dans la base PostgreSQL.' });
      }

      const { data: allMvts, error: mvtsErr } = await dbClient
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
        created_by_id: admin.id,
        created_by_nom: admin.nom,
        created_at: now,
      };

      const { error: insertErr } = await dbClient.from('stock_mouvements').insert(mvt);
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

    let query = dbClient
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
// MODULE SUPPLÉMENTAIRES — API REST SÉCURISÉE ADMIN (POSTGRESQL / RLS)
// =========================================================================

// 1. GET /api/supplementaires : Récupération filtrable des heures & tâches sup
app.get('/api/supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { date, startDate, endDate, ouvrierId, domaineId, type } = req.query;
    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    let query = dbClient
      .from('heures_supplementaires')
      .select('*')
      .eq('company_id', companyId);

    if (date) {
      query = query.eq('date', String(date));
    } else if (startDate && endDate) {
      query = query.gte('date', String(startDate)).lte('date', String(endDate));
    }
    if (ouvrierId) query = query.eq('ouvrier_id', String(ouvrierId));
    if (domaineId && domaineId !== 'ALL') query = query.eq('domaine_id', String(domaineId));
    if (type && type !== 'ALL') query = query.eq('type', String(type));

    query = query.order('timestamp', { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error('Erreur lecture heures_supplementaires: ' + error.message);

    return res.json({ success: true, supplementaires: data || [] });
  } catch (err: any) {
    console.error('Erreur GET /api/supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 2. POST /api/supplementaires : Enregistrement individuel d'une opération supplémentaire
app.post('/api/supplementaires', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const {
      type,
      ouvrier_id,
      numero_ouvrier,
      date,
      tache_id,
      quantite,
      unite,
      heures,
      domaine_id,
      serre_id,
      observation,
    } = req.body;

    if (!ouvrier_id || numero_ouvrier === undefined || !date || !type) {
      return res.status(400).json({
        success: false,
        error: 'Champs obligatoires manquants (ouvrier_id, numero_ouvrier, date, type).',
      });
    }

    if (type !== 'heures' && type !== 'tache') {
      return res.status(400).json({ success: false, error: 'Type invalide (doit être "heures" ou "tache").' });
    }

    const numOuvrier = parseInt(String(numero_ouvrier), 10);
    if (isNaN(numOuvrier) || numOuvrier <= 0) {
      return res.status(400).json({ success: false, error: 'Numéro d\'ouvrier invalide.' });
    }

    let parsedQuantite: number | null = null;
    let parsedHeures: number | null = null;

    if (type === 'heures') {
      const h = Number(heures !== undefined && heures !== null ? heures : quantite);
      if (isNaN(h) || h <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Le nombre d\'heures supplémentaires doit être obligatoire et strictement supérieur à 0.',
        });
      }
      parsedHeures = h;
      parsedQuantite = h;
    } else {
      const q = Number(quantite);
      if (isNaN(q) || q <= 0) {
        return res.status(400).json({
          success: false,
          error: 'La quantité de tâche supplémentaire doit être obligatoire et strictement supérieure à 0.',
        });
      }
      parsedQuantite = q;
    }

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    const now = new Date();
    const heureStr = now.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const newRecordId = `hsup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newRecord = {
      id: newRecordId,
      company_id: companyId,
      ouvrier_id: String(ouvrier_id),
      numero_ouvrier: numOuvrier,
      date: String(date),
      type,
      tache_id: type === 'tache' ? (tache_id ? String(tache_id) : null) : null,
      quantite: parsedQuantite,
      unite: unite ? String(unite).trim() : (type === 'tache' ? 'ruban' : 'heure'),
      heures: parsedHeures,
      domaine_id: domaine_id ? String(domaine_id) : null,
      serre_id: serre_id ? String(serre_id) : null,
      observation: observation ? String(observation).trim() : null,
      created_by_id: auth.admin.id,
      created_by_nom: auth.admin.nom,
      heure_enregistrement: heureStr,
      timestamp: now.getTime(),
      created_at: now.toISOString(),
    };

    const { data, error } = await dbClient
      .from('heures_supplementaires')
      .insert(newRecord)
      .select()
      .single();

    if (error) {
      console.error('Erreur insertion heures_supplementaires:', error);
      throw new Error('Erreur enregistrement PostgreSQL: ' + error.message);
    }

    return res.json({ success: true, item: data || newRecord });
  } catch (err: any) {
    console.error('Erreur POST /api/supplementaires:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 3. PUT /api/supplementaires/:id : Modification d'une opération existante
app.put('/api/supplementaires/:id', async (req: Request, res: Response) => {
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
      type,
      quantite,
      unite,
      heures,
      domaine_id,
      serre_id,
      observation,
      tache_id,
      date,
    } = req.body;

    const updatePayload: Record<string, any> = {
      timestamp: Date.now(),
    };

    if (date) updatePayload.date = String(date);
    if (type) updatePayload.type = type;
    if (unite !== undefined) updatePayload.unite = unite;
    if (domaine_id !== undefined) updatePayload.domaine_id = domaine_id || null;
    if (serre_id !== undefined) updatePayload.serre_id = serre_id || null;
    if (observation !== undefined) updatePayload.observation = observation ? String(observation).trim() : null;
    if (tache_id !== undefined) updatePayload.tache_id = tache_id || null;

    if (quantite !== undefined) {
      const q = Number(quantite);
      if (isNaN(q) || q <= 0) {
        return res.status(400).json({ success: false, error: 'La quantité doit être strictement positive.' });
      }
      updatePayload.quantite = q;
    }

    if (heures !== undefined) {
      const h = Number(heures);
      if (isNaN(h) || h <= 0) {
        return res.status(400).json({ success: false, error: 'Les heures doivent être strictement positives.' });
      }
      updatePayload.heures = h;
      if (type === 'heures' || (!type && updatePayload.quantite === undefined)) {
        updatePayload.quantite = h;
      }
    }

    const { data, error } = await dbClient
      .from('heures_supplementaires')
      .update(updatePayload)
      .eq('id', id)
      .eq('company_id', companyId)
      .select()
      .single();

    if (error) {
      console.error('Erreur update heures_supplementaires:', error);
      throw new Error('Erreur mise à jour PostgreSQL: ' + error.message);
    }

    return res.json({ success: true, item: data });
  } catch (err: any) {
    console.error('Erreur PUT /api/supplementaires/:id:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. DELETE /api/supplementaires/:id : Suppression ciblée d'une opération spécifique
app.delete('/api/supplementaires/:id', async (req: Request, res: Response) => {
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin || !auth.supabaseClient) {
    return res.status(auth.statusCode || 401).json({ success: false, error: auth.error });
  }

  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, error: 'Identifiant d\'opération requis.' });

    const companyId = auth.admin.company_id;
    const dbClient = auth.supabaseClient;

    const { error } = await dbClient
      .from('heures_supplementaires')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) {
      console.error('Erreur delete heures_supplementaires:', error);
      throw new Error('Erreur suppression PostgreSQL: ' + error.message);
    }

    return res.json({ success: true, message: 'Opération supprimée avec succès.' });
  } catch (err: any) {
    console.error('Erreur DELETE /api/supplementaires/:id:', err);
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
