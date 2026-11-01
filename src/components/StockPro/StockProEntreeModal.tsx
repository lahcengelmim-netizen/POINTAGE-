import React, { useState, useMemo, useEffect } from 'react';
import { PlusCircle, X, CheckCircle2, AlertCircle, Calendar, AlertTriangle, Search } from 'lucide-react';
import { StockProduitSynthese } from '../../types';
import { addEntree, generateIdempotencyKey } from '../../services/stockService';

interface StockProEntreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  produits: StockProduitSynthese[];
  initialProduitId?: string | null;
  onEntreeSuccess: () => void;
}

export const StockProEntreeModal: React.FC<StockProEntreeModalProps> = ({
  isOpen,
  onClose,
  produits,
  initialProduitId,
  onEntreeSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredProduits = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return produits;
    return produits.filter((p) => p.produit.nom.toLowerCase().includes(term));
  }, [produits, searchTerm]);

  const [selectedProduitId, setSelectedProduitId] = useState<string>(() => {
    return initialProduitId || produits[0]?.produit.id || '';
  });

  useEffect(() => {
    if (isOpen) {
      if (initialProduitId && produits.some((p) => p.produit.id === initialProduitId)) {
        setSelectedProduitId(initialProduitId);
      } else if (!selectedProduitId || !produits.some((p) => p.produit.id === selectedProduitId)) {
        if (produits[0]) setSelectedProduitId(produits[0].produit.id);
      }
    }
  }, [isOpen, initialProduitId, produits]);

  // Si l'utilisateur fait une recherche et que le produit sélectionné n'est plus dans la liste filtrée,
  // on bascule automatiquement sur le 1er résultat correspondant
  useEffect(() => {
    if (searchTerm.trim() !== '') {
      if (filteredProduits.length > 0 && !filteredProduits.some((p) => p.produit.id === selectedProduitId)) {
        setSelectedProduitId(filteredProduits[0].produit.id);
      }
    }
  }, [searchTerm, filteredProduits, selectedProduitId]);
  const [quantiteInput, setQuantiteInput] = useState<string>('');
  const [dateInput, setDateInput] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [tiersInput, setTiersInput] = useState<string>('');
  const [refDocInput, setRefDocInput] = useState<string>('');
  const [motifInput, setMotifInput] = useState<string>('Livraison / Approvisionnement');
  const [observationInput, setObservationInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedProduit = useMemo(() => {
    return produits.find((p) => p.produit.id === selectedProduitId) || produits[0];
  }, [produits, selectedProduitId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedProduit) {
      setErrorMsg('Veuillez sélectionner un produit.');
      return;
    }

    const qty = parseFloat(quantiteInput.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg('La quantité reçue doit être un nombre strictement supérieur à 0.');
      return;
    }

    setIsSubmitting(true);

    try {
      // Clé d'idempotence unique avant l'envoi
      const idempotencyKey = generateIdempotencyKey();

      const res = await addEntree({
        produit_id: selectedProduit.produit.id,
        quantite: qty,
        date: dateInput,
        tiers: tiersInput.trim() || undefined,
        reference_document: refDocInput.trim() || undefined,
        motif: motifInput.trim() || undefined,
        observation: observationInput.trim() || undefined,
        idempotencyKey,
      });

      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de l\'enregistrement de l\'entrée.');
      }

      setSuccessMsg(`✓ Entrée de ${qty} ${selectedProduit.produit.unite} enregistrée avec succès ! (Nouveau stock: ${res.nouveau_stock})`);
      onEntreeSuccess();

      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur inattendue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3.5 border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-xs">Nouvelle Entrée en Stock</h3>
              <p className="text-[10px] text-slate-500">Réception de marchandise</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold text-xs"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {/* Sélection Produit avec Recherche Rapide */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between mb-1">
              <span>Produit à approvisionner :</span>
              {searchTerm && (
                <span className="text-[10px] text-emerald-700 font-semibold">
                  {filteredProduits.length} résultat{filteredProduits.length > 1 ? 's' : ''}
                </span>
              )}
            </label>

            {/* Barre de recherche avec icône Loupe et bouton Effacer (X) */}
            <div className="relative mb-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="🔍 Recherche rapide (ex: Ammonitrate, Calcium)..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-8 py-2 text-xs font-medium text-slate-900 outline-none focus:border-emerald-600 focus:bg-white transition"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  title="Effacer la recherche"
                  className="absolute right-2 top-2 w-5 h-5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center text-xs font-black transition"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Selecteur de produit ou Message si aucun résultat */}
            {filteredProduits.length === 0 ? (
              <div className="p-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-center text-slate-500 text-xs my-1">
                <p className="font-bold text-slate-600">Aucun produit trouvé</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Aucun produit ne correspond à « <span className="font-semibold">{searchTerm}</span> »
                </p>
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="mt-2 px-3 py-1 bg-emerald-100 text-emerald-800 text-[11px] font-bold rounded-lg hover:bg-emerald-200 transition"
                >
                  Effacer la recherche
                </button>
              </div>
            ) : (
              <select
                value={selectedProduitId}
                onChange={(e) => setSelectedProduitId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-black text-slate-900 outline-none focus:border-emerald-600"
              >
                {filteredProduits.map((p) => {
                  const isOutOfStock = p.stock_actuel <= 0;
                  return (
                    <option key={p.produit.id} value={p.produit.id}>
                      {p.produit.nom} ({p.produit.unite}) — {isOutOfStock ? '⚠️ RUPTURE (Stock: 0)' : `Stock actuel: ${p.stock_actuel}`}
                    </option>
                  );
                })}
              </select>
            )}

            {selectedProduit && (
              <div className="mt-1.5 p-2 bg-emerald-50/80 border border-emerald-200/80 rounded-xl text-emerald-950 text-[11px] flex items-center justify-between">
                <span className="font-bold truncate">
                  Sélectionné : <strong>{selectedProduit.produit.nom}</strong>
                </span>
                <span className="shrink-0 bg-emerald-200/60 px-2 py-0.5 rounded-md font-mono font-black text-[10px] text-emerald-900">
                  Unité: {selectedProduit.produit.unite}
                </span>
              </div>
            )}

            {selectedProduit && selectedProduit.stock_actuel <= 0 && (
              <div className="mt-1.5 p-2 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-[11px] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Ce produit est actuellement en <strong>rupture (0 {selectedProduit.produit.unite})</strong>. Saisissez la quantité reçue pour réapprovisionner le stock.
                </span>
              </div>
            )}
          </div>

          {/* Quantité & Unité automatique */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Quantité reçue :
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={quantiteInput}
                onChange={(e) => setQuantiteInput(e.target.value)}
                placeholder="ex: 50"
                required
                autoFocus
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-black text-slate-900 outline-none focus:border-emerald-600"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Unité (automatique) :
              </label>
              <input
                type="text"
                value={selectedProduit ? selectedProduit.produit.unite : 'KG'}
                disabled
                className="w-full bg-slate-100 border border-slate-200 text-slate-600 font-black rounded-xl p-2.5"
              />
            </div>
          </div>

          {/* Date de réception */}
          <div>
            <label className="text-[11px] font-bold text-slate-700 block mb-1">
              Date de réception :
            </label>
            <div className="relative">
              <input
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold text-slate-900 outline-none focus:border-emerald-600"
              />
              <Calendar className="w-4 h-4 text-slate-400 absolute right-2.5 top-3 pointer-events-none" />
            </div>
          </div>

          {/* Fournisseur & N° Facture / BL */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                Fournisseur (facultatif) :
              </label>
              <input
                type="text"
                value={tiersInput}
                onChange={(e) => setTiersInput(e.target.value)}
                placeholder="ex: AgriSud"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-600 block mb-1">
                N° BL / Facture (facultatif) :
              </label>
              <input
                type="text"
                value={refDocInput}
                onChange={(e) => setRefDocInput(e.target.value)}
                placeholder="ex: BL-2026-44"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Motif / Observation */}
          <div>
            <label className="text-[10px] font-bold text-slate-600 block mb-1">
              Observation (facultative) :
            </label>
            <input
              type="text"
              value={observationInput}
              onChange={(e) => setObservationInput(e.target.value)}
              placeholder="ex: Conforme au bon de commande..."
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-emerald-600"
            />
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

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-bold transition hover:bg-slate-200"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Enregistrement...' : 'Valider l\'entrée'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
