/**
 * Modal d'importation de tâches depuis un fichier Excel (.xlsx, .xls), CSV ou texte collé
 * Respecte :
 * - Lecture des colonnes "code" et "nom" (code optionnel)
 * - Format texte : "CODE;NOM" ou "CODE - NOM" ou "NOM"
 * - Dans l'aperçu d'import, signalement en rouge des codes en double
 * - Option de remplacement complet ou d'ajout
 */

import React, { useState, useRef, useId } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Check,
  RotateCcw,
  Plus,
  Download,
} from 'lucide-react';
import { Tache } from '../types';
import {
  parseTasksFromFile,
  parseTasksFromText,
  ParseTaskResult,
} from '../utils/excelTaskParser';
import * as storage from '../services/storage';

interface ImportTachesModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  existingTasks: Tache[];
  onImportSuccess: (summary: { added: number; updated?: number; deactivated?: number; total: number }) => void;
}

export const ImportTachesModal: React.FC<ImportTachesModalProps> = ({
  isOpen,
  onClose,
  companyId,
  existingTasks,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'fichier' | 'texte'>('fichier');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseTaskResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [filterStatut, setFilterStatut] = useState<'tous' | 'valide' | 'doublon_code' | 'erreur'>('tous');

  // Mode d'importation : 'ajouter' (par défaut) ou 'remplacer'
  const [importMode, setImportMode] = useState<'ajouter' | 'remplacer'>('ajouter');

  // État de la modale de confirmation de remplacement en 2 étapes
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);
  const [confirmInputText, setConfirmInputText] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  if (!isOpen) return null;

  const handleReset = () => {
    setParseResult(null);
    setFileError(null);
    setPastedText('');
    setShowReplaceModal(false);
    setHasDownloadedBackup(false);
    setConfirmInputText('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileError(null);

    const result = await parseTasksFromFile(file, existingTasks, importMode === 'remplacer');
    setIsProcessing(false);

    if (!result.success) {
      setFileError(result.error || 'Erreur lors du traitement du fichier.');
      setParseResult(null);
    } else {
      setParseResult(result);
    }
  };

  const handleAnalyzeText = () => {
    if (!pastedText.trim()) {
      setFileError('Veuillez coller ou saisir du texte.');
      return;
    }
    setFileError(null);
    const result = parseTasksFromText(pastedText, existingTasks, importMode === 'remplacer');
    if (!result.success) {
      setFileError(result.error || 'Erreur lors de l\'analyse.');
      setParseResult(null);
    } else {
      setParseResult(result);
    }
  };

  const handleChangeImportMode = async (mode: 'ajouter' | 'remplacer') => {
    setImportMode(mode);
    setShowReplaceModal(false);
    setHasDownloadedBackup(false);
    setConfirmInputText('');

    if (activeTab === 'fichier' && fileInputRef.current?.files?.[0]) {
      setIsProcessing(true);
      const result = await parseTasksFromFile(fileInputRef.current.files[0], existingTasks, mode === 'remplacer');
      setIsProcessing(false);
      if (result.success) setParseResult(result);
    } else if (activeTab === 'texte' && pastedText.trim()) {
      const result = parseTasksFromText(pastedText, existingTasks, mode === 'remplacer');
      if (result.success) setParseResult(result);
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
    const fileName = `pointage-backup-PRE-REMPLACEMENT-TACHES-${jj}-${mm}-${aaaa}.json`;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setHasDownloadedBackup(true);
  };

  const executeImport = (replace: boolean) => {
    if (!parseResult) return;

    const valides = parseResult.rows
      .filter((r) => r.statut === 'valide' && r.nom)
      .map((r) => ({
        code: r.code || undefined,
        nom: r.nom,
      }));

    if (valides.length === 0) {
      setFileError('Aucune tâche valide à importer.');
      return;
    }

    const res = storage.bulkImportTaches(companyId, valides, replace);
    onImportSuccess(res);
    handleReset();
    onClose();
  };

  const handleConfirmImportClick = () => {
    if (importMode === 'remplacer') {
      setShowReplaceModal(true);
    } else {
      executeImport(false);
    }
  };

  const displayedRows = (parseResult?.rows || []).filter((r) => {
    if (filterStatut === 'tous') return true;
    if (filterStatut === 'valide') return r.statut === 'valide';
    if (filterStatut === 'doublon_code') return r.statut === 'doublon_code';
    if (filterStatut === 'erreur') return r.statut === 'erreur' || r.statut === 'doublon_nom';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* En-tête */}
        <div className="bg-emerald-700 text-white p-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <FileSpreadsheet className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h2 className="text-base font-black">Importer des Tâches</h2>
              <p className="text-xs text-emerald-100">
                Excel (.xlsx), CSV ou texte avec colonnes Code et Nom
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-xl text-emerald-100 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps de la modale */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
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
                Mode Remplacer : Les tâches absentes du fichier seront désactivées pour préserver l'historique exact des pointages.
              </span>
            </div>
          )}

          {/* Choix de la méthode si pas encore analysé */}
          {!parseResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl gap-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('fichier')}
                  className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                    activeTab === 'fichier'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Fichier Excel / CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('texte')}
                  className={`py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition ${
                    activeTab === 'texte'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>Coller du texte</span>
                </button>
              </div>

              {activeTab === 'fichier' ? (
                <div className="space-y-3">
                  <label
                    htmlFor={fileInputId}
                    className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/80 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition text-center"
                  >
                    <Upload className="w-8 h-8 text-emerald-600 mb-2 animate-bounce" />
                    <span className="text-xs font-black text-slate-800">
                      Cliquez pour sélectionner un fichier Excel ou CSV
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1">
                      Formats supportés : .xlsx, .xls, .csv
                    </span>
                    <span className="text-[10px] text-emerald-700 font-bold mt-2 bg-emerald-100 px-2 py-0.5 rounded-full">
                      Colonnes attendues : Code (optionnel) et Nom
                    </span>
                    <input
                      id={fileInputId}
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">
                    Collez votre liste de tâches :
                  </label>
                  <textarea
                    rows={6}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={`R01;RECOLTE\nE01;EFFEUILLAGE\nEN01 - ENTRETIEN\nP01 - PLANTATION\nIRRIGATION`}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-mono font-bold uppercase focus:bg-white focus:border-emerald-600 outline-none"
                  />
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <p>• Formats acceptés par ligne : <code>CODE;NOM</code> ou <code>CODE - NOM</code></p>
                    <p>• Si le code est absent (ex: <code>RECOLTE</code>), le code restera vide.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyzeText}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 rounded-xl transition cursor-pointer"
                  >
                    Analyser le texte
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Erreur de fichier */}
          {fileError && (
            <div className="bg-red-50 border border-red-300 text-red-900 text-xs p-3 rounded-2xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {/* Aperçu des données analysées */}
          {parseResult && (
            <div className="space-y-3">
              {/* Barre de résumé */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setFilterStatut('tous')}
                  className={`p-2 rounded-xl border text-center transition ${
                    filterStatut === 'tous'
                      ? 'bg-slate-800 text-white border-slate-900 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <div className="text-base font-black">{parseResult.totalLignes}</div>
                  <div className="text-[10px] font-bold">Total lignes</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterStatut('valide')}
                  className={`p-2 rounded-xl border text-center transition ${
                    filterStatut === 'valide'
                      ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                      : 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  }`}
                >
                  <div className="text-base font-black text-emerald-600">{parseResult.validesCount}</div>
                  <div className="text-[10px] font-bold">✓ Valides</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterStatut('doublon_code')}
                  className={`p-2 rounded-xl border text-center transition ${
                    filterStatut === 'doublon_code'
                      ? 'bg-red-700 text-white border-red-800 shadow-xs'
                      : 'bg-red-50 text-red-900 border-red-200'
                  }`}
                >
                  <div className="text-base font-black text-red-600">{parseResult.doublonsCodeCount}</div>
                  <div className="text-[10px] font-bold">⚠️ Codes en double</div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilterStatut('erreur')}
                  className={`p-2 rounded-xl border text-center transition ${
                    filterStatut === 'erreur'
                      ? 'bg-amber-700 text-white border-amber-800 shadow-xs'
                      : 'bg-amber-50 text-amber-900 border-amber-200'
                  }`}
                >
                  <div className="text-base font-black text-amber-600">
                    {parseResult.erreursCount + parseResult.doublonsNomCount}
                  </div>
                  <div className="text-[10px] font-bold">Autres ignorés</div>
                </button>
              </div>

              {parseResult.doublonsCodeCount > 0 && (
                <div className="bg-red-50 border-2 border-red-300 text-red-900 p-2.5 rounded-2xl text-xs flex items-center gap-2 font-bold">
                  <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>
                    Attention : {parseResult.doublonsCodeCount} code(s) en double détecté(s) (surlignés en rouge ci-dessous) et ne seront pas importés.
                  </span>
                </div>
              )}

              {/* Tableau d'aperçu */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 font-black sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-center w-10">#</th>
                      <th className="p-2 w-28">Code</th>
                      <th className="p-2">Nom de la tâche</th>
                      <th className="p-2 text-right">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-slate-400">
                          Aucune ligne pour ce filtre
                        </td>
                      </tr>
                    ) : (
                      displayedRows.map((row) => {
                        const isCodeDup = row.statut === 'doublon_code';
                        const isValide = row.statut === 'valide';
                        return (
                          <tr
                            key={row.index}
                            className={`transition ${
                              isCodeDup
                                ? 'bg-red-100/70 text-red-950 font-bold'
                                : isValide
                                ? 'hover:bg-slate-50'
                                : 'bg-slate-50/60 text-slate-500'
                            }`}
                          >
                            <td className="p-2 text-center text-slate-400 font-mono text-[11px]">
                              {row.index}
                            </td>
                            <td className="p-2 font-mono font-black">
                              {row.code ? (
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[11px] ${
                                    isCodeDup
                                      ? 'bg-red-600 text-white'
                                      : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                  }`}
                                >
                                  {row.code}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic text-[11px]">-</span>
                              )}
                            </td>
                            <td className="p-2 font-black uppercase tracking-wide">
                              {row.nom || <span className="text-slate-400 italic">Vide</span>}
                            </td>
                            <td className="p-2 text-right">
                              {isValide ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[10px]">
                                  <Check className="w-3 h-3" />
                                  Valide
                                </span>
                              ) : isCodeDup ? (
                                <span className="inline-flex items-center gap-1 text-red-800 font-bold bg-red-200 px-2 py-0.5 rounded-md text-[10px]">
                                  <X className="w-3 h-3" />
                                  {row.motif}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-600 font-semibold bg-slate-200 px-2 py-0.5 rounded-md text-[10px]">
                                  {row.motif}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pied de page d'action */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          {parseResult ? (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Changer de fichier</span>
              </button>

              <button
                type="button"
                disabled={parseResult.validesCount === 0}
                onClick={handleConfirmImportClick}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs transition active:scale-95 cursor-pointer ${
                  parseResult.validesCount > 0
                    ? importMode === 'remplacer'
                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-md'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {importMode === 'remplacer' ? 'Remplacer la liste' : 'Importer'} ({parseResult.validesCount} tâche(s))
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="ml-auto px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Fermer
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
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
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
                {existingTasks.filter((t) => t.actif !== false).length} tâche(s) actuellement active(s) absentes du nouveau fichier seront <strong>désactivées</strong> (non supprimées) pour conserver l'historique des pointages.
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

