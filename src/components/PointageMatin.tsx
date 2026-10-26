/**
 * ÉCRAN 1 — POINTAGE DU MATIN
 * Optimisé pour une saisie rapide à une main sur Android (pavé numérique, recherche, alertes)
 */

import React, { useState, useRef, useId, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Delete,
  Clock,
  Tag,
  Sparkles,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Fuel,
} from 'lucide-react';
import { Ouvrier, Tache, Pointage, Domaine } from '../types';
import { TaskModal } from './TaskModal';
import { formatTacheLabel } from '../utils/tacheUtils';
import * as storage from '../services/storage';

interface PointageDetailsItem {
  pointage: Pointage;
  ouvrier?: Ouvrier;
  tache?: Tache;
  taches?: Tache[];
  domaine?: Domaine;
}

interface PointageMatinProps {
  activeOuvriers: Ouvrier[];
  ouvriersRestants: Ouvrier[];
  pointesDetails: PointageDetailsItem[];
  taches: Tache[];
  domaines?: Domaine[];
  defaultDomaineId?: string;
  checkWorkerByNumber: (numero: number) => {
    valid: boolean;
    ouvrier?: Ouvrier;
    error?: string;
    isAlreadyPointed?: boolean;
    existingPointage?: Pointage;
  };
  onPointWorker: (ouvrierId: string, tacheId?: string | null, domaineId?: string) => {
    success: boolean;
    message?: string;
    pointage?: Pointage;
  };
  onUpdatePointage?: (pointageId: string, updates: { tacheId?: string | null; domaineId?: string }) => void;
  onUpdateTask: (pointageId: string, tacheId: string | null) => void;
  onRemovePointage: (pointageId: string) => void;
  selectedDate: string;
  onOpenHeuresSupp?: () => void;
  heuresSuppCount?: number;
  gazoilStatus?: {
    stockActuel: number;
    seuilAlerte: number;
    isStockBas: boolean;
    initialSet: boolean;
    commandeActive: {
      active: boolean;
      date: string;
      quantite: number;
    } | null;
  };
  onNavigateGazoil?: () => void;
  onNavigateGestion?: () => void;
}

