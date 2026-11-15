/**
 * Modal d'affectation de tâche (sans sélection de serre).
 * L'affectation des serres se fait exclusivement dans l'écran TÂCHES.
 */

import React, { useState, useEffect } from 'react';
import { Check, X, Search, MapPin, Plus, Trash2, AlertCircle } from 'lucide-react';
import { Ouvrier, Tache, Domaine, AffectationTache } from '../types';
import { formatTacheLabel } from '../utils/tacheUtils';

interface TaskModalProps {
  isOpen: boolean;
  ouvrier: Ouvrier | null;
  taches: Tache[];
  domaines?: Domaine[];
  existingAffectations?: AffectationTache[];
  currentTacheId?: string | null;
  currentDomaineId?: string | null;
  defaultDomaineId?: string;
  onSelectTask: (
    tacheId: string | null,
    domaineId: string,
    serreId?: string | null,
    serreNom?: string | null,
    options?: { keepOpen?: boolean }
  ) => { success: boolean; error?: string } | void;
  onRemoveAffectation?: (affectationId: string) => void;
  onCancelPointage?: () => void;
  onClose?: () => void;
  isEditMode?: boolean;
  editingAffectationId?: string | null;
  allowMultiTask?: boolean;
}

function normalizeText(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  ouvrier,
  taches,
  domaines = [],
  existingAffectations = [],
  currentTacheId = null,
  currentDomaineId = null,
  defaultDomaineId = 'dom_d2',
  onSelectTask,
  onRemoveAffectation,
  onCancelPointage,
  onClose,
  isEditMode = false,
  editingAffectationId = null,
  allowMultiTask = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(currentTacheId ?? null);
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>(
    currentDomaineId || defaultDomaineId
  );
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedTaskId(currentTacheId ?? null);
      setSelectedDomaineId(currentDomaineId || defaultDomaineId);
      setModalFeedback(null);
    }
  }, [isOpen, currentTacheId, currentDomaineId, defaultDomaineId, ouvrier, editingAffectationId]);

  if (!isOpen || !ouvrier) return null;

  const availableTasks = taches.filter((t) => {
    if (t.actif === false) return false;
    if (t.ouvriers_autorises === 'tous') return true;
    return Array.isArray(t.ouvriers_autorises) && t.ouvriers_autorises.includes(ouvrier.id);
  });

  const cleanQuery = normalizeText(searchQuery);
  const filteredTasks = availableTasks.filter((t) => {
    if (!cleanQuery) return true;
    const matchNom = normalizeText(t.nom).includes(cleanQuery);
    const matchCode = t.code ? normalizeText(t.code).includes(cleanQuery) : false;
    const matchLabel = t.code ? normalizeText(`${t.code} - ${t.nom}`).includes(cleanQuery) : false;
    return matchNom || matchCode || matchLabel;
  });

  const selectedTaskObj = taches.find((t) => t.id === selectedTaskId);
  const currentDomaineObj = domaines.find((d) => d.id === selectedDomaineId);
  const tacheMap = new Map(taches.map((t) => [t.id, t]));
  const domaineMap = new Map(domaines.map((d) => [d.id, d]));

  const canSaveTask = Boolean(selectedTaskId);

  const handleSave = (keepOpen: boolean) => {
    if (!selectedTaskId) return;

    const res = onSelectTask(
      selectedTaskId,
      selectedDomaineId,
      null,
      null,
      { keepOpen }
    );

    if (res && res.success === false) {
      setModalFeedback({
        type: 'error',
        text: res.error || "Impossible d'enregistrer cette tâche.",
      });
      return;
    }

    if (keepOpen) {
      const taskLabel = selectedTaskObj ? formatTacheLabel(selectedTaskObj) : 'Tâche';
      setSelectedTaskId(null);
      setSearchQuery('');
      setModalFeedback({
        type: 'success',
        text: `✓ ${taskLabel} ajoutée ! Choisissez une autre tâche ou fermez.`,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canSaveTask) {
        handleSave(false);
      } else if (!selectedTaskId && filteredTasks.length === 1) {
        setSelectedTaskId(filteredTasks[0].id);
        setModalFeedback(null);
      }
    }
  };

  const handleCloseModal = () => {
    if (onClose) {
      onClose();
    } else if (isEditMode) {
      onSelectTask(currentTacheId, selectedDomaineId, null, null);
    } else if (onCancelPointage) {
      onCancelPointage();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[94vh]">
        {/* En-tête de la modale */}
        <div className="bg-emerald-700 text-white p-3.5 text-center relative shrink-0">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-white text-emerald-800 text-xl font-black shadow-md mb-1">
            #{ouvrier.numero}
          </div>
          <h2 className="text-lg font-bold tracking-tight leading-tight">{ouvrier.nom}</h2>
          <p className="text-emerald-100 text-[11px] mt-0.5">
            {editingAffectationId
              ? 'Modifier la tâche'
              : isEditMode
              ? 'Affecter une tâche'
              : '✓ Présence enregistrée • Choisir une tâche'}
          </p>

          {(onClose || isEditMode) && (
            <button
              type="button"
              onClick={handleCloseModal}
              className="absolute top-3.5 right-3.5 text-emerald-200 hover:text-white p-1 rounded-full cursor-pointer"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* SÉLECTEUR DE DOMAINE ACTIF */}
        {domaines.length > 0 && (
          <div className="p-2.5 bg-slate-100 border-b border-slate-200 shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-0.5 text-xs font-black">
              <span className="text-slate-600 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <span>Domaine actif :</span>
              </span>
              <span className="text-emerald-800 bg-white px-2 py-0.5 rounded-md border border-slate-200 shadow-2xs">
                {currentDomaineObj ? currentDomaineObj.nom : 'D2'}
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {domaines.map((d) => {
                const isDomSelected = selectedDomaineId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      setSelectedDomaineId(d.id);
                      setModalFeedback(null);
                    }}
                    className={`h-9 rounded-xl font-black text-xs flex items-center justify-center transition active:scale-95 border-2 cursor-pointer ${
                      isDomSelected
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-300'
                        : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
                    }`}
                  >
                    {d.nom}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tâches déjà affectées à cet ouvrier aujourd'hui */}
        {!editingAffectationId && existingAffectations.length > 0 && (
          <div className="px-3 py-2 bg-emerald-50/70 border-b border-emerald-200 shrink-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-900 mb-1.5">
              Tâches enregistrées aujourd'hui ({existingAffectations.length}) :
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              {existingAffectations.map((aff) => {
                const t = tacheMap.get(aff.tache_id);
                const d = aff.domaine_id ? domaineMap.get(aff.domaine_id) : null;
                return (
                  <div
                    key={aff.id}
                    className="inline-flex items-center gap-1.5 bg-white border border-emerald-300 rounded-xl px-2 py-1 text-[11px] font-bold text-slate-800 shadow-2xs"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: t?.couleur || '#16a34a' }}
                    />
                    <span className="font-black">{t ? formatTacheLabel(t) : aff.tache_id}</span>
                    {aff.serre_nom && (
                      <span className="bg-emerald-100 text-emerald-900 px-1.5 py-0.2 rounded-md text-[10px] font-black">
                        {aff.serre_nom}
                      </span>
                    )}
                    {d && (
                      <span className="text-[10px] text-slate-500 font-bold">({d.nom})</span>
                    )}
                    {onRemoveAffectation && (
                      <button
                        type="button"
                        onClick={() => onRemoveAffectation(aff.id)}
                        className="text-slate-400 hover:text-red-600 p-0.5 cursor-pointer"
                        title="Retirer cette tâche"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Retour visuel erreur ou succès inline */}
        {modalFeedback && (
          <div
            className={`mx-3 mt-2 p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 ${
              modalFeedback.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-emerald-50 text-emerald-900 border border-emerald-300'
            }`}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{modalFeedback.text}</span>
          </div>
        )}

        {/* Corps scrollable : Sélection d'une tâche uniquement */}
        <div className="p-3 space-y-3 overflow-y-auto flex-1">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                Sélectionner une tâche
              </span>
              {selectedTaskObj && (
                <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  {formatTacheLabel(selectedTaskObj)}
                </span>
              )}
            </div>

            <div className="relative mb-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Rechercher une tâche..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-8 py-2 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  title="Effacer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {filteredTasks.length === 0 ? (
              <div className="py-5 text-center text-slate-500 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-3">
                <p className="font-bold text-xs text-slate-700">Aucune tâche trouvée</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                {filteredTasks.map((tache) => {
                  const isSelected = selectedTaskId === tache.id;
                  return (
                    <button
                      key={tache.id}
                      type="button"
                      onClick={() => {
                        setSelectedTaskId(tache.id);
                        setModalFeedback(null);
                      }}
                      className={`w-full h-11 px-3.5 rounded-xl font-black text-xs flex items-center justify-between transition-all active:scale-[0.99] border-2 text-left cursor-pointer ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400'
                          : 'border-slate-200 hover:border-emerald-500 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0"
                          style={{ backgroundColor: tache.couleur || '#16a34a' }}
                        />
                        <span className="tracking-wide uppercase truncate font-black">
                          {formatTacheLabel(tache)}
                        </span>
                      </div>

                      {isSelected ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-semibold shrink-0">Choisir</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Boutons d'action */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
          <button
            type="button"
            disabled={!canSaveTask}
            onClick={() => handleSave(false)}
            className={`w-full h-11 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition active:scale-[0.98] ${
              canSaveTask
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md cursor-pointer'
                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {selectedTaskObj
                ? `Enregistrer : ${formatTacheLabel(selectedTaskObj)}`
                : 'Sélectionnez une tâche'}
            </span>
          </button>

          {allowMultiTask && !editingAffectationId && (
            <button
              type="button"
              disabled={!canSaveTask}
              onClick={() => handleSave(true)}
              className={`w-full h-10 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 border-2 transition active:scale-[0.98] ${
                canSaveTask
                  ? 'bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-500 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
              }`}
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Enregistrer + Ajouter autre tâche</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            {existingAffectations.length > 0 || isEditMode ? (
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 h-10 rounded-2xl font-bold text-xs flex items-center justify-center border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 transition cursor-pointer"
              >
                Fermer
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSelectTask(null, selectedDomaineId, null, null, { keepOpen: false })}
                className="flex-1 h-10 rounded-2xl font-bold text-xs flex items-center justify-center border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 transition cursor-pointer"
              >
                Passer sans tâche ({currentDomaineObj?.nom || 'D2'})
              </button>
            )}

            {onCancelPointage && !isEditMode && existingAffectations.length === 0 && (
              <button
                type="button"
                onClick={onCancelPointage}
                className="px-3 h-10 rounded-2xl text-red-600 hover:bg-red-50 border border-red-200 text-xs font-bold transition cursor-pointer"
              >
                Annuler pointage
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
