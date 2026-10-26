/**
 * ÉCRAN 2 — ABSENCES DU JOUR
 * Règle : Les absents ne sont PAS saisis manuellement.
 * Ce sont automatiquement tous les ouvriers actifs non pointés aujourd'hui.
 */

import React, { useState } from 'react';
import { UserX, Search, CheckCircle, Info, Sparkles } from 'lucide-react';
import { Ouvrier, Tache, Domaine } from '../types';
import { TaskModal } from './TaskModal';

interface AbsencesViewProps {
  absents: Ouvrier[];
  totalActifs: number;
  totalPointes: number;
  taches: Tache[];
  domaines?: Domaine[];
  defaultDomaineId?: string;
  onPointWorker: (ouvrierId: string, tacheId?: string | null, domaineId?: string) => {
    success: boolean;
    message?: string;
  };
  onUpdateTask: (pointageId: string, tacheId: string | null) => void;
  selectedDate: string;
}

export const AbsencesView: React.FC<AbsencesViewProps> = ({
  absents,
  totalActifs,
  totalPointes,
  taches,
  domaines = [],
  defaultDomaineId = 'dom_d2',
  onPointWorker,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAbsent, setSelectedAbsent] = useState<Ouvrier | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [justPointedMessage, setJustPointedMessage] = useState<string | null>(null);

  // Filtrer les absents
  const filteredAbsents = absents.filter((o) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return o.numero.toString().includes(q) || o.nom.toLowerCase().includes(q);
  });

  // Action rapide : Pointer un ouvrier arrivé en retard
  const handleStartLatePointage = (ouvrier: Ouvrier) => {
    setSelectedAbsent(ouvrier);
    setTaskModalOpen(true);
  };

  const handleConfirmLatePointage = (tacheId: string | null, domaineId: string) => {
    if (!selectedAbsent) return;
    const res = onPointWorker(selectedAbsent.id, tacheId, domaineId);
    if (res.success) {
      setJustPointedMessage(`✓ Retardataire pointé : #${selectedAbsent.numero} ${selectedAbsent.nom}`);
      setTimeout(() => setJustPointedMessage(null), 3000);
    }
    setTaskModalOpen(false);
    setSelectedAbsent(null);
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Bandeau explicatif de la règle d'absence */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 shadow-xs">
        <div className="flex items-start gap-2.5">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <span className="font-black text-amber-950">Règle automatique :</span> Les absents ne sont pas saisis manuellement. Ce sont tous les ouvriers actifs qui n'ont pas été pointés aujourd'hui.
          </div>
        </div>
      </div>

      {/* Carte Résumé des Absences */}
      <div className="bg-white rounded-2xl p-4 shadow-xs border border-slate-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center font-black">
              <UserX className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-black text-slate-800">
                {absents.length}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  / {totalActifs} ouvriers
                </span>
              </div>
              <div className="text-xs font-semibold text-amber-700">
                {absents.length === 0
                  ? 'Aucune absence enregistrée'
                  : `${absents.length} ouvrier(s) absent(s) aujourd'hui`}
              </div>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
              Présents
            </span>
            <span className="text-xl font-black text-emerald-600 font-mono">
              {totalPointes}
            </span>
          </div>
        </div>

        {/* Barre de recherche dans les absents */}
        {absents.length > 0 && (
          <div className="mt-3 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Chercher parmi les absents (nom ou n°)..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-amber-500 outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Notification de pointage retardataire */}
      {justPointedMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-950 rounded-2xl p-3 flex items-center gap-2 shadow-xs animate-in slide-in-from-top-2">
          <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="text-xs font-bold">{justPointedMessage}</span>
        </div>
      )}

      {/* Liste détaillée des ouvriers absents */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-3">
        <div className="flex items-center justify-between text-xs font-bold text-slate-600 mb-3 px-1">
          <span>LISTE DES ABSENTS ({filteredAbsents.length})</span>
          <span className="text-[11px] text-slate-400 font-normal">
            Triés par ordre croissant
          </span>
        </div>

        {absents.length === 0 ? (
          <div className="text-center py-12 px-4 bg-emerald-50 rounded-2xl border border-emerald-100">
            <Sparkles className="w-10 h-10 mx-auto text-emerald-600 mb-2" />
            <div className="text-base font-black text-emerald-900">
              100% de présence !
            </div>
            <div className="text-xs text-emerald-700 mt-1">
              Tous les ouvriers actifs ont été pointés ce matin.
            </div>
          </div>
        ) : filteredAbsents.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            Aucun ouvrier absent ne correspond à votre recherche.
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAbsents.map((ouvrier) => (
              <div
                key={ouvrier.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 hover:border-amber-300 transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-2xs">
                    {ouvrier.numero}
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-xs text-slate-800 truncate">
                      {ouvrier.nom}
                    </div>
                    <div className="text-[11px] text-red-600 font-medium">
                      Absent aujourd'hui
                    </div>
                  </div>
                </div>

                {/* Bouton pour pointer rapidement un retardataire */}
                <button
                  type="button"
                  onClick={() => handleStartLatePointage(ouvrier)}
                  className="shrink-0 flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-xs transition"
                  title="Enregistrer comme retardataire"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Pointer retard</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modale d'affectation de tâche si pointage d'un retardataire */}
      <TaskModal
        isOpen={taskModalOpen}
        ouvrier={selectedAbsent}
        taches={taches}
        domaines={domaines}
        defaultDomaineId={defaultDomaineId}
        onSelectTask={handleConfirmLatePointage}
        onCancelPointage={() => {
          setTaskModalOpen(false);
          setSelectedAbsent(null);
        }}
      />
    </div>
  );
};