export const PointageMatin: React.FC<PointageMatinProps> = ({
  activeOuvriers,
  ouvriersRestants,
  pointesDetails,
  taches,
  domaines = [],
  defaultDomaineId = 'dom_d2',
  checkWorkerByNumber,
  onPointWorker,
  onUpdatePointage,
  onUpdateTask,
  onRemovePointage,
  onOpenHeuresSupp,
  heuresSuppCount = 0,
  gazoilStatus,
  onNavigateGazoil,
  onNavigateGestion,
}) => {
  const [inputNumber, setInputNumber] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showNumpad, setShowNumpad] = useState<boolean>(true);
  const [showSearchList, setShowSearchList] = useState<boolean>(false);

  // Domaine sélectionné pour la session de pointage en cours (pré-sélectionné sur D2)
  const [selectedSessionDomaineId, setSelectedSessionDomaineId] = useState<string>(
    defaultDomaineId || 'dom_d2'
  );
  const [editCurrentDomaineId, setEditCurrentDomaineId] = useState<string | null>(null);

  // Messages d'état
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warningDuplicate, setWarningDuplicate] = useState<{
    message: string;
    pointage: Pointage;
    ouvrier: Ouvrier;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // État de la modale de tâche (utilisée lors de l'édition manuelle)
  const [taskModalOpen, setTaskModalOpen] = useState<boolean>(false);
  const [pendingOuvrier, setPendingOuvrier] = useState<Ouvrier | null>(null);
  const [pendingPointageId, setPendingPointageId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editCurrentTacheId, setEditCurrentTacheId] = useState<string | null>(null);

  // Onglet bas : 'pointes' (présents) par défaut selon la spécification
  const [activeTab, setActiveTab] = useState<'pointes' | 'restants'>('pointes');

  // Rappel de sauvegarde de 7 jours
  const lastBackupStr = storage.getLastBackupDate();
  const isBackupOverdue = useMemo(() => {
    if (!lastBackupStr) return true;
    const diffDays = (Date.now() - new Date(lastBackupStr).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays > 7;
  }, [lastBackupStr]);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputId = useId();

  // Réinitialiser les messages
  const clearMessages = () => {
    setErrorMessage(null);
    setWarningDuplicate(null);
    setSuccessMessage(null);
  };

  // Traiter la validation d'un numéro d'ouvrier (POINTAGE DU MATIN IMMÉDIAT)
  const handleValidateNumber = (numeroStr?: string) => {
    clearMessages();
    const targetStr = (numeroStr !== undefined ? numeroStr : inputNumber).trim();
    if (!targetStr) {
      setErrorMessage('Veuillez saisir un numéro d\'ouvrier');
      return;
    }

    const num = parseInt(targetStr, 10);
    if (isNaN(num)) {
      setErrorMessage('Numéro invalide : saisissez uniquement des chiffres');
      return;
    }

    const verification = checkWorkerByNumber(num);

    if (!verification.valid) {
      if (verification.isAlreadyPointed && verification.ouvrier && verification.existingPointage) {
        // Bloquer et afficher "Déjà pointé" - AUCUN DOUBLON
        setWarningDuplicate({
          message: verification.error || 'Cet ouvrier a déjà été pointé aujourd\'hui !',
          pointage: verification.existingPointage,
          ouvrier: verification.ouvrier,
        });
      } else {
        // Numéro introuvable ou inactif
        setErrorMessage(verification.error || `Numéro ${num} introuvable dans la liste des ouvriers.`);
      }
      return;
    }

    // Ouvrier valide et non pointé : Enregistrer le pointage immédiat (la tâche n'est pas obligatoire)
    const targetOuvrier = verification.ouvrier!;
    const res = onPointWorker(targetOuvrier.id, null, selectedSessionDomaineId);

    if (res.success && res.pointage) {
      // Vider le champ de saisie
      setInputNumber('');
      setSearchQuery('');
      setShowSearchList(false);

      const domNom = domaines.find((d) => d.id === selectedSessionDomaineId)?.nom || 'D2';
      setSuccessMessage(`✓ Ouvrier #${targetOuvrier.numero} (${targetOuvrier.nom}) pointé présent (${domNom}) !`);

      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } else {
      setErrorMessage(res.message || 'Erreur lors de l\'enregistrement du pointage');
    }
  };

  // Clic direct sur un ouvrier de la liste des restants
  const handleDirectSelectWorker = (ouvrier: Ouvrier) => {
    handleValidateNumber(ouvrier.numero.toString());
  };

  // Affectation de tâche et validation du domaine
  const handleSelectTask = (tacheId: string | null, domaineId: string) => {
    if (pendingPointageId) {
      if (onUpdatePointage) {
        onUpdatePointage(pendingPointageId, { tacheId, domaineId });
      } else {
        onUpdateTask(pendingPointageId, tacheId);
      }
    }

    // Mémoriser le domaine choisi pour les prochains pointages de cette session
    setSelectedSessionDomaineId(domaineId);

    const ouvrierNom = pendingOuvrier?.nom || 'Ouvrier';
    const num = pendingOuvrier?.numero;
    const tacheObj = taches.find((t) => t.id === tacheId);
    const tacheNom = tacheObj ? formatTacheLabel(tacheObj) : 'Sans tâche';
    const domaineNom = domaines.find((d) => d.id === domaineId)?.nom || 'D2';

    setSuccessMessage(`✓ Pointage validé : #${num} ${ouvrierNom} ➔ [${domaineNom} • ${tacheNom}]`);
    setTaskModalOpen(false);
    setPendingOuvrier(null);
    setPendingPointageId(null);

    // Effacer le message de succès après 3.5 secondes
    setTimeout(() => {
      setSuccessMessage(null);
    }, 3500);
  };

  // Annuler le pointage en cours
  const handleCancelPendingPointage = () => {
    if (pendingPointageId) {
      onRemovePointage(pendingPointageId);
    }
    setTaskModalOpen(false);
    setPendingOuvrier(null);
    setPendingPointageId(null);
    setErrorMessage('Pointage annulé.');
  };

  // Modifier la tâche et le domaine d'un ouvrier déjà pointé
  const handleEditPointageTask = (detail: PointageDetailsItem) => {
    if (!detail.ouvrier) return;
    setPendingOuvrier(detail.ouvrier);
    setPendingPointageId(detail.pointage.id);
    setEditCurrentTacheId(detail.pointage.tache_id || null);
    setEditCurrentDomaineId(detail.pointage.domaine_id || defaultDomaineId || 'dom_d2');
    setIsEditMode(true);
    setTaskModalOpen(true);
  };

  // Gestion du pavé numérique virtuel
  const handleNumpadPress = (digit: string) => {
    clearMessages();
    if (digit === 'C') {
      setInputNumber('');
    } else if (digit === 'DEL') {
      setInputNumber((prev) => prev.slice(0, -1));
    } else {
      setInputNumber((prev) => (prev.length < 5 ? prev + digit : prev));
    }
  };

  // Filtrage de recherche
  const filteredRestants = ouvriersRestants.filter((o) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return o.numero.toString().includes(q) || o.nom.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-3 pb-24">
      {/* RAPPEL DISCRET SAUVEGARDE (> 7 JOURS) */}
      {isBackupOverdue && (
        <div className="bg-amber-50 border border-amber-300 text-amber-950 rounded-2xl p-2.5 px-3 flex items-center justify-between text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
            <span className="font-semibold text-amber-950">
              {lastBackupStr
                ? 'Dernière sauvegarde il y a plus de 7 jours.'
                : 'Pensez à faire une sauvegarde régulière dans Gestion.'}
            </span>
          </div>
          {onNavigateGestion && (
            <button
              type="button"
              onClick={onNavigateGestion}
              className="text-[11px] font-black text-amber-900 bg-amber-200 hover:bg-amber-300 px-2.5 py-1 rounded-xl transition"
            >
              Sauvegarder ➔
            </button>
          )}
        </div>
      )}

      {/* BANNIÈRE ROUGE D'ALERTE : STOCK BAS */}
      {gazoilStatus?.isStockBas && onNavigateGazoil && (
        <button
          type="button"
          onClick={onNavigateGazoil}
          className="w-full bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white p-3.5 rounded-2xl shadow-md border-2 border-red-500 animate-pulse flex items-center justify-between transition cursor-pointer text-left"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-yellow-300 shrink-0" />
            <div>
              <div className="font-black text-sm tracking-wide">
                Stock gazoil bas : {gazoilStatus.stockActuel} L
              </div>
              <div className="text-[11px] text-red-100">
                Seuil d'alerte configuré à {gazoilStatus.seuilAlerte} L • Appuyez pour commander
              </div>
            </div>
          </div>
          <span className="bg-white text-red-700 font-black text-xs px-2.5 py-1.5 rounded-xl shrink-0 shadow-2xs">
            Commander ➔
          </span>
        </button>
      )}

      {/* BADGE ORANGE : COMMANDE EN COURS */}
      {gazoilStatus?.commandeActive?.active && onNavigateGazoil && (
        <button
          type="button"
          onClick={onNavigateGazoil}
          className="w-full bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-slate-950 p-2.5 rounded-2xl shadow-sm border border-amber-400 flex items-center justify-between transition cursor-pointer text-left"
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="font-black text-xs">
              Commande en cours : {gazoilStatus.commandeActive.quantite} L le{' '}
              {gazoilStatus.commandeActive.date}
            </div>
          </div>
          <span className="bg-slate-950 text-white font-bold text-[10px] px-2 py-1 rounded-lg shrink-0">
            Détails ➔
          </span>
        </button>
      )}

      {/* LIGNE GAZOIL DANS L'ÉCRAN D'ACCUEIL AVEC STOCK ACTUEL */}
      {onNavigateGazoil && (
        <button
          type="button"
          onClick={onNavigateGazoil}
          className="w-full bg-white hover:bg-slate-50 active:scale-[0.99] border border-slate-200 p-3 rounded-2xl shadow-xs flex items-center justify-between transition group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                gazoilStatus?.isStockBas
                  ? 'bg-red-100 text-red-700'
                  : 'bg-slate-900 text-emerald-400'
              }`}
            >
              <Fuel className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                <span>Suivi Gazoil</span>
                {gazoilStatus?.commandeActive?.active ? (
                  <span className="bg-amber-100 text-amber-900 text-[10px] px-1.5 py-0.2 rounded-md font-bold">
                    Commande en cours
                  </span>
                ) : gazoilStatus?.isStockBas ? (
                  <span className="bg-red-100 text-red-800 text-[10px] px-1.5 py-0.2 rounded-md font-bold">
                    Stock bas
                  </span>
                ) : (
                  <span className="bg-emerald-50 text-emerald-700 text-[10px] px-1.5 py-0.2 rounded-md font-bold">
                    D2
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                Stock, entrées, sorties & commande WhatsApp
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div
                className={`text-base font-black ${
                  gazoilStatus?.isStockBas ? 'text-red-600' : 'text-emerald-700'
                }`}
              >
                {gazoilStatus?.initialSet ? `${gazoilStatus.stockActuel} L` : 'Non défini'}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">Stock disponible</div>
            </div>
            <span className="text-slate-400 group-hover:text-slate-700 font-bold text-xs pl-0.5">
              ➔
            </span>
          </div>
        </button>
      )}

      {/* BOUTON HEURES SUPPLÉMENTAIRES (ACCESSIBLE TOUT AU LONG DE LA JOURNÉE) */}
      {onOpenHeuresSupp && (
        <button
          type="button"
          onClick={onOpenHeuresSupp}
          className="w-full bg-linear-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 active:scale-[0.99] text-slate-950 p-3.5 rounded-2xl shadow-sm border border-amber-400 flex items-center justify-between transition group cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-950 text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
            <div className="text-left">
              <div className="font-black text-sm text-slate-950 flex items-center gap-2">
                <span>Heures supplémentaires</span>
                {heuresSuppCount > 0 ? (
                  <span className="bg-slate-950 text-amber-300 text-xs px-2 py-0.5 rounded-full font-bold">
                    {heuresSuppCount} ouvrier{heuresSuppCount > 1 ? 's' : ''}
                  </span>
                ) : (
                  <span className="bg-amber-400/80 text-amber-950 text-[10px] px-1.5 py-0.5 rounded-md font-bold">
                    Journée & Soir
                  </span>
                )}
              </div>
              <div className="text-[11px] text-amber-950 font-medium mt-0.5">
                Pointer les heures sup indépendamment du matin
              </div>
            </div>
          </div>
          <div className="bg-white/90 group-hover:bg-white text-slate-900 font-black text-xs px-3 py-2 rounded-xl shrink-0 shadow-2xs">
            Pointer ➔
          </div>
        </button>
      )}

      {/* SÉLECTEUR DE DOMAINE DU JOUR (D1 à D5, pré-sélectionné sur D2) */}
      {domaines.length > 0 && (
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-3">
          <div className="flex items-center justify-between mb-2 px-0.5 text-xs font-black">
            <span className="text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
              Domaine du jour
            </span>
            <span className="text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-200">
              Actif : {domaines.find((d) => d.id === selectedSessionDomaineId)?.nom || 'D2'}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1.5">
            {domaines.map((d) => {
              const isSelected = selectedSessionDomaineId === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedSessionDomaineId(d.id)}
                  className={`h-11 rounded-xl font-black text-sm flex items-center justify-center transition active:scale-95 border-2 cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm ring-2 ring-emerald-300'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {d.nom}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION SAISIE DU NUMÉRO */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
            Saisie Numéro Ouvrier
          </label>
          <button
            type="button"
            onClick={() => setShowNumpad(!showNumpad)}
            className="text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition flex items-center gap-1"
          >
            {showNumpad ? 'Masquer pavé' : 'Afficher pavé'}
            {showNumpad ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Grand champ d'affichage / saisie */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={inputNumber}
            onChange={(e) => {
              clearMessages();
              setInputNumber(e.target.value.replace(/[^0-9]/g, ''));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleValidateNumber();
              }
            }}
            placeholder="Numéro (ex: 7)"
            className="w-full h-16 text-3xl font-black text-center tracking-wider text-slate-900 bg-slate-50 border-2 border-slate-300 rounded-2xl focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/20 outline-none transition"
          />

          {inputNumber && (
            <button
              type="button"
              onClick={() => {
                setInputNumber('');
                clearMessages();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600 rounded-full"
              title="Effacer"
            >
              <XCircle className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Prévisualisation du nom si le numéro correspond */}
        {inputNumber && (
          <div className="mt-1.5 text-center min-h-[22px]">
            {(() => {
              const num = parseInt(inputNumber, 10);
              const found = activeOuvriers.find((o) => o.numero === num);
              if (found) {
                return (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-md">
                    👤 Ouvrier trouvé : {found.nom}
                  </span>
                );
              }
              return (
                <span className="text-[11px] font-medium text-slate-400">
                  Appuyez sur "Valider" pour pointer
                </span>
              );
            })()}
          </div>
        )}

        {/* Gros bouton de validation accessible d'une main */}
        <button
          type="button"
          onClick={() => handleValidateNumber()}
          disabled={!inputNumber}
          className="w-full h-14 mt-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-400 text-lg font-black rounded-2xl shadow-md disabled:shadow-none flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
        >
          <CheckCircle2 className="w-6 h-6" />
          <span>VALIDER LE POINTAGE</span>
        </button>

        {/* Pavé Numérique Virtuel Grand Format (Optimisé smartphone une seule main) */}
        {showNumpad && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleNumpadPress(digit)}
                  className="h-13 bg-slate-100 hover:bg-emerald-50 active:bg-emerald-200 text-slate-800 hover:text-emerald-900 text-2xl font-black rounded-xl border border-slate-200 transition active:scale-95 shadow-2xs"
                >
                  {digit}
                </button>
              ))}

              <button
                type="button"
                onClick={() => handleNumpadPress('C')}
                className="h-13 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl border border-red-200 text-sm flex items-center justify-center transition active:scale-95"
              >
                EFFACER
              </button>

              <button
                type="button"
                onClick={() => handleNumpadPress('0')}
                className="h-13 bg-slate-100 hover:bg-emerald-50 active:bg-emerald-200 text-slate-800 text-2xl font-black rounded-xl border border-slate-200 transition active:scale-95"
              >
                0
              </button>

              <button
                type="button"
                onClick={() => handleNumpadPress('DEL')}
                className="h-13 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold rounded-xl border border-amber-200 flex items-center justify-center transition active:scale-95"
                title="Supprimer dernier chiffre"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Barre de recherche rapide d'ouvrier (alternative ou complément) */}
        <div className="mt-3 pt-2 border-t border-slate-100">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id={searchInputId}
              type="text"
              value={searchQuery}
              onFocus={() => setShowSearchList(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchList(true);
              }}
              placeholder="Rechercher par nom ou numéro..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold placeholder:text-slate-400 focus:bg-white focus:border-emerald-500 outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchList(false);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* Liste déroulante des résultats de recherche */}
          {showSearchList && searchQuery.trim().length > 0 && (
            <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100 z-30">
              {filteredRestants.length === 0 ? (
                <div className="p-3 text-xs text-center text-slate-400">
                  Aucun ouvrier restant correspondant
                </div>
              ) : (
                filteredRestants.slice(0, 8).map((ouvrier) => (
                  <button
                    key={ouvrier.id}
                    type="button"
                    onClick={() => {
                      handleDirectSelectWorker(ouvrier);
                    }}
                    className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-emerald-50 text-xs transition"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white font-black text-center leading-6 shrink-0">
                        {ouvrier.numero}
                      </span>
                      <span className="font-bold text-slate-800">{ouvrier.nom}</span>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md">
                      Pointer ➔
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ALERTES ET NOTIFICATIONS */}

      {/* ERREUR : Numéro introuvable */}
      {errorMessage && (
        <div className="bg-red-50 border-2 border-red-300 text-red-900 rounded-2xl p-3 flex items-start gap-2.5 shadow-sm animate-in slide-in-from-top-2">
          <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <div className="font-black text-sm text-red-800">Numéro introuvable</div>
            <div className="font-medium mt-0.5">{errorMessage}</div>
          </div>
        </div>
      )}

      {/* ALERTE STRICTE : DÉJÀ POINTÉ (AUCUN DOUBLON) */}
      {warningDuplicate && (
        <div className="bg-amber-50 border-2 border-amber-400 text-amber-950 rounded-2xl p-3.5 shadow-md animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-amber-900 uppercase">
                  Déjà pointé !
                </span>
                <span className="text-xs bg-amber-200 text-amber-900 font-bold px-1.5 py-0.2 rounded-md">
                  Doublon bloqué
                </span>
              </div>
              <div className="text-xs font-bold text-amber-900 mt-1">
                #{warningDuplicate.ouvrier.numero} — {warningDuplicate.ouvrier.nom}
              </div>
              <div className="text-xs text-amber-800 mt-0.5 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                <span>Pointé aujourd'hui à {warningDuplicate.pointage.heure}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUCCÈS : Pointage validé */}
      {successMessage && (
        <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-950 rounded-2xl p-3 flex items-center gap-2.5 shadow-xs animate-in slide-in-from-top-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="text-xs font-bold text-emerald-900">{successMessage}</div>
        </div>
      )}

      {/* ONGLETS DES LISTES : À POINTER / PRÉSENTS */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {/* En-tête des onglets */}
        <div className="grid grid-cols-2 p-1 bg-slate-100 border-b border-slate-200 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('restants')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition ${
              activeTab === 'restants'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>À pointer</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                activeTab === 'restants' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {ouvriersRestants.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pointes')}
            className={`py-2.5 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition ${
              activeTab === 'pointes'
                ? 'bg-white text-emerald-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Présents</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                activeTab === 'pointes'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {pointesDetails.length}
            </span>
          </button>
        </div>

        {/* CONTENU ONGLET 1 : À POINTER (Ouvriers restants) */}
        {activeTab === 'restants' && (
          <div className="p-3">
            <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
              <span>Toucher un ouvrier pour le pointer directement :</span>
              <span className="font-mono">{ouvriersRestants.length} restant(s)</span>
            </div>

            {ouvriersRestants.length === 0 ? (
              <div className="text-center py-8 text-emerald-800 bg-emerald-50 rounded-2xl border border-emerald-100">
                <Sparkles className="w-8 h-8 mx-auto text-emerald-600 mb-2" />
                <div className="text-sm font-black">Tous les ouvriers ont été pointés !</div>
                <div className="text-xs text-emerald-600 mt-1">
                  Le récapitulatif WhatsApp est prêt.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                {ouvriersRestants.map((ouvrier) => (
                  <button
                    key={ouvrier.id}
                    type="button"
                    onClick={() => handleDirectSelectWorker(ouvrier)}
                    className="w-full p-2.5 bg-slate-50 hover:bg-emerald-50 active:bg-emerald-100 border border-slate-200 hover:border-emerald-400 rounded-xl flex items-center justify-between transition text-left group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-emerald-700 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-2xs transition">
                        {ouvrier.numero}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-800 group-hover:text-emerald-950 truncate">
                          {ouvrier.nom}
                        </div>
                        <div className="text-[10px] text-slate-400">À pointer</div>
                      </div>
                    </div>

                    <div className="shrink-0 text-emerald-600 font-bold text-xs bg-white group-hover:bg-emerald-600 group-hover:text-white px-2 py-1 rounded-lg border border-slate-200 group-hover:border-emerald-600 transition">
                      Pointer
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONTENU ONGLET 2 : PRÉSENTS (Déjà pointés aujourd'hui) */}
        {activeTab === 'pointes' && (
          <div className="p-3">
            <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-2">
              <span>Ouvriers enregistrés aujourd'hui :</span>
              <span className="font-mono">{pointesDetails.length} présent(s)</span>
            </div>

            {pointesDetails.length === 0 ? (
              <div className="text-center py-8 text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="text-sm font-semibold">Aucun ouvrier pointé pour le moment</div>
                <div className="text-xs text-slate-400 mt-1">
                  Saisissez un numéro ci-dessus pour démarrer.
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {[...pointesDetails]
                  .sort((a, b) => a.pointage.numero_ouvrier - b.pointage.numero_ouvrier)
                  .map((item) => {
                  return (
                    <div
                      key={item.pointage.id}
                      className="p-2.5 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs hover:border-slate-300 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-black text-sm flex items-center justify-center shrink-0">
                          {item.pointage.numero_ouvrier}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-800 truncate">
                            {item.ouvrier?.nom || `Ouvrier #${item.pointage.numero_ouvrier}`}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                            <span className="flex items-center gap-0.5">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {item.pointage.heure}
                            </span>
                            <span>•</span>
                            <span className="font-black bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded-md text-[9px] border border-blue-200">
                              {item.domaine ? item.domaine.nom : (domaines.find((d) => d.id === item.pointage.domaine_id)?.nom || 'D2')}
                            </span>
                            <span>•</span>
                            {item.taches && item.taches.length > 0 ? (
                              item.taches.map((t) => (
                                <span
                                  key={t.id}
                                  className="inline-flex items-center gap-1 font-bold px-1.5 py-0.2 rounded-md text-white text-[9px]"
                                  style={{ backgroundColor: t.couleur || '#16a34a' }}
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {formatTacheLabel(t)}
                                </span>
                              ))
                            ) : item.tache ? (
                              <span
                                className="inline-flex items-center gap-1 font-bold px-1.5 py-0.2 rounded-md text-white text-[9px]"
                                style={{ backgroundColor: item.tache.couleur || '#16a34a' }}
                              >
                                <Tag className="w-2.5 h-2.5" />
                                {formatTacheLabel(item.tache)}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sans tâche</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Actions : Modifier tâche ou Supprimer pointage */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEditPointageTask(item)}
                          className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                          title="Modifier la tâche"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Annuler le pointage de l'ouvrier #${item.pointage.numero_ouvrier} ?`)) {
                              onRemovePointage(item.pointage.id);
                            }
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Annuler ce pointage"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* MODALE D'AFFECTATION DE TÂCHE ET DOMAINE */}
      <TaskModal
        isOpen={taskModalOpen}
        ouvrier={pendingOuvrier}
        taches={taches}
        domaines={domaines}
        currentTacheId={isEditMode ? editCurrentTacheId : null}
        currentDomaineId={isEditMode ? editCurrentDomaineId : selectedSessionDomaineId}
        defaultDomaineId={defaultDomaineId}
        onSelectTask={handleSelectTask}
        onCancelPointage={!isEditMode ? handleCancelPendingPointage : undefined}
        isEditMode={isEditMode}
      />
    </div>
  );
};
