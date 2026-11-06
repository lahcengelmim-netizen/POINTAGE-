import React, { useState, useMemo, useEffect } from 'react';
import { PlusCircle, Plus, X, CheckCircle2, AlertCircle, Calendar, Search, Package, Trash2, Layers, Check } from 'lucide-react';
import { StockProduit, StockProduitSynthese } from '../../types';
import { addEntreeBatch, generateIdempotencyKey } from '../../services/stockService';
import { StockProProduitModal } from './StockProProduitModal';

interface StockProEntreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  produits: StockProduitSynthese[];
  initialProduitId?: string | null;
  onEntreeSuccess: () => void;
  onRequestRefreshStock?: () => Promise<void>;
}

export interface SelectedEntreeItem {
  produit_id: string;
  quantite: string;
}

export const StockProEntreeModal: React.FC<StockProEntreeModalProps> = ({
  isOpen,
  onClose,
  produits,
  initialProduitId,
  onEntreeSuccess,
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
  const [selectedItems, setSelectedItems] = useState<SelectedEntreeItem[]>([]);

  // Formulaire d'informations communes (conservé 100% intact)
  const [dateInput, setDateInput] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [tiersInput, setTiersInput] = useState<string>('');
  const [refDocInput, setRefDocInput] = useState<string>('');
  const [motifInput, setMotifInput] = useState<string>('Livraison / Approvisionnement');
  const [observationInput, setObservationInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initialisation lors de l'ouverture
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);

      // Si un produit initial est spécifié
      if (initialProduitId && allProduits.some((p) => p.produit.id === initialProduitId)) {
        setSelectedItems((prev) => {
          if (!prev.some((item) => item.produit_id === initialProduitId)) {
            return [{ produit_id: initialProduitId, quantite: '' }, ...prev];
          }
          return prev;
        });
      } else if (selectedItems.length === 0 && allProduits[0]) {
        setSelectedItems([{ produit_id: allProduits[0].produit.id, quantite: '' }]);
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
    const newSynthese: StockProduitSynthese = {
      produit: newProd,
      stock_initial: 0,
      total_entrees: 0,
      total_sorties: 0,
      stock_actuel: 0,
      etat: 'RUPTURE',
      derniere_activite: newProd.created_at || new Date().toISOString(),
    };

    setLocalAddedProduits((prev) => [newSynthese, ...prev]);

    // Ajouter le nouveau produit à la sélection multi-produits avec quantité par défaut 1
    setSelectedItems((prev) => {
      if (!prev.some((it) => it.produit_id === newProd.id)) {
        return [{ produit_id: newProd.id, quantite: '1' }, ...prev];
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

  // Map rapide d'accès par ID
  const allProduitsMap = new Map<string, StockProduitSynthese>();
  allProduits.forEach((p) => allProduitsMap.set(p.produit.id, p));

  // Validation et soumission du lot multi-produits
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (selectedItems.length === 0) {
      setErrorMsg('Veuillez sélectionner au moins un produit pour l\'entrée.');
      return;
    }

    // Vérification de chaque ligne
    const formattedItems: Array<{ produit_id: string; quantite: number }> = [];
    for (const item of selectedItems) {
      const prod = allProduitsMap.get(item.produit_id);
      const nom = prod ? prod.produit.nom : 'Produit';
      const qty = parseFloat(item.quantite.replace(',', '.'));

      if (isNaN(qty) || qty <= 0) {
        setErrorMsg(`Veuillez saisir une quantité valide (> 0) pour le produit "${nom}".`);
        return;
      }
      formattedItems.push({ produit_id: item.produit_id, quantite: qty });
    }

    setIsSubmitting(true);

    try {
      const idempotencyKey = generateIdempotencyKey();

      const res = await addEntreeBatch({
        items: formattedItems,
        date: dateInput,
        tiers: tiersInput.trim() || undefined,
        reference_document: refDocInput.trim() || undefined,
        motif: motifInput.trim() || undefined,
        observation: observationInput.trim() || undefined,
        idempotencyKey,
      });

      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de l\'enregistrement de l\'entrée multi-produits.');
      }

      setSuccessMsg(`✓ ${res.message || `Entrée multi-produits de ${formattedItems.length} article(s) enregistrée avec succès !`}`);
      onEntreeSuccess();

      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur inattendue.');
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
              <div className="w-9 h-9 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-xs">
                <PlusCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
                  <span>Entrée Multi-Produits</span>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-bold">
                    {selectedItems.length} sélectionné(s)
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500">Réception de commande & réapprovisionnement groupé</p>
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

          <form onSubmit={handleSubmit} className="space-y-4 text-xs flex-1 overflow-y-auto pr-0.5">
            {/* 1. INFORMATIONS COMMUNES À L'OPÉRATION */}
            <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-black text-slate-800 text-[11px] flex items-center gap-1.5 uppercase tracking-wider">
                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                  <span>Informations communes du Bon :</span>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Date de réception :</label>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-900 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">N° BL / Facture / Bon :</label>
                  <input
                    type="text"
                    value={refDocInput}
                    onChange={(e) => setRefDocInput(e.target.value)}
                    placeholder="ex: BL-2026-88"
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-medium text-slate-900 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Fournisseur / Tiers :</label>
                  <input
                    type="text"
                    value={tiersInput}
                    onChange={(e) => setTiersInput(e.target.value)}
                    placeholder="ex: AgriSud, Souss Agro..."
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-600 block mb-1">Motif :</label>
                  <input
                    type="text"
                    value={motifInput}
                    onChange={(e) => setMotifInput(e.target.value)}
                    placeholder="ex: Réception commande"
                    required
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600 text-xs font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-1">Observation (facultative) :</label>
                <input
                  type="text"
                  value={observationInput}
                  onChange={(e) => setObservationInput(e.target.value)}
                  placeholder="ex: Palettes vérifiées, livraison conforme..."
                  className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600 text-xs"
                />
              </div>
            </div>

            {/* 2. RECHERCHE ET CHOIX RAPIDE DE PRODUITS MULTIPLES */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-black text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
                  <Package className="w-3.5 h-3.5 text-emerald-600" />
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
                  placeholder="🔍 Rechercher un produit à ajouter (ex: MAP, NPK, Calcium...)..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-8 py-2 text-xs font-medium text-slate-900 outline-none focus:border-emerald-600 focus:bg-white transition"
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
                    return (
                      <div
                        key={p.produit.id}
                        onClick={() => toggleSelectProduct(p.produit.id)}
                        className={`p-2 rounded-xl flex items-center justify-between cursor-pointer transition ${
                          isSelected
                            ? 'bg-emerald-100/90 border border-emerald-300 font-bold text-emerald-950 shadow-2xs'
                            : 'bg-white hover:bg-slate-100/80 border border-transparent text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <div
                            className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                          <span className="font-black truncate">{p.produit.nom}</span>
                          <span className="text-[10px] text-slate-500 font-mono">({p.produit.unite})</span>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-bold text-slate-500">
                            Stock actuel : <strong className="text-slate-900">{p.stock_actuel}</strong> {p.produit.unite}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* 3. TABLEAU DES PRODUITS SÉLECTIONNÉS (QUANTITÉS INDIVIDUELLES) */}
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <span>Lignes de produits dans cette Entrée ({selectedItems.length}) :</span>
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
                  <p>Aucun produit sélectionné pour l'entrée.</p>
                  <p className="text-[10px] font-normal text-amber-800">
                    Cliquez sur les produits ci-dessus ou sur "+ Nouveau produit" pour ajouter au moins 1 article.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedItems.map((item, idx) => {
                    const prodSynthese = allProduitsMap.get(item.produit_id);
                    const prodNom = prodSynthese ? prodSynthese.produit.nom : 'Produit inconnu';
                    const prodUnite = prodSynthese ? prodSynthese.produit.unite : 'KG';
                    const stockActuel = prodSynthese ? prodSynthese.stock_actuel : 0;

                    return (
                      <div
                        key={item.produit_id}
                        className="bg-white border border-slate-300 rounded-2xl p-2.5 shadow-2xs space-y-1.5 relative hover:border-emerald-500 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-mono font-black text-[10px] flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <span className="font-black text-slate-900 text-xs">{prodNom}</span>
                            <span className="bg-slate-100 px-2 py-0.5 rounded-md text-[10px] font-black text-slate-600 uppercase border border-slate-200">
                              {prodUnite}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeItem(item.produit_id)}
                            className="text-slate-400 hover:text-red-600 p-1 rounded-lg transition cursor-pointer"
                            title="Retirer cette ligne"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                          <span className="text-[10px] font-bold text-slate-500">
                            Stock actuel : <span className="text-slate-900 font-mono font-black">{stockActuel}</span> {prodUnite}
                          </span>

                          <div className="flex items-center gap-1.5">
                            <label className="text-[10px] font-black text-slate-700">Qté reçue :</label>
                            <div className="relative">
                              <input
                                type="number"
                                step="any"
                                min="0.01"
                                value={item.quantite}
                                onChange={(e) => updateItemQuantity(item.produit_id, e.target.value)}
                                placeholder="0.00"
                                required
                                className="w-24 bg-slate-50 border border-slate-300 rounded-xl py-1 px-2 font-mono font-black text-slate-900 text-xs text-right outline-none focus:border-emerald-600 focus:bg-white"
                              />
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase">{prodUnite}</span>
                          </div>
                        </div>
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
                disabled={isSubmitting || selectedItems.length === 0}
                className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isSubmitting ? 'Validation...' : `VALIDER L'ENTRÉE (${selectedItems.length})`}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Modal Création de Produit imbriquée (Z-[70] sans fermer l'entrée en cours) */}
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
