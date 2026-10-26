/**
 * Modal d'importation d'ouvriers depuis un fichier Excel (.xlsx, .xls) ou CSV (.csv)
 * Affiche l'aperçu avant confirmation avec détection des doublons et erreurs
 */

import React, { useState, useRef, useId } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Check,
  RefreshCw,
  Plus,
  RotateCcw,
  Download,
} from 'lucide-react';
import { Ouvrier } from '../types';
import { parseWorkerFile, ParseWorkerFileResult } from '../utils/excelWorkerParser';
import * as storage from '../services/storage';

interface ImportOuvriersModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  existingWorkers: Ouvrier[];
  onImportSuccess: (summary: { added: number; updated?: number; deactivated?: number; doublons: number; erreurs: number }) => void;
}

export const ImportOuvriersModal: React.FC<ImportOuvriersModalProps> = ({
  isOpen,
  onClose,
  companyId,
  existingWorkers,
  onImportSuccess,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseWorkerFileResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filterStatut, setFilterStatut] = useState<'tous' | 'valide' | 'doublon' | 'erreur'>('tous');

  // Mode d'importation : 'ajouter' (par défaut) ou 'remplacer'
  const [importMode, setImportMode] = useState<'ajouter' | 'remplacer'>('ajouter');

  // État de la modale de confirmation de remplacement en 2 étapes
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);
  const [confirmInputText, setConfirmInputText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  if (!isOpen) return null;

  // Réinitialiser
  const handleReset = () => {
    setParseResult(null);
    setFileError(null);
    setShowReplaceModal(false);
    setHasDownloadedBackup(false);
    setConfirmInputText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Traiter la sélection du fichier
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileError(null);

    const result = await parseWorkerFile(file, existingWorkers, importMode === 'remplacer');
    setIsProcessing(false);

    if (!result.success) {
      setFileError(result.error || 'Erreur lors du traitement du fichier.');
      setParseResult(null);
    } else {
      setParseResult(result);
    }
  };

  // Re-traiter si le mode d'importation change
  const handleChangeImportMode = async (mode: 'ajouter' | 'remplacer') => {
    setImportMode(mode);
    setShowReplaceModal(false);
    setHasDownloadedBackup(false);
    setConfirmInputText('');

    if (fileInputRef.current?.files?.[0]) {
      setIsProcessing(true);
      const result = await parseWorkerFile(fileInputRef.current.files[0], existingWorkers, mode === 'remplacer');
      setIsProcessing(false);
      if (result.success) {
        setParseResult(result);
      }
    }
  };

  // Téléchargement obligatoire de la sauvegarde JSON
  const handleDownloadBackup = () => {
    const jsonStr = storage.exportBackupJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const jj = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const aaaa = now.getFullYear();
    const fileName = `pointage-backup-PRE-REMPLACEMENT-OUVRIERS-${jj}-${mm}-${aaaa}.json`;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setHasDownloadedBackup(true);
  };

  // Exécution finale de l'import
  const executeImport = (replace: boolean) => {
    if (!parseResult) return;

    const valides = parseResult.rows
      .filter((r) => r.statut === 'valide' && r.numero !== null)
      .map((r) => ({
        numero: r.numero as number,
        nom: r.nom,
        telephone: r.telephone,
      }));

    if (valides.length === 0) {
      setFileError('Aucune ligne valide à importer.');
      return;
    }

    const res = storage.bulkImportOuvriers(companyId, valides, replace);

    onImportSuccess({
      added: res.addedCount,
      updated: res.updatedCount,
      deactivated: res.deactivatedCount,
      doublons: parseResult.doublonsCount,
      erreurs: parseResult.erreursCount,
    });

    handleReset();
    onClose();
  };

  // Clic sur "Confirmer l'import"
  const handleConfirmImportClick = () => {
    if (importMode === 'remplacer') {
      setShowReplaceModal(true);
    } else {
      executeImport(false);
    }
  };

  // Filtrer les lignes affichées
  const displayedRows = parseResult
    ? parseResult.rows.filter((r) => {
        if (filterStatut === 'tous') return true;
        return r.statut === filterStatut;
      })
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* En-tête */}
        <div className="bg-emerald-800 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h3 className="font-black text-base leading-tight">
                Importer des ouvriers
              </h3>
              <p className="text-[11px] text-emerald-200">
                Fichiers Excel (.xlsx, .xls) et CSV (.csv)
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              handleReset();
              onClose();
            }}
            className="text-emerald-200 hover:text-white p-1 rounded-full"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Corps de la modale */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {/* SÉLECTEUR DU MODE D'IMPORTATION */}
          <div className="bg-slate-100 p-1.5 rounded-2xl border border-slate-200 grid grid-cols-2 gap-1 text-xs">
            <button
              type="button"
              onClick={() => handleChangeImportMode('ajouter')}
              className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                importMode === 'ajouter'
                  ? 'bg-white text-emerald-900 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Plus className="w-4 h-4 text-emerald-600" />
              <span>Ajouter à la liste</span>
            </button>

            <button
              type="button"
              onClick={() => handleChangeImportMode('remplacer')}
              className={`py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                importMode === 'remplacer'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
              <span>Remplacer la liste</span>
            </button>
          </div>

          {importMode === 'remplacer' && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-2.5 text-xs text-amber-900 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Mode Remplacer : Les ouvriers absents du fichier seront désactivés pour préserver l'historique exact des pointages.
              </span>
            </div>
          )}

          {/* ZONE 1 : Sélection de fichier si aucun fichier analysé */}
          {!parseResult && (
            <div className="space-y-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-400 hover:border-emerald-600 bg-emerald-50/50 hover:bg-emerald-50 rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-105 transition">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <span className="font-black text-sm text-slate-800 block">
                    Cliquez pour choisir un fichier
                  </span>
                  <span className="text-xs text-slate-500">
                    Prend en charge .xlsx, .xls et .csv
                  </span>
                </div>
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {/* Guide de format des colonnes */}
              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-emerald-600" />
                  <span>Format de colonnes supporté :</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  L'application détecte automatiquement les colonnes :
                </p>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white p-2 rounded-xl border border-slate-200">
                    <strong className="text-slate-800 block">Colonne 1 : Numéro</strong>
                    <span className="text-slate-400">"numero", "numéro", "n°", "matricule"...</span>
                  </div>
                  <div className="bg-white p-2 rounded-xl border border-slate-200">
                    <strong className="text-slate-800 block">Colonne 2 : Nom</strong>
                    <span className="text-slate-400">"nom", "nom complet", "name", "ouvrier"...</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 italic">
                  * Si aucun en-tête n'est trouvé, la colonne 1 servira de numéro et la colonne 2 de nom.
                </p>
              </div>
            </div>
          )}

          {/* Indicateur de chargement */}
          {isProcessing && (
            <div className="py-8 text-center text-emerald-700 space-y-2">
              <RefreshCw className="w-7 h-7 mx-auto animate-spin" />
              <div className="font-bold text-xs">Analyse du fichier en cours...</div>
            </div>
          )}

          {/* Erreur de fichier mal formé */}
          {fileError && (
            <div className="bg-red-50 border-2 border-red-300 text-red-900 rounded-2xl p-3 flex items-start gap-2.5 text-xs animate-in fade-in">
              <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-black text-sm text-red-800">
                  Erreur de lecture
                </strong>
                <span className="mt-0.5 block">{fileError}</span>
              </div>
            </div>
          )}

          {/* ZONE 2 : Aperçu avant confirmation */}
          {parseResult && (
            <div className="space-y-3">
              {/* Résumé statistique du fichier */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-black text-slate-800 truncate max-w-[200px]">
                    📄 {parseResult.nomFichier}
                  </span>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-[11px] text-emerald-700 hover:underline font-bold"
                  >
                    Changer de fichier
                  </button>
                </div>

                {/* Badges de filtrage */}
                <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterStatut('tous')}
                    className={`py-1.5 px-1 rounded-xl font-bold transition ${
                      filterStatut === 'tous'
                        ? 'bg-slate-800 text-white'
                        : 'bg-white text-slate-600 border border-slate-200'
                    }`}
                  >
                    <span className="block text-[10px] uppercase">Total</span>
                    <span className="text-sm font-black">{parseResult.totalLignes}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterStatut('valide')}
                    className={`py-1.5 px-1 rounded-xl font-bold transition ${
                      filterStatut === 'valide'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}
                  >
                    <span className="block text-[10px] uppercase">Valides</span>
                    <span className="text-sm font-black">{parseResult.validesCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterStatut('doublon')}
                    className={`py-1.5 px-1 rounded-xl font-bold transition ${
                      filterStatut === 'doublon'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    <span className="block text-[10px] uppercase">Doublons</span>
                    <span className="text-sm font-black">{parseResult.doublonsCount}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterStatut('erreur')}
                    className={`py-1.5 px-1 rounded-xl font-bold transition ${
                      filterStatut === 'erreur'
                        ? 'bg-red-600 text-white'
                        : 'bg-red-50 text-red-800 border border-red-200'
                    }`}
                  >
                    <span className="block text-[10px] uppercase">Erreurs</span>
                    <span className="text-sm font-black">{parseResult.erreursCount}</span>
                  </button>
                </div>
              </div>

              {/* Tableau de l'aperçu */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0 z-10 text-[11px] uppercase tracking-wider">
                      <tr>
                        <th className="py-2 px-2.5 w-12 text-center">N°</th>
                        <th className="py-2 px-2">Nom</th>
                        <th className="py-2 px-2 text-center w-24">Statut</th>
                        <th className="py-2 px-2">Détail</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {displayedRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-slate-400 italic">
                            Aucune ligne pour ce filtre
                          </td>
                        </tr>
                      ) : (
                        displayedRows.map((row) => {
                          return (
                            <tr
                              key={row.index}
                              className={`transition ${
                                row.statut === 'valide'
                                  ? 'hover:bg-emerald-50/50'
                                  : row.statut === 'doublon'
                                  ? 'bg-amber-50/40 text-slate-700'
                                  : 'bg-red-50/40 text-slate-700'
                              }`}
                            >
                              <td className="py-2 px-2.5 text-center font-black">
                                {row.numero !== null ? (
                                  <span className="inline-block w-7 h-7 rounded-lg bg-slate-800 text-white leading-7 text-xs">
                                    {row.numero}
                                  </span>
                                ) : (
                                  <span className="text-red-500 font-mono">-</span>
                                )}
                              </td>
                              <td className="py-2 px-2 font-bold truncate max-w-[140px]">
                                {row.nom}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {row.statut === 'valide' && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                    <Check className="w-3 h-3" /> Valide
                                  </span>
                                )}
                                {row.statut === 'doublon' && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-black bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                    <AlertTriangle className="w-3 h-3" /> Doublon
                                  </span>
                                )}
                                {row.statut === 'erreur' && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] font-black bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                                    <XCircle className="w-3 h-3" /> Erreur
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-[10px] text-slate-500 truncate max-w-[120px]">
                                {row.motif}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {parseResult.validesCount === 0 && (
                <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-2.5 text-xs">
                  ⚠️ Aucune ligne valide n'a pu être trouvée dans ce fichier.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pied de la modale */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              handleReset();
              onClose();
            }}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition"
          >
            Annuler
          </button>

          {parseResult && (
            <button
              type="button"
              disabled={parseResult.validesCount === 0}
              onClick={handleConfirmImportClick}
              className={`px-5 py-2.5 rounded-xl font-black text-xs shadow-md transition active:scale-95 flex items-center gap-1.5 cursor-pointer ${
                importMode === 'remplacer'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {importMode === 'remplacer' ? 'Remplacer la liste' : 'Confirmer l\'import'} ({parseResult.validesCount} ouvrier{parseResult.validesCount > 1 ? 's' : ''})
              </span>
            </button>
          )}
        </div>
      </div>

      {/* MODALE DE CONFIRMATION DE REMPLACEMENT EN 2 ÉTAPES AVEC SAUVEGARDE OBLIGATOIRE */}
      {showReplaceModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl border border-amber-300 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-amber-700 font-black text-base">
                <AlertTriangle className="w-5 h-5" />
                <span>Confirmation de remplacement</span>
              </div>
              <button
                type="button"
                onClick={() => setShowReplaceModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* ÉTAPE 1 : SAUVEGARDE OBLIGATOIRE */}
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3.5 space-y-2">
              <div className="flex items-center gap-2 font-black text-xs text-amber-950">
                <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-[11px] flex items-center justify-center shrink-0 font-bold">1</span>
                <span>Sauvegarde JSON de sécurité (Exigée)</span>
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed font-medium">
                Pour éviter toute perte accidentelle, vous devez télécharger une sauvegarde JSON de vos données avant d'effectuer le remplacement.
              </p>
              <button
                type="button"
                onClick={handleDownloadBackup}
                className={`w-full py-2.5 px-3 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition cursor-pointer ${
                  hasDownloadedBackup
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-amber-600 hover:bg-amber-700 text-white shadow-md'
                }`}
              >
                {hasDownloadedBackup ? (
                  <>
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Sauvegarde téléchargée avec succès !</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Sauvegarder et continuer</span>
                  </>
                )}
              </button>
            </div>

            {/* ÉTAPE 2 : CONFIRMATION "REMPLACER" */}
            <div className={`space-y-3 transition ${!hasDownloadedBackup ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex items-center gap-2 font-black text-xs text-slate-800">
                <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] flex items-center justify-center shrink-0 font-bold">2</span>
                <span>Confirmation par mot-clé</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {existingWorkers.filter((w) => w.actif).length} ouvrier(s) actuellement actif(s) absents du nouveau fichier seront <strong>désactivés</strong> (non supprimés) pour conserver l'historique des pointages.
              </p>
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Tapez <strong className="text-red-700">REMPLACER</strong> ci-dessous pour valider :
                </label>
                <input
                  type="text"
                  value={confirmInputText}
                  onChange={(e) => setConfirmInputText(e.target.value)}
                  placeholder="Tapez REMPLACER"
                  className="w-full uppercase font-black tracking-widest text-center py-2.5 bg-slate-50 border-2 border-slate-300 rounded-xl text-xs focus:bg-white focus:border-red-600 outline-none"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowReplaceModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!hasDownloadedBackup || confirmInputText.trim() !== 'REMPLACER'}
                onClick={() => executeImport(true)}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-black py-2.5 rounded-xl text-xs shadow-md disabled:shadow-none transition cursor-pointer"
              >
                Valider le remplacement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
