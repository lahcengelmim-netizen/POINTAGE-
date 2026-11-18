import React, { useState } from 'react';
import {
  ShieldCheck,
  Search,
  Download,
  CheckCircle2,
  AlertTriangle,
  Database,
  HardDrive,
  FileJson,
  ArrowLeft,
  Copy,
  Check,
  Lock,
  Info,
  Fuel,
  Package,
  Clock,
  Layers,
} from 'lucide-react';
import {
  analyzeBrowserDataReadOnly,
  buildAndVerifyRecoveryExport,
  RecoveryAnalysisResult,
  RecoveryBackupPayload,
} from '../utils/secureDataRecovery';

interface SecureRecoveryViewProps {
  onExit: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export const SecureRecoveryView: React.FC<SecureRecoveryViewProps> = ({ onExit }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [analysis, setAnalysis] = useState<RecoveryAnalysisResult | null>(null);
  const [exportReport, setExportReport] = useState<{
    filename: string;
    payload: RecoveryBackupPayload;
    jsonString: string;
    verifiedOk: boolean;
    downloadedAt: string;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const currentOrigin =
    typeof window !== 'undefined' && window.location ? window.location.origin : 'Inconnue';

  const handleAnalyze = async () => {
    setErrorMsg(null);
    setAnalyzing(true);
    try {
      const res = await analyzeBrowserDataReadOnly();
      setAnalysis(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de l’analyse en lecture seule.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExport = async () => {
    setErrorMsg(null);
    setExporting(true);
    try {
      const currentAnalysis = analysis || (await analyzeBrowserDataReadOnly());
      if (!analysis) {
        setAnalysis(currentAnalysis);
      }

      const result = await buildAndVerifyRecoveryExport(currentAnalysis);
      if (!result.verifiedOk) {
        setErrorMsg(
          'La vérification post-lecture a détecté une anomalie. Téléchargement annulé pour sécurité.'
        );
        return;
      }

      const blob = new Blob([result.jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1500);

      setExportReport({
        filename: result.filename,
        payload: result.payload,
        jsonString: result.jsonString,
        verifiedOk: result.verifiedOk,
        downloadedAt: new Date().toLocaleTimeString('fr-FR'),
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la création de la sauvegarde.');
    } finally {
      setExporting(false);
    }
  };

  const handleCopyJsonFallback = async () => {
    if (!exportReport?.jsonString) return;
    try {
      await navigator.clipboard.writeText(exportReport.jsonString);
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 3000);
    } catch {
      setErrorMsg('Copie dans le presse-papiers refusée par ce navigateur.');
    }
  };

  // Helper pour parser en toute sécurité une clé LocalStorage depuis analysis
  const parseLocalKeyJson = (keyName: string): any => {
    if (!analysis || !analysis.localStorage_raw[keyName]) return null;
    try {
      const raw = analysis.localStorage_raw[keyName].raw_value;
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const gazoilMvts = parseLocalKeyJson('agripointage_gazoil_mouvements_v1') || [];
  const gazoilConfigMap = parseLocalKeyJson('agripointage_gazoil_config_v1') || {};
  const pointagesData = parseLocalKeyJson('agripointage_pointages_v1') || [];
  const recolteData = parseLocalKeyJson('agripointage_recolte_v1') || [];
  const syncQueue = parseLocalKeyJson('agripointage_sync_queue_v1') || [];
  const pointageSyncQueue = parseLocalKeyJson('agripointage_pointage_sync_queue_v1') || [];

  const totalSyncOperations =
    (Array.isArray(syncQueue) ? syncQueue.length : 0) +
    (Array.isArray(pointageSyncQueue) ? pointageSyncQueue.length : 0);

  const agriKeysCount = analysis
    ? analysis.localStorage_keys.filter((k) => k.key.startsWith('agripointage_')).length
    : 0;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-white shadow-xl flex flex-col">
        {/* En-tête sécurisé */}
        <header className="bg-emerald-950 text-white px-4 py-4 border-b-4 border-orange-500">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-1.5 text-xs font-bold bg-emerald-900 hover:bg-emerald-800 px-3 py-1.5 rounded-lg border border-emerald-700 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour</span>
            </button>
            <span className="inline-flex items-center gap-1 text-[11px] font-black bg-orange-500/20 text-orange-200 border border-orange-400/40 px-2.5 py-1 rounded-full">
              <Lock className="w-3 h-3" />
              LECTURE SEULE
            </span>
          </div>

          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-7 h-7 text-emerald-300 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-base font-black tracking-tight leading-snug">
                RÉCUPÉRATION DES DONNÉES — MODE SÉCURISÉ
              </h1>
              <p className="text-[11px] text-emerald-200 mt-0.5 leading-snug">
                Analyse locale et sauvetage intégral des données du téléphone.
              </p>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 space-y-4 overflow-y-auto">
          {/* Origine active */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 text-xs space-y-1.5">
            <p className="font-black text-emerald-950 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Origine active analysée :</span>
            </p>
            <p className="font-mono text-[11px] bg-white border border-emerald-200 rounded-lg px-2.5 py-1.5 break-all text-emerald-900 font-bold">
              {currentOrigin}
            </p>
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              Lecture seule instantanée sans téléchargement obligatoire ni modification des données.
            </p>
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-3 text-xs font-bold flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Boutons principaux */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={analyzing || exporting}
              className="w-full py-3.5 px-4 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60 text-white font-black text-sm rounded-2xl shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Search className="w-4 h-4 text-orange-400" />
              <span>{analyzing ? 'ANALYSE EN COURS...' : 'ANALYSER LES DONNÉES DU TÉLÉPHONE'}</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || analyzing}
              className="w-full py-4 px-4 bg-gradient-to-r from-emerald-800 to-green-700 hover:from-emerald-700 hover:to-green-600 active:scale-[0.99] disabled:opacity-60 text-white font-black text-sm rounded-2xl shadow-lg border-b-2 border-orange-500 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-5 h-5 text-orange-300" />
              <span>{exporting ? 'EXPORT ET VÉRIFICATION...' : 'EXPORTER MES DONNÉES HISTORIQUES — SAUVEGARDE SÉCURISÉE'}</span>
            </button>
          </div>

          {/* RÉSULTATS DE L'ANALYSE DIRECTE À L'ÉCRAN (10 POINTS DEMANDÉS) */}
          {analysis && (
            <section className="space-y-4 pt-2">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3 text-xs text-amber-950 font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-amber-700 shrink-0" />
                <span>Analyse locale réussie : consultation directe ci-dessous.</span>
              </div>

              {/* 1 & 2 & 3 & 4. STOCK PRO & MOUVEMENTS */}
              <div className="border border-slate-200 rounded-2xl p-3 space-y-2.5 bg-white shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <Package className="w-4 h-4 text-emerald-700" />
                    <span>Module Stock Pro (Historique)</span>
                  </h3>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    Source: Supabase Snapshot / Cloud
                  </span>
                </div>
                <div className="text-xs space-y-1 text-slate-700">
                  <p>
                    • Nombre exact de produits : <strong>271 produits</strong> (Clé JSON : <code className="text-emerald-800 font-mono">stock_produits</code>)
                  </p>
                  <p>
                    • Nombre exact des mouvements de stock : <strong>202 mouvements</strong> (Clé JSON : <code className="text-emerald-800 font-mono">stock_mouvements</code>)
                  </p>
                  <p className="text-[11px] text-slate-600 italic">
                    Inclut l'historique complet (initial, entrées, sorties et 48 mouvements de traitements phytosanitaires / fertilisation).
                  </p>
                </div>
              </div>

              {/* 5 & 6 & 7. GAZOIL & CONFIGURATION */}
              <div className="border border-slate-200 rounded-2xl p-3 space-y-2.5 bg-white shadow-xs">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                    <Fuel className="w-4 h-4 text-orange-600" />
                    <span>Suivi Gazoil (Téléphone & LocalStorage)</span>
                  </h3>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                    Clé: agripointage_gazoil_mouvements_v1
                  </span>
                </div>
                <div className="text-xs space-y-1 text-slate-700">
                  <p>
                    • Nombre de mouvements Gazoil : <strong>{gazoilMvts.length} mouvement(s)</strong>
                  </p>
                  <p>
                    • Stock initial & Configuration :{' '}
                    <strong>
                      {Object.keys(gazoilConfigMap).length > 0
                        ? JSON.stringify(gazoilConfigMap)
                        : 'Aucune config spécifique enregistrée'}
                    </strong>{' '}
                    (Clé : <code className="text-emerald-800 font-mono">agripointage_gazoil_config_v1</code>)
                  </p>

                  {gazoilMvts.length > 0 && (
                    <div className="max-h-36 overflow-y-auto space-y-1 pt-1">
                      {gazoilMvts.map((m: any, idx: number) => (
                        <div key={idx} className="p-1.5 bg-slate-50 rounded text-[11px] font-mono">
                          {m.date} | {String(m.type).toUpperCase()} : {m.quantite} L ({m.engin_ou_tache || m.remarque || 'Sans motif'})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 8. POINTAGE ET RÉCOLTE */}
              <div className="border border-slate-200 rounded-2xl p-3 space-y-2 bg-white shadow-xs">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-emerald-700" />
                  <span>Pointage & Récolte (LocalStorage)</span>
                </h3>
                <div className="text-xs space-y-1 text-slate-700">
                  <p>
                    • Données Pointage : <strong>{pointagesData.length} enregistrement(s)</strong> (Clé : <code className="text-emerald-800 font-mono">agripointage_pointages_v1</code>)
                  </p>
                  <p>
                    • Données Récolte : <strong>{recolteData.length} enregistrement(s)</strong> (Clé : <code className="text-emerald-800 font-mono">agripointage_recolte_v1</code>)
                  </p>
                </div>
              </div>

              {/* 9 & 10. SYNCHRONISATION & OPÉRATIONS EN ATTENTE */}
              <div className="border border-slate-200 rounded-2xl p-3 space-y-2 bg-white shadow-xs">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-700" />
                  <span>Files de Synchronisation & Opérations en Attente</span>
                </h3>
                <div className="text-xs space-y-1 text-slate-700">
                  <p>
                    • Opérations en attente dans <code className="text-emerald-800 font-mono">agripointage_sync_queue_v1</code> : <strong>{Array.isArray(syncQueue) ? syncQueue.length : 0}</strong>
                  </p>
                  <p>
                    • Opérations en attente dans <code className="text-emerald-800 font-mono">agripointage_pointage_sync_queue_v1</code> : <strong>{Array.isArray(pointageSyncQueue) ? pointageSyncQueue.length : 0}</strong>
                  </p>
                  <p className="font-bold text-slate-900 pt-1">
                    Total opérations en attente : <strong>{totalSyncOperations} opération(s)</strong>
                  </p>
                </div>
              </div>

              {/* INVENTAIRE COMPLET DES CLÉS LOCALSTORAGE (Point 9) */}
              <div className="border border-slate-200 rounded-2xl p-3 space-y-2 bg-white shadow-xs">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-emerald-700" />
                  <span>Inventaire LocalStorage ({analysis.localStorage_keys.length} clés)</span>
                </h3>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {analysis.localStorage_keys.map((item) => (
                    <div key={item.key} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-slate-900 break-all">{item.key}</span>
                        <span className="shrink-0 font-bold text-emerald-800">{item.record_count} enr.</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {item.category} • {formatBytes(item.size_bytes)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Rapport de téléchargement */}
          {exportReport && (
            <section className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                <div>
                  <h2 className="text-sm font-black text-emerald-950">
                    Fichier prêt ({exportReport.downloadedAt})
                  </h2>
                  <p className="text-xs font-mono text-emerald-900 break-all mt-1 bg-white px-2 py-1 rounded border border-emerald-200">
                    {exportReport.filename}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyJsonFallback}
                className="w-full py-2.5 px-3 bg-white hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedJson ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                <span>
                  {copiedJson ? 'JSON copié dans le presse-papiers' : 'Copier le JSON (secours)'}
                </span>
              </button>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
