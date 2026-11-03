import React, { useState, useRef } from 'react';
import { Upload, X, AlertCircle, CheckCircle2, FileSpreadsheet, AlertTriangle, ArrowRight } from 'lucide-react';
import { parseStockInitialExcel, importInitialStock, generateIdempotencyKey } from '../../services/stockService';
import { StockProduitSynthese } from '../../types';

interface StockProImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingProduits: StockProduitSynthese[];
  onImportSuccess: () => void;
}

export const StockProImportModal: React.FC<StockProImportModalProps> = ({
  isOpen,
  onClose,
  existingProduits,
  onImportSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [parsedItems, setParsedItems] = useState<Array<{ nom: string; unite: string; qte: number }>>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    importedCount?: number;
    alreadyInitialized?: string[];
    message?: string;
    error?: string;
  } | null>(null);

  if (!isOpen) return null;

  // Création d'un set des produits ayant DÉJÀ un stock initial enregistré
  const alreadyInitializedKeys = new Set(
    existingProduits
      .filter((p) => typeof p.stock_initial === 'number' && p.stock_initial > 0)
      .map((p) => `${p.produit.nom.trim().toUpperCase()}_${p.produit.unite.trim().toUpperCase()}`)
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setIsParsing(true);
    setParseErrors([]);
    setImportResult(null);

    try {
      const { validItems, errors } = await parseStockInitialExcel(file);
      setParsedItems(validItems);
      setParseErrors(errors);
    } catch (err: any) {
      setParseErrors([err.message || 'Erreur lors de la lecture du fichier Excel.']);
      setParsedItems([]);
    } finally {
      setIsParsing(false);
    }
  };

  // Filtrer les éléments réellement importables (non déjà existants)
  const itemsToImport = parsedItems.filter(
    (item) => !alreadyInitializedKeys.has(`${item.nom.trim().toUpperCase()}_${item.unite.trim().toUpperCase()}`)
  );

  const alreadyCount = parsedItems.length - itemsToImport.length;

  const handleConfirmImport = async () => {
    if (itemsToImport.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setImportResult(null);

    try {
      // Clé d'idempotence unique générée avant l'envoi
      const idempotencyKey = generateIdempotencyKey();
      const res = await importInitialStock(itemsToImport, idempotencyKey);

      setImportResult(res);

      if (res.success) {
        onImportSuccess();
        setTimeout(() => {
          onClose();
        }, 2500);
      }
    } catch (err: any) {
      setImportResult({ success: false, error: err.message || 'Erreur lors de l\'enregistrement.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* En-tête */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center font-black">
              <FileSpreadsheet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm">Importation Stock Initial (Excel)</h3>
              <p className="text-[11px] text-slate-400">Exactement 3 colonnes : NOM PRODUIT | UNITE | QTE</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps avec défilement */}
        <div className="p-4 space-y-3.5 overflow-y-auto text-xs">
          {/* Instructions spécifiques */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-emerald-950 space-y-1">
            <p className="font-black text-xs flex items-center gap-1.5">
              <span>📋 Format strict du fichier :</span>
            </p>
            <p className="text-[11px] leading-relaxed text-emerald-800">
              Votre fichier Excel doit comporter uniquement 3 colonnes : <strong>NOM PRODUIT</strong>, <strong>UNITE</strong> (KG, L, UNITE...) et <strong>QTE</strong> (nombre supérieur ou égal à 0).
            </p>
          </div>

          {/* Sélecteur de fichier */}
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-4 text-center hover:border-emerald-500 bg-slate-50 transition">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx, .xls"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-black px-4 py-2.5 rounded-xl shadow-xs transition cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{selectedFile ? 'Changer de fichier Excel' : 'Sélectionner le fichier Excel (.xlsx, .xls)'}</span>
            </button>
            {selectedFile && (
              <p className="text-[11px] font-bold text-slate-700 mt-2">
                Fichier sélectionné : <span className="text-emerald-800 font-mono">{selectedFile.name}</span>
              </p>
            )}
          </div>

          {/* Erreurs de parsing */}
          {parseErrors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl space-y-1 text-red-900">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Anomalies détectées ({parseErrors.length}) :</span>
              </div>
              <ul className="list-disc pl-5 text-[11px] space-y-0.5 text-red-800 max-h-24 overflow-y-auto">
                {parseErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Aperçu des données détectées */}
          {parsedItems.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-black text-slate-800 text-xs">
                  Aperçu des produits ({parsedItems.length}) :
                </h4>
                {alreadyCount > 0 && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                    {alreadyCount} déjà existant(s)
                  </span>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {parsedItems.map((item, idx) => {
                  const isAlreadyInit = alreadyInitializedKeys.has(`${item.nom.trim().toUpperCase()}_${item.unite.trim().toUpperCase()}`);
                  return (
                    <div
                      key={idx}
                      className={`p-2 flex items-center justify-between text-xs ${
                        isAlreadyInit ? 'bg-amber-50/60' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] flex items-center justify-center font-mono">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-black text-slate-900">{item.nom}</p>
                          <p className="text-[10px] text-slate-500 font-medium">Unité : {item.unite}</p>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-black text-emerald-800 text-xs bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                          {item.qte} {item.unite}
                        </span>
                        {isAlreadyInit ? (
                          <span className="block text-[9px] text-amber-700 font-bold mt-0.5">
                            Stock initial déjà enregistré
                          </span>
                        ) : (
                          <span className="block text-[9px] text-emerald-600 font-bold mt-0.5">
                            Prêt à initialiser
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Résultat d'importation */}
          {importResult && (
            <div
              className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 ${
                importResult.success
                  ? 'bg-emerald-50 border border-emerald-300 text-emerald-950'
                  : 'bg-red-50 border border-red-300 text-red-950'
              }`}
            >
              {importResult.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              )}
              <span>{importResult.message || importResult.error}</span>
            </div>
          )}
        </div>

        {/* Pied avec boutons d'action */}
        <div className="bg-slate-50 p-4 border-t border-slate-200 flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-white hover:bg-slate-100 text-slate-700 font-bold py-2.5 rounded-xl border border-slate-200 transition text-xs"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={handleConfirmImport}
            disabled={itemsToImport.length === 0 || isSubmitting}
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 disabled:text-slate-500 text-white font-black py-2.5 rounded-xl shadow-xs transition active:scale-95 text-xs flex items-center justify-center gap-1.5"
          >
            {isSubmitting ? (
              <span>Enregistrement...</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirmer ({itemsToImport.length} produits)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
