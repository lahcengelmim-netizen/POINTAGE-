/**
 * MODULE SUPPLÉMENTAIRES (ADMIN ONLY) — RECONSTRUCTION COMPLÈTE
 * Application : LAHCEN POINTEUR
 * 
 * RÈGLES CRITIQUES APPLIQUÉES :
 * 1. ADMIN ONLY : Interdiction totale d'accès au Caporal (UI bloquée + routes API 403).
 * 2. RECHERCHE PAR NUMÉRO : L'administrateur saisit le numéro de l'ouvrier, le système recherche
 *    dans la liste officielle des ouvriers et affiche automatiquement son nom complet.
 *    Aucun ouvrier ne peut être créé automatiquement depuis ce module.
 * 3. HEURES SUPPLÉMENTAIRES : Validation stricte des heures > 0, date, domaine, serre, observation.
 * 4. TÂCHES SUPPLÉMENTAIRES : Validation stricte quantité > 0, unité physique (RUBO, CAISSE, KG, LIGNE...), tâche, date.
 * 5. RÉCAPITULATIF JOURNALIER — RÈGLE ESSENTIELLE : EXACTEMENT 1 SEULE LIGNE PAR OUVRIER.
 *    Exemple : 2 H + 30 RUBO BALAYAGE + 15 CAISSE TRI.
 *    Heures et tâches strictement séparées sans mélange d'unités incompatibles.
 * 6. MODIFICATION & SUPPRESSION CIBLÉE : Consultation du détail individuel par ouvrier avec modification/suppression et confirmation.
 * 7. EXPORT EXCEL (.xlsx) : Export complet du récapitulatif consolidé et du journal détaillé.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock,
  Briefcase,
  Calendar,
  Search,
  Plus,
  Trash2,
  Edit3,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Warehouse,
  User,
  Filter,
  Eye,
  X,
  Save,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Info,
  Users,
  CheckSquare,
  Square,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Ouvrier, Tache, Domaine, Serre, UserAccount } from '../../types';
import { supabase } from '../../services/supabaseClient';
import * as storage from '../../services/storage';

async function getAdminAuthHeaders(companyId?: string): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (companyId) {
    headers['x-company-id'] = companyId;
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Aucune session active : le serveur rejettera avec HTTP 401
  }
  return headers;
}

function cleanFloatPrecision(val: number): number {
  return Math.round(val * 1e8) / 1e8;
}

function parsePositiveDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseNonNegativeDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!normalized || !/^\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

interface OperationDetail {
  id: string;
  type: 'heures' | 'tache';
  type_label: string;
  date: string;
  quantite_ou_duree: number;
  valeur: number;
  unite: string;
  nom_tache: string;
  description?: string | null;
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
  mode_calcul?: 'heure' | 'quart_heure';
  tarif_unitaire?: number | null;
  nb_unites?: number | null;
  remuneration?: number | null;
  montant_total?: number | null;
  created_at: string;
  created_by_nom?: string | null;
}

interface WorkerRecapRow {
  ouvrier_id: string;
  numero_ouvrier: number;
  nom_ouvrier: string;
  total_heures: number;
  total_remuneration_heures: number;
  taches_groupes: { [key: string]: { nom_tache: string; unite: string; quantite: number } };
  texte_recapitulatif: string;
  nb_operations: number;
  operations: OperationDetail[];
}

interface SupplementairesAdminModuleProps {
  currentUser: UserAccount;
  allOuvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  initialTab?: 'heures' | 'taches' | 'recap';
}

const UNITES_STANDARDS = ['RUBO', 'CAISSE', 'KG', 'LIGNE', 'HEURE', 'FORFAIT', 'BOTTE', 'SAC'];

export const SupplementairesAdminModule: React.FC<SupplementairesAdminModuleProps> = ({
  currentUser,
  allOuvriers = [],
  taches = [],
  domaines = [],
  serres = [],
  selectedDate,
  onSelectDate,
  initialTab = 'recap',
}) => {
  // Navigation interne
  const [activeTab, setActiveTab] = useState<'saisie' | 'recap' | 'historique'>(
    initialTab === 'recap' ? 'recap' : 'saisie'
  );
  const [saisieType, setSaisieType] = useState<'heures' | 'taches'>(
    initialTab === 'taches' ? 'taches' : 'heures'
  );

  // État de chargement et feedback
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Données consolidées du récapitulatif
  const [recapData, setRecapData] = useState<WorkerRecapRow[]>([]);
  const [totaux, setTotaux] = useState<{
    total_ouvriers_concernes: number;
    grand_total_heures: number;
    grand_total_remuneration: number;
    grand_total_operations: number;
  }>({ total_ouvriers_concernes: 0, grand_total_heures: 0, grand_total_remuneration: 0, grand_total_operations: 0 });

  // Ouvrier sélectionné pour le détail / modal de gestion
  const [selectedWorkerForDetail, setSelectedWorkerForDetail] = useState<WorkerRecapRow | null>(null);

  // Opération en cours d'édition dans le modal
  const [editingOperation, setEditingOperation] = useState<OperationDetail | null>(null);
  const [editQuantite, setEditQuantite] = useState<string>('');
  const [editUnite, setEditUnite] = useState<string>('');
  const [editNomTache, setEditNomTache] = useState<string>('');
  const [editDescription, setEditDescription] = useState<string>('');
  const [editDomaineId, setEditDomaineId] = useState<string>('');
  const [editSerreId, setEditSerreId] = useState<string>('');
  const [editObservation, setEditObservation] = useState<string>('');
  const [editModeCalcul, setEditModeCalcul] = useState<'heure' | 'quart_heure'>('heure');
  const [editTarifUnitaire, setEditTarifUnitaire] = useState<string>('');
  const [editNbUnites, setEditNbUnites] = useState<string>('');

  // -------------------------------------------------------------------------
  // SOURCE UNIQUE DES OUVRIERS (IDENTIQUE À POINTAGE MATIN)
  // -------------------------------------------------------------------------
  const activeCompanyId = currentUser?.company_id || 'cie_lahcen_pointeur';
  const pointageWorkers = useMemo(() => {
    const rawSource =
      allOuvriers && allOuvriers.length > 0
        ? allOuvriers
        : storage.getOuvriers(activeCompanyId);
    return rawSource
      .filter(
        (w) =>
          w.actif !== false &&
          (!activeCompanyId || !w.company_id || w.company_id === activeCompanyId)
      )
      .sort((a, b) => a.numero - b.numero);
  }, [allOuvriers, activeCompanyId]);

  // -------------------------------------------------------------------------
  // FORMULAIRE DE SAISIE COMMUNE & SPÉCIFIQUE
  // -------------------------------------------------------------------------
  const [formDate, setFormDate] = useState<string>(selectedDate || new Date().toISOString().split('T')[0]);
  const [workerNumberInput, setWorkerNumberInput] = useState<string>('');
  const [selectedHeureWorkerId, setSelectedHeureWorkerId] = useState<string | null>(null);
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>(domaines[0]?.id || 'D1');
  const [serreInput, setSerreInput] = useState<string>('');
  const [observationInput, setObservationInput] = useState<string>('');

  // Champs spécifiques Heures Sup (avec mode de calcul et tarif)
  const [modeCalcul, setModeCalcul] = useState<'heure' | 'quart_heure'>('heure');
  const [tarifUnitaireInput, setTarifUnitaireInput] = useState<string>('');
  const [nbUnitesInput, setNbUnitesInput] = useState<string>('');
  const [heuresInput, setHeuresInput] = useState<string>('');
  const [heureDebut, setHeureDebut] = useState<string>('');
  const [heureFin, setHeureFin] = useState<string>('');

  // Champs spécifiques Tâches Sup (Multi-ouvriers + Description + Quantité commune ou individuelle)
  const [tacheWorkerSearch, setTacheWorkerSearch] = useState<string>('');
  const [selectedWorkerIdsForTache, setSelectedWorkerIdsForTache] = useState<string[]>([]);
  const [quantiteMode, setQuantiteMode] = useState<'commune' | 'individuelle'>('commune');
  const [customQuantitesByWorker, setCustomQuantitesByWorker] = useState<Record<string, string>>({});
  const [selectedTacheId, setSelectedTacheId] = useState<string>('');
  const [customTacheNom, setCustomTacheNom] = useState<string>('');
  const [descriptionInput, setDescriptionInput] = useState<string>('');
  const [quantiteInput, setQuantiteInput] = useState<string>('');
  const [uniteInput, setUniteInput] = useState<string>('RUBO');
  const [isSubmittingTache, setIsSubmittingTache] = useState<boolean>(false);

  // Filtres pour l'historique et le récapitulatif
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [filterOuvrierId, setFilterOuvrierId] = useState<string>('ALL');
  const [filterDomaine, setFilterDomaine] = useState<string>('ALL');
  const [filterSerre, setFilterSerre] = useState<string>('');
  const [filterTache, setFilterTache] = useState<string>('');
  const [filterType, setFilterType] = useState<'ALL' | 'heures' | 'taches'>('ALL');
  const [dateDebutFilter, setDateDebutFilter] = useState<string>(selectedDate);
  const [dateFinFilter, setDateFinFilter] = useState<string>(selectedDate);
  const [useDateRange, setUseDateRange] = useState<boolean>(false);

  // Synchronisation de formDate lorsque selectedDate change
  useEffect(() => {
    if (selectedDate) {
      setFormDate(selectedDate);
      if (!useDateRange) {
        setDateDebutFilter(selectedDate);
        setDateFinFilter(selectedDate);
      }
    }
  }, [selectedDate, useDateRange]);

  // -------------------------------------------------------------------------
  // RÈGLE : RECHERCHE PAR NUMÉRO OU NOM DANS LE RÉFÉRENTIEL POINTAGE MATIN
  // -------------------------------------------------------------------------
  const matchedWorker = useMemo(() => {
    if (selectedHeureWorkerId) {
      const byId = pointageWorkers.find((w) => w.id === selectedHeureWorkerId);
      if (byId) return byId;
    }
    const raw = workerNumberInput.trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) {
      const num = parseInt(raw, 10);
      if (num > 0) {
        return pointageWorkers.find((w) => w.numero === num) || null;
      }
    }
    const q = raw.toLowerCase();
    const nameMatches = pointageWorkers.filter(
      (w) => String(w.numero) === raw || w.nom.toLowerCase() === q
    );
    return nameMatches.length === 1 ? nameMatches[0] : null;
  }, [workerNumberInput, selectedHeureWorkerId, pointageWorkers]);

  const heureWorkerSuggestions = useMemo(() => {
    const raw = workerNumberInput.trim().toLowerCase();
    if (!raw) return [];
    return pointageWorkers
      .filter(
        (w) =>
          String(w.numero).includes(raw) ||
          `#${w.numero}`.includes(raw) ||
          w.nom.toLowerCase().includes(raw)
      )
      .slice(0, 8);
  }, [workerNumberInput, pointageWorkers]);

  // Filtrage des ouvriers pour la multi-sélection Tâches Supplémentaires
  const filteredWorkersForTache = useMemo(() => {
    const q = tacheWorkerSearch.trim().toLowerCase();
    if (!q) return pointageWorkers;
    return pointageWorkers.filter(
      (w) =>
        String(w.numero).includes(q) ||
        `#${w.numero}`.includes(q) ||
        w.nom.toLowerCase().includes(q)
    );
  }, [pointageWorkers, tacheWorkerSearch]);

  const selectedWorkersForTache = useMemo(() => {
    const idSet = new Set(selectedWorkerIdsForTache);
    return pointageWorkers.filter((w) => idSet.has(w.id));
  }, [pointageWorkers, selectedWorkerIdsForTache]);

  const toggleWorkerForTache = (workerId: string) => {
    setSelectedWorkerIdsForTache((prev) =>
      prev.includes(workerId)
        ? prev.filter((id) => id !== workerId)
        : [...prev, workerId]
    );
  };

  const handleSelectAllFilteredWorkers = () => {
    setSelectedWorkerIdsForTache((prev) => {
      const next = new Set(prev);
      filteredWorkersForTache.forEach((w) => next.add(w.id));
      return Array.from(next);
    });
  };

  const handleDeselectAllWorkers = () => {
    setSelectedWorkerIdsForTache([]);
    setCustomQuantitesByWorker({});
  };

  // Opérations déjà enregistrées aujourd'hui pour l'ouvrier (Heures Sup ou tâche unique)
  const existingOperationsForMatchedWorker = useMemo(() => {
    if (!matchedWorker) return [];
    const workerRow = recapData.find((r) => r.numero_ouvrier === matchedWorker.numero);
    return workerRow?.operations || [];
  }, [matchedWorker, recapData]);

  // Calcul automatique des heures ou quarts si début et fin sont renseignés
  useEffect(() => {
    if (heureDebut && heureFin && heureDebut.includes(':') && heureFin.includes(':')) {
      const [h1, m1] = heureDebut.split(':').map((v) => parseInt(v, 10));
      const [h2, m2] = heureFin.split(':').map((v) => parseInt(v, 10));
      if (!isNaN(h1) && !isNaN(m1) && !isNaN(h2) && !isNaN(m2)) {
        let diffMinutes = h2 * 60 + m2 - (h1 * 60 + m1);
        if (diffMinutes < 0) diffMinutes += 24 * 60;
        const durHours = cleanFloatPrecision(diffMinutes / 60);
        setHeuresInput(String(durHours));
        if (modeCalcul === 'quart_heure') {
          const quarts = cleanFloatPrecision(diffMinutes / 15);
          setNbUnitesInput(String(quarts));
        } else {
          setNbUnitesInput(String(durHours));
        }
      }
    }
  }, [heureDebut, heureFin, modeCalcul]);

  // Calcul en direct de la rémunération selon le mode sélectionné
  // Formule stricte : Rémunération = Prix unitaire × Nombre saisi
  // Exemples : Heure : 30 DH × 2 = 60 DH. Quart d'heure : 10 DH × 4 = 40 DH.
  const tarifParsed = parseNonNegativeDecimal(tarifUnitaireInput);
  const nbUnitsParsed = parsePositiveDecimal(nbUnitesInput || heuresInput);
  const hasTarif = tarifParsed !== null;
  const hasNbUnits = nbUnitsParsed !== null;
  const tarifNum = tarifParsed ?? NaN;
  const nbUnitsNum = nbUnitsParsed ?? NaN;
  const calculatedRemuneration =
    hasTarif && hasNbUnits
      ? cleanFloatPrecision(tarifParsed! * nbUnitsParsed!)
      : null;

  // -------------------------------------------------------------------------
  // CHARGEMENT DU RÉCAPITULATIF DEPUIS LE SERVEUR
  // -------------------------------------------------------------------------
  const fetchRecapData = useCallback(async () => {
    setLoading(true);
    try {
      const companyId = currentUser?.company_id || 'cie_lahcen_pointeur';
      const params = new URLSearchParams();

      if (useDateRange && dateDebutFilter && dateFinFilter) {
        params.append('startDate', dateDebutFilter);
        params.append('endDate', dateFinFilter);
      } else {
        params.append('date', formDate || selectedDate);
      }

      if (filterDomaine && filterDomaine !== 'ALL') {
        params.append('domaineId', filterDomaine);
      }
      if (filterOuvrierId && filterOuvrierId !== 'ALL') {
        params.append('ouvrierId', filterOuvrierId);
      }
      if (filterSerre.trim()) {
        params.append('serreId', filterSerre.trim());
      }
      if (filterTache.trim()) {
        params.append('tache', filterTache.trim());
      }

      const authHeaders = await getAdminAuthHeaders(companyId);
      const res = await fetch(`/api/supplementaires/recap?${params.toString()}`, {
        headers: authHeaders,
      });

      if (!res.ok) {
        let serverErrMsg = `Erreur serveur (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.error) serverErrMsg = errJson.error;
        } catch {
          // ignore
        }
        if (res.status === 401) {
          throw new Error('Session administrateur requise ou expirée. Veuillez vous connecter avec votre compte Admin.');
        }
        if (res.status === 403) {
          throw new Error('Accès interdit : ce module est réservé exclusivement à l\'administrateur.');
        }
        throw new Error(serverErrMsg);
      }

      const data = await res.json();
      if (data.success) {
        setRecapData(data.recap || []);
        setTotaux(
          data.totaux || {
            total_ouvriers_concernes: (data.recap || []).length,
            grand_total_heures: 0,
            grand_total_remuneration: 0,
            grand_total_operations: 0,
          }
        );
      } else {
        throw new Error(data.error || 'Erreur chargement récapitulatif');
      }
    } catch (err: any) {
      console.error('Erreur chargement récapitulatif:', err);
      setFeedback({ type: 'error', message: err.message || 'Impossible de charger les données.' });
    } finally {
      setLoading(false);
    }
  }, [
    currentUser?.company_id,
    formDate,
    selectedDate,
    useDateRange,
    dateDebutFilter,
    dateFinFilter,
    filterDomaine,
    filterOuvrierId,
    filterSerre,
    filterTache,
  ]);

  // Charger les données au montage et aux changements de date/filtre
  useEffect(() => {
    fetchRecapData();
  }, [fetchRecapData]);

  // -------------------------------------------------------------------------
  // SOUMISSION FORMULAIRE : HEURES SUPPLÉMENTAIRES
  // -------------------------------------------------------------------------
  const handleSubmitHeures = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!matchedWorker) {
      setFeedback({
        type: 'error',
        message: `Ouvrier introuvable. Aucun ouvrier existant ne correspond au numéro "${workerNumberInput}". Veuillez saisir un numéro valide.`,
      });
      return;
    }

    const nb = parsePositiveDecimal(nbUnitesInput || heuresInput);
    if (nb === null || nb <= 0) {
      setFeedback({
        type: 'error',
        message: modeCalcul === 'quart_heure'
          ? 'Le nombre de quarts d\'heure (15 min) doit être un nombre strictement supérieur à 0 (ex: 4, 2.5, 1,75).'
          : 'Le nombre d\'heures supplémentaires doit être un nombre strictement supérieur à 0 (ex: 1, 2, 2.5, 1,75, 3,125).',
      });
      return;
    }

    let validTarif: number | null = null;
    if (tarifUnitaireInput.trim() !== '') {
      const parsedTarif = parseNonNegativeDecimal(tarifUnitaireInput);
      if (parsedTarif === null) {
        setFeedback({
          type: 'error',
          message: 'Le prix unitaire doit être un nombre valide supérieur ou égal à 0 (ex: 30, 10, 12,5).',
        });
        return;
      }
      validTarif = parsedTarif;
    }

    // RÈGLE ESSENTIELLE : Rémunération = Prix unitaire × Nombre saisi
    // Aucune troncature ni arrondi sur la quantité saisie
    const remunCalculated = validTarif !== null ? cleanFloatPrecision(validTarif * nb) : null;
    const durInHours = modeCalcul === 'quart_heure' ? cleanFloatPrecision(nb / 4) : nb;

    try {
      setLoading(true);
      const authHeaders = await getAdminAuthHeaders(currentUser?.company_id || 'cie_lahcen_pointeur');
      const res = await fetch('/api/heures-supplementaires', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          ouvrier_id: matchedWorker.id,
          numero_ouvrier: matchedWorker.numero,
          date: formDate,
          mode_calcul: modeCalcul,
          tarif_unitaire: validTarif,
          nb_unites: nb,
          duree_heures: durInHours,
          heures: durInHours,
          remuneration: remunCalculated,
          montant_total: remunCalculated,
          heure_debut: heureDebut || null,
          heure_fin: heureFin || null,
          domaine_id: selectedDomaineId || null,
          serre_id: serreInput.trim() || null,
          observation: observationInput.trim() || null,
          nom_tache: 'HEURES SUPPLÉMENTAIRES',
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de l\'enregistrement.');
      }

      setFeedback({
        type: 'success',
        message: `✓ ${modeCalcul === 'quart_heure' ? `${nb} quart(s) (${durInHours} H)` : `${nb} H`} enregistré(es) pour #${matchedWorker.numero} (${matchedWorker.nom})${remunCalculated !== null ? ` — Rémunération : ${remunCalculated} DH (${validTarif} DH × ${nb})` : ''}.`,
      });

      // Réinitialiser les champs de saisie tout en gardant l'ouvrier pour une saisie suivante si besoin
      setHeuresInput('');
      setNbUnitesInput('');
      setHeureDebut('');
      setHeureFin('');
      setObservationInput('');

      // Rafraîchir les données immédiatement
      await fetchRecapData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erreur lors de l\'enregistrement.' });
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // SOUMISSION FORMULAIRE : TÂCHES SUPPLÉMENTAIRES (MULTI-OUVRIERS ATOMIQUE)
  // -------------------------------------------------------------------------
  const handleSubmitTaches = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingTache || loading) return;
    setFeedback(null);

    if (selectedWorkersForTache.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Veuillez sélectionner au moins un ouvrier existant dans la liste Pointage Matin.',
      });
      return;
    }

    // Nom de la tâche
    let taskName = customTacheNom.trim();
    if (!taskName && selectedTacheId) {
      const foundTask = taches.find((t) => t.id === selectedTacheId);
      if (foundTask) taskName = foundTask.nom;
    }

    if (!taskName) {
      setFeedback({
        type: 'error',
        message: 'Veuillez sélectionner ou saisir le nom de la tâche réalisée.',
      });
      return;
    }

    const unit = uniteInput.trim().toUpperCase();
    if (!unit) {
      setFeedback({
        type: 'error',
        message: 'L\'unité physique (RUBO, CAISSE, KG, LIGNE...) est obligatoire.',
      });
      return;
    }

    // Validation des quantités selon le mode (commune ou personnalisée par ouvrier)
    let commonQtyNum: number | null = null;
    if (quantiteMode === 'commune' || quantiteInput.trim() !== '') {
      commonQtyNum = parsePositiveDecimal(quantiteInput);
      if (quantiteMode === 'commune' && (commonQtyNum === null || commonQtyNum <= 0)) {
        setFeedback({
          type: 'error',
          message: 'La quantité réalisée doit être un nombre strictement supérieur à 0 (ex: 30, 12,5, 2.25).',
        });
        return;
      }
    }

    const ouvriersPayload: Array<{ id: string; numero: number; quantite?: number }> = [];
    for (const w of selectedWorkersForTache) {
      if (quantiteMode === 'individuelle') {
        const rawCustom = customQuantitesByWorker[w.id];
        const rawToUse = rawCustom !== undefined && rawCustom.trim() !== '' ? rawCustom : quantiteInput;
        const parsedWorkerQty = parsePositiveDecimal(rawToUse || '');
        if (parsedWorkerQty === null || parsedWorkerQty <= 0) {
          setFeedback({
            type: 'error',
            message: `Quantité invalide pour #${w.numero} (${w.nom}). Veuillez saisir un nombre strictement supérieur à 0.`,
          });
          return;
        }
        ouvriersPayload.push({ id: w.id, numero: w.numero, quantite: parsedWorkerQty });
      } else {
        ouvriersPayload.push({ id: w.id, numero: w.numero });
      }
    }

    const idempotencyKey = `tsup_req_${formDate}_${taskName}_${unit}_${ouvriersPayload.map((o) => `${o.numero}:${o.quantite ?? commonQtyNum}`).join(',')}_${Date.now()}`;

    try {
      setIsSubmittingTache(true);
      setLoading(true);
      const authHeaders = await getAdminAuthHeaders(currentUser?.company_id || 'cie_lahcen_pointeur');
      const res = await fetch('/api/taches-supplementaires', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          ouvriers: ouvriersPayload,
          date: formDate,
          tache_id: selectedTacheId || null,
          nom_tache: taskName,
          description: descriptionInput.trim() || null,
          quantite: commonQtyNum ?? undefined,
          unite: unit,
          domaine_id: selectedDomaineId || null,
          serre_id: serreInput.trim() || null,
          observation: observationInput.trim() || null,
          idempotencyKey,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de l\'enregistrement de la tâche.');
      }

      const createdCount = result.count || ouvriersPayload.length;
      setFeedback({
        type: 'success',
        message: `✓ ${createdCount} opération(s) créée(s) : tâche "${taskName}" enregistrée individuellement dans PostgreSQL pour ${createdCount} ouvrier(s).`,
      });

      // Réinitialiser la sélection et les champs de quantité/description pour éviter tout doublon accidentel
      setSelectedWorkerIdsForTache([]);
      setCustomQuantitesByWorker({});
      setQuantiteInput('');
      setDescriptionInput('');
      setObservationInput('');

      // Rafraîchir les données
      await fetchRecapData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erreur lors de l\'enregistrement.' });
    } finally {
      setIsSubmittingTache(false);
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // SUPPRESSION D'UNE OPÉRATION INDIVIDUELLE (AVEC CONFIRMATION)
  // -------------------------------------------------------------------------
  const handleDeleteOperation = async (op: OperationDetail) => {
    const confirmation = window.confirm(
      `Confirmez-vous la suppression de l'opération :\n"${op.nom_tache}" (${op.valeur} ${op.unite}) du ${op.date} ?\n\nCette action mettra immédiatement à jour le récapitulatif.`
    );
    if (!confirmation) return;

    try {
      setLoading(true);
      const endpoint =
        op.type === 'heures'
          ? `/api/heures-supplementaires/${op.id}`
          : `/api/taches-supplementaires/${op.id}`;

      const authHeaders = await getAdminAuthHeaders(currentUser?.company_id || 'cie_lahcen_pointeur');
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: authHeaders,
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de la suppression.');
      }

      // Mettre à jour la vue locale du travailleur dans le modal
      if (selectedWorkerForDetail) {
        const updatedOps = selectedWorkerForDetail.operations.filter((o) => o.id !== op.id);
        if (updatedOps.length === 0) {
          setSelectedWorkerForDetail(null);
        } else {
          setSelectedWorkerForDetail({
            ...selectedWorkerForDetail,
            operations: updatedOps,
            nb_operations: updatedOps.length,
          });
        }
      }

      setFeedback({ type: 'success', message: 'Opération supprimée avec succès.' });
      await fetchRecapData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erreur lors de la suppression.' });
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // MODIFICATION D'UNE OPÉRATION INDIVIDUELLE
  // -------------------------------------------------------------------------
  const handleOpenEditOperation = (op: OperationDetail) => {
    setEditingOperation(op);
    setEditQuantite(String(op.valeur));
    setEditUnite(op.unite);
    setEditNomTache(op.nom_tache);
    setEditDescription(op.description || '');
    setEditDomaineId(op.domaine_id || '');
    setEditSerreId(op.serre_id || '');
    setEditObservation(op.observation || '');
    setEditModeCalcul(op.mode_calcul || 'heure');
    setEditTarifUnitaire(op.tarif_unitaire !== undefined && op.tarif_unitaire !== null ? String(op.tarif_unitaire) : '');
    setEditNbUnites(op.nb_unites !== undefined && op.nb_unites !== null ? String(op.nb_unites) : String(op.valeur));
  };

  const handleSaveEditOperation = async () => {
    if (!editingOperation) return;

    try {
      setLoading(true);
      const isHeures = editingOperation.type === 'heures';
      const endpoint = isHeures
        ? `/api/heures-supplementaires/${editingOperation.id}`
        : `/api/taches-supplementaires/${editingOperation.id}`;

      const payload: any = {
        domaine_id: editDomaineId || null,
        serre_id: editSerreId.trim() || null,
        observation: editObservation.trim() || null,
      };

      let finalVal = 0;
      let finalRemun: number | null = null;
      let finalTarif: number | null = null;
      let finalNb: number | null = null;

      if (isHeures) {
        const parsedNb = parsePositiveDecimal(editNbUnites);
        if (parsedNb === null || parsedNb <= 0) {
          setFeedback({
            type: 'error',
            message: 'Le nombre d\'heures ou de quarts doit être un nombre strictement supérieur à 0.',
          });
          setLoading(false);
          return;
        }
        finalNb = parsedNb;
        if (editTarifUnitaire.trim() !== '') {
          const parsedTarif = parseNonNegativeDecimal(editTarifUnitaire);
          if (parsedTarif === null) {
            setFeedback({
              type: 'error',
              message: 'Le prix unitaire doit être un nombre valide supérieur ou égal à 0.',
            });
            setLoading(false);
            return;
          }
          finalTarif = parsedTarif;
        } else {
          finalTarif = null;
        }
        // RÈGLE FORMELLE : Rémunération = Prix unitaire × Nombre saisi
        finalRemun = finalTarif !== null ? cleanFloatPrecision(finalTarif * finalNb) : null;
        finalVal = editModeCalcul === 'quart_heure' ? cleanFloatPrecision(finalNb / 4) : finalNb;

        payload.mode_calcul = editModeCalcul;
        payload.tarif_unitaire = finalTarif;
        payload.nb_unites = finalNb;
        payload.duree_heures = finalVal;
        payload.heures = finalVal;
        payload.remuneration = finalRemun;
        payload.montant_total = finalRemun;
      } else {
        const parsedVal = parsePositiveDecimal(editQuantite);
        if (parsedVal === null || parsedVal <= 0) {
          setFeedback({
            type: 'error',
            message: 'La quantité doit être un nombre strictement supérieur à 0.',
          });
          setLoading(false);
          return;
        }
        finalVal = parsedVal;
        payload.quantite = finalVal;
        payload.unite = editUnite.trim().toUpperCase() || 'RUBO';
        payload.nom_tache = editNomTache.trim().toUpperCase() || 'TÂCHE';
        payload.description = editDescription.trim() || null;
      }

      const authHeaders = await getAdminAuthHeaders(currentUser?.company_id || 'cie_lahcen_pointeur');
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de la mise à jour.');
      }

      setEditingOperation(null);
      setFeedback({ type: 'success', message: 'Opération modifiée avec succès.' });
      await fetchRecapData();

      // Mettre à jour le travailleur ouvert dans le modal
      if (selectedWorkerForDetail) {
        setSelectedWorkerForDetail((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            operations: prev.operations.map((o) =>
              o.id === editingOperation.id
                ? {
                    ...o,
                    valeur: finalVal,
                    quantite_ou_duree: finalVal,
                    unite: isHeures ? 'H' : editUnite.trim().toUpperCase(),
                    mode_calcul: isHeures ? editModeCalcul : undefined,
                    tarif_unitaire: isHeures ? finalTarif : undefined,
                    nb_unites: isHeures ? finalNb : undefined,
                    remuneration: isHeures ? finalRemun : undefined,
                    montant_total: isHeures ? finalRemun : undefined,
                    nom_tache: isHeures ? o.nom_tache : editNomTache.trim().toUpperCase(),
                    description: isHeures ? null : (editDescription.trim() || null),
                    domaine_id: editDomaineId || null,
                    serre_id: editSerreId.trim() || null,
                    observation: editObservation.trim() || null,
                  }
                : o
            ),
          };
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erreur lors de la mise à jour.' });
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // EXPORT EXCEL PROFESSIONNEL (.XLSX VIA SHEETJS)
  // -------------------------------------------------------------------------
  const handleExportExcel = () => {
    if (recapData.length === 0) {
      setFeedback({ type: 'error', message: 'Aucune donnée à exporter pour la période sélectionnée.' });
      return;
    }

    try {
      // 1. Feuille 1 : Récapitulatif Consolidé (1 Seule Ligne par Ouvrier)
      const recapSheetData = recapData.map((row) => ({
        'N° Ouvrier': row.numero_ouvrier,
        'Nom Ouvrier': row.nom_ouvrier,
        'Synthèse Consolidée': row.texte_recapitulatif,
        'Total Heures Sup': row.total_heures > 0 ? `${row.total_heures} H` : '—',
        'Rémunération Heures (DH)': row.total_remuneration_heures > 0 ? `${row.total_remuneration_heures} DH` : '—',
        'Nb Opérations': row.nb_operations,
        Date: formDate,
      }));

      // 2. Feuille 2 : Détail exhaustif des opérations individuelles
      const detailSheetData: any[] = [];
      recapData.forEach((row) => {
        row.operations.forEach((op) => {
          detailSheetData.push({
            'N° Ouvrier': row.numero_ouvrier,
            'Nom Ouvrier': row.nom_ouvrier,
            Date: op.date,
            Type: op.type === 'heures' ? 'Heures Sup' : 'Tâche Sup',
            Désignation: op.nom_tache,
            Description: op.description || '',
            'Mode de Calcul': op.type === 'heures' ? (op.mode_calcul === 'quart_heure' ? 'Quart d\'heure (15 min)' : 'Heure') : '—',
            'Tarif Unitaire (DH)': op.tarif_unitaire !== undefined && op.tarif_unitaire !== null ? `${op.tarif_unitaire} DH` : '—',
            'Quantité Saisie': op.nb_unites !== undefined && op.nb_unites !== null ? op.nb_unites : op.valeur,
            'Durée / Quantité Réelle': `${op.valeur} ${op.unite}`,
            'Rémunération (DH)': op.remuneration !== undefined && op.remuneration !== null ? `${op.remuneration} DH` : '—',
            Domaine: op.domaine_id || '—',
            Serre: op.serre_id || '—',
            Observation: op.observation || '',
            'Enregistré par': op.created_by_nom || 'Admin',
            'Date Enregistrement': op.created_at,
          });
        });
      });

      const wb = XLSX.utils.book_new();
      const wsRecap = XLSX.utils.json_to_sheet(recapSheetData);
      const wsDetail = XLSX.utils.json_to_sheet(detailSheetData);

      XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif (1 Ligne)');
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Détail des Opérations');

      const fileName = `Supplementaires_Lahcen_${formDate.replace(/-/g, '')}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setFeedback({ type: 'success', message: `Export Excel téléchargé : ${fileName}` });
    } catch (err: any) {
      console.error('Erreur export Excel:', err);
      setFeedback({ type: 'error', message: 'Erreur lors de la génération du fichier Excel: ' + err.message });
    }
  };

  // Filtrage des lignes pour l'affichage consolidé (1 ligne / ouvrier)
  const filteredRecapRows = useMemo(() => {
    return recapData.filter((row) => {
      // Filtre texte numéro ou nom
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase().trim();
        const matchesNum = String(row.numero_ouvrier).includes(query);
        const matchesName = row.nom_ouvrier.toLowerCase().includes(query);
        const matchesRecap = row.texte_recapitulatif.toLowerCase().includes(query);
        if (!matchesNum && !matchesName && !matchesRecap) return false;
      }

      // Filtre par type
      if (filterType === 'heures' && row.total_heures <= 0) return false;
      if (filterType === 'taches' && Object.keys(row.taches_groupes).length === 0) return false;

      return true;
    });
  }, [recapData, searchFilter, filterType]);

  // Liste plate des opérations individuelles pour le journal détaillé de l'onglet Historique
  const detailedOperations = useMemo(() => {
    const list: Array<
      OperationDetail & {
        ouvrier_id: string;
        numero_ouvrier: number;
        nom_ouvrier: string;
        workerRow: WorkerRecapRow;
      }
    > = [];
    for (const row of filteredRecapRows) {
      for (const op of row.operations) {
        if (filterType === 'heures' && op.type !== 'heures') continue;
        if (filterType === 'taches' && op.type !== 'tache') continue;
        list.push({
          ...op,
          ouvrier_id: row.ouvrier_id,
          numero_ouvrier: row.numero_ouvrier,
          nom_ouvrier: row.nom_ouvrier,
          workerRow: row,
        });
      }
    }
    return list.sort((a, b) => {
      const dateCmp = (b.date || '').localeCompare(a.date || '');
      if (dateCmp !== 0) return dateCmp;
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }, [filteredRecapRows, filterType]);

  return (
    <div className="min-h-screen bg-slate-100 pb-28 pt-2">
      <div className="max-w-4xl mx-auto px-3 sm:px-4">
        {/* ================================================================= */}
        {/* EN-TÊTE PRINCIPAL : MODULE SUPPLÉMENTAIRES (ADMIN ONLY) */}
        {/* ================================================================= */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shrink-0">
                <Clock className="w-6 h-6 stroke-[2.5]" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-black text-slate-900 tracking-tight">
                    SUPPLÉMENTAIRES
                  </h1>
                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-800 border border-red-300 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3" />
                    Admin Only
                  </span>
                </div>
                <p className="text-xs text-slate-600 font-medium mt-0.5">
                  Pointage, suivi et récapitulatif consolidé des heures & tâches supplémentaires
                </p>
              </div>
            </div>

            {/* Sélecteur de date principal */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-1.5 self-start sm:self-auto">
              <Calendar className="w-4 h-4 text-slate-500 ml-1.5" />
              <input
                type="date"
                value={formDate}
                onChange={(e) => {
                  setFormDate(e.target.value);
                  onSelectDate(e.target.value);
                }}
                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
              />
              <button
                type="button"
                onClick={() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  setFormDate(todayStr);
                  onSelectDate(todayStr);
                }}
                className="text-[10px] font-black bg-slate-200 hover:bg-slate-300 text-slate-800 px-2 py-1 rounded-lg transition active:scale-95"
              >
                Aujourd'hui
              </button>
            </div>
          </div>

          {/* Onglets de navigation principale */}
          <div className="grid grid-cols-3 gap-1.5 mt-4 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('saisie')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-black transition ${
                activeTab === 'saisie'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Saisie & Pointage</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('recap')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-black transition ${
                activeTab === 'recap'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Récap Journalier (1 Ligne)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('historique')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-black transition ${
                activeTab === 'historique'
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Historique & Filtres</span>
            </button>
          </div>
        </div>

        {/* Message de feedback (succès ou erreur) */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl mb-4 flex items-start justify-between gap-3 shadow-xs border animate-fadeIn ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : 'bg-red-50 text-red-900 border-red-300'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              )}
              <span className="text-xs font-bold leading-relaxed">{feedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* VUE 1 : FORMULAIRE DE SAISIE & POINTAGE (HEURES OU TÂCHES) */}
        {/* ================================================================= */}
        {activeTab === 'saisie' && (
          <div className="space-y-4">
            {/* Bascule Heures Sup / Tâches Sup */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSaisieType('heures')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-black text-xs transition ${
                  saisieType === 'heures'
                    ? 'bg-amber-100 text-amber-950 border border-amber-300 shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-4 h-4 text-amber-700" />
                <span>Section 1 : Heures Supplémentaires</span>
              </button>

              <button
                type="button"
                onClick={() => setSaisieType('taches')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl font-black text-xs transition ${
                  saisieType === 'taches'
                    ? 'bg-blue-100 text-blue-950 border border-blue-300 shadow-xs'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Briefcase className="w-4 h-4 text-blue-700" />
                <span>Section 2 : Tâches Supplémentaires</span>
              </button>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* FORMULAIRE HEURES SUPPLÉMENTAIRES */}
            {/* ------------------------------------------------------------- */}
            {saisieType === 'heures' && (
              <form
                onSubmit={handleSubmitHeures}
                className="bg-white rounded-2xl shadow-sm border border-amber-200 p-4 sm:p-5"
              >
                <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      Saisie d'heures supplémentaires & Rémunération
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Choix libre du mode de calcul : Par Heure ou Par Quart d'heure (15 min)
                    </p>
                  </div>
                </div>

                {/* SÉLECTEUR DE MODE DE CALCUL */}
                <div className="mb-4 p-3 bg-amber-50/80 rounded-xl border border-amber-200">
                  <label className="block text-xs font-black text-amber-950 uppercase tracking-wider mb-2">
                    Mode de rémunération choisi <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setModeCalcul('heure')}
                      className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-black transition cursor-pointer ${
                        modeCalcul === 'heure'
                          ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-sm ring-2 ring-amber-300'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-100/50'
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                      <div className="text-left">
                        <span className="block font-black">1. Mode Heure (DH / h)</span>
                        <span className="block text-[10px] font-medium opacity-80">Prix d'une heure × Nombre d'heures</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setModeCalcul('quart_heure')}
                      className={`flex items-center justify-center gap-2 p-3 rounded-xl border text-xs font-black transition cursor-pointer ${
                        modeCalcul === 'quart_heure'
                          ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-sm ring-2 ring-amber-300'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-100/50'
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                      <div className="text-left">
                        <span className="block font-black">2. Mode Quart d'heure (15 min)</span>
                        <span className="block text-[10px] font-medium opacity-80">Prix d'un quart × Nombre de quarts</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Champ 1 : Recherche Ouvrier (Numéro OU Nom) depuis Pointage Matin */}
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        Ouvrier (recherche par N° ou Nom) <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[10px] font-bold text-slate-500">
                        Source Pointage Matin : {pointageWorkers.length} ouvrier(s)
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Saisir le N° (ex: 1, 4) ou le nom (ex: Hassan)..."
                        value={workerNumberInput}
                        onChange={(e) => {
                          setWorkerNumberInput(e.target.value);
                          setSelectedHeureWorkerId(null);
                        }}
                        className="w-full text-base font-black px-3.5 py-2.5 pr-16 rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-hidden"
                        required
                      />
                      {workerNumberInput ? (
                        <button
                          type="button"
                          onClick={() => {
                            setWorkerNumberInput('');
                            setSelectedHeureWorkerId(null);
                          }}
                          className="absolute right-9 top-3 text-slate-400 hover:text-slate-600"
                          title="Effacer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      ) : null}
                      <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    </div>

                    {/* Suggestions interactives quand on recherche par nom ou numéro partiel */}
                    {!matchedWorker && workerNumberInput.trim() !== '' && heureWorkerSuggestions.length > 0 && (
                      <div className="mt-2 border border-amber-200 bg-amber-50/40 rounded-xl divide-y divide-amber-100 overflow-hidden">
                        {heureWorkerSuggestions.map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() => {
                              setSelectedHeureWorkerId(w.id);
                              setWorkerNumberInput(String(w.numero));
                            }}
                            className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-amber-100/70 transition text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-md bg-amber-500 text-slate-950 font-black text-[11px] flex items-center justify-center">
                                #{w.numero}
                              </span>
                              <span className="font-bold text-slate-900">{w.nom}</span>
                            </div>
                            <span className="text-[10px] font-black text-amber-800 uppercase">Sélectionner</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Affichage automatique du nom complet de l'ouvrier trouvé */}
                    {matchedWorker ? (
                      <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">
                            #{matchedWorker.numero}
                          </span>
                          <div>
                            <span className="text-xs font-black text-emerald-950 block">
                              {matchedWorker.nom}
                            </span>
                            <span className="text-[10px] text-emerald-700 font-medium">
                              Ouvrier officiel Pointage Matin (ID : {matchedWorker.id})
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-black uppercase bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-md">
                          Trouvé
                        </span>
                      </div>
                    ) : workerNumberInput.trim() !== '' && heureWorkerSuggestions.length === 0 ? (
                      <div className="mt-2 p-2.5 bg-red-50 border border-red-300 rounded-xl flex items-center gap-2 text-red-800 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                        <span>
                          Aucun ouvrier existant ne correspond à « {workerNumberInput} ». La création
                          automatique d'ouvriers est strictement interdite.
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Champ 2 : Prix unitaire en DH selon le mode choisi */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {modeCalcul === 'heure' ? 'Prix d\'une heure (DH)' : 'Prix d\'un quart d\'heure (DH)'}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={modeCalcul === 'heure' ? 'Ex: 30 ou 12,5' : 'Ex: 10'}
                        value={tarifUnitaireInput}
                        onChange={(e) => setTarifUnitaireInput(e.target.value)}
                        className="w-full text-base font-black px-3.5 py-2.5 pr-36 rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-hidden"
                      />
                      <span className="absolute right-3.5 top-3 text-xs font-black text-amber-800 pointer-events-none">
                        {modeCalcul === 'heure' ? 'DH / HEURE' : 'DH / QUART (15 min)'}
                      </span>
                    </div>
                  </div>

                  {/* Champ 3 : Nombre saisi (heures ou quarts) — saisie libre entiers & décimaux */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {modeCalcul === 'heure' ? 'Nombre d\'heures' : 'Nombre de quarts (15 min)'}{' '}
                      <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={modeCalcul === 'heure' ? 'Ex: 2, 2,5, 1.75, 3,125...' : 'Ex: 4, 2,5...'}
                        value={nbUnitesInput || heuresInput}
                        onChange={(e) => {
                          setNbUnitesInput(e.target.value);
                          setHeuresInput(e.target.value);
                        }}
                        className="w-full text-base font-black px-3.5 py-2.5 pr-20 rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-hidden"
                        required
                      />
                      <span className="absolute right-3.5 top-3 text-xs font-black text-amber-800 pointer-events-none">
                        {modeCalcul === 'heure' ? 'HEURES' : 'QUARTS'}
                      </span>
                    </div>
                  </div>

                  {/* CARTE DYNAMIQUE DE CALCUL DE LA RÉMUNÉRATION */}
                  <div className="sm:col-span-2 p-3.5 bg-slate-900 text-white rounded-xl shadow-xs border border-slate-800">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500 text-slate-950">
                            {modeCalcul === 'heure' ? 'Mode Heure' : 'Mode Quart d\'heure (15 min)'}
                          </span>
                          <span className="text-xs font-bold text-slate-200">
                            Rémunération = Prix unitaire × Nombre saisi
                          </span>
                        </div>
                        <div className="text-xs font-medium text-slate-300 mt-1">
                          {hasTarif && hasNbUnits ? (
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-amber-300">{tarifNum} DH</span>
                              <span className="text-slate-400">×</span>
                              <span className="font-bold text-amber-300">
                                {nbUnitsNum} {modeCalcul === 'heure' ? 'heure(s)' : 'quart(s)'}
                              </span>
                              <span className="text-slate-400">=</span>
                              <span className="text-base font-black text-emerald-400">
                                {calculatedRemuneration} DH
                              </span>
                              {modeCalcul === 'quart_heure' && (
                                <span className="text-[11px] text-slate-400 ml-1">
                                  (Durée équivalente : {cleanFloatPrecision(nbUnitsNum / 4)} H)
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">
                              Exemples : Heure : 30 DH × 2 = 60 DH | Quart d'heure : 10 DH × 4 = 40 DH
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 border-t sm:border-t-0 sm:border-l border-slate-800 pt-2 sm:pt-0 sm:pl-4">
                        <span className="text-[10px] text-slate-400 uppercase font-black block tracking-wider">
                          Montant Rémunération
                        </span>
                        <span className="text-xl font-black text-amber-400">
                          {calculatedRemuneration !== null ? `${calculatedRemuneration} DH` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Calcul optionnel de durée (Heure début -> Heure fin) */}
                  <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        Heure début (facultatif)
                      </label>
                      <input
                        type="time"
                        value={heureDebut}
                        onChange={(e) => setHeureDebut(e.target.value)}
                        className="w-full text-xs font-semibold px-2.5 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        Heure fin (facultatif)
                      </label>
                      <input
                        type="time"
                        value={heureFin}
                        onChange={(e) => setHeureFin(e.target.value)}
                        className="w-full text-xs font-semibold px-2.5 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Champ 4 : Domaine */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Domaine</label>
                    <select
                      value={selectedDomaineId}
                      onChange={(e) => setSelectedDomaineId(e.target.value)}
                      className="w-full text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:border-amber-500 focus:outline-hidden"
                    >
                      {domaines.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Champ 5 : Serre */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Serre (facultatif)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: S1, Serre 4, P2..."
                      value={serreInput}
                      onChange={(e) => setSerreInput(e.target.value)}
                      className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-300 focus:border-amber-500 focus:outline-hidden"
                    />
                  </div>

                  {/* Champ 6 : Observation */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Observation (facultatif)
                    </label>
                    <input
                      type="text"
                      placeholder="Motif, détails du travail effectué..."
                      value={observationInput}
                      onChange={(e) => setObservationInput(e.target.value)}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-300 focus:border-amber-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={loading || !matchedWorker || !(nbUnitesInput || heuresInput)}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black px-6 py-3 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Enregistrer Heures Supplémentaires</span>
                  </button>
                </div>
              </form>
            )}

            {/* ------------------------------------------------------------- */}
            {/* FORMULAIRE TÂCHES SUPPLÉMENTAIRES (MULTI-OUVRIERS ATOMIQUE) */}
            {/* ------------------------------------------------------------- */}
            {saisieType === 'taches' && (
              <form
                onSubmit={handleSubmitTaches}
                className="bg-white rounded-2xl shadow-sm border border-blue-200 p-4 sm:p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
                      <Briefcase className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-black text-slate-900">
                        Saisie de tâches supplémentaires (Multi-Ouvriers)
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Sélectionnez un ou plusieurs ouvriers de Pointage Matin — 1 opération distincte créée par ouvrier
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-black bg-blue-50 text-blue-900 border border-blue-200 px-2.5 py-1 rounded-lg self-start">
                    <Users className="w-3.5 h-3.5 text-blue-700" />
                    <span>{selectedWorkersForTache.length} / {pointageWorkers.length} sélectionné(s)</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* BLOC 1 : MULTI-SÉLECTION DES OUVRIERS (SOURCE POINTAGE MATIN) */}
                  <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <label className="block text-xs font-black text-slate-800">
                          Ouvriers concernés (Pointage Matin) <span className="text-red-500">*</span>
                        </label>
                        <span className="text-[10px] text-slate-500 font-medium">
                          Cochez un ou plusieurs ouvriers existants (aucun ouvrier créé automatiquement)
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={handleSelectAllFilteredWorkers}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-black transition cursor-pointer"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>Tout sélectionner</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleDeselectAllWorkers}
                          disabled={selectedWorkersForTache.length === 0}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-700 border border-slate-300 text-[11px] font-black transition cursor-pointer"
                        >
                          <Square className="w-3.5 h-3.5" />
                          <span>Tout désélectionner</span>
                        </button>
                      </div>
                    </div>

                    {/* Barre de recherche multi-sélection (numéro ou nom) */}
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Rechercher par numéro (ex: 3) ou nom (ex: Ahmed)..."
                        value={tacheWorkerSearch}
                        onChange={(e) => setTacheWorkerSearch(e.target.value)}
                        className="w-full text-xs font-bold pl-9 pr-8 py-2 rounded-lg border border-slate-300 bg-white focus:border-blue-500 focus:outline-hidden"
                      />
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                      {tacheWorkerSearch && (
                        <button
                          type="button"
                          onClick={() => setTacheWorkerSearch('')}
                          className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Liste à cocher des ouvriers officiels Pointage Matin */}
                    <div className="max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                      {filteredWorkersForTache.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500 font-bold">
                          Aucun ouvrier Pointage Matin ne correspond à « {tacheWorkerSearch} ».
                        </div>
                      ) : (
                        filteredWorkersForTache.map((w) => {
                          const isChecked = selectedWorkerIdsForTache.includes(w.id);
                          return (
                            <div
                              key={w.id}
                              onClick={() => toggleWorkerForTache(w.id)}
                              className={`px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition text-xs ${
                                isChecked ? 'bg-blue-50/90 hover:bg-blue-100/70' : 'hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWorkerForTache(w.id);
                                  }}
                                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                                />
                                <span
                                  className={`px-2 py-0.5 rounded-md font-black text-[11px] shrink-0 ${
                                    isChecked
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-slate-200 text-slate-800'
                                  }`}
                                >
                                  #{w.numero}
                                </span>
                                <span className="font-bold text-slate-900 truncate">{w.nom}</span>
                              </div>

                              {isChecked && quantiteMode === 'individuelle' && (
                                <div
                                  className="flex items-center gap-1 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={quantiteInput || 'Qté'}
                                    value={customQuantitesByWorker[w.id] ?? ''}
                                    onChange={(e) =>
                                      setCustomQuantitesByWorker((prev) => ({
                                        ...prev,
                                        [w.id]: e.target.value,
                                      }))
                                    }
                                    className="w-20 text-xs font-black px-2 py-1 rounded-lg border border-blue-300 bg-white text-right focus:border-blue-600 focus:outline-hidden"
                                  />
                                  <span className="text-[10px] font-black text-blue-800 uppercase">
                                    {uniteInput || 'U'}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Aperçu clair des ouvriers sélectionnés avant validation */}
                    {selectedWorkersForTache.length > 0 ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-black text-emerald-950">
                          <span>
                            Ouvriers sélectionnés ({selectedWorkersForTache.length}) :
                          </span>
                          <span className="text-emerald-700 font-bold">
                            {selectedWorkersForTache.length} opération(s) individuelle(s)
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedWorkersForTache.map((w) => (
                            <span
                              key={w.id}
                              className="inline-flex items-center gap-1 bg-white border border-emerald-300 text-emerald-950 px-2 py-0.5 rounded-lg text-[11px] font-bold shadow-2xs"
                            >
                              <span className="font-black text-emerald-700">#{w.numero}</span>
                              <span>{w.nom}</span>
                              {quantiteMode === 'individuelle' && (customQuantitesByWorker[w.id] || quantiteInput) && (
                                <span className="text-[10px] font-black text-blue-700 bg-blue-50 px-1 rounded">
                                  {customQuantitesByWorker[w.id] || quantiteInput} {uniteInput}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => toggleWorkerForTache(w.id)}
                                className="text-slate-400 hover:text-red-600 ml-0.5"
                                title="Retirer cet ouvrier"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-bold text-amber-900 flex items-center gap-2">
                        <Info className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>Sélectionnez au moins un ouvrier dans la liste ci-dessus pour valider la tâche.</span>
                      </div>
                    )}
                  </div>

                  {/* Champ 2 : Sélection de la tâche ou saisie personnalisée */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Tâche du catalogue
                    </label>
                    <select
                      value={selectedTacheId}
                      onChange={(e) => {
                        setSelectedTacheId(e.target.value);
                        const t = taches.find((tc) => tc.id === e.target.value);
                        if (t) setCustomTacheNom(t.nom);
                      }}
                      className="w-full text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:border-blue-500 focus:outline-hidden"
                    >
                      <option value="">-- Choisir une tâche du catalogue --</option>
                      {taches.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nom} ({t.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Ou nom / titre de la tâche <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: BALAYAGE, DÉSHERBAGE, PALISSAGE..."
                      value={customTacheNom}
                      onChange={(e) => setCustomTacheNom(e.target.value)}
                      className="w-full text-xs font-bold uppercase px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                      required
                    />
                  </div>

                  {/* Champ Description de la tâche */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Description de la tâche (facultatif)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Détails des consignes, zone exacte, nature de la tâche..."
                      value={descriptionInput}
                      onChange={(e) => setDescriptionInput(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>

                  {/* Champ 3 : Quantité réalisée (> 0) + Mode commune/individuelle */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700">
                        {quantiteMode === 'commune'
                          ? 'Quantité par ouvrier'
                          : 'Quantité par défaut (si non personnalisée)'}{' '}
                        <span className="text-red-500">*</span>
                      </label>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Ex: 30, 12,5, 2.25..."
                      value={quantiteInput}
                      onChange={(e) => setQuantiteInput(e.target.value)}
                      className="w-full text-base font-black px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-hidden"
                      required={quantiteMode === 'commune'}
                    />
                  </div>

                  {/* Champ 4 : Unité physique */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Unité de mesure <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={UNITES_STANDARDS.includes(uniteInput) ? uniteInput : 'AUTRE'}
                        onChange={(e) => {
                          if (e.target.value !== 'AUTRE') setUniteInput(e.target.value);
                        }}
                        className="w-1/2 text-xs font-bold px-2.5 py-2.5 rounded-xl border border-slate-300 bg-white focus:border-blue-500 focus:outline-hidden"
                      >
                        {UNITES_STANDARDS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                        <option value="AUTRE">Personnalisée...</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Unité libre"
                        value={uniteInput}
                        onChange={(e) => setUniteInput(e.target.value.toUpperCase())}
                        className="w-1/2 text-xs font-bold uppercase px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                        required
                      />
                    </div>
                  </div>

                  {/* Règle de quantité & option personnalisation par ouvrier */}
                  <div className="sm:col-span-2 p-3 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-start gap-2 text-xs text-blue-950 font-medium">
                        <Info className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                        <span>
                          {quantiteMode === 'commune' ? (
                            <>
                              <strong>Règle appliquée :</strong> la quantité saisie (
                              <strong>{quantiteInput || '—'} {uniteInput}</strong>) s'applique
                              individuellement à chacun des{' '}
                              <strong>{selectedWorkersForTache.length} ouvrier(s)</strong> sélectionné(s).
                            </>
                          ) : (
                            <>
                              <strong>Mode quantité personnalisée :</strong> saisissez une quantité
                              individuelle sur chaque ligne cochée (ou utilisez la quantité par défaut).
                            </>
                          )}
                        </span>
                      </div>

                      <label className="inline-flex items-center gap-2 text-[11px] font-black text-blue-900 bg-white px-2.5 py-1.5 rounded-lg border border-blue-200 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={quantiteMode === 'individuelle'}
                          onChange={(e) =>
                            setQuantiteMode(e.target.checked ? 'individuelle' : 'commune')
                          }
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Personnaliser la quantité par ouvrier</span>
                      </label>
                    </div>
                  </div>

                  {/* Champ 5 : Domaine & Serre */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Domaine</label>
                    <select
                      value={selectedDomaineId}
                      onChange={(e) => setSelectedDomaineId(e.target.value)}
                      className="w-full text-xs font-bold px-3 py-2.5 rounded-xl border border-slate-300 bg-white focus:border-blue-500 focus:outline-hidden"
                    >
                      {domaines.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nom}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Serre (facultatif)
                    </label>
                    <input
                      type="text"
                      list="supp-serres-list"
                      placeholder="Ex: S1, Serre 4..."
                      value={serreInput}
                      onChange={(e) => setSerreInput(e.target.value)}
                      className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                    />
                    <datalist id="supp-serres-list">
                      {serres
                        .filter((s) => s.actif !== false)
                        .map((s) => (
                          <option key={s.id} value={s.nom} />
                        ))}
                    </datalist>
                  </div>

                  {/* Champ 6 : Observation */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Observation (facultatif)
                    </label>
                    <input
                      type="text"
                      placeholder="Remarques complémentaires..."
                      value={observationInput}
                      onChange={(e) => setObservationInput(e.target.value)}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-500">
                    Date d'enregistrement : <strong className="text-slate-800">{formDate}</strong> •{' '}
                    {selectedWorkersForTache.length} opération(s) à créer
                  </span>
                  <button
                    type="submit"
                    disabled={
                      loading ||
                      isSubmittingTache ||
                      selectedWorkersForTache.length === 0 ||
                      !customTacheNom.trim() ||
                      (quantiteMode === 'commune' && !quantiteInput.trim())
                    }
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black px-6 py-3 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {isSubmittingTache
                        ? 'Enregistrement en cours...'
                        : `Enregistrer pour ${selectedWorkersForTache.length || 0} ouvrier(s)`}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* Aperçu en direct des opérations déjà enregistrées pour l'ouvrier (mode heures sup) */}
            {saisieType === 'heures' && matchedWorker && existingOperationsForMatchedWorker.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-900">
                      Opérations déjà enregistrées aujourd'hui pour #{matchedWorker.numero}{' '}
                      {matchedWorker.nom} :
                    </span>
                    <span className="text-[10px] font-black bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                      {existingOperationsForMatchedWorker.length} opération(s)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const row = recapData.find((r) => r.numero_ouvrier === matchedWorker.numero);
                      if (row) setSelectedWorkerForDetail(row);
                    }}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800 underline"
                  >
                    Gérer le détail
                  </button>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                  {existingOperationsForMatchedWorker.map((op) => (
                    <div
                      key={op.id}
                      className="p-2.5 flex items-center justify-between text-xs bg-slate-50/50"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                            op.type === 'heures'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-blue-100 text-blue-900'
                          }`}
                        >
                          {op.type === 'heures' ? 'Heures' : 'Tâche'}
                        </span>
                        <span className="font-bold text-slate-900">{op.nom_tache}</span>
                        <span className="font-black text-emerald-700">
                          {op.valeur} {op.unite}
                        </span>
                        {op.serre_id && (
                          <span className="text-[10px] text-slate-500 font-medium">
                            Serre {op.serre_id}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteOperation(op)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Supprimer cette opération"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* VUE 2 & 3 : RÉCAPITULATIF JOURNALIER CONSOLIDÉ (1 LIGNE / OUVRIER) */}
        {/* ================================================================= */}
        {(activeTab === 'recap' || activeTab === 'historique') && (
          <div className="space-y-4">
            {/* Barre de filtres complets (Date/Plage, Ouvrier, Domaine, Serre, Tâche) */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                {/* Recherche par numéro ou nom */}
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Filtrer par numéro d'ouvrier ou nom..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full text-xs font-semibold pl-9 pr-8 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-hidden"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  {searchFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchFilter('')}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Filtre type (Tous / Heures / Tâches) */}
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFilterType('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      filterType === 'ALL'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Tous ({recapData.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('heures')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      filterType === 'heures'
                        ? 'bg-amber-500 text-slate-950 font-black'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Heures Sup
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterType('taches')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      filterType === 'taches'
                        ? 'bg-blue-600 text-white font-black'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Tâches Sup
                  </button>
                </div>

                {/* Bouton Export Excel */}
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-xs transition active:scale-95 shrink-0"
                  title="Exporter le récapitulatif en fichier Excel (.xlsx)"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Exporter Excel (.xlsx)</span>
                </button>
              </div>

              {/* Filtres multi-critères : Ouvrier, Domaine, Serre, Tâche */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Ouvrier (Pointage Matin)
                  </label>
                  <select
                    value={filterOuvrierId}
                    onChange={(e) => setFilterOuvrierId(e.target.value)}
                    className="w-full text-xs font-bold px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:border-amber-500 focus:outline-hidden"
                  >
                    <option value="ALL">Tous les ouvriers ({pointageWorkers.length})</option>
                    {pointageWorkers.map((w) => (
                      <option key={w.id} value={w.id}>
                        #{w.numero} — {w.nom}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Domaine
                  </label>
                  <select
                    value={filterDomaine}
                    onChange={(e) => setFilterDomaine(e.target.value)}
                    className="w-full text-xs font-bold px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:border-amber-500 focus:outline-hidden"
                  >
                    <option value="ALL">Tous les domaines</option>
                    {domaines.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nom}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Serre
                  </label>
                  <input
                    type="text"
                    list="filter-serres-list"
                    placeholder="Toutes (ex: S1...)"
                    value={filterSerre}
                    onChange={(e) => setFilterSerre(e.target.value)}
                    className="w-full text-xs font-bold px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:border-amber-500 focus:outline-hidden"
                  />
                  <datalist id="filter-serres-list">
                    {serres.map((s) => (
                      <option key={s.id} value={s.nom} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Tâche / Mot-clé
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      list="filter-taches-list"
                      placeholder="Toutes les tâches..."
                      value={filterTache}
                      onChange={(e) => setFilterTache(e.target.value)}
                      className="w-full text-xs font-bold px-2.5 py-2 rounded-lg border border-slate-200 bg-white focus:border-amber-500 focus:outline-hidden"
                    />
                    {(filterOuvrierId !== 'ALL' ||
                      filterDomaine !== 'ALL' ||
                      filterSerre ||
                      filterTache ||
                      searchFilter ||
                      filterType !== 'ALL' ||
                      useDateRange) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilterOuvrierId('ALL');
                          setFilterDomaine('ALL');
                          setFilterSerre('');
                          setFilterTache('');
                          setSearchFilter('');
                          setFilterType('ALL');
                          setUseDateRange(false);
                        }}
                        title="Réinitialiser tous les filtres"
                        className="px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <datalist id="filter-taches-list">
                    {taches.map((t) => (
                      <option key={t.id} value={t.nom} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Option plage de dates */}
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useDateRange}
                    onChange={(e) => setUseDateRange(e.target.checked)}
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Filtrer sur une plage de dates (début — fin)</span>
                </label>

                {useDateRange && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dateDebutFilter}
                      onChange={(e) => setDateDebutFilter(e.target.value)}
                      className="text-xs font-bold p-1.5 border border-slate-200 rounded-lg"
                    />
                    <span className="text-xs font-bold text-slate-400">à</span>
                    <input
                      type="date"
                      value={dateFinFilter}
                      onChange={(e) => setDateFinFilter(e.target.value)}
                      className="text-xs font-bold p-1.5 border border-slate-200 rounded-lg"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Cartes de totaux généraux */}
            <div className={`grid gap-2.5 ${totaux.grand_total_remuneration > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
              <div className="bg-white rounded-xl p-3 border border-slate-200 shadow-2xs">
                <span className="text-[10px] font-black text-slate-500 uppercase block tracking-wider">
                  Ouvriers concernés
                </span>
                <span className="text-xl font-black text-slate-900 mt-0.5 block">
                  {totaux.total_ouvriers_concernes}
                </span>
              </div>
              <div className="bg-white rounded-xl p-3 border border-amber-200 shadow-2xs">
                <span className="text-[10px] font-black text-amber-700 uppercase block tracking-wider">
                  Total Heures Sup
                </span>
                <span className="text-xl font-black text-amber-950 mt-0.5 block">
                  {totaux.grand_total_heures} H
                </span>
              </div>
              {totaux.grand_total_remuneration > 0 && (
                <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-300 shadow-2xs">
                  <span className="text-[10px] font-black text-emerald-800 uppercase block tracking-wider">
                    Total Rémunération
                  </span>
                  <span className="text-xl font-black text-emerald-950 mt-0.5 block">
                    {totaux.grand_total_remuneration} DH
                  </span>
                </div>
              )}
              <div className="bg-white rounded-xl p-3 border border-blue-200 shadow-2xs">
                <span className="text-[10px] font-black text-blue-700 uppercase block tracking-wider">
                  Total Opérations
                </span>
                <span className="text-xl font-black text-blue-950 mt-0.5 block">
                  {totaux.grand_total_operations}
                </span>
              </div>
            </div>

            {/* ============================================================= */}
            {/* TABLEAU RÉCAPITULATIF : RÈGLE FONDAMENTALE : 1 SEULE LIGNE PAR OUVRIER */}
            {/* ============================================================= */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                    Récapitulatif consolidé — {formDate}
                  </h3>
                  <span className="text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full">
                    1 Seule ligne par ouvrier
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 font-bold">
                  {filteredRecapRows.length} ouvrier(s)
                </span>
              </div>

              {loading ? (
                <div className="p-12 text-center text-slate-500 text-xs font-bold">
                  Chargement et consolidation des données en cours...
                </div>
              ) : filteredRecapRows.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-2">
                    <Info className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-slate-700">
                    Aucune heure ni tâche supplémentaire pour cette sélection.
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Utilisez le formulaire « Saisie & Pointage » ci-dessus pour ajouter des
                    opérations.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100/70 text-[11px] font-black text-slate-600 border-b border-slate-200">
                        <th className="py-2.5 px-3 w-14 text-center">N°</th>
                        <th className="py-2.5 px-3 min-w-[150px]">Ouvrier</th>
                        <th className="py-2.5 px-3 min-w-[260px]">
                          Synthèse des supplémentaires (1 Ligne)
                        </th>
                        <th className="py-2.5 px-3 text-center w-24">Nb Opér.</th>
                        <th className="py-2.5 px-3 text-right w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredRecapRows.map((row) => (
                        <tr
                          key={row.ouvrier_id || row.numero_ouvrier}
                          className="hover:bg-slate-50 transition cursor-pointer"
                          onClick={() => setSelectedWorkerForDetail(row)}
                        >
                          {/* N° Ouvrier */}
                          <td className="py-3 px-3 text-center">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-200 text-slate-900 font-black text-xs">
                              {row.numero_ouvrier}
                            </span>
                          </td>

                          {/* Nom Ouvrier */}
                          <td className="py-3 px-3">
                            <span className="font-black text-slate-900 block">
                              {row.nom_ouvrier}
                            </span>
                          </td>

                          {/* RÈGLE ESSENTIELLE : CHAQUE OUVRIER SUR 1 SEULE LIGNE */}
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap items-center gap-1.5 font-bold">
                              {row.total_heures > 0 && (
                                <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-950 border border-amber-300 px-2 py-0.5 rounded-md text-xs font-black shadow-2xs">
                                  <Clock className="w-3 h-3 text-amber-700" />
                                  <span>{row.total_heures} H</span>
                                </span>
                              )}

                              {Object.values(row.taches_groupes).map((tg, idx) => (
                                <React.Fragment key={`${tg.nom_tache}_${tg.unite}`}>
                                  {row.total_heures > 0 || idx > 0 ? (
                                    <span className="text-slate-400 font-black text-xs">+</span>
                                  ) : null}
                                  <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-950 border border-blue-200 px-2 py-0.5 rounded-md text-xs font-bold">
                                    <span className="font-black text-blue-700">
                                      {tg.quantite} {tg.unite}
                                    </span>
                                    <span className="text-[11px] uppercase">{tg.nom_tache}</span>
                                  </span>
                                </React.Fragment>
                              ))}

                              {row.total_heures === 0 &&
                                Object.keys(row.taches_groupes).length === 0 && (
                                  <span className="text-slate-400 font-bold">—</span>
                                )}
                            </div>
                          </td>

                          {/* Nombre d'opérations */}
                          <td className="py-3 px-3 text-center">
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-black bg-slate-100 text-slate-700">
                              {row.nb_operations}
                            </span>
                          </td>

                          {/* Bouton Voir Détail */}
                          <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setSelectedWorkerForDetail(row)}
                              className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-black px-2.5 py-1.5 rounded-lg transition active:scale-95"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-600" />
                              <span>Détail</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ============================================================= */}
            {/* JOURNAL DÉTAILLÉ DES OPÉRATIONS INDIVIDUELLES (HISTORIQUE) */}
            {/* ============================================================= */}
            {activeTab === 'historique' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-black uppercase tracking-wider">
                      Journal détaillé des opérations individuelles
                    </h3>
                    <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-0.5 rounded-full">
                      {detailedOperations.length} opération(s)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-300 font-medium">
                    1 ligne par enregistrement ouvrier
                  </span>
                </div>

                {loading ? (
                  <div className="p-8 text-center text-slate-500 text-xs font-bold">
                    Chargement de l'historique...
                  </div>
                ) : detailedOperations.length === 0 ? (
                  <div className="p-8 text-center text-xs font-bold text-slate-500">
                    Aucune opération individuelle trouvée pour ces filtres.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100 text-[11px] font-black text-slate-600 border-b border-slate-200">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Ouvrier</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Tâche & Description</th>
                          <th className="py-2.5 px-3">Quantité / Détails</th>
                          <th className="py-2.5 px-3">Domaine / Serre</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {detailedOperations.map((op) => (
                          <tr key={op.id} className="hover:bg-slate-50 transition">
                            <td className="py-2.5 px-3 font-bold text-slate-700 whitespace-nowrap">
                              {op.date}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-900 font-black text-[11px]">
                                  #{op.numero_ouvrier}
                                </span>
                                <span className="font-bold text-slate-900">{op.nom_ouvrier}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span
                                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                                  op.type === 'heures'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-blue-100 text-blue-900'
                                }`}
                              >
                                {op.type === 'heures'
                                  ? op.mode_calcul === 'quart_heure'
                                    ? 'Quart d\'h'
                                    : 'Heures'
                                  : 'Tâche'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-black text-slate-900 block">
                                {op.nom_tache}
                              </span>
                              {op.description && (
                                <span className="text-[11px] text-slate-600 block">
                                  {op.description}
                                </span>
                              )}
                              {op.observation && (
                                <span className="text-[10px] text-slate-500 italic block">
                                  Obs : {op.observation}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="font-black text-emerald-800 block">
                                {op.valeur} {op.unite}
                                {op.type === 'heures' &&
                                  op.mode_calcul === 'quart_heure' &&
                                  op.nb_unites && (
                                    <span className="text-[11px] text-amber-800 ml-1">
                                      ({op.nb_unites} quarts)
                                    </span>
                                  )}
                              </span>
                              {op.remuneration !== undefined && op.remuneration !== null && (
                                <span className="text-[11px] font-bold text-emerald-700">
                                  {op.remuneration} DH
                                  {op.tarif_unitaire !== null && op.tarif_unitaire !== undefined
                                    ? ` (${op.tarif_unitaire} DH/${op.mode_calcul === 'quart_heure' ? 'quart' : 'h'})`
                                    : ''}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-slate-600 font-medium whitespace-nowrap">
                              {op.domaine_id || '—'}
                              {op.serre_id ? ` • ${op.serre_id}` : ''}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedWorkerForDetail(op.workerRow);
                                    handleOpenEditOperation(op);
                                  }}
                                  className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition"
                                  title="Modifier cette opération"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteOperation(op)}
                                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition"
                                  title="Supprimer cette opération"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL : DÉTAIL DES OPÉRATIONS INDIVIDUELLES & GESTION (MODIF/SUPPR) */}
        {/* ================================================================= */}
        {selectedWorkerForDetail && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
              {/* Entête du modal */}
              <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
                    #{selectedWorkerForDetail.numero_ouvrier}
                  </span>
                  <div>
                    <h3 className="text-base font-black">
                      {selectedWorkerForDetail.nom_ouvrier}
                    </h3>
                    <p className="text-xs text-slate-300 font-medium">
                      Synthèse consolidée : {selectedWorkerForDetail.texte_recapitulatif}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkerForDetail(null);
                    setEditingOperation(null);
                  }}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corps du modal : liste des opérations individuelles */}
              <div className="p-5 overflow-y-auto space-y-3 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    Liste des opérations ({selectedWorkerForDetail.operations.length})
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Vous pouvez modifier la quantité ou supprimer une opération
                  </span>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {selectedWorkerForDetail.operations.map((op) => (
                    <div key={op.id} className="p-3.5 bg-white hover:bg-slate-50/80 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                op.type === 'heures'
                                  ? op.mode_calcul === 'quart_heure'
                                    ? 'bg-amber-200 text-amber-950 border border-amber-300'
                                    : 'bg-amber-100 text-amber-900 border border-amber-200'
                                  : 'bg-blue-100 text-blue-900 border border-blue-200'
                              }`}
                            >
                              {op.type === 'heures'
                                ? (op.mode_calcul === 'quart_heure' ? '⏱️ Quart d\'heure (15 min)' : '🕒 Mode Heure')
                                : op.type_label}
                            </span>
                            <span className="text-sm font-black text-slate-900">
                              {op.nom_tache}
                            </span>
                            <span className="text-sm font-black text-slate-800">
                              {op.valeur} {op.unite}
                              {op.type === 'heures' && op.mode_calcul === 'quart_heure' && op.nb_unites && (
                                <span className="text-xs text-amber-900 font-semibold ml-1">
                                  ({op.nb_unites} quarts)
                                </span>
                              )}
                            </span>
                            {op.tarif_unitaire !== undefined && op.tarif_unitaire !== null && (
                              <span className="text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                                Tarif : {op.tarif_unitaire} DH/{op.mode_calcul === 'quart_heure' ? 'quart' : 'h'}
                              </span>
                            )}
                            {op.remuneration !== undefined && op.remuneration !== null && (
                              <span className="text-sm font-black text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-md shadow-2xs">
                                Rémunération : {op.remuneration} DH
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                            <span>Date : {op.date}</span>
                            {op.domaine_id && <span>Domaine : {op.domaine_id}</span>}
                            {op.serre_id && <span>Serre : {op.serre_id}</span>}
                            {op.created_by_nom && <span>Par : {op.created_by_nom}</span>}
                          </div>

                          {op.description && (
                            <p className="text-[11px] text-slate-700 bg-blue-50/60 p-1.5 rounded-lg border border-blue-100">
                              <strong className="text-blue-900">Description :</strong> {op.description}
                            </p>
                          )}

                          {op.observation && (
                            <p className="text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded-lg border border-slate-100 italic">
                              « {op.observation} »
                            </p>
                          )}
                        </div>

                        {/* Boutons d'action : Modifier et Supprimer */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditOperation(op)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
                            title="Modifier cette opération"
                          >
                            <Edit3 className="w-4 h-4 text-blue-600" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOperation(op)}
                            className="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition"
                            title="Supprimer cette opération"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Formulaire de modification rapide si une opération est sélectionnée */}
                {editingOperation && (
                  <div className="mt-4 p-4 bg-slate-50 border border-blue-200 rounded-xl space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="text-xs font-black text-blue-950">
                        Modifier l'opération : {editingOperation.nom_tache}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingOperation(null)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {editingOperation.type === 'heures' ? (
                      <div className="space-y-3">
                        {/* Choix du mode dans la modification */}
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Mode de calcul de la rémunération
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setEditModeCalcul('heure')}
                              className={`p-2 rounded-lg text-xs font-bold border transition ${
                                editModeCalcul === 'heure'
                                  ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-2xs font-black'
                                  : 'bg-white text-slate-600 border-slate-200'
                              }`}
                            >
                              🕒 Mode Heure
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditModeCalcul('quart_heure')}
                              className={`p-2 rounded-lg text-xs font-bold border transition ${
                                editModeCalcul === 'quart_heure'
                                  ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-2xs font-black'
                                  : 'bg-white text-slate-600 border-slate-200'
                              }`}
                            >
                              ⏱️ Mode Quart d'heure (15 min)
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              {editModeCalcul === 'heure' ? 'Prix d\'une heure (DH)' : 'Prix d\'un quart (DH)'}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={editModeCalcul === 'heure' ? 'Ex: 30' : 'Ex: 10'}
                              value={editTarifUnitaire}
                              onChange={(e) => setEditTarifUnitaire(e.target.value)}
                              className="w-full text-xs font-black p-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              {editModeCalcul === 'heure' ? 'Nombre d\'heures' : 'Nombre de quarts (15 min)'}
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={editModeCalcul === 'heure' ? 'Ex: 2, 2,5, 1.75' : 'Ex: 4'}
                              value={editNbUnites}
                              onChange={(e) => setEditNbUnites(e.target.value)}
                              className="w-full text-xs font-black p-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>

                          {/* Aperçu direct du calcul de modification */}
                          <div className="col-span-2 p-2.5 bg-slate-900 text-white rounded-lg flex items-center justify-between text-xs">
                            <span className="text-slate-300 font-medium">
                              Rémunération recalculée ({editTarifUnitaire || 0} DH × {editNbUnites || 0}) :
                            </span>
                            <span className="font-black text-amber-400 text-sm">
                              {(() => {
                                const t = parseNonNegativeDecimal(editTarifUnitaire);
                                const n = parsePositiveDecimal(editNbUnites);
                                return t !== null && n !== null ? `${cleanFloatPrecision(t * n)} DH` : '—';
                              })()}
                            </span>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Serre
                            </label>
                            <input
                              type="text"
                              value={editSerreId}
                              onChange={(e) => setEditSerreId(e.target.value)}
                              className="w-full text-xs font-semibold p-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Observation
                            </label>
                            <input
                              type="text"
                              value={editObservation}
                              onChange={(e) => setEditObservation(e.target.value)}
                              className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Description (facultatif)
                          </label>
                          <input
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Quantité réalisée
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editQuantite}
                            onChange={(e) => setEditQuantite(e.target.value)}
                            className="w-full text-xs font-black p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Unité (RUBO, CAISSE, KG...)
                          </label>
                          <input
                            type="text"
                            value={editUnite}
                            onChange={(e) => setEditUnite(e.target.value)}
                            className="w-full text-xs font-bold uppercase p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Serre
                          </label>
                          <input
                            type="text"
                            value={editSerreId}
                            onChange={(e) => setEditSerreId(e.target.value)}
                            className="w-full text-xs font-semibold p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Observation
                          </label>
                          <input
                            type="text"
                            value={editObservation}
                            onChange={(e) => setEditObservation(e.target.value)}
                            className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingOperation(null)}
                        className="text-xs font-bold px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEditOperation}
                        className="text-xs font-black px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg shadow-xs cursor-pointer"
                      >
                        Valider la modification
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pied du modal */}
              <div className="px-5 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between shrink-0">
                <span className="text-[11px] text-slate-500 font-medium">
                  Modification et suppression en temps réel
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWorkerForDetail(null);
                    setEditingOperation(null);
                  }}
                  className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-black px-4 py-2 rounded-xl transition"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
