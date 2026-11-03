/**
 * Module RÉCOLTE — Lahcen Pointeur (Reconstruction complète)
 * Interface tactile, très visuelle et ultra-simple conçue pour un Caporal agricole sur le terrain.
 *
 * SÉQUENCE D'UTILISATION :
 * ÉTape 1 : Pointage de présence à la récolte (Sélection des ouvriers présents)
 * Étape 2 : Choix des serres dans lesquelles les ouvriers récoltent
 * Étape 3 : Saisie intuitive des caisses par ouvrier et par serre (Boutons + / - géants)
 * Étape 4 : Calculs automatiques, Enregistrement et Historique du jour
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Search,
  Check,
  Plus,
  Minus,
  CheckCircle2,
  AlertCircle,
  Edit2,
  Trash2,
  Cloud,
  Layers,
  UserCheck,
  X,
  Clock,
  ArrowRight,
  ArrowLeft,
  RotateCcw,
  CheckSquare,
  Square,
  Sparkles,
  Save,
} from 'lucide-react';
import { Ouvrier, Serre, RecolteEntry, UserAccount } from '../types';

interface RecolteCaporalProps {
  currentUser: UserAccount;
  activeOuvriers: Ouvrier[];
  serres: Serre[];
  recoltes: RecolteEntry[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onAddRecolte: (
    entries: Array<{
      date: string;
      serre_id: string;
      serre_nom: string;
      ouvrier_id: string;
      numero_ouvrier: number;
      nom_ouvrier: string;
      caisses: number;
      notes?: string;
      type_operation?: 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT';
      domaine_id?: string | null;
    }>,
    author: { id: string; nom: string }
  ) => { success: boolean; error?: string; count: number; added: RecolteEntry[] };
  onUpdateRecolte: (
    id: string,
    partial: {
      caisses?: number;
      notes?: string;
      date?: string;
      serre_id?: string;
      serre_nom?: string;
      type_operation?: 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT';
      domaine_id?: string | null;
    },
    updatedBy: { id: string; nom: string }
  ) => { success: boolean; error?: string; entry?: RecolteEntry };
  onDeleteRecolte: (id: string) => { success: boolean; error?: string };
  onSync?: () => Promise<{ success: boolean; syncedCount: number; receivedCount: number; error?: string }>;
}

export const RecolteCaporal: React.FC<RecolteCaporalProps> = ({
  currentUser,
  activeOuvriers,
  serres,
  recoltes,
  selectedDate,
  onSelectDate,
  onAddRecolte,
  onUpdateRecolte,
  onDeleteRecolte,
  onSync,
}) => {
  // Type d'opération sélectionné : Récolte (par défaut), Chargement, ou Déchargement
  const [operationType, setOperationType] = useState<'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT'>('RECOLTE');

  // Mode d'affichage principal : 'saisie' (Assistant 3 étapes) ou 'historique' (Mes Saisies du jour)
  const [mainView, setMainView] = useState<'saisie' | 'historique'>('saisie');

  // Assistant de Saisie : Étape actuelle (1: Ouvriers, 2: Serres, 3: Caisses)
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // --------------------------------------------------------------------------
  // ÉTAPE 1 : SÉLECTION DES OUVRIERS PRÉSENTS À LA RÉCOLTE
  // --------------------------------------------------------------------------
  const [searchWorkerQuery, setSearchWorkerQuery] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(new Set());

  // Liste des ouvriers triés par numéro
  const sortedWorkers = useMemo(() => {
    return [...activeOuvriers].sort((a, b) => a.numero - b.numero);
  }, [activeOuvriers]);

  // Ouvriers filtrés selon la recherche rapide
  const filteredWorkers = useMemo(() => {
    const q = searchWorkerQuery.trim().toLowerCase();
    if (!q) return sortedWorkers;
    return sortedWorkers.filter(
      (w) => w.numero.toString().includes(q) || w.nom.toLowerCase().includes(q)
    );
  }, [sortedWorkers, searchWorkerQuery]);

  // Actions de sélection globale
  const handleSelectAllWorkers = () => {
    const allIds = new Set(sortedWorkers.map((w) => w.id));
    setSelectedWorkerIds(allIds);
  };

  const handleDeselectAllWorkers = () => {
    setSelectedWorkerIds(new Set());
  };

  const handleToggleWorker = (workerId: string) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  };

  // --------------------------------------------------------------------------
  // ÉTAPE 2 : CHOIX DES SERRES
  // --------------------------------------------------------------------------
  const activeSerres = useMemo(() => {
    const list = serres.filter((s) => s.actif);
    return list.length > 0
      ? list
      : [
          { id: 'serre_1', code: 'S01', nom: 'Serre 1', actif: true, ordre: 1 },
          { id: 'serre_2', code: 'S02', nom: 'Serre 2', actif: true, ordre: 2 },
        ];
  }, [serres]);

  const [selectedSerreIds, setSelectedSerreIds] = useState<Set<string>>(new Set());

  // Sélectionner la première serre par défaut lors du premier chargement des serres
  useEffect(() => {
    if (selectedSerreIds.size === 0 && activeSerres.length > 0) {
      setSelectedSerreIds(new Set([activeSerres[0].id]));
    }
  }, [activeSerres]);

  const handleToggleSerre = (serreId: string) => {
    setSelectedSerreIds((prev) => {
      const next = new Set(prev);
      if (next.has(serreId)) {
        if (next.size > 1) {
          next.delete(serreId);
        }
      } else {
        next.add(serreId);
      }
      return next;
    });
  };

  // Serre active sélectionnée pour l'affichage de la saisie à l'Étape 3
  const [activeSerreForEntry, setActiveSerreForEntry] = useState<string>('');

  useEffect(() => {
    const firstSerre = Array.from(selectedSerreIds)[0];
    if (firstSerre) {
      setActiveSerreForEntry(firstSerre);
    } else if (activeSerres[0]) {
      setActiveSerreForEntry(activeSerres[0].id);
    }
  }, [selectedSerreIds, activeSerres]);

  // --------------------------------------------------------------------------
  // ÉTAPE 3 : MATRICE DES CAISSES (OUVRIER x SERRE)
  // Structure : { [workerId]: { [serreId]: number } }
  // --------------------------------------------------------------------------
  const [caissesMap, setCaissesMap] = useState<Record<string, Record<string, number>>>({});

  // Initialiser la matrice des caisses lorsque l'utilisateur accède à l'Étape 3
  const handleProceedToStep3 = () => {
    if (selectedWorkerIds.size === 0) return;
    if (selectedSerreIds.size === 0) return;

    // Conserver les valeurs déjà saisies si l'utilisateur revient en arrière, sinon initialiser à 0
    const newMap: Record<string, Record<string, number>> = { ...caissesMap };
    selectedWorkerIds.forEach((wId) => {
      if (!newMap[wId]) newMap[wId] = {};
      selectedSerreIds.forEach((sId) => {
        if (newMap[wId][sId] === undefined) {
          newMap[wId][sId] = 0;
        }
      });
    });

    setCaissesMap(newMap);
    setStep(3);
  };

  // Ajustement de quantité par bouton + ou -
  const handleDeltaCaisses = (workerId: string, serreId: string, delta: number) => {
    setCaissesMap((prev) => {
      const workerData = { ...(prev[workerId] || {}) };
      const current = Number(workerData[serreId] || 0);
      const updated = Math.max(0, Math.round((current + delta) * 10) / 10);
      return {
        ...prev,
        [workerId]: {
          ...workerData,
          [serreId]: updated,
        },
      };
    });
  };

  // Saisie directe de la quantité
  const handleSetCaissesDirect = (workerId: string, serreId: string, valStr: string) => {
    const parsed = parseFloat(valStr.replace(',', '.'));
    const qty = isNaN(parsed) || parsed < 0 ? 0 : parsed;
    setCaissesMap((prev) => ({
      ...prev,
      [workerId]: {
        ...(prev[workerId] || {}),
        [serreId]: qty,
      },
    }));
  };

  // --------------------------------------------------------------------------
  // CALCULS AUTOMATIQUES
  // --------------------------------------------------------------------------
  // Liste des objets ouvriers sélectionnés
  const selectedWorkersList = useMemo(() => {
    return sortedWorkers.filter((w) => selectedWorkerIds.has(w.id));
  }, [sortedWorkers, selectedWorkerIds]);

  // Liste des objets serres sélectionnées
  const selectedSerresList = useMemo(() => {
    return activeSerres.filter((s) => selectedSerreIds.has(s.id));
  }, [activeSerres, selectedSerreIds]);

  // Cumul des caisses par ouvrier (toutes serres confondues)
  const totalByWorker = useMemo(() => {
    const totals: Record<string, number> = {};
    selectedWorkerIds.forEach((wId) => {
      let sum = 0;
      selectedSerreIds.forEach((sId) => {
        sum += Number(caissesMap[wId]?.[sId] || 0);
      });
      totals[wId] = Math.round(sum * 10) / 10;
    });
    return totals;
  }, [caissesMap, selectedWorkerIds, selectedSerreIds]);

  // Cumul des caisses par serre
  const totalBySerre = useMemo(() => {
    const totals: Record<string, number> = {};
    selectedSerreIds.forEach((sId) => {
      let sum = 0;
      selectedWorkerIds.forEach((wId) => {
        sum += Number(caissesMap[wId]?.[sId] || 0);
      });
      totals[sId] = Math.round(sum * 10) / 10;
    });
    return totals;
  }, [caissesMap, selectedWorkerIds, selectedSerreIds]);

  // Grand Total Général
  const grandTotalCaisses = useMemo(() => {
    let grandTotal = 0;
    Object.values(totalBySerre).forEach((sTotal) => {
      grandTotal += sTotal;
    });
    return Math.round(grandTotal * 10) / 10;
  }, [totalBySerre]);

  // --------------------------------------------------------------------------
  // ENREGISTREMENT ET CONFIRMATION
  // --------------------------------------------------------------------------
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const handleSaveAllRecolte = async () => {
    if (isSubmitting) return;
    setFeedback(null);

    // Préparer les enregistrements uniquement pour les quantités > 0
    const entriesToSave: Array<{
      date: string;
      serre_id: string;
      serre_nom: string;
      ouvrier_id: string;
      numero_ouvrier: number;
      nom_ouvrier: string;
      caisses: number;
      type_operation?: 'RECOLTE' | 'CHARGEMENT' | 'DECHARGEMENT';
      domaine_id?: string | null;
    }> = [];

    selectedWorkersList.forEach((worker) => {
      selectedSerresList.forEach((serre) => {
        const qty = Number(caissesMap[worker.id]?.[serre.id] || 0);
        if (qty > 0) {
          entriesToSave.push({
            date: selectedDate,
            serre_id: serre.id,
            serre_nom: serre.nom,
            ouvrier_id: worker.id,
            numero_ouvrier: worker.numero,
            nom_ouvrier: worker.nom,
            caisses: qty,
            type_operation: operationType,
            domaine_id: 'dom_d2',
          });
        }
      });
    });

    if (entriesToSave.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Veuillez saisir au moins une caisse (> 0) avant d\'enregistrer.',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = onAddRecolte(entriesToSave, {
        id: currentUser.id,
        nom: currentUser.nom,
      });

      if (!res.success) {
        throw new Error(res.error || "Erreur lors de l'enregistrement de la récolte.");
      }

      // Synchronisation réseau automatique si connecté
      let serverOk = false;
      if (onSync && typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const syncRes = await onSync();
          if (syncRes.success) serverOk = true;
        } catch {
          serverOk = false;
        }
      }

      const totalSaved = grandTotalCaisses;
      setFeedback({
        type: 'success',
        text: serverOk
          ? `✓ RÉCOLTE ENREGISTRÉE AVEC SUCCÈS ! (${totalSaved} caisses)`
          : `✓ Enregistré en local (${totalSaved} caisses) — synchronisation dès connexion.`,
      });

      // Réinitialiser la saisie et revenir à l'Étape 1
      setCaissesMap({});
      setSelectedWorkerIds(new Set());
      setStep(1);

      setTimeout(() => {
        setFeedback(null);
      }, 5000);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err.message || 'Erreur lors de la sauvegarde.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // --------------------------------------------------------------------------
  // HISTORIQUE DU JOUR DU CAPORAL (CONSULTATION & CORRECTION)
  // --------------------------------------------------------------------------
  const myDailyRecoltes = useMemo(() => {
    return recoltes
      .filter((r) => {
        if (r.date !== selectedDate) return false;
        if (currentUser.role === 'admin') return true;
        return r.created_by_id === currentUser.id;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [recoltes, selectedDate, currentUser]);

  const myTotals = useMemo(() => {
    const totalCaisses = myDailyRecoltes.reduce((acc, r) => acc + (Number(r.caisses) || 0), 0);
    const distinctWorkers = new Set(myDailyRecoltes.map((r) => r.ouvrier_id)).size;
    const distinctSerres = new Set(myDailyRecoltes.map((r) => r.serre_id)).size;
    return {
      totalCaisses: Math.round(totalCaisses * 10) / 10,
      distinctWorkers,
      distinctSerres,
      countOperations: myDailyRecoltes.length,
    };
  }, [myDailyRecoltes]);

  // Édition / Correction d'une entrée d'historique
  const [editingEntry, setEditingEntry] = useState<RecolteEntry | null>(null);
  const [editCaissesValue, setEditCaissesValue] = useState('');
  const [editSerreIdValue, setEditSerreIdValue] = useState('');

  const handleOpenEditEntry = (entry: RecolteEntry) => {
    if (currentUser.role !== 'admin' && entry.created_by_id !== currentUser.id) {
      alert('Vous ne pouvez modifier que vos propres enregistrements.');
      return;
    }
    setEditingEntry(entry);
    setEditCaissesValue(entry.caisses.toString());
    setEditSerreIdValue(entry.serre_id);
  };

  const handleSaveEditedEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    const parsed = parseFloat(editCaissesValue.replace(',', '.'));
    if (isNaN(parsed) || parsed <= 0) {
      alert('Nombre de caisses invalide (doit être > 0).');
      return;
    }

    const targetSerreObj = activeSerres.find((s) => s.id === editSerreIdValue);

    const res = onUpdateRecolte(
      editingEntry.id,
      {
        caisses: parsed,
        serre_id: editSerreIdValue,
        serre_nom: targetSerreObj?.nom || editingEntry.serre_nom,
      },
      { id: currentUser.id, nom: currentUser.nom }
    );

    if (!res.success) {
      alert(res.error || 'Erreur lors de la modification.');
      return;
    }

    if (onSync) onSync().catch(() => {});

    setEditingEntry(null);
    setFeedback({ type: 'success', text: '✓ Saisie modifiée avec succès.' });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleDeleteEntry = (entry: RecolteEntry) => {
    if (currentUser.role !== 'admin' && entry.created_by_id !== currentUser.id) {
      alert('Vous ne pouvez supprimer que vos propres enregistrements.');
      return;
    }

    if (
      window.confirm(
        `Supprimer la saisie de ${entry.caisses} caisse(s) pour #${entry.numero_ouvrier} ${entry.nom_ouvrier} (${entry.serre_nom}) ?`
      )
    ) {
      onDeleteRecolte(entry.id);
      if (onSync) onSync().catch(() => {});
      setFeedback({ type: 'info', text: 'Saisie supprimée.' });
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleTriggerSync = async () => {
    if (!onSync || syncing) return;
    setSyncing(true);
    try {
      const res = await onSync();
      if (res.success) {
        setFeedback({
          type: 'success',
          text: `✓ Synchronisé (${res.syncedCount} envoyée(s), ${res.receivedCount} reçue(s))`,
        });
      } else {
        setFeedback({ type: 'error', text: res.error || 'Erreur synchronisation' });
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setFeedback(null), 3500);
    }
  };

  return (
    <div className="space-y-3 pb-28 select-none animate-in fade-in">
      {/* ---------------------------------------------------------------- shadow-xs Header Caporal ---------------------------------------------------------------- */}
      <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-lg shadow-sm">
            🌾
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <span>RÉCOLTE</span>
              <span className="text-[10px] text-emerald-950 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full font-bold">
                {currentUser.nom}
              </span>
            </h2>
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 mt-0.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onSelectDate(e.target.value)}
                className="bg-slate-100 border border-slate-300 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600"
              />
            </div>
          </div>
        </div>

        {/* Bouton de Synchronisation */}
        {onSync && (
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={syncing}
            className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold px-3 py-2 rounded-2xl border border-slate-300 transition"
          >
            <Cloud className={`w-4 h-4 text-emerald-600 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Sync...' : 'Sync'}</span>
          </button>
        )}
      </div>

      {/* Messages de retour */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl text-xs font-black flex items-center gap-2.5 shadow-md animate-in fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-600 text-white border border-emerald-700'
              : feedback.type === 'error'
              ? 'bg-red-600 text-white border border-red-700'
              : 'bg-blue-600 text-white border border-blue-700'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-200" />
          ) : feedback.type === 'error' ? (
            <AlertCircle className="w-5 h-5 shrink-0 text-red-200" />
          ) : (
            <Cloud className="w-5 h-5 shrink-0 text-blue-200" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Navigation Principale : Saisie vs Historique */}
      <div className="grid grid-cols-2 gap-1.5 bg-slate-200 p-1.5 rounded-2xl">
        <button
          type="button"
          onClick={() => setMainView('saisie')}
          className={`py-2.5 text-xs font-black rounded-xl transition active:scale-95 flex items-center justify-center gap-1.5 ${
            mainView === 'saisie'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <span>✍️ Nouvelle Saisie</span>
        </button>
        <button
          type="button"
          onClick={() => setMainView('historique')}
          className={`py-2.5 text-xs font-black rounded-xl transition active:scale-95 flex items-center justify-center gap-1.5 ${
            mainView === 'historique'
              ? 'bg-emerald-700 text-white shadow-sm'
              : 'text-slate-700 hover:text-slate-900'
          }`}
        >
          <span>📋 Mes Saisies ({myTotals.totalCaisses} c.)</span>
        </button>
      </div>

      {/* ========================================================================================= */}
      {/* VUE PRINCIPALE 1 : ASSISTANT DE SAISIE EN 3 ÉTAPES                                      */}
      {/* ========================================================================================= */}
      {mainView === 'saisie' && (
        <div className="space-y-3">
          {/* SÉLECTEUR DU TYPE D'OPÉRATION : RÉCOLTE, CHARGEMENT, DÉCHARGEMENT */}
          <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-3 gap-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setOperationType('RECOLTE')}
              className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                operationType === 'RECOLTE'
                  ? 'bg-emerald-600 text-white shadow-xs font-black'
                  : 'text-slate-600 hover:bg-slate-100 font-semibold'
              }`}
            >
              <span>🍇 Récolte</span>
            </button>
            <button
              type="button"
              onClick={() => setOperationType('CHARGEMENT')}
              className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                operationType === 'CHARGEMENT'
                  ? 'bg-blue-600 text-white shadow-xs font-black'
                  : 'text-slate-600 hover:bg-slate-100 font-semibold'
              }`}
            >
              <span>🚚 Chargement</span>
            </button>
            <button
              type="button"
              onClick={() => setOperationType('DECHARGEMENT')}
              className={`py-2 rounded-xl transition flex items-center justify-center gap-1.5 ${
                operationType === 'DECHARGEMENT'
                  ? 'bg-amber-600 text-white shadow-xs font-black'
                  : 'text-slate-600 hover:bg-slate-100 font-semibold'
              }`}
            >
              <span>📦 Déchargement</span>
            </button>
          </div>

          {/* BARRE D'AVANCEMENT EN 3 ÉTAPES CLAIRES */}
          <div className="bg-white rounded-2xl p-2 border border-slate-200 shadow-xs grid grid-cols-3 gap-1 text-center">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`py-2 px-1 rounded-xl transition flex flex-col items-center justify-center ${
                step === 1
                  ? 'bg-emerald-600 text-white shadow-sm font-black'
                  : selectedWorkerIds.size > 0
                  ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200'
                  : 'bg-slate-100 text-slate-500 font-medium'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider block">Étape 1</span>
              <span className="text-xs font-black truncate">1. OUVRIERS ({selectedWorkerIds.size})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (selectedWorkerIds.size > 0) setStep(2);
              }}
              disabled={selectedWorkerIds.size === 0}
              className={`py-2 px-1 rounded-xl transition flex flex-col items-center justify-center ${
                step === 2
                  ? 'bg-emerald-600 text-white shadow-sm font-black'
                  : selectedSerreIds.size > 0 && step === 3
                  ? 'bg-emerald-50 text-emerald-900 font-bold border border-emerald-200'
                  : 'bg-slate-100 text-slate-400 font-medium disabled:opacity-50'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider block">Étape 2</span>
              <span className="text-xs font-black truncate">2. SERRES ({selectedSerreIds.size})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (selectedWorkerIds.size > 0 && selectedSerreIds.size > 0) handleProceedToStep3();
              }}
              disabled={selectedWorkerIds.size === 0 || selectedSerreIds.size === 0}
              className={`py-2 px-1 rounded-xl transition flex flex-col items-center justify-center ${
                step === 3
                  ? 'bg-emerald-600 text-white shadow-sm font-black'
                  : 'bg-slate-100 text-slate-400 font-medium disabled:opacity-50'
              }`}
            >
              <span className="text-[10px] uppercase tracking-wider block">Étape 3</span>
              <span className="text-xs font-black truncate">3. CAISSES</span>
            </button>
          </div>

          {/* ------------------------------------------------------------------------------------- */}
          {/* ÉTAPE 1 : SELECTION DES OUVRIERS PRÉSENTS À LA RÉCOLTE                               */}
          {/* ------------------------------------------------------------------------------------- */}
          {step === 1 && (
            <div className="bg-white rounded-3xl p-3.5 border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div>
                  <h3 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs">
                      1
                    </span>
                    <span>Pointer les ouvriers présents :</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    Cochez uniquement les ouvriers qui récoltent aujourd'hui.
                  </p>
                </div>

                <span className="bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-black px-3 py-1.5 rounded-2xl shrink-0">
                  {selectedWorkerIds.size} sélectionné(s)
                </span>
              </div>

              {/* Barre de Recherche rapide + Boutons Tout Sélectionner / Tout Désélectionner */}
              <div className="space-y-2">
                <div className="relative">
                  <input
                    type="text"
                    value={searchWorkerQuery}
                    onChange={(e) => setSearchWorkerQuery(e.target.value)}
                    placeholder="🔎 Saisissez le n° ou le nom..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-2xl p-3 pl-9 text-xs font-black text-slate-900 outline-none focus:border-emerald-600 focus:bg-white transition"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  {searchWorkerQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchWorkerQuery('')}
                      className="absolute right-3 top-3 text-slate-400 font-black text-xs p-1"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllWorkers}
                    className="flex-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-950 font-black py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <CheckSquare className="w-4 h-4 text-emerald-700" />
                    <span>SÉLECTIONNER TOUS</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAllWorkers}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                  >
                    <Square className="w-4 h-4 text-slate-400" />
                    <span>DÉSÉLECTIONNER</span>
                  </button>
                </div>
              </div>

              {/* LISTE DES OUVRIERS AVEC GROS BOUTONS COCHABLES (48px+ touch target) */}
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {filteredWorkers.length === 0 ? (
                  <p className="text-center text-slate-400 text-xs py-8 font-bold">
                    Aucun ouvrier ne correspond à cette recherche.
                  </p>
                ) : (
                  filteredWorkers.map((worker) => {
                    const isChecked = selectedWorkerIds.has(worker.id);
                    return (
                      <div
                        key={worker.id}
                        onClick={() => handleToggleWorker(worker.id)}
                        className={`w-full p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 active:scale-[0.99] ${
                          isChecked
                            ? 'bg-emerald-600 text-white border-emerald-700 shadow-md'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-900 border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl font-mono font-black text-sm flex items-center justify-center shrink-0 ${
                              isChecked
                                ? 'bg-white text-emerald-900 shadow-xs'
                                : 'bg-emerald-100 text-emerald-950'
                            }`}
                          >
                            #{worker.numero}
                          </div>
                          <div>
                            <p className={`font-black text-sm ${isChecked ? 'text-white' : 'text-slate-900'}`}>
                              {worker.nom}
                            </p>
                            <p className={`text-[11px] font-medium ${isChecked ? 'text-emerald-100' : 'text-slate-500'}`}>
                              Ouvrier #{worker.numero}
                            </p>
                          </div>
                        </div>

                        {/* Gros bouton visuel cocher / décocher */}
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center font-black transition ${
                            isChecked
                              ? 'bg-white text-emerald-700 shadow-xs'
                              : 'border-2 border-slate-300 text-transparent'
                          }`}
                        >
                          ✓
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* BOUTON CONTINUER VERS ÉTAPE 2 */}
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedWorkerIds.size === 0}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white font-black py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg transition active:scale-98 flex items-center justify-center gap-2 mt-2"
              >
                <span>VALIDER LES OUVRIERS ({selectedWorkerIds.size}) ➔</span>
              </button>
            </div>
          )}

          {/* ------------------------------------------------------------------------------------- */}
          {/* ÉTAPE 2 : CHOIX DES SERRES D'EXPLOITATION                                             */}
          {/* ------------------------------------------------------------------------------------- */}
          {step === 2 && (
            <div className="bg-white rounded-3xl p-3.5 border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div>
                  <h3 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                    <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-xs">
                      2
                    </span>
                    <span>Choisir les serres récoltées :</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    Appuyez sur les serres où la récolte a eu lieu aujourd'hui.
                  </p>
                </div>

                <span className="bg-emerald-100 text-emerald-950 border border-emerald-300 text-xs font-black px-3 py-1.5 rounded-2xl shrink-0">
                  {selectedSerreIds.size} serre(s)
                </span>
              </div>

              {/* GRILLE DES SERRES AVEC GROS BOUTONS ÉLÉGANTS */}
              <div className="grid grid-cols-2 gap-2.5">
                {activeSerres.map((serre) => {
                  const isSelected = selectedSerreIds.has(serre.id);
                  return (
                    <button
                      key={serre.id}
                      type="button"
                      onClick={() => handleToggleSerre(serre.id)}
                      className={`p-4 rounded-2xl border-2 font-black text-left transition flex flex-col justify-between gap-2 active:scale-95 ${
                        isSelected
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-md'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-900 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                            isSelected ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {serre.code}
                        </span>
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs ${
                            isSelected ? 'bg-white text-emerald-700' : 'border border-slate-300 text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                      </div>

                      <span className="text-sm font-black truncate">{serre.nom}</span>
                    </button>
                  );
                })}
              </div>

              {/* BOUTONS NAVIGATION RETOUR / VALIDER ET ALLER À L'ÉTAPE 3 */}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 rounded-2xl text-xs transition flex items-center justify-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>RETOUR OUVRIERS</span>
                </button>

                <button
                  type="button"
                  onClick={handleProceedToStep3}
                  disabled={selectedSerreIds.size === 0}
                  className="flex-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black py-3.5 rounded-2xl text-xs uppercase tracking-wider shadow-lg transition active:scale-98 flex items-center justify-center gap-1.5"
                >
                  <span>SAISIR LES CAISSES ➔</span>
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------------------------- */}
          {/* ÉTAPE 3 : SAISIE DES CAISSES (BOUTONS + ET - GÉANTS SANS CLAVIER)                    */}
          {/* ------------------------------------------------------------------------------------- */}
          {step === 3 && (
            <div className="space-y-3">
              {/* SÉLECTEUR DE SERRE SI PLUSIEURS SERRES ONT ÉTÉ CHOISIES */}
              {selectedSerresList.length > 1 && (
                <div className="bg-white rounded-2xl p-2 border border-slate-200 shadow-xs space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block px-1">
                    Afficher la serre :
                  </label>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {selectedSerresList.map((serre) => {
                      const isActive = serre.id === activeSerreForEntry;
                      const sTotal = totalBySerre[serre.id] || 0;
                      return (
                        <button
                          key={serre.id}
                          type="button"
                          onClick={() => setActiveSerreForEntry(serre.id)}
                          className={`px-3 py-2 rounded-xl text-xs font-black shrink-0 transition active:scale-95 flex items-center gap-1.5 ${
                            isActive
                              ? 'bg-emerald-700 text-white shadow-sm'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          }`}
                        >
                          <span>{serre.nom}</span>
                          <span className={`px-1.5 py-0.2 rounded-md font-mono text-[10px] ${
                            isActive ? 'bg-emerald-900 text-emerald-100' : 'bg-slate-200 text-slate-800'
                          }`}>
                            {sTotal} c.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* LISTE DES CARTE OUVRIERS POUR LA SAISIE DES CAISSES */}
              <div className="space-y-2.5">
                {selectedWorkersList.map((worker) => {
                  const currentSerreObj =
                    selectedSerresList.find((s) => s.id === activeSerreForEntry) ||
                    selectedSerresList[0];
                  const currentQty = caissesMap[worker.id]?.[currentSerreObj.id] || 0;
                  const workerTotalAllSerres = totalByWorker[worker.id] || 0;

                  return (
                    <div
                      key={worker.id}
                      className="bg-white rounded-3xl p-3.5 border border-slate-200 shadow-xs space-y-3"
                    >
                      {/* En-tête Carte Ouvrier */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2.5">
                          <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white font-mono font-black text-xs flex items-center justify-center shadow-xs shrink-0">
                            #{worker.numero}
                          </span>
                          <div>
                            <h4 className="font-black text-slate-900 text-sm">{worker.nom}</h4>
                            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              {currentSerreObj.nom}
                            </span>
                          </div>
                        </div>

                        {/* Cumul total pour cet ouvrier si plusieurs serres */}
                        {selectedSerresList.length > 1 && (
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Ouvrier</span>
                            <span className="font-mono font-black text-slate-900 text-xs">
                              {workerTotalAllSerres} c.
                            </span>
                          </div>
                        )}
                      </div>

                      {/* BLOC BOUTONS + ET - GÉANTS SANS CLAVIER (PAVÉ TACTILE D'EXPLOITATION) */}
                      <div className="bg-slate-50 p-2 rounded-2xl border border-slate-200 flex items-center justify-between gap-2">
                        {/* Boutons déduction -1 et -5 */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeltaCaisses(worker.id, currentSerreObj.id, -5)}
                            className="h-12 px-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-black text-xs rounded-xl active:scale-90 transition"
                            title="-5 caisses"
                          >
                            -5
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeltaCaisses(worker.id, currentSerreObj.id, -1)}
                            className="w-12 h-12 bg-red-100 hover:bg-red-200 text-red-700 flex items-center justify-center font-black rounded-xl active:scale-90 transition shadow-xs text-lg"
                            title="-1 caisse"
                          >
                            -
                          </button>
                        </div>

                        {/* Affichage Quantité Centré avec saisie directe possible */}
                        <div className="flex-1 flex flex-col items-center justify-center">
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={currentQty === 0 ? '' : currentQty}
                            placeholder="0"
                            onChange={(e) =>
                              handleSetCaissesDirect(worker.id, currentSerreObj.id, e.target.value)
                            }
                            className="w-20 text-center text-2xl font-black text-emerald-950 bg-white border-2 border-emerald-400 rounded-xl py-1 outline-none focus:ring-2 focus:ring-emerald-500 font-mono shadow-xs"
                          />
                          <span className="text-[10px] font-bold text-slate-500 mt-0.5">CAISSES</span>
                        </div>

                        {/* Boutons ajout +1 et +5 */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeltaCaisses(worker.id, currentSerreObj.id, 1)}
                            className="w-12 h-12 bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center font-black rounded-xl active:scale-90 transition shadow-xs text-lg"
                            title="+1 caisse"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeltaCaisses(worker.id, currentSerreObj.id, 5)}
                            className="h-12 px-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs rounded-xl active:scale-90 transition shadow-xs"
                            title="+5 caisses"
                          >
                            +5
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* RÉCAPITULATIF AUTOMATIQUE DU TOTAL GÉNÉRAL ET BOUTON D'ENREGISTREMENT */}
              <div className="bg-slate-900 text-white rounded-3xl p-4 shadow-xl space-y-3">
                <div className="space-y-1 border-b border-slate-800 pb-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Ouvriers présents :</span>
                    <span className="font-bold text-white font-mono">{selectedWorkersList.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Serres utilisées :</span>
                    <span className="font-bold text-white font-mono">{selectedSerresList.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-1">
                    <span className="text-slate-200 font-bold uppercase">TOTAL GÉNÉRAL :</span>
                    <span className="font-black text-emerald-400 text-xl font-mono">
                      {grandTotalCaisses} CAISSES
                    </span>
                  </div>
                </div>

                {/* GROS BOUTON ENREGISTRER LA RÉCOLTE */}
                <button
                  type="button"
                  onClick={handleSaveAllRecolte}
                  disabled={isSubmitting || grandTotalCaisses <= 0}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 font-black py-4 rounded-2xl text-xs uppercase tracking-wider shadow-lg transition active:scale-98 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <span>Enregistrement en cours...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      <span>ENREGISTRER LA RÉCOLTE ({grandTotalCaisses} c.)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full text-center text-slate-400 hover:text-white text-xs font-bold py-1"
                >
                  ← Revenir au choix des serres
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================================= */}
      {/* VUE PRINCIPALE 2 : HISTORIQUE ET CONSULTATION DES SAISIES DU JOUR                         */}
      {/* ========================================================================================= */}
      {mainView === 'historique' && (
        <div className="space-y-3">
          {/* Métriques synthétiques du jour */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-2.5 text-center shadow-2xs">
              <span className="text-[10px] text-emerald-700 font-bold uppercase block truncate">
                Total Caisses
              </span>
              <span className="text-lg font-black text-emerald-950 font-mono">
                {myTotals.totalCaisses}
              </span>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-2.5 text-center shadow-2xs">
              <span className="text-[10px] text-blue-700 font-bold uppercase block truncate">
                Ouvriers
              </span>
              <span className="text-lg font-black text-blue-950 font-mono">
                {myTotals.distinctWorkers}
              </span>
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-2xl p-2.5 text-center shadow-2xs">
              <span className="text-[10px] text-purple-700 font-bold uppercase block truncate">
                Serres
              </span>
              <span className="text-lg font-black text-purple-950 font-mono">
                {myTotals.distinctSerres}
              </span>
            </div>
          </div>

          {/* Liste des saisies de la journée */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-500" />
                <span>Mes enregistrements d'aujourd'hui :</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-bold">
                {myDailyRecoltes.length} saisie(s)
              </span>
            </div>

            {myDailyRecoltes.length === 0 ? (
              <div className="p-8 text-center space-y-1.5">
                <span className="text-3xl block">🌾</span>
                <p className="text-xs text-slate-700 font-black">Aucune récolte enregistrée aujourd'hui</p>
                <p className="text-[11px] text-slate-400">
                  Utilisez l'onglet "Nouvelle Saisie" pour enregistrer la récolte des ouvriers.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {myDailyRecoltes.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50 transition text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] text-slate-400 font-mono shrink-0 font-bold">
                        {new Date(entry.created_at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-950 font-mono font-black text-xs flex items-center justify-center shrink-0">
                        #{entry.numero_ouvrier}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-black text-slate-900 truncate">{entry.nom_ouvrier}</p>
                          {entry.type_operation === 'CHARGEMENT' ? (
                            <span className="text-[9px] font-black bg-blue-100 text-blue-900 border border-blue-200 px-1.5 py-0.2 rounded-md">
                              🚚 Chargement
                            </span>
                          ) : entry.type_operation === 'DECHARGEMENT' ? (
                            <span className="text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-200 px-1.5 py-0.2 rounded-md">
                              📦 Déchargement
                            </span>
                          ) : (
                            <span className="text-[9px] font-black bg-emerald-100 text-emerald-900 border border-emerald-200 px-1.5 py-0.2 rounded-md">
                              🍇 Récolte
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate font-medium">
                          {entry.serre_nom}
                          {entry.notes ? ` • "${entry.notes}"` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-black text-emerald-950 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl font-mono">
                        {entry.caisses} c.
                      </span>

                      <button
                        type="button"
                        onClick={() => handleOpenEditEntry(entry)}
                        className="p-2 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition"
                        title="Corriger"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeleteEntry(entry)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODALE DE CORRECTION D'UNE SAISIE D'HISTORIQUE */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xs w-full p-4 shadow-2xl space-y-3 border border-slate-200 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="font-black text-slate-900 text-xs">Corriger la quantite</h4>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-700 font-medium">
              <p>
                Ouvrier :{' '}
                <strong>
                  #{editingEntry.numero_ouvrier} {editingEntry.nom_ouvrier}
                </strong>
              </p>
            </div>

            <form onSubmit={handleSaveEditedEntry} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Serre :
                </label>
                <select
                  value={editSerreIdValue}
                  onChange={(e) => setEditSerreIdValue(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-black text-slate-900 outline-none focus:border-emerald-600"
                >
                  {activeSerres.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Nombre de caisses :
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={editCaissesValue}
                  onChange={(e) => setEditCaissesValue(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-black text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingEntry(null)}
                  className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl font-bold text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl font-black text-xs shadow-xs"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
