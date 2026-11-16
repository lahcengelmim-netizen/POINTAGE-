/**
 * Vue POINTAGE & RÉCAPITULATIF JOURNALIER — GESTION DES CONTRACTUELLES
 * Application : LAHCEN POINTEUR
 *
 * Fonctionnalités complètes :
 * - Liste intégrale des ouvriers contractuels actifs (identité + domaine conservés)
 * - Pointage PRÉSENT / ABSENT (si ABSENT : 0 DH calculé, aucune tâche/serre)
 * - Sélection multiple des TÂCHES réelles de l'application
 * - Sélection multiple des SERRES réelles filtrées par domaine
 * - Saisie optionnelle des horaires (heure_debut / heure_fin) + calcul durée
 * - Tarif initial (catalogue, non modifiable ici) vs Montant proposé (modifiable avec alerte Admin)
 * - Workflow : BROUILLON -> SOUMIS PAR CAPORAL -> VALIDÉ / REFUSÉ (Admin uniquement)
 * - Historique & traçabilité complète par ouvrier
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Search,
  CheckCircle2,
  XCircle,
  Download,
  Copy,
  Check,
  Share2,
  Users,
  UserCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  Send,
  Clock,
  Layers,
  Building2,
  History,
  Save,
  ShieldCheck,
  Lock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ContractuelOuvrier,
  ContractuelPointage,
  UserAccount,
  Domaine,
  Serre,
  Tache,
  StatutValidationContractuel,
} from '../../types';
import {
  getContractuelOuvriers,
  getContractuelPointages,
  getContractuelTaches,
  saveContractuelPointage,
  saveContractuelOuvrier,
  validateContractuelPointage,
  exportContractuellesExcel,
  syncPendingContractuelPointages,
  getPendingContractuelPointagesCount,
} from '../../services/contractuelService';
import { subscribeContractuelsRealtime } from '../../services/supabaseSync';
import { getSerresForDomaine } from '../../services/storage';
import { formatTacheLabel } from '../../utils/tacheUtils';
import {
  computeWorkDurationHours,
  formatDurationLabel,
  getOfficialPointageMontant,
  getProposedPointageMontant,
  getStatutValidationLabel,
  isTarifModifie,
  normalizeStatutValidation,
  roundAmount,
} from '../../utils/contractuelWorkflow';

interface ContractuelCaporalViewProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  domaines?: Domaine[];
  serres?: Serre[];
  taches?: Tache[];
  currentUser: UserAccount;
  isAdmin?: boolean;
  isReadOnly?: boolean;
}

interface WorkerDraft {
  present: boolean | null;
  domaineId: string;
  tachesIds: string[];
  serresIds: string[];
  heureDebut: string;
  heureFin: string;
  montantPropose: string;
  motifModification: string;
}

function getValidationBadgeClasses(statut: StatutValidationContractuel): string {
  switch (statut) {
    case 'VALIDE':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'REFUSE':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'SOUMIS':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const ContractuelCaporalView: React.FC<ContractuelCaporalViewProps> = ({
  selectedDate,
  onSelectDate,
  domaines = [],
  serres = [],
  taches: propTaches = [],
  currentUser,
  isAdmin = false,
  isReadOnly = false,
}) => {
  const effectiveReadOnly = isReadOnly || currentUser.role === 'lecteur';
  const [ouvriers, setOuvriers] = useState<ContractuelOuvrier[]>([]);
  const [pointages, setPointages] = useState<ContractuelPointage[]>([]);
  const [apiTaches, setApiTaches] = useState<Tache[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() =>
    getPendingContractuelPointagesCount()
  );
  const [savingWorkerId, setSavingWorkerId] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState<boolean>(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    workerId: string;
    message: string;
    isError?: boolean;
  } | null>(null);

  // Recherche & filtres
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<
    'ALL' | 'PRESENTS' | 'ABSENTS' | 'NON_POINTES' | 'SOUMIS' | 'VALIDE' | 'REFUSE'
  >('ALL');

  // Brouillons d'édition par ouvrier
  const [drafts, setDrafts] = useState<Record<string, WorkerDraft>>({});

  // Accordéons ouverts (sélecteurs tâches/serres & historique)
  const [expandedEditorIds, setExpandedEditorIds] = useState<Record<string, boolean>>({});
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});
  const [taskSearchByWorker, setTaskSearchByWorker] = useState<Record<string, string>>({});

  // Notification copie WhatsApp
  const [copiedWhatsApp, setCopiedWhatsApp] = useState<boolean>(false);

  // Modale rapide d'ajout pour Admin
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newNom, setNewNom] = useState<string>('');
  const [newPrenom, setNewPrenom] = useState<string>('');
  const [newDomaineId, setNewDomaineId] = useState<string>('dom_d2');
  const [newMontant, setNewMontant] = useState<string>('100');
  const [addingWorker, setAddingWorker] = useState<boolean>(false);

  // Fusion des tâches réelles (props App.tsx + endpoint /api/contractuels/taches)
  const availableTaches = useMemo(() => {
    const map = new Map<string, Tache>();
    (propTaches || []).forEach((t) => {
      if (t && t.id && t.actif !== false) map.set(t.id, t);
    });
    (apiTaches || []).forEach((t) => {
      if (t && t.id && t.actif !== false && !map.has(t.id)) {
        map.set(t.id, t);
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      formatTacheLabel(a).localeCompare(formatTacheLabel(b))
    );
  }, [propTaches, apiTaches]);

  // Charger les données à chaque changement de date + auto-sync multi-appareils
  useEffect(() => {
    let mounted = true;
    const companyId = currentUser.company_id || 'cie_lahcen_pointeur';

    const syncAndReload = async (silent = false) => {
      if (!effectiveReadOnly && typeof navigator !== 'undefined' && navigator.onLine) {
        await syncPendingContractuelPointages().catch(() => {});
      }
      if (mounted) {
        await loadData({ silent });
      }
    };

    syncAndReload(false);

    const handleOnline = () => {
      syncAndReload(true);
    };
    const handleFocus = () => {
      syncAndReload(true);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncAndReload(true);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeRealtime = subscribeContractuelsRealtime(companyId, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mounted) loadData({ silent: true });
      }, 600);
    });

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncAndReload(true);
      }
    }, 20000);

    return () => {
      mounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeRealtime();
      clearInterval(intervalId);
    };
  }, [selectedDate, currentUser.company_id, effectiveReadOnly]);

  async function loadData(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    try {
      const companyId = currentUser.company_id || 'cie_lahcen_pointeur';
      const [ouvriersRes, pointagesRes, tachesRes] = await Promise.all([
        getContractuelOuvriers({ actif: true }),
        getContractuelPointages({ date: selectedDate }),
        getContractuelTaches(companyId),
      ]);

      if (ouvriersRes.success && Array.isArray(ouvriersRes.ouvriers)) {
        setOuvriers(ouvriersRes.ouvriers);
      }
      if (pointagesRes.success && Array.isArray(pointagesRes.pointages)) {
        setPointages(pointagesRes.pointages);
      }
      if (tachesRes.success && Array.isArray(tachesRes.taches)) {
        setApiTaches(tachesRes.taches);
      }
      setFromCache(Boolean(pointagesRes.fromCache || ouvriersRes.fromCache));
      setPendingSyncCount(getPendingContractuelPointagesCount());
      if (!opts?.silent) {
        setDrafts({});
      }
    } catch (err) {
      console.error('Erreur chargement données contractuelles:', err);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  // Map des pointages par ouvrier_id pour la date sélectionnée
  const pointagesByWorker = useMemo(() => {
    const map = new Map<string, ContractuelPointage>();
    pointages.forEach((p) => {
      map.set(p.ouvrier_id, p);
    });
    return map;
  }, [pointages]);

  // Résoudre le brouillon ou l'état sauvegardé d'un ouvrier
  const getWorkerDraft = (ouvrier: ContractuelOuvrier): WorkerDraft => {
    if (drafts[ouvrier.id]) {
      return drafts[ouvrier.id];
    }
    const ptg = pointagesByWorker.get(ouvrier.id);
    if (ptg) {
      const tIds =
        Array.isArray(ptg.taches_ids) && ptg.taches_ids.length > 0
          ? ptg.taches_ids
          : (ptg.activites || []).map((a) => a.tache_id).filter(Boolean);
      const sIds =
        Array.isArray(ptg.serres_ids) && ptg.serres_ids.length > 0
          ? ptg.serres_ids
          : ptg.serre_id
          ? [ptg.serre_id]
          : [];
      const montantProp = ptg.present
        ? getProposedPointageMontant(ptg, ouvrier.prix_convenu)
        : 0;

      return {
        present: Boolean(ptg.present),
        domaineId: ptg.domaine_id || ouvrier.domaine_id || 'dom_d2',
        tachesIds: tIds,
        serresIds: sIds,
        heureDebut: ptg.heure_debut || '',
        heureFin: ptg.heure_fin || '',
        montantPropose: String(montantProp),
        motifModification: ptg.motif_modification || '',
      };
    }

    return {
      present: null,
      domaineId: ouvrier.domaine_id || 'dom_d2',
      tachesIds: [],
      serresIds: ouvrier.serre_id ? [ouvrier.serre_id] : [],
      heureDebut: '',
      heureFin: '',
      montantPropose: String(Number(ouvrier.prix_convenu) || 0),
      motifModification: '',
    };
  };

  const updateDraft = (
    ouvrier: ContractuelOuvrier,
    patch: Partial<WorkerDraft>
  ) => {
    setDrafts((prev) => {
      const current = prev[ouvrier.id] || getWorkerDraft(ouvrier);
      return {
        ...prev,
        [ouvrier.id]: { ...current, ...patch },
      };
    });
  };

  const toggleExpandedEditor = (ouvrierId: string) => {
    setExpandedEditorIds((prev) => ({ ...prev, [ouvrierId]: !prev[ouvrierId] }));
  };

  const toggleExpandedHistory = (ouvrierId: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [ouvrierId]: !prev[ouvrierId] }));
  };

  const showWorkerToast = (workerId: string, message: string, isError = false) => {
    setSaveFeedback({ workerId, message, isError });
    setTimeout(() => {
      setSaveFeedback((curr) => (curr?.workerId === workerId ? null : curr));
    }, 3200);
  };

  // Enregistrement d'un pointage (BROUILLON ou SOUMIS)
  const handlePersistWorker = async (
    ouvrier: ContractuelOuvrier,
    targetStatut: StatutValidationContractuel,
    overrideDraft?: WorkerDraft
  ) => {
    if (effectiveReadOnly) return;
    const ptg = pointagesByWorker.get(ouvrier.id);
    const existingStatut = ptg ? normalizeStatutValidation(ptg.statut_validation) : null;
    if (existingStatut === 'VALIDE' && !isAdmin) {
      showWorkerToast(ouvrier.id, 'Déjà validé par Admin (verrouillé).', true);
      return;
    }

    const d = overrideDraft || getWorkerDraft(ouvrier);
    const isPresent = d.present === true;

    const tarifInitial = roundAmount(Number(ouvrier.prix_convenu) || 0);
    const parsedProp = parseFloat(d.montantPropose);
    if (isPresent && (isNaN(parsedProp) || parsedProp < 0)) {
      showWorkerToast(ouvrier.id, 'Montant proposé invalide.', true);
      return;
    }

    const montantPropose = isPresent ? roundAmount(parsedProp) : 0;

    // Vérification horaire si les deux sont saisis
    let dureeHeures: number | null = null;
    if (isPresent && d.heureDebut && d.heureFin) {
      dureeHeures = computeWorkDurationHours(d.heureDebut, d.heureFin);
      if (dureeHeures === null) {
        showWorkerToast(
          ouvrier.id,
          'Horaires invalides (fin doit être après début).',
          true
        );
        return;
      }
    }

    // Résoudre noms réels des tâches & serres sélectionnées
    const selectedTachesObjs = d.tachesIds.map((tId) => {
      const found = availableTaches.find((t) => t.id === tId);
      return {
        id: tId,
        label: found ? formatTacheLabel(found) : tId,
      };
    });
    const tachesIds = isPresent ? selectedTachesObjs.map((x) => x.id) : [];
    const tachesNoms = isPresent ? selectedTachesObjs.map((x) => x.label) : [];

    const domainSerres = getSerresForDomaine(serres, d.domaineId, domaines);
    const selectedSerresObjs = d.serresIds.map((sId) => {
      const found =
        domainSerres.find((s) => s.id === sId) ||
        serres.find((s) => s.id === sId);
      return {
        id: sId,
        nom: found ? `${found.nom} (${found.code})` : sId,
      };
    });
    const serresIds = isPresent ? selectedSerresObjs.map((s) => s.id) : [];
    const serresNoms = isPresent ? selectedSerresObjs.map((s) => s.nom) : [];

    setSavingWorkerId(ouvrier.id);
    try {
      const res = await saveContractuelPointage({
        ouvrier_id: ouvrier.id,
        matricule: ouvrier.matricule,
        nom_complet: ouvrier.nom_complet,
        date: selectedDate,
        present: isPresent,
        domaine_id: d.domaineId || ouvrier.domaine_id || 'dom_d2',
        tarif_initial: tarifInitial,
        montant_propose: montantPropose,
        motif_modification: isPresent ? d.motifModification.trim() || null : null,
        statut_validation: targetStatut,
        serre_id: serresIds[0] || null,
        serres_ids: serresIds,
        serres_noms: serresNoms,
        serres_texte: serresNoms.join(', ') || null,
        taches_ids: tachesIds,
        taches_noms: tachesNoms,
        taches_texte: tachesNoms.join(', ') || null,
        heure_debut: isPresent && d.heureDebut ? d.heureDebut : null,
        heure_fin: isPresent && d.heureFin ? d.heureFin : null,
        duree_heures: dureeHeures,
      });

      if (res.success && res.pointage) {
        setPointages((prev) => {
          const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
          return [...filtered, res.pointage!];
        });
        setDrafts((prev) => {
          const copy = { ...prev };
          delete copy[ouvrier.id];
          return copy;
        });
        setPendingSyncCount(getPendingContractuelPointagesCount());

        const statusLabel =
          targetStatut === 'SOUMIS'
            ? 'Soumis à Admin'
            : targetStatut === 'VALIDE'
            ? 'Validé'
            : 'Brouillon enregistré';
        showWorkerToast(
          ouvrier.id,
          isPresent
            ? `✓ Présent • ${statusLabel} (${montantPropose} DH)`
            : `✓ Absent • ${statusLabel} (0 DH)`
        );
      } else if (res.queuedOffline && res.pointage) {
        setPointages((prev) => {
          const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
          return [...filtered, res.pointage!];
        });
        setDrafts((prev) => {
          const copy = { ...prev };
          delete copy[ouvrier.id];
          return copy;
        });
        setPendingSyncCount(getPendingContractuelPointagesCount());
        setFromCache(true);
        showWorkerToast(
          ouvrier.id,
          '⏳ Hors ligne : enregistré en file locale en attente de synchro'
        );
      } else {
        showWorkerToast(ouvrier.id, res.error || 'Erreur enregistrement.', true);
      }
    } catch (err: any) {
      showWorkerToast(ouvrier.id, err.message || 'Erreur réseau.', true);
    } finally {
      setSavingWorkerId(null);
    }
  };

  // Clic rapide PRÉSENT
  const handleMarkPresent = async (ouvrier: ContractuelOuvrier) => {
    if (effectiveReadOnly) return;
    const ptg = pointagesByWorker.get(ouvrier.id);
    const existingStatut = ptg ? normalizeStatutValidation(ptg.statut_validation) : null;
    if (existingStatut === 'VALIDE' && !isAdmin) return;

    const current = getWorkerDraft(ouvrier);
    const nextAmount =
      current.present === false || Number(current.montantPropose) === 0
        ? String(Number(ouvrier.prix_convenu) || 0)
        : current.montantPropose;

    const nextDraft: WorkerDraft = {
      ...current,
      present: true,
      montantPropose: nextAmount,
    };
    updateDraft(ouvrier, { present: true, montantPropose: nextAmount });
    // Ouvrir automatiquement l'éditeur Tâches/Serres pour faciliter la saisie terrain
    setExpandedEditorIds((prev) => ({ ...prev, [ouvrier.id]: true }));
    await handlePersistWorker(ouvrier, 'BROUILLON', nextDraft);
  };

  // Clic rapide ABSENT (0 DH)
  const handleMarkAbsent = async (ouvrier: ContractuelOuvrier) => {
    if (effectiveReadOnly) return;
    const ptg = pointagesByWorker.get(ouvrier.id);
    const existingStatut = ptg ? normalizeStatutValidation(ptg.statut_validation) : null;
    if (existingStatut === 'VALIDE' && !isAdmin) return;

    const current = getWorkerDraft(ouvrier);
    const nextDraft: WorkerDraft = {
      ...current,
      present: false,
      tachesIds: [],
      serresIds: [],
      heureDebut: '',
      heureFin: '',
      montantPropose: '0',
      motifModification: '',
    };
    updateDraft(ouvrier, nextDraft);
    await handlePersistWorker(ouvrier, 'BROUILLON', nextDraft);
  };

  // Validation / Refus direct si Admin connecté sur cette vue
  const handleAdminValidateDirect = async (
    ouvrier: ContractuelOuvrier,
    decision: 'VALIDE' | 'REFUSE'
  ) => {
    if (!isAdmin || effectiveReadOnly) return;
    const ptg = pointagesByWorker.get(ouvrier.id);
    if (!ptg) {
      await handlePersistWorker(ouvrier, decision);
      return;
    }

    const d = getWorkerDraft(ouvrier);
    const parsedProp = parseFloat(d.montantPropose);
    setSavingWorkerId(ouvrier.id);
    try {
      const res = await validateContractuelPointage(ptg.id, {
        decision,
        montant_valide:
          decision === 'VALIDE'
            ? roundAmount(!isNaN(parsedProp) ? parsedProp : getProposedPointageMontant(ptg))
            : undefined,
        motif:
          decision === 'REFUSE'
            ? d.motifModification.trim() || 'Refusé par l\'administrateur'
            : d.motifModification.trim() || undefined,
      });

      if (res.success && res.pointage) {
        setPointages((prev) => {
          const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
          return [...filtered, res.pointage!];
        });
        showWorkerToast(
          ouvrier.id,
          decision === 'VALIDE'
            ? `✓ Validé Admin (${getOfficialPointageMontant(res.pointage)} DH)`
            : '✕ Refusé par Admin'
        );
      } else {
        showWorkerToast(ouvrier.id, res.error || 'Erreur validation.', true);
      }
    } finally {
      setSavingWorkerId(null);
    }
  };

  // Soumettre tous les pointages brouillons/refusés présents à l'administrateur
  const handleBulkSubmitToAdmin = async () => {
    if (effectiveReadOnly) return;
    const candidates = ouvriers.filter((o) => {
      const ptg = pointagesByWorker.get(o.id);
      const d = getWorkerDraft(o);
      if (d.present !== true) return false;
      const st = ptg ? normalizeStatutValidation(ptg.statut_validation) : 'BROUILLON';
      return st === 'BROUILLON' || st === 'REFUSE';
    });

    if (candidates.length === 0) return;

    setBulkSubmitting(true);
    try {
      for (const ouvrier of candidates) {
        await handlePersistWorker(ouvrier, 'SOUMIS');
      }
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Navigation de date rapide
  const handleChangeDateRelative = (offsetDays: number) => {
    try {
      const current = new Date(selectedDate);
      if (isNaN(current.getTime())) return;
      current.setDate(current.getDate() + offsetDays);
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, '0');
      const dd = String(current.getDate()).padStart(2, '0');
      onSelectDate(`${yyyy}-${mm}-${dd}`);
    } catch {
      // ignore
    }
  };

  const handleSetToday = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    onSelectDate(`${yyyy}-${mm}-${dd}`);
  };

  const formattedDateFr = useMemo(() => {
    try {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  // Statistiques journalières en temps réel (distinction stricte Proposé vs Validé Officiel)
  const stats = useMemo(() => {
    let totalPresents = 0;
    let totalAbsents = 0;
    let totalNonPointes = 0;
    let totalProposeDH = 0;
    let totalOfficielValideDH = 0;
    let totalSoumis = 0;
    let totalValides = 0;
    let totalRefuses = 0;
    let totalTarifsModifies = 0;

    ouvriers.forEach((ouvrier) => {
      const ptg = pointagesByWorker.get(ouvrier.id);
      if (!ptg) {
        totalNonPointes++;
      } else if (ptg.present) {
        totalPresents++;
        const st = normalizeStatutValidation(ptg.statut_validation);
        if (st === 'SOUMIS') totalSoumis++;
        if (st === 'VALIDE') totalValides++;
        if (st === 'REFUSE') totalRefuses++;
        if (ptg.tarif_modifie) totalTarifsModifies++;

        totalProposeDH += getProposedPointageMontant(ptg, ouvrier.prix_convenu);
        totalOfficielValideDH += getOfficialPointageMontant(ptg);
      } else {
        totalAbsents++;
      }
    });

    return {
      totalContractuels: ouvriers.length,
      totalPresents,
      totalAbsents,
      totalNonPointes,
      totalSoumis,
      totalValides,
      totalRefuses,
      totalTarifsModifies,
      totalProposeDH: roundAmount(totalProposeDH),
      totalOfficielValideDH: roundAmount(totalOfficielValideDH),
    };
  }, [ouvriers, pointagesByWorker]);

  // Liste filtrée selon recherche et statut (tous visibles par défaut)
  const filteredOuvriers = useMemo(() => {
    return ouvriers.filter((ouvrier) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nom = (ouvrier.nom || '').toLowerCase();
        const prenom = (ouvrier.prenom || '').toLowerCase();
        const complet = (ouvrier.nom_complet || '').toLowerCase();
        const mat = (ouvrier.matricule || '').toLowerCase();
        if (!nom.includes(q) && !prenom.includes(q) && !complet.includes(q) && !mat.includes(q)) {
          return false;
        }
      }

      const ptg = pointagesByWorker.get(ouvrier.id);
      if (filterStatus === 'PRESENTS') return ptg && ptg.present;
      if (filterStatus === 'ABSENTS') return ptg && !ptg.present;
      if (filterStatus === 'NON_POINTES') return !ptg;
      if (filterStatus === 'SOUMIS') {
        return ptg && normalizeStatutValidation(ptg.statut_validation) === 'SOUMIS';
      }
      if (filterStatus === 'VALIDE') {
        return ptg && normalizeStatutValidation(ptg.statut_validation) === 'VALIDE';
      }
      if (filterStatus === 'REFUSE') {
        return ptg && normalizeStatutValidation(ptg.statut_validation) === 'REFUSE';
      }

      return true;
    });
  }, [ouvriers, pointagesByWorker, searchQuery, filterStatus]);

  // Génération du texte récapitulatif pour WhatsApp
  const generateWhatsAppRecapText = (): string => {
    const dateParts = selectedDate.split('-');
    const dateFormatted =
      dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : selectedDate;

    const lines: string[] = [];
    lines.push(`📋 *POINTAGE CONTRACTUELS — ${dateFormatted}*`);
    lines.push('');
    lines.push(`👥 Total contractuels : ${stats.totalContractuels}`);
    lines.push(`✅ Présents : ${stats.totalPresents} (Validés Admin: ${stats.totalValides} | Attente: ${stats.totalSoumis})`);
    lines.push(`❌ Absents : ${stats.totalAbsents}`);
    lines.push('');
    lines.push('*DÉTAIL :*');

    ouvriers.forEach((o) => {
      const ptg = pointagesByWorker.get(o.id);
      if (!ptg) {
        lines.push(`- ${o.nom_complet} : Non pointé`);
      } else if (!ptg.present) {
        lines.push(`- ${o.nom_complet} : ABSENT (0 DH)`);
      } else {
        const stLabel = getStatutValidationLabel(ptg.statut_validation);
        const prop = getProposedPointageMontant(ptg, o.prix_convenu);
        const off = getOfficialPointageMontant(ptg);
        const tStr = ptg.taches_texte ? ` | Tâches: ${ptg.taches_texte}` : '';
        const sStr = ptg.serres_texte ? ` | Serres: ${ptg.serres_texte}` : '';
        lines.push(
          `- ${o.nom_complet} : PRÉSENT • Proposé ${prop} DH • Officiel ${off} DH [${stLabel}]${tStr}${sStr}`
        );
      }
    });

    lines.push('');
    lines.push(`📝 *Total Proposé Caporal : ${stats.totalProposeDH} DH*`);
    lines.push(`💰 *TOTAL OFFICIEL VALIDÉ ADMIN : ${stats.totalOfficielValideDH} DH*`);
    lines.push(`_Saisi par : ${currentUser.nom}_`);

    return lines.join('\n');
  };

  const handleCopyWhatsApp = async () => {
    const text = generateWhatsAppRecapText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      alert('Impossible de copier automatiquement.');
    }
  };

  const handleShareWhatsApp = () => {
    const text = generateWhatsAppRecapText();
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleExportExcel = () => {
    exportContractuellesExcel({
      pointages,
      allOuvriers: ouvriers,
      date: selectedDate,
      filterDesc: 'Pointage journalier complet',
    });
  };

  const handleCreateWorkerQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNom.trim()) {
      alert('Veuillez renseigner le nom.');
      return;
    }
    const prix = parseFloat(newMontant);
    if (isNaN(prix) || prix < 0) {
      alert('Montant invalide.');
      return;
    }

    setAddingWorker(true);
    try {
      const res = await saveContractuelOuvrier({
        nom: newNom.trim(),
        prenom: newPrenom.trim(),
        domaine_id: newDomaineId,
        prix_convenu: roundAmount(prix),
        actif: true,
      });

      if (res.success && res.ouvrier) {
        setOuvriers((prev) => [...prev, res.ouvrier!]);
        setShowAddModal(false);
        setNewNom('');
        setNewPrenom('');
        setNewMontant('100');
      } else {
        alert(res.error || 'Erreur lors de la création.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setAddingWorker(false);
    }
  };

  const getDomaineLabel = (domId?: string) => {
    if (!domId) return 'D2';
    const d = domaines.find((x) => x.id === domId);
    return d ? d.nom : domId.replace('dom_', '').toUpperCase();
  };

  return (
    <div className="space-y-3 pb-24">
      {/* 1. SÉLECTEUR DE DATE & ACTION DE SOUMISSION GLOBALE */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleChangeDateRelative(-1)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition active:scale-95 cursor-pointer"
              title="Jour précédent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleSetToday}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-100 hover:text-emerald-900 text-slate-700 text-xs font-black transition active:scale-95 cursor-pointer"
            >
              Aujourd'hui
            </button>
            <button
              type="button"
              onClick={() => handleChangeDateRelative(1)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition active:scale-95 cursor-pointer"
              title="Jour suivant"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              className="pl-3 pr-2 py-1.5 rounded-xl border border-slate-300 text-xs font-black text-slate-800 bg-slate-50 focus:bg-white focus:border-emerald-600 outline-none"
            />
            <button
              type="button"
              onClick={() => loadData()}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
              title="Actualiser les données"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <div className="text-xs font-bold text-slate-600 capitalize flex items-center gap-1.5 flex-wrap">
            <Calendar className="w-3.5 h-3.5 text-emerald-700" />
            <span>{formattedDateFr}</span>
            {fromCache && (
              <span className="text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full border border-amber-300 normal-case">
                Cache hors ligne
              </span>
            )}
            {pendingSyncCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  await syncPendingContractuelPointages();
                  await loadData({ silent: true });
                }}
                className="text-[10px] font-black bg-amber-500 text-white px-2 py-0.5 rounded-full cursor-pointer normal-case"
                title="Cliquer pour synchroniser les pointages en attente"
              >
                ⏳ {pendingSyncCount} en attente sync
              </button>
            )}
          </div>

          {!effectiveReadOnly && stats.totalPresents > 0 && (
            <button
              type="button"
              onClick={handleBulkSubmitToAdmin}
              disabled={bulkSubmitting}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black flex items-center gap-1.5 shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {bulkSubmitting
                  ? 'Soumission en cours...'
                  : 'Soumettre tous les brouillons à l’Admin'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 2. BANDEAU STATISTIQUES : PROPOSITION vs OFFICIEL VALIDÉ */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-bold">
            <Users className="w-3.5 h-3.5" />
            <span>Ouvriers</span>
          </div>
          <div className="text-xl font-black text-slate-900 mt-1">{stats.totalContractuels}</div>
          <div className="text-[10px] text-slate-400">catalogue complet actif</div>
        </div>

        <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-emerald-800 text-[11px] font-bold">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Présents</span>
          </div>
          <div className="text-xl font-black text-emerald-700 mt-1">{stats.totalPresents}</div>
          <div className="text-[10px] text-emerald-700 font-semibold">
            {stats.totalAbsents} absent(s) • {stats.totalNonPointes} à pointer
          </div>
        </div>

        <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-amber-900 text-[11px] font-bold">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Attente Admin</span>
          </div>
          <div className="text-xl font-black text-amber-800 mt-1">{stats.totalSoumis}</div>
          <div className="text-[10px] text-amber-700 font-semibold">
            {stats.totalTarifsModifies} tarif(s) modifié(s)
          </div>
        </div>

        <div className="bg-slate-800 text-white p-3 rounded-2xl border border-slate-700 shadow-xs">
          <div className="text-[10px] text-amber-300 font-black uppercase tracking-wider">
            Proposé Caporal
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-white mt-0.5">
            {stats.totalProposeDH.toLocaleString('fr-FR')}{' '}
            <span className="text-xs font-sans text-amber-300">DH</span>
          </div>
          <div className="text-[10px] text-slate-300">En attente ou soumis</div>
        </div>

        <div className="col-span-2 sm:col-span-1 bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-3 rounded-2xl shadow-md border border-emerald-700/60">
          <div className="text-[10px] text-emerald-300 font-black uppercase tracking-wider flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Validé Officiel
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-white mt-0.5">
            {stats.totalOfficielValideDH.toLocaleString('fr-FR')}{' '}
            <span className="text-xs font-sans text-emerald-300">DH</span>
          </div>
          <div className="text-[10px] text-emerald-200">
            {stats.totalValides} pointage(s) validé(s)
          </div>
        </div>
      </div>

      {/* 3. RECHERCHE & FILTRES */}
      <div className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom, prénom ou matricule..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {isAdmin && !effectiveReadOnly && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="h-9 px-3 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-2xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
          {(
            [
              { id: 'ALL', label: `Tous (${ouvriers.length})` },
              { id: 'PRESENTS', label: `Présents (${stats.totalPresents})` },
              { id: 'ABSENTS', label: `Absents (${stats.totalAbsents})` },
              { id: 'NON_POINTES', label: `À pointer (${stats.totalNonPointes})` },
              { id: 'SOUMIS', label: `Soumis (${stats.totalSoumis})` },
              { id: 'VALIDE', label: `Validés (${stats.totalValides})` },
              { id: 'REFUSE', label: `Refusés (${stats.totalRefuses})` },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterStatus(f.id)}
              className={`px-3 py-1 rounded-xl text-[11px] font-black transition cursor-pointer shrink-0 ${
                filterStatus === f.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. LISTE COMPLÈTE DES CONTRACTUELS */}
      {loading ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          <p className="text-xs font-bold text-slate-500">Chargement des contractuels...</p>
        </div>
      ) : filteredOuvriers.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <AlertCircle className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm font-black text-slate-800">
            {ouvriers.length === 0
              ? 'Catalogue des contractuels vide'
              : 'Aucun travailleur ne correspond à votre filtre'}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {ouvriers.length === 0
              ? isAdmin
                ? 'Importez vos ouvriers contractuels dans l’onglet « Travailleurs & Import Excel ».'
                : 'Aucun travailleur contractuel importé par l’administration.'
              : 'Ajustez votre recherche ou réinitialisez les filtres.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredOuvriers.map((ouvrier) => {
            const ptg = pointagesByWorker.get(ouvrier.id);
            const draft = getWorkerDraft(ouvrier);
            const statutWorkflow: StatutValidationContractuel = ptg
              ? normalizeStatutValidation(ptg.statut_validation)
              : 'BROUILLON';
            const isLockedForCaporal = effectiveReadOnly || (!isAdmin && statutWorkflow === 'VALIDE');
            const isSaving = savingWorkerId === ouvrier.id;
            const isEditorOpen = Boolean(expandedEditorIds[ouvrier.id]);
            const isHistoryOpen = Boolean(expandedHistoryIds[ouvrier.id]);

            const tarifInitial = roundAmount(Number(ouvrier.prix_convenu) || 0);
            const parsedPropose = parseFloat(draft.montantPropose);
            const montantProposeNum =
              draft.present === true && !isNaN(parsedPropose) ? roundAmount(parsedPropose) : 0;
            const tarifChanged =
              draft.present === true &&
              isTarifModifie(tarifInitial, montantProposeNum, true);
            const dureeCalculee =
              draft.present === true
                ? computeWorkDurationHours(draft.heureDebut, draft.heureFin)
                : null;

            const domainSerres = getSerresForDomaine(serres, draft.domaineId, domaines);
            const taskFilter = (taskSearchByWorker[ouvrier.id] || '').toLowerCase().trim();
            const filteredTaskChoices = availableTaches.filter((t) => {
              if (!taskFilter) return true;
              return formatTacheLabel(t).toLowerCase().includes(taskFilter);
            });

            const selectedTacheLabels = draft.tachesIds.map((id) => {
              const found = availableTaches.find((t) => t.id === id);
              return found ? formatTacheLabel(found) : id;
            });

            const selectedSerreLabels = draft.serresIds.map((id) => {
              const found =
                domainSerres.find((s) => s.id === id) || serres.find((s) => s.id === id);
              return found ? `${found.nom} (${found.code})` : id;
            });

            const historyList = Array.isArray(ptg?.historique_validations)
              ? ptg!.historique_validations!
              : [];

            return (
              <div
                key={ouvrier.id}
                className={`p-3.5 bg-white rounded-2xl border transition shadow-xs ${
                  statutWorkflow === 'VALIDE'
                    ? 'border-emerald-500 bg-emerald-50/15'
                    : statutWorkflow === 'REFUSE'
                    ? 'border-rose-400 bg-rose-50/20'
                    : draft.present === true
                    ? 'border-emerald-300 bg-emerald-50/10'
                    : draft.present === false
                    ? 'border-rose-300 bg-rose-50/15'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* EN-TÊTE CARTE OUVRIER */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-sm text-slate-900 tracking-tight">
                        {ouvrier.nom_complet || `${ouvrier.nom} ${ouvrier.prenom || ''}`}
                      </span>
                      {ouvrier.matricule && (
                        <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-md border border-slate-200">
                          {ouvrier.matricule}
                        </span>
                      )}
                      <span className="text-[10px] font-black bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-md border border-indigo-200">
                        Domaine {getDomaineLabel(ouvrier.domaine_id)}
                      </span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${getValidationBadgeClasses(
                          statutWorkflow
                        )}`}
                      >
                        {getStatutValidationLabel(statutWorkflow)}
                      </span>
                      {isLockedForCaporal && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                          <Lock className="w-3 h-3" /> Verrouillé
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                      <span>
                        Tarif initial catalogue :{' '}
                        <strong className="font-mono text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded-md">
                          {tarifInitial} DH
                        </strong>
                      </span>

                      {tarifChanged && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                          <AlertTriangle className="w-3 h-3" />
                          Tarif modifié ({tarifInitial} → {montantProposeNum} DH)
                        </span>
                      )}

                      {ptg && statutWorkflow === 'VALIDE' && (
                        <span className="text-[11px] font-black text-emerald-800">
                          • Officiel Admin : {getOfficialPointageMontant(ptg)} DH
                        </span>
                      )}

                      {saveFeedback && saveFeedback.workerId === ouvrier.id && (
                        <span
                          className={`text-[11px] font-black ${
                            saveFeedback.isError ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {saveFeedback.message}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* BOUTONS PRÉSENCE / ABSENCE + MONTANT PROPOSÉ */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleMarkPresent(ouvrier)}
                      disabled={isSaving || isLockedForCaporal}
                      className={`h-10 px-3 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                        draft.present === true
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400'
                          : 'bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-900 border border-slate-200'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>PRÉSENT</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMarkAbsent(ouvrier)}
                      disabled={isSaving || isLockedForCaporal}
                      className={`h-10 px-3 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50 ${
                        draft.present === false
                          ? 'bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-400'
                          : 'bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-900 border border-slate-200'
                      }`}
                    >
                      <XCircle className="w-4 h-4" />
                      <span>ABSENT</span>
                    </button>

                    {/* Montant proposé par le Caporal */}
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-xl px-2.5 h-10">
                      <span className="text-[10px] text-slate-500 font-black uppercase">
                        Proposé :
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={draft.present === false ? '0' : draft.montantPropose}
                        disabled={draft.present === false || isLockedForCaporal}
                        onChange={(e) =>
                          updateDraft(ouvrier, { montantPropose: e.target.value })
                        }
                        className={`w-16 font-mono font-black text-xs text-right bg-transparent outline-none ${
                          draft.present === false || isLockedForCaporal
                            ? 'text-slate-400 cursor-not-allowed'
                            : 'text-slate-900'
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-500">DH</span>
                    </div>

                    {draft.present === true && (
                      <button
                        type="button"
                        onClick={() => toggleExpandedEditor(ouvrier.id)}
                        className="h-10 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black flex items-center gap-1 cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Tâches & Serres</span>
                        {isEditorOpen ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* MOTIF DE REFUS ADMIN SI REFUSÉ */}
                {statutWorkflow === 'REFUSE' && ptg?.motif_refus && (
                  <div className="mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-black">Refusé par l’administrateur : </span>
                      <span>{ptg.motif_refus}</span>
                      <span className="block text-[11px] text-rose-700 mt-0.5">
                        Vous pouvez corriger les informations puis soumettre à nouveau.
                      </span>
                    </div>
                  </div>
                )}

                {/* RÉSUMÉ DES SÉLECTIONS ACTUELLES (TÂCHES, SERRES, HORAIRES) */}
                {draft.present === true && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2 text-[11px]">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-black text-slate-500">Tâches :</span>
                      {selectedTacheLabels.length > 0 ? (
                        selectedTacheLabels.map((lbl, idx) => (
                          <span
                            key={idx}
                            className="bg-indigo-100 text-indigo-900 font-bold px-2 py-0.5 rounded-md"
                          >
                            {lbl}
                          </span>
                        ))
                      ) : (
                        <span className="text-amber-700 italic font-semibold">
                          Aucune tâche sélectionnée
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-black text-slate-500">Serres :</span>
                      {selectedSerreLabels.length > 0 ? (
                        selectedSerreLabels.map((lbl, idx) => (
                          <span
                            key={idx}
                            className="bg-emerald-100 text-emerald-900 font-bold px-2 py-0.5 rounded-md"
                          >
                            {lbl}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 italic">Aucune serre</span>
                      )}
                    </div>

                    {draft.heureDebut && draft.heureFin && (
                      <span className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-md">
                        🕒 {draft.heureDebut}–{draft.heureFin} (
                        {formatDurationLabel(dureeCalculee)})
                      </span>
                    )}
                  </div>
                )}

                {/* ÉDITEUR DÉPLIABLE : SERRES MULTIPLES, TÂCHES MULTIPLES, HORAIRES & MOTIF */}
                {draft.present === true && isEditorOpen && (
                  <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    {/* Ligne 1 : Domaine + Horaires + Motif modification tarif */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Domaine de travail
                        </label>
                        <select
                          value={draft.domaineId}
                          disabled={isLockedForCaporal}
                          onChange={(e) => {
                            const nextDom = e.target.value;
                            const allowedIds = new Set(
                              getSerresForDomaine(serres, nextDom, domaines).map((s) => s.id)
                            );
                            updateDraft(ouvrier, {
                              domaineId: nextDom,
                              serresIds: draft.serresIds.filter((id) => allowedIds.has(id)),
                            });
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none"
                        >
                          {domaines.length > 0 ? (
                            domaines.map((dom) => (
                              <option key={dom.id} value={dom.id}>
                                Domaine {dom.nom}
                              </option>
                            ))
                          ) : (
                            <>
                              <option value="dom_d2">Domaine D2</option>
                              <option value="dom_d3">Domaine D3</option>
                              <option value="dom_d5">Domaine D5</option>
                            </>
                          )}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Heure début (optionnel)
                        </label>
                        <input
                          type="time"
                          value={draft.heureDebut}
                          disabled={isLockedForCaporal}
                          onChange={(e) =>
                            updateDraft(ouvrier, { heureDebut: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Heure fin (optionnel)
                        </label>
                        <input
                          type="time"
                          value={draft.heureFin}
                          disabled={isLockedForCaporal}
                          onChange={(e) =>
                            updateDraft(ouvrier, { heureFin: e.target.value })
                          }
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                          Durée calculée
                        </label>
                        <div className="h-[34px] px-2.5 bg-white border border-slate-200 rounded-xl flex items-center text-xs font-mono font-black text-slate-700">
                          {formatDurationLabel(dureeCalculee)}
                        </div>
                      </div>
                    </div>

                    {/* Justification obligatoire/recommandée si le tarif initial est modifié */}
                    {tarifChanged && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-black text-amber-900">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                          <span>
                            Modification du tarif initial détectée ({tarifInitial} DH →{' '}
                            {montantProposeNum} DH) — Signalée automatiquement à l’administrateur
                          </span>
                        </div>
                        <input
                          type="text"
                          value={draft.motifModification}
                          disabled={isLockedForCaporal}
                          onChange={(e) =>
                            updateDraft(ouvrier, { motifModification: e.target.value })
                          }
                          placeholder="Motif / justification de l'ajustement tarifaire (ex: heures supp, tâche complexe)..."
                          className="w-full px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-medium text-slate-800 outline-none"
                        />
                      </div>
                    )}

                    {/* Sélecteur MULTI-TÂCHES */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5 text-indigo-600" />
                          <span>
                            Tâches effectuées (sélection multiple — {draft.tachesIds.length}{' '}
                            sélectionnée(s))
                          </span>
                        </label>
                        <input
                          type="text"
                          value={taskSearchByWorker[ouvrier.id] || ''}
                          onChange={(e) =>
                            setTaskSearchByWorker((prev) => ({
                              ...prev,
                              [ouvrier.id]: e.target.value,
                            }))
                          }
                          placeholder="Filtrer les tâches..."
                          className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-[11px] font-medium text-slate-700 outline-none w-44"
                        />
                      </div>

                      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1 bg-white rounded-xl border border-slate-200">
                        {filteredTaskChoices.length === 0 ? (
                          <span className="text-[11px] text-slate-400 p-2">
                            Aucune tâche disponible.
                          </span>
                        ) : (
                          filteredTaskChoices.map((tache) => {
                            const selected = draft.tachesIds.includes(tache.id);
                            return (
                              <button
                                key={tache.id}
                                type="button"
                                disabled={isLockedForCaporal}
                                onClick={() => {
                                  const next = selected
                                    ? draft.tachesIds.filter((id) => id !== tache.id)
                                    : [...draft.tachesIds, tache.id];
                                  updateDraft(ouvrier, { tachesIds: next });
                                }}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer flex items-center gap-1.5 ${
                                  selected
                                    ? 'bg-indigo-700 text-white border-indigo-700 shadow-2xs'
                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-indigo-50'
                                }`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full shrink-0"
                                  style={{ backgroundColor: tache.couleur || '#4f46e5' }}
                                />
                                <span>{formatTacheLabel(tache)}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Sélecteur MULTI-SERRES (filtrées par domaine) */}
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          Serres du Domaine {getDomaineLabel(draft.domaineId)} (sélection multiple —{' '}
                          {draft.serresIds.length} sélectionnée(s))
                        </span>
                      </label>

                      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1.5 bg-white rounded-xl border border-slate-200">
                        {domainSerres.length === 0 ? (
                          <span className="text-[11px] text-slate-400 p-1">
                            Aucune serre configurée pour ce domaine.
                          </span>
                        ) : (
                          domainSerres.map((serre) => {
                            const selected = draft.serresIds.includes(serre.id);
                            return (
                              <button
                                key={serre.id}
                                type="button"
                                disabled={isLockedForCaporal}
                                onClick={() => {
                                  const next = selected
                                    ? draft.serresIds.filter((id) => id !== serre.id)
                                    : [...draft.serresIds, serre.id];
                                  updateDraft(ouvrier, { serresIds: next });
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                                  selected
                                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50'
                                }`}
                              >
                                {serre.nom} ({serre.code})
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* PIED DE CARTE : WORKFLOW ACTIONS + HISTORIQUE */}
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => toggleExpandedHistory(ouvrier.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                    >
                      <History className="w-3 h-3" />
                      <span>Historique ({historyList.length})</span>
                    </button>

                    {ptg?.submitted_by_nom && (
                      <span className="text-slate-500">
                        Soumis par <strong>{ptg.submitted_by_nom}</strong>
                      </span>
                    )}
                    {ptg?.validated_by_nom && (
                      <span className="text-emerald-700 font-bold">
                        • Traité par {ptg.validated_by_nom}
                      </span>
                    )}
                  </div>

                  {/* Boutons de workflow (Caporal : Brouillon / Soumettre Admin ; Admin : + Valider / Refuser) */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!isLockedForCaporal && draft.present !== null && (
                      <>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handlePersistWorker(ouvrier, 'BROUILLON')}
                          className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Save className="w-3 h-3" />
                          <span>Enregistrer brouillon</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handlePersistWorker(ouvrier, 'SOUMIS')}
                          className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          <span>Soumettre Admin</span>
                        </button>
                      </>
                    )}

                    {/* Boutons Valider / Refuser STRICTEMENT RÉSERVÉS À L'ADMIN (hors lecteur) */}
                    {isAdmin && !effectiveReadOnly && ptg && (
                      <>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleAdminValidateDirect(ouvrier, 'VALIDE')}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>Valider</span>
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleAdminValidateDirect(ouvrier, 'REFUSE')}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-black text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Refuser</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* TIROIR HISTORIQUE & TRAÇABILITÉ */}
                {isHistoryOpen && (
                  <div className="mt-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                    <div className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
                      <History className="w-3 h-3" />
                      <span>Traçabilité complète des modifications & validations</span>
                    </div>
                    {historyList.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">
                        Aucun événement enregistré pour cette date.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {historyList.map((h) => (
                          <div
                            key={h.id}
                            className="bg-white p-2 rounded-lg border border-slate-200 text-[11px] space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-black text-slate-800">
                                {h.action} ({h.statut_avant || '—'} → {h.statut_apres})
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {new Date(h.timestamp).toLocaleString('fr-FR')}
                              </span>
                            </div>
                            <div className="text-slate-600">
                              Par <strong>{h.auteur_nom}</strong> ({h.auteur_role}) •{' '}
                              {h.present ? 'Présent' : 'Absent'}
                              {h.montant_propose !== undefined &&
                                ` • Proposé : ${h.montant_propose} DH`}
                              {h.montant_valide !== null &&
                                h.montant_valide !== undefined &&
                                ` • Validé : ${h.montant_valide} DH`}
                            </div>
                            {h.taches_noms && h.taches_noms.length > 0 && (
                              <div className="text-[10px] text-indigo-800">
                                Tâches : {h.taches_noms.join(', ')}
                              </div>
                            )}
                            {h.serres_noms && h.serres_noms.length > 0 && (
                              <div className="text-[10px] text-emerald-800">
                                Serres : {h.serres_noms.join(', ')}
                              </div>
                            )}
                            {h.motif && (
                              <div className="text-[10px] text-amber-800 font-semibold">
                                Motif : {h.motif}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 5. TABLEAU RÉCAPITULATIF JOURNALIER & EXPORT */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">
              Récapitulatif Journalier des Contractuels
            </h3>
            <p className="text-[11px] text-slate-500">
              Seuls les montants VALIDÉS par l’administrateur entrent dans le Total Officiel
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs transition active:scale-95 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Exporter Excel</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="px-3 py-1.5 bg-[#075E54] hover:bg-[#064e46] text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs transition active:scale-95 cursor-pointer"
            >
              {copiedWhatsApp ? (
                <Check className="w-3.5 h-3.5 text-emerald-300" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedWhatsApp ? 'Copié !' : 'Copier WhatsApp'}</span>
            </button>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="px-2.5 py-1.5 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-xl text-xs font-black flex items-center gap-1 shadow-2xs transition active:scale-95 cursor-pointer"
              title="Ouvrir dans WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Travailleur</th>
                <th className="py-2.5 px-3">Domaine</th>
                <th className="py-2.5 px-3">Présence</th>
                <th className="py-2.5 px-3">Tâches & Serres</th>
                <th className="py-2.5 px-3">Statut Admin</th>
                <th className="py-2.5 px-3 text-right">Initial</th>
                <th className="py-2.5 px-3 text-right">Proposé</th>
                <th className="py-2.5 px-3 text-right">Officiel Validé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {ouvriers.map((o) => {
                const ptg = pointagesByWorker.get(o.id);
                const isPresent = ptg ? ptg.present : null;
                const st = ptg ? normalizeStatutValidation(ptg.statut_validation) : 'BROUILLON';
                const prop = ptg ? getProposedPointageMontant(ptg, o.prix_convenu) : 0;
                const officiel = ptg ? getOfficialPointageMontant(ptg) : 0;

                return (
                  <tr key={o.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {o.nom_complet || `${o.nom} ${o.prenom || ''}`}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 font-bold">
                      {getDomaineLabel(ptg?.domaine_id || o.domaine_id)}
                    </td>
                    <td className="py-2.5 px-3">
                      {isPresent === true ? (
                        <span className="inline-flex items-center text-[10px] font-black bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md">
                          PRÉSENT
                        </span>
                      ) : isPresent === false ? (
                        <span className="inline-flex items-center text-[10px] font-black bg-rose-100 text-rose-900 px-2 py-0.5 rounded-md">
                          ABSENT
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Non pointé</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-600 max-w-xs">
                      {isPresent ? (
                        <div>
                          <div className="font-bold text-slate-800 truncate">
                            {ptg?.taches_texte || '—'}
                          </div>
                          <div className="text-slate-500 truncate">
                            {ptg?.serres_texte || '—'}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {ptg ? (
                        <span
                          className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-md border ${getValidationBadgeClasses(
                            st
                          )}`}
                        >
                          {getStatutValidationLabel(st)}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {o.prix_convenu || 0} DH
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-800">
                      {prop} DH
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-800">
                      {officiel} DH
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-900 text-white font-black border-t-2 border-emerald-600">
              <tr>
                <td colSpan={6} className="py-3 px-3 uppercase text-xs tracking-wider text-emerald-400">
                  TOTAUX DU JOUR ({stats.totalPresents} présent(s))
                </td>
                <td className="py-3 px-3 text-right text-xs text-amber-300 font-mono">
                  {stats.totalProposeDH.toLocaleString('fr-FR')} DH
                </td>
                <td className="py-3 px-3 text-right text-base text-emerald-300 font-mono">
                  {stats.totalOfficielValideDH.toLocaleString('fr-FR')} DH
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* MODALE AJOUT RAPIDE TRAVAILLEUR (ADMIN) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-emerald-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
                <h3 className="font-black text-sm">Ajouter un Travailleur Contractuel</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-white/70 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWorkerQuick} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  NOM <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNom}
                  onChange={(e) => setNewNom(e.target.value)}
                  placeholder="Ex : EL AMRANI"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 uppercase focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">PRÉNOM</label>
                <input
                  type="text"
                  value={newPrenom}
                  onChange={(e) => setNewPrenom(e.target.value)}
                  placeholder="Ex : FATIMA"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">DOMAINE</label>
                <select
                  value={newDomaineId}
                  onChange={(e) => setNewDomaineId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 outline-none"
                >
                  {domaines.length > 0 ? (
                    domaines.map((d) => (
                      <option key={d.id} value={d.id}>
                        Domaine {d.nom}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="dom_d2">Domaine D2</option>
                      <option value="dom_d3">Domaine D3</option>
                      <option value="dom_d5">Domaine D5</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  TARIF INITIAL (DH) <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={newMontant}
                  onChange={(e) => setNewMontant(e.target.value)}
                  placeholder="Ex : 100"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={addingWorker}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition"
                >
                  {addingWorker ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
