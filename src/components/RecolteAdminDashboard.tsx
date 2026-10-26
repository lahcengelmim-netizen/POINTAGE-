/**
 * Tableau de bord Récolte Administrateur (Lahcen Pointeur)
 * - Vue consolidée de toutes les saisies de tous les caporals
 * - Synthèse par Serre, par Ouvrier, et par Caporal
 * - Filtres par période (date début/fin), serre, ouvrier et caporal
 * - Export Excel (.xlsx) complet avec SheetJS
 * - Partage WhatsApp au format exact spécifié
 * - Gestion des Serres (ajouter, modifier, activer/désactiver)
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
  ChevronDown,
  ChevronUp,
  Download,
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

  // Sous-onglet de vue : 'serres' | 'ouvriers' | 'caporals' | 'detail' | 'config_serres'
  const [subView, setSubView] = useState<
    'serres' | 'ouvriers' | 'caporals' | 'detail' | 'config_serres'
  >('serres');

  // Modale Gestion Serre
  const [showSerreModal, setShowSerreModal] = useState(false);
  const [editingSerre, setEditingSerre] = useState<Serre | null>(null);
  const [serreCodeInput, setSerreCodeInput] = useState('');
  const [serreNomInput, setSerreNomInput] = useState('');
  const [serreError, setSerreError] = useState<string | null>(null);
  const [serreSuccess, setSerreSuccess] = useState<string | null>(null);

  // Message toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filtrage des enregistrements selon la sélection
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

  // Totaux globaux
  const globalStats = useMemo(() => {
    let totalCaisses = 0;
    const ouvriersSet = new Set<string>();
    const serresSet = new Set<string>();
    const caporalsSet = new Set<string>();

    for (const r of filteredRecoltes) {
      totalCaisses += r.caisses || 0;
      ouvriersSet.add(r.ouvrier_id);
      if (r.serre_id) serresSet.add(r.serre_id);
      if (r.created_by_id) caporalsSet.add(r.created_by_id);
    }

    return {
      totalCaisses: Math.round(totalCaisses * 10) / 10,
      totalOuvriers: ouvriersSet.size,
      totalSerres: serresSet.size,
      totalCaporals: caporalsSet.size,
      totalEntries: filteredRecoltes.length,
    };
  }, [filteredRecoltes]);

  // Groupement par Serre
  const recolteBySerre = useMemo(() => {
    const map = new Map<
      string,
      {
        serre_id: string;
        serre_nom: string;
        totalCaisses: number;
        ouvriersMap: Map<string, { nom: string; numero: number; caisses: number }>;
      }
    >();

    for (const r of filteredRecoltes) {
      const key = r.serre_id || 'autre';
      if (!map.has(key)) {
        map.set(key, {
          serre_id: key,
          serre_nom: r.serre_nom || 'Serre non spécifiée',
          totalCaisses: 0,
          ouvriersMap: new Map(),
        });
      }
      const entry = map.get(key)!;
      entry.totalCaisses += r.caisses || 0;

      const workerKey = r.ouvrier_id;
      if (!entry.ouvriersMap.has(workerKey)) {
        entry.ouvriersMap.set(workerKey, {
          nom: r.nom_ouvrier,
          numero: r.numero_ouvrier,
          caisses: 0,
        });
      }
      entry.ouvriersMap.get(workerKey)!.caisses += r.caisses || 0;
    }

    return Array.from(map.values()).sort((a, b) => b.totalCaisses - a.totalCaisses);
  }, [filteredRecoltes]);

  // Groupement par Ouvrier
  const recolteByOuvrier = useMemo(() => {
    const map = new Map<
      string,
      {
        ouvrier_id: string;
        nom: string;
        numero: number;
        totalCaisses: number;
        serresMap: Map<string, number>;
      }
    >();

    for (const r of filteredRecoltes) {
      if (!map.has(r.ouvrier_id)) {
        map.set(r.ouvrier_id, {
          ouvrier_id: r.ouvrier_id,
          nom: r.nom_ouvrier,
          numero: r.numero_ouvrier,
          totalCaisses: 0,
          serresMap: new Map(),
        });
      }
      const w = map.get(r.ouvrier_id)!;
      w.totalCaisses += r.caisses || 0;
      w.serresMap.set(r.serre_nom, (w.serresMap.get(r.serre_nom) || 0) + (r.caisses || 0));
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
        countOperations: number;
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
          countOperations: 0,
          distinctWorkers: new Set(),
        });
      }
      const c = map.get(key)!;
      c.totalCaisses += r.caisses || 0;
      c.countOperations += 1;
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
    lines.push('RÉCAPITULATIF RÉCOLTE');
    lines.push(`Date : ${dateLabel}`);
    lines.push('');

    // Détail par serre
    for (const s of recolteBySerre) {
      lines.push(`SERRE ${s.serre_nom.toUpperCase()}`);

      const sortedWorkers = Array.from(s.ouvriersMap.values()).sort(
        (a, b) => a.numero - b.numero
      );

      sortedWorkers.forEach((w, idx) => {
        lines.push(`${idx + 1}. #${w.numero} ${w.nom} — ${w.caisses} caisses`);
      });

      lines.push(`Total employés : ${sortedWorkers.length}`);
      lines.push(`Total caisses : ${Math.round(s.totalCaisses * 10) / 10}`);
      lines.push('');
    }

    // Totaux finaux
    lines.push('TOTAL JOURNÉE');
    lines.push(`Total employés distincts : ${globalStats.totalOuvriers}`);
    lines.push(`Total caisses : ${globalStats.totalCaisses}`);

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
      alert('Aucune donnée de récolte à exporter pour la période sélectionnée.');
      return;
    }

    const rows = filteredRecoltes.map((r) => ({
      Date: r.date,
      Serre: r.serre_nom,
      "N° Ouvrier": r.numero_ouvrier,
      "Nom Ouvrier": r.nom_ouvrier,
      "Nombre de Caisses": r.caisses,
      "Caporal / Auteur": r.created_by_nom,
      "Horodatage de Saisie": new Date(r.created_at).toLocaleString('fr-FR'),
      Notes: r.notes || '',
    }));

    // Ligne de totalisation
    rows.push({
      Date: 'TOTAL',
      Serre: '',
      "N° Ouvrier": '' as unknown as number,
      "Nom Ouvrier": `${globalStats.totalOuvriers} ouvriers distincts`,
      "Nombre de Caisses": globalStats.totalCaisses,
      "Caporal / Auteur": '',
      "Horodatage de Saisie": '',
      Notes: '',
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Récolte');

    // Largeurs de colonnes auto
    worksheet['!cols'] = [
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 25 },
      { wch: 18 },
      { wch: 22 },
      { wch: 22 },
      { wch: 20 },
    ];

    const fileName =
      dateMode === 'unique'
        ? `recolte-${selectedDate.split('-').reverse().join('-')}.xlsx`
        : `recolte-${startDate.split('-').reverse().join('-')}_au_${endDate.split('-').reverse().join('-')}.xlsx`;

    XLSX.writeFile(workbook, fileName);
    setToastMessage(`✓ Fichier Excel "${fileName}" téléchargé avec succès (${filteredRecoltes.length} lignes).`);
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
      {/* En-tête Tableau de bord */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center font-black">
            🍇
          </div>
          <div>
            <h2 className="text-xs font-black text-slate-900 flex items-center gap-1.5">
              <span>Supervision Récolte (Admin)</span>
            </h2>
            <p className="text-[10px] text-slate-500">
              Contrôle des caisses, caporals et serres
            </p>
          </div>
        </div>

        {/* Boutons d'export rapides */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleShareWhatsApp}
            className="flex items-center gap-1 bg-[#25D366] hover:bg-[#20ba59] text-white text-[10px] font-black py-1.5 px-2.5 rounded-xl shadow-xs transition"
            title="Partager le récapitulatif WhatsApp"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-black py-1.5 px-2.5 rounded-xl shadow-xs transition"
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

      {/* Cartes métriques clés */}
      <div className="grid grid-cols-4 gap-1.5">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-emerald-700 font-bold uppercase block truncate">
            Caisses
          </span>
          <span className="text-base font-black text-emerald-950">
            {globalStats.totalCaisses}
          </span>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-blue-700 font-bold uppercase block truncate">
            Ouvriers
          </span>
          <span className="text-base font-black text-blue-950">
            {globalStats.totalOuvriers}
          </span>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-purple-700 font-bold uppercase block truncate">
            Serres
          </span>
          <span className="text-base font-black text-purple-950">
            {globalStats.totalSerres}
          </span>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-2 text-center shadow-2xs">
          <span className="text-[9px] text-amber-700 font-bold uppercase block truncate">
            Caporals
          </span>
          <span className="text-base font-black text-amber-950">
            {globalStats.totalCaporals}
          </span>
        </div>
      </div>

      {/* Barre de filtres (Période / Serre / Ouvrier / Caporal) */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2">
        {/* Choix Date unique vs Période */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
          <div className="flex gap-1 bg-slate-100 p-0.5 rounded-xl text-[10px] font-black">
            <button
              type="button"
              onClick={() => setDateMode('unique')}
              className={`px-2 py-1 rounded-lg transition ${
                dateMode === 'unique' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
              }`}
            >
              Date du jour
            </button>
            <button
              type="button"
              onClick={() => setDateMode('periode')}
              className={`px-2 py-1 rounded-lg transition ${
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
              className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-1 text-xs font-bold text-slate-800 outline-none"
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

        {/* Sélecteurs Serre, Ouvrier, Caporal */}
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

      {/* Navigation entre sous-vues */}
      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar text-xs">
        <button
          type="button"
          onClick={() => setSubView('serres')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'serres'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          🌿 Par Serre ({recolteBySerre.length})
        </button>
        <button
          type="button"
          onClick={() => setSubView('ouvriers')}
          className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition ${
            subView === 'ouvriers'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          👤 Par Ouvrier ({recolteByOuvrier.length})
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
          📋 Journal détaillé ({filteredRecoltes.length})
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
          ⚙️ Gérer les Serres ({serres.length})
        </button>
      </div>

      {/* ===================== SOUS-VUE 1 : SYNTHÈSE PAR SERRE ===================== */}
      {subView === 'serres' && (
        <div className="space-y-2">
          {recolteBySerre.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucune récolte enregistrée pour cette sélection.
            </p>
          ) : (
            recolteBySerre.map((s) => {
              const workerList = Array.from(s.ouvriersMap.values());
              return (
                <div
                  key={s.serre_id}
                  className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-xs">
                        🌿
                      </span>
                      <h4 className="font-black text-slate-900 text-xs">{s.serre_nom}</h4>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-emerald-700 text-xs bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg">
                        {Math.round(s.totalCaisses * 10) / 10} caisses
                      </span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">
                        {workerList.length} ouvrier(s)
                      </span>
                    </div>
                  </div>

                  {/* Liste des ouvriers ayant récolté dans cette serre */}
                  <div className="space-y-1">
                    {workerList.map((w) => (
                      <div
                        key={w.numero}
                        className="flex items-center justify-between text-xs py-1 px-2 rounded-xl bg-slate-50"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-500">#{w.numero}</span>
                          <span className="font-bold text-slate-800">{w.nom}</span>
                        </div>
                        <span className="font-black text-slate-900 font-mono">
                          {w.caisses} c.
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 2 : SYNTHÈSE PAR OUVRIER ===================== */}
      {subView === 'ouvriers' && (
        <div className="space-y-1.5">
          {recolteByOuvrier.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucun ouvrier actif sur cette période.
            </p>
          ) : (
            recolteByOuvrier.map((w, idx) => (
              <div
                key={w.ouvrier_id}
                className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] flex items-center justify-center font-mono">
                    {idx + 1}
                  </span>
                  <div>
                    <span className="font-black text-slate-900 text-xs">
                      #{w.numero} {w.nom}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {Array.from(w.serresMap.entries())
                        .map(([nom, q]) => `${nom} (${q}c)`)
                        .join(' • ')}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-black text-emerald-800 text-xs font-mono">
                    {Math.round(w.totalCaisses * 10) / 10} caisses
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 3 : SYNTHÈSE PAR CAPORAL ===================== */}
      {subView === 'caporals' && (
        <div className="space-y-2">
          {recolteByCaporal.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucun caporal répertorié.
            </p>
          ) : (
            recolteByCaporal.map((c) => (
              <div
                key={c.caporal_id}
                className="bg-white rounded-2xl p-3 border border-slate-200 shadow-2xs space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center text-xs">
                      🌾
                    </span>
                    <div>
                      <h4 className="font-black text-slate-900 text-xs">{c.caporal_nom}</h4>
                      <p className="text-[10px] text-slate-500">
                        {c.countOperations} saisie(s) enregistrée(s) • {c.distinctWorkers.size} ouvriers
                      </p>
                    </div>
                  </div>

                  <span className="font-black text-emerald-800 text-xs bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl">
                    {Math.round(c.totalCaisses * 10) / 10} caisses
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================== SOUS-VUE 4 : JOURNAL DÉTAILLÉ ===================== */}
      {subView === 'detail' && (
        <div className="space-y-1.5">
          {filteredRecoltes.length === 0 ? (
            <p className="p-6 text-center text-slate-400 text-xs bg-white rounded-2xl border border-slate-200">
              Aucun enregistrement trouvé.
            </p>
          ) : (
            filteredRecoltes.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-black text-emerald-900">#{r.numero_ouvrier}</span>
                    <span className="font-black text-slate-900">{r.nom_ouvrier}</span>
                    <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.2 rounded-md font-bold">
                      {r.serre_nom}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {r.date} • {r.created_by_nom} •{' '}
                    {new Date(r.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono font-black text-emerald-700 text-xs">
                    {r.caisses} caisses
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Supprimer cette saisie pour ${r.nom_ouvrier} ?`)) {
                        onDeleteRecolte(r.id);
                      }
                    }}
                    className="p-1 text-slate-300 hover:text-red-600 rounded-md transition"
                    title="Supprimer"
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
              Serres configurées pour la récolte ({serres.length}) :
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

      {/* Modale d'ajout / modification de Serre */}
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
