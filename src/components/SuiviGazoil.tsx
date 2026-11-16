/**
 * ÉCRAN SUIVI DU GAZOIL (Carburant D2)
 * - Gestion du stock initial (modifiable avec confirmation)
 * - Stock actuel = Stock initial + Entrées - Sorties
 * - Enregistrement d'entrées (achat/livraison) et de sorties (consommation engins/pompes)
 * - Blocage des sorties supérieures au stock disponible
 * - Alerte stock bas (bannière rouge + notification navigateur)
 * - Commande Gazoil WhatsApp (format strict D2) et suivi de commande en cours
 * - Historique avec suppression d'erreur
 * - 100% Hors-connexion
 */

import React, { useState } from 'react';
import {
  Fuel,
  PlusCircle,
  MinusCircle,
  MessageSquare,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Trash2,
  Copy,
  Check,
  Calendar,
  X,
  Truck,
  Tractor,
  Layers,
  Settings,
  HelpCircle,
  ExternalLink,
} from 'lucide-react';
import { GazoilMouvement, GazoilMouvementType } from '../types';
import * as storage from '../services/storage';

interface SuiviGazoilProps {
  companyName: string;
  gazoilStatus: {
    stockInitial: number;
    totalEntrees: number;
    totalSorties: number;
    stockActuel: number;
    seuilAlerte: number;
    isStockBas: boolean;
    initialSet: boolean;
    commandeActive: {
      active: boolean;
      date: string;
      quantite: number;
      fournisseur_tel?: string;
    } | null;
  };
  mouvements: GazoilMouvement[];
  onSetStockInitial: (stock: number) => void;
  onAddMouvement: (mvt: {
    type: GazoilMouvementType;
    date: string;
    quantite: number;
    engin_ou_tache?: string;
    remarque?: string;
  }) => { success: boolean; error?: string; mvt?: GazoilMouvement };
  onDeleteMouvement: (id: string) => void;
  onLancerCommande: (quantite: number, dateStr: string, tel?: string) => void;
  onCloturerCommande: () => void;
  onOpenGestion?: () => void;
}

