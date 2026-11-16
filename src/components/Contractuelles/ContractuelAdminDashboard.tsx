/**
 * Tableau de bord Administrateur & Validation — Module Contractuelles (Lahcen Pointeur)
 *
 * Règles garanties :
 * - Workflow obligatoire : BROUILLON -> SOUMIS -> VALIDÉ / REFUSÉ
 * - Affichage clair des écarts : tarif_initial vs montant_propose, tâches, serres, horaires, motif
 * - Seuls les montants VALIDÉS par l'administrateur entrent dans les totaux officiels, KPIs et exports
 * - Traçabilité complète (historique_validations) sans perte d'anciennes valeurs
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Filter,
  FileSpreadsheet,
  Users,
  Building2,
  DollarSign,
  TrendingUp,
  Clock,
  Layers,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Tag,
  AlertTriangle,
  ShieldCheck,
  History,
  CheckCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ContractuelOuvrier,
  ContractuelContrat,
  ContractuelPointage,
  ContractuelActivite,
  Domaine,
  Serre,
  UserAccount,
  StatutValidationContractuel,
} from '../../types';
import {
  getContractuelOuvriers,
  getContractuelContrats,
  getContractuelPointages,
  validateContractuelPointage,
  validateContractuelPointagesBatch,
  exportContractuellesExcel,
  syncPendingContractuelPointages,
  getPendingContractuelPointagesCount,
} from '../../services/contractuelService';
import { subscribeContractuelsRealtime } from '../../services/supabaseSync';
import { getSerresForDomaine } from '../../services/storage';
import {
  formatDurationLabel,
  getOfficialPointageMontant,
  getProposedPointageMontant,
  getStatutValidationLabel,
  normalizeStatutValidation,
  roundAmount,
} from '../../utils/contractuelWorkflow';

interface ContractuelAdminDashboardProps {
  domaines: Domaine[];
  serres: Serre[];
  currentUser: UserAccount;
  isReadOnly?: boolean;
}

function getBadgeStyle(statut: StatutValidationContractuel): string {
  switch (statut) {
    case 'VALIDE':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'REFUSE':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'SOUMIS':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

export const ContractuelAdminDashboard: React.FC<ContractuelAdminDashboardProps> = ({
  domaines,
  serres,
  currentUser,
  isReadOnly = false,
}) => {
  const effectiveReadOnly = isReadOnly || currentUser.role === 'lecteur';
  const isAdmin = currentUser.role === 'admin' && !effectiveReadOnly;
  const todayStr = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(todayStr);

  // Filtres multicritères
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>('ALL');
  const [selectedSerreId, setSelectedSerreId] = useState<string>('ALL');
  const [selectedOuvrierId, setSelectedOuvrierId] = useState<string>('ALL');
  const [selectedCaporalName, setSelectedCaporalName] = useState<string>('ALL');
  const [selectedStatutValidation, setSelectedStatutValidation] = useState<
    'ALL' | StatutValidationContractuel
  >('ALL');
  const [onlyModifiedTarif, setOnlyModifiedTarif] = useState<boolean>(false);
  const [periodPreset, setPeriodPreset] = useState<'today' | 'week' | 'month' | 'custom'>('month');

  // Onglets de vue : validation prioritaire
  const [activeTab, setActiveTab] = useState<
    'validation' | 'synthese' | 'serres' | 'ouvriers' | 'journal'
  >('validation');

  // Données
  const [ouvriers, setOuvriers] = useState<ContractuelOuvrier[]>([]);
  const [, setContrats] = useState<ContractuelContrat[]>([]);
  const [pointages, setPointages] = useState<ContractuelPointage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(() =>
    getPendingContractuelPointagesCount()
  );
  const [exporting, setExporting] = useState<boolean>(false);

  // Saisie Admin par pointage (montant_valide et motif)
  const [adminMontantEdits, setAdminMontantEdits] = useState<Record<string, string>>({});
  const [adminMotifEdits, setAdminMotifEdits] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [batchProcessing, setBatchProcessing] = useState<boolean>(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<{ text: string; isError?: boolean } | null>(
    null
  );

  useEffect(() => {
    let mounted = true;
    const companyId = currentUser.company_id || 'cie_lahcen_pointeur';

    const syncAndReload = async (silent = false) => {
      if (!effectiveReadOnly && typeof navigator !== 'undefined' && navigator.onLine) {
        await syncPendingContractuelPointages().catch(() => {});
      }
      if (mounted) await loadAllData({ silent });
    };

    syncAndReload(false);

    const handleOnline = () => syncAndReload(true);
    const handleFocus = () => syncAndReload(true);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncAndReload(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeRealtime = subscribeContractuelsRealtime(companyId, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mounted) loadAllData({ silent: true });
      }, 600);
    });

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncAndReload(true);
      }
    }, 20000);

    return () => {
      mounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribeRealtime();
      clearInterval(intervalId);
    };
  }, [startDate, endDate, currentUser.company_id, effectiveReadOnly]);

  async function loadAllData(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    try {
      const [ouvRes, ptgRes, cRes] = await Promise.all([
        getContractuelOuvriers(),
        getContractuelPointages({ startDate, endDate }),
        getContractuelContrats(),
      ]);

      if (ouvRes.success) setOuvriers(ouvRes.ouvriers);
      if (ptgRes.success) setPointages(ptgRes.pointages);
      if (cRes.success) setContrats(cRes.contrats);
      setFromCache(Boolean(ptgRes.fromCache || ouvRes.fromCache));
      setPendingSyncCount(getPendingContractuelPointagesCount());
    } catch (err) {
      console.error('Erreur chargement dashboard contractuelles:', err);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }

  const showNotice = (text: string, isError = false) => {
    setActionMessage({ text, isError });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const availableCaporaux = useMemo(() => {
    const set = new Set<string>();
    pointages.forEach((p) => {
      if (p.submitted_by_nom) set.add(p.submitted_by_nom);
      else if (p.created_by_nom) set.add(p.created_by_nom);
    });
    return Array.from(set).sort();
  }, [pointages]);

  const handleApplyPreset = (preset: 'today' | 'week' | 'month') => {
    setPeriodPreset(preset);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(today);
    } else if (preset === 'month') {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(today);
    }
  };

  // Filtrage combiné des pointages
  const filteredPointages = useMemo(() => {
    return pointages.filter((p) => {
      if (selectedDomaineId !== 'ALL' && p.domaine_id !== selectedDomaineId) return false;
      if (selectedOuvrierId !== 'ALL' && p.ouvrier_id !== selectedOuvrierId) return false;
      if (selectedCaporalName !== 'ALL') {
        const author = p.submitted_by_nom || p.created_by_nom;
        if (author !== selectedCaporalName) return false;
      }

      if (selectedStatutValidation !== 'ALL') {
        if (normalizeStatutValidation(p.statut_validation) !== selectedStatutValidation) {
          return false;
        }
      }

      if (onlyModifiedTarif && !p.tarif_modifie) {
        return false;
      }

      if (selectedSerreId !== 'ALL') {
        const hasSerreInActivities = (p.activites || []).some(
          (a) =>
            (Array.isArray(a.serres_ids) && a.serres_ids.includes(selectedSerreId)) ||
            a.serre_id === selectedSerreId
        );
        const hasSerreInPointage =
          (Array.isArray(p.serres_ids) && p.serres_ids.includes(selectedSerreId)) ||
          p.serre_id === selectedSerreId;

        if (!hasSerreInActivities && !hasSerreInPointage) return false;
      }

      return true;
    });
  }, [
    pointages,
    selectedDomaineId,
    selectedSerreId,
    selectedOuvrierId,
    selectedCaporalName,
    selectedStatutValidation,
    onlyModifiedTarif,
  ]);

  // Pointages en attente de validation Admin (SOUMIS en priorité, puis BROUILLON/REFUSE)
  const validationQueue = useMemo(() => {
    const rank = (s: StatutValidationContractuel) => {
      if (s === 'SOUMIS') return 0;
      if (s === 'BROUILLON') return 1;
      if (s === 'REFUSE') return 2;
      return 3;
    };
    return [...filteredPointages].sort((a, b) => {
      const ra = rank(normalizeStatutValidation(a.statut_validation));
      const rb = rank(normalizeStatutValidation(b.statut_validation));
      if (ra !== rb) return ra - rb;
      if (a.tarif_modifie !== b.tarif_modifie) return a.tarif_modifie ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }, [filteredPointages]);

  const pendingSoumisList = useMemo(
    () =>
      filteredPointages.filter(
        (p) => normalizeStatutValidation(p.statut_validation) === 'SOUMIS'
      ),
    [filteredPointages]
  );

  // Activités officielles (uniquement sur pointages VALIDÉS)
  const validatedActivities = useMemo(() => {
    const list: Array<ContractuelActivite & { pointage_ref?: ContractuelPointage }> = [];
    filteredPointages.forEach((p) => {
      if (p.present && normalizeStatutValidation(p.statut_validation) === 'VALIDE') {
        if (p.activites && p.activites.length > 0) {
          p.activites.forEach((act) => {
            if (selectedSerreId !== 'ALL') {
              const matchSerre =
                (Array.isArray(act.serres_ids) && act.serres_ids.includes(selectedSerreId)) ||
                act.serre_id === selectedSerreId;
              if (!matchSerre) return;
            }
            list.push({ ...act, pointage_ref: p });
          });
        } else {
          list.push({
            id: `act_synth_${p.id}`,
            pointage_id: p.id,
            company_id: p.company_id,
            ouvrier_id: p.ouvrier_id,
            nom_complet: p.nom_complet,
            matricule: p.matricule,
            date: p.date,
            tache_id: p.taches_ids?.[0] || 'tch_contractuel',
            tache_nom: p.taches_texte || p.taches_noms?.join(', ') || 'Prestation contractuelle',
            domaine_id: p.domaine_id,
            serre_id: p.serre_id || p.serres_ids?.[0] || 'non_affectee',
            serre_nom: p.serres_texte || p.serres_noms?.join(', ') || 'Non affectée',
            serres_ids: p.serres_ids,
            serres_noms: p.serres_noms,
            serres_texte: p.serres_texte,
            mode_remuneration: 'JOUR',
            quantite: p.duree_heures || 1,
            unite: p.duree_heures ? 'HEURE' : 'JOUR',
            prix_unitaire: getOfficialPointageMontant(p),
            montant_total: getOfficialPointageMontant(p),
            created_by_id: p.created_by_id,
            created_by_nom: p.created_by_nom,
            created_at: p.created_at,
            pointage_ref: p,
          });
        }
      }
    });
    return list;
  }, [filteredPointages, selectedSerreId]);

  // KPIs : séparation absolue entre montants validés (officiels) et propositions en attente
  const kpis = useMemo(() => {
    let presents = 0;
    let absents = 0;
    let validatedCount = 0;
    let soumisCount = 0;
    let tarifsModifiesCount = 0;
    let montantOfficielValide = 0;
    let montantEnAttente = 0;

    filteredPointages.forEach((p) => {
      const st = normalizeStatutValidation(p.statut_validation);
      if (p.tarif_modifie) tarifsModifiesCount++;
      if (p.present) {
        presents++;
        if (st === 'VALIDE') {
          validatedCount++;
          montantOfficielValide += getOfficialPointageMontant(p);
        } else if (st === 'SOUMIS' || st === 'BROUILLON') {
          if (st === 'SOUMIS') soumisCount++;
          montantEnAttente += getProposedPointageMontant(p);
        }
      } else {
        absents++;
        if (st === 'VALIDE') validatedCount++;
        if (st === 'SOUMIS') soumisCount++;
      }
    });

    const moyenneParPresenceValidee =
      validatedCount > 0 ? montantOfficielValide / validatedCount : 0;

    return {
      presents,
      absents,
      validatedCount,
      soumisCount,
      tarifsModifiesCount,
      montantOfficielValide: roundAmount(montantOfficielValide),
      montantEnAttente: roundAmount(montantEnAttente),
      moyenneParPresenceValidee,
    };
  }, [filteredPointages]);

  // Agrégation par Serre (OFFICIEL VALIDÉ UNIQUEMENT)
  const serreStats = useMemo(() => {
    const map = new Map<
      string,
      {
        serre_id: string;
        serre_nom: string;
        nbOuvriersDistincts: Set<string>;
        nbTaches: number;
        montantTotal: number;
      }
    >();

    validatedActivities.forEach((act) => {
      const serreNames =
        Array.isArray(act.serres_noms) && act.serres_noms.length > 0
          ? act.serres_noms
          : [act.serre_nom || act.serre_id || 'Non affectée'];
      const splitShare = serreNames.length > 0 ? serreNames.length : 1;

      serreNames.forEach((sNom, idx) => {
        const sId =
          (Array.isArray(act.serres_ids) && act.serres_ids[idx]) || sNom;
        if (!map.has(sId)) {
          map.set(sId, {
            serre_id: sId,
            serre_nom: sNom,
            nbOuvriersDistincts: new Set<string>(),
            nbTaches: 0,
            montantTotal: 0,
          });
        }
        const rec = map.get(sId)!;
        rec.nbOuvriersDistincts.add(act.ouvrier_id);
        rec.nbTaches += 1;
        rec.montantTotal = roundAmount(
          rec.montantTotal + (Number(act.montant_total) || 0) / splitShare
        );
      });
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        nbOuvriers: item.nbOuvriersDistincts.size,
      }))
      .sort((a, b) => b.montantTotal - a.montantTotal);
  }, [validatedActivities]);

  // Agrégation par Ouvrier (OFFICIEL VALIDÉ UNIQUEMENT)
  const ouvrierStats = useMemo(() => {
    const map = new Map<
      string,
      {
        ouvrier_id: string;
        matricule: string;
        nom_complet: string;
        joursPresents: number;
        joursValides: number;
        joursAbsents: number;
        montantProposeTotal: number;
        montantOfficielValide: number;
      }
    >();

    filteredPointages.forEach((p) => {
      if (!map.has(p.ouvrier_id)) {
        map.set(p.ouvrier_id, {
          ouvrier_id: p.ouvrier_id,
          matricule: p.matricule,
          nom_complet: p.nom_complet,
          joursPresents: 0,
          joursValides: 0,
          joursAbsents: 0,
          montantProposeTotal: 0,
          montantOfficielValide: 0,
        });
      }

      const rec = map.get(p.ouvrier_id)!;
      if (p.present) {
        rec.joursPresents += 1;
        rec.montantProposeTotal = roundAmount(
          rec.montantProposeTotal + getProposedPointageMontant(p)
        );
        if (normalizeStatutValidation(p.statut_validation) === 'VALIDE') {
          rec.joursValides += 1;
          rec.montantOfficielValide = roundAmount(
            rec.montantOfficielValide + getOfficialPointageMontant(p)
          );
        }
      } else {
        rec.joursAbsents += 1;
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => b.montantOfficielValide - a.montantOfficielValide
    );
  }, [filteredPointages]);

  // Validation / Refus individuel par l'Administrateur
  const handleValidateOne = async (
    ptg: ContractuelPointage,
    decision: 'VALIDE' | 'REFUSE'
  ) => {
    if (!isAdmin) return;
    const rawVal = adminMontantEdits[ptg.id];
    const parsed = rawVal !== undefined ? parseFloat(rawVal) : getProposedPointageMontant(ptg);

    if (decision === 'VALIDE' && ptg.present && (isNaN(parsed) || parsed < 0)) {
      showNotice('Montant validé invalide.', true);
      return;
    }

    const motif = (adminMotifEdits[ptg.id] || '').trim();
    if (decision === 'REFUSE' && !motif) {
      showNotice('Veuillez saisir un motif de refus pour le caporal.', true);
      return;
    }

    setProcessingId(ptg.id);
    try {
      const res = await validateContractuelPointage(ptg.id, {
        decision,
        montant_valide: decision === 'VALIDE' ? roundAmount(parsed) : undefined,
        motif: motif || undefined,
      });

      if (res.success && res.pointage) {
        setPointages((prev) => prev.map((p) => (p.id === ptg.id ? res.pointage! : p)));
        showNotice(
          decision === 'VALIDE'
            ? `✓ ${ptg.nom_complet} validé (${getOfficialPointageMontant(res.pointage)} DH)`
            : `✕ ${ptg.nom_complet} refusé`
        );
      } else {
        showNotice(res.error || 'Erreur validation.', true);
      }
    } finally {
      setProcessingId(null);
    }
  };

  // Validation en lot des pointages SOUMIS
  const handleBatchApproveSubmitted = async () => {
    if (!isAdmin || pendingSoumisList.length === 0) return;

    setBatchProcessing(true);
    try {
      const items = pendingSoumisList.map((ptg) => {
        const rawVal = adminMontantEdits[ptg.id];
        const parsed =
          rawVal !== undefined ? parseFloat(rawVal) : getProposedPointageMontant(ptg);
        return {
          id: ptg.id,
          decision: 'VALIDE' as const,
          montant_valide: ptg.present && !isNaN(parsed) ? roundAmount(parsed) : 0,
          motif: (adminMotifEdits[ptg.id] || '').trim() || undefined,
        };
      });

      const res = await validateContractuelPointagesBatch(items);
      if (res.success && Array.isArray(res.pointages)) {
        const updatedMap = new Map(res.pointages.map((p) => [p.id, p]));
        setPointages((prev) => prev.map((p) => updatedMap.get(p.id) || p));
        showNotice(`✓ ${res.count || items.length} pointage(s) validé(s) par l'administrateur.`);
      } else {
        showNotice(res.error || 'Erreur lors de la validation en lot.', true);
      }
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      exportContractuellesExcel({
        pointages: filteredPointages,
        allOuvriers: ouvriers,
        date: `${startDate} au ${endDate}`,
        filterDesc:
          selectedDomaineId !== 'ALL'
            ? `Domaine ${domaines.find((d) => d.id === selectedDomaineId)?.nom || selectedDomaineId}`
            : 'Tous les domaines',
      });
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la génération du fichier Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. FILTRES MULTICRITÈRES & EXPORT */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Validation Administrateur & Tableau de Bord Contractuelles
              </h3>
              <p className="text-[11px] text-slate-500">
                Période du {startDate} au {endDate} • Rémunération officielle basée uniquement sur
                les pointages VALIDÉS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {fromCache && (
              <span className="text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full border border-amber-300">
                Cache hors ligne
              </span>
            )}
            {pendingSyncCount > 0 && (
              <span className="text-[10px] font-black bg-amber-500 text-white px-2 py-0.5 rounded-full">
                ⏳ {pendingSyncCount} en attente sync
              </span>
            )}
            <button
              type="button"
              onClick={() => loadAllData()}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
              title="Actualiser"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={exporting}
              className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-3.5 py-2 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{exporting ? 'Génération...' : 'Export Excel Officiel (5 Feuilles)'}</span>
            </button>
          </div>
        </div>

        {actionMessage && (
          <div
            className={`p-2.5 rounded-xl text-xs font-black border ${
              actionMessage.isError
                ? 'bg-rose-50 text-rose-900 border-rose-200'
                : 'bg-emerald-50 text-emerald-900 border-emerald-200'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* Presets période + filtre modifications tarif */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-black uppercase text-slate-500 mr-1">Période :</span>
            {(
              [
                { id: 'today', label: "Aujourd'hui" },
                { id: 'week', label: '7 derniers jours' },
                { id: 'month', label: '30 derniers jours' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleApplyPreset(p.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                  periodPreset === p.id
                    ? 'bg-emerald-800 text-white shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={onlyModifiedTarif}
              onChange={(e) => setOnlyModifiedTarif(e.target.checked)}
              className="rounded accent-amber-600"
            />
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>Tarifs modifiés uniquement ({kpis.tarifsModifiesCount})</span>
          </label>
        </div>

        {/* Filtres multicritères */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Du</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            />
          </div>

          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Au</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPeriodPreset('custom');
              }}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            />
          </div>

          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Domaine</span>
            <select
              value={selectedDomaineId}
              onChange={(e) => {
                const nextDom = e.target.value;
                setSelectedDomaineId(nextDom);
                if (nextDom !== 'ALL' && selectedSerreId !== 'ALL') {
                  const allowed = getSerresForDomaine(serres, nextDom, domaines);
                  if (!allowed.some((s) => s.id === selectedSerreId)) {
                    setSelectedSerreId('ALL');
                  }
                }
              }}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Tous les domaines</option>
              {domaines.map((d) => (
                <option key={d.id} value={d.id}>
                  Domaine {d.nom}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Serre</span>
            <select
              value={selectedSerreId}
              onChange={(e) => setSelectedSerreId(e.target.value)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Toutes les serres</option>
              {(selectedDomaineId !== 'ALL'
                ? getSerresForDomaine(serres, selectedDomaineId, domaines)
                : serres.filter((s) => s.actif !== false)
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom} ({s.code})
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">
              Statut Validation
            </span>
            <select
              value={selectedStatutValidation}
              onChange={(e) => setSelectedStatutValidation(e.target.value as any)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Tous les statuts</option>
              <option value="SOUMIS">Soumis (Attente Admin)</option>
              <option value="BROUILLON">Brouillon Caporal</option>
              <option value="VALIDE">Validé Officiel</option>
              <option value="REFUSE">Refusé</option>
            </select>
          </div>

          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Caporal / Ouvrier</span>
            <select
              value={selectedOuvrierId}
              onChange={(e) => setSelectedOuvrierId(e.target.value)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none truncate"
            >
              <option value="ALL">Tous les ouvriers</option>
              {ouvriers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nom_complet} ({o.matricule})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. CARTES KPIS OFFICIELLES VS EN ATTENTE */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white rounded-2xl p-3.5 border border-emerald-700 shadow-sm">
          <span className="text-[10px] font-black uppercase text-emerald-300 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Rémunération Officielle Validée
          </span>
          <div className="text-2xl font-black mt-1 font-mono">
            {kpis.montantOfficielValide.toLocaleString('fr-FR', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}{' '}
            <span className="text-xs font-sans text-emerald-300">DH</span>
          </div>
          <span className="text-[10px] text-emerald-200">
            {kpis.validatedCount} pointage(s) validé(s) Admin
          </span>
        </div>

        <div className="bg-amber-50 rounded-2xl p-3.5 border border-amber-300 shadow-xs">
          <span className="text-[10px] font-black uppercase text-amber-900 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-700" /> En Attente Validation
          </span>
          <div className="text-2xl font-black text-amber-950 mt-1 font-mono">
            {kpis.montantEnAttente.toLocaleString('fr-FR', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}{' '}
            <span className="text-xs font-sans">DH</span>
          </div>
          <span className="text-[10px] text-amber-800 font-semibold">
            {kpis.soumisCount} soumis • non inclus dans le paie officielle
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-rose-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-rose-800 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Tarifs Modifiés
          </span>
          <div className="text-2xl font-black text-rose-950 mt-1">{kpis.tarifsModifiesCount}</div>
          <span className="text-[10px] text-slate-500">
            Écarts vs tarif initial catalogue
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> Hommes-Jours Présents
          </span>
          <div className="text-2xl font-black text-slate-900 mt-1">{kpis.presents}</div>
          <span className="text-[10px] text-slate-500">
            {kpis.absents} absence(s) • Moy. {kpis.moyenneParPresenceValidee.toFixed(1)} DH
          </span>
        </div>
      </div>

      {/* 3. SOUS-ONGLETS DE VUES */}
      <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('validation')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            activeTab === 'validation'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Validation Admin ({pendingSoumisList.length} soumis)</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('synthese')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            activeTab === 'synthese'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <span>Synthèse Officielle</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('serres')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            activeTab === 'serres'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Par Serre ({serreStats.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ouvriers')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            activeTab === 'ouvriers'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Par Ouvrier ({ouvrierStats.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('journal')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 cursor-pointer ${
            activeTab === 'journal'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Journal & Traçabilité ({filteredPointages.length})</span>
        </button>
      </div>

      {/* 4. CONTENU DE L'ONGLET ACTIF */}
      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center text-slate-500 border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
          <span className="text-xs">Chargement des données...</span>
        </div>
      ) : (
        <>
          {/* ONGLET 0 : VALIDATION ADMIN */}
          {activeTab === 'validation' && (
            <div className="space-y-3">
              {isAdmin && pendingSoumisList.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-black text-amber-950 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-700" />
                    <span>
                      {pendingSoumisList.length} pointage(s) soumis par caporal en attente de
                      validation administrateur
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={batchProcessing}
                    onClick={handleBatchApproveSubmitted}
                    className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <CheckCheck className="w-4 h-4" />
                    <span>
                      {batchProcessing
                        ? 'Validation en lot...'
                        : `Valider tous les soumis (${pendingSoumisList.length})`}
                    </span>
                  </button>
                </div>
              )}

              {validationQueue.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 text-xs text-slate-500">
                  Aucun pointage contractuel trouvé pour les filtres actuels.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {validationQueue.map((ptg) => {
                    const statut = normalizeStatutValidation(ptg.statut_validation);
                    const tarifInit = roundAmount(Number(ptg.tarif_initial) || 0);
                    const propAmount = getProposedPointageMontant(ptg, tarifInit);
                    const editAmountVal =
                      adminMontantEdits[ptg.id] !== undefined
                        ? adminMontantEdits[ptg.id]
                        : String(
                            statut === 'VALIDE' && ptg.montant_valide !== null && ptg.montant_valide !== undefined
                              ? ptg.montant_valide
                              : propAmount
                          );
                    const isHistoryOpen = Boolean(expandedHistoryIds[ptg.id]);
                    const historyList = Array.isArray(ptg.historique_validations)
                      ? ptg.historique_validations
                      : [];
                    const isProcessing = processingId === ptg.id;

                    return (
                      <div
                        key={ptg.id}
                        className={`bg-white rounded-2xl p-3.5 border shadow-xs space-y-2.5 ${
                          ptg.tarif_modifie && statut !== 'VALIDE'
                            ? 'border-amber-400 bg-amber-50/15'
                            : statut === 'VALIDE'
                            ? 'border-emerald-300'
                            : statut === 'REFUSE'
                            ? 'border-rose-300 bg-rose-50/10'
                            : 'border-slate-200'
                        }`}
                      >
                        {/* En-tête */}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-black bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                                {ptg.date}
                              </span>
                              <span className="font-black text-sm text-slate-900">
                                {ptg.nom_complet}
                              </span>
                              <span className="font-mono text-[10px] font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                {ptg.matricule}
                              </span>
                              <span className="text-[10px] font-black bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded">
                                Domaine {ptg.domaine_id.replace('dom_', '').toUpperCase()}
                              </span>
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${getBadgeStyle(
                                  statut
                                )}`}
                              >
                                {getStatutValidationLabel(statut)}
                              </span>
                              {ptg.tarif_modifie && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-100 text-amber-900 px-2 py-0.5 rounded-md border border-amber-300">
                                  <AlertTriangle className="w-3 h-3" />
                                  TARIF MODIFIÉ ({tarifInit} → {propAmount} DH)
                                </span>
                              )}
                            </div>

                            <div className="text-[11px] text-slate-500">
                              Saisi par <strong>{ptg.created_by_nom || 'Caporal'}</strong>
                              {ptg.submitted_by_nom &&
                                ` • Soumis par ${ptg.submitted_by_nom}`}
                              {ptg.validated_by_nom &&
                                ` • Validé/traité par ${ptg.validated_by_nom}`}
                            </div>
                          </div>

                          {/* Montants comparés */}
                          <div className="flex items-center gap-2 text-xs">
                            <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-right">
                              <span className="block text-[9px] font-black uppercase text-slate-400">
                                Initial
                              </span>
                              <span className="font-mono font-bold text-slate-700">
                                {tarifInit} DH
                              </span>
                            </div>
                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1 text-right">
                              <span className="block text-[9px] font-black uppercase text-amber-700">
                                Proposé
                              </span>
                              <span className="font-mono font-black text-amber-900">
                                {propAmount} DH
                              </span>
                            </div>
                            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-1 text-right">
                              <span className="block text-[9px] font-black uppercase text-emerald-700">
                                Validé Officiel
                              </span>
                              <span className="font-mono font-black text-emerald-900">
                                {getOfficialPointageMontant(ptg)} DH
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Détails tâches / serres / horaires / motif caporal */}
                        {ptg.present ? (
                          <div className="flex flex-wrap items-center gap-2 text-[11px] pt-1 border-t border-slate-100">
                            <span className="font-bold text-slate-500">Tâches :</span>
                            <span className="bg-indigo-50 text-indigo-900 font-bold px-2 py-0.5 rounded">
                              {ptg.taches_texte || ptg.taches_noms?.join(', ') || 'Non précisée'}
                            </span>
                            <span className="font-bold text-slate-500">Serres :</span>
                            <span className="bg-emerald-50 text-emerald-900 font-bold px-2 py-0.5 rounded">
                              {ptg.serres_texte || ptg.serres_noms?.join(', ') || 'Non affectée'}
                            </span>
                            {ptg.heure_debut && ptg.heure_fin && (
                              <span className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded">
                                🕒 {ptg.heure_debut}–{ptg.heure_fin} (
                                {formatDurationLabel(ptg.duree_heures)})
                              </span>
                            )}
                            {ptg.motif_modification && (
                              <span className="bg-amber-50 text-amber-900 font-semibold px-2 py-0.5 rounded border border-amber-200">
                                Note caporal : {ptg.motif_modification}
                              </span>
                            )}
                            {ptg.motif_refus && (
                              <span className="bg-rose-50 text-rose-900 font-semibold px-2 py-0.5 rounded border border-rose-200">
                                Motif refus : {ptg.motif_refus}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs font-bold text-rose-700 pt-1 border-t border-slate-100">
                            Marqué ABSENT (0 DH)
                          </div>
                        )}

                        {/* Contrôles Admin + Historique */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedHistoryIds((prev) => ({
                                ...prev,
                                [ptg.id]: !prev[ptg.id],
                              }))
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            <span>Historique ({historyList.length})</span>
                            {isHistoryOpen ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>

                          {isAdmin && (
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-xl px-2 h-9">
                                <span className="text-[10px] font-black text-slate-500 uppercase">
                                  Final :
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.5"
                                  disabled={!ptg.present || isProcessing}
                                  value={ptg.present ? editAmountVal : '0'}
                                  onChange={(e) =>
                                    setAdminMontantEdits((prev) => ({
                                      ...prev,
                                      [ptg.id]: e.target.value,
                                    }))
                                  }
                                  className="w-16 font-mono font-black text-xs text-right bg-transparent outline-none"
                                />
                                <span className="text-xs font-bold text-slate-500">DH</span>
                              </div>

                              <input
                                type="text"
                                value={adminMotifEdits[ptg.id] || ''}
                                onChange={(e) =>
                                  setAdminMotifEdits((prev) => ({
                                    ...prev,
                                    [ptg.id]: e.target.value,
                                  }))
                                }
                                placeholder="Motif (requis si refus)..."
                                className="px-2.5 h-9 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 outline-none w-48"
                              />

                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => handleValidateOne(ptg, 'VALIDE')}
                                className="h-9 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Valider</span>
                              </button>

                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => handleValidateOne(ptg, 'REFUSE')}
                                className="h-9 px-3 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-black flex items-center gap-1 shadow-2xs cursor-pointer disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Refuser</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {isHistoryOpen && (
                          <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                            {historyList.length === 0 ? (
                              <p className="text-[11px] text-slate-400 italic">
                                Aucun historique détaillé pour cette entrée.
                              </p>
                            ) : (
                              historyList.map((h) => (
                                <div
                                  key={h.id}
                                  className="bg-white p-2 rounded-lg border border-slate-200 text-[11px] flex flex-wrap items-center justify-between gap-2"
                                >
                                  <div>
                                    <span className="font-black text-slate-900">
                                      {h.action} ({h.statut_avant || '—'} → {h.statut_apres})
                                    </span>{' '}
                                    • Par <strong>{h.auteur_nom}</strong> ({h.auteur_role})
                                    {h.montant_propose !== undefined &&
                                      ` • Proposé: ${h.montant_propose} DH`}
                                    {h.montant_valide !== null &&
                                      h.montant_valide !== undefined &&
                                      ` • Validé: ${h.montant_valide} DH`}
                                    {h.motif && ` • Motif: ${h.motif}`}
                                  </div>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {new Date(h.timestamp).toLocaleString('fr-FR')}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VUE 1 : SYNTHÈSE OFFICIELLE */}
          {activeTab === 'synthese' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-700" />
                  Top des serres (montants officiels validés uniquement)
                </h4>

                {serreStats.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Aucune rémunération validée pour cette période.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {serreStats.slice(0, 5).map((item) => (
                      <div
                        key={item.serre_id}
                        className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs"
                      >
                        <div>
                          <span className="font-black text-slate-900">{item.serre_nom}</span>
                          <span className="text-[11px] text-slate-500 block">
                            {item.nbOuvriers} ouvrier(s) distinct(s) • {item.nbTaches} tâche(s)
                          </span>
                        </div>
                        <span className="font-black text-emerald-800 text-sm">
                          {item.montantTotal.toFixed(2)} DH
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-700" />
                  Top ouvriers (rémunérations officielles validées)
                </h4>

                {ouvrierStats.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Aucune donnée trouvée.</p>
                ) : (
                  <div className="space-y-2">
                    {ouvrierStats.slice(0, 5).map((item) => (
                      <div
                        key={item.ouvrier_id}
                        className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] font-black bg-slate-200 px-1 rounded">
                              {item.matricule}
                            </span>
                            <span className="font-black text-slate-900">{item.nom_complet}</span>
                          </div>
                          <span className="text-[11px] text-slate-500 block">
                            {item.joursValides} jour(s) validé(s) sur {item.joursPresents} présent(s)
                          </span>
                        </div>
                        <span className="font-black text-emerald-800 text-sm">
                          {item.montantOfficielValide.toFixed(2)} DH
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* VUE 2 : PAR SERRE */}
          {activeTab === 'serres' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-black text-[10px] uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Serre</th>
                      <th className="py-2.5 px-3 text-center">Ouvriers</th>
                      <th className="py-2.5 px-3 text-center">Tâches</th>
                      <th className="py-2.5 px-3 text-right">Officiel Validé (DH)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {serreStats.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">
                          Aucune rémunération validée trouvée.
                        </td>
                      </tr>
                    ) : (
                      serreStats.map((item) => (
                        <tr key={item.serre_id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-black text-slate-900">{item.serre_nom}</td>
                          <td className="py-2.5 px-3 text-center text-slate-600 font-bold">
                            {item.nbOuvriers}
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-600 font-bold">
                            {item.nbTaches}
                          </td>
                          <td className="py-2.5 px-3 text-right font-black text-emerald-800">
                            {item.montantTotal.toFixed(2)} DH
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VUE 3 : PAR OUVRIER */}
          {activeTab === 'ouvriers' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-black text-[10px] uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Matricule</th>
                      <th className="py-2.5 px-3">Ouvrier</th>
                      <th className="py-2.5 px-3 text-center">Présences</th>
                      <th className="py-2.5 px-3 text-center">Validés</th>
                      <th className="py-2.5 px-3 text-center">Absences</th>
                      <th className="py-2.5 px-3 text-right">Proposé (DH)</th>
                      <th className="py-2.5 px-3 text-right">Officiel Validé (DH)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ouvrierStats.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400">
                          Aucun ouvrier pointé sur cette période.
                        </td>
                      </tr>
                    ) : (
                      ouvrierStats.map((item) => (
                        <tr key={item.ouvrier_id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-3 font-mono font-black text-slate-800">
                            {item.matricule}
                          </td>
                          <td className="py-2.5 px-3 font-black text-slate-900">{item.nom_complet}</td>
                          <td className="py-2.5 px-3 text-center text-emerald-700 font-bold">
                            {item.joursPresents}
                          </td>
                          <td className="py-2.5 px-3 text-center text-indigo-700 font-bold">
                            {item.joursValides}
                          </td>
                          <td className="py-2.5 px-3 text-center text-rose-600 font-bold">
                            {item.joursAbsents}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-800 font-bold">
                            {item.montantProposeTotal.toFixed(2)} DH
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-800">
                            {item.montantOfficielValide.toFixed(2)} DH
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VUE 4 : JOURNAL & TRAÇABILITÉ */}
          {activeTab === 'journal' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-black text-[10px] uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Ouvrier</th>
                      <th className="py-2.5 px-3">Tâches</th>
                      <th className="py-2.5 px-3">Serres</th>
                      <th className="py-2.5 px-3">Horaires</th>
                      <th className="py-2.5 px-3 text-right">Initial</th>
                      <th className="py-2.5 px-3 text-right">Proposé</th>
                      <th className="py-2.5 px-3">Statut</th>
                      <th className="py-2.5 px-3 text-right">Officiel Validé</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPointages.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-400">
                          Aucun enregistrement sur cette période.
                        </td>
                      </tr>
                    ) : (
                      filteredPointages.map((p) => {
                        const st = normalizeStatutValidation(p.statut_validation);
                        return (
                          <tr key={p.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 text-slate-600 font-bold whitespace-nowrap">
                              {p.date}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {p.nom_complet} ({p.matricule})
                            </td>
                            <td className="py-2.5 px-3 text-indigo-950 font-semibold max-w-xs truncate">
                              {p.present ? p.taches_texte || '—' : 'ABSENT'}
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 max-w-xs truncate">
                              {p.present ? p.serres_texte || '—' : '—'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                              {p.present && p.heure_debut && p.heure_fin
                                ? `${p.heure_debut}-${p.heure_fin} (${formatDurationLabel(
                                    p.duree_heures
                                  )})`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                              {p.tarif_initial ?? 0} DH
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-800">
                              {getProposedPointageMontant(p)} DH
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-md border ${getBadgeStyle(
                                  st
                                )}`}
                              >
                                {getStatutValidationLabel(st)}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black text-emerald-800">
                              {getOfficialPointageMontant(p)} DH
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
        </>
      )}
    </div>
  );
};
