/**
 * ÉCRAN 4 — GESTION (PATRON)
 * - Gestion des ouvriers : ajout, modification, activation/désactivation (numéro unique)
 * - Gestion des tâches : ajout, modification, suppression
 * - Sélection de date pour consultation et récapitulatif des jours précédents
 * - Sauvegarde et restauration des données
 */

import React, { useState, useId } from 'react';
import {
  Users,
  Tag,
  Calendar,
  Plus,
  Edit2,
  Trash2,
  Check,
  CheckCircle2,
  X,
  AlertCircle,
  Download,
  Upload,
  RotateCcw,
  Building2,
  Phone,
  Power,
  FileSpreadsheet,
  Fuel,
  MapPin,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Company, Ouvrier, Tache, Domaine } from '../types';
import * as storage from '../services/storage';
import { ImportOuvriersModal } from './ImportOuvriersModal';
import { ImportTachesModal } from './ImportTachesModal';
import { GestionComptesModal } from './GestionComptesModal';
import { exportPointageExcel } from '../utils/excelExporter';
import { formatTacheLabel } from '../utils/tacheUtils';

interface GestionPatronProps {
  currentCompany: Company;
  companies: Company[];
  onSwitchCompany: (id: string) => void;
  allOuvriers: Ouvrier[];
  taches: Tache[];
  domaines?: Domaine[];
  defaultDomaineId?: string;
  onSaveDomaine?: (dom: { id?: string; nom: string; ordre?: number }) => Domaine;
  onDeleteDomaine?: (id: string) => { success: boolean; error?: string };
  onUpdateDomainesOrder?: (domaines: Domaine[]) => void;
  onSetDefaultDomaineId?: (id: string) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export const GestionPatron: React.FC<GestionPatronProps> = ({
  currentCompany,
  companies,
  onSwitchCompany,
  allOuvriers,
  taches,
  domaines = [],
  defaultDomaineId = 'dom_d2',
  onSaveDomaine,
  onDeleteDomaine,
  onUpdateDomainesOrder,
  onSetDefaultDomaineId,
  selectedDate,
  onSelectDate,
}) => {
  // Sous-onglets de gestion
  const [activeSubTab, setActiveSubTab] = useState<
    'ouvriers' | 'taches' | 'domaines' | 'gazoil' | 'historique' | 'societes'
  >('ouvriers');

  // État Gazoil dans Gestion
  const gazoilConfig = storage.getGazoilConfig(currentCompany.id);
  const gazoilCalcul = storage.calculerStockGazoil(currentCompany.id);
  const [seuilGazoilInput, setSeuilGazoilInput] = useState<string>(
    gazoilConfig.seuilAlerte ? gazoilConfig.seuilAlerte.toString() : '20'
  );
  const [stockInitialGazoilInput, setStockInitialGazoilInput] = useState<string>(
    gazoilConfig.stockInitial ? gazoilConfig.stockInitial.toString() : '0'
  );
  const [showConfirmStockInitialModal, setShowConfirmStockInitialModal] = useState<boolean>(false);
  const [gazoilMessage, setGazoilMessage] = useState<string | null>(null);

  // Formulaire Ouvrier
  const [editingOuvrier, setEditingOuvrier] = useState<Ouvrier | null>(null);
  const [ouvrierForm, setOuvrierForm] = useState<{
    numero: string;
    nom: string;
    telephone: string;
    actif: boolean;
  }>({
    numero: '',
    nom: '',
    telephone: '',
    actif: true,
  });
  const [showOuvrierForm, setShowOuvrierForm] = useState(false);
  const [ouvrierError, setOuvrierError] = useState<string | null>(null);
  const [ouvrierSuccess, setOuvrierSuccess] = useState<string | null>(null);
  const [showImportOuvriersModal, setShowImportOuvriersModal] = useState(false);

  // Formulaire Tâche avec Code unique
  const [editingTache, setEditingTache] = useState<Tache | null>(null);
  const [tacheCode, setTacheCode] = useState('');
  const [tacheNom, setTacheNom] = useState('');
  const [tacheCouleur, setTacheCouleur] = useState('#16a34a');
  const [showTacheForm, setShowTacheForm] = useState(false);
  const [tacheError, setTacheError] = useState<string | null>(null);
  const [tacheSuccess, setTacheSuccess] = useState<string | null>(null);
  const [showImportTachesModal, setShowImportTachesModal] = useState(false);

  // Export Excel (SheetJS)
  const [showExportExcelModal, setShowExportExcelModal] = useState(false);
  const [exportMode, setExportMode] = useState<'unique' | 'periode'>('unique');
  const [exportSingleDate, setExportSingleDate] = useState<string>(selectedDate);
  const [exportStartDate, setExportStartDate] = useState<string>(selectedDate);
  const [exportEndDate, setExportEndDate] = useState<string>(selectedDate);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  // Formulaire Société
  const [newCompanyNom, setNewCompanyNom] = useState('');
  const [newCompanyVille, setNewCompanyVille] = useState('');
  const [companyMessage, setCompanyMessage] = useState<string | null>(null);

  // Sauvegarde / Restauration & Nettoyage
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [restorePreview, setRestorePreview] = useState<{
    content: string;
    counts: storage.BackupCounts;
    exportedAt?: string;
    schemaVersion?: string | number;
  } | null>(null);
  const [showClearAllModal, setShowClearAllModal] = useState<boolean>(false);
  const [clearConfirmInput, setClearConfirmInput] = useState<string>('');
  const [showComptesModal, setShowComptesModal] = useState<boolean>(false);

  // État Gestion des Domaines (D1 à D5)
  const [editingDomaine, setEditingDomaine] = useState<Domaine | null>(null);
  const [domaineNomInput, setDomaineNomInput] = useState<string>('');
  const [newDomaineNom, setNewDomaineNom] = useState<string>('');
  const [domaineMessage, setDomaineMessage] = useState<string | null>(null);
  const [domaineError, setDomaineError] = useState<string | null>(null);

  const handleRenameDomaine = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDomaine) return;
    const clean = domaineNomInput.trim().toUpperCase();
    if (!clean) {
      setDomaineError('Le nom du domaine ne peut pas être vide.');
      return;
    }
    if (onSaveDomaine) {
      onSaveDomaine({
        id: editingDomaine.id,
        nom: clean,
        ordre: editingDomaine.ordre,
      });
    } else {
      storage.saveDomaine({
        id: editingDomaine.id,
        nom: clean,
        ordre: editingDomaine.ordre,
      });
    }
    setEditingDomaine(null);
    setDomaineNomInput('');
    setDomaineError(null);
    setDomaineMessage(`Domaine renommé en "${clean}"`);
    setTimeout(() => setDomaineMessage(null), 3000);
  };

  const handleAddDomaine = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newDomaineNom.trim().toUpperCase();
    if (!clean) {
      setDomaineError('Veuillez saisir un nom pour le nouveau domaine.');
      return;
    }
    if (onSaveDomaine) {
      onSaveDomaine({ nom: clean });
    } else {
      storage.saveDomaine({ nom: clean });
    }
    setNewDomaineNom('');
    setDomaineError(null);
    setDomaineMessage(`Nouveau domaine "${clean}" ajouté avec succès !`);
    setTimeout(() => setDomaineMessage(null), 3000);
  };

  const handleDeleteDomaine = (dom: Domaine) => {
    const ok = window.confirm(
      `Confirmer la suppression du domaine "${dom.nom}" ?\nCette action est irréversible.`
    );
    if (!ok) return;

    const res = onDeleteDomaine ? onDeleteDomaine(dom.id) : storage.deleteDomaine(dom.id);
    if (!res.success) {
      alert(res.error || 'Erreur lors de la suppression.');
    } else {
      setDomaineMessage(`Domaine "${dom.nom}" supprimé.`);
      setTimeout(() => setDomaineMessage(null), 3000);
    }
  };

  const handleMoveDomaine = (index: number, direction: 'up' | 'down') => {
    const list = [...(domaines && domaines.length > 0 ? domaines : storage.getDomaines())];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;

    if (onUpdateDomainesOrder) {
      onUpdateDomainesOrder(list);
    } else {
      storage.updateDomainesOrder(list);
    }
    setDomaineMessage(`Ordre des domaines mis à jour pour WhatsApp.`);
    setTimeout(() => setDomaineMessage(null), 3000);
  };

  const handleSetDefault = (id: string) => {
    if (onSetDefaultDomaineId) {
      onSetDefaultDomaineId(id);
    } else {
      storage.setDefaultDomaineId(id);
    }
    const currentList = domaines && domaines.length > 0 ? domaines : storage.getDomaines();
    const targetNom = currentList.find((d) => d.id === id)?.nom || 'D2';
    setDomaineMessage(`Domaine par défaut défini sur "${targetNom}".`);
    setTimeout(() => setDomaineMessage(null), 3000);
  };

  const handleResetDomainesOrder = () => {
    if (window.confirm("Rétablir l'ordre d'origine : D2, puis D3, puis D5, puis D1 et D4 ?")) {
      const defaultOrderNames = ['D2', 'D3', 'D5', 'D1', 'D4'];
      const currentList = [...(domaines && domaines.length > 0 ? domaines : storage.getDomaines())];
      currentList.sort((a, b) => {
        const idxA = defaultOrderNames.indexOf(a.nom.toUpperCase());
        const idxB = defaultOrderNames.indexOf(b.nom.toUpperCase());
        const weightA = idxA >= 0 ? idxA : 100;
        const weightB = idxB >= 0 ? idxB : 100;
        return weightA - weightB;
      });
      if (onUpdateDomainesOrder) {
        onUpdateDomainesOrder(currentList);
      } else {
        storage.updateDomainesOrder(currentList);
      }
      setDomaineMessage("Ordre d'origine rétabli : D2, D3, D5, D1, D4.");
      setTimeout(() => setDomaineMessage(null), 3000);
    }
  };

  const importFileId = useId();

  // --- ACTIONS OUVRIERS ---

  const handleOpenNewOuvrier = () => {
    // Calculer le prochain numéro disponible
    const maxNum = allOuvriers.reduce((max, o) => Math.max(max, o.numero), 0);
    setEditingOuvrier(null);
    setOuvrierForm({
      numero: (maxNum + 1).toString(),
      nom: '',
      telephone: '',
      actif: true,
    });
    setOuvrierError(null);
    setShowOuvrierForm(true);
  };

  const handleOpenEditOuvrier = (ouvrier: Ouvrier) => {
    setEditingOuvrier(ouvrier);
    setOuvrierForm({
      numero: ouvrier.numero.toString(),
      nom: ouvrier.nom,
      telephone: ouvrier.telephone || '',
      actif: ouvrier.actif,
    });
    setOuvrierError(null);
    setShowOuvrierForm(true);
  };

  const handleSaveOuvrier = (e: React.FormEvent) => {
    e.preventDefault();
    setOuvrierError(null);

    const num = parseInt(ouvrierForm.numero, 10);
    if (isNaN(num) || num <= 0) {
      setOuvrierError('Le numéro doit être un chiffre positif (ex: 1, 2, 3...)');
      return;
    }

    if (!ouvrierForm.nom.trim()) {
      setOuvrierError('Le nom de l\'ouvrier est obligatoire.');
      return;
    }

    const res = storage.saveOuvrier(currentCompany.id, {
      id: editingOuvrier?.id,
      numero: num,
      nom: ouvrierForm.nom.trim(),
      telephone: ouvrierForm.telephone.trim(),
      actif: ouvrierForm.actif,
    });

    if (!res.success) {
      setOuvrierError(res.error || 'Erreur lors de l\'enregistrement de l\'ouvrier.');
      return;
    }

    setOuvrierSuccess(
      editingOuvrier
        ? `Ouvrier #${num} modifié avec succès !`
        : `Ouvrier #${num} (${ouvrierForm.nom}) ajouté !`
    );
    setShowOuvrierForm(false);
    setTimeout(() => setOuvrierSuccess(null), 3000);
  };

  const handleToggleOuvrier = (ouvrier: Ouvrier) => {
    storage.toggleOuvrierActif(ouvrier.id);
  };

  const handleDeleteOuvrier = (ouvrier: Ouvrier) => {
    if (
      window.confirm(
        `Êtes-vous sûr de vouloir supprimer définitivement l'ouvrier #${ouvrier.numero} (${ouvrier.nom}) ? Pour conserver l'historique, vous pouvez plutôt le désactiver.`
      )
    ) {
      storage.deleteOuvrier(ouvrier.id);
    }
  };

  // --- ACTIONS TÂCHES ---

  const handleSaveTache = (e: React.FormEvent) => {
    e.preventDefault();
    setTacheError(null);

    const nom = tacheNom.trim().toUpperCase();
    if (!nom) {
      setTacheError('Le nom de la tâche est obligatoire.');
      return;
    }

    const code = tacheCode.trim().toUpperCase() || undefined;

    // Règle : Le code est modifiable dans l'écran Gestion. Il doit être unique : si un code existe déjà, afficher une erreur et ne pas enregistrer.
    if (code) {
      const duplicateCode = taches.find(
        (t) =>
          t.code &&
          t.code.trim().toUpperCase() === code &&
          t.id !== editingTache?.id
      );
      if (duplicateCode) {
        setTacheError(
          `Le code "${code}" est déjà utilisé par la tâche "${duplicateCode.nom}". Chaque code doit être unique.`
        );
        return;
      }
    }

    const res = storage.saveTache(currentCompany.id, {
      id: editingTache?.id,
      code,
      nom,
      couleur: tacheCouleur,
    });

    if (!res.success) {
      setTacheError(res.error || 'Erreur lors de l\'enregistrement de la tâche.');
      return;
    }

    setShowTacheForm(false);
    setEditingTache(null);
    setTacheCode('');
    setTacheNom('');
    setTacheSuccess(
      editingTache
        ? `Tâche "${code ? `${code} - ${nom}` : nom}" modifiée avec succès !`
        : `Tâche "${code ? `${code} - ${nom}` : nom}" créée avec succès !`
    );
    setTimeout(() => setTacheSuccess(null), 3500);
  };

  const handleDeleteTache = (tache: Tache) => {
    if (window.confirm(`Supprimer la tâche "${tache.code ? `${tache.code} - ${tache.nom}` : tache.nom}" ?`)) {
      storage.deleteTache(tache.id);
    }
  };

  // --- ACTIONS EXPORT EXCEL ---

  const handleTriggerExcelExport = () => {
    setExportErrorMessage(null);
    setExportSuccessMessage(null);

    // Validation préalable
    if (exportMode === 'unique') {
      if (!exportSingleDate) {
        setExportErrorMessage('Veuillez sélectionner une date pour l\'export.');
        return;
      }
    } else {
      if (!exportStartDate || !exportEndDate) {
        setExportErrorMessage('Veuillez renseigner la période complète (du ... au ...).');
        return;
      }
      if (exportStartDate > exportEndDate) {
        setExportErrorMessage('Période invalide : la date de début doit être antérieure ou égale à la date de fin.');
        return;
      }
    }

    const res = exportPointageExcel(
      currentCompany,
      allOuvriers,
      taches,
      domaines,
      defaultDomaineId,
      {
        mode: exportMode,
        singleDate: exportSingleDate,
        startDate: exportStartDate,
        endDate: exportEndDate,
      }
    );

    if (!res.success) {
      setExportErrorMessage(res.error || 'Erreur lors de la génération du fichier Excel.');
      return;
    }

    // Message de confirmation après export : "Export terminé : X lignes"
    setExportSuccessMessage(`Export terminé : ${res.totalLignes} lignes`);
  };

  // --- ACTIONS SOCIÉTÉS ---

  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyNom.trim()) return;

    const created = storage.saveCompany({
      nom: newCompanyNom.trim(),
      ville: newCompanyVille.trim(),
    });

    onSwitchCompany(created.id);
    setNewCompanyNom('');
    setNewCompanyVille('');
    setCompanyMessage(`Société "${created.nom}" créée et activée !`);
    setTimeout(() => setCompanyMessage(null), 3000);
  };

  // --- ACTIONS PARAMÈTRES GAZOIL ---

  const handleSaveSeuilGazoil = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(seuilGazoilInput.replace(',', '.'));
    if (isNaN(val) || val < 0) {
      setGazoilMessage('Veuillez saisir un seuil valide en litres.');
      return;
    }
    storage.setSeuilAlerteGazoil(currentCompany.id, val);
    setGazoilMessage(`✓ Seuil d'alerte gazoil enregistré à ${val} L.`);
    setTimeout(() => setGazoilMessage(null), 3000);
  };

  const handleConfirmStockInitialChange = () => {
    const val = parseFloat(stockInitialGazoilInput.replace(',', '.'));
    if (isNaN(val) || val < 0) {
      setGazoilMessage('Veuillez saisir un stock initial valide en litres.');
      return;
    }
    storage.setStockInitialGazoil(currentCompany.id, val);
    setShowConfirmStockInitialModal(false);
    setGazoilMessage(`✓ Stock initial gazoil mis à jour à ${val} L.`);
    setTimeout(() => setGazoilMessage(null), 3000);
  };

  // --- SAUVEGARDE & RESTAURATION & NETTOYAGE ---

  const handleExportBackup = () => {
    const jsonStr = storage.exportBackupJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const now = new Date();
    const jj = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const aaaa = now.getFullYear();
    const fileName = `pointage-backup-${jj}-${mm}-${aaaa}.json`;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMessage(`✓ Fichier "${fileName}" téléchargé avec succès.`);
    setTimeout(() => setBackupMessage(null), 4000);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          setBackupMessage('Erreur : Fichier JSON corrompu ou illisible.');
          return;
        }

        const validation = storage.validateBackupData(parsed);
        if (!validation.valid) {
          setBackupMessage(
            `Erreur de validation : ${validation.error || 'Fichier invalide'}. Aucune modification n'a été apportée à vos données.`
          );
          return;
        }

        setRestorePreview({
          content,
          counts: validation.counts,
          exportedAt: validation.exportedAt,
          schemaVersion: validation.schemaVersion,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erreur inconnue';
        setBackupMessage(`Erreur de lecture du fichier JSON : ${msg}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirmRestore = () => {
    if (!restorePreview) return;
    const res = storage.importBackupJSON(restorePreview.content);
    setRestorePreview(null);
    setBackupMessage(res.message);
    setTimeout(() => setBackupMessage(null), 4000);
  };

  const handleResetCache = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const k of keys) {
          await caches.delete(k);
        }
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  const handleConfirmClearAll = () => {
    if (clearConfirmInput.trim() !== 'EFFACER') return;
    storage.clearAllDataPermanently();
    setShowClearAllModal(false);
    setClearConfirmInput('');
    window.location.reload();
  };

  const handleResetDefaults = () => {
    if (
      window.confirm(
        'ATTENTION : Voulez-vous réinitialiser toutes les données aux 15 ouvriers et 4 tâches de test par défaut ?'
      )
    ) {
      storage.resetAllDataToDefault();
      setBackupMessage('Données réinitialisées aux 15 ouvriers et 4 tâches.');
      setTimeout(() => setBackupMessage(null), 3000);
    }
  };

  return (
    <div className="space-y-3 pb-24">
      {/* BOUTON EXPORTER EN EXCEL (CONFORME SPÉCIFICATION) */}
      <button
        type="button"
        onClick={() => {
          const today = new Date().toISOString().split('T')[0];
          setExportSingleDate(today);
          setExportStartDate(today);
          setExportEndDate(today);
          setExportErrorMessage(null);
          setExportSuccessMessage(null);
          setShowExportExcelModal(true);
        }}
        className="w-full bg-linear-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white p-3 rounded-2xl shadow-sm flex items-center justify-between transition cursor-pointer active:scale-[0.99]"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div className="text-left">
            <div className="text-sm font-black flex items-center gap-1.5">
              <span>Exporter en Excel</span>
              <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-mono">.xlsx</span>
            </div>
            <div className="text-[11px] text-emerald-100">
              Feuille "Pointage" avec tâches • Choix d'une date ou période
            </div>
          </div>
        </div>
        <span className="bg-white text-emerald-900 font-black text-xs px-3 py-1.5 rounded-xl shadow-2xs">
          Exporter ➔
        </span>
      </button>

      {/* Navigation sous-onglets de Gestion */}
      <div className="bg-white rounded-2xl p-1 shadow-xs border border-slate-200 grid grid-cols-6 gap-0.5 text-center">
        <button
          type="button"
          onClick={() => setActiveSubTab('ouvriers')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'ouvriers'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Ouvriers</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('taches')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'taches'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Tag className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Tâches</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('domaines')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'domaines'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <MapPin className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Domaines</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('gazoil')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'gazoil'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Fuel className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Gazoil</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('historique')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'historique'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Dates</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('societes')}
          className={`py-2 px-0.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition flex flex-col items-center gap-1 ${
            activeSubTab === 'societes'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="truncate">Données</span>
        </button>
      </div>

      {/* SOUS-ONGLET 1 : GESTION DES OUVRIERS */}
      {activeSubTab === 'ouvriers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-1">
            <div>
              <h3 className="text-sm font-black text-slate-800">Ouvriers du Domaine</h3>
              <p className="text-[11px] text-slate-500">
                Numéro unique obligatoire par ouvrier.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowImportOuvriersModal(true)}
                className="flex items-center gap-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold px-2.5 py-2 rounded-xl transition active:scale-95"
                title="Importer des ouvriers depuis un fichier Excel (.xlsx, .xls) ou CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Importer des ouvriers</span>
              </button>

              <button
                type="button"
                onClick={handleOpenNewOuvrier}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-2 rounded-xl shadow-xs transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter ouvrier</span>
              </button>
            </div>
          </div>

          {ouvrierSuccess && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-2.5 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{ouvrierSuccess}</span>
            </div>
          )}

          {/* Formulaire Modal / Carte Ajout / Modification Ouvrier */}
          {showOuvrierForm && (
            <form
              onSubmit={handleSaveOuvrier}
              className="bg-white rounded-2xl border-2 border-emerald-500 p-4 shadow-lg space-y-3 animate-in fade-in"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-black text-sm text-slate-800">
                  {editingOuvrier ? `Modifier Ouvrier #${editingOuvrier.numero}` : 'Ajouter un nouvel ouvrier'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowOuvrierForm(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {ouvrierError && (
                <div className="bg-red-50 border border-red-300 text-red-900 text-xs p-2 rounded-xl flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{ouvrierError}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Numéro *
                  </label>
                  <input
                    type="number"
                    value={ouvrierForm.numero}
                    onChange={(e) => setOuvrierForm({ ...ouvrierForm, numero: e.target.value })}
                    placeholder="1"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-base font-black text-center focus:bg-white focus:border-emerald-600 outline-none"
                    required
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Nom complet *
                  </label>
                  <input
                    type="text"
                    value={ouvrierForm.nom}
                    onChange={(e) => setOuvrierForm({ ...ouvrierForm, nom: e.target.value })}
                    placeholder="ex: Ahmed Mansouri"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-bold focus:bg-white focus:border-emerald-600 outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Téléphone (optionnel)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={ouvrierForm.telephone}
                    onChange={(e) => setOuvrierForm({ ...ouvrierForm, telephone: e.target.value })}
                    placeholder="06 12 34 56 78"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:bg-white focus:border-emerald-600 outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="ouvrier_actif"
                  checked={ouvrierForm.actif}
                  onChange={(e) => setOuvrierForm({ ...ouvrierForm, actif: e.target.checked })}
                  className="w-4 h-4 text-emerald-600 rounded-sm focus:ring-emerald-500"
                />
                <label htmlFor="ouvrier_actif" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Ouvrier actif (participe au pointage quotidien)
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 rounded-xl transition"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setShowOuvrierForm(false)}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 rounded-xl transition"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* Liste des ouvriers */}
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
            {allOuvriers.map((ouvrier) => (
              <div
                key={ouvrier.id}
                className={`p-3 flex items-center justify-between gap-2 transition ${
                  ouvrier.actif ? 'hover:bg-slate-50' : 'bg-slate-100/70 opacity-60'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl font-black text-sm flex items-center justify-center shrink-0 ${
                      ouvrier.actif
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-400 text-slate-100 line-through'
                    }`}
                  >
                    {ouvrier.numero}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-slate-800 truncate">
                      {ouvrier.nom}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-2">
                      <span>{ouvrier.actif ? 'Actif' : 'Désactivé'}</span>
                      {ouvrier.telephone && <span>• 📞 {ouvrier.telephone}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {/* Bouton Activer/Désactiver */}
                  <button
                    type="button"
                    onClick={() => handleToggleOuvrier(ouvrier)}
                    className={`p-1.5 rounded-lg transition ${
                      ouvrier.actif
                        ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                        : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                    title={ouvrier.actif ? 'Désactiver' : 'Réactiver'}
                  >
                    <Power className="w-4 h-4" />
                  </button>

                  {/* Modifier */}
                  <button
                    type="button"
                    onClick={() => handleOpenEditOuvrier(ouvrier)}
                    className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                    title="Modifier"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* Supprimer */}
                  <button
                    type="button"
                    onClick={() => handleDeleteOuvrier(ouvrier)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SOUS-ONGLET 2 : GESTION DES TÂCHES */}
      {activeSubTab === 'taches' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800">Tâches & Postes</h3>
              <p className="text-[11px] text-slate-500">
                Code court unique et nom de poste (ex: R01 - RECOLTE).
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowImportTachesModal(true);
                  setShowTacheForm(false);
                }}
                className="flex items-center gap-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold px-2.5 py-2 rounded-xl transition cursor-pointer"
                title="Importer des tâches depuis Excel, CSV ou texte collé"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Importer tâches</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingTache(null);
                  setTacheCode('');
                  setTacheNom('');
                  setTacheCouleur('#16a34a');
                  setTacheError(null);
                  setShowTacheForm(true);
                }}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-2 rounded-xl shadow-xs transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nouvelle</span>
              </button>
            </div>
          </div>

          {tacheSuccess && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl p-2.5 text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{tacheSuccess}</span>
            </div>
          )}

          {showTacheForm && (
            <form
              onSubmit={handleSaveTache}
              className="bg-white rounded-2xl border-2 border-emerald-500 p-4 shadow-lg space-y-3 animate-in fade-in"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-black text-sm text-slate-800">
                  {editingTache ? `Modifier la tâche ${formatTacheLabel(editingTache)}` : 'Ajouter une nouvelle tâche'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowTacheForm(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {tacheError && (
                <div className="text-red-800 bg-red-50 border border-red-200 text-xs p-2.5 rounded-xl font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{tacheError}</span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Code (unique)
                  </label>
                  <input
                    type="text"
                    value={tacheCode}
                    onChange={(e) => setTacheCode(e.target.value.toUpperCase())}
                    placeholder="ex: R01"
                    className="w-full font-mono uppercase font-black bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm text-center focus:bg-white focus:border-emerald-600 outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">Ex: R01, E01</span>
                </div>

                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">
                    Nom de la tâche *
                  </label>
                  <input
                    type="text"
                    value={tacheNom}
                    onChange={(e) => setTacheNom(e.target.value.toUpperCase())}
                    placeholder="EX: RECOLTE"
                    className="w-full uppercase font-black bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm focus:bg-white focus:border-emerald-600 outline-none"
                    required
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Aperçu : {formatTacheLabel({ code: tacheCode, nom: tacheNom || 'NOM' })}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  Couleur du badge
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={tacheCouleur}
                    onChange={(e) => setTacheCouleur(e.target.value)}
                    className="w-10 h-10 rounded-xl border border-slate-300 cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-500">{tacheCouleur}</span>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2.5 rounded-xl cursor-pointer shadow-xs transition"
                >
                  Enregistrer la tâche
                </button>
                <button
                  type="button"
                  onClick={() => setShowTacheForm(false)}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 rounded-xl cursor-pointer transition"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-xs">
            {taches.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">
                Aucune tâche configurée. Cliquez sur &laquo;&nbsp;Nouvelle&nbsp;&raquo; ou &laquo;&nbsp;Importer tâches&nbsp;&raquo;.
              </div>
            ) : (
              taches.map((tache) => (
                <div
                  key={tache.id}
                  className="p-3.5 flex items-center justify-between gap-2 hover:bg-slate-50 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="w-4 h-4 rounded-full shadow-2xs shrink-0"
                      style={{ backgroundColor: tache.couleur || '#16a34a' }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {tache.code && (
                          <span className="font-mono font-black text-xs bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-md">
                            {tache.code}
                          </span>
                        )}
                        <span className="font-black text-xs text-slate-800 tracking-wide uppercase truncate">
                          {tache.nom}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        Format affiché : <strong className="text-slate-600 font-mono">{formatTacheLabel(tache)}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTache(tache);
                        setTacheCode(tache.code || '');
                        setTacheNom(tache.nom);
                        setTacheCouleur(tache.couleur || '#16a34a');
                        setTacheError(null);
                        setShowTacheForm(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition"
                      title="Modifier la tâche"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTache(tache)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                      title="Supprimer la tâche"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SOUS-ONGLET DOMAINES (D1 à D5) */}
      {activeSubTab === 'domaines' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-800">Domaines & WhatsApp</h3>
              <p className="text-[11px] text-slate-500">
                Domaine par défaut et ordre pour le récapitulatif WhatsApp.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetDomainesOrder}
              className="text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1.5 rounded-xl border border-emerald-200 transition cursor-pointer"
              title="Rétablir l'ordre d'origine : D2, D3, D5, D1, D4"
            >
              Ordre D2, D3, D5...
            </button>
          </div>

          {domaineMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-2xl text-xs font-bold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{domaineMessage}</span>
            </div>
          )}

          {domaineError && (
            <div className="p-3 bg-red-50 border border-red-300 text-red-800 rounded-2xl text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{domaineError}</span>
            </div>
          )}

          {/* Formulaire Renommer un domaine */}
          {editingDomaine && (
            <form
              onSubmit={handleRenameDomaine}
              className="bg-white rounded-2xl border-2 border-emerald-500 p-3.5 shadow-md space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800">
                  Renommer le domaine &laquo;&nbsp;{editingDomaine.nom}&nbsp;&raquo;
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingDomaine(null);
                    setDomaineError(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                type="text"
                value={domaineNomInput}
                onChange={(e) => setDomaineNomInput(e.target.value.toUpperCase())}
                placeholder="Nouveau nom (ex: D1 NORD)"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-black uppercase outline-none focus:bg-white focus:border-emerald-600"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs py-2 rounded-xl transition cursor-pointer"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingDomaine(null);
                    setDomaineError(null);
                  }}
                  className="px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2 rounded-xl transition cursor-pointer"
                >
                  Annuler
                </button>
              </div>
            </form>
          )}

          {/* Domaine par défaut */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-800">Domaine par défaut :</span>
              <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                {(domaines && domaines.length > 0 ? domaines : storage.getDomaines()).find(
                  (d) => d.id === defaultDomaineId
                )?.nom || 'D2'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Pré-sélectionné automatiquement lors du pointage de chaque ouvrier.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(domaines && domaines.length > 0 ? domaines : storage.getDomaines()).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => handleSetDefault(d.id)}
                  className={`px-3 py-1.5 rounded-xl font-black text-xs transition border cursor-pointer ${
                    defaultDomaineId === d.id
                      ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs ring-2 ring-emerald-300'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  {d.nom} {defaultDomaineId === d.id && '✓'}
                </button>
              ))}
            </div>
          </div>

          {/* Liste et Ordre des Domaines pour WhatsApp */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs space-y-3">
            <div>
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider">
                Ordre du récapitulatif WhatsApp
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Sur WhatsApp, les domaines avec ouvriers pointés s'affichent dans l'ordre ci-dessous.
              </p>
            </div>

            <div className="space-y-1.5">
              {(domaines && domaines.length > 0 ? domaines : storage.getDomaines()).map(
                (dom, index, arr) => {
                  const isDefault = dom.id === defaultDomaineId;
                  return (
                    <div
                      key={dom.id}
                      className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2 hover:bg-white transition"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-lg bg-slate-200 text-slate-700 font-mono font-black text-xs flex items-center justify-center shrink-0">
                          {index + 1}
                        </span>
                        <span className="font-black text-sm text-slate-900 tracking-wide uppercase truncate">
                          {dom.nom}
                        </span>
                        {isDefault && (
                          <span className="text-[9px] font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded-full border border-emerald-200 shrink-0">
                            Par défaut
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Monter */}
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => handleMoveDomaine(index, 'up')}
                          className={`p-1.5 rounded-lg transition ${
                            index === 0
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-600 hover:bg-slate-200 active:scale-95 cursor-pointer'
                          }`}
                          title="Monter dans l'ordre"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>

                        {/* Descendre */}
                        <button
                          type="button"
                          disabled={index === arr.length - 1}
                          onClick={() => handleMoveDomaine(index, 'down')}
                          className={`p-1.5 rounded-lg transition ${
                            index === arr.length - 1
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-600 hover:bg-slate-200 active:scale-95 cursor-pointer'
                          }`}
                          title="Descendre dans l'ordre"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>

                        {/* Renommer */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDomaine(dom);
                            setDomaineNomInput(dom.nom);
                            setDomaineError(null);
                          }}
                          className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition cursor-pointer"
                          title="Renommer ce domaine"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {/* Supprimer avec confirmation */}
                        <button
                          type="button"
                          onClick={() => handleDeleteDomaine(dom)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                          title="Supprimer ce domaine"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {/* Ajouter un domaine */}
            <form onSubmit={handleAddDomaine} className="pt-2 border-t border-slate-100 flex gap-2">
              <input
                type="text"
                value={newDomaineNom}
                onChange={(e) => setNewDomaineNom(e.target.value.toUpperCase())}
                placeholder="Nom nouveau domaine (ex: D6)"
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold uppercase outline-none focus:bg-white focus:border-emerald-600"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-3 py-2 rounded-xl transition flex items-center gap-1 active:scale-95 shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ajouter</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SOUS-ONGLET 4 : PARAMÈTRES GAZOIL */}
      {activeSubTab === 'gazoil' && (
        <div className="space-y-3">
          {gazoilMessage && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 p-3 rounded-2xl text-xs font-bold animate-fade-in flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{gazoilMessage}</span>
            </div>
          )}

          {/* CARTE 1 : RÉCAPITULATIF JAUGE ACTUELLE */}
          <div className="bg-slate-900 text-white rounded-2xl p-4 shadow-sm border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Fuel className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-bold uppercase text-slate-300">
                  État actuel du stock de gazoil
                </span>
              </div>
              <span
                className={`text-xs font-black px-2 py-0.5 rounded-lg ${
                  gazoilCalcul.isStockBas
                    ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
              >
                {gazoilCalcul.isStockBas ? 'Stock bas' : 'Stock normal'}
              </span>
            </div>

            <div className="flex items-baseline gap-2 my-2">
              <span className="text-3xl font-black text-emerald-400">
                {gazoilCalcul.stockActuel} L
              </span>
              <span className="text-xs text-slate-400">disponibles en cuve</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-center text-[11px]">
              <div>
                <span className="text-slate-400 block text-[10px]">Initial</span>
                <span className="font-bold text-slate-200">{gazoilCalcul.stockInitial} L</span>
              </div>
              <div>
                <span className="text-emerald-400 block text-[10px]">+ Entrées</span>
                <span className="font-bold text-emerald-300">+{gazoilCalcul.totalEntrees} L</span>
              </div>
              <div>
                <span className="text-rose-400 block text-[10px]">− Sorties</span>
                <span className="font-bold text-rose-300">-{gazoilCalcul.totalSorties} L</span>
              </div>
            </div>
          </div>

          {/* CARTE 2 : SEUIL PARAMÉTRABLE D'ALERTE */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div>
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-black text-slate-800">
                  Seuil d'alerte de stock bas (L)
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Par défaut 20 L. Déclenche une bannière rouge sur l'écran d'accueil et une
                notification du navigateur par passage sous ce niveau.
              </p>
            </div>

            <form onSubmit={handleSaveSeuilGazoil} className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={seuilGazoilInput}
                  onChange={(e) => setSeuilGazoilInput(e.target.value)}
                  placeholder="20"
                  className="w-full text-base font-bold p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  Litres
                </span>
              </div>
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-4 py-3 rounded-xl shadow-xs transition active:scale-95 shrink-0"
              >
                Enregistrer seuil
              </button>
            </form>
          </div>

          {/* CARTE 3 : MODIFICATION DU STOCK INITIAL AVEC CONFIRMATION */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div>
              <h3 className="text-sm font-black text-slate-800">
                Modification du stock initial de gazoil
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Valeur actuelle : <strong>{gazoilConfig.stockInitial} L</strong>. Modifier cette
                valeur recalcule automatiquement le stock disponible actuel.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={stockInitialGazoilInput}
                  onChange={(e) => setStockInitialGazoilInput(e.target.value)}
                  className="w-full text-base font-bold p-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:border-emerald-600 focus:bg-white outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  Litres
                </span>
              </div>

              <button
                type="button"
                onClick={() => setShowConfirmStockInitialModal(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-4 py-3 rounded-xl shadow-xs transition active:scale-95 shrink-0"
              >
                Modifier initial
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE DE CONFIRMATION MODIFICATION DU STOCK INITIAL */}
      {showConfirmStockInitialModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertCircle className="w-6 h-6" />
              <h4 className="font-black text-slate-900 text-sm">
                Confirmer la modification du stock initial ?
              </h4>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Le stock initial passera de <strong>{gazoilConfig.stockInitial} L</strong> à{' '}
              <strong>{stockInitialGazoilInput} L</strong>. Toutes les entrées et sorties existantes
              seront conservées et le nouveau stock actuel sera ajusté en conséquence.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmStockInitialModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmStockInitialChange}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition active:scale-95"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SOUS-ONGLET 3 : HISTORIQUE DES DATES */}
      {activeSubTab === 'historique' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-black text-slate-800">
              Consultation des jours précédents
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sélectionnez une date passée pour consulter les présences ou regénérer un récapitulatif.
            </p>
          </div>

          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <label className="text-xs font-bold text-slate-700 block">
              Date actuelle sélectionnée :
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) {
                  onSelectDate(e.target.value);
                }
              }}
              className="w-full bg-white border border-slate-300 rounded-xl p-3 text-base font-black text-slate-800 focus:border-emerald-600 outline-none"
            />

            <button
              type="button"
              onClick={() => onSelectDate(new Date().toISOString().split('T')[0])}
              className="w-full bg-emerald-600 text-white font-bold text-xs py-2 rounded-xl mt-1 hover:bg-emerald-700 transition"
            >
              Revenir à la date d'aujourd'hui
            </button>
          </div>
        </div>
      )}

      {/* SOUS-ONGLET 4 : SOCIÉTÉ ET SAUVEGARDE */}
      {activeSubTab === 'societes' && (
        <div className="space-y-3">
          {/* Multi-tenant Domaine Actuel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-800">
                  Exploitation Actuelle
                </h3>
                <p className="text-xs text-slate-500">{currentCompany.nom}</p>
              </div>
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded-lg">
                ID: {currentCompany.id}
              </span>
            </div>

            {companyMessage && (
              <div className="text-xs font-bold text-emerald-800 bg-emerald-50 p-2 rounded-xl">
                {companyMessage}
              </div>
            )}

            {/* Créer un nouveau domaine */}
            <form onSubmit={handleCreateCompany} className="pt-2 border-t border-slate-100 space-y-2">
              <span className="text-xs font-bold text-slate-700 block">
                Créer un nouveau domaine agricole isolé :
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newCompanyNom}
                  onChange={(e) => setNewCompanyNom(e.target.value)}
                  placeholder="Nom (ex: Domaine Souss)"
                  className="bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold outline-none"
                  required
                />
                <input
                  type="text"
                  value={newCompanyVille}
                  onChange={(e) => setNewCompanyVille(e.target.value)}
                  placeholder="Région / Ville"
                  className="bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-medium outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-2 rounded-xl transition"
              >
                Créer et basculer sur ce domaine
              </button>
            </form>
          </div>

          {/* Gestion des Comptes & Caporals */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-2">
            <div>
              <h3 className="text-sm font-black text-slate-800">
                Comptes & Caporals (Multi-comptes)
              </h3>
              <p className="text-xs text-slate-500">
                Créer des comptes pour vos caporals et gérer leurs accès au module Récolte.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowComptesModal(true)}
              className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-black text-white text-xs font-black py-2.5 px-3 rounded-xl shadow-xs transition"
            >
              <Users className="w-4 h-4 text-emerald-400" />
              <span>Gérer les comptes et mots de passe caporals</span>
            </button>
          </div>

          {/* Sauvegarde & Restauration */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
            <h3 className="text-sm font-black text-slate-800">
              Sauvegarde & Restauration des Données
            </h3>
            <p className="text-xs text-slate-500">
              Toutes les données sont conservées hors-ligne dans ce navigateur. Vous pouvez exporter un fichier de sauvegarde à tout moment.
            </p>

            {/* Avertissement stockage et recommandation */}
            <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 space-y-1.5 leading-relaxed">
              <div className="flex items-center gap-1.5 font-black text-amber-950">
                <AlertCircle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Stockage local & Sécurité des données</span>
              </div>
              <p>
                Vos données sont enregistrées en local sur cet appareil (quota navigateur ~5 à 10 Mo).
              </p>
              <p className="font-bold text-amber-950">
                👉 Recommandation essentielle : Exportez régulièrement une sauvegarde JSON et conservez-la sur un ordinateur, une clé USB ou par email.
              </p>
            </div>

            {backupMessage && (
              <div className="text-xs font-bold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                {backupMessage}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black py-2.5 px-3 rounded-xl transition"
              >
                <Download className="w-4 h-4 text-emerald-700" />
                <span>Exporter sauvegarde (JSON)</span>
              </button>

              <label
                htmlFor={importFileId}
                className="flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black py-2.5 px-3 rounded-xl transition cursor-pointer"
              >
                <Upload className="w-4 h-4 text-blue-700" />
                <span>Restaurer sauvegarde</span>
                <input
                  id={importFileId}
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
              </label>
            </div>

            {/* Réinitialiser le cache (désinscrit le Service Worker et recharge sans effacer les données) */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleResetCache}
                className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold py-2.5 px-3 rounded-xl transition"
                title="Désinscrit le service worker et recharge l'application sans effacer les données"
              >
                <RotateCcw className="w-4 h-4 text-slate-600" />
                <span>Réinitialiser le cache (sans perte de données)</span>
              </button>
            </div>

            {/* Réinitialisation aux données de test */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleResetDefaults}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-amber-700 hover:text-amber-800 hover:bg-amber-50 py-2 rounded-xl border border-dashed border-amber-300 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Réinitialiser aux 15 ouvriers de test</span>
              </button>
            </div>

            {/* "Effacer toutes les données" tout en bas, en rouge, avec double confirmation (taper EFFACER) */}
            <div className="pt-3 border-t border-red-200">
              <button
                type="button"
                onClick={() => {
                  setClearConfirmInput('');
                  setShowClearAllModal(true);
                }}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white text-xs font-black py-3 px-3 rounded-xl shadow-xs transition"
              >
                <Trash2 className="w-4 h-4 text-white" />
                <span>Effacer toutes les données</span>
              </button>
              <p className="text-[10px] text-red-600 font-semibold text-center mt-1">
                Zone de danger : suppression définitive et irréversible de toutes les données locales
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MODALE EXPORT EXCEL (SHEETJS) */}
      {showExportExcelModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-sm">Exporter en Excel</h4>
                  <p className="text-[11px] text-slate-500">Feuille "Pointage" avec colonnes exactes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportExcelModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Choix du mode d'export */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExportMode('unique')}
                  className={`p-2.5 rounded-xl border text-xs font-black transition ${
                    exportMode === 'unique'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-xs'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  Une seule date
                </button>
                <button
                  type="button"
                  onClick={() => setExportMode('periode')}
                  className={`p-2.5 rounded-xl border text-xs font-black transition ${
                    exportMode === 'periode'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 shadow-xs'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  Période (du ... au ...)
                </button>
              </div>

              {exportMode === 'unique' ? (
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Date à exporter :
                  </label>
                  <input
                    type="date"
                    value={exportSingleDate}
                    onChange={(e) => {
                      setExportSingleDate(e.target.value);
                      setExportErrorMessage(null);
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-sm font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block font-mono">
                    Nom du fichier : {exportSingleDate ? `pointage-${exportSingleDate.split('-').reverse().join('-')}.xlsx` : 'pointage-JJ-MM-AAAA.xlsx'}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">Du :</label>
                      <input
                        type="date"
                        value={exportStartDate}
                        onChange={(e) => {
                          setExportStartDate(e.target.value);
                          setExportErrorMessage(null);
                        }}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">Au :</label>
                      <input
                        type="date"
                        value={exportEndDate}
                        onChange={(e) => {
                          setExportEndDate(e.target.value);
                          setExportErrorMessage(null);
                        }}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2 text-xs font-bold text-slate-800 outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 block font-mono">
                    Nom du fichier : {exportStartDate && exportEndDate ? `pointage-${exportStartDate.split('-').reverse().join('-')}_au_${exportEndDate.split('-').reverse().join('-')}.xlsx` : 'pointage-JJ-MM-AAAA_au_JJ-MM-AAAA.xlsx'}
                  </span>
                </div>
              )}
            </div>

            {/* Message de succès ou d'erreur */}
            {exportSuccessMessage && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl text-xs font-black flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{exportSuccessMessage}</span>
              </div>
            )}

            {exportErrorMessage && (
              <div className="p-3 bg-red-50 border border-red-300 text-red-900 rounded-xl text-xs font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{exportErrorMessage}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowExportExcelModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleTriggerExcelExport}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition active:scale-95 flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span>Générer et télécharger</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE D'APERÇU ET CONFIRMATION DE RESTAURATION */}
      {restorePreview && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 text-blue-600">
              <Upload className="w-6 h-6 shrink-0" />
              <div>
                <h4 className="font-black text-slate-900 text-sm">Aperçu avant restauration</h4>
                <p className="text-[11px] text-slate-500">Validation d'intégrité réussie</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              Le fichier est valide. Voici le contenu qui sera restauré :
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5 font-bold">
              <div className="flex justify-between text-slate-700">
                <span>Ouvriers :</span>
                <span className="font-mono text-emerald-700">{restorePreview.counts.ouvriers}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Tâches :</span>
                <span className="font-mono text-emerald-700">{restorePreview.counts.taches}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Pointages du matin :</span>
                <span className="font-mono text-emerald-700">{restorePreview.counts.pointages}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Affectations aux tâches :</span>
                <span className="font-mono text-emerald-700">{restorePreview.counts.affectations}</span>
              </div>
              <div className="flex justify-between text-slate-700">
                <span>Heures supplémentaires :</span>
                <span className="font-mono text-emerald-700">{restorePreview.counts.heuresSupplementaires}</span>
              </div>
              {restorePreview.counts.gazoilMouvements > 0 && (
                <div className="flex justify-between text-slate-700">
                  <span>Mouvements gazoil :</span>
                  <span className="font-mono text-emerald-700">{restorePreview.counts.gazoilMouvements}</span>
                </div>
              )}
              {restorePreview.exportedAt && (
                <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                  <span>Date sauvegarde :</span>
                  <span>{new Date(restorePreview.exportedAt).toLocaleDateString('fr-FR')}</span>
                </div>
              )}
            </div>

            <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-[11px] text-blue-900 leading-relaxed font-medium">
              <span className="font-black">Sécurité atomique :</span> en cas d'erreur ou d'interruption lors de l'écriture, vos données actuelles sont intégralement remises en place (rollback automatique garanti).
            </div>

            <p className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg font-medium">
              Attention : les données locales actuelles seront remplacées par le contenu de cette sauvegarde.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRestorePreview(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-black py-2.5 rounded-xl text-xs shadow-md transition active:scale-95"
              >
                Confirmer remplacement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE DOUBLE CONFIRMATION : EFFACER TOUTES LES DONNÉES */}
      {showClearAllModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border-2 border-red-500 space-y-3">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h4 className="font-black text-slate-900 text-sm">Effacer TOUTES les données ?</h4>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Cette action est <strong>définitive et irréversible</strong>. Tous les ouvriers, tâches,
              pointages, affectations, historiques gazoil et paramètres seront effacés du téléphone.
            </p>

            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-bold text-slate-700 block">
                Pour confirmer, tapez le mot <span className="text-red-600 font-black">EFFACER</span> ci-dessous :
              </label>
              <input
                type="text"
                value={clearConfirmInput}
                onChange={(e) => setClearConfirmInput(e.target.value.toUpperCase())}
                placeholder="Tapez EFFACER"
                className="w-full uppercase font-black tracking-widest text-center text-sm p-2.5 bg-red-50 border-2 border-red-300 rounded-xl outline-none focus:border-red-600 focus:bg-white"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowClearAllModal(false);
                  setClearConfirmInput('');
                }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={clearConfirmInput.trim() !== 'EFFACER'}
                onClick={handleConfirmClearAll}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-200 text-white disabled:text-slate-400 font-black py-2.5 rounded-xl text-xs shadow-md transition disabled:cursor-not-allowed"
              >
                TOUT EFFACER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale d'importation d'ouvriers depuis Excel / CSV */}
      <ImportOuvriersModal
        isOpen={showImportOuvriersModal}
        onClose={() => setShowImportOuvriersModal(false)}
        companyId={currentCompany.id}
        existingWorkers={allOuvriers}
        onImportSuccess={({ added, updated, deactivated, doublons, erreurs }) => {
          const details: string[] = [];
          if (added) details.push(`${added} ajouté(s)`);
          if (updated) details.push(`${updated} mis à jour`);
          if (deactivated) details.push(`${deactivated} désactivé(s)`);
          const mainMsg = details.length > 0 ? details.join(', ') : `${added} ajouté(s)`;
          setOuvrierSuccess(
            `✓ Importation terminée : ${mainMsg} (${doublons} doublon(s) et ${erreurs} erreur(s) ignoré(s)).`
          );
          setTimeout(() => setOuvrierSuccess(null), 5000);
        }}
      />

      {/* Modale d'importation de tâches depuis Excel / CSV / Texte */}
      <ImportTachesModal
        isOpen={showImportTachesModal}
        onClose={() => setShowImportTachesModal(false)}
        companyId={currentCompany.id}
        existingTasks={taches}
        onImportSuccess={({ added, updated, deactivated }) => {
          const details: string[] = [];
          if (added) details.push(`${added} ajoutée(s)`);
          if (updated) details.push(`${updated} mise(s) à jour`);
          if (deactivated) details.push(`${deactivated} désactivée(s)`);
          const mainMsg = details.length > 0 ? details.join(', ') : `${added} ajoutée(s)`;
          setTacheSuccess(`✓ Importation terminée : ${mainMsg}.`);
          setTimeout(() => setTacheSuccess(null), 5000);
        }}
      />

      {/* Modale de gestion des comptes et caporals */}
      <GestionComptesModal
        isOpen={showComptesModal}
        onClose={() => setShowComptesModal(false)}
        users={storage.getUsers()}
        onSaveUser={storage.saveUser}
        onToggleUserActif={storage.toggleUserActif}
        onDeleteUser={storage.deleteUser}
      />
    </div>
  );
};
