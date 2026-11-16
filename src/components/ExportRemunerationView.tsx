/**
 * MODULE INDÉPENDANT : EXPORT RÉMUNÉRATION JOURNALIÈRE (ADMIN ONLY)
 * Application : LAHCEN POINTEUR
 *
 * Modèle Excel : D002_2026-11-15_BROUILLON (feuille "Pointage", 21 colonnes exactes)
 * Règles :
 * - STANDARD      : 07:00-16:00, pause 1h = 8h effectives × 11,875 DH/h = 95 DH
 * - RÉCOLTE       : PLATEAUX × 1,1875 DH/plateau (quantité réelle, sans minimum de 80)
 * - TRAITEMENT D3 : HEURE × 16 DH/h (heures renseignées/ajustées par l'administrateur)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileSpreadsheet,
  Calendar,
  Download,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  Building2,
  Users,
  Clock,
  Maximize2,
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
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
import { supabase } from '../services/supabaseClient';
import {
  REMUNERATION_EXCEL_COLUMNS,
  RemunerationCategorie,
  RemunerationDraftRow,
  RemunerationRowOverride,
  TARIF_RECOLTE_PLATEAU,
  TARIF_STANDARD_HEURE,
  TARIF_TRAITEMENT_D3_HEURE,
  buildDailyRemunerationRows,
  computeEffectiveHours,
  exportRemunerationExcel,
  getRemunerationExportFilename,
} from '../utils/remunerationExporter';

const OVERRIDES_STORAGE_PREFIX = 'agripointage_remuneration_overrides_v1';

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

function formatDH(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function parsePositiveNumberInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface ExportRemunerationViewProps {
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

export const ExportRemunerationView: React.FC<ExportRemunerationViewProps> = ({
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
  const companyId = currentCompany?.id || currentUser?.company_id || 'cie_lahcen_pointeur';

  // Filtres et état UI
  const [domaineFilter, setDomaineFilter] = useState<string>('ALL');
  const [categorieFilter, setCategorieFilter] = useState<'ALL' | RemunerationCategorie>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFullTableModal, setShowFullTableModal] = useState<boolean>(false);
  const [showWorkerTotals, setShowWorkerTotals] = useState<boolean>(false);
  const [batchD3Hours, setBatchD3Hours] = useState<string>('5');
  const [exportFeedback, setExportFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Données distantes Supabase (lecture seule non-bloquante)
  const [loadingRemote, setLoadingRemote] = useState<boolean>(false);
  const [remotePointages, setRemotePointages] = useState<Pointage[]>([]);
  const [remoteAffectations, setRemoteAffectations] = useState<AffectationTache[]>([]);
  const [remoteRecoltes, setRemoteRecoltes] = useState<RecolteEntry[]>([]);
  const [remoteOuvriers, setRemoteOuvriers] = useState<Ouvrier[]>([]);
  const [remoteTaches, setRemoteTaches] = useState<Tache[]>([]);
  const [remoteSerres, setRemoteSerres] = useState<Serre[]>([]);
  const [remoteDomaines, setRemoteDomaines] = useState<Domaine[]>([]);
  const [storageTick, setStorageTick] = useState<number>(0);

  // Ajustements administrateur persistés par société et date
  const overridesStorageKey = `${OVERRIDES_STORAGE_PREFIX}:${companyId}:${selectedDate}`;
  const [overrides, setOverrides] = useState<Record<string, RemunerationRowOverride>>(() => {
    try {
      const raw = localStorage.getItem(overridesStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(overridesStorageKey);
      setOverrides(raw ? JSON.parse(raw) : {});
    } catch {
      setOverrides({});
    }
  }, [overridesStorageKey]);

  const persistOverrides = useCallback(
    (next: Record<string, RemunerationRowOverride>) => {
      setOverrides(next);
      try {
        localStorage.setItem(overridesStorageKey, JSON.stringify(next));
      } catch {
        // Ignorer si quota dépassé
      }
    },
    [overridesStorageKey]
  );

  // Écoute du stockage local en temps réel
  useEffect(() => {
    return storage.subscribeToStorage(() => setStorageTick((t) => t + 1));
  }, []);

  // Chargement lecture-seule depuis Supabase pour la date sélectionnée
  const loadDayFromSupabase = useCallback(async () => {
    if (!companyId || !selectedDate) return;
    setLoadingRemote(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
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

      if (!ptRes.error && Array.isArray(ptRes.data)) setRemotePointages(ptRes.data as Pointage[]);
      if (!affRes.error && Array.isArray(affRes.data)) setRemoteAffectations(affRes.data as AffectationTache[]);
      if (!recRes.error && Array.isArray(recRes.data)) setRemoteRecoltes(recRes.data as RecolteEntry[]);
      if (!ouvRes.error && Array.isArray(ouvRes.data)) setRemoteOuvriers(ouvRes.data as Ouvrier[]);
      if (!tchRes.error && Array.isArray(tchRes.data)) setRemoteTaches(tchRes.data as Tache[]);
      if (!serRes.error && Array.isArray(serRes.data)) setRemoteSerres(serRes.data as Serre[]);
      if (!domRes.error && Array.isArray(domRes.data)) setRemoteDomaines(domRes.data as Domaine[]);
    } catch {
      // Silencieux hors-ligne : les données locales restent actives
    } finally {
      setLoadingRemote(false);
    }
  }, [companyId, selectedDate]);

  useEffect(() => {
    loadDayFromSupabase();
  }, [loadDayFromSupabase]);

  // Fusion propre des référentiels et données réelles du jour (sans écraser ni dupliquer)
  const mergedOuvriers = useMemo<Ouvrier[]>(() => {
    const localList = allOuvriers?.length ? allOuvriers : storage.getOuvriers(companyId);
    const hasNonDemoLocal = localList.some((w) => !isProvisionalDemoWorker(w));
    const hasRemote = remoteOuvriers.length > 0;

    const byNum = new Map<number, Ouvrier>();
    const extras: Ouvrier[] = [];

    for (const w of localList) {
      if (!w) continue;
      if (hasRemote && !hasNonDemoLocal && isProvisionalDemoWorker(w)) continue;
      if (w.numero && Number(w.numero) > 0) {
        byNum.set(Number(w.numero), w);
      } else {
        extras.push(w);
      }
    }

    for (const rw of remoteOuvriers) {
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
      if (t && t.id) map.set(t.id, t);
    });
    return Array.from(map.values());
  }, [taches, remoteTaches, companyId, storageTick]);

  const mergedDomaines = useMemo<Domaine[]>(() => {
    const map = new Map<string, Domaine>();
    [...(domaines || []), ...(storage.getDomaines() || []), ...remoteDomaines].forEach((d) => {
      if (d && d.id) map.set(d.id, d);
    });
    return Array.from(map.values()).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  }, [domaines, remoteDomaines, storageTick]);

  const mergedSerres = useMemo<Serre[]>(() => {
    const map = new Map<string, Serre>();
    [...(serres || []), ...(storage.getSerres(companyId) || []), ...remoteSerres].forEach((s) => {
      if (s && s.id) map.set(s.id, s);
    });
    return Array.from(map.values());
  }, [serres, remoteSerres, companyId, storageTick]);

  const mergedPointages = useMemo<Pointage[]>(() => {
    const localPtgs = storage.getPointages(companyId, selectedDate);
    const byKey = new Map<string, Pointage>();
    [...remotePointages, ...localPtgs].forEach((p) => {
      if (!p || p.date !== selectedDate) return;
      const k = p.ouvrier_id ? `id:${p.ouvrier_id}` : `num:${p.numero_ouvrier}`;
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
      const k = a.id || `${a.ouvrier_id}_${a.tache_id}_${a.domaine_id}_${a.serre_id}`;
      byId.set(k, a);
    });
    return Array.from(byId.values());
  }, [companyId, selectedDate, remoteAffectations, storageTick]);

  const mergedRecoltes = useMemo<RecolteEntry[]>(() => {
    const localRecs = (allRecoltes?.length ? allRecoltes : storage.getRecoltes(companyId)).filter(
      (r) => r.date === selectedDate
    );
    const byId = new Map<string, RecolteEntry>();
    [...remoteRecoltes, ...localRecs].forEach((r) => {
      if (!r || r.date !== selectedDate) return;
      byId.set(r.id, r);
    });
    return Array.from(byId.values());
  }, [allRecoltes, remoteRecoltes, companyId, selectedDate, storageTick]);

  // Calcul complet des lignes de rémunération
  const preview = useMemo(() => {
    return buildDailyRemunerationRows({
      dateIso: selectedDate,
      domaineFilter,
      ouvriers: mergedOuvriers,
      taches: mergedTaches,
      domaines: mergedDomaines,
      serres: mergedSerres,
      pointages: mergedPointages,
      affectations: mergedAffectations,
      recoltes: mergedRecoltes,
      tacheSerresConfigs,
      defaultDomaineId,
      overrides,
    });
  }, [
    selectedDate,
    domaineFilter,
    mergedOuvriers,
    mergedTaches,
    mergedDomaines,
    mergedSerres,
    mergedPointages,
    mergedAffectations,
    mergedRecoltes,
    tacheSerresConfigs,
    defaultDomaineId,
    overrides,
  ]);

  // Filtrage UI (recherche + catégorie) sans altérer les totaux de l'export global du domaine sélectionné
  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return preview.rows.filter((r) => {
      if (categorieFilter !== 'ALL' && r.effectiveCategorie !== categorieFilter) return false;
      if (!q) return true;
      return (
        String(r.ouvrierId).toLowerCase().includes(q) ||
        r.nomOuvrier.toLowerCase().includes(q) ||
        r.tache.toLowerCase().includes(q) ||
        r.tacheTypeId.toLowerCase().includes(q) ||
        r.serreId.toLowerCase().includes(q) ||
        r.DT.toLowerCase().includes(q)
      );
    });
  }, [preview.rows, categorieFilter, searchQuery]);

  // Compteurs par catégorie pour aide visuelle
  const categoryCounts = useMemo(() => {
    let standard = 0;
    let recolte = 0;
    let d3 = 0;
    let incertain = 0;
    preview.rows.forEach((r) => {
      if (r.effectiveCategorie === 'STANDARD') standard++;
      else if (r.effectiveCategorie === 'RECOLTE') recolte++;
      else if (r.effectiveCategorie === 'TRAITEMENT_D3') d3++;
      else incertain++;
    });
    return { standard, recolte, d3, incertain };
  }, [preview.rows]);

  // Actions d'ajustement admin
  const updateRowOverride = (rowKey: string, patch: Partial<RemunerationRowOverride>) => {
    const current = overrides[rowKey] || {};
    persistOverrides({
      ...overrides,
      [rowKey]: { ...current, ...patch },
    });
  };

  const handleApplyBatchD3Hours = () => {
    const parsed = parsePositiveNumberInput(batchD3Hours);
    if (parsed === null) {
      setExportFeedback({
        type: 'error',
        message: 'Veuillez saisir un nombre d\'heures valide (> 0) pour le traitement D3.',
      });
      setTimeout(() => setExportFeedback(null), 3500);
      return;
    }

    const next = { ...overrides };
    let updatedCount = 0;
    preview.rows.forEach((row) => {
      if (row.effectiveCategorie === 'TRAITEMENT_D3') {
        next[row.rowKey] = {
          ...(next[row.rowKey] || {}),
          quantite: parsed,
        };
        updatedCount++;
      }
    });

    if (updatedCount === 0) {
      setExportFeedback({
        type: 'error',
        message: 'Aucune ligne TRAITEMENT D3 détectée dans la sélection.',
      });
    } else {
      persistOverrides(next);
      setExportFeedback({
        type: 'success',
        message: `${parsed} H appliquées sur ${updatedCount} ligne(s) TRAITEMENT D3 (${parsed * TARIF_TRAITEMENT_D3_HEURE} DH/ouvrier).`,
      });
    }
    setTimeout(() => setExportFeedback(null), 4000);
  };

  const handleResetOverrides = () => {
    persistOverrides({});
    setExportFeedback({
      type: 'success',
      message: 'Ajustements réinitialisés selon les données sources du pointage.',
    });
    setTimeout(() => setExportFeedback(null), 3000);
  };

  const handleExport = () => {
    const res = exportRemunerationExcel({
      rows: preview.rows,
      dateIso: selectedDate,
      domaineFilter,
      domaines: mergedDomaines,
      allowWithWarnings: false,
    });

    if (res.success) {
      setExportFeedback({
        type: 'success',
        message: `Export Excel réussi : ${res.totalLignes} ligne(s) • Feuille "Pointage" • ${res.filename}`,
      });
    } else {
      setExportFeedback({
        type: 'error',
        message: res.error || 'Export bloqué en raison d\'erreurs de validation.',
      });
    }
    setTimeout(() => setExportFeedback(null), 5500);
  };

  const targetFilename = getRemunerationExportFilename(selectedDate, domaineFilter, mergedDomaines);

  const renderCategoryLabel = (cat: RemunerationCategorie) => {
    switch (cat) {
      case 'STANDARD':
        return 'STANDARD (11,875 DH/h)';
      case 'RECOLTE':
        return 'RÉCOLTE (1,1875 DH/pl.)';
      case 'TRAITEMENT_D3':
        return 'TRAITEMENT D3 (16 DH/h)';
      default:
        return 'À CONFIRMER';
    }
  };

  const renderCategoryBadgeClass = (cat: RemunerationCategorie) => {
    switch (cat) {
      case 'STANDARD':
        return 'bg-slate-100 text-slate-800 border-slate-300';
      case 'RECOLTE':
        return 'bg-emerald-50 text-emerald-800 border-emerald-300';
      case 'TRAITEMENT_D3':
        return 'bg-amber-50 text-amber-900 border-amber-300';
      default:
        return 'bg-red-50 text-red-700 border-red-300';
    }
  };

  // Sécurité RBAC stricte (placée après tous les hooks React)
  if (currentUser?.role !== 'admin') {
    return (
      <div className="bg-white rounded-2xl p-6 text-center border border-amber-300 space-y-3">
        <div className="w-12 h-12 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-black text-slate-900 text-sm">Accès Réservé à l'Administrateur</h3>
        <p className="text-xs text-slate-600">
          La rubrique EXPORT RÉMUNÉRATION est strictement réservée à l'administrateur.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-24">
      {/* EN-TÊTE ET CONTRÔLES PRINCIPAUX */}
      <section className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Rémunération Journalière</span>
            </div>
            <h2 className="text-base font-black text-slate-900 mt-0.5">
              EXPORT RÉMUNÉRATION
            </h2>
            <p className="text-[11px] text-slate-500">
              Modèle 21 colonnes • Feuille <code className="font-mono font-bold text-slate-700">Pointage</code>
            </p>
          </div>

          <button
            type="button"
            onClick={loadDayFromSupabase}
            disabled={loadingRemote}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-bold text-slate-700 transition cursor-pointer shrink-0"
            title="Actualiser depuis Supabase et Pointage local"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingRemote ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>

        {/* Sélecteurs Date + Domaine */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Date du travail
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) onSelectDate(e.target.value);
                }}
                className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold font-mono tabular-nums text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Domaine (DT)
            </label>
            <div className="relative">
              <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={domaineFilter}
                onChange={(e) => setDomaineFilter(e.target.value)}
                className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="ALL">Tous les domaines</option>
                {mergedDomaines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Rappel concis des 3 barèmes officiels */}
        <div className="grid grid-cols-3 gap-1.5 text-[10px] pt-1 border-t border-slate-100">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2">
            <div className="font-black text-slate-800">STANDARD</div>
            <div className="font-mono tabular-nums font-bold text-slate-600 mt-0.5">
              {TARIF_STANDARD_HEURE} DH/h
            </div>
            <div className="text-[9px] text-slate-500">8h eff. = 95 DH</div>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-2">
            <div className="font-black text-emerald-900">RÉCOLTE</div>
            <div className="font-mono tabular-nums font-bold text-emerald-700 mt-0.5">
              {TARIF_RECOLTE_PLATEAU} DH/pl.
            </div>
            <div className="text-[9px] text-emerald-700">Sans minimum</div>
          </div>
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-2">
            <div className="font-black text-amber-900">TRAIT. D3</div>
            <div className="font-mono tabular-nums font-bold text-amber-700 mt-0.5">
              {TARIF_TRAITEMENT_D3_HEURE} DH/h
            </div>
            <div className="text-[9px] text-amber-700">Heures admin</div>
          </div>
        </div>

        {/* Bouton principal Export Excel */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={!preview.canExportWithoutError}
            className="flex-1 h-11 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 transition active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            <span>
              EXPORTER EXCEL ({preview.rows.length} ligne{preview.rows.length > 1 ? 's' : ''})
            </span>
          </button>

          {preview.rows.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFullTableModal(true)}
              className="h-11 px-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition cursor-pointer shrink-0"
              title="Aperçu complet des 21 colonnes"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>21 col.</span>
            </button>
          )}
        </div>

        <div className="text-[10px] text-slate-500 flex items-center justify-between gap-2">
          <span className="truncate font-mono">{targetFilename}</span>
          {Object.keys(overrides).length > 0 && (
            <button
              type="button"
              onClick={handleResetOverrides}
              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-bold underline cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Réinitialiser</span>
            </button>
          )}
        </div>
      </section>

      {/* NOTIFICATION EXPORT */}
      {exportFeedback && (
        <div
          className={`rounded-xl px-3 py-2.5 text-xs font-bold border flex items-center gap-2 ${
            exportFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-red-50 border-red-300 text-red-800'
          }`}
        >
          {exportFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          )}
          <span>{exportFeedback.message}</span>
        </div>
      )}

      {/* INDICATEURS TOTAUX GÉNÉRAUX & PAR DOMAINE */}
      <section className="grid grid-cols-3 gap-2">
        <div className="bg-white rounded-2xl border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Total Général</div>
          <div className="text-base font-black font-mono tabular-nums text-emerald-700 mt-0.5">
            {formatDH(preview.grandTotalDH)} DH
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Ouvriers</div>
          <div className="text-base font-black font-mono tabular-nums text-slate-900 mt-0.5">
            {preview.totalOuvriersDistincts}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-500">Validations</div>
          <div
            className={`text-base font-black font-mono tabular-nums mt-0.5 ${
              preview.validationIssues.length > 0 ? 'text-red-600' : 'text-emerald-700'
            }`}
          >
            {preview.validationIssues.length === 0 ? 'OK (0)' : `${preview.validationIssues.length} alerte(s)`}
          </div>
        </div>
      </section>

      {/* TOTAL PAR DOMAINE */}
      {preview.totalByDomaine.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
          <div className="text-[11px] font-black uppercase tracking-wider text-slate-700">
            Total par Domaine
          </div>
          <div className="divide-y divide-slate-100">
            {preview.totalByDomaine.map((dom) => (
              <div key={dom.DT} className="py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-slate-900">{dom.DT}</span>
                  <span className="text-[11px] text-slate-500">
                    ({dom.domaineNom} • {dom.ouvriersCount} ouvr. • {dom.rowsCount} ligne{dom.rowsCount > 1 ? 's' : ''})
                  </span>
                </div>
                <span className="font-mono tabular-nums font-black text-emerald-700">
                  {formatDH(dom.totalDH)} DH
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TOTAL PAR OUVRIER (DÉPLIABLE) */}
      {preview.totalByWorker.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowWorkerTotals(!showWorkerTotals)}
            className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-black text-slate-800 hover:bg-slate-50 transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-700" />
              <span>Total rémunération par ouvrier ({preview.totalByWorker.length})</span>
            </div>
            {showWorkerTotals ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showWorkerTotals && (
            <div className="border-t border-slate-200 max-h-60 overflow-y-auto">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Code</th>
                    <th className="py-2 px-3">Ouvrier</th>
                    <th className="py-2 px-3 text-right">Lignes</th>
                    <th className="py-2 px-3 text-right">Total DH</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.totalByWorker.map((wt) => (
                    <tr key={wt.workerKey} className={wt.hasErrors ? 'bg-red-50/50' : ''}>
                      <td className="py-1.5 px-3 font-mono tabular-nums font-bold text-slate-800">
                        {wt.ouvrierId || '—'}
                      </td>
                      <td className="py-1.5 px-3 font-semibold text-slate-900">{wt.nomOuvrier}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {wt.rowsCount}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums font-black text-emerald-700">
                        {formatDH(wt.totalDH)} DH
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* BANDEAU D'ERREURS / ALERTES DE VALIDATION AVANT EXPORT (§9) */}
      {preview.validationIssues.length > 0 && (
        <section className="bg-red-50 rounded-2xl border border-red-300 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-black text-red-800">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>
              {preview.validationIssues.length} anomalie(s) à vérifier avant export Excel :
            </span>
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {preview.validationIssues.map((issue) => (
              <li
                key={issue.rowKey}
                className="bg-white rounded-xl border border-red-200 px-2.5 py-2 text-[11px] text-slate-800"
              >
                <div className="font-bold text-slate-900">
                  Code {issue.ouvrierId || '?'} — {issue.nomOuvrier}{' '}
                  <span className="font-mono text-[10px] text-slate-500">({issue.DT} • {issue.tache})</span>
                </div>
                <div className="text-red-700 font-semibold mt-0.5">
                  {issue.messages.join(' ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* OUTIL RAPIDE HEURES TRAITEMENT D3 (SI PRÉSENT) */}
      {categoryCounts.d3 > 0 && (
        <section className="bg-amber-50/70 rounded-2xl border border-amber-300 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-900">
              <Clock className="w-4 h-4 text-amber-700" />
              <span>Heures Traitement D3 ({categoryCounts.d3} ligne{categoryCounts.d3 > 1 ? 's' : ''})</span>
            </div>
            <span className="font-mono text-[11px] font-bold text-amber-800">16 DH / heure</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={batchD3Hours}
              onChange={(e) => setBatchD3Hours(e.target.value)}
              placeholder="Ex: 5"
              className="w-20 px-2.5 py-1.5 bg-white border border-amber-300 rounded-xl text-xs font-mono font-bold text-slate-900 outline-none"
            />
            <button
              type="button"
              onClick={handleApplyBatchD3Hours}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-[11px] rounded-xl transition cursor-pointer"
            >
              Appliquer à tout D3
            </button>
            <div className="flex items-center gap-1 ml-auto">
              {['5', '7', '9'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setBatchD3Hours(preset)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold border cursor-pointer ${
                    batchD3Hours === preset
                      ? 'bg-amber-700 text-white border-amber-700'
                      : 'bg-white text-amber-900 border-amber-300'
                  }`}
                >
                  {preset}H
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* RECHERCHE & FILTRES SUR L'APERÇU */}
      {preview.rows.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                Aperçu & Vérification ({displayedRows.length}/{preview.rows.length})
              </span>
              <span className="text-[10px] text-slate-500">
                Faites glisser horizontalement pour les 21 colonnes
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Code, nom, tâche, serre..."
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <select
                value={categorieFilter}
                onChange={(e) => setCategorieFilter(e.target.value as 'ALL' | RemunerationCategorie)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
              >
                <option value="ALL">Toutes ({preview.rows.length})</option>
                <option value="STANDARD">Standard ({categoryCounts.standard})</option>
                <option value="RECOLTE">Récolte ({categoryCounts.recolte})</option>
                <option value="TRAITEMENT_D3">Trait. D3 ({categoryCounts.d3})</option>
                {categoryCounts.incertain > 0 && (
                  <option value="INCERTAIN">À vérifier ({categoryCounts.incertain})</option>
                )}
              </select>
            </div>
          </div>

          {/* LISTE / TABLEAU ÉDITABLE DES LIGNES */}
          <div className="divide-y divide-slate-200">
            {displayedRows.map((row) => (
              <RemunerationRowEditorCard
                key={row.rowKey}
                row={row}
                onChangeOverride={(patch) => updateRowOverride(row.rowKey, patch)}
                renderCategoryLabel={renderCategoryLabel}
                renderCategoryBadgeClass={renderCategoryBadgeClass}
              />
            ))}
          </div>
        </section>
      )}

      {/* ÉTAT VIDE */}
      {preview.rows.length === 0 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-6 text-center space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto" />
          <div className="text-sm font-black text-slate-800">
            Aucun pointage présent à exporter pour le {selectedDate}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Seuls les ouvriers réellement pointés présents dans le Pointage Matin (ou synchronisés
            depuis Supabase) pour cette date et ce domaine apparaissent ici. Aucun pointage fictif
            n'est généré pour les absents.
          </p>
        </section>
      )}

      {/* MODALE PLEIN ÉCRAN : APERÇU EXACT DES 21 COLONNES EXCEL */}
      {showFullTableModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/75 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  Aperçu Exact Modèle Excel — Feuille « Pointage » (21 colonnes)
                </h3>
                <p className="text-[11px] font-mono text-slate-500">
                  {targetFilename} • {preview.rows.length} ligne(s) • Total : {formatDH(preview.grandTotalDH)} DH
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!preview.canExportWithoutError}
                  className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exporter (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFullTableModal(false)}
                  className="p-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse text-[11px] whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-700 border-b border-slate-300 sticky top-0 z-10">
                  <tr>
                    {REMUNERATION_EXCEL_COLUMNS.map((col) => (
                      <th key={col} className="py-2 px-2.5 font-mono font-black border-r border-slate-200">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {preview.rows.map((r) => (
                    <tr
                      key={r.rowKey}
                      className={r.validationErrors.length > 0 ? 'bg-red-50/70' : 'hover:bg-slate-50'}
                    >
                      <td className="py-1.5 px-2.5 font-mono text-slate-600 border-r border-slate-100">{r.docId}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums border-r border-slate-100">{r.dateTrava}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums font-bold border-r border-slate-100">{r.ouvrierId}</td>
                      <td className="py-1.5 px-2.5 font-bold text-slate-900 border-r border-slate-100">{r.nomOuvrier}</td>
                      <td className="py-1.5 px-2.5 font-mono font-bold border-r border-slate-100">{r.DT}</td>
                      <td className="py-1.5 px-2.5 border-r border-slate-100">{r.serreId || '—'}</td>
                      <td className="py-1.5 px-2.5 border-r border-slate-100">{r.rubanId || ''}</td>
                      <td className="py-1.5 px-2.5 border-r border-slate-100">{r.cultureId || ''}</td>
                      <td className="py-1.5 px-2.5 font-mono border-r border-slate-100">{r.tacheTypeId}</td>
                      <td className="py-1.5 px-2.5 font-semibold border-r border-slate-100">{r.tache}</td>
                      <td className="py-1.5 px-2.5 font-mono font-bold border-r border-slate-100">{r.uniteMetrique}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums text-right border-r border-slate-100">
                        {r.quantiteMetrique ?? '—'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums text-right font-bold border-r border-slate-100">
                        {r.quantite ?? '—'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums border-r border-slate-100">{r.heureDeb}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums border-r border-slate-100">{r.heureFin}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums text-right border-r border-slate-100">{r.dureeRep}</td>
                      <td className="py-1.5 px-2.5 font-mono border-r border-slate-100">{r.periodeJo}</td>
                      <td className="py-1.5 px-2.5 font-mono border-r border-slate-100">{r.statut}</td>
                      <td className="py-1.5 px-2.5 border-r border-slate-100">{r.equipeId}</td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums text-right border-r border-slate-100">
                        {r.tarifExcep ?? '—'}
                      </td>
                      <td className="py-1.5 px-2.5 font-mono tabular-nums text-right font-black text-emerald-700">
                        {formatDH(r.remuneration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface RemunerationRowEditorCardProps {
  row: RemunerationDraftRow;
  onChangeOverride: (patch: Partial<RemunerationRowOverride>) => void;
  renderCategoryLabel: (cat: RemunerationCategorie) => string;
  renderCategoryBadgeClass: (cat: RemunerationCategorie) => string;
}

const RemunerationRowEditorCard: React.FC<RemunerationRowEditorCardProps> = ({
  row,
  onChangeOverride,
  renderCategoryLabel,
  renderCategoryBadgeClass,
}) => {
  const [qtyDraft, setQtyDraft] = useState<string>(
    row.quantite !== null && row.quantite !== undefined ? String(row.quantite) : ''
  );

  useEffect(() => {
    setQtyDraft(row.quantite !== null && row.quantite !== undefined ? String(row.quantite) : '');
  }, [row.quantite, row.effectiveCategorie]);

  const handleQtyChange = (val: string) => {
    setQtyDraft(val);
    const cleaned = val.trim().replace(',', '.');
    if (cleaned === '') {
      onChangeOverride({ quantite: null });
      return;
    }
    if (/^\d+(\.\d*)?$/.test(cleaned)) {
      const n = Number(cleaned);
      if (Number.isFinite(n) && n >= 0) {
        onChangeOverride({ quantite: n });
      }
    }
  };

  return (
    <div className={`p-3 space-y-2 ${row.validationErrors.length > 0 ? 'bg-red-50/40' : ''}`}>
      {/* Ligne 1 : Code, Nom, Domaine, Total DH */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono tabular-nums font-black text-xs bg-slate-900 text-white px-1.5 py-0.5 rounded-md">
              {row.ouvrierId || '?'}
            </span>
            <span className="font-black text-xs text-slate-900 truncate">{row.nomOuvrier}</span>
            <span className="font-mono text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200">
              {row.DT}
            </span>
          </div>

          <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-bold text-slate-800">
              {row.tacheTypeId ? `[${row.tacheTypeId}] ` : ''}
              {row.tache || 'Sans tâche'}
            </span>
            {row.serreId && (
              <span className="text-slate-500">• Serres : {row.serreId}</span>
            )}
            {row.rubanId && <span className="text-slate-500">• Ruban : {row.rubanId}</span>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <div
            className={`text-sm font-black font-mono tabular-nums ${
              row.remuneration !== null ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {row.remuneration !== null ? `${formatDH(row.remuneration)} DH` : 'À compléter'}
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-500">
            {row.tarifExcep !== null ? `${row.tarifExcep} DH/${row.uniteMetrique === 'PLATEAUX' ? 'pl.' : 'h'}` : 'Tarif ?'}
          </div>
        </div>
      </div>

      {/* Ligne 2 : Catégorie + Édition directe quantité / horaires */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={row.effectiveCategorie}
          onChange={(e) => {
            const val = e.target.value as RemunerationCategorie;
            if (val === 'INCERTAIN') return;
            onChangeOverride({ categorie: val });
          }}
          className={`text-[10px] font-black px-2 py-1 rounded-lg border outline-none ${renderCategoryBadgeClass(
            row.effectiveCategorie
          )}`}
          title={row.classificationReason}
        >
          {row.effectiveCategorie === 'INCERTAIN' && (
            <option value="INCERTAIN">⚠ À confirmer...</option>
          )}
          <option value="STANDARD">{renderCategoryLabel('STANDARD')}</option>
          <option value="RECOLTE">{renderCategoryLabel('RECOLTE')}</option>
          <option value="TRAITEMENT_D3">{renderCategoryLabel('TRAITEMENT_D3')}</option>
        </select>

        {/* Quantité éditable (Heures ou Caisses/Plateaux) */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] font-bold text-slate-500">
            {row.effectiveCategorie === 'RECOLTE' ? 'Plateaux :' : 'Heures eff. :'}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={qtyDraft}
            onChange={(e) => handleQtyChange(e.target.value)}
            placeholder={row.effectiveCategorie === 'TRAITEMENT_D3' ? 'Heures' : 'Qté'}
            className={`w-16 px-2 py-1 rounded-lg border text-xs font-mono tabular-nums font-bold text-right outline-none ${
              row.quantite === null || row.quantite <= 0
                ? 'border-red-400 bg-red-50 text-red-900'
                : 'border-slate-300 bg-white text-slate-900'
            }`}
          />
        </div>
      </div>

      {/* Horaires Standard ajustables si nécessaire */}
      {row.effectiveCategorie === 'STANDARD' && (
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 pt-1">
          <span>Début :</span>
          <input
            type="time"
            value={row.heureDeb}
            onChange={(e) => {
              const nextDeb = e.target.value;
              const eff = computeEffectiveHours(nextDeb, row.heureFin, row.dureeRep);
              onChangeOverride({ heureDeb: nextDeb, quantite: eff });
            }}
            className="border border-slate-200 rounded-md px-1.5 py-0.5 font-mono text-[10px] bg-slate-50"
          />
          <span>Fin :</span>
          <input
            type="time"
            value={row.heureFin}
            onChange={(e) => {
              const nextFin = e.target.value;
              const eff = computeEffectiveHours(row.heureDeb, nextFin, row.dureeRep);
              onChangeOverride({ heureFin: nextFin, quantite: eff });
            }}
            className="border border-slate-200 rounded-md px-1.5 py-0.5 font-mono text-[10px] bg-slate-50"
          />
          <span>Pause :</span>
          <span className="font-mono font-bold text-slate-700">{row.dureeRep}h (non rémun.)</span>
        </div>
      )}

      {/* Indication source Récolte */}
      {row.effectiveCategorie === 'RECOLTE' && (
        <div className="text-[10px] text-emerald-800 flex items-center justify-between">
          <span>
            Source Récolte :{' '}
            <strong className="font-mono tabular-nums">
              {row.recolteCaissesSource !== null ? `${row.recolteCaissesSource} caisses` : 'Aucune saisie'}
            </strong>
          </span>
          <span className="text-slate-500">Aucun minimum de 80 imposé</span>
        </div>
      )}

      {/* Erreurs spécifiques de cette ligne */}
      {row.validationErrors.length > 0 && (
        <div className="text-[10px] font-bold text-red-700 bg-red-100/70 rounded-lg px-2 py-1 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <span>{row.validationErrors.join(' ')}</span>
        </div>
      )}
    </div>
  );
};
