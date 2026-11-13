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
  serre_id?: string | null; // ID de la serre affectée
  serre_nom?: string | null; // Nom de la serre affectée
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
  domaine_id?: string;
  serre_id?: string | null;
  serre_nom?: string | null;
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
export type ModeCalculHeuresSupp = 'heure' | 'quart_heure';

export interface HeureSupplementaire {
  id: string;
  company_id: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  date: string; // Format ISO YYYY-MM-DD
  tache_id?: string | null; // Tâche associée
  nom_tache?: string | null; // Nom de la tâche
  heure_debut?: string | null; // Format HH:MM (ex: 17:00)
  heure_fin?: string | null; // Format HH:MM (ex: 19:30)
  duree_heures: number; // Durée totale en heures (> 0)
  domaine_id?: string | null; // Domaine
  serre_id?: string | null; // Serre
  observation?: string | null; // Remarque
  created_by_id?: string | null; // ID utilisateur (admin ou caporal)
  created_by_nom?: string | null; // Nom utilisateur
  created_by_role?: 'admin' | 'caporal' | null;
  created_at?: string;
  updated_at?: string | null;
  updated_by_id?: string | null;
  updated_by_nom?: string | null;
  // Nouveau mode de calcul et tarification des heures supplémentaires
  mode_calcul?: ModeCalculHeuresSupp; // 'heure' ou 'quart_heure'
  tarif_unitaire?: number | null; // Prix unitaire en DH (ex: 30 DH/h ou 10 DH/quart)
  nb_unites?: number | null; // Nombre saisi (ex: 2 heures ou 4 quarts)
  remuneration?: number | null; // Rémunération = Prix unitaire × Nombre saisi (ex: 60 DH ou 40 DH)
  montant_total?: number | null; // Montant total en DH
  // Champs rétro-compatibilité
  type?: TypeSupplementaire;
  heures?: number | null;
  quantite?: number | null;
  unite?: string;
  heure_enregistrement?: string;
  timestamp?: number;
}

