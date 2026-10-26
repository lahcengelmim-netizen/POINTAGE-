/**
 * Module Récolte dédié au Caporal (et accessible par l'administrateur)
 * Interface mobile optimisée à une seule main :
 * 1. Sélection Date & Serre
 * 2. Recherche rapide et sélection des ouvriers
 * 3. Saisie du nombre de caisses par ouvrier avec validation stricte (> 0)
 * 4. Synthèse journalière par serre et pour la journée
 * 5. Correction et modification de ses propres saisies
 */

import React, { useState, useMemo } from 'react';
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
  CloudOff,
  Filter,
  Layers,
  Sparkles,
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
    }>,
    author: { id: string; nom: string }
  ) => { success: boolean; error?: string; count: number; added: RecolteEntry[] };
  onUpdateRecolte: (
    id: string,
    partial: { caisses?: number; notes?: string; date?: string; serre_id?: string; serre_nom?: string },
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
  // Onglet actif : 'saisie' ou 'synthese'
  const [activeTab, setActiveTab] = useState<'saisie' | 'synthese'>('saisie');

  // Sélection de la serre pour la saisie
  const activeSerres = useMemo(() => serres.filter((s) => s.actif), [serres]);
  const [selectedSerreId, setSelectedSerreId] = useState<string>(() => {
    return activeSerres[0]?.id || 'serre_1';
  });

  // Recherche d'ouvriers
  const [searchQuery, setSearchQuery] = useState('');

  // Ouvriers sélectionnés et leurs caisses : Map<ouvrierId, { caisses: number; notes: string }>
  const [selectedWorkersMap, setSelectedWorkersMap] = useState<
    Map<string, { caisses: number; notes: string }>
  >(new Map());

  // Message d'erreur et de succès
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Édition d'une entrée existante
  const [editingEntry, setEditingEntry] = useState<RecolteEntry | null>(null);
  const [editCaissesInput, setEditCaissesInput] = useState('');
  const [editNotesInput, setEditNotesInput] = useState('');

  // Filtre pour la synthèse
  const [syntheseSerreFilter, setSyntheseSerreFilter] = useState<string>('all');

  // Serre sélectionnée courante
  const currentSerre = useMemo(() => {
    return serres.find((s) => s.id === selectedSerreId) || serres[0] || {
      id: 'serre_1',
      code: 'S01',
      nom: 'Serre 1',
      actif: true,
      ordre: 1,
    };
  }, [serres, selectedSerreId]);

  // Filtrage des ouvriers selon la recherche
  const filteredOuvriers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeOuvriers;
    return activeOuvriers.filter(
      (o) => o.numero.toString().includes(q) || o.nom.toLowerCase().includes(q)
    );
  }, [activeOuvriers, searchQuery]);

  // Gestion de la sélection / désélection d'un ouvrier
  const handleToggleWorker = (worker: Ouvrier) => {
    const nextMap = new Map(selectedWorkersMap);
    if (nextMap.has(worker.id)) {
      nextMap.delete(worker.id);
    } else {
      nextMap.set(worker.id, { caisses: 1, notes: '' });
    }
    setSelectedWorkersMap(nextMap);
  };

  // Modification du nombre de caisses d'un ouvrier
  const handleChangeCaisses = (workerId: string, delta: number) => {
    const current = selectedWorkersMap.get(workerId);
    if (!current) return;
    const newQty = Math.max(0.5, Math.round((current.caisses + delta) * 10) / 10);
    const nextMap = new Map(selectedWorkersMap);
    nextMap.set(workerId, { ...current, caisses: newQty });
    setSelectedWorkersMap(nextMap);
  };

  const handleSetCaissesDirect = (workerId: string, valStr: string) => {
    const parsed = parseFloat(valStr.replace(',', '.'));
    const nextMap = new Map(selectedWorkersMap);
    const current = nextMap.get(workerId) || { caisses: 1, notes: '' };
    nextMap.set(workerId, { ...current, caisses: isNaN(parsed) ? 0 : parsed });
    setSelectedWorkersMap(nextMap);
  };

  // Validation et enregistrement de la session de récolte
  const handleSaveRecolte = () => {
    setMessage(null);

    if (selectedWorkersMap.size === 0) {
      setMessage({
        type: 'error',
        text: 'Veuillez sélectionner au moins un ouvrier pour cette serre.',
      });
      return;
    }

    const entriesToSave: Array<{
      date: string;
      serre_id: string;
      serre_nom: string;
      ouvrier_id: string;
      numero_ouvrier: number;
      nom_ouvrier: string;
      caisses: number;
      notes?: string;
    }> = [];

    for (const [workerId, data] of selectedWorkersMap.entries()) {
      const worker = activeOuvriers.find((o) => o.id === workerId);
      if (!worker) continue;

      if (!data.caisses || data.caisses <= 0) {
        setMessage({
          type: 'error',
          text: `Quantité invalide pour l'ouvrier #${worker.numero} ${worker.nom}. Veuillez entrer un nombre supérieur à 0.`,
        });
        return;
      }

      entriesToSave.push({
        date: selectedDate,
        serre_id: currentSerre.id,
        serre_nom: currentSerre.nom,
        ouvrier_id: worker.id,
        numero_ouvrier: worker.numero,
        nom_ouvrier: worker.nom,
        caisses: data.caisses,
        notes: data.notes,
      });
    }

    const res = onAddRecolte(entriesToSave, {
      id: currentUser.id,
      nom: currentUser.nom,
    });

    if (!res.success) {
      setMessage({ type: 'error', text: res.error || 'Erreur lors de l’enregistrement.' });
      return;
    }

    // Réinitialiser la sélection et basculer sur la synthèse
    setSelectedWorkersMap(new Map());
    setSearchQuery('');
    setMessage({
      type: 'success',
      text: `✓ ${res.count} enregistrement(s) sauvegardé(s) pour la ${currentSerre.nom} !`,
    });
    setActiveTab('synthese');
    setTimeout(() => setMessage(null), 4000);
  };

  // Récoltes du jour filtrées
  const dailyRecoltes = useMemo(() => {
    let list = recoltes.filter((r) => r.date === selectedDate);
    if (syntheseSerreFilter !== 'all') {
      list = list.filter((r) => r.serre_id === syntheseSerreFilter);
    }
    return list;
  }, [recoltes, selectedDate, syntheseSerreFilter]);

  // Totaux calculés
  const dailyTotals = useMemo(() => {
    const allForDay = recoltes.filter((r) => r.date === selectedDate);
    const totalCaissesDay = allForDay.reduce((acc, r) => acc + (r.caisses || 0), 0);
    const distinctWorkersDay = new Set(allForDay.map((r) => r.ouvrier_id)).size;

    const filteredCaisses = dailyRecoltes.reduce((acc, r) => acc + (r.caisses || 0), 0);
    const filteredWorkers = new Set(dailyRecoltes.map((r) => r.ouvrier_id)).size;

    return {
      totalCaissesDay: Math.round(totalCaissesDay * 10) / 10,
      distinctWorkersDay,
      filteredCaisses: Math.round(filteredCaisses * 10) / 10,
      filteredWorkers,
    };
  }, [recoltes, selectedDate, dailyRecoltes]);

  // Sauvegarder modification
  const handleConfirmEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry) return;

    const parsedCaisses = parseFloat(editCaissesInput.replace(',', '.'));
    if (isNaN(parsedCaisses) || parsedCaisses <= 0) {
      alert('Veuillez saisir un nombre de caisses valide et supérieur à 0.');
      return;
    }

    const res = onUpdateRecolte(
      editingEntry.id,
      {
        caisses: parsedCaisses,
        notes: editNotesInput,
      },
      { id: currentUser.id, nom: currentUser.nom }
    );

    if (!res.success) {
      alert(res.error || 'Erreur lors de la modification.');
      return;
    }

    setEditingEntry(null);
    setMessage({ type: 'success', text: '✓ Saisie de récolte mise à jour avec succès.' });
    setTimeout(() => setMessage(null), 3000);
  };

  // Supprimer une entrée
  const handleDeleteEntry = (entry: RecolteEntry) => {
    if (
      window.confirm(
        `Supprimer la saisie de ${entry.caisses} caisse(s) pour ${entry.nom_ouvrier} (${entry.serre_nom}) ?`
      )
    ) {
      onDeleteRecolte(entry.id);
      setMessage({ type: 'success', text: 'Saisie supprimée.' });
      setTimeout(() => setMessage(null), 2500);
    }
  };

  const handleTriggerSync = async () => {
    if (!onSync) return;
    setSyncing(true);
    try {
      const res = await onSync();
      if (res.success) {
        setMessage({
          type: 'success',
          text: `✓ Synchronisé : ${res.syncedCount} envoyée(s), ${res.receivedCount} reçue(s).`,
        });
      } else {
        setMessage({ type: 'error', text: res.error || 'Erreur synchronisation' });
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setMessage(null), 3500);
    }
  };

  return (
    <div className="space-y-3 pb-24 animate-in fade-in">
      {/* Barre d'en-tête Récolte avec sélecteur de Date et statut de synchronisation */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black">
            🌾
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <span>Gestion Récolte</span>
              <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full font-bold">
                {currentUser.nom}
              </span>
            </h2>
            <p className="text-[10px] text-slate-500">Saisie des caisses par serre</p>
          </div>
        </div>

        {/* Bouton de synchronisation réseau */}
        {onSync && (
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={syncing}
            className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold px-2 py-1.5 rounded-xl transition"
            title="Synchroniser avec le serveur"
          >
            {syncing ? (
              <span className="animate-spin">⏳</span>
            ) : (
              <Cloud className="w-3.5 h-3.5 text-blue-600" />
            )}
            <span>Sync</span>
          </button>
        )}
      </div>

      {/* Messages de retour */}
      {message && (
        <div
          className={`p-3 rounded-2xl text-xs font-black flex items-center gap-2 transition animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
              : 'bg-red-50 border border-red-300 text-red-950'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Onglets navigation interne : Saisie vs Synthèse */}
      <div className="grid grid-cols-2 gap-1 bg-slate-200/80 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setActiveTab('saisie')}
          className={`py-2 text-xs font-black rounded-xl transition active:scale-98 ${
            activeTab === 'saisie'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          ✍️ Nouvelle Saisie
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('synthese')}
          className={`py-2 text-xs font-black rounded-xl transition active:scale-98 relative ${
            activeTab === 'synthese'
              ? 'bg-white text-emerald-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          📊 Synthèse ({dailyTotals.totalCaissesDay} caisses)
        </button>
      </div>

      {/* ===================== ONGLET 1 : SAISIE ===================== */}
      {activeTab === 'saisie' && (
        <div className="space-y-3">
          {/* Sélection Date et Serre */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Date de récolte :
                </label>
                <div className="relative">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => onSelectDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600"
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Serre récoltée :
                </label>
                <select
                  value={selectedSerreId}
                  onChange={(e) => setSelectedSerreId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-black text-slate-900 outline-none focus:border-emerald-600"
                >
                  {activeSerres.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Pastille récapitulative de la serre */}
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-2 flex items-center justify-between text-xs text-emerald-900 font-bold">
              <span>Serre active : {currentSerre.nom}</span>
              <span className="text-[11px] text-emerald-700 font-mono">
                {selectedWorkersMap.size} ouvrier(s) sélectionné(s)
              </span>
            </div>
          </div>

          {/* Recherche rapide d'ouvriers */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2.5">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par n° ou nom d'ouvrier..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 pl-8 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-3" />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 text-xs font-bold p-0.5"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Liste des ouvriers */}
            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
              {filteredOuvriers.length === 0 ? (
                <p className="text-center text-slate-400 text-xs py-4 font-medium">
                  Aucun ouvrier trouvé.
                </p>
              ) : (
                filteredOuvriers.map((worker) => {
                  const isSelected = selectedWorkersMap.has(worker.id);
                  const entryData = selectedWorkersMap.get(worker.id);

                  return (
                    <div
                      key={worker.id}
                      className={`p-2 rounded-xl border transition flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-emerald-50/90 border-emerald-400 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Case à cocher et identité */}
                      <div
                        onClick={() => handleToggleWorker(worker)}
                        className="flex items-center gap-2 flex-1 cursor-pointer select-none"
                      >
                        <div
                          className={`w-5 h-5 rounded-lg border flex items-center justify-center transition shrink-0 ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>
                        <div>
                          <span className="font-mono font-black text-xs text-emerald-900 mr-1.5">
                            #{worker.numero}
                          </span>
                          <span className="font-bold text-slate-800 text-xs">
                            {worker.nom}
                          </span>
                        </div>
                      </div>

                      {/* Contrôle de quantité si sélectionné */}
                      {isSelected && entryData && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleChangeCaisses(worker.id, -1)}
                            className="w-7 h-7 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-center text-slate-700 font-black active:scale-90"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={entryData.caisses || ''}
                            onChange={(e) => handleSetCaissesDirect(worker.id, e.target.value)}
                            className="w-12 text-center bg-white border border-emerald-400 rounded-lg p-1 text-xs font-black text-emerald-950 outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleChangeCaisses(worker.id, 1)}
                            className="w-7 h-7 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center justify-center font-black active:scale-90 shadow-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Récapitulatif sélection & Validation finale */}
          {selectedWorkersMap.size > 0 && (
            <div className="bg-slate-900 text-white rounded-2xl p-3 shadow-lg space-y-2.5 animate-in slide-in-from-bottom-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  {selectedWorkersMap.size} ouvrier(s) sélectionné(s) :
                </span>
                <span className="font-black text-emerald-400 text-sm">
                  {Array.from(selectedWorkersMap.values()).reduce(
                    (acc, item) => acc + (item.caisses || 0),
                    0
                  )}{' '}
                  caisses
                </span>
              </div>

              <button
                type="button"
                onClick={handleSaveRecolte}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider shadow-md transition active:scale-98 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Enregistrer la récolte ({currentSerre.nom})</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================== ONGLET 2 : SYNTHÈSE DU JOUR ===================== */}
      {activeTab === 'synthese' && (
        <div className="space-y-3">
          {/* Cartes de totaux */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center shadow-2xs">
              <span className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider block">
                Total Journée
              </span>
              <span className="text-xl font-black text-emerald-950">
                {dailyTotals.totalCaissesDay}
              </span>
              <span className="text-[10px] text-emerald-700 block">
                caisses ({dailyTotals.distinctWorkersDay} ouvriers)
              </span>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 text-center shadow-2xs">
              <span className="text-[10px] text-blue-700 font-bold uppercase tracking-wider block">
                Filtre sélectionné
              </span>
              <span className="text-xl font-black text-blue-950">
                {dailyTotals.filteredCaisses}
              </span>
              <span className="text-[10px] text-blue-700 block">
                caisses ({dailyTotals.filteredWorkers} ouvriers)
              </span>
            </div>
          </div>

          {/* Filtres de la synthèse */}
          <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Changer la date :
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => onSelectDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Filtrer par serre :
                </label>
                <select
                  value={syntheseSerreFilter}
                  onChange={(e) => setSyntheseSerreFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 outline-none"
                >
                  <option value="all">Toutes les serres</option>
                  {serres.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nom} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Liste détaillée des saisies */}
          <div className="space-y-2">
            <h3 className="font-bold text-slate-800 text-xs px-1 flex items-center justify-between">
              <span>Saisies de récolte ({dailyRecoltes.length}) :</span>
              <span className="text-[10px] text-slate-500 font-normal">
                Modifiables par l'auteur
              </span>
            </h3>

            {dailyRecoltes.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 text-center border border-slate-200 space-y-1">
                <span className="text-2xl block">🌾</span>
                <p className="text-xs text-slate-600 font-bold">Aucune récolte enregistrée</p>
                <p className="text-[11px] text-slate-400">
                  Passez sur l'onglet "Nouvelle Saisie" pour enregistrer les caisses de cette journée.
                </p>
              </div>
            ) : (
              dailyRecoltes.map((entry) => {
                const isOwnRecord =
                  entry.created_by_id === currentUser.id || currentUser.role === 'admin';

                return (
                  <div
                    key={entry.id}
                    className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="bg-emerald-100 text-emerald-900 font-black text-xs px-2 py-0.5 rounded-lg font-mono">
                          #{entry.numero_ouvrier}
                        </span>
                        <div>
                          <p className="font-black text-slate-900 text-xs">{entry.nom_ouvrier}</p>
                          <p className="text-[10px] text-slate-500">
                            {entry.serre_nom} • Saisie par {entry.created_by_nom}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl">
                          {entry.caisses} caisses
                        </span>

                        {isOwnRecord && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEntry(entry);
                                setEditCaissesInput(entry.caisses.toString());
                                setEditNotesInput(entry.notes || '');
                              }}
                              className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition"
                              title="Corriger"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteEntry(entry)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="Supprimer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {entry.notes && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded-lg font-medium italic">
                        "{entry.notes}"
                      </p>
                    )}

                    <div className="flex items-center justify-between text-[9px] text-slate-400 pt-1 border-t border-slate-100 font-mono">
                      <span>
                        {new Date(entry.created_at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {entry.updated_at && ' (modifié)'}
                      </span>
                      <span>
                        {entry.sync_status === 'synced' ? '☁️ Synchronisé' : '🕒 En attente'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Modale de modification d'une saisie */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xs w-full p-4 shadow-2xl space-y-3 border border-slate-200 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="font-black text-slate-900 text-xs">Corriger la saisie</h4>
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
                Ouvrier : <strong>#{editingEntry.numero_ouvrier} {editingEntry.nom_ouvrier}</strong>
              </p>
              <p className="text-[11px] text-slate-500">Serre : {editingEntry.serre_nom}</p>
            </div>

            <form onSubmit={handleConfirmEdit} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Nombre de caisses :
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={editCaissesInput}
                  onChange={(e) => setEditCaissesInput(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-black text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Remarque (optionnelle) :
                </label>
                <input
                  type="text"
                  value={editNotesInput}
                  onChange={(e) => setEditNotesInput(e.target.value)}
                  placeholder="ex: Bonne qualité"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-medium text-slate-900 outline-none focus:border-emerald-600"
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
