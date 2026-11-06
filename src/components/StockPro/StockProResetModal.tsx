import React, { useState } from 'react';
import { X, AlertTriangle, Trash2, CheckCircle2 } from 'lucide-react';
import { resetStockCatalogue } from '../../services/stockService';

interface StockProResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  produitsCount: number;
}

export const StockProResetModal: React.FC<StockProResetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  produitsCount,
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const canConfirm = confirmInput.trim().toUpperCase() === 'RESET' || confirmInput.trim().toUpperCase() === 'SUPPRIMER';

  const handleReset = async () => {
    if (!canConfirm) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await resetStockCatalogue();
      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de la réinitialisation.');
      }
      onSuccess(res.message || 'Catalogue réinitialisé avec succès. Le catalogue est maintenant vide.');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Une erreur est survenue.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-red-200 overflow-hidden flex flex-col">
        {/* En-tête */}
        <div className="bg-red-950 text-white p-4 flex items-center justify-between shrink-0 border-b border-red-900">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-600 flex items-center justify-center font-black">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm text-red-100">
                Réinitialisation Catalogue & Stock
              </h3>
              <p className="text-[11px] text-red-300">
                Action de remise à zéro du stock initial
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-red-300 hover:text-white p-1 rounded-full transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps */}
        <div className="p-4 space-y-3.5 text-xs">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 font-bold">
              {errorMessage}
            </div>
          )}

          <div className="p-3.5 bg-red-50/80 border border-red-200 rounded-2xl text-red-950 space-y-2">
            <p className="font-black text-xs text-red-900">
              ⚠️ Attention : cette action va vider le catalogue de stock ({produitsCount} produit(s))
            </p>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-red-800">
              <li>Tous les anciens produits du catalogue seront supprimés.</li>
              <li>Tous les anciens mouvements et stocks initiaux seront purgés.</li>
              <li>Le catalogue redeviendra entièrement vide, prêt pour une nouvelle création ou importation Excel.</li>
            </ul>
          </div>

          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-950 space-y-1">
            <p className="font-black text-xs flex items-center gap-1.5 text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Données strictement protégées et préservées :</span>
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              Vos comptes utilisateurs (Admin, Caporaux), vos ouvriers, serres, pointages historiques, récoltes, heures et tâches supplémentaires <strong>restent intacts à 100%</strong>.
            </p>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="font-black text-slate-800 block text-xs">
              Pour confirmer la purge du stock, tapez <span className="text-red-600 font-mono">RESET</span> ci-dessous :
            </label>
            <input
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder="Tapez RESET pour débloquer le bouton"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-center text-slate-900 focus:bg-white focus:border-red-600 outline-none uppercase text-xs"
              autoFocus
            />
          </div>

          {/* Boutons */}
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
              type="button"
              onClick={handleReset}
              disabled={!canConfirm || isSubmitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black py-2.5 rounded-xl shadow-xs transition active:scale-95 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Purge en cours...' : 'Purger et Réinitialiser'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
