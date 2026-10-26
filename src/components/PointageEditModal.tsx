/**
 * Modale de modification et suppression d'un pointage du matin
 * Options conformes à la spécification :
 * 1. Pour un ouvrier Présent :
 *    - "Passer en Absent" (retire les tâches avec confirmation)
 *    - "Changer de domaine" (D1 à D5)
 *    - "Supprimer le pointage" (supprime complètement avec confirmation)
 *    - "Annuler"
 * 2. Pour un ouvrier Absent :
 *    - "Marquer présent" / "Passer en Présent" (remet en présent, sans tâche, avec choix du domaine)
 *    - "Annuler"
 * 3. Pointages passés :
 *    - Affiche clairement la date concernée et exige une confirmation avec la date.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  UserX,
  Trash2,
  MapPin,
  AlertTriangle,
  Clock,
  Calendar,
  CheckCircle2,
  Tag,
} from 'lucide-react';
import { Ouvrier, Pointage, Domaine } from '../types';
import { formatDateJJMM } from '../utils/whatsappFormatter';

interface PointageEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  ouvrier: Ouvrier | null;
  pointage: Pointage | null;
  isPresent: boolean;
  date: string; // YYYY-MM-DD
  domaines: Domaine[];
  defaultDomaineId: string;
  assignedTasksCount?: number;
  onPasserEnAbsent: (ouvrierId: string, pointageId?: string) => void;
  onPasserEnPresent: (ouvrierId: string, domaineId: string) => void;
  onChangeDomaine: (pointageId: string, newDomaineId: string) => void;
  onDeletePointage: (pointageId: string) => void;
}

export const PointageEditModal: React.FC<PointageEditModalProps> = ({
  isOpen,
  onClose,
  ouvrier,
  pointage,
  isPresent,
  date,
  domaines,
  defaultDomaineId,
  assignedTasksCount = 0,
  onPasserEnAbsent,
  onPasserEnPresent,
  onChangeDomaine,
  onDeletePointage,
}) => {
  const todayIso = new Date().toISOString().split('T')[0];
  const isPastDate = date !== todayIso;
  const dateFormatee = formatDateJJMM(date);

  // Domaine sélectionné
  const [selectedDomId, setSelectedDomId] = useState<string>(
    pointage?.domaine_id || defaultDomaineId || 'dom_d2'
  );

  // État de confirmation secondaire dans la modale
  const [confirmAction, setConfirmAction] = useState<
    'absent' | 'supprimer' | 'changer_domaine' | null
  >(null);
  const [pendingDomaineId, setPendingDomaineId] = useState<string | null>(null);

  useEffect(() => {
    if (pointage?.domaine_id) {
      setSelectedDomId(pointage.domaine_id);
    } else {
      setSelectedDomId(defaultDomaineId || 'dom_d2');
    }
    setConfirmAction(null);
    setPendingDomaineId(null);
  }, [pointage, defaultDomaineId, isOpen]);

  if (!isOpen || !ouvrier) return null;

  const currentDomName =
    domaines.find((d) => d.id === (pointage?.domaine_id || selectedDomId))?.nom || 'D2';

  // --- ACTIONS ---

  const handleTriggerPasserAbsent = () => {
    setConfirmAction('absent');
  };

  const handleConfirmPasserAbsent = () => {
    onPasserEnAbsent(ouvrier.id, pointage?.id);
    onClose();
  };

  const handleTriggerDelete = () => {
    setConfirmAction('supprimer');
  };

  const handleConfirmDelete = () => {
    if (pointage) {
      onDeletePointage(pointage.id);
    }
    onClose();
  };

  const handleSelectDomaine = (domId: string) => {
    if (domId === (pointage?.domaine_id || selectedDomId)) return;
    setPendingDomaineId(domId);
    if (isPastDate) {
      setConfirmAction('changer_domaine');
    } else {
      // Pour aujourd'hui : mise à jour directe
      if (pointage) {
        onChangeDomaine(pointage.id, domId);
        setSelectedDomId(domId);
      } else {
        setSelectedDomId(domId);
      }
    }
  };

  const handleConfirmChangeDomaine = () => {
    if (pendingDomaineId && pointage) {
      onChangeDomaine(pointage.id, pendingDomaineId);
      setSelectedDomId(pendingDomaineId);
    }
    setConfirmAction(null);
    setPendingDomaineId(null);
  };

  const handlePasserPresent = () => {
    if (isPastDate) {
      const ok = window.confirm(
        `Confirmer le pointage de l'ouvrier #${ouvrier.numero} (${ouvrier.nom}) comme Présent pour la date passée du ${dateFormatee} ?`
      );
      if (!ok) return;
    }
    onPasserEnPresent(ouvrier.id, selectedDomId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* EN-TÊTE MODALE */}
        <div
          className={`p-4 text-white flex items-center justify-between ${
            isPresent ? 'bg-slate-900' : 'bg-amber-900'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center font-black text-base shadow-xs ${
                isPresent ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'
              }`}
            >
              {ouvrier.numero}
            </div>
            <div>
              <div className="font-black text-sm text-white flex items-center gap-1.5">
                <span>{ouvrier.nom}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    isPresent ? 'bg-emerald-500/30 text-emerald-200' : 'bg-amber-500/30 text-amber-200'
                  }`}
                >
                  {isPresent ? 'Présent' : 'Absent'}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 flex items-center gap-1 mt-0.5">
                <Calendar className="w-3 h-3 text-slate-400" />
                <span>Date : {dateFormatee}</span>
                {pointage?.heure && (
                  <>
                    <span>•</span>
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>Pointé à {pointage.heure}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ALERTE DE DATE PASSÉE */}
        {isPastDate && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-xs font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Modification d'un pointage passé (Date : {dateFormatee})</span>
          </div>
        )}

        {/* CORPS DE LA MODALE */}
        <div className="p-4 space-y-4">
          {/* DIALOGUE DE CONFIRMATION INTERNE */}
          {confirmAction && (
            <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-2xl space-y-3 animate-in fade-in">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs text-red-950">
                  {confirmAction === 'absent' && (
                    <>
                      <div className="font-black text-sm text-red-900">
                        Passer cet ouvrier en Absent ?
                      </div>
                      <p className="mt-1 font-medium leading-relaxed">
                        {assignedTasksCount > 0 ? (
                          <>
                            ⚠️ Cet ouvrier a <strong>{assignedTasksCount} tâche(s) affectée(s)</strong>{' '}
                            pour cette journée. <strong>Ces tâches seront automatiquement retirées.</strong>
                          </>
                        ) : (
                          'La présence sera changée en Absent.'
                        )}
                      </p>
                      {isPastDate && (
                        <p className="mt-1 text-[11px] font-bold text-amber-800">
                          Date concernée : {dateFormatee}
                        </p>
                      )}
                    </>
                  )}

                  {confirmAction === 'supprimer' && (
                    <>
                      <div className="font-black text-sm text-red-900">
                        Supprimer complètement le pointage ?
                      </div>
                      <p className="mt-1 font-medium leading-relaxed">
                        Cette action supprime l'enregistrement du pointage du matin de l'ouvrier #{ouvrier.numero} ({ouvrier.nom})
                        pour le <strong>{dateFormatee}</strong>. Les tâches affectées seront également retirées.
                      </p>
                    </>
                  )}

                  {confirmAction === 'changer_domaine' && (
                    <>
                      <div className="font-black text-sm text-slate-900">
                        Changer de domaine pour un jour passé ?
                      </div>
                      <p className="mt-1 font-medium leading-relaxed">
                        Confirmer le changement de domaine vers{' '}
                        <strong>
                          {domaines.find((d) => d.id === pendingDomaineId)?.nom || 'D2'}
                        </strong>{' '}
                        pour la date du <strong>{dateFormatee}</strong> ?
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-1 border-t border-red-200">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmAction(null);
                    setPendingDomaineId(null);
                  }}
                  className="flex-1 bg-white hover:bg-slate-100 text-slate-700 font-bold py-2 rounded-xl text-xs border border-slate-300 transition"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirmAction === 'absent') handleConfirmPasserAbsent();
                    else if (confirmAction === 'supprimer') handleConfirmDelete();
                    else if (confirmAction === 'changer_domaine') handleConfirmChangeDomaine();
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-2 rounded-xl text-xs shadow-md transition"
                >
                  Confirmer
                </button>
              </div>
            </div>
          )}

          {/* VUE 1 : L'OUVRIER EST PRÉSENT */}
          {isPresent && !confirmAction && (
            <div className="space-y-4">
              {/* Changer de domaine */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span>Changer de domaine pour ce jour :</span>
                  </span>
                  <span className="text-[11px] font-black text-blue-700 bg-blue-100 px-2 py-0.5 rounded-lg">
                    Actuel : {currentDomName}
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-1.5 pt-1">
                  {domaines.map((dom) => {
                    const isSelected = (pointage?.domaine_id || selectedDomId) === dom.id;
                    return (
                      <button
                        key={dom.id}
                        type="button"
                        onClick={() => handleSelectDomaine(dom.id)}
                        className={`h-11 rounded-xl text-xs font-black border transition ${
                          isSelected
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-blue-50'
                        }`}
                      >
                        {dom.nom}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tâches affectées actuellement */}
              {assignedTasksCount > 0 && (
                <div className="p-2.5 bg-purple-50 border border-purple-200 rounded-xl text-xs flex items-center justify-between text-purple-900">
                  <div className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-600" />
                    <span>Tâches affectées aujourd'hui :</span>
                  </div>
                  <span className="font-bold font-mono bg-purple-200/80 px-2 py-0.5 rounded-lg text-purple-950">
                    {assignedTasksCount} tâche(s)
                  </span>
                </div>
              )}

              {/* Bouton : Passer en Absent */}
              <button
                type="button"
                onClick={handleTriggerPasserAbsent}
                className="w-full bg-amber-600 hover:bg-amber-700 active:scale-[0.99] text-white p-3 rounded-2xl font-black text-xs shadow-xs flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <UserX className="w-4 h-4 text-white" />
                  <span>Passer en Absent</span>
                </div>
                <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded-lg font-normal">
                  Retire les tâches affectées
                </span>
              </button>

              {/* Bouton : Supprimer le pointage */}
              <button
                type="button"
                onClick={handleTriggerDelete}
                className="w-full bg-red-50 hover:bg-red-100 active:scale-[0.99] text-red-700 border border-red-200 p-3 rounded-2xl font-bold text-xs flex items-center justify-between transition cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-600" />
                  <span>Supprimer le pointage</span>
                </div>
                <span className="text-[10px] text-red-500">
                  Erreur de saisie
                </span>
              </button>
            </div>
          )}

          {/* VUE 2 : L'OUVRIER EST ABSENT */}
          {!isPresent && !confirmAction && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900">
                <span className="font-bold">Ouvrier actuellement absent.</span> Vous pouvez le marquer comme présent pour cette journée sans tâche obligatoire.
              </div>

              {/* Choisir le domaine du pointage */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Domaine du pointage :</span>
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {domaines.map((dom) => {
                    const isSelected = selectedDomId === dom.id;
                    return (
                      <button
                        key={dom.id}
                        type="button"
                        onClick={() => setSelectedDomId(dom.id)}
                        className={`h-11 rounded-xl text-xs font-black border transition ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-emerald-50'
                        }`}
                      >
                        {dom.nom}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bouton : Passer en Présent / Marquer présent */}
              <button
                type="button"
                onClick={handlePasserPresent}
                className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white p-3.5 rounded-2xl font-black text-sm shadow-md flex items-center justify-center gap-2 transition cursor-pointer"
              >
                <UserCheck className="w-5 h-5 text-white" />
                <span>Passer en Présent (sans tâche)</span>
              </button>
            </div>
          )}

          {/* Bouton Annuler */}
          {!confirmAction && (
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Annuler
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
