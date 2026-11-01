import React, { useState, useMemo, useEffect } from 'react';
import { MinusCircle, X, CheckCircle2, AlertCircle, Calendar, AlertTriangle, Search } from 'lucide-react';
import { StockProduitSynthese } from '../../types';
import { addSortie, generateIdempotencyKey } from '../../services/stockService';

interface StockProSortieModalProps {
  isOpen: boolean;
  onClose: () => void;
  produits: StockProduitSynthese[];
  initialProduitId?: string | null;
  onSortieSuccess: () => void;
}

export const StockProSortieModal: React.FC<StockProSortieModalProps> = ({
  isOpen,
  onClose,
  produits,
  initialProduitId,
  onSortieSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');

  const filteredProduits = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return produits;
    return produits.filter((p) => p.produit.nom.toLowerCase().includes(term));
  }, [produits, searchTerm]);

  const [selectedProduitId, setSelectedProduitId] = useState<string>(() => {
    return initialProduitId || produits.find((p) => p.stock_actuel > 0)?.produit.id || produits[0]?.produit.id || '';
  });

  useEffect(() => {
    if (isOpen) {
      if (initialProduitId && produits.some((p) => p.produit.id === initialProduitId)) {
        setSelectedProduitId(initialProduitId);
      } else if (!selectedProduitId || !produits.some((p) => p.produit.id === selectedProduitId)) {
        const available = produits.find((p) => p.stock_actuel > 0);
        setSelectedProduitId(available ? available.produit.id : (produits[0]?.produit.id || ''));
      }
    }
  }, [isOpen, initialProduitId, produits]);

  // Si l'utilisateur fait une recherche et que le produit actuellement sélectionné n'est pas dans la liste filtrée
  useEffect(() => {
    if (searchTerm.trim() !== '') {
      if (filteredProduits.length > 0 && !filteredProduits.some((p) => p.produit.id === selectedProduitId)) {
        // Choisir prioritairement le 1er produit disponible (stock > 0), sinon le 1er produit trouvé
        const available = filteredProduits.find((p) => p.stock_actuel > 0);
        setSelectedProduitId(available ? available.produit.id : filteredProduits[0].produit.id);
      }
    }
  }, [searchTerm, filteredProduits, selectedProduitId]);
  const [quantiteInput, setQuantiteInput] = useState<string>('');
  const [dateInput, setDateInput] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [domaineId, setDomaineId] = useState<string>('dom_d2'); // D2 par défaut
  const [serreInput, setSerreInput] = useState<string>('');
  const [tiersInput, setTiersInput] = useState<string>('');
  const [motifInput, setMotifInput] = useState<string>('Traitement / Fertilisation');
  const [observationInput, setObservationInput] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const selectedProduit = useMemo(() => {
    return produits.find((p) => p.produit.id === selectedProduitId) || produits[0];
  }, [produits, selectedProduitId]);

  if (!isOpen) return null;

  const stockDisponible = selectedProduit ? selectedProduit.stock_actuel : 0;
  const parsedQty = parseFloat(quantiteInput.replace(',', '.'));
  const isOverStock = !isNaN(parsedQty) && parsedQty > stockDisponible;

  const handlePreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedProduit) {
      setErrorMsg('Veuillez sélectionner un produit.');
      return;
    }

    if (isNaN(parsedQty) || parsedQty <= 0) {
      setErrorMsg('La quantité sortie doit être un nombre strictement supérieur à 0.');
      return;
    }

    if (parsedQty > stockDisponible) {
      setErrorMsg(
        `Sortie impossible : stock disponible = ${stockDisponible} ${selectedProduit.produit.unite}, quantité demandée = ${parsedQty} ${selectedProduit.produit.unite}.`
      );
      return;
    }

    if (!motifInput.trim()) {
      setErrorMsg('Le motif de la sortie est obligatoire.');
      return;
    }

    setShowConfirmStep(true);
  };

  const handleExecuteSortie = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const idempotencyKey = generateIdempotencyKey();

      const res = await addSortie({
        produit_id: selectedProduit.produit.id,
        quantite: parsedQty,
        date: dateInput,
        domaine_id: domaineId,
        serre_id: serreInput.trim() || undefined,
        tiers: tiersInput.trim() || undefined,
        motif: motifInput.trim(),
        observation: observationInput.trim() || undefined,
        idempotencyKey,
      });

      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de l\'enregistrement de la sortie.');
      }

      setSuccessMsg(
        `✓ Sortie de ${parsedQty} ${selectedProduit.produit.unite} enregistrée avec succès ! (Nouveau stock: ${res.nouveau_stock} ${selectedProduit.produit.unite})`
      );
      setShowConfirmStep(false);
      onSortieSuccess();

      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur inattendue.');
      setShowConfirmStep(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3.5 border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-600 text-white flex items-center justify-center font-black">
              <MinusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-xs">Nouvelle Sortie de Stock</h3>
              <p className="text-[10px] text-slate-500">Affectation aux domaines / serres</p>
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

        {/* Écran de confirmation explicite avant enregistrement */}
        {showConfirmStep ? (
          <div className="space-y-3 text-xs animate-in fade-in">
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3 text-amber-950 space-y-2">
              <div className="flex items-center gap-2 font-black text-xs text-amber-900">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Confirmation de sortie de stock :</span>
              </div>
              <div className="space-y-1 text-[11px]">
                <p>
                  Produit : <strong>{selectedProduit?.produit.nom}</strong>
                </p>
                <p>
                  Quantité à déduire :{' '}
                  <strong className="text-red-700">
                    - {parsedQty} {selectedProduit?.produit.unite}
                  </strong>
                </p>
                <p>
                  Stock restant après validation :{' '}
                  <strong className="text-emerald-800">
                    {Math.round((stockDisponible - parsedQty) * 100) / 100} {selectedProduit?.produit.unite}
                  </strong>
                </p>
                <p>
                  Domaine : <strong>{domaineId.replace('dom_', '').toUpperCase()}</strong>
                  {serreInput ? ` (Serre : ${serreInput})` : ''}
                </p>
                <p>
                  Motif : <em>{motifInput}</em>
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowConfirmStep(false)}
                disabled={isSubmitting}
                className="flex-1 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-bold transition hover:bg-slate-200"
              >
                Modifier
              </button>
              <button
                type="button"
                onClick={handleExecuteSortie}
                disabled={isSubmitting}
                className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? 'Validation...' : 'Confirmer la sortie'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePreSubmit} className="space-y-3 text-xs">
            {/* Sélection Produit avec Recherche Rapide */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 flex items-center justify-between mb-1">
                <span>Produit à sortir :</span>
                {searchTerm && (
                  <span className="text-[10px] text-amber-700 font-semibold">
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
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-8 pr-8 py-2 text-xs font-medium text-slate-900 outline-none focus:border-amber-600 focus:bg-white transition"
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
                    className="mt-2 px-3 py-1 bg-amber-100 text-amber-800 text-[11px] font-bold rounded-lg hover:bg-amber-200 transition"
                  >
                    Effacer la recherche
                  </button>
                </div>
              ) : (
                <select
                  value={selectedProduitId}
                  onChange={(e) => setSelectedProduitId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-black text-slate-900 outline-none focus:border-amber-600"
                >
                  {filteredProduits.map((p) => {
                    const isOutOfStock = p.stock_actuel <= 0;
                    return (
                      <option key={p.produit.id} value={p.produit.id} disabled={isOutOfStock}>
                        {p.produit.nom} ({p.produit.unite}) — {isOutOfStock ? '❌ Épuisé (Stock: 0)' : `Dispo: ${p.stock_actuel}`}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {/* Pastille Stock Disponible en évidence */}
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs ${
                stockDisponible <= 0
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : stockDisponible <= (selectedProduit?.produit.seuil_minimum || 0)
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-900'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {stockDisponible <= 0 && <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                <span>{stockDisponible <= 0 ? 'Stock épuisé :' : 'Stock actuel disponible :'}</span>
              </div>
              <span className="font-mono font-black text-sm">
                {stockDisponible} {selectedProduit ? selectedProduit.produit.unite : 'KG'}
              </span>
            </div>

            {stockDisponible <= 0 && (
              <div className="p-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>
                  Ce produit est en rupture de stock. Pour pouvoir le sortir, veuillez d'abord enregistrer une <strong>Entrée</strong>.
                </span>
              </div>
            )}

            {/* Quantité & Unité automatique */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Quantité sortie :
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={quantiteInput}
                  onChange={(e) => setQuantiteInput(e.target.value)}
                  placeholder="ex: 10"
                  required
                  autoFocus
                  className={`w-full bg-slate-50 border rounded-xl p-2.5 font-mono font-black text-slate-900 outline-none ${
                    isOverStock ? 'border-red-500 bg-red-50/50' : 'border-slate-300 focus:border-amber-600'
                  }`}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Unité :
                </label>
                <input
                  type="text"
                  value={selectedProduit ? selectedProduit.produit.unite : 'KG'}
                  disabled
                  className="w-full bg-slate-100 border border-slate-200 text-slate-600 font-black rounded-xl p-2.5"
                />
              </div>
            </div>

            {isOverStock && (
              <p className="text-[11px] text-red-600 font-bold bg-red-50 p-2 rounded-xl border border-red-200">
                ⚠️ Dépassement : vous demandez {parsedQty} {selectedProduit?.produit.unite}, mais il ne reste que {stockDisponible} en stock.
              </p>
            )}

            {/* Domaine : D2 / D3 / D5 mis en avant */}
            <div>
              <label className="text-[11px] font-bold text-slate-700 block mb-1">
                Domaine d'affectation :
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
                      className={`py-1.5 rounded-xl border transition active:scale-95 ${
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
                <label className="text-[10px] font-bold text-slate-600 block mb-1">
                  Serre (facultatif) :
                </label>
                <input
                  type="text"
                  value={serreInput}
                  onChange={(e) => setSerreInput(e.target.value)}
                  placeholder="ex: Serre 2"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-1">
                  Bénéficiaire (facultatif) :
                </label>
                <input
                  type="text"
                  value={tiersInput}
                  onChange={(e) => setTiersInput(e.target.value)}
                  placeholder="ex: Caporal Brahim"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600"
                />
              </div>
            </div>

            {/* Motif & Date */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-1">
                  Motif de sortie :
                </label>
                <input
                  type="text"
                  value={motifInput}
                  onChange={(e) => setMotifInput(e.target.value)}
                  placeholder="ex: Traitement mildiou"
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none focus:border-amber-600"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-600 block mb-1">
                  Date :
                </label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-slate-800 outline-none"
                />
              </div>
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
                disabled={isOverStock || stockDisponible <= 0}
                className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-300 text-white py-2.5 rounded-xl font-black shadow-xs transition active:scale-95 flex items-center justify-center gap-1.5"
              >
                <span>Vérifier & Valider</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
