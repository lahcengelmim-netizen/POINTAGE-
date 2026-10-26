/**
 * Modal d'affectation de tâche et de domaine après la validation d'un pointage
 * Comprend :
 * 1. Sélecteur de domaine du jour (boutons D1 à D5, pré-sélectionné sur D2)
 * 2. Champ de recherche de tâche en temps réel (insensible casse/accents)
 * 3. Bouton pour valider la tâche choisie
 * 4. Bouton pour passer sans tâche
 */

import React, { useState, useEffect } from 'react';
import { Check, X, Search, MapPin } from 'lucide-react';
import { Ouvrier, Tache, Domaine } from '../types';
import { formatTacheLabel } from '../utils/tacheUtils';

interface TaskModalProps {
  isOpen: boolean;
  ouvrier: Ouvrier | null;
  taches: Tache[];
  domaines?: Domaine[];
  currentTacheId?: string | null;
  currentDomaineId?: string | null;
  defaultDomaineId?: string;
  onSelectTask: (tacheId: string | null, domaineId: string) => void;
  onCancelPointage?: () => void;
  isEditMode?: boolean;
}

/**
 * Normalise une chaîne pour une recherche insensible à la casse et aux accents
 */
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
  currentTacheId = null,
  currentDomaineId = null,
  defaultDomaineId = 'dom_d2',
  onSelectTask,
  onCancelPointage,
  isEditMode = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(currentTacheId ?? null);
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>(
    currentDomaineId || defaultDomaineId
  );

  // Réinitialiser la recherche, la tâche et le domaine à chaque ouverture
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedTaskId(currentTacheId ?? null);
      setSelectedDomaineId(currentDomaineId || defaultDomaineId);
    }
  }, [isOpen, currentTacheId, currentDomaineId, defaultDomaineId, ouvrier]);

  if (!isOpen || !ouvrier) return null;

  // Filtrer les tâches autorisées pour cet ouvrier
  const availableTasks = taches.filter((t) => {
    if (t.ouvriers_autorises === 'tous') return true;
    return Array.isArray(t.ouvriers_autorises) && t.ouvriers_autorises.includes(ouvrier.id);
  });

  // Filtrage en temps réel à chaque lettre saisie (cherche dans le nom, le code ou "CODE - NOM")
  const cleanQuery = normalizeText(searchQuery);
  const filteredTasks = availableTasks.filter((t) => {
    if (!cleanQuery) return true;
    const matchNom = normalizeText(t.nom).includes(cleanQuery);
    const matchCode = t.code ? normalizeText(t.code).includes(cleanQuery) : false;
    const matchLabel = t.code ? normalizeText(`${t.code} - ${t.nom}`).includes(cleanQuery) : false;
    return matchNom || matchCode || matchLabel;
  });

  // Tâche actuellement sélectionnée
  const selectedTaskObj = taches.find((t) => t.id === selectedTaskId);
  // Domaine actuellement sélectionné
  const currentDomaineObj = domaines.find((d) => d.id === selectedDomaineId);

  // Soumission au clavier (Enter)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedTaskId) {
        onSelectTask(selectedTaskId, selectedDomaineId);
      } else if (filteredTasks.length === 1) {
        onSelectTask(filteredTasks[0].id, selectedDomaineId);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden border border-slate-200 flex flex-col max-h-[92vh]">
        {/* En-tête de la modale */}
        <div className="bg-emerald-700 text-white p-4 text-center relative shrink-0">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white text-emerald-800 text-2xl font-black shadow-md mb-2">
            #{ouvrier.numero}
          </div>
          <h2 className="text-xl font-bold tracking-tight">{ouvrier.nom}</h2>
          <p className="text-emerald-100 text-xs mt-0.5">
            {isEditMode ? 'Modifier le pointage' : '✓ Présence enregistrée ! Affectation :'}
          </p>

          {isEditMode && onCancelPointage && (
            <button
              type="button"
              onClick={() => onSelectTask(currentTacheId, selectedDomaineId)}
              className="absolute top-4 right-4 text-emerald-200 hover:text-white p-1 rounded-full cursor-pointer"
              title="Fermer"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* SÉLECTEUR DE DOMAINE DU JOUR (D1 à D5, pré-sélectionné sur D2) */}
        {domaines.length > 0 && (
          <div className="p-3 bg-slate-100 border-b border-slate-200 shrink-0">
            <div className="flex items-center justify-between mb-1.5 px-0.5 text-xs font-black">
              <span className="text-slate-600 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                <span>Domaine du jour :</span>
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
                    onClick={() => setSelectedDomaineId(d.id)}
                    className={`h-11 rounded-xl font-black text-sm flex items-center justify-center transition active:scale-95 border-2 cursor-pointer ${
                      isDomSelected
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-400'
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

        {/* Champ de recherche de tâche en temps réel */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Rechercher une tâche..."
              className="w-full bg-white border border-slate-300 rounded-xl pl-10 pr-9 py-2.5 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full cursor-pointer"
                title="Effacer la recherche"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Corps : Liste des tâches filtrées */}
        <div className="p-3 space-y-2 overflow-y-auto flex-1">
          {filteredTasks.length === 0 ? (
            <div className="py-8 text-center text-slate-500 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 p-4">
              <Search className="w-7 h-7 mx-auto text-slate-300 mb-1.5" />
              <p className="font-bold text-sm text-slate-700">Aucune tâche trouvée</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Aucune tâche ne correspond à &laquo;&nbsp;{searchQuery}&nbsp;&raquo;
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {filteredTasks.map((tache) => {
                const isSelected = selectedTaskId === tache.id;
                return (
                  <button
                    key={tache.id}
                    type="button"
                    onClick={() => setSelectedTaskId(tache.id)}
                    className={`w-full h-13 px-4 rounded-2xl font-black text-sm flex items-center justify-between shadow-xs transition-all active:scale-[0.99] border-2 text-left cursor-pointer ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500'
                        : 'border-slate-200 hover:border-emerald-500 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: tache.couleur || '#16a34a' }}
                      />
                      <span className="tracking-wide uppercase truncate font-black">
                        {formatTacheLabel(tache)}
                      </span>
                    </div>

                    {isSelected ? (
                      <div className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
                        <Check className="w-4 h-4" />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 font-semibold shrink-0">Choisir</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Boutons d'action : Valider la tâche / Passer sans tâche */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
          {/* Bouton de validation de la tâche choisie */}
          <button
            type="button"
            disabled={!selectedTaskId}
            onClick={() => {
              if (selectedTaskId) {
                onSelectTask(selectedTaskId, selectedDomaineId);
              }
            }}
            className={`w-full h-12 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition active:scale-[0.98] ${
              selectedTaskId
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            <span className="truncate">
              {selectedTaskObj
                ? `Valider : ${formatTacheLabel(selectedTaskObj)} (${currentDomaineObj?.nom || 'D2'})`
                : 'Valider la tâche choisie'}
            </span>
          </button>

          {/* Option : Valider sans tâche */}
          <button
            type="button"
            onClick={() => onSelectTask(null, selectedDomaineId)}
            className={`w-full h-11 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 transition active:scale-[0.98] cursor-pointer ${
              selectedTaskId === null && !currentTacheId ? 'ring-1 ring-slate-400 font-black' : ''
            }`}
          >
            <span>Passer sans tâche ({currentDomaineObj?.nom || 'D2'})</span>
          </button>

          {/* Annuler le pointage si disponible */}
          {onCancelPointage && !isEditMode && (
            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={onCancelPointage}
                className="text-red-600 hover:text-red-700 text-xs font-semibold p-1 hover:underline cursor-pointer"
              >
                Annuler ce pointage
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
