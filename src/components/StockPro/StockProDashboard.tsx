import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Package,
  PlusCircle,
  MinusCircle,
  Upload,
  History,
  FileSpreadsheet,
  Search,
  Filter,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Download,
  Boxes,
  TrendingUp,
  TrendingDown,
  Layers,
  ShieldCheck,
  Plus,
  Edit2,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import {
  StockProduitSynthese,
  StockProduit,
  StockKPIs,
  StockMouvement,
  StockEtat,
  User,
  Domaine,
} from '../../types';
import {
  getStockSynthese,
  getMouvements,
  deleteProduit,
  exportEtatStockExcel,
  exportHistoriqueExcel,
  exportSortiesParDomaineExcel,
  exportSyntheseQuantitesExcel,
} from '../../services/stockService';
import { StockProImportModal } from './StockProImportModal';
import { StockProEntreeModal } from './StockProEntreeModal';
import { StockProSortieModal } from './StockProSortieModal';
import { StockProHistoriqueModal } from './StockProHistoriqueModal';
import { StockProProduitModal } from './StockProProduitModal';
import { StockProResetModal } from './StockProResetModal';

interface StockProDashboardProps {
  currentUser: User;
  domaines?: Domaine[];
}

export const StockProDashboard: React.FC<StockProDashboardProps> = ({
  currentUser,
  domaines = [],
}) => {
  const isAdmin = currentUser.role === 'admin';

  // Données
  const [produits, setProduits] = useState<StockProduitSynthese[]>([]);
  const [mouvements, setMouvements] = useState<StockMouvement[]>([]);
  const [kpis, setKpis] = useState<StockKPIs>({
    totalProduits: 0,
    totalEntrees: 0,
    totalSorties: 0,
    produitsStockFaible: 0,
    produitsRupture: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filtres
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUnite, setSelectedUnite] = useState<string>('ALL');
  const [selectedEtat, setSelectedEtat] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'nom' | 'stock' | 'etat'>('nom');
  const [sortAsc, setSortAsc] = useState(true);

  // Modales
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEntreeModalOpen, setIsEntreeModalOpen] = useState(false);
  const [isSortieModalOpen, setIsSortieModalOpen] = useState(false);
  const [isHistoriqueModalOpen, setIsHistoriqueModalOpen] = useState(false);
  const [isProduitModalOpen, setIsProduitModalOpen] = useState(false);
  const [produitToEdit, setProduitToEdit] = useState<StockProduit | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [selectedProduitForModal, setSelectedProduitForModal] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [successFeedback, setSuccessFeedback] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const triggerSuccessFeedback = (msg: string) => {
    setSuccessFeedback(msg);
    setTimeout(() => setSuccessFeedback(null), 5000);
  };

  const handleOpenCreateProduit = () => {
    setProduitToEdit(null);
    setIsProduitModalOpen(true);
  };

  const handleOpenEditProduit = (prod: StockProduit) => {
    setProduitToEdit(prod);
    setIsProduitModalOpen(true);
  };

  const handleDeleteProduit = async (prod: StockProduit) => {
    const ok = window.confirm(`Voulez-vous vraiment supprimer le produit "${prod.nom}" (${prod.unite}) ainsi que son historique de mouvements ?`);
    if (!ok) return;

    setDeletingId(prod.id);
    try {
      const res = await deleteProduit(prod.id);
      if (!res.success) {
        throw new Error(res.error || 'Erreur lors de la suppression.');
      }
      triggerSuccessFeedback(res.message || `Produit "${prod.nom}" supprimé.`);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de la suppression.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenEntree = (produitId?: string) => {
    setSelectedProduitForModal(produitId || null);
    setIsEntreeModalOpen(true);
  };

  const handleOpenSortie = (produitId?: string) => {
    setSelectedProduitForModal(produitId || null);
    setIsSortieModalOpen(true);
  };

  const handleOpenHistorique = (produitId?: string) => {
    setSelectedProduitForModal(produitId || null);
    setIsHistoriqueModalOpen(true);
  };

  // Chargement des données
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [syntheseRes, mouvementsRes] = await Promise.all([
        getStockSynthese(),
        getMouvements(),
      ]);

      if (syntheseRes.success) {
        setProduits(syntheseRes.produits);
        setKpis(syntheseRes.kpis);
      } else {
        setErrorMessage(syntheseRes.error || 'Erreur chargement stock.');
      }

      if (mouvementsRes.success) {
        setMouvements(mouvementsRes.mouvements);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Erreur réseau lors du chargement.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Liste unique des unités disponibles
  const availableUnites = useMemo(() => {
    const set = new Set<string>();
    produits.forEach((p) => {
      if (p.produit.unite) set.add(p.produit.unite);
    });
    return Array.from(set).sort();
  }, [produits]);

  // Produits filtrés et triés
  const filteredProduits = useMemo(() => {
    return produits
      .filter((p) => {
        if (searchQuery) {
          const q = searchQuery.toLowerCase().trim();
          const matchNom = p.produit.nom.toLowerCase().includes(q);
          const matchUnite = p.produit.unite.toLowerCase().includes(q);
          if (!matchNom && !matchUnite) return false;
        }

        if (selectedUnite !== 'ALL' && p.produit.unite !== selectedUnite) {
          return false;
        }

        if (selectedEtat !== 'ALL' && p.etat !== selectedEtat) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === 'nom') {
          diff = a.produit.nom.localeCompare(b.produit.nom);
        } else if (sortField === 'stock') {
          diff = a.stock_actuel - b.stock_actuel;
        } else if (sortField === 'etat') {
          const weight: Record<StockEtat, number> = {
            RUPTURE: 0,
            STOCK_FAIBLE: 1,
            DISPONIBLE: 2,
          };
          diff = weight[a.etat] - weight[b.etat];
        }
        return sortAsc ? diff : -diff;
      });
  }, [produits, searchQuery, selectedUnite, selectedEtat, sortField, sortAsc]);

  // Si l'utilisateur n'est pas admin, écran bloqué
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 bg-white rounded-3xl border border-red-200 text-center shadow-lg">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-slate-900 mb-2">Accès Restreint</h2>
        <p className="text-sm text-slate-600 mb-4">
          Le module <strong>STOCK PRO</strong> est strictement réservé à l'Administrateur de l'exploitation.
        </p>
        <span className="inline-block px-3 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-lg border border-red-200">
          Rôle Caporal non autorisé
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      {/* ================= HEADER & ACTIONS ================= */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-5 shadow-xl border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
                <Package className="w-5 h-5 text-indigo-300" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
                  STOCK PRO
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Officiel
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  Gestion centralisée, transactions sécurisées & traçabilité agricole
                </p>
              </div>
            </div>
          </div>

          {/* Boutons d'action principaux */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenCreateProduit}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-xl transition shadow-sm active:scale-95 cursor-pointer"
              title="Ajouter un nouveau produit manuellement au catalogue"
            >
              <Plus className="w-4 h-4" />
              <span>+ Nouveau Produit</span>
            </button>

            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition shadow-sm active:scale-95 cursor-pointer"
              title="Importer le stock initial depuis Excel (3 colonnes)"
            >
              <Upload className="w-4 h-4" />
              <span>Import Excel</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenEntree()}
              disabled={produits.length === 0}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black rounded-xl transition shadow-sm active:scale-95 cursor-pointer ${
                produits.length === 0
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ Entrée</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenSortie()}
              disabled={produits.length === 0}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-black rounded-xl transition shadow-sm active:scale-95 cursor-pointer ${
                produits.length === 0
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              <MinusCircle className="w-4 h-4" />
              <span>- Sortie</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHistoriqueModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition active:scale-95 cursor-pointer border border-slate-700"
            >
              <History className="w-4 h-4 text-slate-400" />
              <span>Historique</span>
            </button>

            {/* Menu Exports Excel */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition active:scale-95 cursor-pointer border border-slate-700"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Exports Excel</span>
              </button>

              {showExportMenu && (
                <div
                  className="absolute right-0 mt-2 w-56 bg-white text-slate-800 rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95 duration-100"
                  onClick={() => setShowExportMenu(false)}
                >
                  <button
                    type="button"
                    onClick={() => exportEtatStockExcel(produits)}
                    className="w-full text-left px-4 py-2 text-xs font-semibold hover:bg-slate-100 flex items-center justify-between"
                  >
                    <span>1. État Actuel du Stock</span>
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportSyntheseQuantitesExcel(produits)}
                    className="w-full text-left px-4 py-2 text-xs font-semibold hover:bg-slate-100 flex items-center justify-between"
                  >
                    <span>2. Synthèse par Produit</span>
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportHistoriqueExcel(mouvements)}
                    className="w-full text-left px-4 py-2 text-xs font-semibold hover:bg-slate-100 flex items-center justify-between"
                  >
                    <span>3. Historique Mouvements</span>
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    type="button"
                    onClick={() => exportSortiesParDomaineExcel(mouvements)}
                    className="w-full text-left px-4 py-2 text-xs font-semibold hover:bg-slate-100 flex items-center justify-between"
                  >
                    <span>4. Sorties par Domaine</span>
                    <Download className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              )}
            </div>

            {/* Réinitialiser Catalogue */}
            <button
              type="button"
              onClick={() => setIsResetModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-2 bg-red-950/60 hover:bg-red-900 text-red-300 text-xs font-bold rounded-xl transition border border-red-800/60 active:scale-95 cursor-pointer ml-auto sm:ml-0"
              title="Vider et réinitialiser complètement le catalogue de produits et le stock"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Réinitialiser</span>
            </button>
            {/* Rafraîchir */}
            <button
              type="button"
              onClick={loadData}
              disabled={isLoading}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition active:scale-95 cursor-pointer border border-slate-700"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Bannière de confirmation d'action */}
      {successFeedback && (
        <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-3 text-emerald-950 font-bold text-xs flex items-center gap-2 animate-in fade-in duration-200 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{successFeedback}</span>
        </div>
      )}

      {/* Message d'erreur éventuel */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2 text-xs text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span className="flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-600 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* ================= CARTES KPI ================= */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {/* Total Produits */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Produits</span>
            <Boxes className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-xl font-black text-slate-900">{kpis.totalProduits}</div>
          <span className="text-[10px] text-slate-400 mt-0.5">catalogués</span>
        </div>

        {/* Total Entrées */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Entrées</span>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-black text-blue-700">
            {kpis.totalEntrees.toLocaleString('fr-FR')}
          </div>
          <span className="text-[10px] text-slate-400 mt-0.5">cumul global</span>
        </div>

        {/* Total Sorties */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Sorties</span>
            <TrendingDown className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-700">
            {kpis.totalSorties.toLocaleString('fr-FR')}
          </div>
          <span className="text-[10px] text-slate-400 mt-0.5">consommées</span>
        </div>

        {/* Stock Faible */}
        <button
          type="button"
          onClick={() => setSelectedEtat(selectedEtat === 'STOCK_FAIBLE' ? 'ALL' : 'STOCK_FAIBLE')}
          className={`p-3 rounded-2xl border transition text-left cursor-pointer ${
            selectedEtat === 'STOCK_FAIBLE'
              ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-amber-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between text-amber-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Stock Faible</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-700">{kpis.produitsStockFaible}</div>
          <span className="text-[10px] text-amber-600 font-semibold mt-0.5">≤ seuil d'alerte</span>
        </button>

        {/* Rupture */}
        <button
          type="button"
          onClick={() => setSelectedEtat(selectedEtat === 'RUPTURE' ? 'ALL' : 'RUPTURE')}
          className={`p-3 rounded-2xl border transition text-left cursor-pointer col-span-2 sm:col-span-1 ${
            selectedEtat === 'RUPTURE'
              ? 'bg-red-100 border-red-400 ring-2 ring-red-400 shadow-xs'
              : 'bg-white border-slate-200 hover:border-red-300 shadow-xs'
          }`}
        >
          <div className="flex items-center justify-between text-red-600 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Rupture</span>
            <AlertCircle className="w-4 h-4 text-red-500" />
          </div>
          <div className="text-xl font-black text-red-700">{kpis.produitsRupture}</div>
          <span className="text-[10px] text-red-600 font-semibold mt-0.5">épuisé (≤ 0)</span>
        </button>
      </div>

      {/* ================= BARRE DE RECHERCHE & FILTRES ================= */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs space-y-2.5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {/* Champ recherche */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un produit (ex: ENGRAIS, ACIDE, AMONIX...)"
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:bg-white focus:border-indigo-500 focus:outline-none transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtre Unité */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedUnite}
              onChange={(e) => setSelectedUnite(e.target.value)}
              className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">Toutes Unités</option>
              {availableUnites.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Tri */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (sortField === 'nom') setSortAsc(!sortAsc);
                else {
                  setSortField('nom');
                  setSortAsc(true);
                }
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition ${
                sortField === 'nom'
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              Nom {sortField === 'nom' ? (sortAsc ? '↑' : '↓') : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                if (sortField === 'stock') setSortAsc(!sortAsc);
                else {
                  setSortField('stock');
                  setSortAsc(false); // Par défaut plus grand d'abord
                }
              }}
              className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition ${
                sortField === 'stock'
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'bg-slate-50 border-slate-200 text-slate-600'
              }`}
            >
              Stock {sortField === 'stock' ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          </div>
        </div>

        {/* Onglets Filtre État */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100">
          <span className="text-[10px] font-bold uppercase text-slate-400 shrink-0">État :</span>
          <button
            type="button"
            onClick={() => setSelectedEtat('ALL')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
              selectedEtat === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tous ({produits.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedEtat('DISPONIBLE')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
              selectedEtat === 'DISPONIBLE'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            Disponible
          </button>
          <button
            type="button"
            onClick={() => setSelectedEtat('STOCK_FAIBLE')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
              selectedEtat === 'STOCK_FAIBLE'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Stock Faible ({kpis.produitsStockFaible})
          </button>
          <button
            type="button"
            onClick={() => setSelectedEtat('RUPTURE')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition shrink-0 ${
              selectedEtat === 'RUPTURE'
                ? 'bg-red-600 text-white'
                : 'bg-red-50 text-red-700 hover:bg-red-100'
            }`}
          >
            Rupture ({kpis.produitsRupture})
          </button>
        </div>
      </div>

      {/* ================= CATALOGUE PRODUITS ================= */}
      {filteredProduits.length === 0 ? (
        <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center space-y-4">
          <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-3xl flex items-center justify-center mx-auto">
            <Package className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900">
              {produits.length === 0 ? 'Catalogue Stock Pro actuellement vide' : 'Aucun produit correspondant aux filtres'}
            </h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
              {produits.length === 0
                ? 'Vous pouvez repartir de zéro : ajouter des produits manuellement ou importer une nouvelle liste complète depuis Excel (NOM PRODUIT | UNITE | QTE).'
                : 'Essayez de réinitialiser la recherche ou le filtre d\'état.'}
            </p>
          </div>
          {produits.length === 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleOpenCreateProduit}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-xl transition shadow-md active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Ajouter un Produit Manuellement</span>
              </button>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black rounded-xl transition shadow-md active:scale-95 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Importer une Liste Excel</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Vue Tableau pour Desktop / Tablette */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="py-3 px-4">Produit</th>
                  <th className="py-3 px-3 text-center">Unité</th>
                  <th className="py-3 px-3 text-right">Stock Initial</th>
                  <th className="py-3 px-3 text-right text-blue-700">Entrées</th>
                  <th className="py-3 px-3 text-right text-amber-700">Sorties</th>
                  <th className="py-3 px-4 text-right">Stock Actuel</th>
                  <th className="py-3 px-3 text-center">État</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredProduits.map((p) => {
                  const isRupture = p.etat === 'RUPTURE';
                  const isFaible = p.etat === 'STOCK_FAIBLE';
                  const isDeleting = deletingId === p.produit.id;

                  return (
                    <tr
                      key={p.produit.id}
                      className={`hover:bg-slate-50/70 transition ${
                        isRupture ? 'bg-red-50/30' : isFaible ? 'bg-amber-50/20' : ''
                      }`}
                    >
                      {/* Nom Produit */}
                      <td className="py-3 px-4">
                        <div className="font-black text-slate-900 tracking-tight">
                          {p.produit.nom}
                        </div>
                        {p.produit.seuil_minimum > 0 && (
                          <div className="text-[10px] text-slate-400">
                            Seuil min : {p.produit.seuil_minimum} {p.produit.unite}
                          </div>
                        )}
                      </td>

                      {/* Unité */}
                      <td className="py-3 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-black uppercase border border-slate-200">
                          {p.produit.unite}
                        </span>
                      </td>

                      {/* Initial */}
                      <td className="py-3 px-3 text-right font-medium text-slate-600">
                        {p.stock_initial.toLocaleString('fr-FR')}
                      </td>

                      {/* Entrées */}
                      <td className="py-3 px-3 text-right font-bold text-blue-600">
                        +{p.total_entrees.toLocaleString('fr-FR')}
                      </td>

                      {/* Sorties */}
                      <td className="py-3 px-3 text-right font-bold text-amber-600">
                        -{p.total_sorties.toLocaleString('fr-FR')}
                      </td>

                      {/* Stock Actuel */}
                      <td className="py-3 px-4 text-right">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-xl text-sm font-black ${
                            isRupture
                              ? 'bg-red-100 text-red-700 border border-red-300 ring-1 ring-red-200'
                              : isFaible
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                          }`}
                        >
                          {p.stock_actuel.toLocaleString('fr-FR')} {p.produit.unite}
                        </span>
                      </td>

                      {/* État Badge */}
                      <td className="py-3 px-3 text-center">
                        {isRupture ? (
                           <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-700 border border-red-200 shadow-xs">
                            <AlertCircle className="w-3 h-3 text-red-600" />
                            Rupture
                          </span>
                        ) : isFaible ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Stock Faible
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Disponible
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isRupture ? (
                            <button
                              type="button"
                              onClick={() => handleOpenEntree(p.produit.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black shadow-xs transition active:scale-95 cursor-pointer"
                              title="Réapprovisionner immédiatement"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Entrée</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleOpenEntree(p.produit.id)}
                              className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition cursor-pointer"
                              title="Ajouter une Entrée (+)"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isRupture}
                            onClick={() => handleOpenSortie(p.produit.id)}
                            className={`p-1.5 rounded-lg transition ${
                              isRupture
                                ? 'bg-slate-100 text-slate-300 cursor-not-allowed opacity-40'
                                : 'bg-amber-50 hover:bg-amber-100 text-amber-700 cursor-pointer'
                            }`}
                            title={isRupture ? 'Sortie impossible : stock épuisé' : 'Enregistrer une Sortie (-)'}
                          >
                            <MinusCircle className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenHistorique(p.produit.id)}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition cursor-pointer"
                            title="Historique des mouvements"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>

                          {/* Modifier Produit */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditProduit(p.produit)}
                            className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition cursor-pointer"
                            title="Modifier ce produit (Nom, Unité, Seuil)"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Supprimer Produit */}
                          <button
                            type="button"
                            disabled={isDeleting}
                            onClick={() => handleDeleteProduit(p.produit)}
                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition cursor-pointer disabled:opacity-50"
                            title="Supprimer ce produit du catalogue"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pied de tableau consolidé */}
          <div className="bg-slate-50 p-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-semibold">
                Affichage de {filteredProduits.length} produit(s) sur {produits.length}
              </span>
              <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-bold">
                Catalogue conservé définitivement
              </span>
            </div>
            <div className="flex items-center gap-3 font-bold text-slate-700">
              <span className="text-blue-600">Total Entrées : {kpis.totalEntrees.toLocaleString('fr-FR')}</span>
              <span>•</span>
              <span className="text-amber-600">Total Sorties : {kpis.totalSorties.toLocaleString('fr-FR')}</span>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODALES STOCK PRO ================= */}
      <StockProImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingProduits={produits}
        onImportSuccess={() => {
          setIsImportModalOpen(false);
          loadData();
        }}
      />

      <StockProEntreeModal
        isOpen={isEntreeModalOpen}
        onClose={() => {
          setIsEntreeModalOpen(false);
          setSelectedProduitForModal(null);
        }}
        produits={produits}
        initialProduitId={selectedProduitForModal}
        onRequestRefreshStock={loadData}
        onEntreeSuccess={() => {
          setIsEntreeModalOpen(false);
          setSelectedProduitForModal(null);
          loadData();
        }}
      />

      <StockProSortieModal
        isOpen={isSortieModalOpen}
        onClose={() => {
          setIsSortieModalOpen(false);
          setSelectedProduitForModal(null);
        }}
        produits={produits}
        initialProduitId={selectedProduitForModal}
        onRequestRefreshStock={loadData}
        onSortieSuccess={() => {
          setIsSortieModalOpen(false);
          setSelectedProduitForModal(null);
          loadData();
        }}
      />

      <StockProHistoriqueModal
        isOpen={isHistoriqueModalOpen}
        onClose={() => {
          setIsHistoriqueModalOpen(false);
          setSelectedProduitForModal(null);
        }}
        mouvements={mouvements}
        produits={produits}
        initialProduitId={selectedProduitForModal}
        onCorrectionSuccess={() => {
          loadData();
        }}
      />

      {/* Modal Création & Modification de Produit */}
      <StockProProduitModal
        isOpen={isProduitModalOpen}
        onClose={() => {
          setIsProduitModalOpen(false);
          setProduitToEdit(null);
        }}
        produitToEdit={produitToEdit}
        onSuccess={(msg) => {
          triggerSuccessFeedback(msg);
          loadData();
        }}
      />

      {/* Modal Purge & Réinitialisation sécurisée */}
      <StockProResetModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        produitsCount={produits.length}
        onSuccess={(msg) => {
          triggerSuccessFeedback(msg);
          loadData();
        }}
      />
    </div>
  );
};
