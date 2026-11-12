/**
 * Gestion du Catalogue des Contrats & Importation Excel / CSV
 * - Importation de fichiers Excel (.xlsx, .xls) et CSV
 * - Prévisualisation, correspondance des colonnes et correction des erreurs
 * - Gestion des doublons (mise à jour des prix ou conservation)
 * - Ajout, modification, activation/désactivation manuelle
 * - Sauvegarde Supabase PostgreSQL avec persistance miroir
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Upload,
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Tag,
  DollarSign,
  Layers,
  ArrowRight,
  FileCheck,
  Check,
  Building2,
  Download,
} from 'lucide-react';
import { ContractuelContrat, ModeRemuneration, Domaine, UserAccount } from '../../types';
import {
  getContractuelContrats,
  saveContractuelContrat,
  importContractuelContrats,
  deleteContractuelContrat,
} from '../../services/contractuelService';

interface ContractuelContratManagementProps {
  domaines: Domaine[];
  currentUser: UserAccount;
}

interface ParsedRow {
  index: number;
  raw: Record<string, any>;
  designation: string;
  prix_unitaire: number;
  unite: string;
  mode_remuneration: ModeRemuneration;
  code?: string;
  description?: string;
  isValid: boolean;
  errors: string[];
}

export const ContractuelContratManagement: React.FC<ContractuelContratManagementProps> = ({
  domaines,
  currentUser,
}) => {
  const [contrats, setContrats] = useState<ContractuelContrat[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showInactive, setShowInactive] = useState<boolean>(false);

  // Modale d'ajout / édition manuelle
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingContrat, setEditingContrat] = useState<Partial<ContractuelContrat> | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Modale d'importation Excel / CSV
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<Record<string, any>[]>([]);

  // Correspondance des colonnes
  const [colDesignation, setColDesignation] = useState<string>('');
  const [colPrix, setColPrix] = useState<string>('');
  const [colUnite, setColUnite] = useState<string>('');
  const [colCode, setColCode] = useState<string>('');
  const [colDescription, setColDescription] = useState<string>('');
  const [colMode, setColMode] = useState<string>('');
  const [dedupMode, setDedupMode] = useState<'update' | 'skip'>('update');

  // Lignes parsées pour aperçu et correction
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadContrats();
  }, []);

  async function loadContrats() {
    setLoading(true);
    try {
      const res = await getContractuelContrats();
      if (res.success) {
        setContrats(res.contrats);
      }
    } catch (err) {
      console.error('Erreur chargement contrats:', err);
    } finally {
      setLoading(false);
    }
  }

  // Filtrage
  const filteredContrats = useMemo(() => {
    return contrats.filter((c) => {
      if (!showInactive && !c.actif) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchDesig = c.designation.toLowerCase().includes(q);
        const matchCode = c.code?.toLowerCase().includes(q);
        const matchDesc = c.description?.toLowerCase().includes(q);
        if (!matchDesig && !matchCode && !matchDesc) return false;
      }
      return true;
    });
  }, [contrats, showInactive, searchQuery]);

  // Statistiques du catalogue
  const stats = useMemo(() => {
    const total = contrats.length;
    const actifs = contrats.filter((c) => c.actif).length;
    const prixMoyen =
      actifs > 0
        ? contrats.filter((c) => c.actif).reduce((s, c) => s + c.prix_unitaire, 0) / actifs
        : 0;

    return { total, actifs, prixMoyen };
  }, [contrats]);

  // ACTION : Ouvrir création manuelle
  const handleOpenCreate = () => {
    setEditingContrat({
      designation: '',
      prix_unitaire: 120,
      unite: 'JOUR',
      mode_remuneration: 'JOUR',
      code: `CTR-${String(contrats.length + 1).padStart(3, '0')}`,
      description: '',
      actif: true,
    });
    setIsModalOpen(true);
  };

  // ACTION : Ouvrir modification manuelle
  const handleOpenEdit = (c: ContractuelContrat) => {
    setEditingContrat({ ...c });
    setIsModalOpen(true);
  };

  // ACTION : Sauvegarde manuelle
  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContrat || !editingContrat.designation?.trim()) {
      alert('La désignation du contrat est obligatoire.');
      return;
    }

    setSaving(true);
    try {
      const res = await saveContractuelContrat({
        ...editingContrat,
        designation: editingContrat.designation.trim(),
        prix_unitaire: Number(editingContrat.prix_unitaire) || 0,
        unite: editingContrat.unite?.trim() || editingContrat.mode_remuneration || 'JOUR',
      });

      if (res.success && res.contrat) {
        setContrats((prev) => {
          const idx = prev.findIndex((item) => item.id === res.contrat!.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = res.contrat!;
            return next;
          }
          return [res.contrat!, ...prev];
        });
        setIsModalOpen(false);
        setEditingContrat(null);
      } else {
        alert(res.error || 'Erreur lors de l’enregistrement du contrat.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  };

  // ACTION : Toggle Actif/Inactif
  const handleToggleActif = async (c: ContractuelContrat) => {
    const updated = { ...c, actif: !c.actif };
    try {
      const res = await saveContractuelContrat(updated);
      if (res.success) {
        setContrats((prev) => prev.map((item) => (item.id === c.id ? { ...item, actif: !c.actif } : item)));
      }
    } catch (err) {
      console.warn('Erreur toggle actif contrat:', err);
    }
  };

  // ACTION : Supprimer un contrat
  const handleDeleteContrat = async (c: ContractuelContrat) => {
    if (!confirm(`Supprimer définitivement le contrat "${c.designation}" (${c.prix_unitaire} DH) ?`)) {
      return;
    }

    try {
      const res = await deleteContractuelContrat(c.id);
      if (res.success) {
        setContrats((prev) => prev.filter((item) => item.id !== c.id));
      } else {
        alert(res.error || 'Erreur lors de la suppression.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    }
  };

  // --------------------------------------------------------------------------
  // LOGIQUE D'IMPORTATION EXCEL / CSV
  // --------------------------------------------------------------------------

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const data: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (data.length === 0) {
          alert('Le fichier sélectionné est vide.');
          return;
        }

        const headers = Object.keys(data[0] || {});
        setRawHeaders(headers);
        setRawData(data);

        // Détection automatique intelligente des colonnes
        detectAutoMapping(headers);
        setImportStep('mapping');
      } catch (err: any) {
        alert('Erreur lors de la lecture du fichier Excel: ' + err.message);
      }
    };
    reader.readAsBinaryString(file);
  };

  const detectAutoMapping = (headers: string[]) => {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    headers.forEach((h) => {
      const norm = normalize(h);
      // Désignation / Nom
      if (
        !colDesignation &&
        (norm.includes('nom') ||
          norm.includes('desig') ||
          norm.includes('contrat') ||
          norm.includes('tache') ||
          norm.includes('libelle') ||
          norm.includes('activite') ||
          norm.includes('intitule'))
      ) {
        setColDesignation(h);
      }
      // Prix / Tarif
      if (
        !colPrix &&
        (norm.includes('prix') ||
          norm.includes('tarif') ||
          norm.includes('montant') ||
          norm.includes('pu') ||
          norm.includes('cout') ||
          norm.includes('dh') ||
          norm.includes('taux'))
      ) {
        setColPrix(h);
      }
      // Unité
      if (!colUnite && (norm.includes('unite') || norm.includes('mesure') || norm.includes('mode'))) {
        setColUnite(h);
      }
      // Code
      if (!colCode && (norm.includes('code') || norm.includes('ref') || norm.includes('id') || norm.includes('matricule'))) {
        setColCode(h);
      }
      // Description / Note
      if (!colDescription && (norm.includes('desc') || norm.includes('note') || norm.includes('obs') || norm.includes('remarque'))) {
        setColDescription(h);
      }
    });
  };

  // Passer à l'aperçu après le mapping
  const handleGeneratePreview = () => {
    if (!colDesignation || !colPrix) {
      alert('Veuillez sélectionner au moins les colonnes "Désignation" et "Prix".');
      return;
    }

    const rows: ParsedRow[] = rawData.map((row, idx) => {
      const desigRaw = String(row[colDesignation] || '').trim();
      const prixRaw = Number(String(row[colPrix] || '').replace(',', '.').replace(/[^0-9.]/g, ''));
      const uniteRaw = colUnite ? String(row[colUnite] || '').trim().toUpperCase() : 'JOUR';
      const codeRaw = colCode ? String(row[colCode] || '').trim().toUpperCase() : undefined;
      const descRaw = colDescription ? String(row[colDescription] || '').trim() : undefined;

      const rawMode = colMode ? String(row[colMode] || '').trim().toUpperCase() : uniteRaw;
      const modeClean = (['JOUR', 'TACHE', 'UNITE', 'HEURE'].includes(rawMode) ? rawMode : 'JOUR') as ModeRemuneration;

      const errors: string[] = [];
      if (!desigRaw) errors.push('Désignation manquante');
      if (isNaN(prixRaw) || prixRaw < 0) errors.push('Prix invalide');

      return {
        index: idx,
        raw: row,
        designation: desigRaw,
        prix_unitaire: isNaN(prixRaw) ? 0 : Math.round(prixRaw * 100) / 100,
        unite: uniteRaw || 'JOUR',
        mode_remuneration: modeClean,
        code: codeRaw,
        description: descRaw,
        isValid: errors.length === 0,
        errors,
      };
    });

    setParsedRows(rows);
    setImportStep('preview');
  };

  // Corriger une ligne directement dans l'aperçu avant validation
  const handleUpdateParsedRow = (index: number, updates: Partial<ParsedRow>) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.index !== index) return r;
        const merged = { ...r, ...updates };
        const errors: string[] = [];
        if (!merged.designation.trim()) errors.push('Désignation manquante');
        if (isNaN(merged.prix_unitaire) || merged.prix_unitaire < 0) errors.push('Prix invalide');
        merged.isValid = errors.length === 0;
        merged.errors = errors;
        return merged;
      })
    );
  };

  // Supprimer une ligne de l'aperçu
  const handleRemoveParsedRow = (index: number) => {
    setParsedRows((prev) => prev.filter((r) => r.index !== index));
  };

  // ACTION : Valider et importer définitivement dans Supabase
  const handleConfirmImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      alert('Aucune ligne valide à importer. Veuillez corriger les erreurs.');
      return;
    }

    setImporting(true);
    try {
      const payload: Partial<ContractuelContrat>[] = validRows.map((r) => ({
        designation: r.designation,
        prix_unitaire: r.prix_unitaire,
        unite: r.unite,
        mode_remuneration: r.mode_remuneration,
        code: r.code,
        description: r.description,
        actif: true,
      }));

      const res = await importContractuelContrats(payload, dedupMode);
      if (res.success) {
        setImportResult(res.message || 'Importation terminée avec succès.');
        await loadContrats();
        setTimeout(() => {
          setIsImportModalOpen(false);
          setImportStep('upload');
          setImportResult(null);
          setRawData([]);
          setRawHeaders([]);
        }, 2500);
      } else {
        alert(res.error || 'Erreur lors de l’importation des contrats.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setImporting(false);
    }
  };

  // Télécharger un modèle Excel d'exemple
  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Code': 'CTR-001',
        'Désignation Contrat': 'EFFEUILLAGE & ÉBOURGEONNAGE D1',
        'Prix (DH)': 120,
        'Unité': 'JOUR',
        'Mode Tarification': 'JOUR',
        'Description': 'Taille et effeuillage des plants de tomates',
      },
      {
        'Code': 'CTR-002',
        'Désignation Contrat': 'RÉCOLTE TOMATE CERISE',
        'Prix (DH)': 2.5,
        'Unité': 'CAISSE',
        'Mode Tarification': 'UNITE',
        'Description': 'Cueillette et tri en caisses',
      },
      {
        'Code': 'CTR-003',
        'Désignation Contrat': 'DESHERBAGE MANUEL SERRES',
        'Prix (DH)': 130,
        'Unité': 'JOUR',
        'Mode Tarification': 'JOUR',
        'Description': 'Nettoyage des allées et des pieds',
      },
      {
        'Code': 'CTR-004',
        'Désignation Contrat': 'PALISSAGE & ATTACHE DES PLANTS',
        'Prix (DH)': 15,
        'Unité': 'HEURE',
        'Mode Tarification': 'HEURE',
        'Description': 'Attache des cordes et clips',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modèle Contrats');
    XLSX.writeFile(wb, 'modele_catalogue_contrats_lahcen.xlsx');
  };

  return (
    <div className="space-y-4">
      {/* 1. EN-TÊTE & BOUTONS D'ACTION PRINCIPAUX */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Catalogue des Contrats & Prix de Référence
              </h3>
              <p className="text-[11px] text-slate-500">
                {filteredContrats.length} contrat(s) disponible(s) • Les prix de référence sont appliqués lors du suivi terrain
              </p>
            </div>
          </div>

          {/* Boutons d'action : Importer Excel & Nouveau contrat */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setIsImportModalOpen(true);
                setImportStep('upload');
              }}
              className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-3.5 py-2 rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Importer Excel / CSV</span>
            </button>

            <button
              type="button"
              onClick={handleOpenCreate}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-3.5 py-2 rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nouveau contrat</span>
            </button>
          </div>
        </div>

        {/* 2. STATS RAPIDES DU CATALOGUE */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100">
          <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-100">
            <span className="text-[9px] font-black uppercase text-slate-500 block">Total Contrats</span>
            <span className="text-lg font-black text-slate-900">{stats.total}</span>
          </div>

          <div className="bg-emerald-50 rounded-xl p-2.5 border border-emerald-100">
            <span className="text-[9px] font-black uppercase text-emerald-800 block">Contrats Actifs</span>
            <span className="text-lg font-black text-emerald-900">{stats.actifs}</span>
          </div>

          <div className="bg-amber-50 rounded-xl p-2.5 border border-amber-100">
            <span className="text-[9px] font-black uppercase text-amber-800 block">Prix Moyen Réf.</span>
            <span className="text-lg font-black text-amber-900">
              {stats.prixMoyen.toFixed(1)} <span className="text-xs font-normal">DH</span>
            </span>
          </div>
        </div>

        {/* 3. BARRE DE RECHERCHE ET FILTRES */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un contrat par nom, code ou tâche..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs font-semibold text-slate-900 outline-none focus:bg-white focus:border-emerald-500"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span>Afficher inactifs</span>
          </label>
        </div>
      </div>

      {/* 4. LISTE DES CONTRATS DU CATALOGUE */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
          <span className="text-xs font-semibold">Chargement du catalogue des contrats...</span>
        </div>
      ) : filteredContrats.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 space-y-3">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <h4 className="text-xs font-black text-slate-800">Aucun contrat trouvé</h4>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            Importez votre fichier Excel (.xlsx ou CSV) avec vos prix convenus, ou créez un premier contrat manuellement.
          </p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setIsImportModalOpen(true);
                setImportStep('upload');
              }}
              className="inline-flex items-center gap-1 bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importer Excel</span>
            </button>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs px-3.5 py-2 rounded-xl"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Créer manuellement</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {filteredContrats.map((contrat) => (
            <div
              key={contrat.id}
              className={`bg-white rounded-2xl p-3.5 border transition shadow-xs space-y-2.5 ${
                contrat.actif
                  ? 'border-slate-200 hover:border-emerald-300'
                  : 'border-slate-200 bg-slate-50/70 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {contrat.code && (
                      <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                        {contrat.code}
                      </span>
                    )}
                    <h4 className="text-xs font-black text-slate-900 truncate">
                      {contrat.designation}
                    </h4>
                  </div>
                  {contrat.description && (
                    <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1 italic">
                      {contrat.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(contrat)}
                    className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-slate-100 rounded-lg transition"
                    title="Modifier"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleActif(contrat)}
                    className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-slate-100 rounded-lg transition"
                    title={contrat.actif ? 'Désactiver' : 'Activer'}
                  >
                    {contrat.actif ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-rose-500" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteContrat(contrat)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Prix de référence & Unité */}
              <div className="bg-emerald-50/70 rounded-xl p-2.5 border border-emerald-100 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[9px] font-black uppercase text-emerald-900 block">
                    Mode Tarification
                  </span>
                  <span className="font-bold text-slate-800">{contrat.mode_remuneration}</span>
                </div>
                <div className="text-right">
                  <span className="text-[9px] font-black uppercase text-emerald-900 block">
                    Prix de Référence
                  </span>
                  <span className="font-black text-emerald-900 text-sm">
                    {contrat.prix_unitaire} DH{' '}
                    <span className="text-[10px] font-bold text-emerald-700">
                      / {contrat.unite || contrat.mode_remuneration}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 5. MODALE D'IMPORTATION EXCEL / CSV */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* En-tête */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-sm text-slate-900">
                  Importation du Catalogue des Contrats (Excel / CSV)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {/* ÉTAPE 1 : CHOIX DU FICHIER */}
            {importStep === 'upload' && (
              <div className="space-y-4 py-2">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-emerald-400 hover:border-emerald-600 bg-emerald-50/30 rounded-2xl p-8 text-center cursor-pointer transition space-y-3"
                >
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-800">
                      Cliquez pour sélectionner votre fichier Excel ou CSV
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Formats acceptés : .xlsx, .xls, .csv depuis ordinateur ou smartphone
                    </p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                  <span>Besoin d'un exemple pour votre saisie ?</span>
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="flex items-center gap-1 text-emerald-700 font-bold hover:underline cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Télécharger modèle Excel</span>
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 2 : CORRESPONDANCE DES COLONNES (MAPPING) */}
            {importStep === 'mapping' && (
              <div className="space-y-4 py-1">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <p className="text-xs font-bold text-slate-800">
                    Fichier chargé : <span className="text-emerald-700">{fileName}</span> ({rawData.length} lignes trouvées)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Associez les colonnes de votre fichier aux champs obligatoires du catalogue.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Colonne Désignation */}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Nom / Désignation du contrat <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={colDesignation}
                      onChange={(e) => setColDesignation(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Sélectionner la colonne --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Colonne Prix */}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Prix du contrat (DH) <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={colPrix}
                      onChange={(e) => setColPrix(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Sélectionner la colonne --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Colonne Unité */}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Unité (JOUR, CAISSE, KG, HEURE...)
                    </label>
                    <select
                      value={colUnite}
                      onChange={(e) => setColUnite(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Par défaut (JOUR) --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Colonne Code */}
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Code / Référence (optionnel)
                    </label>
                    <select
                      value={colCode}
                      onChange={(e) => setColCode(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Aucun (Généré automatiquement) --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Gestion des doublons */}
                <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-200/80 space-y-1.5">
                  <span className="text-[10px] font-black uppercase text-emerald-950 block">
                    Comportement si le contrat existe déjà :
                  </span>
                  <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dedup"
                        value="update"
                        checked={dedupMode === 'update'}
                        onChange={() => setDedupMode('update')}
                        className="text-emerald-600"
                      />
                      <span>Mettre à jour le prix de référence (Recommandé)</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dedup"
                        value="skip"
                        checked={dedupMode === 'skip'}
                        onChange={() => setDedupMode('skip')}
                        className="text-emerald-600"
                      />
                      <span>Ignorer les doublons</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setImportStep('upload')}
                    className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Changer de fichier
                  </button>

                  <button
                    type="button"
                    onClick={handleGeneratePreview}
                    className="flex items-center gap-1 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-xs"
                  >
                    <span>Vérifier et prévisualiser</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* ÉTAPE 3 : PRÉVISUALISATION, CORRECTION & VALIDATION */}
            {importStep === 'preview' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="font-black text-slate-800">
                      {parsedRows.filter((r) => r.isValid).length} ligne(s) prêtes à être importées
                    </span>
                    {parsedRows.some((r) => !r.isValid) && (
                      <span className="text-rose-600 ml-2 font-bold">
                        ({parsedRows.filter((r) => !r.isValid).length} ligne(s) avec erreurs à corriger)
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-500">
                    Vous pouvez modifier les valeurs directement dans le tableau ci-dessous.
                  </span>
                </div>

                {importResult && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold p-3 rounded-xl flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{importResult}</span>
                  </div>
                )}

                {/* Tableau éditable de prévisualisation */}
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-black text-[10px] uppercase sticky top-0">
                      <tr>
                        <th className="p-2">Désignation</th>
                        <th className="p-2 w-28">Prix (DH)</th>
                        <th className="p-2 w-24">Unité</th>
                        <th className="p-2 w-28">Mode</th>
                        <th className="p-2 w-16 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedRows.map((row) => (
                        <tr
                          key={row.index}
                          className={row.isValid ? 'hover:bg-slate-50/70' : 'bg-rose-50/50'}
                        >
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.designation}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, { designation: e.target.value })
                              }
                              className={`w-full bg-transparent px-1.5 py-1 text-xs font-bold outline-none rounded border ${
                                !row.designation.trim() ? 'border-rose-400 bg-white' : 'border-transparent'
                              }`}
                            />
                            {row.errors.length > 0 && (
                              <span className="text-[9px] text-rose-600 block pl-1 font-semibold">
                                {row.errors.join(', ')}
                              </span>
                            )}
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              step="any"
                              value={row.prix_unitaire}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, {
                                  prix_unitaire: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-black text-emerald-800 outline-none rounded border border-transparent hover:border-slate-300 focus:bg-white focus:border-emerald-500"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.unite}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, {
                                  unite: e.target.value.toUpperCase(),
                                })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-bold text-slate-800 outline-none uppercase rounded border border-transparent hover:border-slate-300"
                            />
                          </td>
                          <td className="p-1.5">
                            <select
                              value={row.mode_remuneration}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, {
                                  mode_remuneration: e.target.value as ModeRemuneration,
                                })
                              }
                              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none"
                            >
                              <option value="JOUR">JOUR</option>
                              <option value="TACHE">TACHE</option>
                              <option value="UNITE">UNITE</option>
                              <option value="HEURE">HEURE</option>
                            </select>
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveParsedRow(row.index)}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                              title="Retirer cette ligne"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setImportStep('mapping')}
                    className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                  >
                    Retour aux colonnes
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={importing}
                    className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-xs transition active:scale-95 disabled:opacity-50"
                  >
                    {importing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileCheck className="w-3.5 h-3.5" />
                    )}
                    <span>{importing ? 'Importation...' : 'Valider & Enregistrer dans Supabase'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. MODALE CRÉATION / MODIFICATION MANUELLE D'UN CONTRAT */}
      {isModalOpen && editingContrat && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-black text-sm text-slate-900">
                {editingContrat.id ? 'Modifier le contrat' : 'Nouveau contrat de référence'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveManual} className="space-y-3">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Nom / Désignation du contrat <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: EFFEUILLAGE & ÉBOURGEONNAGE"
                  value={editingContrat.designation || ''}
                  onChange={(e) => setEditingContrat({ ...editingContrat, designation: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                    Prix de référence (DH) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={editingContrat.prix_unitaire ?? 120}
                    onChange={(e) =>
                      setEditingContrat({
                        ...editingContrat,
                        prix_unitaire: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-emerald-800 outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                    Unité affichée
                  </label>
                  <input
                    type="text"
                    placeholder="JOUR, CAISSE, KG..."
                    value={editingContrat.unite || 'JOUR'}
                    onChange={(e) => setEditingContrat({ ...editingContrat, unite: e.target.value.toUpperCase() })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                    Mode de tarification
                  </label>
                  <select
                    value={editingContrat.mode_remuneration || 'JOUR'}
                    onChange={(e) =>
                      setEditingContrat({
                        ...editingContrat,
                        mode_remuneration: e.target.value as ModeRemuneration,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-900 outline-none"
                  >
                    <option value="JOUR">DH / Jour</option>
                    <option value="TACHE">DH / Tâche</option>
                    <option value="UNITE">DH / Unité</option>
                    <option value="HEURE">DH / Heure</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                    Code / Référence
                  </label>
                  <input
                    type="text"
                    placeholder="Auto (ex: CTR-01)"
                    value={editingContrat.code || ''}
                    onChange={(e) => setEditingContrat({ ...editingContrat, code: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-500 block mb-1">
                  Description ou instructions
                </label>
                <input
                  type="text"
                  placeholder="Consignes particulières pour cette tâche..."
                  value={editingContrat.description || ''}
                  onChange={(e) => setEditingContrat({ ...editingContrat, description: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="contrat_actif"
                  checked={editingContrat.actif !== false}
                  onChange={(e) => setEditingContrat({ ...editingContrat, actif: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="contrat_actif" className="text-xs font-bold text-slate-700 cursor-pointer">
                  Contrat actif (utilisable lors du pointage)
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black px-4 py-2 rounded-xl shadow-xs disabled:opacity-50"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
