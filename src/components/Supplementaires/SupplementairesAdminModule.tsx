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
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Ouvrier, Tache, Domaine, Serre, UserAccount } from '../../types';

interface OperationDetail {
  id: string;
  type: 'heures' | 'tache';
  type_label: string;
  date: string;
  quantite_ou_duree: number;
  valeur: number;
  unite: string;
  nom_tache: string;
  domaine_id?: string | null;
  serre_id?: string | null;
  observation?: string | null;
  created_at: string;
  created_by_nom?: string | null;
}

interface WorkerRecapRow {
  ouvrier_id: string;
  numero_ouvrier: number;
  nom_ouvrier: string;
  total_heures: number;
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
    grand_total_operations: number;
  }>({ total_ouvriers_concernes: 0, grand_total_heures: 0, grand_total_operations: 0 });

  // Ouvrier sélectionné pour le détail / modal de gestion
  const [selectedWorkerForDetail, setSelectedWorkerForDetail] = useState<WorkerRecapRow | null>(null);

  // Opération en cours d'édition dans le modal
  const [editingOperation, setEditingOperation] = useState<OperationDetail | null>(null);
  const [editQuantite, setEditQuantite] = useState<string>('');
  const [editUnite, setEditUnite] = useState<string>('');
  const [editNomTache, setEditNomTache] = useState<string>('');
  const [editDomaineId, setEditDomaineId] = useState<string>('');
  const [editSerreId, setEditSerreId] = useState<string>('');
  const [editObservation, setEditObservation] = useState<string>('');

  // -------------------------------------------------------------------------
  // FORMULAIRE DE SAISIE COMMUNE & SPÉCIFIQUE
  // -------------------------------------------------------------------------
  const [formDate, setFormDate] = useState<string>(selectedDate || new Date().toISOString().split('T')[0]);
  const [workerNumberInput, setWorkerNumberInput] = useState<string>('');
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>(domaines[0]?.id || 'D1');
  const [serreInput, setSerreInput] = useState<string>('');
  const [observationInput, setObservationInput] = useState<string>('');

  // Champs spécifiques Heures Sup
  const [heuresInput, setHeuresInput] = useState<string>('');
  const [heureDebut, setHeureDebut] = useState<string>('');
  const [heureFin, setHeureFin] = useState<string>('');

  // Champs spécifiques Tâches Sup
  const [selectedTacheId, setSelectedTacheId] = useState<string>('');
  const [customTacheNom, setCustomTacheNom] = useState<string>('');
  const [quantiteInput, setQuantiteInput] = useState<string>('');
  const [uniteInput, setUniteInput] = useState<string>('RUBO');

  // Filtres pour l'historique et le récapitulatif
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [filterDomaine, setFilterDomaine] = useState<string>('ALL');
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
  // RÈGLE : RECHERCHE STRICTE DE L'OUVRIER PAR NUMÉRO
  // -------------------------------------------------------------------------
  const matchedWorker = useMemo(() => {
    const raw = workerNumberInput.trim();
    if (!raw) return null;
    const num = parseInt(raw, 10);
    if (isNaN(num) || num <= 0) return null;
    return allOuvriers.find((w) => w.numero === num) || null;
  }, [workerNumberInput, allOuvriers]);

  // Opérations déjà enregistrées aujourd'hui pour cet ouvrier (aperçu en direct)
  const existingOperationsForMatchedWorker = useMemo(() => {
    if (!matchedWorker) return [];
    const workerRow = recapData.find((r) => r.numero_ouvrier === matchedWorker.numero);
    return workerRow?.operations || [];
  }, [matchedWorker, recapData]);

  // Calcul automatique des heures si début et fin sont renseignés
  useEffect(() => {
    if (heureDebut && heureFin && heureDebut.includes(':') && heureFin.includes(':')) {
      const [h1, m1] = heureDebut.split(':').map((v) => parseInt(v, 10));
      const [h2, m2] = heureFin.split(':').map((v) => parseInt(v, 10));
      if (!isNaN(h1) && !isNaN(m1) && !isNaN(h2) && !isNaN(m2)) {
        let diffMinutes = h2 * 60 + m2 - (h1 * 60 + m1);
        if (diffMinutes < 0) diffMinutes += 24 * 60;
        const dur = Math.round((diffMinutes / 60) * 100) / 100;
        setHeuresInput(String(dur));
      }
    }
  }, [heureDebut, heureFin]);

  // -------------------------------------------------------------------------
  // CHARGEMENT DU RÉCAPITULATIF DEPUIS LE SERVEUR
  // -------------------------------------------------------------------------
  const fetchRecapData = useCallback(async () => {
    setLoading(true);
    try {
      const token = 'dev_admin_token';
      const companyId = 'cie_lahcen_pointeur';
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

      const res = await fetch(`/api/supplementaires/recap?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-company-id': companyId,
        },
      });

      if (!res.ok) {
        if (res.status === 403) {
          throw new Error('Accès interdit : ce module est réservé exclusivement à l\'administrateur.');
        }
        throw new Error(`Erreur serveur (${res.status})`);
      }

      const data = await res.json();
      if (data.success) {
        setRecapData(data.recap || []);
        setTotaux(
          data.totaux || {
            total_ouvriers_concernes: (data.recap || []).length,
            grand_total_heures: 0,
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
  }, [formDate, selectedDate, useDateRange, dateDebutFilter, dateFinFilter, filterDomaine]);

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

    const dur = parseFloat(heuresInput.replace(',', '.'));
    if (isNaN(dur) || dur <= 0) {
      setFeedback({
        type: 'error',
        message: 'Le nombre d\'heures supplémentaires doit être strictement supérieur à 0 (pas de valeur négative ni vide).',
      });
      return;
    }

    try {
      setLoading(true);
      const res = await fetch('/api/heures-supplementaires', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dev_admin_token',
          'x-company-id': 'cie_lahcen_pointeur',
        },
        body: JSON.stringify({
          ouvrier_id: matchedWorker.id,
          numero_ouvrier: matchedWorker.numero,
          date: formDate,
          duree_heures: dur,
          heures: dur,
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
        message: `✓ ${dur} H supplémentaires enregistrées pour l'ouvrier #${matchedWorker.numero} (${matchedWorker.nom}).`,
      });

      // Réinitialiser les champs de durée tout en gardant l'ouvrier pour éventuelle autre saisie
      setHeuresInput('');
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
  // SOUMISSION FORMULAIRE : TÂCHES SUPPLÉMENTAIRES
  // -------------------------------------------------------------------------
  const handleSubmitTaches = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!matchedWorker) {
      setFeedback({
        type: 'error',
        message: `Ouvrier introuvable. Aucun ouvrier existant ne correspond au numéro "${workerNumberInput}". Veuillez saisir un numéro valide.`,
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

    const qty = parseFloat(quantiteInput.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      setFeedback({
        type: 'error',
        message: 'La quantité réalisée doit être un nombre strictement supérieur à 0.',
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

    try {
      setLoading(true);
      const res = await fetch('/api/taches-supplementaires', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dev_admin_token',
          'x-company-id': 'cie_lahcen_pointeur',
        },
        body: JSON.stringify({
          ouvrier_id: matchedWorker.id,
          numero_ouvrier: matchedWorker.numero,
          date: formDate,
          tache_id: selectedTacheId || null,
          nom_tache: taskName,
          quantite: qty,
          unite: unit,
          domaine_id: selectedDomaineId || null,
          serre_id: serreInput.trim() || null,
          observation: observationInput.trim() || null,
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Erreur lors de l\'enregistrement de la tâche.');
      }

      setFeedback({
        type: 'success',
        message: `✓ Tâche ${qty} ${unit} "${taskName}" enregistrée pour l'ouvrier #${matchedWorker.numero} (${matchedWorker.nom}).`,
      });

      // Réinitialiser la quantité tout en gardant l'ouvrier et la tâche pour enchaîner
      setQuantiteInput('');
      setObservationInput('');

      // Rafraîchir les données
      await fetchRecapData();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Erreur lors de l\'enregistrement.' });
    } finally {
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

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: {
          Authorization: 'Bearer dev_admin_token',
          'x-company-id': 'cie_lahcen_pointeur',
        },
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
    setEditDomaineId(op.domaine_id || '');
    setEditSerreId(op.serre_id || '');
    setEditObservation(op.observation || '');
  };

  const handleSaveEditOperation = async () => {
    if (!editingOperation) return;
    const val = parseFloat(editQuantite.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      alert('La valeur / durée doit être un nombre strictement supérieur à 0.');
      return;
    }

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

      if (isHeures) {
        payload.duree_heures = val;
        payload.heures = val;
      } else {
        payload.quantite = val;
        payload.unite = editUnite.trim().toUpperCase() || 'RUBO';
        payload.nom_tache = editNomTache.trim().toUpperCase() || 'TÂCHE';
      }

      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dev_admin_token',
          'x-company-id': 'cie_lahcen_pointeur',
        },
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
                    valeur: val,
                    quantite_ou_duree: val,
                    unite: isHeures ? 'H' : editUnite.trim().toUpperCase(),
                    nom_tache: isHeures ? o.nom_tache : editNomTache.trim().toUpperCase(),
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
      alert(err.message || 'Erreur lors de la mise à jour.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // EXPORT EXCEL PROFESSIONNEL (.XLSX VIA SHEETJS)
  // -------------------------------------------------------------------------
  const handleExportExcel = () => {
    if (recapData.length === 0) {
      alert('Aucune donnée à exporter pour la période sélectionnée.');
      return;
    }

    try {
      // 1. Feuille 1 : Récapitulatif Consolidé (1 Seule Ligne par Ouvrier)
      const recapSheetData = recapData.map((row) => ({
        'N° Ouvrier': row.numero_ouvrier,
        'Nom Ouvrier': row.nom_ouvrier,
        'Synthèse Consolidée': row.texte_recapitulatif,
        'Total Heures Sup': row.total_heures > 0 ? `${row.total_heures} H` : '—',
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
            'Quantité / Durée': op.valeur,
            Unité: op.unite,
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
      alert('Erreur lors de la génération du fichier Excel: ' + err.message);
    }
  };

  // Filtrage des lignes pour l'affichage
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
                      Saisie d'heures supplémentaires
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Temps de travail additionnel comptabilisé en heures (&gt; 0)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Champ 1 : Numéro Ouvrier avec recherche automatique instantanée */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Numéro de l'ouvrier <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        placeholder="Ex: 1, 4, 12..."
                        value={workerNumberInput}
                        onChange={(e) => setWorkerNumberInput(e.target.value)}
                        className="w-full text-base font-black px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-hidden"
                        required
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    </div>

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
                              Ouvrier officiel validé dans le référentiel
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-black uppercase bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-md">
                          Trouvé
                        </span>
                      </div>
                    ) : workerNumberInput.trim() !== '' ? (
                      <div className="mt-2 p-2.5 bg-red-50 border border-red-300 rounded-xl flex items-center gap-2 text-red-800 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                        <span>
                          Aucun ouvrier ne correspond au numéro #{workerNumberInput}. La création
                          automatique d'ouvriers est strictement interdite.
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Champ 2 : Nombre d'heures supplémentaires (> 0) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nombre d'heures supplémentaires <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.25"
                        min="0.1"
                        placeholder="Ex: 1.5, 2, 3..."
                        value={heuresInput}
                        onChange={(e) => setHeuresInput(e.target.value)}
                        className="w-full text-base font-black px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-amber-500 focus:ring-2 focus:ring-amber-200 focus:outline-hidden"
                        required
                      />
                      <span className="absolute right-3.5 top-3 text-xs font-black text-amber-700">
                        HEURES
                      </span>
                    </div>
                  </div>

                  {/* Calcul optionnel de durée (Heure début -> Heure fin) */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">
                        Début (facultatif)
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
                        Fin (facultatif)
                      </label>
                      <input
                        type="time"
                        value={heureFin}
                        onChange={(e) => setHeureFin(e.target.value)}
                        className="w-full text-xs font-semibold px-2.5 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-hidden"
                      />
                    </div>
                  </div>

                  {/* Champ 3 : Domaine */}
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

                  {/* Champ 4 : Serre */}
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

                  {/* Champ 5 : Observation */}
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
                    disabled={loading || !matchedWorker || !heuresInput}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black px-6 py-3 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Enregistrer Heures Supplémentaires</span>
                  </button>
                </div>
              </form>
            )}

            {/* ------------------------------------------------------------- */}
            {/* FORMULAIRE TÂCHES SUPPLÉMENTAIRES */}
            {/* ------------------------------------------------------------- */}
            {saisieType === 'taches' && (
              <form
                onSubmit={handleSubmitTaches}
                className="bg-white rounded-2xl shadow-sm border border-blue-200 p-4 sm:p-5"
              >
                <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-100">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900">
                      Saisie de tâches supplémentaires
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Travaux physiques au forfait ou au rendement (RUBO, CAISSE, KG, LIGNE...)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Champ 1 : Numéro Ouvrier */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Numéro de l'ouvrier <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        placeholder="Ex: 1, 4, 12..."
                        value={workerNumberInput}
                        onChange={(e) => setWorkerNumberInput(e.target.value)}
                        className="w-full text-base font-black px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-hidden"
                        required
                      />
                      <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                    </div>

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
                              Ouvrier officiel validé dans le référentiel
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-black uppercase bg-emerald-200/80 text-emerald-900 px-2 py-0.5 rounded-md">
                          Trouvé
                        </span>
                      </div>
                    ) : workerNumberInput.trim() !== '' ? (
                      <div className="mt-2 p-2.5 bg-red-50 border border-red-300 rounded-xl flex items-center gap-2 text-red-800 text-xs font-bold">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                        <span>
                          Aucun ouvrier ne correspond au numéro #{workerNumberInput}. La création
                          automatique d'ouvriers est strictement interdite.
                        </span>
                      </div>
                    ) : null}
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
                      Ou saisie manuelle de la tâche <span className="text-red-500">*</span>
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

                  {/* Champ 3 : Quantité réalisée (> 0) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Quantité réalisée <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="Ex: 30, 50, 100..."
                      value={quantiteInput}
                      onChange={(e) => setQuantiteInput(e.target.value)}
                      className="w-full text-base font-black px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-hidden"
                      required
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
                      placeholder="Ex: S1, Serre 4..."
                      value={serreInput}
                      onChange={(e) => setSerreInput(e.target.value)}
                      className="w-full text-xs font-semibold px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>

                  {/* Champ 6 : Observation */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Observation (facultatif)
                    </label>
                    <input
                      type="text"
                      placeholder="Précisions sur la tâche..."
                      value={observationInput}
                      onChange={(e) => setObservationInput(e.target.value)}
                      className="w-full text-xs px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-500 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="submit"
                    disabled={loading || !matchedWorker || !quantiteInput || !customTacheNom}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-black px-6 py-3 rounded-xl shadow-md transition active:scale-95 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>Enregistrer Tâche Supplémentaire</span>
                  </button>
                </div>
              </form>
            )}

            {/* Aperçu en direct des opérations déjà enregistrées pour cet ouvrier */}
            {matchedWorker && existingOperationsForMatchedWorker.length > 0 && (
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
            {/* Barre de filtres et d'action */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                {/* Recherche par numéro ou nom */}
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Filtrer par numéro d'ouvrier ou nom..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="w-full text-xs font-semibold pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-hidden"
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
                <div className="flex items-center gap-1.5 shrink-0">
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

              {/* Option plage de dates pour l'historique */}
              {activeTab === 'historique' && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useDateRange}
                      onChange={(e) => setUseDateRange(e.target.checked)}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Filtrer sur une période (date début - date fin)</span>
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
              )}
            </div>

            {/* Cartes de totaux généraux */}
            <div className="grid grid-cols-3 gap-2.5">
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
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                op.type === 'heures'
                                  ? 'bg-amber-100 text-amber-900 border border-amber-200'
                                  : 'bg-blue-100 text-blue-900 border border-blue-200'
                              }`}
                            >
                              {op.type_label}
                            </span>
                            <span className="text-sm font-black text-slate-900">
                              {op.nom_tache}
                            </span>
                            <span className="text-sm font-black text-emerald-700">
                              {op.valeur} {op.unite}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium">
                            <span>Date : {op.date}</span>
                            {op.domaine_id && <span>Domaine : {op.domaine_id}</span>}
                            {op.serre_id && <span>Serre : {op.serre_id}</span>}
                            {op.created_by_nom && <span>Par : {op.created_by_nom}</span>}
                          </div>

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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          {editingOperation.type === 'heures' ? 'Durée (heures)' : 'Quantité'}
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={editQuantite}
                          onChange={(e) => setEditQuantite(e.target.value)}
                          className="w-full text-xs font-black p-2 border border-slate-300 rounded-lg bg-white"
                        />
                      </div>

                      {editingOperation.type === 'tache' ? (
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Unité
                          </label>
                          <input
                            type="text"
                            value={editUnite}
                            onChange={(e) => setEditUnite(e.target.value)}
                            className="w-full text-xs font-bold uppercase p-2 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                      ) : (
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
                      )}

                      <div className="col-span-2">
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

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingOperation(null)}
                        className="text-xs font-bold px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEditOperation}
                        className="text-xs font-black px-4 py-1.5 bg-blue-600 text-white rounded-lg shadow-xs"
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
