import React, { useState, useMemo, useEffect } from 'react';
import { MinusCircle, Plus, X, CheckCircle2, AlertCircle, Calendar, AlertTriangle, Search, Package, Trash2, Layers, Check } from 'lucide-react';
import { StockProduit, StockProduitSynthese } from '../../types';
import { addSortieBatch, generateIdempotencyKey } from '../../services/stockService';
import { StockProProduitModal } from './StockProProduitModal';

interface StockProSortieModalProps {
  isOpen: boolean;
  onClose: () => void;
  produits: StockProduitSynthese[];
  initialProduitId?: string | null;
  onSortieSuccess: () => void;
  onRequestRefreshStock?: () => Promise<void>;
}

export interface SelectedSortieItem {
  produit_id: string;
  quantite: string;
}

export const StockProSortieModal: React.FC<StockProSortieModalProps> = ({
  isOpen,
  onClose,
  produits,
  initialProduitId,
  onSortieSuccess,
  onRequestRefreshStock,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [localAddedProduits, setLocalAddedProduits] = useState<StockProduitSynthese[]>([]);
  const [isAddProductOpen, setIsAddProductOpen] = useState<boolean>(false);

  // Combinaison des produits serveur et des produits créés localement
  const allProduits = useMemo(() => {
    const map = new Map<string, StockProduitSynthese>();
    produits.forEach((p) => map.set(p.produit.id, p));
    localAddedProduits.forEach((p) => {
      if (!map.has(p.produit.id)) {
        map.set(p.produit.id, p);
      }
    });
    return Array.from(map.values());
  }, [produits, localAddedProduits]);

  // Normalisation insensible aux majuscules/minuscules et aux accents
  const normalize = (str: string) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  const filteredProduits = useMemo(() => {
    const term = normalize(searchTerm.trim());
    if (!term) return allProduits;
    return allProduits.filter(
      (p) => normalize(p.produit.nom).includes(term) || normalize(p.produit.unite).includes(term)
    );
  }, [allProduits, searchTerm]);

  // Liste des produits sélectionnés pour l'opération multi-produits
  const [selectedItems, setSelectedItems] = useState<SelectedSortieItem[]>([]);

  // Formulaire d'informations communes (conservé 100% intact)
  const [dateInput, setDateInput] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [domaineId, setDomaineId] = useState<string>('dom_d2'); // D2 par défaut
  const [serreInput, setSerreInput] = useState<string>('');
  const [tiersInput, setTiersInput] = useState<string>('');
  const [refDocInput, setRefDocInput] = useState<string>('');
  const [motifInput, setMotifInput] = useState<string>('Traitement / Fertilisation');
  const [observationInput, setObservationInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Map rapide d'accès par ID
  const allProduitsMap = useMemo(() => {
    const map = new Map<string, StockProduitSynthese>();
    allProduits.forEach((p) => map.set(p.produit.id, p));
    return map;
  }, [allProduits]);

  // Initialisation lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setShowConfirmStep(false);

      // Si un produit initial est spécifié
      if (initialProduitId && allProduits.some((p) => p.produit.id === initialProduitId)) {
        setSelectedItems((prev) => {
          if (!prev.some((item) => item.produit_id === initialProduitId)) {
            return [{ produit_id: initialProduitId, quantite: '' }, ...prev];
          }
          return prev;
        });
      } else if (selectedItems.length === 0 && allProduits[0]) {
        const available = allProduits.find((p) => p.stock_actuel > 0);
        const defaultProdId = available ? available.produit.id : allProduits[0].produit.id;
        setSelectedItems([{ produit_id: defaultProdId, quantite: '' }]);
      }
    }
  }, [isOpen, initialProduitId, allProduits]);

  if (!isOpen) return null;

  // Actions de sélection multi-produits
  const toggleSelectProduct = (prodId: string) => {
    setSelectedItems((prev) => {
      const exists = prev.some((it) => it.produit_id === prodId);
      if (exists) {
        return prev.filter((it) => it.produit_id !== prodId);
      } else {
        return [{ produit_id: prodId, quantite: '' }, ...prev];
      }
    });
  };

  const updateItemQuantity = (prodId: string, val: string) => {
    setSelectedItems((prev) =>
      prev.map((it) => (it.produit_id === prodId ? { ...it, quantite: val } : it))
    );
  };

  const removeItem = (prodId: string) => {
    setSelectedItems((prev) => prev.filter((it) => it.produit_id !== prodId));
  };

  // Création d'un nouveau produit en direct (ajoute le produit à la sélection sans effacer la saisie)
  const handleProductCreated = (newProd: StockProduit) => {
    const initStock = newProd.seuil_minimum || 0;
    const newSynthese: StockProduitSynthese = {
      produit: newProd,
      stock_initial: initStock,
      total_entrees: 0,
      total_sorties: 0,
      stock_actuel: initStock,
      etat: initStock > 0 ? 'DISPONIBLE' : 'RUPTURE',
      derniere_activite: newProd.created_at || new Date().toISOString(),
    };

    setLocalAddedProduits((prev) => [newSynthese, ...prev]);

    // Ajouter le nouveau produit à la sélection multi-produits avec quantité par défaut
    setSelectedItems((prev) => {
      if (!prev.some((it) => it.produit_id === newProd.id)) {
        return [{ produit_id: newProd.id, quantite: '' }, ...prev];
      }
      return prev;
    });

    setSearchTerm('');
    setSuccessMsg(`✓ Produit "${newProd.nom}" (${newProd.unite}) créé avec succès et ajouté à la sélection !`);
    setIsAddProductOpen(false);

    if (onRequestRefreshStock) {
      onRequestRefreshStock();
    }
  };

  // Calcul du statut de dépassement pour chaque ligne sélectionnée
  const itemValidationErrors = selectedItems.map((item) => {
    const prodSynthese = allProduitsMap.get(item.produit_id);
    const nom = prodSynthese ? prodSynthese.produit.nom : 'Produit';
    const unite = prodSynthese ? prodSynthese.produit.unite : 'unité';
    const stockDispo = prodSynthese ? prodSynthese.stock_actuel : 0;
    const qty = parseFloat(item.quantite.replace(',', '.'));

    let error: string | null = null;
    if (isNaN(qty) || qty <= 0) {
      error = `Quantité invalide (doit être > 0)`;
    } else if (qty > stockDispo) {
      error = `Dépassement de stock (${qty} > ${stockDispo} ${unite})`;
    }

    return { produit_id: item.produit_id, nom, unite, stockDispo, qty, error };
  });

  const hasAnyStockOverflow = itemValidationErrors.some((v) => v.error !== null);

  // Pré-validation avant écran de confirmation
  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (selectedItems.length === 0) {
      setErrorMsg('Veuillez sélectionner au moins un produit pour la sortie.');
      return;
    }

    if (!motifInput.trim()) {
      setErrorMsg('Le motif de la sortie est obligatoire.');
      return;
    }

    // Vérification de chaque produit
    for (const validation of itemValidationErrors) {
      if (isNaN(validation.qty) || validation.qty <= 0) {
        setErrorMsg(`Veuillez saisir une quantité valide (> 0) pour le produit "${validation.nom}".`);
        return;
      }
      if (validation.qty > validation.stockDispo) {
        setErrorMsg(
          `Sortie refusée pour "${validation.nom}" : Stock disponible = ${validation.stockDispo} ${validation.unite}, quantité demandée = ${validation.qty} ${validation.unite}.`
        );
        return;
      }
    }

    setShowConfirmStep(true);
  };

  // Soumission effective du lot multi-produits
  const handleExecuteSortie = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const formattedItems = itemValidationErrors.map((v) => ({
        produit_id: v.produit_id,
        quantite: v.qty,
      }));

      const idempotencyKey = generateIdempotencyKey();

      const res = await addSortieBatch({
        items: formattedItems,
        date: dateInput,
        domaine_id: domaineId,
        serre_id: serreInput.trim() || undefined,
        tiers: tiersInput.trim() || undefined,
        reference_document: refDocInput.trim() || undefined,
        motif: motifInput.trim(),
        observation: observationInput.trim() || undefined,
        idempotencyKey,
      });

      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de l\'enregistrement de la sortie multi-produits.');
      }

      setSuccessMsg(
        `✓ ${res.message || `Sortie multi-produits de ${formattedItems.length} article(s) enregistrée avec succès !`}`
      );
      setShowConfirmStep(false);
      onSortieSuccess();

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur inattendue.');
      setShowConfirmStep(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in overflow-y-auto">
        <div className="bg-white rounded-3xl max-w-lg w-full p-3.5 sm:p-5 shadow-2xl space-y-4 border border-slate-200 max-h-[95vh] flex flex-col">
          {/* En-tête */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-amber-600 text-white flex items-center justify-center font-black shadow-xs">
                <MinusCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
                  <span>Sortie Multi-Produits</span>
                  <span className="text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                    {selectedItems.length} sélectionné(s)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">Affectation aux domaines / serres & traitements</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 font-bold p-1 rounded-xl transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Écran de confirmation explicite avant enregistrement */}
          {showConfirmStep ? (
            <div className="space-y-3.5 text-xs animate-in fade-in flex-1 overflow-y-auto">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3.5 text-amber-950 space-y-3">
                <div className="flex items-center gap-2 font-black text-xs text-amber-900 border-b border-amber-200 pb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Récapitulatif de la sortie multi-produits ({selectedItems.length} article(s)) :</span>
                </div>

                <div className="space-y-2 text-[11px]">
                  <div className="grid grid-cols-2 gap-2 bg-amber-100/60 p-2 rounded-xl border border-amber-200 font-bold">
                    <p>Domaine : <strong className="text-amber-950">{domaineId.replace('dom_', '').toUpperCase()}</strong></p>
                    {serreInput && <p>Serre : <strong>{serreInput}</strong></p>}
                    <p>Motif : <strong>{motifInput}</strong></p>
                    {tiersInput && <p>Bénéficiaire : <strong>{tiersInput}</strong></p>}
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="font-black text-slate-800 text-[11px] block">Détail des lignes de sortie :</span>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {itemValidationErrors.map((v, idx) => {
                        const stockRestant = Math.round((v.stockDispo - v.qty) * 100) / 100;
                        return (
                          <div
                            key={v.produit_id}
                            className="bg-white border border-amber-200 rounded-xl p-2 flex items-center justify-between text-[11px]"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-amber-800 text-[10px]">{idx + 1}.</span>
                              <span className="font-black text-slate-900">{v.nom}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-red-700 font-black">- {v.qty} {v.unite}</span>
                              <span className="text-[10px] text-slate-500 block">
                                Reste : <strong className="text-emerald-800 font-mono">{stockRestant}</strong> {v.unite}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-1 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowConfirmStep(false)}
                  disabled={isSubmitting}
                  className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-bold transition hover:bg-slate-200 cursor-pointer"
                >
                  Modifier les lignes
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSortie}
                  disabled={isSubmitting}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSubmitting ? 'Validation...' : 'Confirmer la sortie groupée'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handlePreSubmit} className="space-y-4 text-xs flex-1 overflow-y-auto pr-0.5">
              {/* 1. INFORMATIONS COMMUNES À L'OPÉRATION */}
              <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-800 text-[11px] flex items-center gap-1.5 uppercase tracking-wider">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>Informations communes de la sortie :</span>
                  </span>
                </div>

                {/* Domaine : D2 / D3 / D5 mis en avant */}
                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-1">
                    Domaine d'affectation <span className="text-red-500">*</span> :
                  </label>
                  <div className="grid grid-cols-5 gap-1 text-[11px] font-black">
                    {['dom_d2', 'dom_d3', 'dom_d5', 'dom_d1', 'dom_d4'].map((dId) => {
                      const label = dId.replace('dom_', '').toUpperCase();
                      const isMain = dId === 'dom_d2' || dId === 'dom_d3' || dId === 'dom_d5';
                      const isSelected = domaineId === dId;

                      return (
                        <button
                          key={dId}
                          type="button"
                          onClick={() => setDomaineId(dId)}
                          className={`py-1.5 rounded-xl border transition active:scale-95 cursor-pointer ${
                            isSelected
                              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                              : isMain
                              ? 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200 font-black'
                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Serre & Bénéficiaire */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Serre (facultatif) :</label>
                    <input
                      type="text"
                      value={serreInput}
                      onChange={(e) => setSerreInput(e.target.value)}
                      placeholder="ex: Serre 2"
                      className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600 text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Bénéficiaire / Tiers (facultatif) :</label>
                    <input
                      type="text"
                      value={tiersInput}
                      onChange={(e) => setTiersInput(e.target.value)}
                      placeholder="ex: Caporal Brahim"
                      className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600 text-xs"
                    />
                  </div>
                </div>

                {/* Motif, Date & Ref */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">
                      Motif de sortie <span className="text-red-500">*</span> :
                    </label>
                    <input
                      type="text"
                      value={motifInput}
                      onChange={(e) => setMotifInput(e.target.value)}
                      placeholder="ex: Traitement mildiou"
                      required
                      className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-900 outline-none focus:border-amber-600 text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-600 block mb-1">Date de sortie :</label>
                    <input
                      type="date"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-900 outline-none focus:border-amber-600 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Observation / N° Bon (facultatif) :</label>
                  <input
                    type="text"
                    value={observationInput}
                    onChange={(e) => setObservationInput(e.target.value)}
                    placeholder="ex: Traitement préventif secteur Nord..."
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600 text-xs"
                  />
                </div>
              </div>

              {/* 2. RECHERCHE ET CHOIX RAPIDE DE PRODUITS MULTIPLES */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                    <Package className="w-3.5 h-3.5 text-amber-600" />
                    <span>Sélectionner des Produits ({filteredProduits.length}) :</span>
                  </label>

                  {/* Bouton + Nouveau produit */}
                  <button
                    type="button"
                    onClick={() => setIsAddProductOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-xl transition active:scale-95 cursor-pointer"
                    title="Créer un nouveau produit au catalogue et l'ajouter immédiatement"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Nouveau produit</span>
                  </button>
                </div>

                {/* Barre de recherche instantanée */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="🔍 Rechercher un produit à sortir (ex: MAP, Engrais, Sac...)..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-8 py-2 text-xs font-medium text-slate-900 outline-none focus:border-amber-600 focus:bg-white transition"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      title="Effacer"
                      className="absolute right-2.5 top-2 w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-black cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Liste défilante des produits disponibles pour la sélection rapide */}
                <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-2xl p-1.5 bg-slate-50/50 space-y-1 divide-y divide-slate-100 text-xs">
                  {filteredProduits.length === 0 ? (
                    <div className="p-3 text-center text-slate-500 text-xs space-y-1">
                      <p className="font-bold">Aucun produit trouvé pour « {searchTerm} »</p>
                      <button
                        type="button"
                        onClick={() => setIsAddProductOpen(true)}
                        className="text-indigo-600 font-bold underline hover:text-indigo-800"
                      >
                        + Créer le produit « {searchTerm} » maintenant
                      </button>
                    </div>
                  ) : (
                    filteredProduits.map((p) => {
                      const isSelected = selectedItems.some((it) => it.produit_id === p.produit.id);
                      const isOutOfStock = p.stock_actuel <= 0;

                      return (
                        <div
                          key={p.produit.id}
                          onClick={() => {
                            if (!isOutOfStock) toggleSelectProduct(p.produit.id);
                          }}
                          className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition ${
                            isOutOfStock
                              ? 'bg-slate-100/60 opacity-60 cursor-not-allowed border border-transparent'
                              : isSelected
                              ? 'bg-amber-100/90 border border-amber-300 font-bold text-amber-950 shadow-2xs'
                              : 'bg-white hover:bg-slate-100/80 border border-transparent text-slate-800'
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <div
                              className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                                isOutOfStock
                                  ? 'border-slate-300 bg-slate-200'
                                  : isSelected
                                  ? 'bg-amber-600 border-amber-600 text-white'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                            </div>
                            <span className="font-black truncate">{p.produit.nom}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({p.produit.unite})</span>
                          </div>

                          <div className="text-right shrink-0">
                            {isOutOfStock ? (
                              <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-md border border-red-200">
                                Épuisé (0 {p.produit.unite})
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-500">
                                Dispo : <strong className="text-emerald-700">{p.stock_actuel}</strong> {p.produit.unite}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 3. TABLEAU DES PRODUITS SÉLECTIONNÉS (QUANTITÉS INDIVIDUELLES ET STOCK CHECK) */}
              <div className="space-y-2 pt-1 border-t border-slate-200">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-amber-600" />
                    <span>Lignes de produits dans cette Sortie ({selectedItems.length}) :</span>
                  </span>
                  {selectedItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedItems([])}
                      className="text-[10px] text-red-600 font-bold hover:underline"
                    >
                      Tout décocher
                    </button>
                  )}
                </div>

                {selectedItems.length === 0 ? (
                  <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-center text-amber-900 text-xs font-bold space-y-1">
                    <p>Aucun produit sélectionné pour la sortie.</p>
                    <p className="text-[10px] font-normal text-amber-800">
                      Cliquez sur les produits ci-dessus ou sur "+ Nouveau produit" pour ajouter au moins 1 article disponible.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {itemValidationErrors.map((v, idx) => {
                      const hasErr = v.error !== null && v.qty > v.stockDispo;

                      return (
                        <div
                          key={v.produit_id}
                          className={`bg-white border rounded-2xl p-2.5 shadow-2xs space-y-1.5 relative transition ${
                            hasErr
                              ? 'border-red-500 bg-red-50/40'
                              : 'border-slate-300 hover:border-amber-500'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-900 font-mono font-black text-[10px] flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <span className="font-black text-slate-900 text-xs">{v.nom}</span>
                              <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 uppercase border border-slate-200">
                                {v.unite}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeItem(v.produit_id)}
                              className="text-slate-400 hover:text-red-600 p-1 rounded-lg transition cursor-pointer"
                              title="Retirer cette ligne"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                            <span
                              className={`text-[10px] font-bold ${
                                v.stockDispo <= 0
                                  ? 'text-red-600'
                                  : 'text-emerald-700'
                              }`}
                            >
                              Stock dispo : <span className="font-mono font-black">{v.stockDispo}</span> {v.unite}
                            </span>

                            <div className="flex items-center gap-1.5">
                              <label className="text-[10px] font-black text-slate-700">Qté sortie :</label>
                              <div className="relative">
                                <input
                                  type="number"
                                  step="any"
                                  min="0.01"
                                  value={selectedItems.find((it) => it.produit_id === v.produit_id)?.quantite || ''}
                                  onChange={(e) => updateItemQuantity(v.produit_id, e.target.value)}
                                  placeholder="0.00"
                                  required
                                  className={`w-24 bg-slate-50 border rounded-xl py-1 px-2 font-mono font-black text-slate-900 text-xs text-right outline-none ${
                                    hasErr
                                      ? 'border-red-500 bg-red-50 text-red-900'
                                      : 'border-slate-300 focus:border-amber-600 focus:bg-white'
                                  }`}
                                />
                              </div>
                              <span className="text-[10px] font-black text-slate-500 uppercase">{v.unite}</span>
                            </div>
                          </div>

                          {hasErr && (
                            <div className="p-1.5 bg-red-100/80 border border-red-300 rounded-xl text-red-900 text-[10px] font-bold flex items-center gap-1">
                              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                              <span>⚠️ Dépassement : Stock dispo = {v.stockDispo} {v.unite}, demandé = {v.qty} {v.unite}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {errorMsg && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-900 rounded-xl font-bold flex items-center gap-1.5 text-[11px]">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-950 rounded-xl font-bold flex items-center gap-1.5 text-[11px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Boutons d'action */}
              <div className="flex gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 rounded-xl font-bold transition text-xs cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || selectedItems.length === 0 || hasAnyStockOverflow}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isSubmitting ? 'Validation...' : `VÉRIFIER & VALIDER (${selectedItems.length})`}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Modal Création de Produit imbriquée (Z-[70] sans fermer la sortie en cours) */}
      <StockProProduitModal
        isOpen={isAddProductOpen}
        onClose={() => setIsAddProductOpen(false)}
        onProductCreated={handleProductCreated}
        onSuccess={() => {}}
        zIndexClass="z-[70]"
      />
    </>
  );
};
