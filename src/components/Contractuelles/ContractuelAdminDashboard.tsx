/**
 * Tableau de bord Administrateur pour la gestion des Contractuelles
 * - Filtres multicritères (date, période, domaine, serre, ouvrier)
 * - Indicateurs clés de performance (KPIs)
 * - Vues analytiques : par jour, par serre, par ouvrier
 * - Exportation Excel multi-feuilles professionnelle SheetJS (5 feuilles)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Filter,
  FileSpreadsheet,
  Download,
  Users,
  Building2,
  DollarSign,
  TrendingUp,
  Clock,
  Layers,
  ChevronRight,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Tag,
} from 'lucide-react';
import {
  ContractuelOuvrier,
  ContractuelContrat,
  ContractuelPointage,
  ContractuelActivite,
  Domaine,
  Serre,
  UserAccount,
} from '../../types';
import {
  getContractuelOuvriers,
  getContractuelContrats,
  getContractuelPointages,
  exportContractuellesExcel,
} from '../../services/contractuelService';

interface ContractuelAdminDashboardProps {
  domaines: Domaine[];
  serres: Serre[];
  currentUser: UserAccount;
}

export const ContractuelAdminDashboard: React.FC<ContractuelAdminDashboardProps> = ({
  domaines,
  serres,
  currentUser,
}) => {
  // Période par défaut : les 30 derniers jours jusqu'à aujourd'hui
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
  const [selectedContratId, setSelectedContratId] = useState<string>('ALL');
  const [selectedCaporalName, setSelectedCaporalName] = useState<string>('ALL');
  const [periodPreset, setPeriodPreset] = useState<'today' | 'week' | 'month' | 'custom'>('month');

  // Sous-onglet de vue : 'synthese' | 'serres' | 'ouvriers' | 'journal'
  const [activeTab, setActiveTab] = useState<'synthese' | 'serres' | 'ouvriers' | 'journal'>('synthese');

  // Données
  const [ouvriers, setOuvriers] = useState<ContractuelOuvrier[]>([]);
  const [contrats, setContrats] = useState<ContractuelContrat[]>([]);
  const [pointages, setPointages] = useState<ContractuelPointage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);

  useEffect(() => {
    loadAllData();
  }, [startDate, endDate]);

  async function loadAllData() {
    setLoading(true);
    try {
      const [ouvRes, ptgRes, cRes] = await Promise.all([
        getContractuelOuvriers(),
        getContractuelPointages({ startDate, endDate }),
        getContractuelContrats(),
      ]);

      if (ouvRes.success) setOuvriers(ouvRes.ouvriers);
      if (ptgRes.success) setPointages(ptgRes.pointages);
      if (cRes.success) setContrats(cRes.contrats);
    } catch (err) {
      console.error('Erreur chargement dashboard contractuelles:', err);
    } finally {
      setLoading(false);
    }
  }

  // Liste des caporaux ayant saisi des pointages
  const availableCaporaux = useMemo(() => {
    const set = new Set<string>();
    pointages.forEach((p) => {
      if (p.created_by_nom) set.add(p.created_by_nom);
    });
    return Array.from(set).sort();
  }, [pointages]);

  // Appliquer le preset de date
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
      if (selectedCaporalName !== 'ALL' && p.created_by_nom !== selectedCaporalName) return false;

      // Filtre Serre (multi-serres compatible)
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

      // Filtre Contrat
      if (selectedContratId !== 'ALL') {
        const hasContrat = (p.activites || []).some((a) => a.contrat_id === selectedContratId);
        if (!hasContrat) return false;
      }

      return true;
    });
  }, [pointages, selectedDomaineId, selectedSerreId, selectedOuvrierId, selectedContratId, selectedCaporalName]);

  // Extraction de toutes les activités filtrées
  const allActivities = useMemo(() => {
    const list: ContractuelActivite[] = [];
    filteredPointages.forEach((p) => {
      if (p.present && p.activites && p.activites.length > 0) {
        p.activites.forEach((act) => {
          if (selectedSerreId !== 'ALL') {
            const matchSerre =
              (Array.isArray(act.serres_ids) && act.serres_ids.includes(selectedSerreId)) ||
              act.serre_id === selectedSerreId;
            if (!matchSerre) return;
          }
          if (selectedContratId !== 'ALL' && act.contrat_id !== selectedContratId) {
            return;
          }
          list.push(act);
        });
      }
    });
    return list;
  }, [filteredPointages, selectedSerreId, selectedContratId]);

  // Calcul des KPIs
  const kpis = useMemo(() => {
    let presents = 0;
    let absents = 0;
    let montantTotal = 0;

    filteredPointages.forEach((p) => {
      if (p.present) {
        presents++;
        montantTotal += Number(p.montant_total_jour) || 0;
      } else {
        absents++;
      }
    });

    const totalTaches = allActivities.length;
    const moyenneParPresence = presents > 0 ? montantTotal / presents : 0;

    return {
      presents,
      absents,
      totalTaches,
      montantTotal,
      moyenneParPresence,
    };
  }, [filteredPointages, allActivities]);

  // Agrégation par Serre
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

    allActivities.forEach((act) => {
      const sId = act.serre_id || 'autre';
      const sNom = act.serre_nom || 'Non affectée';

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
      rec.montantTotal += Number(act.montant_total) || 0;
    });

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        nbOuvriers: item.nbOuvriersDistincts.size,
      }))
      .sort((a, b) => b.montantTotal - a.montantTotal);
  }, [allActivities]);

  // Agrégation par Ouvrier
  const ouvrierStats = useMemo(() => {
    const map = new Map<
      string,
      {
        ouvrier_id: string;
        matricule: string;
        nom_complet: string;
        joursPresents: number;
        joursAbsents: number;
        nbTaches: number;
        montantTotal: number;
      }
    >();

    filteredPointages.forEach((p) => {
      if (!map.has(p.ouvrier_id)) {
        map.set(p.ouvrier_id, {
          ouvrier_id: p.ouvrier_id,
          matricule: p.matricule,
          nom_complet: p.nom_complet,
          joursPresents: 0,
          joursAbsents: 0,
          nbTaches: 0,
          montantTotal: 0,
        });
      }

      const rec = map.get(p.ouvrier_id)!;
      if (p.present) {
        rec.joursPresents += 1;
        rec.nbTaches += (p.activites || []).length;
        rec.montantTotal += Number(p.montant_total_jour) || 0;
      } else {
        rec.joursAbsents += 1;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.montantTotal - a.montantTotal);
  }, [filteredPointages]);

  // ACTION : Exportation Excel multi-feuilles
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
      {/* 1. SECTION FILTRES MULTICRITÈRES & EXPORT EXCEL */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Tableau de Bord & Historique Contractuelles
              </h3>
              <p className="text-[11px] text-slate-500">
                Période du {startDate} au {endDate}
              </p>
            </div>
          </div>

          {/* Bouton Export Excel 5-feuilles */}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting}
            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-3.5 py-2 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {exporting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
            <span>{exporting ? 'Génération Excel...' : 'Export Excel (5 Feuilles)'}</span>
          </button>
        </div>

        {/* Filtres de Période Rapides */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-black uppercase text-slate-500 mr-1">Période :</span>
          <button
            type="button"
            onClick={() => handleApplyPreset('today')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
              periodPreset === 'today'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Aujourd'hui
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('week')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
              periodPreset === 'week'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            7 derniers jours
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset('month')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
              periodPreset === 'month'
                ? 'bg-emerald-800 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            30 derniers jours
          </button>
        </div>

        {/* Champs de sélection Date, Domaines, Serres, Contrats et Caporaux */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Date début */}
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

          {/* Date fin */}
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

          {/* Domaine */}
          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Domaine</span>
            <select
              value={selectedDomaineId}
              onChange={(e) => setSelectedDomaineId(e.target.value)}
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

          {/* Serre */}
          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Serre</span>
            <select
              value={selectedSerreId}
              onChange={(e) => setSelectedSerreId(e.target.value)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
            >
              <option value="ALL">Toutes les serres</option>
              {serres.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom} ({s.code})
                </option>
              ))}
            </select>
          </div>

          {/* Contrat de référence */}
          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Contrat</span>
            <select
              value={selectedContratId}
              onChange={(e) => setSelectedContratId(e.target.value)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none truncate"
            >
              <option value="ALL">Tous les contrats</option>
              {contrats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.designation} ({c.prix_unitaire} DH)
                </option>
              ))}
            </select>
          </div>

          {/* Caporal */}
          <div className="bg-slate-50 rounded-xl px-2.5 py-1.5 border border-slate-200">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Saisi par</span>
            <select
              value={selectedCaporalName}
              onChange={(e) => setSelectedCaporalName(e.target.value)}
              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none truncate"
            >
              <option value="ALL">Tous les caporaux</option>
              {availableCaporaux.map((cName) => (
                <option key={cName} value={cName}>
                  {cName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 2. CARTES KPIS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-white rounded-2xl p-3.5 border border-emerald-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-emerald-800 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> Hommes-Jours Présents
          </span>
          <div className="text-2xl font-black text-emerald-950 mt-1">
            {kpis.presents}
          </div>
          <span className="text-[10px] text-slate-500">
            {kpis.absents} absence(s) enregistrée(s)
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-indigo-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-indigo-800 flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" /> Tâches Réalisées
          </span>
          <div className="text-2xl font-black text-indigo-950 mt-1">
            {kpis.totalTaches}
          </div>
          <span className="text-[10px] text-slate-500">
            Réparties en serres & domaines
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-amber-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-amber-800 flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" /> Montant Total DH
          </span>
          <div className="text-2xl font-black text-amber-950 mt-1">
            {kpis.montantTotal.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} <span className="text-xs font-bold">DH</span>
          </div>
          <span className="text-[10px] text-slate-500">
            Total des rémunérations contractuelles
          </span>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[10px] font-black uppercase text-slate-600 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> Coût Moyen / Homme
          </span>
          <div className="text-2xl font-black text-slate-900 mt-1">
            {kpis.moyenneParPresence.toFixed(1)} <span className="text-xs font-bold">DH</span>
          </div>
          <span className="text-[10px] text-slate-500">
            Rémunération moyenne journalière
          </span>
        </div>
      </div>

      {/* 3. SOUS-ONGLETS DE VUES */}
      <div className="flex items-center gap-1 bg-white p-1 rounded-2xl border border-slate-200 shadow-2xs overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveTab('synthese')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 ${
            activeTab === 'synthese'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <span>Synthèse globale</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('serres')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 ${
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
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 ${
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
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-black transition shrink-0 ${
            activeTab === 'journal'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Journal détaillé ({allActivities.length})</span>
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
          {/* VUE 1 : SYNTHÈSE GLOBALE */}
          {activeTab === 'synthese' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-700" />
                  Top des serres consommatrices de main d'œuvre contractuelle
                </h4>

                {serreStats.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Aucune donnée pour cette période.</p>
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
                          {item.montantTotal.toFixed(1)} DH
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Aperçu du détail des 5 dernières pointages */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <h4 className="text-xs font-black uppercase text-slate-900 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-700" />
                  Top ouvriers les plus rémunérés sur la période
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
                            {item.joursPresents} jour(s) présent(s) • {item.nbTaches} tâche(s)
                          </span>
                        </div>
                        <span className="font-black text-emerald-800 text-sm">
                          {item.montantTotal.toFixed(1)} DH
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
                      <th className="py-2.5 px-3 text-right">Montant Total (DH)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {serreStats.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-slate-400">
                          Aucune donnée trouvée.
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
                      <th className="py-2.5 px-3 text-center">Absences</th>
                      <th className="py-2.5 px-3 text-center">Tâches</th>
                      <th className="py-2.5 px-3 text-right">Rémunération (DH)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ouvrierStats.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
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
                          <td className="py-2.5 px-3 text-center text-rose-600 font-bold">
                            {item.joursAbsents}
                          </td>
                          <td className="py-2.5 px-3 text-center text-indigo-700 font-bold">
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

          {/* VUE 4 : JOURNAL DÉTAILLÉ */}
          {activeTab === 'journal' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-black text-[10px] uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Ouvrier</th>
                      <th className="py-2.5 px-3">Contrat de Réf.</th>
                      <th className="py-2.5 px-3">Tâche (Saisie libre)</th>
                      <th className="py-2.5 px-3">Serres Affectées</th>
                      <th className="py-2.5 px-3 text-center">Quantité</th>
                      <th className="py-2.5 px-3 text-right">P.U (DH)</th>
                      <th className="py-2.5 px-3 text-right">Total (DH)</th>
                      <th className="py-2.5 px-3">Saisi par</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allActivities.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-center text-slate-400">
                          Aucune tâche enregistrée.
                        </td>
                      </tr>
                    ) : (
                      allActivities.map((act) => {
                        const serresTxt = act.serres_texte || act.serre_nom || 'Non affectée';
                        return (
                          <tr key={act.id} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-3 text-slate-600 font-bold whitespace-nowrap">
                              {act.date}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-slate-900">
                              {act.nom_complet} ({act.matricule})
                            </td>
                            <td className="py-2.5 px-3 text-slate-600 font-semibold">
                              {act.contrat_nom ? (
                                <span className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded font-bold text-[10px]">
                                  {act.contrat_nom}
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-black text-indigo-950">{act.tache_nom}</td>
                            <td className="py-2.5 px-3">
                              <span className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-[11px] font-bold">
                                {serresTxt}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-slate-800">
                              {act.quantite} {act.unite}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600">{act.prix_unitaire} DH</td>
                            <td className="py-2.5 px-3 text-right font-black text-emerald-800">
                              {act.montant_total.toFixed(2)} DH
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                              {act.created_by_nom || 'Caporal'}
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