// Convertir une date ISO (YYYY-MM-DD) en format français (JJ/MM/AAAA)
function formatDateJJMM(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

// Obtenir la date du jour en format ISO YYYY-MM-DD
function getTodayIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const SuiviGazoil: React.FC<SuiviGazoilProps> = ({
  companyName,
  gazoilStatus,
  mouvements,
  onSetStockInitial,
  onAddMouvement,
  onDeleteMouvement,
  onLancerCommande,
  onCloturerCommande,
  onOpenGestion,
}) => {
  // États des modales
  const [showInitialStockModal, setShowInitialStockModal] = useState<boolean>(!gazoilStatus.initialSet);
  const [initialStockInput, setInitialStockInput] = useState<string>(
    gazoilStatus.stockInitial > 0 ? gazoilStatus.stockInitial.toString() : ''
  );
  const [confirmEditInitial, setConfirmEditInitial] = useState<boolean>(false);

  // Modale Mouvement (Entrée ou Sortie)
  const [modalMouvementType, setModalMouvementType] = useState<GazoilMouvementType | null>(null);
  const [mvtDate, setMvtDate] = useState<string>(getTodayIso);
  const [mvtQuantite, setMvtQuantite] = useState<string>('');
  const [mvtEngin, setMvtEngin] = useState<string>('');
  const [mvtRemarque, setMvtRemarque] = useState<string>('');
  const [mvtError, setMvtError] = useState<string | null>(null);

  // Modale Commande WhatsApp
  const [showCommandeModal, setShowCommandeModal] = useState<boolean>(false);
  const [commandeQuantite, setCommandeQuantite] = useState<number>(100);
  const [commandeFournisseurTel, setCommandeFournisseurTel] = useState<string>('');
  const [copiedSuccess, setCopiedSuccess] = useState<boolean>(false);
  const [commandeSentPrompt, setCommandeSentPrompt] = useState<boolean>(false);

  // Filtre historique
  const [historyFilter, setHistoryFilter] = useState<'tous' | 'entree' | 'sortie'>('tous');

  // Suggestions d'engins / matériels courants
  const suggestionsEngins = [
    'Tracteur 1',
    'Tracteur 2',
    'Pompe irrigation',
    'Groupe électrogène',
    'Pulvérisateur',
    'Camionnette',
  ];

  // Message WhatsApp formaté selon les exigences exactes du patron :
  // Commande D2
  // DATE : JJ/MM/AAAA
  // 100 L Gazoil
  // Aujourd'hui
  const todayFormatted = formatDateJJMM(getTodayIso());
  const formattedWhatsAppMessage = `Commande D2\nDATE : ${todayFormatted}\n${commandeQuantite} L Gazoil\nAujourd'hui`;

  // Validation de l'enregistrement du stock initial
  const handleSaveInitialStock = () => {
    const val = parseFloat(initialStockInput.replace(',', '.'));
    if (isNaN(val) || val < 0) {
      alert('Veuillez saisir une valeur de stock valide (ex: 150).');
      return;
    }

    if (gazoilStatus.initialSet && !confirmEditInitial) {
      setConfirmEditInitial(true);
      return;
    }

    // Demander l'autorisation pour les notifications navigateur dès la configuration initiale
    storage.requestBrowserNotificationPermission();

    onSetStockInitial(val);
    setShowInitialStockModal(false);
    setConfirmEditInitial(false);
  };

  // Soumission d'un mouvement (Entrée ou Sortie)
  const handleSubmitMouvement = (e: React.FormEvent) => {
    e.preventDefault();
    setMvtError(null);

    if (!modalMouvementType) return;

    const qty = parseFloat(mvtQuantite.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      setMvtError('Veuillez saisir une quantité supérieure à 0 L.');
      return;
    }

    // Contrôle bloquant : Sortie > Stock disponible
    if (modalMouvementType === 'sortie' && qty > gazoilStatus.stockActuel) {
      setMvtError(
        `Impossible : la quantité demandée (${qty} L) dépasse le stock disponible (${gazoilStatus.stockActuel} L).`
      );
      return;
    }

    const res = onAddMouvement({
      type: modalMouvementType,
      date: mvtDate || getTodayIso(),
      quantite: qty,
      engin_ou_tache: modalMouvementType === 'sortie' ? mvtEngin : undefined,
      remarque: mvtRemarque,
    });

    if (!res.success) {
      setMvtError(res.error || "Erreur lors de l'enregistrement.");
      return;
    }

    // Fermer et réinitialiser
    setModalMouvementType(null);
    setMvtQuantite('');
    setMvtEngin('');
    setMvtRemarque('');
    setMvtError(null);
  };

  // Envoi WhatsApp
  const handleOpenWhatsApp = () => {
    // Nettoyer le numéro de téléphone si fourni
    let cleanTel = commandeFournisseurTel.replace(/[^0-9+]/g, '');
    if (cleanTel.startsWith('0')) {
      // Préfixe marocain par défaut si commence par 0 (ex: 06... -> 2126...)
      cleanTel = '212' + cleanTel.substring(1);
    }
    if (cleanTel.startsWith('+')) {
      cleanTel = cleanTel.substring(1);
    }

    const encodedText = encodeURIComponent(formattedWhatsAppMessage);
    const url = cleanTel
      ? `https://wa.me/${cleanTel}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`;

    // Ouvrir WhatsApp
    window.open(url, '_blank', 'noopener,noreferrer');
    setCommandeSentPrompt(true);
  };

  // Copier le message WhatsApp
  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(formattedWhatsAppMessage);
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2500);
    } catch {
      alert('Impossible de copier automatiquement. Veuillez sélectionner et copier le texte.');
    }
  };

  // Valider la commande lancée
  const handleConfirmCommandeLancee = () => {
    onLancerCommande(commandeQuantite, todayFormatted, commandeFournisseurTel);
    setShowCommandeModal(false);
    setCommandeSentPrompt(false);
  };

  // Filtrage de l'historique
  const filteredMouvements = mouvements.filter((m) => {
    if (historyFilter === 'tous') return true;
    return m.type === historyFilter;
  });

  return (
    <div className="space-y-3 pb-24">
      {/* BANNIÈRE ROUGE D'ALERTE : STOCK BAS */}
      {gazoilStatus.isStockBas && (
        <div className="bg-red-600 text-white p-3.5 rounded-2xl shadow-md border-2 border-red-500 animate-pulse flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-6 h-6 text-yellow-300 shrink-0" />
            <div>
              <div className="font-black text-sm tracking-wide">
                Stock gazoil bas : {gazoilStatus.stockActuel} L
              </div>
              <div className="text-xs text-red-100">
                Seuil d'alerte configuré à {gazoilStatus.seuilAlerte} L
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowCommandeModal(true);
              setCommandeSentPrompt(false);
            }}
            className="bg-white text-red-700 hover:bg-red-50 font-black text-xs px-3 py-1.5 rounded-xl shadow-xs shrink-0 cursor-pointer transition active:scale-95"
          >
            Commander ➔
          </button>
        </div>
      )}

      {/* BADGE ORANGE : COMMANDE EN COURS */}
      {gazoilStatus.commandeActive?.active && (
        <div className="bg-amber-500 text-slate-950 p-3 rounded-2xl shadow-sm border border-amber-400 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="font-black text-xs sm:text-sm">
                Commande en cours : {gazoilStatus.commandeActive.quantite} L le{' '}
                {gazoilStatus.commandeActive.date}
              </div>
              <div className="text-[11px] text-amber-950 font-medium">
                Se clôturera automatiquement lors de la réception
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCloturerCommande}
            className="bg-slate-950 hover:bg-slate-900 text-white font-bold text-xs px-2.5 py-1.5 rounded-xl shrink-0 transition active:scale-95"
            title="Marquer comme reçue"
          >
            Reçue ✓
          </button>
        </div>
      )}

      {/* CARTE PRINCIPALE : STOCK ACTUEL EN GROS */}
      <div className="bg-linear-to-br from-slate-900 via-slate-850 to-slate-800 text-white rounded-3xl p-5 shadow-xl border border-slate-700 relative overflow-hidden">
        {/* Décoration en arrière-plan */}
        <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none">
          <Fuel className="w-40 h-40 text-emerald-400" />
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-xs font-black uppercase tracking-wider text-emerald-300">
              Suivi Gazoil • Lahcen Pointeur
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setInitialStockInput(gazoilStatus.stockInitial.toString());
              setConfirmEditInitial(false);
              setShowInitialStockModal(true);
            }}
            className="text-[11px] font-bold text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 px-2.5 py-1 rounded-lg border border-slate-600 transition flex items-center gap-1"
            title="Modifier le stock initial"
          >
            <Settings className="w-3 h-3" />
            Stock initial
          </button>
        </div>

        {/* AFFICHAGE DU STOCK EN GROS */}
        <div className="py-2 text-center">
          <div className="text-[11px] font-medium text-slate-400 uppercase tracking-widest">
            Stock Disponible Actuel
          </div>
          <div className="flex items-baseline justify-center gap-2 mt-1">
            <span
              className={`text-5xl sm:text-6xl font-black tracking-tight ${
                gazoilStatus.isStockBas ? 'text-red-400 animate-pulse' : 'text-emerald-400'
              }`}
            >
              {gazoilStatus.stockActuel}
            </span>
            <span className="text-2xl font-bold text-slate-300">Litres</span>
          </div>
        </div>

        {/* DÉCOMPOSITION : INITIAL + ENTRÉES - SORTIES */}
        <div className="mt-3 pt-3 border-t border-slate-700/60 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-800/60 rounded-xl p-2">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">Initial</div>
            <div className="font-bold text-slate-200 mt-0.5">{gazoilStatus.stockInitial} L</div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-2">
            <div className="text-[10px] text-emerald-400 uppercase font-semibold">+ Entrées</div>
            <div className="font-bold text-emerald-400 mt-0.5">+{gazoilStatus.totalEntrees} L</div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-2">
            <div className="text-[10px] text-rose-400 uppercase font-semibold">− Sorties</div>
            <div className="font-bold text-rose-400 mt-0.5">-{gazoilStatus.totalSorties} L</div>
          </div>
        </div>
      </div>

      {/* BOUTONS D'ACTIONS PRINCIPALES */}
      <div className="grid grid-cols-2 gap-2">
        {/* BOUTON NOUVELLE ENTRÉE */}
        <button
          type="button"
          onClick={() => {
            setModalMouvementType('entree');
            setMvtDate(getTodayIso());
            setMvtQuantite('');
            setMvtRemarque('');
            setMvtError(null);
          }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white p-3.5 rounded-2xl shadow-sm flex items-center justify-center gap-2 font-black text-sm transition active:scale-95 cursor-pointer"
        >
          <PlusCircle className="w-5 h-5 text-emerald-200" />
          <span>+ Entrée (Achat)</span>
        </button>

        {/* BOUTON NOUVELLE SORTIE */}
        <button
          type="button"
          onClick={() => {
            setModalMouvementType('sortie');
            setMvtDate(getTodayIso());
            setMvtQuantite('');
            setMvtEngin('');
            setMvtRemarque('');
            setMvtError(null);
          }}
          className="bg-rose-600 hover:bg-rose-700 text-white p-3.5 rounded-2xl shadow-sm flex items-center justify-center gap-2 font-black text-sm transition active:scale-95 cursor-pointer"
        >
          <MinusCircle className="w-5 h-5 text-rose-200" />
          <span>− Sortie (Engin)</span>
        </button>
      </div>

      {/* BOUTON COMMANDE GAZOIL (WHATSAPP) */}
      <button
        type="button"
        onClick={() => {
          setShowCommandeModal(true);
          setCommandeSentPrompt(false);
        }}
        className="w-full bg-linear-to-r from-[#075E54] to-[#128C7E] hover:from-[#128C7E] hover:to-[#075E54] active:scale-[0.99] text-white p-3.5 rounded-2xl shadow-md flex items-center justify-between transition cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5 text-[#25D366]" />
          </div>
          <div className="text-left">
            <div className="font-black text-sm flex items-center gap-1.5">
              <span>Commande gazoil</span>
              <span className="bg-[#25D366] text-slate-950 text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase">
                WhatsApp
              </span>
            </div>
            <div className="text-[11px] text-emerald-100">
              Message D2 prêt à l'envoi • Par défaut 100 L
            </div>
          </div>
        </div>
        <div className="bg-white text-emerald-950 font-black text-xs px-3 py-2 rounded-xl shrink-0 shadow-2xs">
          Commander ➔
        </div>
      </button>

      {/* HISTORIQUE DES MOUVEMENTS */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-3 sm:p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-black text-slate-800">Historique des Mouvements</h3>
            <p className="text-[11px] text-slate-500">Du plus récent au plus ancien</p>
          </div>

          {/* Filtre */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => setHistoryFilter('tous')}
              className={`px-2 py-1 rounded-lg transition ${
                historyFilter === 'tous' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
              }`}
            >
              Tous ({mouvements.length})
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter('entree')}
              className={`px-2 py-1 rounded-lg transition ${
                historyFilter === 'entree' ? 'bg-emerald-600 text-white shadow-2xs' : 'text-slate-500'
              }`}
            >
              Entrées
            </button>
            <button
              type="button"
              onClick={() => setHistoryFilter('sortie')}
              className={`px-2 py-1 rounded-lg transition ${
                historyFilter === 'sortie' ? 'bg-rose-600 text-white shadow-2xs' : 'text-slate-500'
              }`}
            >
              Sorties
            </button>
          </div>
        </div>

        {filteredMouvements.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <Fuel className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-medium">Aucun mouvement enregistré pour le moment.</p>
            <p className="text-[11px] text-slate-400 mt-1">
              Utilisez les boutons ci-dessus pour ajouter des entrées ou des sorties.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto pr-1">
            {filteredMouvements.map((mvt) => (
              <div
                key={mvt.id}
                className="py-2.5 flex items-center justify-between gap-2 hover:bg-slate-50/80 rounded-xl px-1.5 transition"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-xs ${
                      mvt.type === 'entree'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                    }`}
                  >
                    {mvt.type === 'entree' ? (
                      <Truck className="w-4 h-4 text-emerald-700" />
                    ) : (
                      <Tractor className="w-4 h-4 text-rose-700" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-800">
                        {mvt.type === 'entree' ? 'Entrée / Livraison' : 'Sortie / Consommation'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {formatDateJJMM(mvt.date)}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600 truncate flex items-center gap-1.5 mt-0.5">
                      {mvt.engin_ou_tache && (
                        <span className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-semibold text-[10px]">
                          {mvt.engin_ou_tache}
                        </span>
                      )}
                      {mvt.remarque && <span className="text-slate-500 italic">"{mvt.remarque}"</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div
                    className={`text-sm font-black ${
                      mvt.type === 'entree' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {mvt.type === 'entree' ? `+${mvt.quantite} L` : `-${mvt.quantite} L`}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Supprimer ce mouvement de ${mvt.quantite} L du ${formatDateJJMM(mvt.date)} ? Le stock sera recalculé.`
                        )
                      ) {
                        onDeleteMouvement(mvt.id);
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Supprimer cette erreur"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODALE 1 : CONFIGURATION DU STOCK INITIAL */}
      {/* ========================================================================= */}
      {showInitialStockModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <Fuel className="w-5 h-5 text-emerald-700" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">Stock Initial (L)</h3>
                  <p className="text-xs text-slate-500">Point de départ de la jauge</p>
                </div>
              </div>
              {gazoilStatus.initialSet && (
                <button
                  type="button"
                  onClick={() => {
                    setShowInitialStockModal(false);
                    setConfirmEditInitial(false);
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            <p className="text-xs text-slate-600 mb-4 leading-relaxed">
              {gazoilStatus.initialSet
                ? "Vous modifiez la valeur de base du stock initial. Le stock actuel sera recalculé selon la formule : Stock initial + Entrées − Sorties."
                : "Indiquez la quantité de gazoil actuellement présente dans vos cuves ou fûts à la première utilisation."}
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Quantité de gazoil en Litres
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={initialStockInput}
                    onChange={(e) => setInitialStockInput(e.target.value)}
                    placeholder="Ex : 150"
                    className="w-full text-2xl font-black text-center py-3 bg-slate-50 border-2 border-slate-300 rounded-2xl focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/20 outline-none transition"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    Litres
                  </span>
                </div>
              </div>

              {confirmEditInitial && (
                <div className="bg-amber-50 border border-amber-300 p-3 rounded-xl text-xs text-amber-900 font-medium">
                  ⚠️ <strong>Confirmation demandée :</strong> Êtes-vous sûr de vouloir remplacer le
                  stock initial par <strong>{initialStockInput} L</strong> ?
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {gazoilStatus.initialSet && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowInitialStockModal(false);
                      setConfirmEditInitial(false);
                    }}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition text-xs"
                  >
                    Annuler
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveInitialStock}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 rounded-xl shadow-md transition active:scale-95 text-xs"
                >
                  {confirmEditInitial
                    ? 'Confirmer la modification'
                    : gazoilStatus.initialSet
                    ? 'Modifier le stock'
                    : 'Enregistrer le stock initial'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALE 2 : NOUVELLE ENTRÉE OU SORTIE */}
      {/* ========================================================================= */}
      {modalMouvementType && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    modalMouvementType === 'entree'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {modalMouvementType === 'entree' ? (
                    <PlusCircle className="w-5 h-5 text-emerald-700" />
                  ) : (
                    <MinusCircle className="w-5 h-5 text-rose-700" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">
                    {modalMouvementType === 'entree'
                      ? 'Nouvelle Entrée Gazoil'
                      : 'Nouvelle Sortie Gazoil'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {modalMouvementType === 'entree'
                      ? 'Achat, livraison cuve ou fût'
                      : 'Consommation engins ou pompes'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModalMouvementType(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {mvtError && (
              <div className="bg-rose-50 border border-rose-300 text-rose-900 p-3 rounded-xl text-xs font-semibold mb-3">
                {mvtError}
              </div>
            )}

            <form onSubmit={handleSubmitMouvement} className="space-y-3">
              {/* DATE */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={mvtDate}
                  onChange={(e) => setMvtDate(e.target.value)}
                  required
                  className="w-full text-sm font-semibold p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                />
              </div>

              {/* QUANTITÉ */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">Quantité en Litres</label>
                  {modalMouvementType === 'sortie' && (
                    <span className="text-[11px] font-bold text-slate-500">
                      Dispo :{' '}
                      <span className="text-emerald-700">{gazoilStatus.stockActuel} L</span>
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    value={mvtQuantite}
                    onChange={(e) => {
                      setMvtError(null);
                      setMvtQuantite(e.target.value);
                    }}
                    placeholder="Ex: 50"
                    required
                    autoFocus
                    className="w-full text-2xl font-black text-center py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    Litres
                  </span>
                </div>
              </div>

              {/* ENGIN / MATÉRIEL (POUR LES SORTIES SEULEMENT) */}
              {modalMouvementType === 'sortie' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Engin ou Matériel (optionnel)
                  </label>
                  <input
                    type="text"
                    value={mvtEngin}
                    onChange={(e) => setMvtEngin(e.target.value)}
                    placeholder="Ex: Tracteur 1, Pompe irrigation..."
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                  />
                  {/* Suggestions rapides */}
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {suggestionsEngins.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        onClick={() => setMvtEngin(sug)}
                        className={`text-[10px] px-2 py-0.5 rounded-lg border transition ${
                          mvtEngin === sug
                            ? 'bg-rose-100 border-rose-300 text-rose-800 font-bold'
                            : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* REMARQUE OPTIONNELLE */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Remarque / N° Bon (optionnel)
                </label>
                <input
                  type="text"
                  value={mvtRemarque}
                  onChange={(e) => setMvtRemarque(e.target.value)}
                  placeholder={
                    modalMouvementType === 'entree'
                      ? 'Ex: Bon Afriquia #402, citerne...'
                      : 'Ex: Plein pour labour parcelle 3...'
                  }
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                />
              </div>

              {/* Indication pour l'entrée si commande active */}
              {modalMouvementType === 'entree' && gazoilStatus.commandeActive?.active && (
                <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-[11px] text-emerald-900">
                  ℹ️ L'enregistrement de cette entrée marquera automatiquement la commande en cours
                  comme <strong>reçue</strong>.
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalMouvementType(null)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl transition text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`flex-1 text-white font-black py-2.5 rounded-xl shadow-md transition active:scale-95 text-xs ${
                    modalMouvementType === 'entree'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {modalMouvementType === 'entree' ? 'Ajouter entrée' : 'Enregistrer sortie'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALE 3 : COMMANDE GAZOIL (WHATSAPP D2) */}
      {/* ========================================================================= */}
      {showCommandeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-[#25D366]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">Commande Gazoil</h3>
                  <p className="text-xs text-slate-500">Envoi WhatsApp au fournisseur</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCommandeModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {/* QUANTITÉ À COMMANDER */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Quantité à commander (L)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="10"
                    step="10"
                    value={commandeQuantite}
                    onChange={(e) => setCommandeQuantite(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-xl font-black text-center py-2 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                  />
                  <div className="flex gap-1">
                    {[50, 100, 200].map((quick) => (
                      <button
                        key={quick}
                        type="button"
                        onClick={() => setCommandeQuantite(quick)}
                        className={`text-xs px-2.5 py-2 rounded-xl font-bold border transition ${
                          commandeQuantite === quick
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                        }`}
                      >
                        {quick}L
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* N° DU FOURNISSEUR OPTIONNEL */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Téléphone du Fournisseur (optionnel)
                </label>
                <input
                  type="tel"
                  value={commandeFournisseurTel}
                  onChange={(e) => setCommandeFournisseurTel(e.target.value)}
                  placeholder="Ex : 0612345678 (laisser vide pour choisir contact)"
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                />
              </div>

              {/* APERÇU DU MESSAGE STRICT */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                    Message généré pour WhatsApp
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyMessage}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                  >
                    {copiedSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Copié !</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copier</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="bg-slate-900 text-emerald-300 p-3 rounded-xl font-mono text-xs whitespace-pre-line border border-slate-700 select-all">
                  {formattedWhatsAppMessage}
                </div>
              </div>

              {/* BOUTONS D'ENVOI */}
              <div className="pt-1 space-y-2">
                <button
                  type="button"
                  onClick={handleOpenWhatsApp}
                  className="w-full bg-[#25D366] hover:bg-[#1ebd5a] active:scale-[0.99] text-slate-950 font-black py-3 rounded-xl shadow-md flex items-center justify-center gap-2 text-sm transition cursor-pointer"
                >
                  <MessageSquare className="w-5 h-5" />
                  <span>Envoyer via WhatsApp</span>
                </button>

                {/* PROPOSITION "COMMANDE LANCÉE" */}
                <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-center space-y-2">
                  <div className="text-xs font-semibold text-amber-950">
                    Avez-vous envoyé la commande au fournisseur ?
                  </div>
                  <button
                    type="button"
                    onClick={handleConfirmCommandeLancee}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-black py-2.5 rounded-xl shadow-xs transition active:scale-95 text-xs flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Marquer "Commande lancée ({commandeQuantite} L)"</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
