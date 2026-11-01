import React, { useState, useMemo, useEffect } from 'react';
import { History, X, Filter, Search, RotateCcw, Plus, Minus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { StockMouvement, StockProduitSynthese } from '../../types';
import { addCorrection, generateIdempotencyKey } from '../../services/stockService';

interface StockProHistoriqueModalProps {
  isOpen: boolean;
  onClose: () => void;
  mouvements: StockMouvement[];
  produits: StockProduitSynthese[];
  initialProduitId?: string | null;
  onCorrectionSuccess: () => void;
}

export const StockProHistoriqueModal: React.FC<StockProHistoriqueModalProps> = ({
  isOpen,
  onClose,
  mouvements,
  produits,
  initialProduitId,
  onCorrectionSuccess,
}) => {
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterProduitId, setFilterProduitId] = useState<string>(() => initialProduitId || 'ALL');
  const [filterDomaine, setFilterDomaine] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      if (initialProduitId) {
        setFilterProduitId(initialProduitId);
      } else {
        setFilterProduitId('ALL');
      }
    }
  }, [isOpen, initialProduitId]);

  // Modale de correction traçable
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [correctionProdId, setCorrectionProdId] = useState<string>(() => produits[0]?.produit.id || '');
  const [correctionSens, setCorrectionSens] = useState<'+' | '-'>('+');
  const [correctionQtyInput, setCorrectionQtyInput] = useState<string>('');
  const [correctionMotif, setCorrectionMotif] = useState<string>('');
  const [correctionObservation, setCorrectionObservation] = useState<string>('');
  const [isSubmittingCorr, setIsSubmittingCorr] = useState(false);
  const [corrError, setCorrError] = useState<string | null>(null);
  const [corrSuccess, setCorrSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredMouvements = useMemo(() => {
    let list = mouvements;

    if (filterType !== 'ALL') {
      list = list.filter((m) => m.type === filterType);
    }
    if (filterProduitId !== 'ALL') {
      list = list.filter((m) => m.produit_id === filterProduitId);
    }
    if (filterDomaine !== 'ALL') {
      list = list.filter((m) => m.domaine_id === filterDomaine);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.produit_nom.toLowerCase().includes(q) ||
          (m.motif && m.motif.toLowerCase().includes(q)) ||
          (m.tiers && m.tiers.toLowerCase().includes(q)) ||
          m.created_by_nom.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [mouvements, filterType, filterProduitId, filterDomaine, searchQuery]);

  const selectedCorrProduct = useMemo(() => {
    return produits.find((p) => p.produit.id === correctionProdId) || produits[0];
  }, [produits, correctionProdId]);

  const handleExecuteCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setCorrError(null);
    setCorrSuccess(null);

    const val = parseFloat(correctionQtyInput.replace(',', '.'));
    if (isNaN(val) || val <= 0) {
      setCorrError('La quantité doit être un nombre positif supérieur à 0.');
      return;
    }

    if (!correctionMotif.trim()) {
      setCorrError('Le motif de correction est obligatoire pour assurer la traçabilité.');
      return;
    }

    const finalQty = correctionSens === '+' ? val : -val;

    if (correctionSens === '-' && selectedCorrProduct && val > selectedCorrProduct.stock_actuel) {
      setCorrError(
        `Correction refusée : déduction de ${val} impossible car le stock actuel est de ${selectedCorrProduct.stock_actuel} ${selectedCorrProduct.produit.unite}.`
      );
      return;
    }

    setIsSubmittingCorr(true);
    try {
      const idempotencyKey = generateIdempotencyKey();
      const res = await addCorrection({
        produit_id: selectedCorrProduct.produit.id,
        quantite: finalQty,
        motif: correctionMotif.trim(),
        observation: correctionObservation.trim() || undefined,
        idempotencyKey,
      });

      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de la correction.');
      }

      setCorrSuccess(`✓ Correction enregistrée avec succès ! (Nouveau stock: ${res.nouveau_stock})`);
      onCorrectionSuccess();
      setCorrectionQtyInput('');
      setCorrectionMotif('');
      setCorrectionObservation('');
      setTimeout(() => {
        setShowCorrectionForm(false);
        setCorrSuccess(null);
      }, 2000);
    } catch (err: any) {
      setCorrError(err.message || 'Erreur correction.');
    } finally {
      setIsSubmittingCorr(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* En-tête */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600 flex items-center justify-center font-black">
              <History className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm">Historique des Mouvements de Stock</h3>
              <p className="text-[11px] text-slate-400">Traçabilité immuable de chaque opération</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCorrectionForm(!showCorrectionForm)}
              className="bg-purple-700 hover:bg-purple-800 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition flex items-center gap-1 shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{showCorrectionForm ? 'Masquer correction' : 'Ajuster / Corriger'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-full transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Panneau de correction traçable si ouvert */}
        {showCorrectionForm && (
          <div className="bg-purple-50/70 border-b border-purple-200 p-3.5 text-xs space-y-2.5 shrink-0 animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-purple-950 flex items-center gap-1.5">
                <span>📝 Enregistrer un ajustement de stock (Mouvement 'CORRECTION') :</span>
              </h4>
              <span className="text-[10px] text-purple-700 font-bold">Ne supprime aucun ancien mouvement</span>
            </div>

            <form onSubmit={handleExecuteCorrection} className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-0.5">Produit :</label>
                  <select
                    value={correctionProdId}
                    onChange={(e) => setCorrectionProdId(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-900 outline-none"
                  >
                    {produits.map((p) => (
                      <option key={p.produit.id} value={p.produit.id}>
                        {p.produit.nom} ({p.stock_actuel} {p.produit.unite})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-0.5">Ajustement :</label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setCorrectionSens('+')}
                      className={`flex-1 py-1.5 rounded-xl font-black text-xs transition ${
                        correctionSens === '+' ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-600'
                      }`}
                    >
                      + Ajout
                    </button>
                    <button
                      type="button"
                      onClick={() => setCorrectionSens('-')}
                      className={`flex-1 py-1.5 rounded-xl font-black text-xs transition ${
                        correctionSens === '-' ? 'bg-red-600 text-white' : 'bg-white border text-slate-600'
                      }`}
                    >
                      - Retrait
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-0.5">Quantité :</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={correctionQtyInput}
                    onChange={(e) => setCorrectionQtyInput(e.target.value)}
                    placeholder="ex: 5"
                    required
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-mono font-black text-slate-900 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-0.5">
                    Motif obligatoire de l'ajustement :
                  </label>
                  <input
                    type="text"
                    value={correctionMotif}
                    onChange={(e) => setCorrectionMotif(e.target.value)}
                    placeholder="ex: Recomptage inventaire physique..."
                    required
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 font-bold text-slate-900 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-700 block mb-0.5">Observation :</label>
                  <input
                    type="text"
                    value={correctionObservation}
                    onChange={(e) => setCorrectionObservation(e.target.value)}
                    placeholder="Détails supplémentaires..."
                    className="w-full bg-white border border-slate-300 rounded-xl p-2 text-slate-900 outline-none"
                  />
                </div>
              </div>

              {corrError && (
                <p className="text-[11px] text-red-600 font-bold bg-red-50 p-2 rounded-xl border border-red-200">
                  {corrError}
                </p>
              )}
              {corrSuccess && (
                <p className="text-[11px] text-emerald-800 font-bold bg-emerald-50 p-2 rounded-xl border border-emerald-200">
                  {corrSuccess}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCorrectionForm(false)}
                  className="px-3 py-1.5 bg-white border rounded-xl text-slate-700 font-bold"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCorr}
                  className="px-4 py-1.5 bg-purple-700 hover:bg-purple-800 text-white font-black rounded-xl shadow-xs"
                >
                  {isSubmittingCorr ? 'Enregistrement...' : 'Valider l\'ajustement'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Barre de Filtres */}
        <div className="p-3 bg-slate-50 border-b border-slate-200 grid grid-cols-4 gap-2 text-xs shrink-0">
          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Type :</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Tous les types</option>
              <option value="INITIAL">INITIAL (Ouverture)</option>
              <option value="ENTREE">ENTRÉE</option>
              <option value="SORTIE">SORTIE</option>
              <option value="CORRECTION">CORRECTION</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Produit :</label>
            <select
              value={filterProduitId}
              onChange={(e) => setFilterProduitId(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Tous les produits</option>
              {produits.map((p) => (
                <option key={p.produit.id} value={p.produit.id}>
                  {p.produit.nom} ({p.produit.unite})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Domaine :</label>
            <select
              value={filterDomaine}
              onChange={(e) => setFilterDomaine(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Tous les domaines</option>
              <option value="dom_d2">D2</option>
              <option value="dom_d3">D3</option>
              <option value="dom_d5">D5</option>
              <option value="dom_d1">D1</option>
              <option value="dom_d4">D4</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Recherche :</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Motif, tiers, admin..."
                className="w-full bg-white border border-slate-300 rounded-xl p-1.5 pl-6 font-bold text-slate-800 outline-none"
              />
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2.5" />
            </div>
          </div>
        </div>

        {/* Liste détaillée des mouvements */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
          {filteredMouvements.length === 0 ? (
            <p className="text-center text-slate-400 py-10 font-medium">
              Aucun mouvement de stock correspondant aux filtres.
            </p>
          ) : (
            filteredMouvements.map((m) => {
              const isInitial = m.type === 'INITIAL';
              const isEntree = m.type === 'ENTREE';
              const isSortie = m.type === 'SORTIE';
              const isCorrection = m.type === 'CORRECTION';

              return (
                <div
                  key={m.id}
                  className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-1.5 hover:border-slate-300 transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                          isInitial
                            ? 'bg-blue-50 border-blue-300 text-blue-900'
                            : isEntree
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            : isSortie
                            ? 'bg-amber-50 border-amber-300 text-amber-900'
                            : 'bg-purple-50 border-purple-300 text-purple-900'
                        }`}
                      >
                        {m.type}
                      </span>
                      <h4 className="font-black text-slate-900 text-xs">{m.produit_nom}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">({m.unite})</span>
                    </div>

                    <span
                      className={`font-mono font-black text-sm ${
                        isSortie
                          ? 'text-red-700'
                          : isEntree || isInitial
                          ? 'text-emerald-700'
                          : m.quantite >= 0
                          ? 'text-purple-700'
                          : 'text-red-700'
                      }`}
                    >
                      {isSortie ? `-${m.quantite}` : isEntree || isInitial ? `+${m.quantite}` : m.quantite > 0 ? `+${m.quantite}` : m.quantite}{' '}
                      {m.unite}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 p-2 rounded-xl font-medium">
                    <div>
                      <p>
                        <strong>Motif :</strong> {m.motif || '—'}
                        {m.tiers ? ` • ${isEntree ? 'Fournisseur' : 'Bénéficiaire'} : ${m.tiers}` : ''}
                        {m.reference_document ? ` • Doc : ${m.reference_document}` : ''}
                      </p>
                      {m.domaine_id && (
                        <p className="text-[10px] text-slate-500">
                          Affectation : {m.domaine_id.replace('dom_', '').toUpperCase()}
                          {m.serre_id ? ` (Serre : ${m.serre_id})` : ''}
                        </p>
                      )}
                    </div>

                    <div className="text-right text-[10px] text-slate-400 font-mono shrink-0">
                      <p>
                        {m.date} à{' '}
                        {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <p>Par : {m.created_by_nom}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pied */}
        <div className="bg-slate-50 p-3 border-t border-slate-200 flex justify-between items-center text-xs shrink-0">
          <span className="text-slate-500 font-mono text-[11px]">
            {filteredMouvements.length} mouvement(s) affiché(s)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl transition"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
