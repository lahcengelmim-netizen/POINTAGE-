/**
 * Modal / Écran de Saisie des Heures Supplémentaires
 * - Saisie "Par heures" (nombre d'heures optionnel)
 * - Saisie "Par tâche" (choix de tâche, quantité obligatoire, unité suggérée : ruban, forfait, heure)
 * - Support multi-entrées par ouvrier sans doublon sur la même tâche (mise à jour automatique)
 * - Modification et suppression des entrées
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  X,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Trash2,
  Edit2,
  Plus,
  Users,
  Tag,
  RotateCcw,
} from 'lucide-react';
import { Ouvrier, Tache, HeureSupplementaire, TypeSupplementaire } from '../types';
import { formatTacheLabel } from '../utils/tacheUtils';

interface HeuresSuppDetailItem {
  item: HeureSupplementaire;
  ouvrier?: Ouvrier;
  tache?: Tache;
}

interface HeuresSupplementairesModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeOuvriers: Ouvrier[];
  taches: Tache[];
  heuresSuppDetails: HeuresSuppDetailItem[];
  checkWorkerForHeuresSupp: (numero: number) => {
    valid: boolean;
    ouvrier?: Ouvrier;
    error?: string;
    existingEntries?: HeureSupplementaire[];
  };
  onSaveHeureSupp: (
    ouvrierId: string,
    data: {
      id?: string;
      type: TypeSupplementaire;
      tache_id?: string | null;
      quantite?: number | null;
      unite?: string;
      heures?: number | null;
    }
  ) => {
    success: boolean;
    message?: string;
    item?: HeureSupplementaire;
    isUpdated?: boolean;
  };
  onRemoveHeureSupp: (id: string) => void;
  selectedDate: string;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const UNITE_SUGGESTIONS = ['ruban', 'forfait', 'heure'];

export const HeuresSupplementairesModal: React.FC<HeuresSupplementairesModalProps> = ({
  isOpen,
  onClose,
  activeOuvriers,
  taches,
  heuresSuppDetails,
  checkWorkerForHeuresSupp,
  onSaveHeureSupp,
  onRemoveHeureSupp,
}) => {
  const [inputNumber, setInputNumber] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchList, setShowSearchList] = useState(false);

  // Ouvrier confirmé
  const [confirmedOuvrier, setConfirmedOuvrier] = useState<Ouvrier | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // Configuration de l'entrée supplémentaire
  const [selectedType, setSelectedType] = useState<TypeSupplementaire>('heures');

  // Champs Type "Par heures"
  const [inputHeures, setInputHeures] = useState('');

  // Champs Type "Par tâche"
  const [selectedTacheId, setSelectedTacheId] = useState<string | null>(null);
  const [tacheSearchQuery, setTacheSearchQuery] = useState('');
  const [inputQuantite, setInputQuantite] = useState('');

  // Unité (commune, avec suggestions)
  const [inputUnite, setInputUnite] = useState('ruban');

  // Messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const clearMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const resetFormState = () => {
    setConfirmedOuvrier(null);
    setEditingEntryId(null);
    setInputNumber('');
    setInputHeures('');
    setInputQuantite('');
    setSelectedTacheId(null);
    setTacheSearchQuery('');
    setInputUnite('ruban');
    setSelectedType('heures');
  };

  // Étape 1 : Vérifier le numéro d'ouvrier
  const handleVerifyNumber = (numStr?: string) => {
    clearMessages();
    setEditingEntryId(null);

    const targetStr = (numStr !== undefined ? numStr : inputNumber).trim();
    if (!targetStr) {
      setErrorMessage('Veuillez saisir un numéro d\'ouvrier');
      return;
    }

    const num = parseInt(targetStr, 10);
    if (isNaN(num)) {
      setErrorMessage('Numéro invalide');
      return;
    }

    const verification = checkWorkerForHeuresSupp(num);

    if (!verification.valid || !verification.ouvrier) {
      setErrorMessage(verification.error || `Numéro ${num} introuvable.`);
      setConfirmedOuvrier(null);
      return;
    }

    setConfirmedOuvrier(verification.ouvrier);
    // Initialiser par défaut
    if (selectedType === 'tache') {
      setInputUnite('ruban');
    } else {
      setInputUnite('heure');
    }
  };

  // Sélection directe depuis la liste de recherche
  const handleSelectFromSearch = (ouvrier: Ouvrier) => {
    setInputNumber(ouvrier.numero.toString());
    setShowSearchList(false);
    handleVerifyNumber(ouvrier.numero.toString());
  };

  // Lancer la modification d'une entrée existante
  const handleStartEditEntry = (entry: HeureSupplementaire, ouvrier?: Ouvrier) => {
    clearMessages();
    const targetOuvrier = ouvrier || activeOuvriers.find((o) => o.id === entry.ouvrier_id) || null;
    if (!targetOuvrier) return;

    setConfirmedOuvrier(targetOuvrier);
    setEditingEntryId(entry.id);
    setInputNumber(targetOuvrier.numero.toString());

    const type: TypeSupplementaire = entry.type || (entry.tache_id ? 'tache' : 'heures');
    setSelectedType(type);

    if (type === 'tache') {
      setSelectedTacheId(entry.tache_id || null);
      setInputQuantite(entry.quantite !== undefined && entry.quantite !== null ? entry.quantite.toString() : '');
      setInputUnite(entry.unite || 'ruban');
    } else {
      const hVal = entry.quantite !== undefined && entry.quantite !== null ? entry.quantite : entry.heures;
      setInputHeures(hVal !== undefined && hVal !== null ? hVal.toString() : '');
      setInputUnite(entry.unite || 'heure');
    }
  };

  // Changement de type (Par heures / Par tâche)
  const handleSwitchType = (type: TypeSupplementaire) => {
    setSelectedType(type);
    if (type === 'tache') {
      if (!inputUnite || inputUnite === 'heure') {
        setInputUnite('ruban');
      }
    } else {
      if (!inputUnite || inputUnite === 'ruban') {
        setInputUnite('heure');
      }
    }
  };

  // Étape 2 : Confirmer et enregistrer
  const handleConfirmSave = () => {
    if (!confirmedOuvrier) return;
    clearMessages();

    if (selectedType === 'tache') {
      if (!selectedTacheId) {
        setErrorMessage('Veuillez choisir une tâche pour la saisie "Par tâche".');
        return;
      }

      if (!inputQuantite.trim()) {
        setErrorMessage('La quantité est obligatoire pour le mode "Par tâche" (ex: 2).');
        return;
      }

      const qVal = parseFloat(inputQuantite.replace(',', '.'));
      if (isNaN(qVal) || qVal <= 0) {
        setErrorMessage('Veuillez saisir une quantité positive valide (ex: 2 ou 1.5).');
        return;
      }

      const res = onSaveHeureSupp(confirmedOuvrier.id, {
        id: editingEntryId || undefined,
        type: 'tache',
        tache_id: selectedTacheId,
        quantite: qVal,
        unite: inputUnite.trim() || 'ruban',
      });

      if (res.success) {
        const tacheObj = taches.find((t) => t.id === selectedTacheId);
        const tacheLabel = tacheObj ? formatTacheLabel(tacheObj) : 'Tâche';
        setSuccessMessage(
          `✓ #${confirmedOuvrier.numero} ${confirmedOuvrier.nom} : ${qVal} ${inputUnite.trim() || 'ruban'} (${tacheLabel}) ${
            res.isUpdated ? 'mis à jour' : 'enregistré'
          } !`
        );
        resetFormState();
        setTimeout(() => setSuccessMessage(null), 3500);
      } else {
        setErrorMessage(res.message || 'Erreur lors de l\'enregistrement.');
      }
    } else {
      // Type "Par heures"
      let heuresVal: number | null = null;
      if (inputHeures.trim()) {
        const parsed = parseFloat(inputHeures.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) {
          setErrorMessage('Veuillez renseigner un nombre d\'heures valide (ex: 2 ou 2.5), ou laisser vide.');
          return;
        }
        heuresVal = parsed;
      }

      const res = onSaveHeureSupp(confirmedOuvrier.id, {
        id: editingEntryId || undefined,
        type: 'heures',
        tache_id: null,
        quantite: heuresVal,
        heures: heuresVal,
        unite: inputUnite.trim() || 'heure',
      });

      if (res.success) {
        const hText = heuresVal ? ` (${heuresVal} ${inputUnite.trim() || 'heure'})` : ` (${inputUnite.trim() || 'heure'})`;
        setSuccessMessage(
          `✓ #${confirmedOuvrier.numero} ${confirmedOuvrier.nom} : Heures supplémentaires${hText} ${
            res.isUpdated ? 'mises à jour' : 'enregistrées'
          } !`
        );
        resetFormState();
        setTimeout(() => setSuccessMessage(null), 3500);
      } else {
        setErrorMessage(res.message || 'Erreur lors de l\'enregistrement.');
      }
    }
  };

  // Filtrage des ouvriers pour recherche rapide
  const filteredOuvriers = activeOuvriers.filter((o) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return o.numero.toString().includes(q) || o.nom.toLowerCase().includes(q);
  });

  // Filtrage des tâches pour recherche par code ou nom
  const filteredTaches = useMemo(() => {
    const q = normalize(tacheSearchQuery);
    if (!q) return taches;
    return taches.filter((t) => {
      const codeNorm = t.code ? normalize(t.code) : '';
      const nomNorm = normalize(t.nom);
      return codeNorm.includes(q) || nomNorm.includes(q);
    });
  }, [taches, tacheSearchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[94vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* En-tête */}
        <div className="bg-amber-600 text-white p-4 flex items-center justify-between shrink-0 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">
                Heures Supplémentaires
              </h3>
              <p className="text-[11px] text-amber-100">
                Saisie par heures ou par tâche (forfait / ruban)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-amber-100 hover:text-white p-1 rounded-full cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Corps déroulant */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3.5">
          {/* Bloc de saisie */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-amber-600" />
                <span>{editingEntryId ? 'Modifier l\'entrée supplémentaire' : 'Pointer un ouvrier en sup'}</span>
              </label>

              {editingEntryId && (
                <button
                  type="button"
                  onClick={resetFormState}
                  className="text-[11px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Annuler modification</span>
                </button>
              )}
            </div>

            {/* Champ Numéro & Bouton Vérifier */}
            <div className="flex gap-2">
              <div className="relative flex-1">
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
                      handleVerifyNumber();
                    }
                  }}
                  placeholder="Numéro ouvrier (ex: 3)"
                  className="w-full h-12 text-xl font-black text-center tracking-wider text-slate-900 bg-white border-2 border-slate-300 rounded-xl focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none"
                />
              </div>

              <button
                type="button"
                onClick={() => handleVerifyNumber()}
                disabled={!inputNumber}
                className="px-5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white font-black text-xs rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
              >
                Vérifier
              </button>
            </div>

            {/* Barre de recherche d'appoint */}
            {!confirmedOuvrier && (
              <div className="relative pt-1">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onFocus={() => setShowSearchList(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSearchList(true);
                    }}
                    placeholder="Ou chercher par nom / numéro..."
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:border-amber-500 outline-none"
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

                {showSearchList && searchQuery.trim().length > 0 && (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-36 overflow-y-auto divide-y divide-slate-100 z-30">
                    {filteredOuvriers.slice(0, 6).map((ouvrier) => (
                      <button
                        key={ouvrier.id}
                        type="button"
                        onClick={() => handleSelectFromSearch(ouvrier)}
                        className="w-full px-3 py-2 text-left flex items-center justify-between hover:bg-amber-50 text-xs transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-slate-800 text-white font-black text-center leading-6 shrink-0 text-xs">
                            {ouvrier.numero}
                          </span>
                          <span className="font-bold text-slate-800">{ouvrier.nom}</span>
                        </div>
                        <span className="text-[11px] font-bold text-amber-700">
                          Sélectionner ➔
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* CONFIRMATION DE L'OUVRIER TROUVÉ ET CHOIX DU TYPE */}
            {confirmedOuvrier && (
              <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-3.5 space-y-3 animate-in fade-in">
                {/* Carte identité ouvrier */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-600 text-white text-lg font-black flex items-center justify-center shrink-0 shadow-2xs">
                      #{confirmedOuvrier.numero}
                    </div>
                    <div>
                      <span className="text-[11px] text-amber-800 font-bold block uppercase tracking-wide">
                        Ouvrier identifié :
                      </span>
                      <span className="text-sm font-black text-slate-900 leading-tight">
                        {confirmedOuvrier.nom}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmedOuvrier(null)}
                    className="text-xs text-amber-800 hover:text-amber-950 font-bold underline"
                  >
                    Changer
                  </button>
                </div>

                {/* SÉLECTEUR DE TYPE : Par heures ou Par tâche */}
                <div>
                  <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider block mb-1.5">
                    Type de saisie :
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSwitchType('heures')}
                      className={`h-11 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border-2 cursor-pointer ${
                        selectedType === 'heures'
                          ? 'bg-amber-600 text-white border-amber-700 shadow-xs ring-2 ring-amber-300'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                      <span>Par heures</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSwitchType('tache')}
                      className={`h-11 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 border-2 cursor-pointer ${
                        selectedType === 'tache'
                          ? 'bg-purple-700 text-white border-purple-800 shadow-xs ring-2 ring-purple-300'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Tag className="w-4 h-4" />
                      <span>Par tâche</span>
                    </button>
                  </div>
                </div>

                {/* CONTENU MODE 1 : PAR HEURES */}
                {selectedType === 'heures' && (
                  <div className="space-y-2 pt-1">
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Nombre d'heures (optionnel, ex : 2 ou 2.5) :
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="24"
                        value={inputHeures}
                        onChange={(e) => setInputHeures(e.target.value)}
                        placeholder="Ex : 2 (laisser vide si non précisé)"
                        className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-sm font-black text-slate-800 focus:border-amber-500 outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* CONTENU MODE 2 : PAR TÂCHE */}
                {selectedType === 'tache' && (
                  <div className="space-y-2.5 pt-1">
                    {/* Choix de la tâche */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Tâche supplémentaire * :
                      </label>

                      {/* Barre de recherche de tâche */}
                      <div className="relative mb-1.5">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={tacheSearchQuery}
                          onChange={(e) => setTacheSearchQuery(e.target.value)}
                          placeholder="Chercher tâche par code (ex: R01) ou nom..."
                          className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:border-purple-600 outline-none"
                        />
                      </div>

                      {/* Liste déroulante ou boutons de sélection des tâches */}
                      <div className="max-h-36 overflow-y-auto space-y-1 bg-white border border-slate-200 rounded-xl p-1.5 shadow-2xs">
                        {filteredTaches.length === 0 ? (
                          <div className="text-center py-2 text-slate-400 text-xs">
                            Aucune tâche trouvée
                          </div>
                        ) : (
                          filteredTaches.map((tache) => {
                            const isSelected = selectedTacheId === tache.id;
                            return (
                              <button
                                key={tache.id}
                                type="button"
                                onClick={() => setSelectedTacheId(tache.id)}
                                className={`w-full p-2 rounded-lg text-left flex items-center justify-between text-xs transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-purple-100 text-purple-950 font-black border border-purple-300'
                                    : 'hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: tache.couleur || '#16a34a' }}
                                  />
                                  <span>{formatTacheLabel(tache)}</span>
                                </span>
                                {isSelected && (
                                  <span className="text-[10px] bg-purple-700 text-white font-bold px-1.5 py-0.5 rounded-md shrink-0">
                                    Sélectionnée ✓
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Champ Quantité (obligatoire pour tâche) */}
                    <div>
                      <label className="text-[11px] font-bold text-slate-700 block mb-1">
                        Quantité (obligatoire, ex : 2 ou 1.5) * :
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={inputQuantite}
                        onChange={(e) => setInputQuantite(e.target.value)}
                        placeholder="Ex : 2"
                        className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-sm font-black text-slate-800 focus:border-purple-600 outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* CHAMP UNITÉ AVEC SUGGESTIONS (ruban, forfait, heure) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-700">
                      Unité :
                    </label>
                    <span className="text-[10px] text-slate-400">Suggestions rapides :</span>
                  </div>

                  <input
                    type="text"
                    value={inputUnite}
                    onChange={(e) => setInputUnite(e.target.value)}
                    placeholder="ruban, forfait, heure..."
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 focus:border-amber-500 outline-none mb-1.5"
                  />

                  {/* Chips de suggestions rapides */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {UNITE_SUGGESTIONS.map((sug) => {
                      const isSelected = inputUnite.toLowerCase().trim() === sug;
                      return (
                        <button
                          key={sug}
                          type="button"
                          onClick={() => setInputUnite(sug)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                            isSelected
                              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {sug}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Bouton d'enregistrement final */}
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer mt-1"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>
                    {editingEntryId ? 'METTRE À JOUR L\'ENTRÉE' : 'ENREGISTRER L\'ENTRÉE'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* ALERTES ERREUR / SUCCÈS */}
          {errorMessage && (
            <div className="bg-red-50 border-2 border-red-300 text-red-900 rounded-2xl p-3 flex items-start gap-2.5 text-xs animate-in fade-in">
              <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-black text-red-800">Information</strong>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-50 border-2 border-emerald-400 text-emerald-950 rounded-2xl p-3 flex items-center gap-2 text-xs font-bold animate-in fade-in">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* LISTE DU JOUR DES ENTRÉES SUPPLÉMENTAIRES */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs font-black text-slate-800 pb-1 border-b border-slate-100">
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-amber-600" />
                <span>Entrées supplémentaires du jour ({heuresSuppDetails.length})</span>
              </div>
            </div>

            {heuresSuppDetails.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl">
                Aucune entrée supplémentaire enregistrée aujourd'hui.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {heuresSuppDetails.map(({ item, ouvrier, tache }) => {
                  const num = ouvrier?.numero || item.numero_ouvrier;
                  const nom = ouvrier?.nom || `Ouvrier #${num}`;
                  const isTaskType = item.type === 'tache' || !!item.tache_id;
                  const q = item.quantite !== undefined && item.quantite !== null
                    ? item.quantite
                    : (item.heures !== undefined && item.heures !== null ? item.heures : null);
                  const uniteStr = item.unite || (isTaskType ? 'ruban' : 'heure');

                  return (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-50 hover:bg-amber-50/50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-2xs">
                          {num}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-xs text-slate-800 truncate">
                            {nom}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                            <span className="font-bold px-1.5 py-0.2 rounded-md text-[9px] bg-slate-200 text-slate-800">
                              {isTaskType ? 'Par tâche' : 'Par heures'}
                            </span>

                            {tache && (
                              <span
                                className="font-bold text-white px-1.5 py-0.2 rounded-md text-[9px]"
                                style={{ backgroundColor: tache.couleur || '#7e22ce' }}
                              >
                                {formatTacheLabel(tache)}
                              </span>
                            )}

                            <span className="font-black text-amber-900 bg-amber-100 px-1.5 py-0.2 rounded-md">
                              {q !== null ? `${q} ${uniteStr}` : uniteStr}
                            </span>

                            <span className="text-slate-400">🕒 {item.heure_enregistrement}</span>
                          </div>
                        </div>
                      </div>

                      {/* Boutons d'action : Modifier et Supprimer */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleStartEditEntry(item, ouvrier)}
                          className="p-1.5 text-slate-500 hover:text-amber-800 hover:bg-amber-100 rounded-lg transition cursor-pointer"
                          title="Modifier cette entrée"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Supprimer l'entrée de l'ouvrier #${num} (${nom}) ?`)) {
                              onRemoveHeureSupp(item.id);
                            }
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                          title="Supprimer cette entrée"
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
        </div>

        {/* Pied */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>{heuresSuppDetails.length} entrée(s) supplémentaire(s)</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl transition cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
