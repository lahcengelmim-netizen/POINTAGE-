import React, { useState, useEffect } from 'react';
import { X, Package, Check, AlertCircle } from 'lucide-react';
import { StockProduit } from '../../types';
import { createProduit, updateProduit } from '../../services/stockService';

interface StockProProduitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string, createdProduct?: StockProduit) => void;
  onProductCreated?: (createdProduct: StockProduit) => void;
  produitToEdit?: StockProduit | null;
  zIndexClass?: string;
}

const COMMON_UNITS = ['KG', 'L', 'PIECE', 'CARTON', 'SAC', 'BIDON', 'BOITE', 'METRE', 'ROULEAU'];

export const StockProProduitModal: React.FC<StockProProduitModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onProductCreated,
  produitToEdit,
  zIndexClass = 'z-[70]',
}) => {
  const isEdit = !!produitToEdit;

  const [nom, setNom] = useState('');
  const [unite, setUnite] = useState('KG');
  const [customUnite, setCustomUnite] = useState('');
  const [isCustomUnite, setIsCustomUnite] = useState(false);
  const [stockInitial, setStockInitial] = useState<number | string>(0);
  const [seuilMinimum, setSeuilMinimum] = useState<number | string>(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      if (produitToEdit) {
        setNom(produitToEdit.nom);
        const u = produitToEdit.unite.toUpperCase();
        if (COMMON_UNITS.includes(u)) {
          setUnite(u);
          setIsCustomUnite(false);
          setCustomUnite('');
        } else {
          setUnite('CUSTOM');
          setIsCustomUnite(true);
          setCustomUnite(u);
        }
        setSeuilMinimum(produitToEdit.seuil_minimum ?? 5);
        setStockInitial(0);
      } else {
        setNom('');
        setUnite('KG');
        setCustomUnite('');
        setIsCustomUnite(false);
        setStockInitial(0);
        setSeuilMinimum(5);
      }
    }
  }, [isOpen, produitToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const nomClean = nom.trim().toUpperCase();
    const finalUnite = (isCustomUnite ? customUnite : unite).trim().toUpperCase();
    const seuilNum = Number(seuilMinimum);
    const initialNum = Number(stockInitial);

    if (!nomClean) {
      setErrorMessage('Le nom du produit est obligatoire.');
      return;
    }
    if (!finalUnite) {
      setErrorMessage('L\'unité de mesure est obligatoire.');
      return;
    }
    if (isNaN(seuilNum) || seuilNum < 0) {
      setErrorMessage('Le seuil minimum doit être un nombre positif ou nul.');
      return;
    }
    if (!isEdit && (isNaN(initialNum) || initialNum < 0)) {
      setErrorMessage('Le stock initial doit être un nombre supérieur ou égal à 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEdit && produitToEdit) {
        const res = await updateProduit(produitToEdit.id, nomClean, finalUnite, seuilNum);
        if (!res.success) {
          throw new Error(res.error || 'Erreur lors de la mise à jour.');
        }
        onSuccess(`Produit "${nomClean}" modifié avec succès.`, res.produit);
      } else {
        const res = await createProduit(nomClean, finalUnite, seuilNum, initialNum);
        if (!res.success) {
          throw new Error(res.error || 'Erreur lors de la création du produit.');
        }
        if (res.produit) {
          onProductCreated?.(res.produit);
        }
        onSuccess(`Produit "${nomClean}" créé avec succès (Stock initial : ${initialNum} ${finalUnite}).`, res.produit);
      }
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Une erreur est survenue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${zIndexClass} bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in`}>
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* En-tête */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-black">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm">
                {isEdit ? 'Modifier le Produit' : 'Nouveau Produit au Catalogue'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isEdit ? 'Mettre à jour les paramètres du produit' : 'Création manuelle avec stock initial libre'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="font-medium text-[11px]">{errorMessage}</span>
            </div>
          )}

          {/* Nom du produit */}
          <div className="space-y-1">
            <label className="font-black text-slate-700">
              Nom du Produit <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="Ex: ENGRAIS NPK 20-20-20, MAP, CARTOUCHE 20..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold uppercase text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none text-xs"
              autoFocus
              required
            />
          </div>

          {/* Unité de mesure */}
          <div className="space-y-1.5">
            <label className="font-black text-slate-700">
              Unité de Mesure <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_UNITS.map((u) => {
                const isSelected = !isCustomUnite && unite === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      setUnite(u);
                      setIsCustomUnite(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg font-black text-[11px] transition cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {u}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setIsCustomUnite(true)}
                className={`px-2.5 py-1 rounded-lg font-black text-[11px] transition cursor-pointer ${
                  isCustomUnite
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                Autre...
              </button>
            </div>

            {isCustomUnite && (
              <input
                type="text"
                value={customUnite}
                onChange={(e) => setCustomUnite(e.target.value)}
                placeholder="Préciser l'unité (ex: LITRE, BOITE 50, PALETTE...)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold uppercase text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none text-xs mt-1"
                required
              />
            )}
          </div>

          {/* Stock Initial (uniquement à la création) */}
          {!isEdit && (
            <div className="space-y-1 bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3">
              <div className="flex items-center justify-between">
                <label className="font-black text-emerald-950">
                  Stock Initial d'ouverture
                </label>
                <span className="text-[10px] text-emerald-700 font-bold">
                  Accepte 0 et toute valeur positive
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={stockInitial}
                  onChange={(e) => setStockInitial(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 bg-white border border-emerald-300 rounded-xl font-black text-emerald-900 text-sm focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 outline-none"
                />
                <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400 uppercase pointer-events-none">
                  {isCustomUnite ? customUnite || 'UNITÉ' : unite}
                </span>
              </div>
              <p className="text-[10px] text-emerald-800">
                Vous pouvez saisir <strong>0</strong> si le stock physique est actuellement vide (ex: CARTOUCHE 20 = 0).
              </p>
            </div>
          )}

          {/* Seuil minimum d'alerte */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="font-black text-slate-700">
                Seuil Minimum d'Alerte (Stock Faible)
              </label>
              <span className="text-[10px] text-slate-400 font-medium">Par défaut : 5</span>
            </div>
            <div className="relative">
              <input
                type="number"
                step="any"
                min="0"
                value={seuilMinimum}
                onChange={(e) => setSeuilMinimum(e.target.value)}
                placeholder="5"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900 text-xs focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none"
              />
              <span className="absolute right-3 top-2 text-[11px] font-bold text-slate-400 uppercase pointer-events-none">
                {isCustomUnite ? customUnite || 'UNITÉ' : unite}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Une alerte jaune "Stock Faible" s'affichera dès que le stock actuel descendra sous ce niveau.
            </p>
          </div>

          {/* Boutons d'action */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 bg-white hover:bg-slate-100 text-slate-700 font-bold py-2.5 rounded-xl border border-slate-200 transition text-xs cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-black py-2.5 rounded-xl shadow-xs transition active:scale-95 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Enregistrement...' : isEdit ? 'Enregistrer' : 'Créer le Produit'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
