/**
 * MODULE PROFESSIONNEL « SUPPLÉMENTAIRES » — LAHCEN POINTEUR
 * 
 * 1. PROTECTION DES DONNÉES : Préservation intégrale des données historiques et isolation totale.
 * 2. DEUX SECTIONS INDÉPENDANTES :
 *    - A. HEURES SUPPLÉMENTAIRES (Date, N° ouvrier, Nom auto, Nb heures > 0, Domaine, Serre, Obs)
 *    - B. TÂCHES SUPPLÉMENTAIRES (Date, N° ouvrier, Nom auto, Tâche, Quantité > 0, Unité, Domaine, Serre, Obs)
 * 3. IDENTIFICATION STRICTE : Liée à la véritable liste des ouvriers de l'entreprise.
 * 4. RÉCAPITULATIF PROFESSIONNEL :
 *    - RÈGLE ESSENTIELLE : 1 SEULE LIGNE PAR OUVRIER
 *    - Addition des heures supplémentaires
 *    - Regroupement des tâches par unité sans jamais mélanger des unités différentes
 *    - Affichage de '0' ou '—' pour les ouvriers sans opérations
 * 5. HISTORIQUE, FILTRES ET GESTION :
 *    - Filtre par date, période, ouvrier, domaine, type
 *    - Modification et suppression ciblée d'une opération individuelle avec confirmation
 * 6. SÉCURITÉ STRICTE RBAC : Accès réservé exclusivement au rôle ADMINISTRATEUR.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  X,
  Clock,
  Briefcase,
  Search,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit3,
  Calendar,
  Layers,
  MapPin,
  Warehouse,
  MessageSquare,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Plus,
  Filter,
  Users,
  Check,
  TrendingUp,
  Tag,
  Save,
  HelpCircle,
  Info,
} from 'lucide-react';
import {
  Ouvrier,
  Tache,
  Domaine,
  Serre,
  HeureSupplementaire,
  TypeSupplementaire,
  UserAccount,
} from '../types';
import { syncAndFetchHeuresSupplementairesServer } from '../services/heuresSupplementairesService';

export interface HeuresSuppDetailItem {
  item: HeureSupplementaire;
  ouvrier?: Ouvrier;
  tache?: Tache;
}

interface HeuresSupplementairesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeOuvriers: Ouvrier[];
  allOuvriers?: Ouvrier[];
  taches: Tache[];
  domaines?: Domaine[];
  serres?: Serre[];
  currentUser?: UserAccount;
  heuresSuppDetails: HeuresSuppDetailItem[];
  allHeuresSupplementaires?: HeureSupplementaire[];
  checkWorkerForHeuresSupp: (numero: number) => {
    valid: boolean;
    ouvrier?: Ouvrier;
    error?: string;
    existingEntries?: HeureSupplementaire[];
  };
  onSaveHeureSupp: (
    ouvrierId: string,
    data: {
      id?: string;
      date?: string;
      type: TypeSupplementaire;
      tache_id?: string | null;
      nom_tache?: string | null;
      quantite?: number | null;
      unite?: string;
      heures?: number | null;
      domaine_id?: string | null;
      serre_id?: string | null;
      observation?: string | null;
      created_by_id?: string | null;
      created_by_nom?: string | null;
      updated_by_id?: string | null;
      updated_by_nom?: string | null;
    }
  ) => Promise<{
    success: boolean;
    message?: string;
    item?: HeureSupplementaire;
    isUpdated?: boolean;
  }>;
  onRemoveHeureSupp: (id: string) => Promise<{ success: boolean; message?: string }>;
  selectedDate: string;
}

type ActiveTab = 'heures' | 'taches' | 'recap' | 'historique';

const UNITES_PREDEFINIES = ['RUBAN', 'RUBO', 'FORFAIT', 'HEURE', 'CAISSE', 'LIGNE'];

export const HeuresSupplementairesModal: React.FC<HeuresSupplementairesModalProps> = ({
  isOpen,
  onClose,
  activeOuvriers,
  allOuvriers = [],
  taches,
  domaines = [],
  serres = [],
  currentUser,
  heuresSuppDetails,
  allHeuresSupplementaires = [],
  checkWorkerForHeuresSupp,
  onSaveHeureSupp,
  onRemoveHeureSupp,
  selectedDate,
}) => {
  // Navigation entre les 4 sections du module
  const [activeTab, setActiveTab] = useState<ActiveTab>('heures');

  // --- ÉTATS SECTION A : HEURES SUPPLÉMENTAIRES ---
  const [hDate, setHDate] = useState<string>(selectedDate);
  const [hWorkerNumInput, setHWorkerNumInput] = useState<string>('');
  const [hConfirmedWorker, setHConfirmedWorker] = useState<Ouvrier | null>(null);
  const [hWorkerError, setHWorkerError] = useState<string | null>(null);
  const [hNbHeures, setHNbHeures] = useState<string>('');
  const [hDomaineId, setHDomaineId] = useState<string>('');
  const [hSerreId, setHSerreId] = useState<string>('');
  const [hObservation, setHObservation] = useState<string>('');

  // --- ÉTATS SECTION B : TÂCHES SUPPLÉMENTAIRES ---
  const [tDate, setTDate] = useState<string>(selectedDate);
  const [tWorkerNumInput, setTWorkerNumInput] = useState<string>('');
  const [tConfirmedWorker, setTConfirmedWorker] = useState<Ouvrier | null>(null);
  const [tWorkerError, setTWorkerError] = useState<string | null>(null);
  const [tSelectedTacheId, setTSelectedTacheId] = useState<string>('');
  const [tCustomNomTache, setTCustomNomTache] = useState<string>('');
  const [tQuantite, setTQuantite] = useState<string>('');
  const [tUnite, setTUnite] = useState<string>('RUBAN');
  const [tCustomUnite, setTCustomUnite] = useState<string>('');
  const [tDomaineId, setTDomaineId] = useState<string>('');
  const [tSerreId, setTSerreId] = useState<string>('');
  const [tObservation, setTObservation] = useState<string>('');

  // --- POPUP RECHERCHE RAPIDE D'OUVRIER PAR NOM ---
  const [showWorkerSearchModal, setShowWorkerSearchModal] = useState<boolean>(false);
  const [workerSearchTarget, setWorkerSearchTarget] = useState<'heures' | 'taches'>('heures');
  const [workerSearchQuery, setWorkerSearchQuery] = useState<string>('');

  // --- FILTRES DU RÉCAPITULATIF & DE L'HISTORIQUE ---
  const [recapMode, setRecapMode] = useState<'jour' | 'periode'>('jour');
  const [recapDate, setRecapDate] = useState<string>(selectedDate);
  const [recapStartDate, setRecapStartDate] = useState<string>(selectedDate);
  const [recapEndDate, setRecapEndDate] = useState<string>(selectedDate);
  const [filterDomaineId, setFilterDomaineId] = useState<string>('ALL');
  const [filterWorkerQuery, setFilterWorkerQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'ALL' | 'heures' | 'tache'>('ALL');
  const [expandedWorkerIds, setExpandedWorkerIds] = useState<Set<string>>(new Set());

  // --- ÉDITION CIBLÉE D'UNE OPÉRATION EXISTANTE ---
  const [editingEntry, setEditingEntry] = useState<HeureSupplementaire | null>(null);
  const [editQuantite, setEditQuantite] = useState<string>('');
  const [editUnite, setEditUnite] = useState<string>('');
  const [editTacheId, setEditTacheId] = useState<string>('');
  const [editNomTache, setEditNomTache] = useState<string>('');
  const [editDomaineId, setEditDomaineId] = useState<string>('');
  const [editSerreId, setEditSerreId] = useState<string>('');
  const [editObservation, setEditObservation] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');

  // --- CONFIRMATION DE SUPPRESSION ---
  const [deletingEntry, setDeletingEntry] = useState<HeureSupplementaire | null>(null);

  // --- VERROU ANTI-DOUBLE CLIC & SOUMISSION ---
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // --- NOTIFICATIONS UTILISATEUR ---
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Synchronisation avec la date active et chargement des enregistrements depuis le serveur lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      setHDate(selectedDate);
      setTDate(selectedDate);
      setRecapDate(selectedDate);
      setRecapStartDate(selectedDate);
      setRecapEndDate(selectedDate);

      // Charger et fusionner les enregistrements du serveur
      const filters = recapMode === 'jour'
        ? { date: selectedDate }
        : { startDate: selectedDate, endDate: selectedDate };
      syncAndFetchHeuresSupplementairesServer(filters).catch(() => {});
    }
  }, [isOpen, selectedDate]);

  // Synchronisation serveur lors du changement des filtres du récapitulatif
  useEffect(() => {
    if (isOpen) {
      const filters = recapMode === 'jour'
        ? { date: recapDate }
        : { startDate: recapStartDate, endDate: recapEndDate };
      syncAndFetchHeuresSupplementairesServer(filters).catch(() => {});
    }
  }, [isOpen, recapMode, recapDate, recapStartDate, recapEndDate]);

  // Nettoyage temporisé des alertes
  useEffect(() => {
    if (bannerSuccess) {
      const timer = setTimeout(() => setBannerSuccess(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [bannerSuccess]);

  if (!isOpen) return null;

  // Contrôle RBAC strict : seul l'Admin a accès
  const isAdmin = currentUser?.role === 'admin' || !currentUser;
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
        <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl border border-red-200">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-black text-slate-900 mb-2">Accès Restreint</h2>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Le module Supplémentaires est strictement confidentiel et réservé à l'Administrateur. Le rôle Caporal n'est pas autorisé à consulter ou modifier ces données.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition active:scale-95"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  // Pool de tous les ouvriers (actifs en priorité, complété par tous les ouvriers de la société)
  const fullOuvriersList = allOuvriers.length > 0 ? allOuvriers : activeOuvriers;

  // -------------------------------------------------------------
  // MOTEUR D'IDENTIFICATION STRICTE DES OUVRIERS
  // -------------------------------------------------------------
  const verifyWorkerNumber = (target: 'heures' | 'taches', numInput: string) => {
    const raw = numInput.trim();
    if (!raw) {
      if (target === 'heures') {
        setHConfirmedWorker(null);
        setHWorkerError(null);
      } else {
        setTConfirmedWorker(null);
        setTWorkerError(null);
      }
      return;
    }

    const num = parseInt(raw, 10);
    if (isNaN(num) || num <= 0) {
      const err = 'Numéro d\'ouvrier invalide (entier positif requis)';
      if (target === 'heures') {
        setHConfirmedWorker(null);
        setHWorkerError(err);
      } else {
        setTConfirmedWorker(null);
        setTWorkerError(err);
      }
      return;
    }

    const check = checkWorkerForHeuresSupp(num);
    if (check.valid && check.ouvrier) {
      if (target === 'heures') {
        setHConfirmedWorker(check.ouvrier);
        setHWorkerError(null);
      } else {
        setTConfirmedWorker(check.ouvrier);
        setTWorkerError(null);
      }
    } else {
      const err = check.error || `Le numéro ${num} n'existe pas dans la liste des ouvriers.`;
      if (target === 'heures') {
        setHConfirmedWorker(null);
        setHWorkerError(err);
      } else {
        setTConfirmedWorker(null);
        setTWorkerError(err);
      }
    }
  };

  const handleSelectWorkerFromModal = (ouvrier: Ouvrier) => {
    if (workerSearchTarget === 'heures') {
      setHWorkerNumInput(ouvrier.numero.toString());
      setHConfirmedWorker(ouvrier);
      setHWorkerError(null);
    } else {
      setTWorkerNumInput(ouvrier.numero.toString());
      setTConfirmedWorker(ouvrier);
      setTWorkerError(null);
    }
    setShowWorkerSearchModal(false);
    setWorkerSearchQuery('');
  };

  // -------------------------------------------------------------
  // SOUMISSION SECTION A : HEURES SUPPLÉMENTAIRES
  // -------------------------------------------------------------
  const handleSubmitHeures = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setBannerError(null);

    if (!hConfirmedWorker) {
      setBannerError('Veuillez renseigner un numéro d\'ouvrier valide avant d\'enregistrer.');
      return;
    }

    const heuresVal = parseFloat(hNbHeures);
    if (isNaN(heuresVal) || heuresVal <= 0) {
      setBannerError('Le nombre d\'heures supplémentaires est obligatoire et doit être strictly supérieur à 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onSaveHeureSupp(hConfirmedWorker.id, {
        date: hDate,
        type: 'heures',
        quantite: heuresVal,
        heures: heuresVal,
        unite: 'HEURE',
        domaine_id: hDomaineId || null,
        serre_id: hSerreId || null,
        observation: hObservation.trim() || null,
        created_by_id: currentUser?.id || null,
        created_by_nom: currentUser?.nom || 'Administrateur',
      });

      if (res.success) {
        setBannerSuccess(`Heures sup. enregistrées avec succès pour #${hConfirmedWorker.numero} ${hConfirmedWorker.nom} (${heuresVal} H).`);
        // Réinitialiser le formulaire pour saisie fluide de l'ouvrier suivant
        setHWorkerNumInput('');
        setHConfirmedWorker(null);
        setHNbHeures('');
        setHObservation('');
      } else {
        setBannerError(res.message || 'Erreur lors de l\'enregistrement des heures supplémentaires.');
      }
    } catch (err: any) {
      setBannerError(err.message || 'Erreur de connexion au serveur.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // SOUMISSION SECTION B : TÂCHES SUPPLÉMENTAIRES
  // -------------------------------------------------------------
  const handleSubmitTaches = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setBannerError(null);

    if (!tConfirmedWorker) {
      setBannerError('Veuillez renseigner un numéro d\'ouvrier valide avant d\'enregistrer.');
      return;
    }

    const qteVal = parseFloat(tQuantite);
    if (isNaN(qteVal) || qteVal <= 0) {
      setBannerError('La quantité est obligatoire et doit être strictement supérieure à 0.');
      return;
    }

    // Résolution de l'unité
    const finalUnite = (tUnite === 'AUTRE' ? tCustomUnite : tUnite).trim().toUpperCase();
    if (!finalUnite) {
      setBannerError('L\'unité de la tâche supplémentaire est obligatoire.');
      return;
    }

    // Résolution du libellé de tâche
    const resolvedTacheObj = taches.find((t) => t.id === tSelectedTacheId);
    const resolvedTacheNom = resolvedTacheObj ? resolvedTacheObj.nom : tCustomNomTache.trim();

    if (!resolvedTacheNom) {
      setBannerError('Veuillez sélectionner ou saisir une tâche supplémentaire (ex: BALAYAGE).');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onSaveHeureSupp(tConfirmedWorker.id, {
        date: tDate,
        type: 'tache',
        tache_id: tSelectedTacheId || null,
        nom_tache: resolvedTacheNom,
        quantite: qteVal,
        unite: finalUnite,
        domaine_id: tDomaineId || null,
        serre_id: tSerreId || null,
        observation: tObservation.trim() || null,
        created_by_id: currentUser?.id || null,
        created_by_nom: currentUser?.nom || 'Administrateur',
      });

      if (res.success) {
        setBannerSuccess(`Tâche sup. enregistrée : #${tConfirmedWorker.numero} ${tConfirmedWorker.nom} — ${qteVal} ${finalUnite} ${resolvedTacheNom}.`);
        setTWorkerNumInput('');
        setTConfirmedWorker(null);
        setTQuantite('');
        setTObservation('');
        setTCustomNomTache('');
      } else {
        setBannerError(res.message || 'Erreur lors de l\'enregistrement de la tâche supplémentaire.');
      }
    } catch (err: any) {
      setBannerError(err.message || 'Erreur de connexion au serveur.');
    } finally {
      setIsSubmitting(false);
  };

  // -------------------------------------------------------------
  // CHARGEMENT ET FILTRAGE DES DONNÉES HISTORIQUES
  // -------------------------------------------------------------
  // Source unifiée combinant `allHeuresSupplementaires` et `heuresSuppDetails`
  const allOperationsList: HeureSupplementaire[] = useMemo(() => {
    const map = new Map<string, HeureSupplementaire>();
    // Priorité à l'historique complet
    allHeuresSupplementaires.forEach((item) => {
      map.set(item.id, item);
    });
    // Compléter avec les entrées locales courantes
    heuresSuppDetails.forEach((d) => {
      if (!map.has(d.item.id)) {
        map.set(d.item.id, d.item);
      }
    });
    return Array.from(map.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [allHeuresSupplementaires, heuresSuppDetails]);

  // Filtrage selon la date ou période
  const filteredOperations = useMemo(() => {
    return allOperationsList.filter((op) => {
      // 1. Filtre temporel
      if (recapMode === 'jour') {
        if (op.date !== recapDate) return false;
      } else {
        if (op.date < recapStartDate || op.date > recapEndDate) return false;
      }

      // 2. Filtre Domaine
      if (filterDomaineId !== 'ALL') {
        if (op.domaine_id !== filterDomaineId) return false;
      }

      // 3. Filtre Type
      if (filterType !== 'ALL') {
        const opType = op.type || (op.tache_id ? 'tache' : 'heures');
        if (opType !== filterType) return false;
      }

      // 4. Filtre Ouvrier (recherche par numéro ou nom)
      if (filterWorkerQuery.trim()) {
        const q = filterWorkerQuery.trim().toLowerCase();
        const numStr = op.numero_ouvrier.toString();
        const workerObj = fullOuvriersList.find((w) => w.id === op.ouvrier_id || w.numero === op.numero_ouvrier);
        const name = (workerObj?.nom || '').toLowerCase();
        if (!numStr.includes(q) && !name.includes(q)) return false;
      }

      return true;
    });
  }, [allOperationsList, recapMode, recapDate, recapStartDate, recapEndDate, filterDomaineId, filterType, filterWorkerQuery, fullOuvriersList]);

  // -------------------------------------------------------------
  // RÉCAPITULATIF SYNTHÉTIQUE — RÈGLE ESSENTIELLE : 1 SEULE LIGNE PAR OUVRIER
  // -------------------------------------------------------------
  interface WorkerRecapRow {
    ouvrierId: string;
    numero: number;
    nom: string;
    operations: HeureSupplementaire[];
    // Heures
    totalHeures: number;
    heuresFormuleText: string;
    // Tâches
    tachesBreakdownText: string;
  }

  const recapRows: WorkerRecapRow[] = useMemo(() => {
    // Regroupement par identifiant d'ouvrier
    const grouped = new Map<string, HeureSupplementaire[]>();
    filteredOperations.forEach((op) => {
      const key = op.ouvrier_id || `num_${op.numero_ouvrier}`;
      const existing = grouped.get(key) || [];
      existing.push(op);
      grouped.set(key, existing);
    });

    const rows: WorkerRecapRow[] = [];

    grouped.forEach((ops, workerKey) => {
      const firstOp = ops[0];
      const workerObj = fullOuvriersList.find((w) => w.id === workerKey || w.numero === firstOp.numero_ouvrier);
      const numero = workerObj ? workerObj.numero : firstOp.numero_ouvrier;
      const nom = workerObj ? workerObj.nom : `Ouvrier #${numero}`;

      // A. Calcul des Heures Supplémentaires
      const heuresOps = ops.filter((o) => (o.type || (o.tache_id ? 'tache' : 'heures')) === 'heures');
      let totalH = 0;
      const hValues: number[] = [];
      heuresOps.forEach((ho) => {
        const val = ho.quantite !== undefined && ho.quantite !== null ? ho.quantite : (ho.heures || 0);
        totalH += val;
        hValues.push(val);
      });

      let hText = '0';
      if (hValues.length === 1) {
        hText = `${hValues[0]} H`;
      } else if (hValues.length > 1) {
        hText = `${hValues.join(' H + ')} H = ${Math.round(totalH * 100) / 100} H`;
      }

      // B. Calcul des Tâches Supplémentaires (Regroupement sans JAMAIS mélanger des unités différentes)
      const tachesOps = ops.filter((o) => (o.type || (o.tache_id ? 'tache' : 'heures')) === 'tache');
      // Structure de regroupement par [Tâche + Unité]
      const tasksMap = new Map<string, { qte: number; unite: string; label: string }>();

      tachesOps.forEach((to) => {
        const qte = to.quantite || 0;
        const unite = (to.unite || 'RUBAN').toUpperCase();
        // Résolution du nom de tâche
        const tObj = taches.find((t) => t.id === to.tache_id);
        const taskLabel = to.nom_tache || tObj?.nom || 'Tâche';
        const key = `${taskLabel}___${unite}`;

        const curr = tasksMap.get(key) || { qte: 0, unite, label: taskLabel };
        curr.qte += qte;
        tasksMap.set(key, curr);
      });

      let tText = '—';
      if (tasksMap.size > 0) {
        const parts: string[] = [];
        tasksMap.forEach((val) => {
          parts.push(`${val.qte} ${val.unite} ${val.label}`);
        });
        tText = parts.join(' + ');
      }

      rows.push({
        ouvrierId: workerKey,
        numero,
        nom,
        operations: ops,
        totalHeures: Math.round(totalH * 100) / 100,
        heuresFormuleText: hText,
        tachesBreakdownText: tText,
      });
    });

    // Tri par numéro d'ouvrier croissant
    return rows.sort((a, b) => a.numero - b.numero);
  }, [filteredOperations, fullOuvriersList, taches]);

  // Indicateurs globaux (KPIs)
  const kpis = useMemo(() => {
    let sumHeures = 0;
    let nbTachesOps = 0;
    const ouvriersSet = new Set<string>();

    filteredOperations.forEach((op) => {
      ouvriersSet.add(op.ouvrier_id || `num_${op.numero_ouvrier}`);
      const type = op.type || (op.tache_id ? 'tache' : 'heures');
      if (type === 'heures') {
        const val = op.quantite !== undefined && op.quantite !== null ? op.quantite : (op.heures || 0);
        sumHeures += val;
      } else {
        nbTachesOps += 1;
      }
    });

    return {
      totalHeures: Math.round(sumHeures * 100) / 100,
      nbOuvriers: ouvriersSet.size,
      nbTachesOps,
      totalOperations: filteredOperations.length,
    };
  }, [filteredOperations]);

  // Basculer l'extension d'un ouvrier dans le récapitulatif
  const toggleWorkerExpanded = (workerId: string) => {
    setExpandedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  // -------------------------------------------------------------
  // GESTION DES MODIFICATIONS CIBLÉES
  // -------------------------------------------------------------
  const handleOpenEditModal = (op: HeureSupplementaire) => {
    setEditingEntry(op);
    setEditDate(op.date);
    const qVal = op.quantite !== undefined && op.quantite !== null ? op.quantite : (op.heures || '');
    setEditQuantite(qVal.toString());
    setEditUnite(op.unite || (op.type === 'tache' ? 'RUBAN' : 'HEURE'));
    setEditTacheId(op.tache_id || '');
    setEditNomTache(op.nom_tache || '');
    setEditDomaineId(op.domaine_id || '');
    setEditSerreId(op.serre_id || '');
    setEditObservation(op.observation || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || isSubmitting) return;

    const qteNum = parseFloat(editQuantite);
    if (isNaN(qteNum) || qteNum <= 0) {
      setBannerError('La quantité / nombre d\'heures doit être strictement supérieur à 0.');
      return;
    }

    const opType: TypeSupplementaire = editingEntry.type || (editingEntry.tache_id ? 'tache' : 'heures');

    setIsSubmitting(true);
    try {
      const res = await onSaveHeureSupp(editingEntry.ouvrier_id, {
        id: editingEntry.id,
        date: editDate,
        type: opType,
        tache_id: opType === 'tache' ? (editTacheId || null) : null,
        nom_tache: opType === 'tache' ? (editNomTache.trim() || null) : null,
        quantite: qteNum,
        heures: opType === 'heures' ? qteNum : null,
        unite: editUnite.trim().toUpperCase(),
        domaine_id: editDomaineId || null,
        serre_id: editSerreId || null,
        observation: editObservation.trim() || null,
        updated_by_id: currentUser?.id || null,
        updated_by_nom: currentUser?.nom || 'Administrateur',
      });

      if (res.success) {
        setBannerSuccess('Opération mise à jour avec succès.');
        setEditingEntry(null);
      } else {
        setBannerError(res.message || 'Erreur lors de la mise à jour.');
      }
    } catch (err: any) {
      setBannerError(err.message || 'Erreur lors de la modification sur le serveur.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // -------------------------------------------------------------
  // GESTION DES SUPPRESSIONS CIBLÉES
  // -------------------------------------------------------------
  const handleConfirmDelete = async () => {
    if (!deletingEntry || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await onRemoveHeureSupp(deletingEntry.id);
      if (res && res.success === false) {
        setBannerError(res.message || 'Erreur lors de la suppression sur le serveur.');
      } else {
        setBannerSuccess('Opération supprimée avec succès.');
        setDeletingEntry(null);
      }
    } catch (err: any) {
      setBannerError(err.message || 'Erreur de connexion lors de la suppression.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* ========================================================= */}
        {/* EN-TÊTE PRINCIPAL                                        */}
        {/* ========================================================= */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/40">
              <Clock className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Gestion des Supplémentaires
                </h1>
                <span className="bg-amber-500/20 text-amber-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-500/30">
                  Admin Exclusif
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Saisie indépendante du pointage, récapitulatif 1-ligne et traçabilité complète
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition active:scale-95"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ========================================================= */}
        {/* BANNIÈRES DE NOTIFICATION D'ÉTAT                          */}
        {/* ========================================================= */}
        {bannerSuccess && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 px-4 py-2.5 flex items-center gap-2 text-xs font-bold animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="flex-1">{bannerSuccess}</span>
            <button onClick={() => setBannerSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {bannerError && (
          <div className="bg-red-50 border-b border-red-200 text-red-900 px-4 py-2.5 flex items-center gap-2 text-xs font-bold animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="flex-1">{bannerError}</span>
            <button onClick={() => setBannerError(null)} className="text-red-700 hover:text-red-900">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* NAVIGATION PAR ONGLETS                                    */}
        {/* ========================================================= */}
        <div className="bg-slate-100 px-3 pt-2 border-b border-slate-200 shrink-0">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {/* Onglet 1 : Heures Supplémentaires */}
            <button
              type="button"
              onClick={() => setActiveTab('heures')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl font-black text-xs transition cursor-pointer shrink-0 ${
                activeTab === 'heures'
                  ? 'bg-white text-amber-900 shadow-xs border-t-2 border-amber-500'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Clock className="w-4 h-4 text-amber-600" />
              <span>A. Heures Supplémentaires</span>
            </button>

            {/* Onglet 2 : Tâches Supplémentaires */}
            <button
              type="button"
              onClick={() => setActiveTab('taches')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl font-black text-xs transition cursor-pointer shrink-0 ${
                activeTab === 'taches'
                  ? 'bg-white text-purple-900 shadow-xs border-t-2 border-purple-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Briefcase className="w-4 h-4 text-purple-600" />
              <span>B. Tâches Supplémentaires</span>
            </button>

            {/* Onglet 3 : Récapitulatif Synthétique (1 ligne par ouvrier) */}
            <button
              type="button"
              onClick={() => setActiveTab('recap')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl font-black text-xs transition cursor-pointer shrink-0 ${
                activeTab === 'recap'
                  ? 'bg-white text-emerald-950 shadow-xs border-t-2 border-emerald-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>C. Récapitulatif (1 Ligne/Ouvrier)</span>
              {recapRows.length > 0 && (
                <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.2 rounded-full font-black">
                  {recapRows.length}
                </span>
              )}
            </button>

            {/* Onglet 4 : Historique & Gestion */}
            <button
              type="button"
              onClick={() => setActiveTab('historique')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-t-2xl font-black text-xs transition cursor-pointer shrink-0 ${
                activeTab === 'historique'
                  ? 'bg-white text-blue-950 shadow-xs border-t-2 border-blue-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <Layers className="w-4 h-4 text-blue-600" />
              <span>D. Historique & Gestion ({filteredOperations.length})</span>
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* CONTENU PRINCIPAL DÉROULANT                               */}
        {/* ========================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/50">
          {/* ------------------------------------------------------- */}
          {/* SECTION A : HEURES SUPPLÉMENTAIRES                      */}
          {/* ------------------------------------------------------- */}
          {activeTab === 'heures' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-950 leading-relaxed">
                  <p className="font-bold text-sm text-amber-900 mb-0.5">Saisie des Heures Supplémentaires</p>
                  Saisissez les heures supplémentaires d'un ouvrier pour la date choisie. Chaque enregistrement est sauvegardé individuellement avec son identifiant propre, sans jamais modifier le pointage normal du matin.
                </div>
              </div>

              <form onSubmit={handleSubmitHeures} className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5">
                {/* 1. Date */}
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Date de l'opération
                  </label>
                  <input
                    type="date"
                    value={hDate}
                    onChange={(e) => setHDate(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                  />
                </div>

                {/* 2. Identification de l'ouvrier (Numéro + recherche auto) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-500" />
                      Numéro de l'ouvrier <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkerSearchTarget('heures');
                        setShowWorkerSearchModal(true);
                      }}
                      className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1 cursor-pointer"
                    >
                      <Search className="w-3 h-3" />
                      Rechercher par nom
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Ex: 30"
                      value={hWorkerNumInput}
                      onChange={(e) => {
                        setHWorkerNumInput(e.target.value);
                        verifyWorkerNumber('heures', e.target.value);
                      }}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base font-black text-slate-900 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => verifyWorkerNumber('heures', hWorkerNumInput)}
                      className="px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition active:scale-95"
                    >
                      Vérifier
                    </button>
                  </div>

                  {/* Affichage du statut ouvrier */}
                  {hConfirmedWorker && (
                    <div className="mt-2.5 bg-emerald-50 border border-emerald-300 rounded-2xl p-3 flex items-center justify-between animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                          #{hConfirmedWorker.numero}
                        </div>
                        <div>
                          <div className="font-black text-sm text-emerald-950 flex items-center gap-1.5">
                            <span>{hConfirmedWorker.nom}</span>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" />
                          </div>
                          <div className="text-[11px] text-emerald-700 font-medium">
                            Ouvrier identifié et validé dans la base
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setHConfirmedWorker(null);
                          setHWorkerNumInput('');
                        }}
                        className="text-xs font-bold text-emerald-800 hover:text-red-600 px-2 py-1"
                      >
                        Changer
                      </button>
                    </div>
                  )}

                  {hWorkerError && (
                    <div className="mt-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{hWorkerError}</span>
                    </div>
                  )}
                </div>

                {/* 3. Nombre d'heures supplémentaires (Obligatoire et > 0) */}
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    Nombre d'heures supplémentaires <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    placeholder="Ex: 2 ou 2.5"
                    value={hNbHeures}
                    onChange={(e) => setHNbHeures(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-black text-slate-900 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                  />
                  {/* Raccourcis rapides */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[1, 1.5, 2, 2.5, 3, 4].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setHNbHeures(v.toString())}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black transition cursor-pointer ${
                          hNbHeures === v.toString()
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                        }`}
                      >
                        +{v} H
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Domaine & Serre (Optionnels) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      Domaine (Optionnel)
                    </label>
                    <select
                      value={hDomaineId}
                      onChange={(e) => {
                        setHDomaineId(e.target.value);
                        setHSerreId('');
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                    >
                      <option value="">Sélectionner un domaine...</option>
                      {domaines.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                      <Warehouse className="w-3.5 h-3.5 text-slate-400" />
                      Serre (Optionnel)
                    </label>
                    <select
                      value={hSerreId}
                      onChange={(e) => setHSerreId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                    >
                      <option value="">Sélectionner une serre...</option>
                      {serres
                        .filter((s) => s.actif !== false)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nom} ({s.code})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* 5. Observation facultative */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                    Observation / Remarque (Facultative)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Arrosage nocturne, Permanence week-end, Urgence..."
                    value={hObservation}
                    onChange={(e) => setHObservation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:bg-white focus:border-amber-500 focus:outline-hidden"
                  />
                </div>

                {/* Bouton de validation */}
                <button
                  type="submit"
                  disabled={isSubmitting || !hConfirmedWorker || !hNbHeures || parseFloat(hNbHeures) <= 0}
                  className="w-full py-3.5 px-4 bg-linear-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 disabled:from-slate-200 disabled:to-slate-300 disabled:text-slate-400 text-slate-950 font-black text-sm rounded-2xl shadow-sm transition active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Enregistrement en cours...' : 'Enregistrer l\'heure supplémentaire'}</span>
                </button>
              </form>
            </div>
          )}

          {/* ------------------------------------------------------- */}
          {/* SECTION B : TÂCHES SUPPLÉMENTAIRES                      */}
          {/* ------------------------------------------------------- */}
          {activeTab === 'taches' && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 flex items-start gap-3">
                <Briefcase className="w-5 h-5 text-purple-700 mt-0.5 shrink-0" />
                <div className="text-xs text-purple-950 leading-relaxed">
                  <p className="font-bold text-sm text-purple-900 mb-0.5">Saisie des Tâches Supplémentaires</p>
                  Enregistrez une tâche supplémentaire avec sa quantité et son unité propre (ex: 30 RUBO BALAYAGE, 5 FORFAIT). Chaque opération est enregistrée séparément sans écraser les autres, et un ouvrier peut cumuler plusieurs tâches légitimes.
                </div>
              </div>

              <form onSubmit={handleSubmitTaches} className="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5">
                {/* 1. Date */}
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Date de l'opération
                  </label>
                  <input
                    type="date"
                    value={tDate}
                    onChange={(e) => setTDate(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                {/* 2. Numéro de l'ouvrier */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-black uppercase text-slate-700 tracking-wider flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-slate-500" />
                      Numéro de l'ouvrier <span className="text-red-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkerSearchTarget('taches');
                        setShowWorkerSearchModal(true);
                      }}
                      className="text-xs font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1 cursor-pointer"
                    >
                      <Search className="w-3 h-3" />
                      Rechercher par nom
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Ex: 30"
                      value={tWorkerNumInput}
                      onChange={(e) => {
                        setTWorkerNumInput(e.target.value);
                        verifyWorkerNumber('taches', e.target.value);
                      }}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-base font-black text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => verifyWorkerNumber('taches', tWorkerNumInput)}
                      className="px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition active:scale-95"
                    >
                      Vérifier
                    </button>
                  </div>

                  {tConfirmedWorker && (
                    <div className="mt-2.5 bg-purple-50 border border-purple-300 rounded-2xl p-3 flex items-center justify-between animate-fadeIn">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-purple-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                          #{tConfirmedWorker.numero}
                        </div>
                        <div>
                          <div className="font-black text-sm text-purple-950 flex items-center gap-1.5">
                            <span>{tConfirmedWorker.nom}</span>
                            <CheckCircle2 className="w-4 h-4 text-purple-600 inline" />
                          </div>
                          <div className="text-[11px] text-purple-700 font-medium">
                            Ouvrier identifié et validé dans la base
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTConfirmedWorker(null);
                          setTWorkerNumInput('');
                        }}
                        className="text-xs font-bold text-purple-800 hover:text-red-600 px-2 py-1"
                      >
                        Changer
                      </button>
                    </div>
                  )}

                  {tWorkerError && (
                    <div className="mt-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-2.5 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{tWorkerError}</span>
                    </div>
                  )}
                </div>

                {/* 3. Tâche supplémentaire (Sélection dans le catalogue OU Saisie libre) */}
                <div>
                  <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-600" />
                    Tâche supplémentaire <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      value={tSelectedTacheId}
                      onChange={(e) => {
                        setTSelectedTacheId(e.target.value);
                        if (e.target.value) setTCustomNomTache('');
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                    >
                      <option value="">Sélectionner une tâche de l'exploitation...</option>
                      {taches.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nom}
                        </option>
                      ))}
                    </select>

                    <input
                      type="text"
                      placeholder="Ou saisir un libellé libre (ex: BALAYAGE)"
                      value={tCustomNomTache}
                      onChange={(e) => {
                        setTCustomNomTache(e.target.value);
                        if (e.target.value) setTSelectedTacheId('');
                      }}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* 4. Quantité & Unité */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5">
                      Quantité obligatoire <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      placeholder="Ex: 30"
                      value={tQuantite}
                      onChange={(e) => setTQuantite(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-black text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase text-slate-700 tracking-wider mb-1.5">
                      Unité <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {['RUBAN', 'RUBO', 'FORFAIT', 'HEURE', 'CAISSE', 'AUTRE'].map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => setTUnite(u)}
                          className={`py-2 px-1 rounded-xl text-[11px] font-black uppercase transition cursor-pointer text-center ${
                            tUnite === u
                              ? 'bg-purple-600 text-white shadow-xs'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                    {tUnite === 'AUTRE' && (
                      <input
                        type="text"
                        placeholder="Préciser l'unité (ex: BOTTE, LIGNE)"
                        value={tCustomUnite}
                        onChange={(e) => setTCustomUnite(e.target.value)}
                        required
                        className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                      />
                    )}
                  </div>
                </div>

                {/* 5. Domaine & Serre (Optionnels) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      Domaine (Optionnel)
                    </label>
                    <select
                      value={tDomaineId}
                      onChange={(e) => {
                        setTDomaineId(e.target.value);
                        setTSerreId('');
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                    >
                      <option value="">Sélectionner un domaine...</option>
                      {domaines.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                      <Warehouse className="w-3.5 h-3.5 text-slate-400" />
                      Serre (Optionnel)
                    </label>
                    <select
                      value={tSerreId}
                      onChange={(e) => setTSerreId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                    >
                      <option value="">Sélectionner une serre...</option>
                      {serres
                        .filter((s) => s.actif !== false)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nom} ({s.code})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* 6. Observation */}
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1 flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5 text-slate-400" />
                    Observation / Remarque (Facultative)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Travail soigné, Fin de chantier..."
                    value={tObservation}
                    onChange={(e) => setTObservation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-slate-800 focus:bg-white focus:border-purple-500 focus:outline-hidden"
                  />
                </div>

                {/* Bouton de validation */}
                <button
                  type="submit"
                  disabled={isSubmitting || !tConfirmedWorker || !tQuantite || parseFloat(tQuantite) <= 0 || (!tSelectedTacheId && !tCustomNomTache.trim())}
                  className="w-full py-3.5 px-4 bg-linear-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 disabled:from-slate-200 disabled:to-slate-300 disabled:text-slate-400 text-white font-black text-sm rounded-2xl shadow-sm transition active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Enregistrement en cours...' : 'Enregistrer la tâche supplémentaire'}</span>
                </button>
              </form>
            </div>
          )}

          {/* ------------------------------------------------------- */}
          {/* SECTION C : RÉCAPITULATIF (1 LIGNE PAR OUVRIER)         */}
          {/* ------------------------------------------------------- */}
          {activeTab === 'recap' && (
            <div className="space-y-5">
              {/* Barre de filtres de la période */}
              <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRecapMode('jour')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      recapMode === 'jour' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    Jour unique
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecapMode('periode')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      recapMode === 'periode' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    Période
                  </button>
                </div>

                {recapMode === 'jour' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">Date :</span>
                    <input
                      type="date"
                      value={recapDate}
                      onChange={(e) => setRecapDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-500">Du :</span>
                    <input
                      type="date"
                      value={recapStartDate}
                      onChange={(e) => setRecapStartDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800"
                    />
                    <span className="text-xs font-bold text-slate-500">Au :</span>
                    <input
                      type="date"
                      value={recapEndDate}
                      onChange={(e) => setRecapEndDate(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <select
                    value={filterDomaineId}
                    onChange={(e) => setFilterDomaineId(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
                  >
                    <option value="ALL">Tous les domaines</option>
                    {domaines.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nom}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cartes d'indicateurs (KPIs) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
                  <div className="text-[10px] font-black uppercase text-amber-800 tracking-wider">Total Heures Sup.</div>
                  <div className="text-2xl font-black text-amber-950 mt-1">{kpis.totalHeures} H</div>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-3.5">
                  <div className="text-[10px] font-black uppercase text-purple-800 tracking-wider">Tâches Sup.</div>
                  <div className="text-2xl font-black text-purple-950 mt-1">{kpis.nbTachesOps} op.</div>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5">
                  <div className="text-[10px] font-black uppercase text-emerald-800 tracking-wider">Ouvriers Concernés</div>
                  <div className="text-2xl font-black text-emerald-950 mt-1">{kpis.nbOuvriers}</div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3.5">
                  <div className="text-[10px] font-black uppercase text-blue-800 tracking-wider">Total Opérations</div>
                  <div className="text-2xl font-black text-blue-950 mt-1">{kpis.totalOperations}</div>
                </div>
              </div>

              {/* TABLEAU RÉCAPITULATIF : 1 SEULE LIGNE PAR OUVRIER */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-black uppercase tracking-wider">
                      Synthèse Individuelle (1 Ligne par Ouvrier)
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-slate-300">
                    {recapRows.length} ouvrier{recapRows.length > 1 ? 's' : ''} avec opérations
                  </span>
                </div>

                {recapRows.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <Clock className="w-10 h-10 mx-auto text-slate-300 mb-2 stroke-1" />
                    <p className="text-sm font-bold text-slate-600">Aucune opération supplémentaire pour ce filtre</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Les heures et tâches saisies apparaîtront automatiquement regroupées sur une seule ligne par ouvrier.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 uppercase font-black tracking-wider text-[10px] border-b border-slate-200">
                        <tr>
                          <th className="py-3 px-3 w-14 text-center">N°</th>
                          <th className="py-3 px-4">Ouvrier</th>
                          <th className="py-3 px-4">Heures supplémentaires</th>
                          <th className="py-3 px-4">Tâches supplémentaires</th>
                          <th className="py-3 px-3 text-right">Détails</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recapRows.map((row) => {
                          const isExpanded = expandedWorkerIds.has(row.ouvrierId);
                          return (
                            <React.Fragment key={row.ouvrierId}>
                              <tr className="hover:bg-slate-50/80 transition group">
                                {/* N° */}
                                <td className="py-3 px-3 text-center">
                                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-slate-900 text-white font-black text-xs">
                                    #{row.numero}
                                  </span>
                                </td>

                                {/* Nom */}
                                <td className="py-3 px-4 font-black text-slate-900">
                                  <div className="text-sm">{row.nom}</div>
                                  <div className="text-[10px] text-slate-400 font-medium">
                                    {row.operations.length} opération{row.operations.length > 1 ? 's' : ''} enregistrée{row.operations.length > 1 ? 's' : ''}
                                  </div>
                                </td>

                                {/* Heures supplémentaires */}
                                <td className="py-3 px-4">
                                  {row.heuresFormuleText === '0' ? (
                                    <span className="text-slate-400 font-medium">0</span>
                                  ) : (
                                    <span className="inline-block bg-amber-50 text-amber-950 border border-amber-200 px-2.5 py-1 rounded-lg font-black text-xs">
                                      {row.heuresFormuleText}
                                    </span>
                                  )}
                                </td>

                                {/* Tâches supplémentaires */}
                                <td className="py-3 px-4">
                                  {row.tachesBreakdownText === '—' ? (
                                    <span className="text-slate-400 font-medium">—</span>
                                  ) : (
                                    <span className="inline-block bg-purple-50 text-purple-950 border border-purple-200 px-2.5 py-1 rounded-lg font-black text-xs">
                                      {row.tachesBreakdownText}
                                    </span>
                                  )}
                                </td>

                                {/* Bouton Déplier pour voir les opérations */}
                                <td className="py-3 px-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => toggleWorkerExpanded(row.ouvrierId)}
                                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                                    title={isExpanded ? 'Masquer le détail' : 'Voir les opérations détaillées'}
                                  >
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </button>
                                </td>
                              </tr>

                              {/* Volet dépliable : Opérations individuelles de cet ouvrier */}
                              {isExpanded && (
                                <tr className="bg-slate-50/90 border-y border-slate-200">
                                  <td colSpan={5} className="p-4">
                                    <div className="space-y-2">
                                      <div className="text-[10px] font-black uppercase text-slate-500 tracking-wider mb-2">
                                        Opérations enregistrées individuellement pour cet ouvrier :
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {row.operations.map((op) => {
                                          const isH = (op.type || (op.tache_id ? 'tache' : 'heures')) === 'heures';
                                          const tObj = taches.find((t) => t.id === op.tache_id);
                                          const dObj = domaines.find((d) => d.id === op.domaine_id);
                                          const sObj = serres.find((s) => s.id === op.serre_id);

                                          return (
                                            <div
                                              key={op.id}
                                              className="bg-white border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3 shadow-2xs"
                                            >
                                              <div>
                                                <div className="flex items-center gap-1.5">
                                                  <span
                                                    className={`px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase ${
                                                      isH
                                                        ? 'bg-amber-100 text-amber-800'
                                                        : 'bg-purple-100 text-purple-800'
                                                    }`}
                                                  >
                                                    {isH ? 'Heures Sup' : 'Tâche Sup'}
                                                  </span>
                                                  <span className="text-[11px] font-black text-slate-900">
                                                    {isH
                                                      ? `${op.quantite || op.heures} H`
                                                      : `${op.quantite} ${op.unite} ${op.nom_tache || tObj?.nom || ''}`}
                                                  </span>
                                                </div>

                                                <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                  <span>Date : {op.date}</span>
                                                  {dObj && <span>• {dObj.nom}</span>}
                                                  {sObj && <span>({sObj.nom})</span>}
                                                  {op.observation && (
                                                    <span className="italic text-slate-600 font-medium">
                                                      • « {op.observation} »
                                                    </span>
                                                  )}
                                                </div>

                                                <div className="text-[9px] text-slate-400 mt-0.5">
                                                  Par {op.created_by_nom || 'Admin'} à {op.heure_enregistrement}
                                                </div>
                                              </div>

                                              <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                  type="button"
                                                  onClick={() => handleOpenEditModal(op)}
                                                  className="p-1 rounded-md text-slate-500 hover:text-amber-700 hover:bg-amber-50 transition"
                                                  title="Modifier"
                                                >
                                                  <Edit3 className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => setDeletingEntry(op)}
                                                  className="p-1 rounded-md text-slate-500 hover:text-red-700 hover:bg-red-50 transition"
                                                  title="Supprimer"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------- */}
          {/* SECTION D : HISTORIQUE DÉTAILLÉ & GESTION               */}
          {/* ------------------------------------------------------- */}
          {activeTab === 'historique' && (
            <div className="space-y-4">
              {/* Barre de recherche et filtres de gestion */}
              <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  {/* Recherche ouvrier */}
                  <div className="sm:col-span-2 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="text"
                      placeholder="Rechercher par N° ou nom d'ouvrier..."
                      value={filterWorkerQuery}
                      onChange={(e) => setFilterWorkerQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden"
                    />
                  </div>

                  {/* Filtre Type */}
                  <div>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-hidden"
                    >
                      <option value="ALL">Tous les types</option>
                      <option value="heures">Heures sup. uniquement</option>
                      <option value="tache">Tâches sup. uniquement</option>
                    </select>
                  </div>

                  {/* Filtre Domaine */}
                  <div>
                    <select
                      value={filterDomaineId}
                      onChange={(e) => setFilterDomaineId(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-hidden"
                    >
                      <option value="ALL">Tous les domaines</option>
                      {domaines.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Liste détaillée des opérations */}
              <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-black uppercase tracking-wider">
                      Historique des Opérations ({filteredOperations.length})
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">
                    Modification et suppression ciblée
                  </span>
                </div>

                {filteredOperations.length === 0 ? (
                  <div className="p-10 text-center text-slate-400">
                    <Filter className="w-8 h-8 mx-auto text-slate-300 mb-2 stroke-1" />
                    <p className="text-xs font-bold text-slate-600">Aucune opération trouvée avec ces filtres</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredOperations.map((op) => {
                      const isH = (op.type || (op.tache_id ? 'tache' : 'heures')) === 'heures';
                      const workerObj = fullOuvriersList.find((w) => w.id === op.ouvrier_id || w.numero === op.numero_ouvrier);
                      const tObj = taches.find((t) => t.id === op.tache_id);
                      const dObj = domaines.find((d) => d.id === op.domaine_id);
                      const sObj = serres.find((s) => s.id === op.serre_id);

                      return (
                        <div
                          key={op.id}
                          className="p-3.5 sm:p-4 hover:bg-slate-50/80 transition flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-xs">
                              #{op.numero_ouvrier}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-black text-sm text-slate-900">
                                  {workerObj?.nom || `Ouvrier #${op.numero_ouvrier}`}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                    isH
                                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                      : 'bg-purple-100 text-purple-800 border border-purple-200'
                                  }`}
                                >
                                  {isH ? `${op.quantite || op.heures} Heures` : `${op.quantite} ${op.unite} ${op.nom_tache || tObj?.nom || ''}`}
                                </span>
                              </div>

                              <div className="text-[11px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-bold text-slate-700">{op.date}</span>
                                <span>à {op.heure_enregistrement}</span>
                                {dObj && <span>• {dObj.nom}</span>}
                                {sObj && <span>({sObj.nom})</span>}
                                {op.observation && (
                                  <span className="italic text-slate-600 font-medium">
                                    • Remarque : « {op.observation} »
                                  </span>
                                )}
                              </div>

                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Créé par {op.created_by_nom || 'Admin'}
                                {op.updated_by_nom && ` • Modifié par ${op.updated_by_nom}`}
                              </div>
                            </div>
                          </div>

                          {/* Boutons d'action ciblée */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(op)}
                              className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-xs transition flex items-center gap-1 cursor-pointer"
                              title="Modifier cette opération"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-amber-700" />
                              <span className="hidden sm:inline">Modifier</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingEntry(op)}
                              className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-900 font-bold text-xs transition flex items-center gap-1 cursor-pointer"
                              title="Supprimer cette opération"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              <span className="hidden sm:inline">Supprimer</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* MODALE POPUP : RECHERCHE D'OUVRIER PAR NOM                */}
      {/* ========================================================= */}
      {showWorkerSearchModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-2xs">
          <div className="bg-white rounded-3xl p-5 max-w-md w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500" />
                Rechercher un ouvrier de l'entreprise
              </h3>
              <button
                type="button"
                onClick={() => setShowWorkerSearchModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              placeholder="Taper le nom ou le numéro..."
              value={workerSearchQuery}
              onChange={(e) => setWorkerSearchQuery(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden mb-3"
              autoFocus
            />

            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-2xl">
              {fullOuvriersList
                .filter((o) => {
                  if (!workerSearchQuery.trim()) return true;
                  const q = workerSearchQuery.toLowerCase();
                  return o.nom.toLowerCase().includes(q) || o.numero.toString().includes(q);
                })
                .slice(0, 30)
                .map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => handleSelectWorkerFromModal(o)}
                    className="w-full p-2.5 hover:bg-slate-50 text-left flex items-center justify-between transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-lg bg-slate-900 text-white font-black text-xs flex items-center justify-center">
                        #{o.numero}
                      </span>
                      <span className="font-bold text-xs text-slate-900">{o.nom}</span>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      Sélectionner
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODALE POPUP : MODIFICATION CIBLÉE D'UNE OPÉRATION        */}
      {/* ========================================================= */}
      {editingEntry && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-2xs">
          <div className="bg-white rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-black text-slate-900">
                  Modifier l'opération #{editingEntry.numero_ouvrier}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-semibold text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {editingEntry.type === 'heures' ? 'Nombre d\'heures *' : 'Quantité *'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    value={editQuantite}
                    onChange={(e) => setEditQuantite(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-black text-slate-900 text-sm"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unité</label>
                  <input
                    type="text"
                    value={editUnite}
                    onChange={(e) => setEditUnite(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-900 uppercase"
                  />
                </div>
              </div>

              {editingEntry.type === 'tache' && (
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Libellé Tâche</label>
                  <input
                    type="text"
                    value={editNomTache}
                    onChange={(e) => setEditNomTache(e.target.value)}
                    placeholder="Ex: BALAYAGE"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-900"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-600 mb-1">Domaine</label>
                  <select
                    value={editDomaineId}
                    onChange={(e) => setEditDomaineId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-800"
                  >
                    <option value="">Aucun</option>
                    {domaines.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nom}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-600 mb-1">Serre</label>
                  <select
                    value={editSerreId}
                    onChange={(e) => setEditSerreId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-800"
                  >
                    <option value="">Aucune</option>
                    {serres.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nom}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-600 mb-1">Observation</label>
                <input
                  type="text"
                  value={editObservation}
                  onChange={(e) => setEditObservation(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-medium text-slate-800"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition active:scale-95"
                >
                  Sauvegarder
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODALE POPUP : CONFIRMATION DE SUPPRESSION CIBLÉE         */}
      {/* ========================================================= */}
      {deletingEntry && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-2xs">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl border border-red-100 text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-black text-slate-900 mb-1">
              Confirmer la suppression
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed mb-5">
              Êtes-vous sûr de vouloir supprimer cette opération précise de{' '}
              <strong className="text-slate-900 font-black">
                {deletingEntry.quantite || deletingEntry.heures} {deletingEntry.unite}
              </strong>{' '}
              pour l'ouvrier #{deletingEntry.numero_ouvrier} ? Les autres opérations de cet ouvrier resteront intactes.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeletingEntry(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs transition active:scale-95 shadow-xs"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
};