export interface TacheSupplementaire {
  id: string;
  company_id: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  date: string; // Format ISO YYYY-MM-DD
  tache_id?: string | null;
  nom_tache: string;
  description?: string | null;
  quantite: number; // Quantité physique réalisée (> 0)
  unite: string; // Ex: 'caisse', 'kg', 'mètre', 'pièce', 'ruban', 'forfait', 'heure'
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
  created_by_id?: string | null;
  created_by_nom?: string | null;
  created_by_role?: 'admin' | 'caporal' | null;
  created_at?: string;
  updated_at?: string | null;
  updated_by_id?: string | null;
  updated_by_nom?: string | null;
  heure_enregistrement?: string;
  timestamp?: number;
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

export type UserRole = 'admin' | 'caporal' | 'caporal_contractuelles';

export interface UserAccount {
  id: string;
  username: string; // Identifiant de connexion (ex: 'admin', 'caporal_brahim')
  nom: string; // Nom affiché (ex: 'Lahcen (Administrateur)', 'Brahim')
  role: UserRole;
  company_id: string; // ID de l'entreprise rattachée
  permissions?: any; // Permissions JSONB
  module_attribue?: 'recolte' | 'contractuelles' | 'all'; // Module dédié pour le Caporal
  domaines_autorises?: string[]; // Domaines autorisés pour le Caporal
  serres_autorisees?: string[]; // Serres autorisées
  passwordHash?: string; // Hachage salé (local dev)
  salt?: string;
  actif: boolean;
  telephone?: string;
  createdAt: string;
  lastLogin?: string;
}

export type User = UserAccount;

// ------------------------- MODULE RÉCOLTE & SERRES -------------------------

export interface Serre {
  id: string; // ex: 'serre_1'
  company_id: string;
  code: string; // ex: 'S1', 'S2', 'S03'
  nom: string; // ex: 'Serre 1', 'Serre Tomates'
  actif: boolean;
  ordre: number;
}

export type RecolteOperationType = 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT';

export interface RecolteEntry {
  id: string;
  company_id: string;
  date: string; // Format ISO YYYY-MM-DD
  type_operation?: RecolteOperationType; // 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT' (par défaut 'RECOLTE')
  domaine_id?: string | null;
  serre_id: string;
  serre_nom: string;
  ouvrier_id: string;
  numero_ouvrier: number;
  nom_ouvrier: string;
  caisses: number; // Nombre de caisses ou quantité (> 0)
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

// ------------------------- MODULE STOCK PRO -------------------------

export type StockMouvementType = 'INITIAL' | 'ENTREE' | 'SORTIE' | 'CORRECTION';
export type StockEtat = 'DISPONIBLE' | 'STOCK_FAIBLE' | 'RUPTURE';

export interface StockProduit {
  id: string;
  company_id: string;
  nom: string;
  unite: string;
  seuil_minimum: number;
  actif: boolean;
  created_at: string;
  updated_at?: string;
}

export interface StockMouvement {
  id: string;
  idempotency_key: string;
  company_id: string;
  produit_id: string;
  produit_nom: string;
  unite: string;
  type: StockMouvementType;
  quantite: number;
  date: string;
  domaine_id?: string;
  serre_id?: string;
  tiers?: string; // Fournisseur (entrée) ou Bénéficiaire (sortie)
  reference_document?: string;
  motif?: string;
  observation?: string;
  created_by_id: string;
  created_by_nom: string;
  created_at: string;
}

export interface StockProduitSynthese {
  produit: StockProduit;
  stock_initial: number;
  total_entrees: number;
  total_sorties: number;
  stock_actuel: number;
  etat: StockEtat;
  derniere_activite?: string;
}

export interface StockKPIs {
  totalProduits: number;
  totalEntrees: number;
  totalSorties: number;
  produitsStockFaible: number;
  produitsRupture: number;
}

export interface StockFilter {
  searchQuery?: string;
  unite?: string;
  produit_id?: string;
  etat?: StockEtat | 'ALL';
  domaine_id?: string;
  startDate?: string;
  endDate?: string;
  type?: StockMouvementType | 'ALL';
}

// ------------------------- MODULE GESTION CONTRACTUELLES -------------------------

export type ModeRemuneration = 'JOUR' | 'TACHE' | 'UNITE' | 'HEURE';

export interface ContractuelContrat {
  id: string;
  company_id: string;
  code?: string;
  designation: string; // Ex: 'TAILLE & ÉGOURGEONNAGE', 'RÉCOLTE TOMATES', 'EFFEUILLAGE D1'
  prix_unitaire: number; // Prix de référence en DH
  unite: string; // Ex: 'JOUR', 'TACHE', 'CAISSE', 'KG', 'HEURE', 'M2'
  mode_remuneration: ModeRemuneration;
  domaine_id?: string;
  description?: string;
  actif: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ContractuelOuvrier {
  id: string;
  company_id: string;
  nom: string;
  prenom: string;
  nom_complet: string;
  matricule: string;
  domaine_id: string; // Ex: 'dom_d2'
  serre_id?: string | null; // Serre habituelle
  mode_remuneration: ModeRemuneration;
  prix_convenu: number; // Prix en DH
  unite?: string; // Ex: 'JOUR', 'TACHE', 'CAISSE', 'KG', 'HEURE', 'PIÈCE'
  actif: boolean;
  telephone?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

export interface ContractuelActivite {
  id: string;
  pointage_id?: string;
  company_id: string;
  ouvrier_id: string;
  nom_complet: string;
  matricule: string;
  date: string; // Format ISO YYYY-MM-DD
  contrat_id?: string | null;
  contrat_nom?: string | null;
  tache_id: string;
  tache_nom?: string; // Saisie libre par le Caporal (ex: 'Nettoyage des serres', 'Effeuillage')
  domaine_id: string;
  serre_id?: string | null; // Première serre ou serre principale (compatibilité rétroactive)
  serre_nom?: string; // Nom ou texte descriptif des serres
  serres_ids?: string[]; // Choix multiple des serres (ex: ['serre_1', 'serre_2', 'serre_5'])
  serres_noms?: string[]; // Noms des serres sélectionnées
  serres_texte?: string | null; // Texte lisible (ex: 'Serre 1, Serre 2, Serre 5')
  mode_remuneration: ModeRemuneration;
  quantite: number;
  unite: string;
  prix_unitaire: number; // Prix historique figé au pointage
  montant_total: number; // quantite * prix_unitaire (la multi-sélection ne multiplie pas le prix)
  observation?: string | null;
  created_by_id?: string;
  created_by_nom?: string;
  created_at: string;
  updated_at?: string;
}

export interface ContractuelPointage {
  id: string;
  company_id: string;
  ouvrier_id: string;
  matricule: string;
  nom_complet: string;
  date: string; // Format ISO YYYY-MM-DD
  present: boolean;
  domaine_id: string;
  serre_id?: string | null;
  serres_ids?: string[];
  serres_noms?: string[];
  serres_texte?: string | null;
  activites?: ContractuelActivite[];
  montant_total_jour: number; // Somme des montants des activités
  created_by_id?: string;
  created_by_nom?: string;
  created_at: string;
  updated_at?: string;
}

export interface ContractuelFilter {
  date?: string;
  startDate?: string;
  endDate?: string;
  domaine_id?: string;
  serre_id?: string;
  ouvrier_id?: string;
  present?: boolean;
}

export interface ContractuelStats {
  totalOuvriers: number;
  totalPresents: number;
  totalAbsents: number;
  totalAyantTravaille: number;
  totalTachesRealisees: number;
  montantTotalJourDH: number;
}

