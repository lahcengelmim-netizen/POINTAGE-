/**
 * Tableau de bord Récolte Administrateur (Lahcen Pointeur)
 * - Vue consolidée et fidèle de toutes les récoltes de tous les caporaux
 * - Indicateurs clés (Caisses, Ouvriers, Serres, Enregistrements, Caporaux)
 * - Récapitulatif par ouvrier (Matrice dynamique : Ouvrier x Serres avec Cumul strict)
 * - Récapitulatif par serre (Serre, Nombre d'ouvriers, Total caisses)
 * - Récapitulatif par caporal
 * - Journal détaillé des enregistrements unitaires
 * - Filtres date du jour / période, serre, ouvrier, caporal
 * - Export Excel complet multi-feuilles avec SheetJS
 * - Partage WhatsApp
 * - Gestion complète des serres
 */

import React, { useState, useMemo } from 'react';
import {
  FileSpreadsheet,
  Share2,
  Calendar,
  Filter,
  Plus,
  Edit2,
  Trash2,
  Layers,
  Users,
  Award,
  CheckCircle2,
  X,
  Search,
  ArrowUpDown,
  Table,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { RecolteEntry, Serre, Ouvrier, UserAccount } from '../types';

interface RecolteAdminDashboardProps {
  recoltes: RecolteEntry[];
  serres: Serre[];
  ouvriers: Ouvrier[];
  users: UserAccount[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onSaveSerre: (data: { id?: string; code: string; nom: string; actif?: boolean }) => {
    success: boolean;
    error?: string;
    serre?: Serre;
  };
  onDeleteSerre: (id: string) => { success: boolean; error?: string };
  onToggleSerreActif: (id: string) => void;
  onDeleteRecolte: (id: string) => { success: boolean; error?: string };
}

export const RecolteAdminDashboard: React.FC<RecolteAdminDashboardProps> = ({
  recoltes,
  serres,
  ouvriers,
  users,
  selectedDate,
  onSelectDate,
  onSaveSerre,
  onDeleteSerre,
  onToggleSerreActif,
  onDeleteRecolte,
}) => {
  // Mode de date : 'unique' (jour précis) ou 'periode' (du ... au ...)
  const [dateMode, setDateMode] = useState<'unique' | 'periode'>('unique');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);

  // Filtres
  const [filterSerreId, setFilterSerreId] = useState<string>('all');
  const [filterOuvrierId, setFilterOuvrierId] = useState<string>('all');
  const [filterCaporalId, setFilterCaporalId] = useState<string>('all');
  const [searchOuvrierTable, setSearchOuvrierTable] = useState<string>('');

  // Sous-onglet de vue : 'matrice_ouvriers' | 'serres' | 'caporals' | 'detail' | 'config_serres'
  const [subView, setSubView] = useState<
    'matrice_ouvriers' | 'serres' | 'caporals' | 'detail' | 'config_serres'
  >('matrice_ouvriers');

  // Modale Gestion Serre
  const [showSerreModal, setShowSerreModal] = useState(false);
  const [editingSerre, setEditingSerre] = useState<Serre | null>(null);
  const [serreCodeInput, setSerreCodeInput] = useState('');
  const [serreNomInput, setSerreNomInput] = useState('');
  const [serreError, setSerreError] = useState<string | null>(null);
  const [serreSuccess, setSerreSuccess] = useState<string | null>(null);

  // Message toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtrage des enregistrements selon la sélection de période et de filtres
  const filteredRecoltes = useMemo(() => {
    let list = recoltes;

    if (dateMode === 'unique') {
      list = list.filter((r) => r.date === selectedDate);
    } else {
      if (startDate && endDate) {
        list = list.filter((r) => r.date >= startDate && r.date <= endDate);
      }
    }

    if (filterSerreId !== 'all') {
      list = list.filter((r) => r.serre_id === filterSerreId);
    }
    if (filterOuvrierId !== 'all') {
      list = list.filter((r) => r.ouvrier_id === filterOuvrierId);
    }
    if (filterCaporalId !== 'all') {
      list = list.filter((r) => r.created_by_id === filterCaporalId);
    }

    return list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [recoltes, dateMode, selectedDate, startDate, endDate, filterSerreId, filterOuvrierId, filterCaporalId]);

  // Indicateurs globaux en haut du tableau de bord
  const globalStats = useMemo(() => {
    let totalCaisses = 0;
    const ouvriersSet = new Set<string>();
    const serresSet = new Set<string>();
    const caporalsSet = new Set<string>();

    for (const r of filteredRecoltes) {
      totalCaisses += Number(r.caisses) || 0;
      ouvriersSet.add(r.ouvrier_id);
      if (r.serre_id) serresSet.add(r.serre_id);
      if (r.created_by_id) caporalsSet.add(r.created_by_id);
    }

    return {
      totalCaisses: Math.round(totalCaisses * 10) / 10,
      totalOuvriers: ouvriersSet.size,
      totalSerres: serresSet.size,
      totalEntries: filteredRecoltes.length,
      totalCaporals: caporalsSet.size,
    };
  }, [filteredRecoltes]);

  // Liste des serres réellement exploitées dans les données filtrées (ordonnées)
  const usedSerres = useMemo(() => {
    const serreMap = new Map<string, { id: string; code: string; nom: string }>();

    // D'abord les serres de la configuration qui ont des récoltes
    for (const s of serres) {
      if (filteredRecoltes.some((r) => r.serre_id === s.id)) {
        serreMap.set(s.id, { id: s.id, code: s.code, nom: s.nom });
      }
    }

    // Puis d'éventuelles serres nommées dans les récoltes sans correspondance
    for (const r of filteredRecoltes) {
      if (r.serre_id && !serreMap.has(r.serre_id)) {
        serreMap.set(r.serre_id, {
          id: r.serre_id,
          code: r.serre_nom?.slice(0, 4) || 'S',
          nom: r.serre_nom || 'Serre',
        });
      }
    }

    // Si aucune récolte, afficher au moins les serres actives configurées
    if (serreMap.size === 0) {
      serres.filter((s) => s.actif).forEach((s) => {
        serreMap.set(s.id, { id: s.id, code: s.code, nom: s.nom });
      });
    }

    return Array.from(serreMap.values());
  }, [serres, filteredRecoltes]);

  // MATRICE DYNAMIQUE PAR OUVRIER :
  // Chaque ouvrier n'apparaît qu'UNE SEULE FOIS, avec cumul par serre et total général
  const matrixByOuvrier = useMemo(() => {
    const ouvrierMap = new Map<
      string,
      {
        ouvrier_id: string;
        numero: number;
        nom: string;
        serresMap: Map<string, number>; // serre_id -> caisses cumulées
        totalCaisses: number;
        passagesCount: number;
      }
    >();

    for (const r of filteredRecoltes) {
      if (!ouvrierMap.has(r.ouvrier_id)) {
        ouvrierMap.set(r.ouvrier_id, {
          ouvrier_id: r.ouvrier_id,
          numero: r.numero_ouvrier,
          nom: r.nom_ouvrier,
          serresMap: new Map(),
          totalCaisses: 0,
          passagesCount: 0,
        });
      }

      const row = ouvrierMap.get(r.ouvrier_id)!;
      const currentSerreCaisses = row.serresMap.get(r.serre_id) || 0;
      const qty = Number(r.caisses) || 0;

      row.serresMap.set(r.serre_id, Math.round((currentSerreCaisses + qty) * 10) / 10);
      row.totalCaisses = Math.round((row.totalCaisses + qty) * 10) / 10;
      row.passagesCount += 1;
    }

    let result = Array.from(ouvrierMap.values());

    // Filtrage par texte de recherche éventuel
    if (searchOuvrierTable.trim()) {
      const q = searchOuvrierTable.trim().toLowerCase();
      result = result.filter(
        (row) => row.numero.toString().includes(q) || row.nom.toLowerCase().includes(q)
      );
    }

    // Tri par défaut par total caisses décroissant
    return result.sort((a, b) => b.totalCaisses - a.totalCaisses || a.numero - b.numero);
  }, [filteredRecoltes, searchOuvrierTable]);

  // Totaux par colonne de serre pour la ligne de pied de tableau
  const matrixColumnTotals = useMemo(() => {
    const colTotals = new Map<string, number>();
    for (const s of usedSerres) {
      colTotals.set(s.id, 0);
    }

    for (const row of matrixByOuvrier) {
      for (const [serreId, caisses] of row.serresMap.entries()) {
        const current = colTotals.get(serreId) || 0;
        colTotals.set(serreId, Math.round((current + caisses) * 10) / 10);
      }
    }

    return colTotals;
  }, [usedSerres, matrixByOuvrier]);

  // Groupement par Serre
  const recolteBySerre = useMemo(() => {
    const map = new Map<
      string,
      {
        serre_id: string;
        serre_nom: string;
        totalCaisses: number;
        distinctWorkers: Set<string>;
        operationsCount: number;
      }
    >();

    for (const r of filteredRecoltes) {
      const key = r.serre_id || 'inconnu';
      if (!map.has(key)) {
        map.set(key, {
          serre_id: key,
          serre_nom: r.serre_nom || 'Serre',
          totalCaisses: 0,
          distinctWorkers: new Set(),
          operationsCount: 0,
        });
      }
      const entry = map.get(key)!;
      entry.totalCaisses = Math.round((entry.totalCaisses + (Number(r.caisses) || 0)) * 10) / 10;
      entry.distinctWorkers.add(r.ouvrier_id);
      entry.operationsCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => b.totalCaisses - a.totalCaisses);
  }, [filteredRecoltes]);

  // Groupement par Caporal
  const recolteByCaporal = useMemo(() => {
    const map = new Map<
      string,
      {
        caporal_id: string;
        caporal_nom: string;
        totalCaisses: number;
        operationsCount: number;
        distinctWorkers: Set<string>;
      }
    >();

    for (const r of filteredRecoltes) {
      const key = r.created_by_id || 'inconnu';
      if (!map.has(key)) {
        map.set(key, {
          caporal_id: key,
          caporal_nom: r.created_by_nom || 'Caporal',
          totalCaisses: 0,
          operationsCount: 0,
          distinctWorkers: new Set(),
        });
      }
      const c = map.get(key)!;
      c.totalCaisses = Math.round((c.totalCaisses + (Number(r.caisses) || 0)) * 10) / 10;
      c.operationsCount += 1;
      c.distinctWorkers.add(r.ouvrier_id);
    }

    return Array.from(map.values()).sort((a, b) => b.totalCaisses - a.totalCaisses);
  }, [filteredRecoltes]);

  // ------------------------- GÉNÉRATION MESSAGE WHATSAPP -------------------------

  const generateRecolteWhatsAppText = (): string => {
    const dateLabel =
      dateMode === 'unique'
        ? selectedDate.split('-').reverse().join('/')
        : `Du ${startDate.split('-').reverse().join('/')} au ${endDate.split('-').reverse().join('/')}`;

    const lines: string[] = [];
    lines.push('🍇 *RÉCAPITULATIF RÉCOLTE — LAHCEN POINTEUR*');
    lines.push(`📅 *Date :* ${dateLabel}`);
    lines.push('----------------------------------------');
    lines.push('');

    // Récapitulatif par ouvrier (cumuls)
    lines.push('*RÉCAPITULATIF PAR OUVRIER :*');
    matrixByOuvrier.forEach((row, idx) => {
      const serresDetails = Array.from(row.serresMap.entries())
        .map(([sid, qty]) => {
          const sObj = usedSerres.find((s) => s.id === sid);
          return `${sObj?.nom || 'Serre'}: ${qty}c`;
        })
        .join(', ');

      lines.push(
        `${idx + 1}. *#${row.numero} ${row.nom}* : *${row.totalCaisses} caisses* (${serresDetails})`
      );
    });
    lines.push('');

    // Récapitulatif par serre
    lines.push('----------------------------------------');
    lines.push('*RÉCAPITULATIF PAR SERRE :*');
    recolteBySerre.forEach((s) => {
      lines.push(
        `• *${s.serre_nom}* : ${s.totalCaisses} caisses (${s.distinctWorkers.size} ouvrier(s))`
      );
    });
    lines.push('');

    // Totaux finaux
    lines.push('----------------------------------------');
    lines.push('📊 *TOTAUX GÉNÉRAUX :*');
    lines.push(`• Total Caisses : *${globalStats.totalCaisses} caisses*`);
    lines.push(`• Ouvriers ayant récolté : *${globalStats.totalOuvriers} ouvriers*`);
    lines.push(`• Serres exploitées : *${globalStats.totalSerres} serres*`);
    lines.push(`• Total enregistrements : *${globalStats.totalEntries} passages*`);

    return lines.join('\n');
  };

  const handleShareWhatsApp = () => {
    const text = generateRecolteWhatsAppText();
    const encoded = encodeURIComponent(text);
    const url = `https://wa.me/?text=${encoded}`;

    if (navigator.share) {
      navigator
        .share({ title: 'Récapitulatif Récolte', text })
        .catch(() => {
          window.open(url, '_blank');
        });
    } else {
      window.open(url, '_blank');
    }
  };

  // ------------------------- EXPORT EXCEL (SHEETJS) -------------------------

  const handleExportExcel = () => {
    if (filteredRecoltes.length === 0) {
      alert('Aucune donnée de récolte à exporter pour la sélection.');
      return;
    }

    const workbook = XLSX.utils.book_new();

    // FEUILLE 1 : Matrice par Ouvrier (Ouvrier x Serres)
    const matrixRows = matrixByOuvrier.map((row) => {
      const rowObj: Record<string, any> = {
        'N° Ouvrier': row.numero,
        'Nom Ouvrier': row.nom,
      };

      for (const s of usedSerres) {
        rowObj[s.nom] = row.serresMap.get(s.id) || 0;
      }

      rowObj['Total Caisses'] = row.totalCaisses;
      rowObj['Nb Passages'] = row.passagesCount;
      return rowObj;
    });

    // Ligne de total
    const totalRowObj: Record<string, any> = {
      'N° Ouvrier': 'TOTAL',
      'Nom Ouvrier': `${matrixByOuvrier.length} ouvrier(s)`,
    };
    for (const s of usedSerres) {
      totalRowObj[s.nom] = matrixColumnTotals.get(s.id) || 0;
    }
    totalRowObj['Total Caisses'] = globalStats.totalCaisses;
    totalRowObj['Nb Passages'] = globalStats.totalEntries;
    matrixRows.push(totalRowObj);

    const wsMatrix = XLSX.utils.json_to_sheet(matrixRows);
    XLSX.utils.book_append_sheet(workbook, wsMatrix, 'Récapitulatif Ouvriers');

    // FEUILLE 2 : Récapitulatif par Serre
    const serreRows = recolteBySerre.map((s) => ({
      Serre: s.serre_nom,
      'Ouvriers Distincts': s.distinctWorkers.size,
      'Total Caisses': s.totalCaisses,
      'Nb Passages': s.operationsCount,
    }));
    serreRows.push({
      Serre: 'TOTAL',
      'Ouvriers Distincts': globalStats.totalOuvriers,
      'Total Caisses': globalStats.totalCaisses,
      'Nb Passages': globalStats.totalEntries,
    });
    const wsSerres = XLSX.utils.json_to_sheet(serreRows);
    XLSX.utils.book_append_sheet(workbook, wsSerres, 'Récapitulatif Serres');

    // FEUILLE 3 : Détail complet de toutes les saisies
    const detailRows = filteredRecoltes.map((r) => ({
      Date: r.date,
      Heure: new Date(r.created_at).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      'N° Ouvrier': r.numero_ouvrier,
      'Nom Ouvrier': r.nom_ouvrier,
      Serre: r.serre_nom,
      Caisses: r.caisses,
      Caporal: r.created_by_nom,
      Notes: r.notes || '',
    }));
    const wsDetail = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(workbook, wsDetail, 'Journal Détail');

    const fileName =
      dateMode === 'unique'
        ? `recolte-lahcen-${selectedDate}.xlsx`
        : `recolte-lahcen-${startDate}_au_${endDate}.xlsx`;

    XLSX.writeFile(workbook, fileName);
    setToastMessage(`✓ Fichier Excel "${fileName}" téléchargé avec succès.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // ------------------------- GESTION DES SERRES -------------------------

  const handleOpenAddSerre = () => {
    setEditingSerre(null);
    setSerreCodeInput(`S0${serres.length + 1}`);
    setSerreNomInput(`Serre ${serres.length + 1}`);
    setSerreError(null);
    setShowSerreModal(true);
  };

  const handleOpenEditSerre = (serre: Serre) => {
    setEditingSerre(serre);
    setSerreCodeInput(serre.code);
    setSerreNomInput(serre.nom);
    setSerreError(null);
    setShowSerreModal(true);
  };

  const handleSaveSerreSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSerreError(null);

    const res = onSaveSerre({
      id: editingSerre?.id,
      code: serreCodeInput.trim().toUpperCase(),
      nom: serreNomInput.trim(),
    });

    if (!res.success) {
      setSerreError(res.error || 'Erreur enregistrement serre.');
      return;
    }

    setSerreSuccess(editingSerre ? 'Serre modifiée !' : 'Nouvelle serre ajoutée !');
    setShowSerreModal(false);
    setTimeout(() => setSerreSuccess(null), 3000);
  };

  const handleDeleteSerreClick = (serre: Serre) => {
    if (window.confirm(`Supprimer la serre "${serre.nom}" (${serre.code}) ?`)) {
      onDeleteSerre(serre.id);
      setSerreSuccess(`Serre ${serre.nom} supprimée.`);
      setTimeout(() => setSerreSuccess(null), 3000);
    }
  };

  return (
    <div className="space-y-3 pb-24 animate-in fade-in">
      {/* En-tête Tableau de bord Admin */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center font-black shadow-xs">
            🍇
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <span>Supervision Récolte (Admin)</span>
            </h2>
            <p className="text-[10px] text-slate-500">
              Consolidation multi-caporaux et multi-serres
            </p>
          </div>
        </div>

        {/* Boutons d'export rapides */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleShareWhatsApp}
            className="flex items-center gap-1 bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-white text-[11px] font-black py-1.5 px-2.5 rounded-xl shadow-xs transition"
            title="Partager le récapitulatif par WhatsApp"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white text-[11px] font-black py-1.5 px-2.5 rounded-xl shadow-xs transition"
            title="Exporter en Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-2xl text-xs font-black flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 5 INDICATEURS EN HAUT DU TABLEAU DE BORD */}
      <div className="grid grid-cols-5 gap-1.5">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-emerald-700 font-bold uppercase block truncate">
            Caisses
          </span>
          <span className="text-base font-black text-emerald-950 font-mono">
            {globalStats.totalCaisses}
          </span>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-blue-700 font-bold uppercase block truncate">
            Ouvriers
          </span>
          <span className="text-base font-black text-blue-950 font-mono">
            {globalStats.totalOuvriers}
          </span>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-purple-700 font-bold uppercase block truncate">
            Serres
          </span>
          <span className="text-base font-black text-purple-950 font-mono">
            {globalStats.totalSerres}
          </span>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-amber-700 font-bold uppercase block truncate">
            Passages
          </span>
          <span className="text-base font-black text-amber-950 font-mono">
            {globalStats.totalEntries}
          </span>
        </div>

        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-indigo-700 font-bold uppercase block truncate">
            Caporaux
          </span>
          <span className="text-base font-black text-indigo-950 font-mono">
            {globalStats.totalCaporals}
          </span>
        </div>
      </div>

      {/* BARRE DE FILTRES : Période / Serre / Ouvrier / Caporal */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2.5">
        {/* Choix Date unique vs Période */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-xl text-[10px] font-black">
            <button
              type="button"
              onClick={() => setDateMode('unique')}
              className={`px-2.5 py-1 rounded-lg transition ${
                dateMode === 'unique' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Aujourd'hui
            </button>
            <button
              type="button"
              onClick={() => setDateMode('periode')}
              className={`px-2.5 py-1 rounded-lg transition ${
                dateMode === 'periode' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Période
            </button>
          </div>

          {dateMode === 'unique' ? (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-800 outline-none"
            />
          ) : (
            <div className="flex items-center gap-1 text-[11px] font-bold">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-1.5 py-1 text-[10px] font-bold"
              />
              <span className="text-slate-400">➔</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-1.5 py-1 text-[10px] font-bold"
              />
            </div>
          )}
        </div>

        {/* Filtres secondaires Serre, Ouvrier, Caporal */}
        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Serre :</label>
            <select
              value={filterSerreId}
              onChange={(e) => setFilterSerreId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="all">Toutes</option>
              {serres.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} - {s.nom}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Ouvrier :</label>
            <select
              value={filterOuvrierId}
              onChange={(e) => setFilterOuvrierId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="all">Tous</option>
              {ouvriers.map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.numero} {o.nom}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Caporal :</label>
            <select
              value={filterCaporalId}
              onChange={(e) => setFilterCaporalId(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl p-1.5 font-bold text-slate-800 outline-none"
            >
              <option value="all">Tous</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nom}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Navigation sous-vues */}
      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          type="button"
          onClick={() => setSubView('matrice_ouvriers')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'matrice_ouvriers'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          👤 Récap par Ouvrier ({matrixByOuvrier.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('serres')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'serres'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          🌿 Récap par Serre ({recolteBySerre.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('caporals')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'caporals'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          🌾 Par Caporal ({recolteByCaporal.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('detail')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'detail'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          📋 Journal Détail ({filteredRecoltes.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('config_serres')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'config_serres'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          ⚙️ Gérer Serres ({serres.length})
        </button>
      </div>

      {/* ===================== SOUS-VUE 1 : MATRICE RÉCAPITULATIF PAR OUVRIER ===================== */}
      {subView === 'matrice_ouvriers' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-slate-900 text-xs">
                Récapitulatif par Ouvrier (Cumul par serre)
              </h3>
              <p className="text-[10px] text-slate-500">
                Chaque ouvrier apparaît une seule fois avec toutes ses récoltes additionnées.
              </p>
            </div>

            {/* Champ de recherche rapide dans le tableau */}
            <div className="relative w-36">
              <input
                type="text"
                value={searchOuvrierTable}
                onChange={(e) => setSearchOuvrierTable(e.target.value)}
                placeholder="Filtrer nom/n°..."
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-1.5 pl-6 text-[10px] font-bold text-slate-800 outline-none"
              />
              <Search className="w-3 h-3 text-slate-400 absolute left-2 top-2" />
            </div>
          </div>

          {matrixByOuvrier.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-slate-50 rounded-xl">
              Aucune récolte enregistrée pour cette sélection.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 font-black text-slate-700 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3 text-left sticky left-0 bg-slate-50 z-10">Ouvrier</th>
                    {usedSerres.map((s) => (
                      <th key={s.id} className="py-2.5 px-2 text-center whitespace-nowrap">
                        {s.nom}
                      </th>
                    ))}
                    <th className="py-2.5 px-3 text-right text-emerald-900 bg-emerald-50 whitespace-nowrap">
                      Total Caisses
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white font-medium">
                  {matrixByOuvrier.map((row) => (
                    <tr key={row.ouvrier_id} className="hover:bg-slate-50 transition">
                      {/* Identité de l'ouvrier (fixée à gauche sur mobile) */}
                      <td className="py-2 px-3 text-left font-bold text-slate-900 sticky left-0 bg-white z-10 whitespace-nowrap border-r border-slate-100">
                        <span className="font-mono text-emerald-900 mr-1.5 font-black">
                          #{row.numero}
                        </span>
                        <span>{row.nom}</span>
                      </td>

                      {/* Colonnes dynamiques pour chaque serre */}
                      {usedSerres.map((s) => {
                        const qty = row.serresMap.get(s.id) || 0;
                        return (
                          <td
                            key={s.id}
                            className={`py-2 px-2 text-center font-mono text-xs ${
                              qty > 0 ? 'font-black text-slate-900 bg-emerald-50/30' : 'text-slate-300'
                            }`}
                          >
                            {qty > 0 ? qty : '—'}
                          </td>
                        );
                      })}

                      {/* Total général par ouvrier */}
                      <td className="py-2 px-3 text-right font-black font-mono text-xs text-emerald-800 bg-emerald-50/70">
                        {row.totalCaisses}
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* LIGNE DE PIED DE TABLEAU AVEC LES TOTAUX */}
                <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-black text-xs text-slate-900">
                  <tr>
                    <td className="py-2.5 px-3 text-left sticky left-0 bg-slate-100 z-10 whitespace-nowrap">
                      TOTAL ({matrixByOuvrier.length} ouvriers)
                    </td>
                    {usedSerres.map((s) => (
                      <td key={s.id} className="py-2.5 px-2 text-center font-mono">
                        {matrixColumnTotals.get(s.id) || 0}
                      </td>
                    ))}
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-950 bg-emerald-100 text-sm">
                      {globalStats.totalCaisses}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 2 : RÉCAPITULATIF PAR SERRE ===================== */}
      {subView === 'serres' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden p-3 space-y-2">
          <h3 className="font-black text-slate-900 text-xs">Récapitulatif par Serre</h3>

          {recolteBySerre.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-slate-50 rounded-xl">
              Aucune récolte enregistrée pour cette sélection.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 font-black text-slate-700 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-3 text-left">Serre</th>
                    <th className="py-2.5 px-3 text-center">Nombre d'Ouvriers</th>
                    <th className="py-2.5 px-3 text-center">Passages</th>
                    <th className="py-2.5 px-3 text-right text-emerald-900 bg-emerald-50">
                      Total Caisses
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {recolteBySerre.map((s) => (
                    <tr key={s.serre_id} className="hover:bg-slate-50 transition">
                      <td className="py-2 px-3 text-left font-black text-slate-900 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs">
                          🌿
                        </span>
                        <span>{s.serre_nom}</span>
                      </td>
                      <td className="py-2 px-3 text-center font-bold text-slate-700">
                        {s.distinctWorkers.size}
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-slate-500">
                        {s.operationsCount}
                      </td>
                      <td className="py-2 px-3 text-right font-black font-mono text-emerald-800 bg-emerald-50/50">
                        {s.totalCaisses} caisses
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-black text-xs text-slate-900">
                  <tr>
                    <td className="py-2.5 px-3 text-left">TOTAL GÉNÉRAL</td>
                    <td className="py-2.5 px-3 text-center">{globalStats.totalOuvriers}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{globalStats.totalEntries}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-emerald-950 bg-emerald-100 text-sm">
                      {globalStats.totalCaisses} caisses
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 3 : PAR CAPORAL ===================== */}
      {subView === 'caporals' && (
        <div className="space-y-2">
          {recolteByCaporal.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucun caporal n'a enregistré de récolte sur cette période.
            </p>
          ) : (
            recolteByCaporal.map((c) => (
              <div
                key={c.caporal_id}
                className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center text-xs font-black">
                      🌾
                    </span>
                    <div>
                      <h4 className="font-black text-slate-900 text-xs">{c.caporal_nom}</h4>
                      <p className="text-[10px] text-slate-500">
                        {c.operationsCount} saisie(s) • {c.distinctWorkers.size} ouvrier(s)
                      </p>
                    </div>
                  </div>

                  <span className="font-black text-emerald-800 text-xs bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl font-mono">
                    {c.totalCaisses} caisses
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 4 : JOURNAL DÉTAILLÉ DES PASSAGES ===================== */}
      {subView === 'detail' && (
        <div className="space-y-1.5">
          {filteredRecoltes.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucun enregistrement unitaire trouvé.
            </p>
          ) : (
            filteredRecoltes.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs flex items-center justify-between text-xs hover:border-slate-300 transition"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-black text-emerald-900 bg-emerald-100 px-1.5 py-0.5 rounded-md text-[10px]">
                      #{r.numero_ouvrier}
                    </span>
                    <span className="font-black text-slate-900">{r.nom_ouvrier}</span>
                    <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded-md font-bold">
                      {r.serre_nom}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {r.date} à{' '}
                    {new Date(r.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    • Saisi par {r.created_by_nom}
                    {r.notes ? ` • "${r.notes}"` : ''}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-emerald-800 text-xs bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                    {r.caisses} c.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Supprimer la saisie de ${r.caisses} caisse(s) pour #${r.numero_ouvrier} ${r.nom_ouvrier} (${r.serre_nom}) ?`
                        )
                      ) {
                        onDeleteRecolte(r.id);
                      }
                    }}
                    className="p-1 text-slate-300 hover:text-red-600 rounded-md transition"
                    title="Supprimer cette saisie"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 5 : CONFIGURATION DES SERRES ===================== */}
      {subView === 'config_serres' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-xs">
              Serres de l'exploitation ({serres.length}) :
            </h3>
            <button
              type="button"
              onClick={handleOpenAddSerre}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-1.5 px-3 rounded-xl shadow-xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Ajouter une Serre</span>
            </button>
          </div>

          <div className="space-y-1.5">
            {serres.map((s) => (
              <div
                key={s.id}
                className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-xl bg-purple-100 text-purple-900 font-mono font-black flex items-center justify-center text-xs">
                    {s.code}
                  </span>
                  <div>
                    <span className="font-black text-slate-900">{s.nom}</span>
                    {!s.actif && (
                      <span className="ml-2 text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-bold">
                        Désactivée
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleSerreActif(s.id)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition ${
                      s.actif
                        ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {s.actif ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEditSerre(s)}
                    className="p-1.5 text-slate-400 hover:text-emerald-700 rounded-lg transition"
                    title="Modifier"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSerreClick(s)}
                    className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODALE D'AJOUT / MODIFICATION DE SERRE */}
      {showSerreModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xs w-full p-4 shadow-2xl space-y-3 border border-slate-200 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="font-black text-slate-900 text-xs">
                {editingSerre ? 'Modifier la Serre' : 'Ajouter une Serre'}
              </h4>
              <button
                type="button"
                onClick={() => setShowSerreModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSerreSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Code court (ex: S01, S02) :
                </label>
                <input
                  type="text"
                  value={serreCodeInput}
                  onChange={(e) => setSerreCodeInput(e.target.value.toUpperCase())}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 font-mono font-black text-xs text-slate-900 outline-none focus:border-emerald-600 uppercase"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-700 block mb-1">
                  Nom complet (ex: Serre 1) :
                </label>
                <input
                  type="text"
                  value={serreNomInput}
                  onChange={(e) => setSerreNomInput(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 font-bold text-xs text-slate-900 outline-none focus:border-emerald-600"
                />
              </div>

              {serreError && (
                <p className="text-[10px] text-red-600 font-bold bg-red-50 p-2 rounded-lg">
                  {serreError}
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSerreModal(false)}
                  className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl font-bold text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-xl font-black text-xs shadow-xs"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
