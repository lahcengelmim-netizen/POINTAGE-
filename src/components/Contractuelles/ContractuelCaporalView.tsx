/**
 * Vue POINTAGE & RÉCAPITULATIF JOURNALIER — GESTION DES CONTRACTUELLES
 * Application : LAHCEN POINTEUR
 *
 * Spécifications strictes :
 * 1. Simple et fluide : PRÉSENT / ABSENT en un clic.
 * 2. Montant initial ADMIN affiché pour chaque travailleur (ex: 100 DH).
 * 3. Si PRÉSENT : montant applicable initialisé automatiquement avec le montant ADMIN.
 * 4. Si CAPORAL modifie le montant (ex: 110 DH) : appliqué uniquement pour la date du jour,
 *    sans modifier le montant initial enregistré par ADMIN.
 * 5. Si ABSENT : montant comptabilisé = 0 DH.
 * 6. Récapitulatif journalier en temps réel avec Total à Payer (DH).
 * 7. Exportation Excel et Partage WhatsApp du récapitulatif.
 * 8. Aucun filtre destructif : tous les contractuels actifs sont visibles.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  Search,
  CheckCircle2,
  XCircle,
  Download,
  Copy,
  Check,
  Share2,
  Users,
  UserCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  AlertCircle,
  RefreshCw,
  Plus,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ContractuelOuvrier,
  ContractuelPointage,
  UserAccount,
  Domaine,
  Serre,
} from '../../types/index';
import {
  getContractuelOuvriers,
  getContractuelPointages,
  saveContractuelPointage,
  saveContractuelOuvrier,
} from '../../services/contractuelService';

interface ContractuelCaporalViewProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  domaines?: Domaine[];
  serres?: Serre[];
  taches?: any[];
  currentUser: UserAccount;
  isAdmin?: boolean;
}

export const ContractuelCaporalView: React.FC<ContractuelCaporalViewProps> = ({
  selectedDate,
  onSelectDate,
  currentUser,
  isAdmin = false,
}) => {
  const [ouvriers, setOuvriers] = useState<ContractuelOuvrier[]>([]);
  const [pointages, setPointages] = useState<ContractuelPointage[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingWorkerId, setSavingWorkerId] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<{ workerId: string; message: string } | null>(null);

  // Recherche & filtres
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PRESENTS' | 'ABSENTS' | 'NON_POINTES'>('ALL');

  // États locaux de saisie des montants modifiés pour le jour (workerId => string value)
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});

  // Notification copie WhatsApp
  const [copiedWhatsApp, setCopiedWhatsApp] = useState<boolean>(false);

  // Modale rapide d'ajout pour Admin
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newNom, setNewNom] = useState<string>('');
  const [newPrenom, setNewPrenom] = useState<string>('');
  const [newMontant, setNewMontant] = useState<string>('100');
  const [addingWorker, setAddingWorker] = useState<boolean>(false);

  // Charger les données à chaque changement de date
  useEffect(() => {
    loadData();
  }, [selectedDate]);

  async function loadData() {
    setLoading(true);
    try {
      // Charger TOUS les contractuels actifs (aucun filtre de domaine restrictif)
      const [ouvriersRes, pointagesRes] = await Promise.all([
        getContractuelOuvriers({ actif: true }),
        getContractuelPointages({ date: selectedDate }),
      ]);

      if (ouvriersRes.success && Array.isArray(ouvriersRes.ouvriers)) {
        setOuvriers(ouvriersRes.ouvriers);
      }
      if (pointagesRes.success && Array.isArray(pointagesRes.pointages)) {
        setPointages(pointagesRes.pointages);
      }
    } catch (err) {
      console.error('Erreur chargement données contractuelles:', err);
    } finally {
      setLoading(false);
    }
  }

  // Map des pointages par ouvrier_id pour la date sélectionnée
  const pointagesByWorker = useMemo(() => {
    const map = new Map<string, ContractuelPointage>();
    pointages.forEach((p) => {
      map.set(p.ouvrier_id, p);
    });
    return map;
  }, [pointages]);

  // Récupérer le montant applicable pour un ouvrier aujourd'hui
  const getApplicableAmount = (ouvrier: ContractuelOuvrier): number => {
    // 1. Si valeur en cours d'édition locale
    if (editedAmounts[ouvrier.id] !== undefined) {
      const parsed = parseFloat(editedAmounts[ouvrier.id]);
      return isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed * 100) / 100;
    }

    // 2. Si un pointage existe pour cette date
    const ptg = pointagesByWorker.get(ouvrier.id);
    if (ptg) {
      if (!ptg.present) return 0;
      return typeof ptg.montant_total_jour === 'number' ? ptg.montant_total_jour : (ouvrier.prix_convenu || 0);
    }

    // 3. Par défaut : montant initial défini par ADMIN
    return Number(ouvrier.prix_convenu) || 0;
  };

  // Traiter le pointage PRÉSENT
  const handleMarkPresent = async (ouvrier: ContractuelOuvrier) => {
    setSavingWorkerId(ouvrier.id);
    try {
      // Récupérer le montant applicable (soit saisi par Caporal, soit initial ADMIN)
      const currentInput = editedAmounts[ouvrier.id];
      let montantFinal = Number(ouvrier.prix_convenu) || 0;

      if (currentInput !== undefined) {
        const parsed = parseFloat(currentInput);
        if (!isNaN(parsed) && parsed >= 0) {
          montantFinal = Math.round(parsed * 100) / 100;
        }
      } else {
        const existing = pointagesByWorker.get(ouvrier.id);
        if (existing && existing.present && typeof existing.montant_total_jour === 'number') {
          montantFinal = existing.montant_total_jour;
        }
      }

      const res = await saveContractuelPointage({
        ouvrier_id: ouvrier.id,
        matricule: ouvrier.matricule,
        nom_complet: ouvrier.nom_complet,
        date: selectedDate,
        present: true,
        domaine_id: ouvrier.domaine_id || 'dom_d2',
        montant_total_jour: montantFinal,
      });

      if (res.success && res.pointage) {
        setPointages((prev) => {
          const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
          return [...filtered, res.pointage!];
        });
        setSaveFeedback({ workerId: ouvrier.id, message: `✓ Présent (${montantFinal} DH)` });
        setTimeout(() => setSaveFeedback(null), 2500);
      }
    } catch (err: any) {
      console.error('Erreur pointage présent:', err);
      alert('Erreur lors de l\'enregistrement du pointage présent.');
    } finally {
      setSavingWorkerId(null);
    }
  };

  // Traiter le pointage ABSENT
  const handleMarkAbsent = async (ouvrier: ContractuelOuvrier) => {
    setSavingWorkerId(ouvrier.id);
    try {
      const res = await saveContractuelPointage({
        ouvrier_id: ouvrier.id,
        matricule: ouvrier.matricule,
        nom_complet: ouvrier.nom_complet,
        date: selectedDate,
        present: false,
        domaine_id: ouvrier.domaine_id || 'dom_d2',
        montant_total_jour: 0, // RÈGLE ABSOLUE : Absent = 0 DH
      });

      if (res.success && res.pointage) {
        setPointages((prev) => {
          const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
          return [...filtered, res.pointage!];
        });
        setSaveFeedback({ workerId: ouvrier.id, message: '✓ Absent (0 DH)' });
        setTimeout(() => setSaveFeedback(null), 2500);
      }
    } catch (err: any) {
      console.error('Erreur pointage absent:', err);
      alert('Erreur lors de l\'enregistrement du pointage absent.');
    } finally {
      setSavingWorkerId(null);
    }
  };

  // Modification du montant applicable pour aujourd'hui
  const handleAmountInputChange = (ouvrierId: string, value: string) => {
    setEditedAmounts((prev) => ({ ...prev, [ouvrierId]: value }));
  };

  // Validation / sauvegarde du nouveau montant à la perte de focus ou validation
  const handleAmountBlur = async (ouvrier: ContractuelOuvrier) => {
    const rawVal = editedAmounts[ouvrier.id];
    if (rawVal === undefined) return;

    const parsed = parseFloat(rawVal);
    if (isNaN(parsed) || parsed < 0) {
      alert('Montant invalide : veuillez saisir un nombre positif ou zéro.');
      // Réinitialiser
      setEditedAmounts((prev) => {
        const copy = { ...prev };
        delete copy[ouvrier.id];
        return copy;
      });
      return;
    }

    const cleanMontant = Math.round(parsed * 100) / 100;
    const existing = pointagesByWorker.get(ouvrier.id);

    // Si l'ouvrier est déjà pointé présent, actualiser immédiatement son montant pour aujourd'hui
    if (existing && existing.present) {
      setSavingWorkerId(ouvrier.id);
      try {
        const res = await saveContractuelPointage({
          ouvrier_id: ouvrier.id,
          matricule: ouvrier.matricule,
          nom_complet: ouvrier.nom_complet,
          date: selectedDate,
          present: true,
          domaine_id: ouvrier.domaine_id || 'dom_d2',
          montant_total_jour: cleanMontant,
        });

        if (res.success && res.pointage) {
          setPointages((prev) => {
            const filtered = prev.filter((p) => p.ouvrier_id !== ouvrier.id);
            return [...filtered, res.pointage!];
          });
          setSaveFeedback({ workerId: ouvrier.id, message: `✓ Montant ${cleanMontant} DH validé` });
          setTimeout(() => setSaveFeedback(null), 2500);
        }
      } catch (err) {
        console.error('Erreur actualisation montant:', err);
      } finally {
        setSavingWorkerId(null);
      }
    }
  };

  // Navigation de date rapide
  const handleChangeDateRelative = (offsetDays: number) => {
    try {
      const current = new Date(selectedDate);
      if (isNaN(current.getTime())) return;
      current.setDate(current.getDate() + offsetDays);
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, '0');
      const dd = String(current.getDate()).padStart(2, '0');
      onSelectDate(`${yyyy}-${mm}-${dd}`);
    } catch {
      // ignore
    }
  };

  const handleSetToday = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    onSelectDate(`${yyyy}-${mm}-${dd}`);
  };

  // Format de date lisible en français
  const formattedDateFr = useMemo(() => {
    try {
      const [year, month, day] = selectedDate.split('-').map(Number);
      const d = new Date(year, month - 1, day);
      return d.toLocaleDateString('fr-FR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return selectedDate;
    }
  }, [selectedDate]);

  // Statistiques journalières calculées en temps réel
  const stats = useMemo(() => {
    let totalPresents = 0;
    let totalAbsents = 0;
    let totalNonPointes = 0;
    let totalAPayerDH = 0;

    ouvriers.forEach((ouvrier) => {
      const ptg = pointagesByWorker.get(ouvrier.id);
      if (!ptg) {
        totalNonPointes++;
      } else if (ptg.present) {
        totalPresents++;
        const montant = typeof ptg.montant_total_jour === 'number' ? ptg.montant_total_jour : (ouvrier.prix_convenu || 0);
        totalAPayerDH += montant;
      } else {
        totalAbsents++;
      }
    });

    return {
      totalContractuels: ouvriers.length,
      totalPresents,
      totalAbsents,
      totalNonPointes,
      totalAPayerDH: Math.round(totalAPayerDH * 100) / 100,
    };
  }, [ouvriers, pointagesByWorker]);

  // Liste filtrée selon recherche et statut
  const filteredOuvriers = useMemo(() => {
    return ouvriers.filter((ouvrier) => {
      // 1. Recherche par nom ou prénom
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const nom = (ouvrier.nom || '').toLowerCase();
        const prenom = (ouvrier.prenom || '').toLowerCase();
        const complet = (ouvrier.nom_complet || '').toLowerCase();
        if (!nom.includes(q) && !prenom.includes(q) && !complet.includes(q)) {
          return false;
        }
      }

      // 2. Filtre par statut
      const ptg = pointagesByWorker.get(ouvrier.id);
      if (filterStatus === 'PRESENTS') return ptg && ptg.present;
      if (filterStatus === 'ABSENTS') return ptg && !ptg.present;
      if (filterStatus === 'NON_POINTES') return !ptg;

      return true;
    });
  }, [ouvriers, pointagesByWorker, searchQuery, filterStatus]);

  // Génération du texte récapitulatif pour WhatsApp
  const generateWhatsAppRecapText = (): string => {
    const dateParts = selectedDate.split('-');
    const dateFormatted = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : selectedDate;

    const lines: string[] = [];
    lines.push(`📋 *POINTAGE CONTRACTUELS — ${dateFormatted}*`);
    lines.push('');
    lines.push(`👥 Total contractuels : ${stats.totalContractuels}`);
    lines.push(`✅ Présents : ${stats.totalPresents}`);
    lines.push(`❌ Absents : ${stats.totalAbsents}`);
    if (stats.totalNonPointes > 0) {
      lines.push(`⏳ Non pointés : ${stats.totalNonPointes}`);
    }
    lines.push('');
    lines.push('*DÉTAIL DES MONTANTS :*');

    ouvriers.forEach((o) => {
      const ptg = pointagesByWorker.get(o.id);
      if (ptg) {
        if (ptg.present) {
          const m = typeof ptg.montant_total_jour === 'number' ? ptg.montant_total_jour : (o.prix_convenu || 0);
          lines.push(`- ${o.nom_complet} : PRÉSENT (${m} DH)`);
        } else {
          lines.push(`- ${o.nom_complet} : ABSENT (0 DH)`);
        }
      } else {
        lines.push(`- ${o.nom_complet} : Non pointé`);
      }
    });

    lines.push('');
    lines.push(`💰 *TOTAL À PAYER : ${stats.totalAPayerDH} DH*`);
    lines.push('');
    lines.push(`_Enregistré par : ${currentUser.nom}_`);

    return lines.join('\n');
  };

  // Copier le récapitulatif WhatsApp
  const handleCopyWhatsApp = async () => {
    const text = generateWhatsAppRecapText();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      alert('Impossible de copier automatiquement.');
    }
  };

  // Partager directement par WhatsApp
  const handleShareWhatsApp = () => {
    const text = generateWhatsAppRecapText();
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  // Exportation Excel professionnelle du jour
  const handleExportExcel = () => {
    const dateParts = selectedDate.split('-');
    const dateFormatted = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` : selectedDate;

    const dataRows = ouvriers.map((o, idx) => {
      const ptg = pointagesByWorker.get(o.id);
      let statutStr = 'Non pointé';
      let montantFinal = 0;

      if (ptg) {
        statutStr = ptg.present ? 'PRÉSENT' : 'ABSENT';
        montantFinal = ptg.present
          ? (typeof ptg.montant_total_jour === 'number' ? ptg.montant_total_jour : (o.prix_convenu || 0))
          : 0;
      }

      return {
        'N°': idx + 1,
        'Nom': o.nom,
        'Prénom': o.prenom || '',
        'Nom Complet': o.nom_complet,
        'Montant Initial (DH)': Number(o.prix_convenu) || 0,
        'Statut du Jour': statutStr,
        'Montant Comptabilisé (DH)': montantFinal,
        'Date': selectedDate,
      };
    });

    // Ligne de total
    dataRows.push({
      'N°': '' as any,
      'Nom': 'TOTAL À PAYER',
      'Prénom': '',
      'Nom Complet': '',
      'Montant Initial (DH)': '' as any,
      'Statut du Jour': `${stats.totalPresents} présent(s)`,
      'Montant Comptabilisé (DH)': stats.totalAPayerDH as any,
      'Date': selectedDate,
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(dataRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Pointage Contractuels');

    const fileName = `pointage-contractuels-${dateFormatted}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // Ajout rapide manuel d'un travailleur (réservé Admin)
  const handleCreateWorkerQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNom.trim()) {
      alert('Veuillez renseigner le nom.');
      return;
    }
    const prix = parseFloat(newMontant);
    if (isNaN(prix) || prix < 0) {
      alert('Montant invalide.');
      return;
    }

    setAddingWorker(true);
    try {
      const res = await saveContractuelOuvrier({
        nom: newNom.trim(),
        prenom: newPrenom.trim(),
        prix_convenu: Math.round(prix * 100) / 100,
        actif: true,
      });

      if (res.success && res.ouvrier) {
        setOuvriers((prev) => [...prev, res.ouvrier!]);
        setShowAddModal(false);
        setNewNom('');
        setNewPrenom('');
        setNewMontant('100');
      } else {
        alert(res.error || 'Erreur lors de la création.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setAddingWorker(false);
    }
  };

  return (
    <div className="space-y-3 pb-24">
      {/* 1. SÉLECTEUR DE DATE & BOUTONS RAPIDES */}
      <div className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Navigation jour précédent / jour suivant */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleChangeDateRelative(-1)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition active:scale-95"
              title="Jour précédent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleSetToday}
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-emerald-100 hover:text-emerald-900 text-slate-700 text-xs font-black transition active:scale-95"
            >
              Aujourd'hui
            </button>
            <button
              type="button"
              onClick={() => handleChangeDateRelative(1)}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition active:scale-95"
              title="Jour suivant"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Sélecteur de date natif */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onSelectDate(e.target.value)}
                className="pl-3 pr-2 py-1.5 rounded-xl border border-slate-300 text-xs font-black text-slate-800 bg-slate-50 focus:bg-white focus:border-emerald-600 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
              title="Actualiser les données"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Date formatée en français */}
        <div className="mt-2 text-xs font-bold text-slate-600 capitalize flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-emerald-700" />
          <span>{formattedDateFr}</span>
        </div>
      </div>

      {/* 2. BANDEAU DES STATISTIQUES & TOTAL GÉNÉRAL EN DH */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Total contractuels */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-bold">
            <Users className="w-3.5 h-3.5" />
            <span>Total Ouvriers</span>
          </div>
          <div className="text-xl font-black text-slate-900 mt-1">
            {stats.totalContractuels}
          </div>
          <div className="text-[10px] text-slate-400">contractuels actifs</div>
        </div>

        {/* Présents */}
        <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-emerald-800 text-[11px] font-bold">
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Présents</span>
          </div>
          <div className="text-xl font-black text-emerald-700 mt-1">
            {stats.totalPresents}
          </div>
          <div className="text-[10px] text-emerald-600 font-semibold">pointés présents</div>
        </div>

        {/* Absents */}
        <div className="bg-rose-50 p-3 rounded-2xl border border-rose-200 shadow-2xs">
          <div className="flex items-center gap-1.5 text-rose-800 text-[11px] font-bold">
            <UserX className="w-3.5 h-3.5 text-rose-600" />
            <span>Absents</span>
          </div>
          <div className="text-xl font-black text-rose-700 mt-1">
            {stats.totalAbsents}
          </div>
          <div className="text-[10px] text-rose-600 font-semibold">0 DH comptabilisé</div>
        </div>

        {/* TOTAL À PAYER */}
        <div className="bg-gradient-to-br from-emerald-900 to-slate-900 text-white p-3 rounded-2xl shadow-md border border-emerald-700/60">
          <div className="text-[10px] text-emerald-300 font-black uppercase tracking-wider">
            TOTAL À PAYER
          </div>
          <div className="text-xl sm:text-2xl font-black font-mono text-white mt-0.5">
            {stats.totalAPayerDH.toLocaleString('fr-FR')} <span className="text-sm font-sans text-emerald-300">DH</span>
          </div>
          <div className="text-[10px] text-emerald-200 truncate">
            {stats.totalPresents} ouvrier(s) rémunéré(s)
          </div>
        </div>
      </div>

      {/* 3. BARRE D'ACTIONS : RECHERCHE & FILTRES RAPIDES */}
      <div className="bg-white rounded-2xl p-2.5 border border-slate-200 shadow-2xs space-y-2">
        <div className="flex items-center gap-2">
          {/* Recherche */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom ou prénom..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Bouton ajout rapide si Admin */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="h-9 px-3 bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs rounded-xl flex items-center gap-1 shadow-2xs transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          )}
        </div>

        {/* Filtres de statut */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1">
          <button
            type="button"
            onClick={() => setFilterStatus('ALL')}
            className={`px-3 py-1 rounded-xl text-[11px] font-black transition cursor-pointer shrink-0 ${
              filterStatus === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Tous ({ouvriers.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('PRESENTS')}
            className={`px-3 py-1 rounded-xl text-[11px] font-black transition cursor-pointer shrink-0 ${
              filterStatus === 'PRESENTS'
                ? 'bg-emerald-700 text-white'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            Présents ({stats.totalPresents})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('ABSENTS')}
            className={`px-3 py-1 rounded-xl text-[11px] font-black transition cursor-pointer shrink-0 ${
              filterStatus === 'ABSENTS'
                ? 'bg-rose-700 text-white'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
            }`}
          >
            Absents ({stats.totalAbsents})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('NON_POINTES')}
            className={`px-3 py-1 rounded-xl text-[11px] font-black transition cursor-pointer shrink-0 ${
              filterStatus === 'NON_POINTES'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            À pointer ({stats.totalNonPointes})
          </button>
        </div>
      </div>

      {/* 4. LISTE DES CONTRACTUELS AVEC POINTAGE PRÉSENT / ABSENT & MONTANT APPLICABLE */}
      {loading ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          <p className="text-xs font-bold text-slate-500">Chargement des contractuels...</p>
        </div>
      ) : filteredOuvriers.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <AlertCircle className="w-8 h-8 text-emerald-600 mx-auto" />
          <p className="text-sm font-black text-slate-800">
            {ouvriers.length === 0
              ? 'Catalogue des contractuels vide'
              : 'Aucun travailleur ne correspond à votre filtre de recherche'}
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            {ouvriers.length === 0
              ? isAdmin
                ? 'Aucun travailleur dans le système. Rendez-vous dans l’onglet « Travailleurs & Import Excel » pour importer votre fichier standard (Nom, Prénom, Montant DH).'
                : 'Aucun travailleur contractuel disponible. L’administration n’a pas encore importé la liste des travailleurs.'
              : 'Ajustez votre recherche ou réinitialisez les filtres.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredOuvriers.map((ouvrier) => {
            const ptg = pointagesByWorker.get(ouvrier.id);
            const isPresent = ptg ? ptg.present : null; // true, false ou null (non pointé)
            const isSaving = savingWorkerId === ouvrier.id;
            const currentAmount = getApplicableAmount(ouvrier);
            const inputVal = editedAmounts[ouvrier.id] !== undefined ? editedAmounts[ouvrier.id] : String(currentAmount);

            return (
              <div
                key={ouvrier.id}
                className={`p-3.5 bg-white rounded-2xl border transition shadow-xs ${
                  isPresent === true
                    ? 'border-emerald-400 bg-emerald-50/20'
                    : isPresent === false
                    ? 'border-rose-300 bg-rose-50/20'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  {/* Identification du travailleur */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm text-slate-900 tracking-tight">
                        {ouvrier.nom_complet || `${ouvrier.nom} ${ouvrier.prenom || ''}`}
                      </span>
                      {ouvrier.matricule && (
                        <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">
                          {ouvrier.matricule}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>Montant initial ADMIN :</span>
                      <span className="font-mono font-black text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded-md text-[11px]">
                        {ouvrier.prix_convenu || 0} DH
                      </span>
                      {saveFeedback && saveFeedback.workerId === ouvrier.id && (
                        <span className="text-[11px] font-black text-emerald-700 animate-pulse ml-1">
                          {saveFeedback.message}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions de pointage : PRÉSENT / ABSENT & Montant applicable */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Bouton PRÉSENT */}
                    <button
                      type="button"
                      onClick={() => handleMarkPresent(ouvrier)}
                      disabled={isSaving}
                      className={`h-11 px-3.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs ${
                        isPresent === true
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400'
                          : 'bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-900 border border-slate-200'
                      }`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>PRÉSENT</span>
                    </button>

                    {/* Bouton ABSENT */}
                    <button
                      type="button"
                      onClick={() => handleMarkAbsent(ouvrier)}
                      disabled={isSaving}
                      className={`h-11 px-3.5 rounded-xl font-black text-xs flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-2xs ${
                        isPresent === false
                          ? 'bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-400'
                          : 'bg-slate-100 hover:bg-rose-100 text-slate-700 hover:text-rose-900 border border-slate-200'
                      }`}
                    >
                      <XCircle className="w-4 h-4" />
                      <span>ABSENT</span>
                    </button>

                    {/* Champ Montant applicable */}
                    <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 h-11">
                      <span className="text-[10px] text-slate-500 font-bold uppercase">Montant :</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={isPresent === false ? '0' : inputVal}
                        disabled={isPresent === false}
                        onChange={(e) => handleAmountInputChange(ouvrier.id, e.target.value)}
                        onBlur={() => handleAmountBlur(ouvrier)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className={`w-16 font-mono font-black text-xs text-right bg-transparent outline-none ${
                          isPresent === false ? 'text-slate-400 cursor-not-allowed' : 'text-slate-900'
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-500">DH</span>
                    </div>
                  </div>
                </div>

                {/* État résumé */}
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 font-medium">
                    {isPresent === true ? (
                      <span className="text-emerald-700 font-bold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Pointé Présent aujourd'hui
                      </span>
                    ) : isPresent === false ? (
                      <span className="text-rose-600 font-bold flex items-center gap-1">
                        ✕ Marqué Absent (0 DH comptabilisé)
                      </span>
                    ) : (
                      <span className="text-amber-600 font-bold">○ Non pointé pour cette date</span>
                    )}
                  </span>

                  <span className="font-mono font-bold text-slate-700">
                    Comptabilisé : <span className="font-black text-slate-900">{isPresent ? currentAmount : 0} DH</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. TABLEAU RÉCAPITULATIF JOURNALIER & EXPORT */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900 tracking-tight">
              Récapitulatif Journalier des Contractuels
            </h3>
            <p className="text-[11px] text-slate-500">
              Liste complète des travailleurs et montants comptabilisés pour le {formattedDateFr}
            </p>
          </div>

          {/* Boutons d'exportation Excel et partage WhatsApp */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Exporter Excel</span>
            </button>

            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="px-3 py-1.5 bg-[#075E54] hover:bg-[#064e46] text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-2xs transition active:scale-95"
            >
              {copiedWhatsApp ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedWhatsApp ? 'Copié !' : 'Copier WhatsApp'}</span>
            </button>

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="px-2.5 py-1.5 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-xl text-xs font-black flex items-center gap-1 shadow-2xs transition active:scale-95"
              title="Ouvrir dans WhatsApp"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Tableau standard exactement comme demandé */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Travailleur</th>
                <th className="py-2.5 px-3">Statut</th>
                <th className="py-2.5 px-3 text-right">Montant Initial</th>
                <th className="py-2.5 px-3 text-right">Montant Comptabilisé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {ouvriers.map((o) => {
                const ptg = pointagesByWorker.get(o.id);
                const isPresent = ptg ? ptg.present : null;
                const montantFinal = ptg ? (ptg.present ? (typeof ptg.montant_total_jour === 'number' ? ptg.montant_total_jour : (o.prix_convenu || 0)) : 0) : 0;

                return (
                  <tr key={o.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-3 font-bold text-slate-900">
                      {o.nom_complet || `${o.nom} ${o.prenom || ''}`}
                    </td>
                    <td className="py-2.5 px-3">
                      {isPresent === true ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded-md">
                          PRÉSENT
                        </span>
                      ) : isPresent === false ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black bg-rose-100 text-rose-900 px-2 py-0.5 rounded-md">
                          ABSENT
                        </span>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">Non pointé</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                      {o.prix_convenu || 0} DH
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                      {montantFinal} DH
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-900 text-white font-black border-t-2 border-emerald-600">
              <tr>
                <td colSpan={2} className="py-3 px-3 uppercase text-xs tracking-wider text-emerald-400">
                  TOTAL GÉNÉRAL À PAYER
                </td>
                <td className="py-3 px-3 text-right text-xs text-slate-300 font-mono">
                  {stats.totalPresents} présent(s)
                </td>
                <td className="py-3 px-3 text-right text-base text-emerald-300 font-mono">
                  {stats.totalAPayerDH.toLocaleString('fr-FR')} DH
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* MODALE AJOUT RAPIDE TRAVAILLEUR (ADMIN) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-emerald-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
                <h3 className="font-black text-sm">Ajouter un Travailleur Contractuel</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-white/70 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateWorkerQuick} className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  NOM <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNom}
                  onChange={(e) => setNewNom(e.target.value)}
                  placeholder="Ex : EL AMRANI"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 uppercase focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  PRÉNOM
                </label>
                <input
                  type="text"
                  value={newPrenom}
                  onChange={(e) => setNewPrenom(e.target.value)}
                  placeholder="Ex : FATIMA"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  MONTANT INITIAL (DH) <span className="text-rose-600">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={newMontant}
                  onChange={(e) => setNewMontant(e.target.value)}
                  placeholder="Ex : 100"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-800 focus:bg-white focus:border-emerald-600 outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={addingWorker}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-xl shadow-xs transition"
                >
                  {addingWorker ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
