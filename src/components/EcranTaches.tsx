/**
 * ÉCRAN 2 — ÉCRAN TÂCHES (AFFECTATION APRÈS LE POINTAGE)
 *
 * Spécifications :
 * - Écran séparé accessible depuis le menu principal
 * - Recherche de tâche par code OU par nom, insensible casse et accents, temps réel
 * - Affichage du nombre d'ouvriers affectés à chaque tâche aujourd'hui
 * - RÈGLE STRICTE :
 *   1. Un ouvrier présent sans AUCUNE tâche aujourd'hui apparaît dans la liste "Ajouter des ouvriers" de TOUTES les tâches.
 *   2. Un ouvrier présent affecté à UNE tâche aujourd'hui n'apparaît QUE dans cette tâche (zone "Ouvriers affectés"). Il disparaît de la liste "Ajouter des ouvriers" de TOUTES les tâches.
 *   3. Pour le déplacer vers une autre tâche : il faut d'abord le retirer de sa tâche actuelle avec "Retirer". Après ce retrait, il redevient visible dans la liste "Ajouter" de toutes les tâches.
 *   4. Les absents sont totalement exclus de toutes les listes.
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Tag,
  Search,
  Check,
  X,
  ChevronLeft,
  ArrowRight,
  Plus,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Ouvrier, Tache, Pointage, AffectationTache, Domaine } from '../types';
import { formatTacheLabel } from '../utils/tacheUtils';

interface EcranTachesProps {
  taches: Tache[];
  pointagesDuJour: Pointage[];
  activeOuvriers: Ouvrier[];
  affectationsDuJour: AffectationTache[];
  domaines: Domaine[];
  defaultDomaineId: string;
  onSetTaskWorkers: (tacheId: string, ouvrierIds: string[]) => { success: boolean; error?: string } | void;
  onRemoveWorkerFromTask: (ouvrierId: string, tacheId: string) => void;
  onNavigateToPointage: () => void;
  selectedDate: string;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export const EcranTaches: React.FC<EcranTachesProps> = ({
  taches,
  pointagesDuJour,
  activeOuvriers,
  affectationsDuJour,
  domaines,
  defaultDomaineId,
  onSetTaskWorkers,
  onRemoveWorkerFromTask,
  onNavigateToPointage,
  selectedDate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTask, setSelectedTask] = useState<Tache | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [workerToRemove, setWorkerToRemove] = useState<{
    ouvrierId: string;
    tacheId: string;
    workerNum: number;
    workerNom: string;
    taskLabel: string;
  } | null>(null);
  const [blockingAlertMessage, setBlockingAlertMessage] = useState<string | null>(null);

  // Map des ouvriers par ID
  const ouvrierMap = useMemo(
    () => new Map<string, Ouvrier>(activeOuvriers.map((o) => [o.id, o])),
    [activeOuvriers]
  );

  // Map des domaines par ID
  const domaineMap = useMemo(
    () => new Map<string, Domaine>(domaines.map((d) => [d.id, d])),
    [domaines]
  );

  // 1. Ouvriers PRÉSENTS aujourd'hui (les absents sont totalement exclus)
  const presentsAujourdhui = useMemo(() => {
    return pointagesDuJour
      .filter((p) => p.present !== false)
      .map((p) => {
        const ouvrier = ouvrierMap.get(p.ouvrier_id);
        const dom = domaineMap.get(p.domaine_id || defaultDomaineId);
        return {
          pointage: p,
          ouvrier: ouvrier || {
            id: p.ouvrier_id,
            company_id: p.company_id,
            numero: p.numero_ouvrier,
            nom: `Ouvrier #${p.numero_ouvrier}`,
            actif: true,
            createdAt: '',
          },
          domaineNom: dom ? dom.nom : 'D2',
        };
      })
      .sort((a, b) => a.ouvrier.numero - b.ouvrier.numero);
  }, [pointagesDuJour, ouvrierMap, domaineMap, defaultDomaineId]);

  // Set des ouvriers affectés à CETTE tâche précisément
  const affectesThisTaskSet = useMemo(() => {
    if (!selectedTask) return new Set<string>();
    return new Set(
      affectationsDuJour
        .filter((a) => a.tache_id === selectedTask.id)
        .map((a) => a.ouvrier_id)
    );
  }, [selectedTask, affectationsDuJour]);

  // Map des ouvriers affectés à une AUTRE tâche aujourd'hui (workerId -> formatTacheLabel(otherTask))
  const workerOtherTaskMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!selectedTask) return map;
    const tacheMap = new Map<string, Tache>(taches.map((t) => [t.id, t]));
    affectationsDuJour.forEach((aff) => {
      if (aff.tache_id !== selectedTask.id) {
        const otherTask = tacheMap.get(aff.tache_id);
        if (otherTask) {
          map.set(aff.ouvrier_id, formatTacheLabel(otherTask));
        }
      }
    });
    return map;
  }, [affectationsDuJour, selectedTask, taches]);

  // Nombre d'ouvriers affectés à chaque tâche aujourd'hui
  const affectationsCountByTask = useMemo(() => {
    const counts = new Map<string, number>();
    affectationsDuJour.forEach((aff) => {
      counts.set(aff.tache_id, (counts.get(aff.tache_id) || 0) + 1);
    });
    return counts;
  }, [affectationsDuJour]);

  // Ouvriers affectés par tâche (tableau d'objets pour affichage)
  const workersByTask = useMemo(() => {
    const map = new Map<string, Array<{ ouvrierId: string; numero: number; nom: string }>>();
    affectationsDuJour.forEach((aff) => {
      const o = ouvrierMap.get(aff.ouvrier_id);
      const list = map.get(aff.tache_id) || [];
      list.push({
        ouvrierId: aff.ouvrier_id,
        numero: aff.numero_ouvrier,
        nom: o ? o.nom : `Ouvrier #${aff.numero_ouvrier}`,
      });
      map.set(aff.tache_id, list);
    });

    map.forEach((list) => list.sort((a, b) => a.numero - b.numero));
    return map;
  }, [affectationsDuJour, ouvrierMap]);

  // Filtrage des tâches en temps réel (code OU nom)
  const filteredTaches = useMemo(() => {
    const q = normalize(searchQuery);
    if (!q) return taches;
    return taches.filter((t) => {
      const matchNom = normalize(t.nom).includes(q);
      const matchCode = t.code ? normalize(t.code).includes(q) : false;
      const matchFull = t.code ? normalize(`${t.code} - ${t.nom}`).includes(q) : false;
      return matchNom || matchCode || matchFull;
    });
  }, [taches, searchQuery]);

  // ---------------- RÈGLE D'AFFECTATION STRICTE ----------------

  // 1. Zone "Ouvriers affectés à [tache T]" : uniquement les ouvriers réellement affectés à cette tâche T
  const listeAffectes = useMemo(() => {
    if (!selectedTask) return [];
    return affectationsDuJour.filter((a) => a.tache_id === selectedTask.id);
  }, [selectedTask, affectationsDuJour]);

  // 2. Zone "Ajouter des ouvriers" pour la tâche T :
  // Tous les ouvriers présents aujourd'hui, SAUF ceux déjà affectés à CETTE tâche
  const listeAjouter = useMemo(() => {
    if (!selectedTask) return [];
    return presentsAujourdhui
      .filter((p) => !affectesThisTaskSet.has(p.ouvrier.id))
      .sort((a, b) => a.ouvrier.numero - b.ouvrier.numero);
  }, [selectedTask, presentsAujourdhui, affectesThisTaskSet]);

  // IDs des ouvriers réellement disponibles (qui n'ont pas d'autre tâche) pour "Tout cocher"
  const availableWorkerIds = useMemo(() => {
    return listeAjouter
      .filter((p) => !workerOtherTaskMap.has(p.ouvrier.id))
      .map((p) => p.ouvrier.id);
  }, [listeAjouter, workerOtherTaskMap]);

  // Console log de vérification
  useEffect(() => {
    if (selectedTask) {
      const affectesNums = listeAffectes.map((a) => a.numero_ouvrier).sort((a, b) => a - b);
      const ajouterNums = listeAjouter.map((p) => p.ouvrier.numero).sort((a, b) => a - b);
      console.log(
        `[SELECTION TÂCHE ${selectedTask.code || selectedTask.nom}] Date: ${selectedDate} | Zone Affectés (${affectesNums.length}): [${affectesNums.join(', ')}] | Zone Ajouter (${ajouterNums.length}): [${ajouterNums.join(', ')}]`
      );
    }
  }, [selectedTask, selectedDate, listeAffectes, listeAjouter]);

  // ---------------- ACTIONS ----------------

  const handleOpenAssignTask = (tache: Tache) => {
    setSelectedTask(tache);
    setSelectedWorkerIds([]);
  };

  const handleToggleWorker = (ouvrierId: string) => {
    setSelectedWorkerIds((prev) =>
      prev.includes(ouvrierId)
        ? prev.filter((id) => id !== ouvrierId)
        : [...prev, ouvrierId]
    );
  };

  const handleClickWorkerItem = (ouvrierId: string, ouvrierNom: string) => {
    const otherTaskLabel = workerOtherTaskMap.get(ouvrierId);
    if (otherTaskLabel) {
      setBlockingAlertMessage(
        `${ouvrierNom} est déjà affecté à ${otherTaskLabel} aujourd'hui. Retirez-le de cette tâche pour le mettre sur une autre.`
      );
      return;
    }
    handleToggleWorker(ouvrierId);
  };

  const handleSelectAllAvailable = (availableIds: string[]) => {
    setSelectedWorkerIds(availableIds);
  };

  const handleDeselectAll = () => {
    setSelectedWorkerIds([]);
  };

  const handleSaveAssignment = () => {
    if (!selectedTask || selectedWorkerIds.length === 0) return;

    const currentAssigned = workersByTask.get(selectedTask.id) || [];
    const currentAssignedIds = currentAssigned.map((w) => w.ouvrierId);

    const finalWorkerIds = Array.from(
      new Set([...currentAssignedIds, ...selectedWorkerIds])
    );

    const res = onSetTaskWorkers(selectedTask.id, finalWorkerIds);
    if (res && res.success === false && res.error) {
      setBlockingAlertMessage(res.error);
      return;
    }

    const taskLabel = formatTacheLabel(selectedTask);
    setFeedbackMessage(
      `✓ ${selectedWorkerIds.length} ouvrier(s) affecté(s) à "${taskLabel}"`
    );

    setSelectedWorkerIds([]);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  const handleTriggerRemove = (ouvrierId: string, tacheId: string, workerNum: number, workerNom?: string) => {
    const t = taches.find((item) => item.id === tacheId);
    const taskLabel = formatTacheLabel(t);
    const o = ouvrierMap.get(ouvrierId);
    const nom = workerNom || (o ? o.nom : `Ouvrier #${workerNum}`);
    setWorkerToRemove({
      ouvrierId,
      tacheId,
      workerNum,
      workerNom: nom,
      taskLabel,
    });
  };

  return (
    <div className="space-y-3 pb-24">
      {/* BANNIÈRE DE STATUT / DATE */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800">
            <Tag className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-800">Affectation des Tâches</h2>
            <p className="text-[11px] text-slate-500">
              {presentsAujourdhui.length} ouvrier(s) présent(s) aujourd'hui
            </p>
          </div>
        </div>

        {presentsAujourdhui.length === 0 ? (
          <button
            type="button"
            onClick={onNavigateToPointage}
            className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold px-2.5 py-1.5 rounded-xl transition"
          >
            Pointer d'abord ➔
          </button>
        ) : (
          <span className="text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-lg">
            Pointage actif
          </span>
        )}
      </div>

      {feedbackMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-500 text-emerald-950 p-3 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-xs animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* RECHERCHE DE TÂCHE */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2">
        <label className="text-xs font-bold text-slate-700 block">
          Rechercher une tâche :
        </label>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par code (ex: R01) ou par nom (ex: RECOLTE)..."
            className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:bg-white focus:border-emerald-600 outline-none uppercase"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* VUE D'AFFECTATION POUR UNE TÂCHE SÉLECTIONNÉE */}
      {selectedTask ? (
        <div className="bg-white rounded-3xl border-2 border-emerald-600 p-4 shadow-xl space-y-4 animate-in fade-in">
          {/* En-tête de la tâche choisie */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <button
              type="button"
              onClick={() => {
                setSelectedTask(null);
                setSelectedWorkerIds([]);
              }}
              className="flex items-center gap-1 text-slate-600 hover:text-slate-900 text-xs font-bold p-1 rounded-lg cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Retour aux tâches</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedTask(null);
                setSelectedWorkerIds([]);
              }}
              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="w-4 h-4 rounded-full shrink-0 shadow-xs"
                style={{ backgroundColor: selectedTask.couleur || '#16a34a' }}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectedTask.code && (
                    <span className="font-mono font-black text-xs bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-md">
                      {selectedTask.code}
                    </span>
                  )}
                  <h3 className="font-black text-sm text-slate-900 uppercase truncate">
                    {selectedTask.nom}
                  </h3>
                </div>
              </div>
            </div>

            <span className="text-xs font-black bg-emerald-100 text-emerald-900 px-2.5 py-1 rounded-xl shrink-0 font-mono">
              {listeAffectes.length} affecté(s)
            </span>
          </div>

          {/* ZONE 1 : OUVRIERS AFFECTÉS À CETTE TÂCHE */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs font-black text-slate-800">
              <span>
                Ouvriers affectés à{' '}
                {selectedTask.code
                  ? `${selectedTask.code} - ${selectedTask.nom}`
                  : selectedTask.nom}{' '}
                ({listeAffectes.length}) :
              </span>
            </div>

            {listeAffectes.length === 0 ? (
              <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400 text-center italic">
                Aucun ouvrier affecté à cette tâche pour l'instant.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1.5 bg-slate-50 border border-slate-200 rounded-2xl">
                {listeAffectes.map((aff) => {
                  const o = ouvrierMap.get(aff.ouvrier_id);
                  const num = aff.numero_ouvrier;
                  const nom = o ? o.nom : `Ouvrier #${num}`;
                  return (
                    <div
                      key={aff.id}
                      className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-slate-800 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-2xs"
                    >
                      <span className="text-emerald-700 font-black">#{num}</span>
                      <span className="truncate max-w-[120px]">{nom}</span>
                      <button
                        type="button"
                        onClick={() => handleTriggerRemove(aff.ouvrier_id, selectedTask.id, num, nom)}
                        className="ml-1 text-slate-400 hover:text-red-600 hover:bg-red-50 p-0.5 rounded-md transition cursor-pointer"
                        title="Retirer de cette tâche (redevient disponible dans Ajouter)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ZONE 2 : AJOUTER DES OUVRIERS */}
          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <div className="text-xs font-black text-slate-800 flex items-center gap-1">
                <span>Ajouter des ouvriers</span>
                <span className="text-slate-400 font-normal">
                  ({availableWorkerIds.length} disponible(s) sans tâche)
                </span>
              </div>

              {availableWorkerIds.length > 0 && (
                <div className="flex gap-2 text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => handleSelectAllAvailable(availableWorkerIds)}
                    className="text-emerald-700 hover:underline cursor-pointer"
                  >
                    Tout cocher
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-slate-500 hover:underline cursor-pointer"
                  >
                    Tout décocher
                  </button>
                </div>
              )}
            </div>

            {listeAjouter.length === 0 ? (
              <div className="p-4 text-center text-slate-500 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                <p className="text-xs font-bold text-slate-700">
                  {presentsAujourdhui.length === 0
                    ? "Aucun ouvrier présent aujourd'hui"
                    : "Tous les ouvriers présents sont déjà affectés à cette tâche."}
                </p>
                {presentsAujourdhui.length === 0 && (
                  <button
                    type="button"
                    onClick={onNavigateToPointage}
                    className="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl hover:bg-emerald-700 mt-1 inline-block cursor-pointer"
                  >
                    Aller au pointage du matin
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {listeAjouter.map((p) => {
                  const autreTache = workerOtherTaskMap.get(p.ouvrier.id);
                  const bloque = !!autreTache;

                  return (
                    <div
                      key={p.ouvrier.id}
                      onClick={() => handleClickWorkerItem(p.ouvrier.id, p.ouvrier.nom)}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        bloque ? "opacity-60 bg-gray-100 cursor-not-allowed" : "cursor-pointer"
                      }`}
                    >
                      <div>
                        <div className="font-semibold">
                          {p.ouvrier.numero} - {p.ouvrier.nom}
                        </div>
                        {bloque && (
                          <div className="text-xs text-orange-600">déjà : {autreTache}</div>
                        )}
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedWorkerIds.includes(p.ouvrier.id)}
                        disabled={bloque}
                        readOnly
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Boutons d'action pour valider l'ajout */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveAssignment}
                disabled={selectedWorkerIds.length === 0}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-black text-xs py-3 rounded-xl shadow-md disabled:shadow-none transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Valider l'ajout ({selectedWorkerIds.length})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedTask(null);
                  setSelectedWorkerIds([]);
                }}
                className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-3 rounded-xl transition cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* LISTE DES TÂCHES AVEC LEURS OUVRIERS AFFECTÉS */
        <div className="space-y-2">
          {filteredTaches.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
              <Tag className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="font-bold text-xs text-slate-600">Aucune tâche trouvée</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Modifiez votre recherche ou ajoutez des tâches dans l'écran Gestion.
              </p>
            </div>
          ) : (
            filteredTaches.map((tache) => {
              const assignedCount = affectationsCountByTask.get(tache.id) || 0;
              const assignedWorkers = workersByTask.get(tache.id) || [];

              return (
                <div
                  key={tache.id}
                  className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-2 hover:border-emerald-300 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-4 h-4 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: tache.couleur || '#16a34a' }}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {tache.code && (
                            <span className="font-mono font-black text-xs bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-md">
                              {tache.code}
                            </span>
                          )}
                          <span className="font-black text-xs text-slate-800 tracking-wide uppercase truncate">
                            {tache.nom}
                          </span>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenAssignTask(tache)}
                      className="bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-xs px-3 py-1.5 rounded-xl shadow-xs transition flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <span>Affecter</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Compteur et liste des ouvriers affectés */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="text-[11px] text-slate-500 font-bold">
                      {assignedCount > 0 ? (
                        <span className="text-emerald-700">
                          {assignedCount} ouvrier{assignedCount > 1 ? 's' : ''} affecté{assignedCount > 1 ? 's' : ''} :
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Aucun ouvrier affecté</span>
                      )}
                    </div>
                  </div>

                  {assignedWorkers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {assignedWorkers.map((w) => (
                        <div
                          key={w.ouvrierId}
                          className="inline-flex items-center gap-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 rounded-lg px-2 py-1 text-[11px] font-bold"
                        >
                          <span className="text-emerald-700 font-black">#{w.numero}</span>
                          <span className="truncate max-w-[110px]">{w.nom}</span>
                          <button
                            type="button"
                            onClick={() => handleTriggerRemove(w.ouvrierId, tache.id, w.numero, w.nom)}
                            className="text-slate-400 hover:text-red-600 p-0.5 transition cursor-pointer"
                            title="Retirer de cette tâche"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* MODALE DE CONFIRMATION DU RETRAIT D'UN OUVRIER D'UNE TÂCHE */}
      {workerToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-700" />
              </div>
              <h3 className="font-black text-sm text-slate-900">Confirmer le retrait</h3>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed font-medium">
              Confirmer le retrait de l'ouvrier #{workerToRemove.workerNum} ({workerToRemove.workerNom}) de la tâche {workerToRemove.taskLabel} ?
            </p>
            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setWorkerToRemove(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemoveWorkerFromTask(workerToRemove.ouvrierId, workerToRemove.tacheId);
                  setWorkerToRemove(null);
                  setFeedbackMessage(`✓ Ouvrier #${workerToRemove.workerNum} retiré de la tâche`);
                  setTimeout(() => setFeedbackMessage(null), 3000);
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition cursor-pointer"
              >
                Oui, retirer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE D'ALERTE BLOQUANTE : TENTATIVE D'AFFECTATION À UNE DEUXIÈME TÂCHE */}
      {blockingAlertMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-700" />
              </div>
              <h3 className="font-black text-sm text-slate-900">Action bloquée</h3>
            </div>
            <div className="text-xs text-slate-800 leading-relaxed font-bold bg-red-50 p-3 rounded-2xl border border-red-200">
              {blockingAlertMessage}
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setBlockingAlertMessage(null)}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black py-3 rounded-xl text-xs shadow-md transition cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
