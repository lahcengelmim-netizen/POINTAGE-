/**
 * Types pour l'application AgriPointage Mobile
 * Architecture multi-tenant prête pour base de données
 */

export interface Company {
  id: string;
  nom: string;
  code: string;
  ville?: string;
  createdAt: string;
}

export interface Ouvrier {
  id: string;
  company_id: string;
  numero: number; // Numérique, unique au sein de la société
  nom: string;
  actif: boolean;
  telephone?: string;
  notes?: string;
  createdAt: string;
}

export interface Tache {
  id: string;
  company_id: string;
  code?: string; // Code court unique par société (ex: R01, E01, ROU01)
  nom: string; // Ex: RECOLTE, EFFEUILLAGE, ENTRETIEN, PLANTATION
  actif?: boolean; // false si la tâche est désactivée lors d'un remplacement
  domaine_id?: string; // Domaine optionnel rattaché
  description?: string;
  couleur?: string;
  // 'tous' signifie accessible à tous les ouvriers, ou tableau d'ids d'ouvriers autorisés
  ouvriers_autorises: 'tous' | string[];
  createdAt: string;
}

export interface Domaine {
  id: string; // ex: 'dom_d1', 'dom_d2'
  nom: string; // ex: 'D1', 'D2', 'D3', 'D4', 'D5'
  ordre: number; // 1, 2, 3...
}

export interface Pointage {
  id: string;
  company_id: string;
  ouvrier_id: string;
  numero_ouvrier: number; // Dénormalisé pour garantir l'historique exact
  date: string; // Format ISO YYYY-MM-DD
  present: boolean; // true
  tache_id?: string | null; // Rétrocompatibilité
  domaine_id?: string; // ID du domaine ou code (ex: 'dom_d2')
  heure: string; // Format HH:MM:SS
  timestamp: number;
}

/**
 * Affectation à une tâche : un ouvrier peut être affecté à plusieurs tâches le même jour
 */
export interface AffectationTache {
  id: string;
  company_id: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  tache_id: string;
  date: string; // Format ISO YYYY-MM-DD
  timestamp: number;
}

export interface PointageStats {
  totalActifs: number;
  pointes: number;
  restants: number;
  tauxPresence: number;
}

export type TypeSupplementaire = 'heures' | 'tache';

export interface HeureSupplementaire {
  id: string;
  company_id: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  date: string; // Format ISO YYYY-MM-DD
  type?: TypeSupplementaire; // 'heures' | 'tache' (par défaut 'heures')
  tache_id?: string | null; // Tâche associée si type === 'tache'
  quantite?: number | null; // Quantité (obligatoire si type === 'tache', ou nb d'heures)
  unite?: string; // 'ruban' | 'forfait' | 'heure' ou texte personnalisé
  heures?: number | null; // Rétro-compatibilité si type === 'heures'
  heure_enregistrement: string; // HH:MM:SS
  timestamp: number;
}

export interface RecapLigne {
  titre: string;
  numeros: number[];
  count: number;
}

// ------------------------- SUIVI GAZOIL -------------------------

export type GazoilMouvementType = 'entree' | 'sortie';

export interface GazoilMouvement {
  id: string;
  company_id: string;
  type: GazoilMouvementType; // 'entree' = achat/livraison, 'sortie' = consommation
  date: string; // Format ISO YYYY-MM-DD
  quantite: number; // en Litres
  engin_ou_tache?: string; // Tracteur, pompe, groupe, etc.
  remarque?: string;
  timestamp: number;
}

export interface GazoilCommande {
  active: boolean;
  date: string; // JJ/MM/AAAA
  quantite: number; // en Litres
  fournisseur_tel?: string;
  timestamp: number;
}

export interface GazoilConfig {
  stockInitial: number; // Litres
  initialSet: boolean; // Vrai si le stock initial a été configuré
  seuilAlerte: number; // Par défaut 20 L
  commandeActive: GazoilCommande | null;
  notifiedBelowThreshold?: boolean; // Pour n'envoyer qu'une notification par passage sous le seuil
}

// ------------------------- MULTI-COMPTES & RÔLES -------------------------

export type UserRole = 'admin' | 'caporal';

export interface UserAccount {
  id: string;
  username: string; // Identifiant de connexion (ex: 'admin', 'caporal_brahim')
  nom: string; // Nom affiché (ex: 'Lahcen (Administrateur)', 'Brahim')
  role: UserRole;
  passwordHash: string; // Hachage salé SHA-256
  salt: string;
  actif: boolean;
  telephone?: string;
  createdAt: string;
  lastLogin?: string;
}

// ------------------------- MODULE RÉCOLTE & SERRES -------------------------

export interface Serre {
  id: string; // ex: 'serre_1'
  company_id: string;
  code: string; // ex: 'S1', 'S2', 'S03'
  nom: string; // ex: 'Serre 1', 'Serre Tomates'
  actif: boolean;
  ordre: number;
}

export interface RecolteEntry {
  id: string;
  company_id: string;
  date: string; // Format ISO YYYY-MM-DD
  serre_id: string;
  serre_nom: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  nom_ouvrier: string;
  caisses: number; // Nombre de caisses récoltées (> 0)
  notes?: string;
  created_by_id: string; // ID de l'utilisateur (caporal ou admin)
  created_by_nom: string; // Nom du caporal / créateur
  created_at: string; // Horodatage ISO
  updated_at?: string; // Horodatage ISO dernière modification
  updated_by_id?: string;
  sync_status?: 'synced' | 'pending'; // État de synchronisation réseau
}

export interface RecolteFilter {
  date?: string;
  startDate?: string;
  endDate?: string;
  serre_id?: string;
  ouvrier_id?: string;
  created_by_id?: string;
}

export interface RecolteStats {
  totalCaisses: number;
  totalOuvriersDistincts: number;
  totalSerres: number;
  totalOperations: number;
}

