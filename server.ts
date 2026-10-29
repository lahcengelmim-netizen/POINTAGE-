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

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));

// Emplacement du fichier de persistance du serveur
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'recolte_db.json');

interface ServerDB {
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
      console.error('Auth User creation error:', createError);
      throw createError;
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
      console.error('Profile creation error:', profileInsertError);
      // Cleanup: delete auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      throw profileInsertError;
    }

    res.json({ success: true, user: authData.user });
  } catch (err: any) {
    console.error('API Error /api/create-caporal:', err.message);
    res.status(500).json({ success: false, error: err.message });
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

// Initialisation du serveur selon le mode (Dev avec Vite ou Prod avec static)
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Mode développement : monter Vite comme middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
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

startServer().catch((err) => {
  console.error('Erreur démarrage serveur:', err);
});
