/**
 * Écran indépendant : EXPORT PAIEMENT EXCEL (RÉSERVÉ ADMINISTRATEUR)
 * Application : LAHCEN POINTEUR / AGRIPOINTEUR
 *
 * - Source : Pointage Matin (lecture seule, localStorage + Supabase)
 * - Conservation intégrale du modèle Excel original (.xlsx) à 21 colonnes exactes
 * - Tarifs automatiques configurables dans "PARAMÈTRES DES TARIFS DE PAIEMENT" (synchro multi-appareils)
 * - Non-rétroactivité stricte : snapshots illimités figés et re-téléchargeables (.xlsx) à l'identique
 * - Détection explicite des erreurs de chargement Supabase (session, RLS, réseau)
 * - Accès bloqué pour Caporal, Caporal Contractuelles et Tariq
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  FileSpreadsheet,
  Calendar,
  Download,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Lock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Save,
  Clock,
  History,
  Upload,
  WifiOff,
} from 'lucide-react';
import {
  AffectationTache,
  Company,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
  TacheSerreConfig,
  UserAccount,
} from '../types';
import * as storage from '../services/storage';
import { isSupabaseConfigured, supabase } from '../services/supabaseClient';
import {
  DEFAULT_PAIEMENT_TARIFFS,
  PAIEMENT_TEMPLATE_FILENAME,
  PAIEMENT_TEMPLATE_PUBLIC_URL,
  PAIEMENT_TEMPLATE_STORAGE_KEY,
  PaiementExportSnapshot,
  PaiementHoursOverride,
  PaiementTariffsConfig,
  RecolteVarietyChoice,
  buildPaiementRows,
  classifySupabaseLoadErrors,
  computeEffectiveWorkedHours,
  exportPaiementExcel,
  flushPaiementSyncQueue,
  formatDHDisplay,
  isAdminPaiementAuthorized,
  loadHoursOverridesForDate,
  loadPaiementExportHistory,
  loadPaiementTariffs,
  loadVarietyOverridesForDate,
  reexportPaiementSnapshotExcel,
  resetPaiementTariffsToDefaults,
  resolvePauseHours,
  saveHoursOverridesForDate,
  saveVarietyOverridesForDate,
  syncLoadPaiementDayOverridesFromSupabase,
  syncLoadPaiementSnapshotsFromSupabase,
  syncLoadPaiementTariffsFromSupabase,
  syncSavePaiementDayOverrideToSupabase,
  syncSavePaiementSnapshotToSupabase,
  syncSavePaiementTariffsToSupabase,
  validatePaiementExcelTemplate,
} from '../utils/paiementExporter';

const DOMAINE_FILTER_OPTIONS = ['ALL', 'D1', 'D2', 'D3', 'D4', 'D5'] as const;

const DEMO_DEFAULT_NAMES_BY_NUM: Record<number, string> = {
  1: 'Mohammed Amine',
  2: 'Fatima Zahra',
  3: 'Youssef El Idrissi',
  4: 'Hassan Benali',
  5: 'Khadija Mansouri',
  6: 'Brahim Oukacha',
  7: 'Aïcha Tazi',
  8: 'Omar Naciri',
  9: 'Salma Daoudi',
  10: 'Khalid Berrada',
  11: 'Zineb Alaoui',
  12: 'Mustapha Chaoui',
  13: 'Nadia El Fassi',
  14: 'Rachid Bouzid',
  15: 'Samira Bennani',
};

function isProvisionalDemoWorker(w: Partial<Ouvrier>): boolean {
  if (!w || !w.numero) return false;
  const expected = DEMO_DEFAULT_NAMES_BY_NUM[Number(w.numero)];
  return Boolean(expected && w.id === `ouv_${w.numero}` && String(w.nom || '').trim() === expected);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

interface ExportPaiementViewProps {
  currentUser: UserAccount;
  currentCompany: Company;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  allOuvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  defaultDomaineId: string;
  allRecoltes: RecolteEntry[];
  tacheSerresConfigs: TacheSerreConfig[];
}

export const ExportPaiementView: React.FC<ExportPaiementViewProps> = ({
  currentUser,
  currentCompany,
  selectedDate,
  onSelectDate,
  allOuvriers,
  taches,
  domaines,
  serres,
  defaultDomaineId,
  allRecoltes,
  tacheSerresConfigs,
}) => {
  const authorized = isAdminPaiementAuthorized(currentUser);
  const companyId = currentCompany?.id || currentUser?.company_id || 'cie_lahcen_pointeur';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [domaineFilter, setDomaineFilter] = useState<string>('ALL');
  const [loadingRemote, setLoadingRemote] = useState<boolean>(false);
  const [remoteVerified, setRemoteVerified] = useState<boolean>(false);
  const [remoteLoadError, setRemoteLoadError] = useState<{
    message: string;
    details: string[];
  } | null>(null);
  const [remotePointages, setRemotePointages] = useState<Pointage[]>([]);
  const [remoteAffectations, setRemoteAffectations] = useState<AffectationTache[]>([]);
  const [remoteRecoltes, setRemoteRecoltes] = useState<RecolteEntry[]>([]);
  const [remoteOuvriers, setRemoteOuvriers] = useState<Ouvrier[]>([]);
  const [remoteTaches, setRemoteTaches] = useState<Tache[]>([]);
  const [remoteSerres, setRemoteSerres] = useState<Serre[]>([]);
  const [remoteDomaines, setRemoteDomaines] = useState<Domaine[]>([]);
  const [storageTick, setStorageTick] = useState<number>(0);

  // Modèle Excel original (.xlsx) obligatoire
  const [templateBuffer, setTemplateBuffer] = useState<Uint8Array | null>(null);
  const [templateStatus, setTemplateStatus] = useState<{
    state: 'loading' | 'ready' | 'missing' | 'invalid';
    source: 'public' | 'local' | 'none';
    message: string;
  }>({
    state: 'loading',
    source: 'none',
    message: `Vérification du modèle Excel original "${PAIEMENT_TEMPLATE_FILENAME}"...`,
  });

  // Paramètres des tarifs (Admin + synchro Supabase)
  const [showTariffSettings, setShowTariffSettings] = useState<boolean>(false);
  const [savedTariffs, setSavedTariffs] = useState<PaiementTariffsConfig>(() =>
    loadPaiementTariffs(companyId)
  );
  const [draftTariffs, setDraftTariffs] = useState<PaiementTariffsConfig>(() =>
    loadPaiementTariffs(companyId)
  );
  const [tariffFeedback, setTariffFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Ajustements d'heures & choix explicites de variété
  const [hoursOverrides, setHoursOverrides] = useState<Record<string, PaiementHoursOverride>>(() =>
    loadHoursOverridesForDate(companyId, selectedDate)
  );
  const [varietyOverrides, setVarietyOverrides] = useState<Record<string, RecolteVarietyChoice>>(() =>
    loadVarietyOverridesForDate(companyId, selectedDate)
  );
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editHeureDeb, setEditHeureDeb] = useState<string>('07:00');
  const [editHeureFin, setEditHeureFin] = useState<string>('16:00');
  const [editPause, setEditPause] = useState<string>('1');

  // Historique & export
  const [exportHistory, setExportHistory] = useState<PaiementExportSnapshot[]>(() =>
    loadPaiementExportHistory(companyId)
  );
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [reexportingId, setReexportingId] = useState<string | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Charger le modèle Excel original (.xlsx) depuis /templates/ ou localStorage
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;

    const loadTemplate = async () => {
      try {
        const res = await fetch(PAIEMENT_TEMPLATE_PUBLIC_URL);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const check = await validatePaiementExcelTemplate(ab);
          if (check.valid && !cancelled) {
            setTemplateBuffer(new Uint8Array(ab));
            setTemplateStatus({
              state: 'ready',
              source: 'public',
              message: `Modèle Excel original prêt (${PAIEMENT_TEMPLATE_FILENAME} · 21 colonnes).`,
            });
            return;
          }
        }
      } catch {
        // Fallback vers localStorage ci-dessous
      }

      try {
        const savedB64 = localStorage.getItem(PAIEMENT_TEMPLATE_STORAGE_KEY);
        if (savedB64) {
          const bytes = base64ToUint8(savedB64);
          const check = await validatePaiementExcelTemplate(bytes);
          if (check.valid && !cancelled) {
            setTemplateBuffer(bytes);
            setTemplateStatus({
              state: 'ready',
              source: 'local',
              message: `Modèle Excel original importé prêt (${PAIEMENT_TEMPLATE_FILENAME} · 21 colonnes).`,
            });
            return;
          }
        }
      } catch {
        // Ignoré
      }

      if (!cancelled) {
        setTemplateBuffer(null);
        setTemplateStatus({
          state: 'missing',
          source: 'none',
          message: `Modèle Excel original "${PAIEMENT_TEMPLATE_FILENAME}" requis. Importez-le avant de générer l'export.`,
        });
      }
    };

    loadTemplate();
    return () => {
      cancelled = true;
    };
  }, [authorized]);

  useEffect(() => {
    const loaded = loadPaiementTariffs(companyId);
    setSavedTariffs(loaded);
    setDraftTariffs(loaded);
    setExportHistory(loadPaiementExportHistory(companyId));
  }, [companyId]);

  useEffect(() => {
    setHoursOverrides(loadHoursOverridesForDate(companyId, selectedDate));
    setVarietyOverrides(loadVarietyOverridesForDate(companyId, selectedDate));
    setEditingRowKey(null);
  }, [companyId, selectedDate]);

  useEffect(() => {
    return storage.subscribeToStorage(() => setStorageTick((t) => t + 1));
  }, []);

  const loadReadOnlyFromSupabase = useCallback(async () => {
    if (!authorized || !companyId || !selectedDate) return;
    setRemotePointages([]);
    setRemoteAffectations([]);
    setRemoteRecoltes([]);
    setRemoteLoadError(null);
    setRemoteVerified(false);

    if (!isSupabaseConfigured) {
      setLoadingRemote(false);
      setRemoteLoadError({
        message:
          "ERREUR DE CHARGEMENT DES DONNÉES — Les données n'ont pas pu être vérifiées. Vérifiez votre connexion avant de générer le paiement.",
        details: ['Configuration Supabase absente : affichage des données locales uniquement.'],
      });
      return;
    }

    setLoadingRemote(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const hasSession = Boolean(sessionData?.session);
      if (sessionError || !hasSession) {
        const classified = classifySupabaseLoadErrors({
          hasSession,
          sessionError,
        });
        setRemoteLoadError({
          message:
            classified.userMessage ||
            "ERREUR DE CHARGEMENT DES DONNÉES — Les données n'ont pas pu être vérifiées. Vérifiez votre connexion avant de générer le paiement.",
          details: classified.technicalDetails,
        });
        setLoadingRemote(false);
        return;
      }

      const [ptRes, affRes, recRes, ouvRes, tchRes, serRes, domRes] = await Promise.all([
        supabase.from('pointages').select('*').eq('company_id', companyId).eq('date', selectedDate),
        supabase.from('affectations').select('*').eq('company_id', companyId).eq('date', selectedDate),
        supabase.from('recolte_entries').select('*').eq('company_id', companyId).eq('date', selectedDate),
        supabase.from('ouvriers').select('*').eq('company_id', companyId).order('numero', { ascending: true }),
        supabase.from('taches').select('*').eq('company_id', companyId),
        supabase.from('serres').select('*').eq('company_id', companyId).order('ordre', { ascending: true }),
        supabase.from('domaines').select('*').eq('company_id', companyId).order('ordre', { ascending: true }),
      ]);

      const classified = classifySupabaseLoadErrors({
        hasSession: true,
        outcomes: [
          { label: 'pointages', critical: true, error: ptRes.error },
          { label: 'affectations', critical: true, error: affRes.error },
          { label: 'recolte_entries', critical: true, error: recRes.error },
          { label: 'ouvriers', critical: true, error: ouvRes.error },
          { label: 'taches', critical: false, error: tchRes.error },
          { label: 'serres', critical: false, error: serRes.error },
          { label: 'domaines', critical: false, error: domRes.error },
        ],
      });

      if (!ptRes.error && Array.isArray(ptRes.data)) setRemotePointages(ptRes.data as Pointage[]);
      if (!affRes.error && Array.isArray(affRes.data)) setRemoteAffectations(affRes.data as AffectationTache[]);
      if (!recRes.error && Array.isArray(recRes.data)) setRemoteRecoltes(recRes.data as RecolteEntry[]);
      if (!ouvRes.error && Array.isArray(ouvRes.data)) setRemoteOuvriers(ouvRes.data as Ouvrier[]);
      if (!tchRes.error && Array.isArray(tchRes.data)) setRemoteTaches(tchRes.data as Tache[]);
      if (!serRes.error && Array.isArray(serRes.data)) setRemoteSerres(serRes.data as Serre[]);
      if (!domRes.error && Array.isArray(domRes.data)) setRemoteDomaines(domRes.data as Domaine[]);

      if (classified.hasError) {
        setRemoteLoadError({
          message: classified.userMessage!,
          details: classified.technicalDetails,
        });
        setRemoteVerified(false);
      } else {
        setRemoteLoadError(null);
        setRemoteVerified(true);
      }

      // Pousser d'abord les éventuelles modifications paiement en attente hors ligne
      await flushPaiementSyncQueue(currentUser, companyId, supabase).catch(() => {});

      // Synchronisation non-destructive des tarifs Admin, historique figé et ajustements du jour
      const [tarSync, snapSync, daySync] = await Promise.all([
        syncLoadPaiementTariffsFromSupabase(companyId, supabase),
        syncLoadPaiementSnapshotsFromSupabase(companyId, supabase),
        syncLoadPaiementDayOverridesFromSupabase(companyId, selectedDate, supabase),
      ]);
      if (tarSync.ok) {
        setSavedTariffs(tarSync.config);
        setDraftTariffs(tarSync.config);
      }
      if (snapSync.snapshots.length > 0) {
        setExportHistory(snapSync.snapshots);
      }
      if (daySync.ok) {
        setHoursOverrides(daySync.hoursOverrides);
        setVarietyOverrides(daySync.varietyOverrides);
      }
    } catch (err: unknown) {
      const classified = classifySupabaseLoadErrors({
        hasSession: true,
        thrownError: err,
      });
      setRemoteLoadError({
        message: classified.userMessage!,
        details: classified.technicalDetails,
      });
      setRemoteVerified(false);
    } finally {
      setLoadingRemote(false);
    }
  }, [authorized, companyId, selectedDate]);

  useEffect(() => {
    loadReadOnlyFromSupabase();
  }, [loadReadOnlyFromSupabase]);

  const mergedOuvriers = useMemo<Ouvrier[]>(() => {
    const rawLocal = allOuvriers?.length ? allOuvriers : storage.getOuvriers(companyId);
    const localList = rawLocal.filter((w) => !w.company_id || w.company_id === companyId);
    const remoteList = remoteOuvriers.filter((w) => !w.company_id || w.company_id === companyId);
    const hasNonDemoLocal = localList.some((w) => !isProvisionalDemoWorker(w));
    const hasRemote = remoteList.length > 0;

    const byNum = new Map<number, Ouvrier>();
    const extras: Ouvrier[] = [];

    for (const w of localList) {
      if (!w) continue;
      if (hasRemote && !hasNonDemoLocal && isProvisionalDemoWorker(w)) continue;
      if (w.numero && Number(w.numero) > 0) byNum.set(Number(w.numero), w);
      else extras.push(w);
    }

    for (const rw of remoteList) {
      if (!rw) continue;
      if (rw.numero && Number(rw.numero) > 0) {
        const existing = byNum.get(Number(rw.numero));
        if (!existing || isProvisionalDemoWorker(existing) || hasRemote) {
          byNum.set(Number(rw.numero), rw);
        }
      } else {
        extras.push(rw);
      }
    }

    return [...Array.from(byNum.values()), ...extras];
  }, [allOuvriers, remoteOuvriers, companyId, storageTick]);

  const mergedTaches = useMemo<Tache[]>(() => {
    const map = new Map<string, Tache>();
    [...(taches || []), ...(storage.getTaches(companyId) || []), ...remoteTaches].forEach((t) => {
      if (t?.id && (!t.company_id || t.company_id === companyId)) map.set(t.id, t);
    });
    return Array.from(map.values());
  }, [taches, remoteTaches, companyId, storageTick]);

  const mergedDomaines = useMemo<Domaine[]>(() => {
    const map = new Map<string, Domaine>();
    [...(domaines || []), ...(storage.getDomaines() || []), ...remoteDomaines].forEach((d: any) => {
      if (d?.id && (!d.company_id || d.company_id === companyId)) map.set(d.id, d);
    });
    return Array.from(map.values()).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  }, [domaines, remoteDomaines, companyId, storageTick]);

  const mergedSerres = useMemo<Serre[]>(() => {
    const map = new Map<string, Serre>();
    [...(serres || []), ...(storage.getSerres(companyId) || []), ...remoteSerres].forEach((s) => {
      if (s?.id && (!s.company_id || s.company_id === companyId)) map.set(s.id, s);
    });
    return Array.from(map.values());
  }, [serres, remoteSerres, companyId, storageTick]);

  const mergedPointages = useMemo<Pointage[]>(() => {
    const localPtgs = storage.getPointages(companyId, selectedDate);
    const byKey = new Map<string, Pointage>();
    [...remotePointages, ...localPtgs].forEach((p) => {
      if (!p || p.date !== selectedDate) return;
      if (p.company_id && p.company_id !== companyId) return;
      const k =
        p.numero_ouvrier && Number(p.numero_ouvrier) > 0
          ? `num:${p.numero_ouvrier}`
          : p.ouvrier_id
          ? `id:${p.ouvrier_id}`
          : `ptg:${p.id}`;
      const prev = byKey.get(k);
      if (!prev || Number(p.timestamp || 0) >= Number(prev.timestamp || 0)) {
        byKey.set(k, p);
      }
    });
    return Array.from(byKey.values());
  }, [companyId, selectedDate, remotePointages, storageTick]);

  const mergedAffectations = useMemo<AffectationTache[]>(() => {
    const localAffs = storage.getAffectations(companyId, selectedDate);
    const byId = new Map<string, AffectationTache>();
    [...remoteAffectations, ...localAffs].forEach((a) => {
      if (!a || a.date !== selectedDate) return;
      if (a.company_id && a.company_id !== companyId) return;
      const k = a.id || `${a.ouvrier_id}_${a.tache_id}_${a.domaine_id}_${a.serre_id}`;
      byId.set(k, a);
    });
    return Array.from(byId.values());
  }, [companyId, selectedDate, remoteAffectations, storageTick]);

  const mergedRecoltes = useMemo<RecolteEntry[]>(() => {
    const localRecs = (allRecoltes?.length ? allRecoltes : storage.getRecoltes(companyId)).filter(
      (r) => r.date === selectedDate && (!r.company_id || r.company_id === companyId)
    );
    const byId = new Map<string, RecolteEntry>();
    [...remoteRecoltes, ...localRecs].forEach((r) => {
      if (!r || r.date !== selectedDate) return;
      if (r.company_id && r.company_id !== companyId) return;
      byId.set(r.id, r);
    });
    return Array.from(byId.values());
  }, [allRecoltes, remoteRecoltes, companyId, selectedDate, storageTick]);

  const scopedTacheSerresConfigs = useMemo(
    () => (tacheSerresConfigs || []).filter((c) => !c.company_id || c.company_id === companyId),
    [tacheSerresConfigs, companyId]
  );

  const preview = useMemo(() => {
    return buildPaiementRows({
      companyId,
      dateIso: selectedDate,
      domaineFilter,
      ouvriers: mergedOuvriers,
      taches: mergedTaches,
      domaines: mergedDomaines,
      serres: mergedSerres,
      pointages: mergedPointages,
      affectations: mergedAffectations,
      recoltes: mergedRecoltes,
      tacheSerresConfigs: scopedTacheSerresConfigs,
      defaultDomaineId,
      tariffs: savedTariffs,
      hoursOverrides,
      varietyOverrides,
      respectFrozenSnapshot: true,
    });
  }, [
    companyId,
    selectedDate,
    domaineFilter,
    mergedOuvriers,
    mergedTaches,
    mergedDomaines,
    mergedSerres,
    mergedPointages,
    mergedAffectations,
    mergedRecoltes,
    scopedTacheSerresConfigs,
    defaultDomaineId,
    savedTariffs,
    hoursOverrides,
    varietyOverrides,
    exportHistory,
  ]);

  if (!authorized) {
    return (
      <div className="bg-white rounded-2xl p-6 text-center border border-amber-300 shadow-xs space-y-3">
        <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h2 className="font-bold text-slate-900 text-base">Accès strictement réservé à l’Administrateur</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Le module EXPORT PAIEMENT EXCEL et les paramètres de tarifs sont réservés au compte Administrateur.
        </p>
      </div>
    );
  }

  const handleImportTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      const check = await validatePaiementExcelTemplate(bytes);
      if (!check.valid) {
        setTemplateStatus({
          state: 'invalid',
          source: 'none',
          message: check.error || 'Fichier modèle Excel invalide.',
        });
        setExportFeedback({
          type: 'error',
          message: check.error || 'Modèle Excel refusé (21 colonnes exactes sur feuille "Pointage" requises).',
        });
        return;
      }

      try {
        localStorage.setItem(PAIEMENT_TEMPLATE_STORAGE_KEY, uint8ToBase64(bytes));
      } catch {
        // Quota localStorage éventuel : mémoire active conservée
      }
      setTemplateBuffer(bytes);
      setTemplateStatus({
        state: 'ready',
        source: 'local',
        message: `Modèle original "${file.name}" validé et prêt (21 colonnes · feuille "Pointage").`,
      });
      setExportFeedback(null);
    } catch {
      setTemplateStatus({
        state: 'invalid',
        source: 'none',
        message: 'Impossible de lire le fichier .xlsx sélectionné.',
      });
    }
  };

  const handleSaveTariffs = async () => {
    const res = await syncSavePaiementTariffsToSupabase(
      currentUser,
      companyId,
      draftTariffs,
      isSupabaseConfigured ? supabase : null
    );
    if (res.success && res.config) {
      setSavedTariffs(res.config);
      setDraftTariffs(res.config);
      setTariffFeedback({
        type: 'success',
        message: res.syncedToSupabase
          ? `Tarifs enregistrés et synchronisés (v${res.config.version}). Ils s'appliquent aux prochains exports ; l'historique figé reste inchangé.`
          : `Tarifs enregistrés localement (v${res.config.version}). ${res.syncError ? `Synchro distante différée : ${res.syncError}` : 'Ils s’appliquent aux prochains exports.'}`,
      });
    } else {
      setTariffFeedback({
        type: 'error',
        message: res.error || 'Erreur lors de la sauvegarde des tarifs.',
      });
    }
  };

  const handleResetTariffs = async () => {
    const res = resetPaiementTariffsToDefaults(currentUser, companyId);
    if (res.success && res.config) {
      setSavedTariffs(res.config);
      setDraftTariffs(res.config);
      await syncSavePaiementTariffsToSupabase(
        currentUser,
        companyId,
        res.config,
        isSupabaseConfigured ? supabase : null
      );
      setTariffFeedback({
        type: 'success',
        message: 'Tarifs réinitialisés aux valeurs officielles par défaut.',
      });
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      const res = await exportPaiementExcel({
        companyId,
        preview,
        domaineFilter,
        domaines: mergedDomaines,
        currentUser,
        templateBuffer,
        includeTotauxSheet: true,
        persistSnapshot: true,
      });
      if (res.success) {
        if (res.snapshot) {
          await syncSavePaiementSnapshotToSupabase(
            currentUser,
            res.snapshot,
            isSupabaseConfigured ? supabase : null
          );
        }
        setExportHistory(loadPaiementExportHistory(companyId));
        setExportFeedback({
          type: 'success',
          message: `Export généré depuis le modèle original : ${res.filename} (${res.totalLignes} ligne(s) · ${formatDHDisplay(res.grandTotalDH)} DH)`,
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res.error || 'Échec de l’export Excel.',
        });
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleReexportSnapshot = async (snapshot: PaiementExportSnapshot) => {
    setReexportingId(snapshot.id);
    setExportFeedback(null);
    try {
      const res = await reexportPaiementSnapshotExcel({
        snapshot,
        currentUser,
        templateBuffer,
        includeTotauxSheet: true,
      });
      if (res.success) {
        setExportFeedback({
          type: 'success',
          message: `Snapshot historique téléchargé à l'identique : ${res.filename} (${res.totalLignes} ligne(s) · ${formatDHDisplay(res.grandTotalDH)} DH)`,
        });
      } else {
        setExportFeedback({
          type: 'error',
          message: res.error || 'Impossible de re-télécharger ce snapshot.',
        });
      }
    } finally {
      setReexportingId(null);
    }
  };

  const handleVarietyChoice = (rowKey: string, variety: RecolteVarietyChoice) => {
    if (preview.isHistoricalFrozen) return;
    const next = { ...varietyOverrides, [rowKey]: variety };
    setVarietyOverrides(next);
    saveVarietyOverridesForDate(companyId, selectedDate, next);
    syncSavePaiementDayOverrideToSupabase(
      currentUser,
      companyId,
      selectedDate,
      'variety',
      rowKey,
      variety,
      isSupabaseConfigured ? supabase : null
    ).catch(() => {});
  };

  const openHoursEditor = (rowKey: string, heureDeb: string, heureFin: string, dureeRep: number | '') => {
    if (preview.isHistoricalFrozen) return;
    setEditingRowKey(rowKey);
    setEditHeureDeb(heureDeb || '07:00');
    setEditHeureFin(heureFin || '16:00');
    setEditPause(dureeRep === '' ? '0' : String(dureeRep));
  };

  const saveRowHours = (rowKey: string) => {
    if (preview.isHistoricalFrozen) return;
    const pauseNum = Math.max(0, Number(editPause) || 0);
    const overridePayload = {
      heureDeb: editHeureDeb || '07:00',
      heureFin: editHeureFin || '16:00',
      dureeRep: pauseNum,
    };
    const next = {
      ...hoursOverrides,
      [rowKey]: overridePayload,
    };
    setHoursOverrides(next);
    saveHoursOverridesForDate(companyId, selectedDate, next);
    setEditingRowKey(null);
    syncSavePaiementDayOverrideToSupabase(
      currentUser,
      companyId,
      selectedDate,
      'hours',
      rowKey,
      overridePayload,
      isSupabaseConfigured ? supabase : null
    ).catch(() => {});
  };

  const clearRowHours = (rowKey: string) => {
    if (preview.isHistoricalFrozen) return;
    const next = { ...hoursOverrides };
    delete next[rowKey];
    setHoursOverrides(next);
    saveHoursOverridesForDate(companyId, selectedDate, next);
    setEditingRowKey(null);
    syncSavePaiementDayOverrideToSupabase(
      currentUser,
      companyId,
      selectedDate,
      'hours',
      rowKey,
      null,
      isSupabaseConfigured ? supabase : null
    ).catch(() => {});
  };

  const handleTariffInput = (key: keyof typeof DEFAULT_PAIEMENT_TARIFFS, raw: string) => {
    const cleaned = raw.replace(',', '.');
    const num = cleaned === '' ? 0 : Number(cleaned);
    setDraftTariffs((prev) => ({
      ...prev,
      [key]: Number.isFinite(num) && num >= 0 ? num : 0,
    }));
  };

  const canRunExport =
    !isExporting &&
    templateStatus.state === 'ready' &&
    Boolean(templateBuffer) &&
    preview.rows.length > 0 &&
    preview.blockedVarietyRowsCount === 0;

  return (
    <div className="space-y-3 pb-24">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleImportTemplateFile}
        className="hidden"
      />

      {/* En-tête principal */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-800 text-white flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-slate-900">
                EXPORT PAIEMENT EXCEL
              </h1>
              <p className="text-xs text-slate-600">
                Calcul automatique depuis Pointage Matin (lecture seule)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadReadOnlyFromSupabase}
            disabled={loadingRemote}
            className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
            title="Actualiser depuis Pointage Matin"
          >
            <RefreshCw className={`w-4 h-4 ${loadingRemote ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Statut du modèle Excel original (.xlsx) obligatoire */}
        <div
          className={`rounded-xl border p-3 text-xs flex items-center justify-between gap-2 ${
            templateStatus.state === 'ready'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-900'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {templateStatus.state === 'ready' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="font-bold">Modèle Excel original (21 colonnes)</p>
              <p className="text-[11px] opacity-90 break-words">{templateStatus.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[40px] px-3 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold text-[11px] flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{templateStatus.state === 'ready' ? 'Remplacer .xlsx' : 'Importer .xlsx'}</span>
          </button>
        </div>

        {/* Alerte explicite d'erreur Supabase (jamais de faux vide silencieux) */}
        {remoteLoadError && (
          <div className="rounded-xl bg-red-50 border border-red-300 p-3 text-xs text-red-950 space-y-1.5">
            <div className="flex items-start gap-2 font-bold">
              <WifiOff className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <span>{remoteLoadError.message}</span>
            </div>
            {preview.rows.length > 0 && (
              <p className="text-[11px] font-semibold text-amber-900 bg-amber-100/80 border border-amber-300 rounded-lg px-2 py-1">
                Attention : les lignes ci-dessous proviennent uniquement du cache local (données locales non vérifiées / non synchronisées).
              </p>
            )}
            {remoteLoadError.details.length > 0 && (
              <p className="text-[11px] text-red-800">
                Détail technique : {remoteLoadError.details[0]}
              </p>
            )}
          </div>
        )}

        {/* Sélecteurs Date + Domaine */}
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Date de pointage
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onSelectDate(e.target.value)}
                className="w-full min-h-[44px] pl-9 pr-2.5 rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">
              Domaine
            </label>
            <select
              value={domaineFilter}
              onChange={(e) => setDomaineFilter(e.target.value)}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-slate-50 text-sm font-bold text-slate-900 focus:outline-none focus:border-emerald-600 focus:bg-white"
            >
              {DOMAINE_FILTER_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === 'ALL' ? 'Tous les domaines' : `Domaine ${opt}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Indicateur historique figé si la date a déjà été exportée */}
        {preview.isHistoricalFrozen && preview.frozenSnapshot && (
          <div className="rounded-xl bg-slate-900 text-white p-3 flex items-start gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Paiement historique figé (non-rétroactif)</p>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Exporté le {new Date(preview.frozenSnapshot.exportedAt).toLocaleString('fr-FR')} par{' '}
                {preview.frozenSnapshot.exportedByNom}. Les modifications ultérieures des tarifs ne modifient jamais ces montants.
              </p>
            </div>
          </div>
        )}

        {/* Chiffres clés */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
            <p className="text-[11px] text-slate-500 font-semibold">Ouvriers présents</p>
            <p className="text-lg font-black text-slate-900 tabular-nums mt-0.5">
              {preview.totalOuvriersDistincts}
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5">
            <p className="text-[11px] text-slate-500 font-semibold">Tâches pointées</p>
            <p className="text-lg font-black text-slate-900 tabular-nums mt-0.5">
              {preview.rows.length}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5">
            <p className="text-[11px] text-emerald-800 font-semibold">Total Paiement</p>
            <p className="text-lg font-black text-emerald-950 tabular-nums mt-0.5">
              {formatDHDisplay(preview.grandTotalDH)} <span className="text-xs font-bold">DH</span>
            </p>
          </div>
        </div>

        {/* Bouton principal Export Excel */}
        <button
          type="button"
          onClick={handleExportExcel}
          disabled={!canRunExport}
          className={`w-full min-h-[48px] px-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition active:scale-[0.99] cursor-pointer shadow-xs ${
            !canRunExport
              ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
              : 'bg-emerald-700 hover:bg-emerald-800 text-white'
          }`}
        >
          <Download className="w-5 h-5" />
          <span>{isExporting ? 'Génération Excel en cours...' : 'EXPORT PAIEMENT EXCEL (.xlsx)'}</span>
        </button>

        {exportFeedback && (
          <div
            className={`rounded-xl p-3 text-xs font-semibold flex items-start gap-2 ${
              exportFeedback.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : 'bg-red-50 border border-red-200 text-red-900'
            }`}
          >
            {exportFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            )}
            <span>{exportFeedback.message}</span>
          </div>
        )}

        {preview.warnings.length > 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
            {preview.warnings.map((w, idx) => (
              <div key={idx} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Paramètres des tarifs de paiement (Admin uniquement) */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <button
          type="button"
          onClick={() => setShowTariffSettings((s) => !s)}
          className="w-full min-h-[52px] px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-slate-700" />
            <div>
              <h2 className="text-sm font-black text-slate-900">
                PARAMÈTRES DES TARIFS DE PAIEMENT
              </h2>
              <p className="text-[11px] text-slate-500">
                Version {savedTariffs.version} · Tarifs automatiques · Futurs exports uniquement
              </p>
            </div>
          </div>
          {showTariffSettings ? (
            <ChevronUp className="w-5 h-5 text-slate-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-500" />
          )}
        </button>

        {showTariffSettings && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100 space-y-3">
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
              Toute modification s’applique uniquement aux prochains exports. Les paiements déjà exportés restent figés sans recalcul rétroactif.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <TariffInput
                label="Récolte Cerise"
                value={draftTariffs.recolteCeriseCoeff}
                unit="DH / caisse"
                onChange={(val) => handleTariffInput('recolteCeriseCoeff', val)}
              />
              <TariffInput
                label="Récolte Ronde"
                value={draftTariffs.recolteRondeTarif}
                unit="DH / caisse"
                onChange={(val) => handleTariffInput('recolteRondeTarif', val)}
              />
              <TariffInput
                label="TTT D2"
                value={draftTariffs.tttD2Heure}
                unit="DH / heure"
                onChange={(val) => handleTariffInput('tttD2Heure', val)}
              />
              <TariffInput
                label="TTT D3"
                value={draftTariffs.tttD3Heure}
                unit="DH / heure"
                onChange={(val) => handleTariffInput('tttD3Heure', val)}
              />
              <TariffInput
                label="Travail normal"
                value={draftTariffs.travailNormalJour}
                unit="DH / jour"
                onChange={(val) => handleTariffInput('travailNormalJour', val)}
              />
              <TariffInput
                label="Stationnaire"
                value={draftTariffs.stationnaireJour}
                unit="DH / jour"
                onChange={(val) => handleTariffInput('stationnaireJour', val)}
              />
              <TariffInput
                label="Gardien"
                value={draftTariffs.gardienJour}
                unit="DH / jour"
                onChange={(val) => handleTariffInput('gardienJour', val)}
              />
              <TariffInput
                label="Ébourgeonnage D5"
                value={draftTariffs.ebourgeonnageD5Jour}
                unit="DH / jour"
                onChange={(val) => handleTariffInput('ebourgeonnageD5Jour', val)}
              />
            </div>

            {tariffFeedback && (
              <div
                className={`rounded-xl p-2.5 text-xs font-semibold ${
                  tariffFeedback.type === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border border-red-200 text-red-900'
                }`}
              >
                {tariffFeedback.message}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveTariffs}
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Enregistrer les tarifs</span>
              </button>
              <button
                type="button"
                onClick={handleResetTariffs}
                className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                title="Réinitialiser les tarifs officiels par défaut"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Défaut</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Détail des paiements calculés (Ouvriers pointés dans Pointage Matin) */}
      <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-900">
              Détail calculé du jour
            </h2>
            <p className="text-[11px] text-slate-500">
              {preview.totalOuvriersDistincts} ouvrier(s) présent(s) · Absents exclus ·{' '}
              {remoteVerified ? 'Source Supabase vérifiée' : 'Mode local'}
            </p>
          </div>
          <span className="text-sm font-black text-emerald-800 tabular-nums">
            {formatDHDisplay(preview.grandTotalDH)} DH
          </span>
        </div>

        {preview.rows.length === 0 ? (
          remoteLoadError ? (
            <div className="p-6 text-center text-xs font-semibold text-red-700">
              Impossible de vérifier la liste des ouvriers : erreur de chargement des données Supabase.
            </div>
          ) : (
            <div className="p-6 text-center text-xs text-slate-500">
              Aucun ouvrier présent dans Pointage Matin pour cette date et ce domaine.
            </div>
          )
        ) : (
          <div className="divide-y divide-slate-100">
            {preview.rows.map((row) => {
              const isEditing = editingRowKey === row.rowKey;
              const hasCustomHours = Boolean(hoursOverrides[row.rowKey]);
              return (
                <div key={row.rowKey} className="p-3.5 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-emerald-800 tabular-nums shrink-0">
                          {row.ouvrierId}
                        </span>
                        <span className="text-sm font-bold text-slate-900 truncate">
                          {row.nomOuvrier}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            row.statut === 'VALIDÉE'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}
                        >
                          {row.statut}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {row.tache} · {row.domaineShort}
                        {row.serreId && row.serreId !== 'Toutes les serres' ? ` · ${row.serreId}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-slate-900 tabular-nums">
                        {row.needsVarietySelection ? 'À définir' : `${formatDHDisplay(row.remuneration)} DH`}
                      </p>
                      <p className="text-[11px] text-slate-500 tabular-nums">
                        {row.tarifAppliqueLabel}
                      </p>
                    </div>
                  </div>

                  {/* Sélection explicite requise uniquement si tâche générique RECOLTE sans variété certaine */}
                  {row.needsVarietySelection && !preview.isHistoricalFrozen && (
                    <div className="rounded-xl bg-amber-50 border border-amber-300 p-2.5 flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-amber-900">
                        Variété requise pour calculer :
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleVarietyChoice(row.rowKey, 'CERISE')}
                          className="min-h-[34px] px-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] cursor-pointer"
                        >
                          Cerise ({savedTariffs.recolteCeriseCoeff} DH)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleVarietyChoice(row.rowKey, 'RONDE')}
                          className="min-h-[34px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-bold text-[11px] cursor-pointer"
                        >
                          Ronde ({savedTariffs.recolteRondeTarif} DH)
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                    <div className="flex items-center gap-3 tabular-nums">
                      <span>
                        {row.heureDeb}–{row.heureFin} (pause {row.dureeRep}h · {row.dureeTravaillee}h)
                      </span>
                      {typeof row.quantiteMetrique === 'number' && (
                        <span className="font-bold text-emerald-800">
                          Récolte : {row.quantiteMetrique}
                        </span>
                      )}
                      {row.coefficient !== '' && (
                        <span className="font-bold text-slate-800">
                          Coeff : {row.coefficient}
                        </span>
                      )}
                    </div>

                    {!preview.isHistoricalFrozen && (
                      <button
                        type="button"
                        onClick={() =>
                          isEditing
                            ? setEditingRowKey(null)
                            : openHoursEditor(row.rowKey, row.heureDeb, row.heureFin, row.dureeRep)
                        }
                        className="min-h-[34px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{hasCustomHours ? 'Heures ajustées' : 'Heures'}</span>
                      </button>
                    )}
                  </div>

                  {isEditing && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-2.5 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                            Début
                          </label>
                          <input
                            type="time"
                            value={editHeureDeb}
                            onChange={(e) => setEditHeureDeb(e.target.value)}
                            className="w-full min-h-[38px] px-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                            Fin
                          </label>
                          <input
                            type="time"
                            value={editHeureFin}
                            onChange={(e) => setEditHeureFin(e.target.value)}
                            className="w-full min-h-[38px] px-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                            Pause (h)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={editPause}
                            onChange={(e) => setEditPause(e.target.value)}
                            className="w-full min-h-[38px] px-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span className="tabular-nums">
                          Durée calculée :{' '}
                          <strong>
                            {computeEffectiveWorkedHours(
                              editHeureDeb,
                              editHeureFin,
                              resolvePauseHours(editHeureDeb, editHeureFin, Number(editPause) || 0)
                            )}
                            h
                          </strong>
                        </span>
                        <div className="flex gap-1.5">
                          {hasCustomHours && (
                            <button
                              type="button"
                              onClick={() => clearRowHours(row.rowKey)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold cursor-pointer"
                            >
                              Réinit.
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => saveRowHours(row.rowKey)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold cursor-pointer"
                          >
                            Appliquer
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Historique des exports figés (illimité + re-téléchargement sans recalcul) */}
      {exportHistory.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <button
            type="button"
            onClick={() => setShowHistory((h) => !h)}
            className="w-full min-h-[48px] px-4 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600" />
              <span className="text-xs font-bold text-slate-900">
                Historique des exports figés ({exportHistory.length})
              </span>
            </div>
            {showHistory ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>

          {showHistory && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {exportHistory.map((snap) => (
                <div
                  key={snap.id}
                  className="px-4 py-2.5 flex flex-col gap-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">{snap.filename}</p>
                      <p className="text-[11px] text-slate-500">
                        {snap.dateIso} · {snap.totalOuvriersDistincts} ouvrier(s) · Figé le{' '}
                        {new Date(snap.exportedAt).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                    <span className="font-black text-emerald-800 tabular-nums shrink-0">
                      {formatDHDisplay(snap.grandTotalDH)} DH
                    </span>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleReexportSnapshot(snap)}
                      disabled={reexportingId === snap.id || !templateBuffer}
                      className={`min-h-[36px] px-3 rounded-lg font-bold text-[11px] flex items-center gap-1.5 transition cursor-pointer ${
                        !templateBuffer
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {reexportingId === snap.id
                          ? 'Génération...'
                          : 'TÉLÉCHARGER À NOUVEAU (.XLSX)'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

function TariffInput({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
      <label className="block text-[11px] font-bold text-slate-700 mb-1">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full min-h-[40px] px-2.5 rounded-lg border border-slate-300 bg-white text-sm font-black text-slate-900 tabular-nums focus:outline-none focus:border-emerald-600"
        />
        <span className="text-[10px] font-bold text-slate-500 shrink-0">{unit}</span>
      </div>
    </div>
  );
}
