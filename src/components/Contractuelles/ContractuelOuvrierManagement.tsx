/**
 * Gestion administrative des ouvriers contractuels
 * - Création, modification, archivage, désactivation et réactivation
 * - Importation Excel & CSV (Nom, Prénom, Serre, Montant DH) avec validation (Montant >= 0)
 * - Recherche par nom/prénom et filtrage par serre
 * - Rémunérations et tarifs convenus
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  CheckCircle,
  XCircle,
  Building2,
  Tag,
  DollarSign,
  Phone,
  RefreshCw,
  AlertTriangle,
  FileText,
  Upload,
  Download,
  FileSpreadsheet,
  ArrowRight,
  FileCheck,
} from 'lucide-react';
import {
  ContractuelOuvrier,
  ModeRemuneration,
  Domaine,
  Serre,
  UserAccount,
} from '../../types';
import {
  getContractuelOuvriers,
  saveContractuelOuvrier,
  deleteContractuelOuvrier,
  importContractuelOuvriers,
} from '../../services/contractuelService';
import { getSerresForDomaine } from '../../services/storage';

interface ContractuelOuvrierManagementProps {
  domaines: Domaine[];
  serres: Serre[];
  currentUser: UserAccount;
}

interface ParsedWorkerRow {
  index: number;
  raw: Record<string, any>;
  nom_complet: string;
  serre_nom: string;
  prix_convenu: number;
  taches: string;
  domaine_str: string;
  isValid: boolean;
  errors: string[];
}

export const ContractuelOuvrierManagement: React.FC<ContractuelOuvrierManagementProps> = ({
  domaines,
  serres,
  currentUser,
}) => {
  const [ouvriers, setOuvriers] = useState<ContractuelOuvrier[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDomaineFilter, setSelectedDomaineFilter] = useState<string>('ALL');
  const [selectedSerreFilter, setSelectedSerreFilter] = useState<string>('ALL');
  const [showInactive, setShowInactive] = useState<boolean>(false);

  // Modale d'édition / création manuelle
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingOuvrier, setEditingOuvrier] = useState<Partial<ContractuelOuvrier> | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Modale d'importation Excel / CSV pour les contractuels
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawData, setRawData] = useState<Record<string, any>[]>([]);

  // Correspondance des colonnes (Nom et Prénom, Serres, Montant bach chad serre, Tâches, Domaine)
  const [colNomPrenom, setColNomPrenom] = useState<string>('');
  const [colSerre, setColSerre] = useState<string>('');
  const [colMontant, setColMontant] = useState<string>('');
  const [colTaches, setColTaches] = useState<string>('');
  const [colDomaine, setColDomaine] = useState<string>('');
  const [dedupMode, setDedupMode] = useState<'update' | 'skip'>('update');

  // Lignes parsées
  const [parsedRows, setParsedRows] = useState<ParsedWorkerRow[]>([]);
  const [importing, setImporting] = useState<boolean>(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadOuvriers();
  }, []);

  async function loadOuvriers() {
    setLoading(true);
    try {
      const res = await getContractuelOuvriers();
      if (res.success) {
        setOuvriers(res.ouvriers);
      }
    } catch (err) {
      console.error('Erreur chargement ouvriers contractuels:', err);
    } finally {
      setLoading(false);
    }
  }

  // Statistiques d'effectifs
  const stats = useMemo(() => {
    const total = ouvriers.length;
    const actifs = ouvriers.filter((o) => o.actif).length;
    const inactifs = total - actifs;
    return { total, actifs, inactifs };
  }, [ouvriers]);

  // Helpers d'extraction des métadonnées stockées dans notes (Serres / Tâches)
  const parseWorkerNotesMeta = (notes?: string | null) => {
    const raw = String(notes || '').trim();
    if (!raw) return { serresText: '', tachesText: '', otherNotes: '' };
    let serresText = '';
    let tachesText = '';
    const extra: string[] = [];

    raw.split('|').forEach((segment) => {
      const part = segment.trim();
      if (/^serres?\s*:/i.test(part)) {
        serresText = part.replace(/^serres?\s*:/i, '').trim();
      } else if (/^t[aâ]ches?\s*:/i.test(part)) {
        tachesText = part.replace(/^t[aâ]ches?\s*:/i, '').trim();
      } else if (part) {
        extra.push(part);
      }
    });

    return {
      serresText,
      tachesText: tachesText || extra.join(' | '),
      otherNotes: extra.join(' | '),
    };
  };

  const getDomaineBadge = (domaineId?: string) => {
    const found = domaines.find((d) => d.id === domaineId);
    if (found) return found.nom;
    const raw = String(domaineId || '').toUpperCase();
    if (raw.includes('D2')) return 'D2';
    if (raw.includes('D3')) return 'D3';
    if (raw.includes('D5')) return 'D5';
    return raw.replace('DOM_', '') || 'D2';
  };

  // Filtrage combiné par recherche, domaine, serre et statut
  const filteredOuvriers = useMemo(() => {
    const selectedSerreObj =
      selectedSerreFilter !== 'ALL' ? serres.find((s) => s.id === selectedSerreFilter) : null;

    return ouvriers.filter((o) => {
      if (!showInactive && !o.actif) return false;
      if (selectedDomaineFilter !== 'ALL' && o.domaine_id !== selectedDomaineFilter) return false;

      if (selectedSerreFilter !== 'ALL') {
        const meta = parseWorkerNotesMeta(o.notes);
        const matchDirect = o.serre_id === selectedSerreFilter;
        const matchNotes =
          selectedSerreObj &&
          meta.serresText &&
          (meta.serresText.toLowerCase().includes(selectedSerreObj.code.toLowerCase()) ||
            meta.serresText.toLowerCase().includes(selectedSerreObj.nom.toLowerCase()));
        if (!matchDirect && !matchNotes) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNom = o.nom_complet.toLowerCase().includes(q);
        const matchMatricule = o.matricule.toLowerCase().includes(q);
        const matchTel = o.telephone?.toLowerCase().includes(q);
        const matchNotes = o.notes?.toLowerCase().includes(q);
        if (!matchNom && !matchMatricule && !matchTel && !matchNotes) return false;
      }
      return true;
    });
  }, [ouvriers, serres, showInactive, selectedDomaineFilter, selectedSerreFilter, searchQuery]);

  // Ouverture création manuelle
  const handleOpenCreate = () => {
    setEditingOuvrier({
      nom: '',
      prenom: '',
      nom_complet: '',
      matricule: `C-${String(ouvriers.length + 1).padStart(3, '0')}`,
      domaine_id: domaines[0]?.id || 'dom_d2',
      serre_id: null,
      mode_remuneration: 'JOUR',
      prix_convenu: 120,
      unite: 'JOUR',
      actif: true,
      telephone: '',
      notes: '',
    });
    setIsModalOpen(true);
  };

  // Ouverture modification manuelle
  const handleOpenEdit = (o: ContractuelOuvrier) => {
    setEditingOuvrier({ ...o });
    setIsModalOpen(true);
  };

  // Sauvegarde manuelle
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOuvrier || !editingOuvrier.nom?.trim()) {
      alert('Le nom est obligatoire.');
      return;
    }

    const prix = Number(editingOuvrier.prix_convenu);
    if (isNaN(prix) || prix < 0) {
      alert('Le montant DH doit être un nombre supérieur ou égal à zéro (positif).');
      return;
    }

    setSaving(true);
    try {
      const prenom = editingOuvrier.prenom?.trim() || '';
      const nom = editingOuvrier.nom.trim();
      const nomComplet = prenom ? `${nom} ${prenom}` : nom;

      const payload: Partial<ContractuelOuvrier> = {
        ...editingOuvrier,
        nom,
        prenom,
        nom_complet: nomComplet,
        matricule: editingOuvrier.matricule?.trim() || `C-${Date.now().toString().slice(-4)}`,
        prix_convenu: Math.round(prix * 100) / 100,
        unite: editingOuvrier.unite?.trim() || editingOuvrier.mode_remuneration,
      };

      const res = await saveContractuelOuvrier(payload);
      if (res.success && res.ouvrier) {
        setOuvriers((prev) => {
          const idx = prev.findIndex((item) => item.id === res.ouvrier!.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = res.ouvrier!;
            return next;
          }
          return [res.ouvrier!, ...prev];
        });
        setIsModalOpen(false);
        setEditingOuvrier(null);
      } else {
        alert(res.error || 'Erreur lors de l’enregistrement de l’ouvrier.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  };

  // Toggle Actif / Inactif
  const handleToggleActif = async (o: ContractuelOuvrier) => {
    const updated = { ...o, actif: !o.actif };
    try {
      const res = await saveContractuelOuvrier(updated);
      if (res.success) {
        setOuvriers((prev) => prev.map((item) => (item.id === o.id ? { ...item, actif: !o.actif } : item)));
      }
    } catch (err) {
      console.warn('Erreur modification statut actif:', err);
    }
  };

  // Suppression
  const handleDelete = async (o: ContractuelOuvrier) => {
    if (!confirm(`Supprimer définitivement l'ouvrier contractuel "${o.nom_complet}" ?`)) {
      return;
    }

    try {
      const res = await deleteContractuelOuvrier(o.id);
      if (res.success) {
        setOuvriers((prev) => prev.filter((item) => item.id !== o.id));
      } else {
        alert(res.error || 'Erreur lors de la suppression.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    }
  };

  // --------------------------------------------------------------------------
  // LOGIQUE D'IMPORTATION EXCEL / CSV POUR CONTRACTUELS
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

        // Détection automatique intelligente
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
        .replace(/[^a-z0-9]/g, '')
        .trim();

    let detectedNom = '';
    let detectedSerre = '';
    let detectedMontant = '';
    let detectedTaches = '';
    let detectedDomaine = '';

    headers.forEach((h) => {
      const norm = normalize(h);

      if (!detectedNom && (norm.includes('nom') || norm.includes('prenom') || norm.includes('ouvrier') || norm.includes('name'))) {
        detectedNom = h;
      }
      if (!detectedMontant && (norm.includes('montant') || norm.includes('chad') || norm.includes('prix') || norm.includes('tarif') || norm === 'dh' || norm.includes('salaire'))) {
        detectedMontant = h;
      }
      if (
        !detectedSerre &&
        (norm.includes('serre') || norm.includes('affectation')) &&
        !norm.includes('montant') &&
        !norm.includes('prix') &&
        !norm.includes('chad') &&
        !norm.includes('tarif')
      ) {
        detectedSerre = h;
      }
      if (!detectedTaches && (norm.includes('tach') || norm.includes('travail') || norm.includes('operation'))) {
        detectedTaches = h;
      }
      if (!detectedDomaine && (norm.includes('domaine') || norm === 'd2' || norm === 'd3' || norm === 'd5')) {
        detectedDomaine = h;
      }
    });

    if (!detectedNom && headers.length > 0) detectedNom = headers[0];
    if (!detectedMontant && headers.length > 1) detectedMontant = headers[2] || headers[1];

    setColNomPrenom(detectedNom);
    setColSerre(detectedSerre);
    setColMontant(detectedMontant);
    setColTaches(detectedTaches);
    setColDomaine(detectedDomaine);
  };

  const isDomaineInputValid = (rawDom: string): boolean => {
    const d = rawDom.trim().toUpperCase();
    if (!d) return true; // Optionnel si non renseigné (repli D2)
    return d.includes('D2') || d.includes('D3') || d.includes('D5') || d === '2' || d === '3' || d === '5';
  };

  const handleGeneratePreview = () => {
    if (!colNomPrenom || !colMontant) {
      alert('Veuillez associer au moins les colonnes "Nom et Prénom" et "Montant".');
      return;
    }

    const rows: ParsedWorkerRow[] = rawData.map((row, idx) => {
      const nomCompletRaw = String(row[colNomPrenom] || '').trim();
      const serreRaw = colSerre ? String(row[colSerre] || '').trim() : '';
      const montantVal = row[colMontant];
      const prixRaw = Number(String(montantVal ?? '').replace(',', '.').replace(/[^0-9.-]/g, ''));
      const tachesRaw = colTaches ? String(row[colTaches] || '').trim() : '';
      const domaineRaw = colDomaine ? String(row[colDomaine] || '').trim().toUpperCase() : '';

      const errors: string[] = [];
      if (!nomCompletRaw) errors.push('Nom et prénom obligatoires');
      if (String(montantVal ?? '').trim() === '' || isNaN(prixRaw)) {
        errors.push('Montant non numérique');
      } else if (prixRaw < 0) {
        errors.push('Montant négatif interdit (≥ 0)');
      }
      if (domaineRaw && !isDomaineInputValid(domaineRaw)) {
        errors.push('Domaine attendu : D2, D3 ou D5');
      }

      return {
        index: idx,
        raw: row,
        nom_complet: nomCompletRaw,
        serre_nom: serreRaw,
        prix_convenu: isNaN(prixRaw) || prixRaw < 0 ? 0 : Math.round(prixRaw * 100) / 100,
        taches: tachesRaw,
        domaine_str: domaineRaw,
        isValid: errors.length === 0,
        errors,
      };
    });

    setParsedRows(rows);
    setImportStep('preview');
  };

  const handleUpdateParsedRow = (index: number, updates: Partial<ParsedWorkerRow>) => {
    setParsedRows((prev) =>
      prev.map((r) => {
        if (r.index !== index) return r;
        const merged = { ...r, ...updates };
        const errors: string[] = [];
        if (!merged.nom_complet.trim()) errors.push('Nom et prénom obligatoires');
        if (isNaN(merged.prix_convenu)) {
          errors.push('Montant non numérique');
        } else if (merged.prix_convenu < 0) {
          errors.push('Montant négatif interdit');
        }
        if (merged.domaine_str.trim() && !isDomaineInputValid(merged.domaine_str)) {
          errors.push('Domaine attendu : D2, D3 ou D5');
        }
        merged.isValid = errors.length === 0;
        merged.errors = errors;
        return merged;
      })
    );
  };

  const handleRemoveParsedRow = (index: number) => {
    setParsedRows((prev) => prev.filter((r) => r.index !== index));
  };

  const handleConfirmImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      alert('Aucune ligne valide à importer. Veuillez vérifier les données.');
      return;
    }

    setImporting(true);
    try {
      const payload = validRows.map((r) => {
        const parts = r.nom_complet.trim().split(/\s+/);
        const nom = parts[0] || r.nom_complet.trim();
        const prenom = parts.slice(1).join(' ') || '';

        let domaine_id = domaines[0]?.id || 'dom_d2';
        const dNorm = r.domaine_str.toUpperCase();
        if (dNorm.includes('D2') || dNorm === '2') domaine_id = domaines.find((d) => d.nom.includes('2'))?.id || 'dom_d2';
        else if (dNorm.includes('D3') || dNorm === '3') domaine_id = domaines.find((d) => d.nom.includes('3'))?.id || 'dom_d3';
        else if (dNorm.includes('D5') || dNorm === '5') domaine_id = domaines.find((d) => d.nom.includes('5'))?.id || 'dom_d5';

        const noteParts: string[] = [];
        if (r.serre_nom.trim()) noteParts.push(`Serres: ${r.serre_nom.trim()}`);
        if (r.taches.trim()) noteParts.push(`Tâches: ${r.taches.trim()}`);

        return {
          nom,
          prenom,
          nom_complet: r.nom_complet.trim(),
          serre_nom: r.serre_nom.trim(),
          prix_convenu: r.prix_convenu,
          mode_remuneration: 'JOUR' as const,
          unite: 'JOUR',
          domaine_id,
          notes: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
        };
      });

      const res = await importContractuelOuvriers(payload, dedupMode);
      if (res.success) {
        setImportResult(res.message || 'Importation terminée avec succès.');
        await loadOuvriers();
        setTimeout(() => {
          setIsImportModalOpen(false);
          setImportStep('upload');
          setImportResult(null);
          setRawData([]);
          setRawHeaders([]);
        }, 2000);
      } else {
        alert(res.error || 'Erreur lors de l’importation.');
      }
    } catch (err: any) {
      alert(err.message || 'Erreur réseau.');
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    // Format officiel demandé : NOM ET PRENOM ; SERRES ; MONTANT BACH CHAD SERRE ; TACHES ; DOMAINE (D2, D3, D5)
    const templateData = [
      {
        'NOM ET PRENOM': 'EL AMRANI FATIMA',
        'SERRES': 'S1, S2',
        'MONTANT BACH CHAD SERRE': 120,
        'TACHES': 'TAILLAGE / ATTACHAGE',
        'DOMAINE': 'D2',
      },
      {
        'NOM ET PRENOM': 'BOUZID KHADIJA',
        'SERRES': 'S18',
        'MONTANT BACH CHAD SERRE': 110,
        'TACHES': 'RÉCOLTE',
        'DOMAINE': 'D3',
      },
      {
        'NOM ET PRENOM': 'AIT ALI SAID',
        'SERRES': 'S23, S24',
        'MONTANT BACH CHAD SERRE': 130,
        'TACHES': 'NETTOYAGE',
        'DOMAINE': 'D5',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Modele Contractuels');
    XLSX.writeFile(wb, 'modele_import_contractuels.xlsx');
  };

  return (
    <div className="space-y-4">
      {/* 1. BARRE DE COMMANDE */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900">
                Gestion des Travailleurs Contractuels
              </h3>
              <p className="text-[11px] text-slate-500">
                Total : <strong className="text-slate-900">{stats.total}</strong> contractuel(s) ({stats.actifs} actif(s), {stats.inactifs} inactif(s))
              </p>
            </div>
          </div>

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
              <span>Créer manuellement</span>
            </button>
          </div>
        </div>

        {/* Filtres de recherche : Texte, Domaine & Serre */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Recherche texte */}
          <div className="relative sm:col-span-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom ou prénom..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:bg-white focus:border-emerald-500"
            />
          </div>

          {/* Filtre Domaine */}
          <div>
            <select
              value={selectedDomaineFilter}
              onChange={(e) => {
                const nextDom = e.target.value;
                setSelectedDomaineFilter(nextDom);
                if (nextDom !== 'ALL' && selectedSerreFilter !== 'ALL') {
                  const allowed = getSerresForDomaine(serres, nextDom, domaines);
                  if (!allowed.some((s) => s.id === selectedSerreFilter)) {
                    setSelectedSerreFilter('ALL');
                  }
                }
              }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-emerald-500"
            >
              <option value="ALL">Tous les domaines</option>
              {domaines.map((d) => (
                <option key={d.id} value={d.id}>
                  Domaine {d.nom}
                </option>
              ))}
            </select>
          </div>

          {/* Filtre Serre */}
          <div>
            <select
              value={selectedSerreFilter}
              onChange={(e) => setSelectedSerreFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-emerald-500"
            >
              <option value="ALL">Toutes les serres</option>
              {(selectedDomaineFilter !== 'ALL'
                ? getSerresForDomaine(serres, selectedDomaineFilter, domaines)
                : serres.filter((s) => s.actif !== false)
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nom} ({s.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Checkbox Inactifs */}
        <div className="flex items-center justify-between text-xs text-slate-600 pt-1 border-t border-slate-100">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500"
            />
            <span>Afficher les contractuels inactifs / archivés</span>
          </label>

          <button
            type="button"
            onClick={loadOuvriers}
            className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>

      {/* 2. TABLEAU STANDARD DES CONTRACTUELS ADMIN */}
      {loading ? (
        <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
          <span className="text-xs font-semibold">Chargement des contractuels...</span>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-black text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-3.5">Nom et Prénom</th>
                  <th className="py-3 px-3.5">Domaine</th>
                  <th className="py-3 px-3.5">Serres</th>
                  <th className="py-3 px-3.5">Tâches</th>
                  <th className="py-3 px-3.5 text-right">Montant (DH)</th>
                  <th className="py-3 px-3.5 text-center">Statut</th>
                  <th className="py-3 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {ouvriers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 px-4 text-center">
                      <div className="max-w-lg mx-auto space-y-3">
                        <div className="w-14 h-14 bg-emerald-50 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto shadow-2xs border border-emerald-100">
                          <FileSpreadsheet className="w-7 h-7" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-slate-900">
                            Catalogue des Contractuels Vide
                          </h4>
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            Importez votre tableau Excel officiel à 5 colonnes pour démarrer.
                          </p>
                        </div>

                        {/* Format attendu rappelé */}
                        <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 inline-block text-[11px] font-mono text-slate-700 font-bold">
                          <span className="text-emerald-700 font-black">NOM ET PRENOM</span> | <span className="text-emerald-700 font-black">SERRES</span> | <span className="text-emerald-700 font-black">MONTANT BACH CHAD SERRE</span> | <span className="text-emerald-700 font-black">TACHES</span> | <span className="text-emerald-700 font-black">DOMAINE (D2/D3/D5)</span>
                        </div>

                        {/* Boutons d'action prioritaires */}
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setIsImportModalOpen(true);
                              setImportStep('upload');
                            }}
                            className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-4 py-2.5 rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
                          >
                            <Upload className="w-4 h-4" />
                            <span>IMPORTER MON FICHIER EXCEL</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleOpenCreate}
                            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs px-3.5 py-2.5 rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Ajouter manuellement</span>
                          </button>
                        </div>

                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={handleDownloadTemplate}
                            className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-bold hover:underline cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>Télécharger le modèle Excel officiel (5 colonnes)</span>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : filteredOuvriers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 px-4 text-center">
                      <div className="space-y-1.5">
                        <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto" />
                        <p className="text-xs font-black text-slate-800">
                          Aucun travailleur ne correspond à vos filtres de recherche.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setSelectedDomaineFilter('ALL');
                            setSelectedSerreFilter('ALL');
                            setShowInactive(false);
                          }}
                          className="text-[11px] font-bold text-emerald-700 hover:underline"
                        >
                          Réinitialiser les filtres
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredOuvriers.map((ouvrier) => {
                    const meta = parseWorkerNotesMeta(ouvrier.notes);
                    const serreObj = ouvrier.serre_id ? serres.find((s) => s.id === ouvrier.serre_id) : null;
                    const serreLabel = meta.serresText || (serreObj ? `${serreObj.code} (${serreObj.nom})` : '');
                    const domaineLabel = getDomaineBadge(ouvrier.domaine_id);

                    return (
                      <tr
                        key={ouvrier.id}
                        className={`hover:bg-emerald-50/40 transition ${
                          !ouvrier.actif ? 'bg-slate-50/60 opacity-70' : ''
                        }`}
                      >
                        {/* NOM ET PRÉNOM */}
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                              {ouvrier.matricule}
                            </span>
                            <span className="font-black text-slate-900 uppercase">
                              {ouvrier.nom_complet || `${ouvrier.nom} ${ouvrier.prenom || ''}`.trim()}
                            </span>
                          </div>
                        </td>

                        {/* DOMAINE */}
                        <td className="py-2.5 px-3.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-black bg-slate-100 text-slate-800">
                            {domaineLabel}
                          </span>
                        </td>

                        {/* SERRES */}
                        <td className="py-2.5 px-3.5 text-slate-700 font-bold">
                          {serreLabel ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-blue-50 text-blue-800 border border-blue-200">
                              {serreLabel}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">—</span>
                          )}
                        </td>

                        {/* TÂCHES */}
                        <td className="py-2.5 px-3.5 text-slate-700 font-semibold max-w-[200px] truncate" title={meta.tachesText}>
                          {meta.tachesText || <span className="text-slate-400 italic">—</span>}
                        </td>

                        {/* MONTANT (DH) */}
                        <td className="py-2.5 px-3.5 text-right font-black text-emerald-800 text-sm whitespace-nowrap">
                          {ouvrier.prix_convenu} <span className="text-[10px] text-slate-500 font-bold">DH</span>
                        </td>

                        {/* STATUT */}
                        <td className="py-2.5 px-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActif(ouvrier)}
                            className={`inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full transition cursor-pointer ${
                              ouvrier.actif
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                            }`}
                            title={ouvrier.actif ? 'Cliquer pour désactiver' : 'Cliquer pour activer'}
                          >
                            {ouvrier.actif ? (
                              <>
                                <CheckCircle className="w-3 h-3 text-emerald-700" />
                                <span>Actif</span>
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3 h-3 text-rose-600" />
                                <span>Inactif</span>
                              </>
                            )}
                          </button>
                        </td>

                        {/* ACTIONS */}
                        <td className="py-2.5 px-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(ouvrier)}
                              className="flex items-center gap-1 bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-900 font-black text-[11px] px-2.5 py-1 rounded-lg transition cursor-pointer"
                              title="Modifier les informations ou le montant initial"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Modifier</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleToggleActif(ouvrier)}
                              className={`p-1.5 rounded-lg transition cursor-pointer ${
                                ouvrier.actif
                                  ? 'text-amber-600 hover:bg-amber-50'
                                  : 'text-emerald-600 hover:bg-emerald-50'
                              }`}
                              title={ouvrier.actif ? 'Désactiver' : 'Activer'}
                            >
                              {ouvrier.actif ? (
                                <XCircle className="w-4 h-4" />
                              ) : (
                                <CheckCircle className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDelete(ouvrier)}
                              className="p-1.5 text-rose-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Supprimer définitivement"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
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

      {/* 3. MODALE D'IMPORTATION EXCEL / CSV */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                <h3 className="font-black text-sm text-slate-900">
                  Importation des Contractuels (Excel / CSV)
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

            {/* ÉTAPE 1 : UPLOAD */}
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
                      Colonnes attendues : NOM ET PRENOM, SERRES, MONTANT BACH CHAD SERRE, TACHES, DOMAINE (D2/D3/D5)
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
                  <span>Modèle Excel préformaté :</span>
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

            {/* ÉTAPE 2 : MAPPING */}
            {importStep === 'mapping' && (
              <div className="space-y-4 py-1">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <p className="font-bold text-slate-800">
                    Fichier : <span className="text-emerald-700">{fileName}</span> ({rawData.length} lignes)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Associez les colonnes de votre fichier Excel aux champs obligatoires.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Nom et Prénom <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={colNomPrenom}
                      onChange={(e) => setColNomPrenom(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Sélectionner Nom et Prénom --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Serres
                    </label>
                    <select
                      value={colSerre}
                      onChange={(e) => setColSerre(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Sélectionner Serres --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Montant bach chad serre <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={colMontant}
                      onChange={(e) => setColMontant(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Sélectionner Montant --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Tâches
                    </label>
                    <select
                      value={colTaches}
                      onChange={(e) => setColTaches(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Sélectionner Tâches --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase text-slate-600 block mb-1">
                      Domaine (D2, D3, D5)
                    </label>
                    <select
                      value={colDomaine}
                      onChange={(e) => setColDomaine(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 font-bold text-slate-900 outline-none"
                    >
                      <option value="">-- Sélectionner Domaine (D2, D3 ou D5) --</option>
                      {rawHeaders.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-emerald-50/60 p-3 rounded-2xl border border-emerald-200/80 space-y-1.5 text-xs">
                  <span className="text-[10px] font-black uppercase text-emerald-950 block">
                    Comportement si l'ouvrier existe déjà :
                  </span>
                  <div className="flex items-center gap-4 font-bold text-slate-700">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dedupWorker"
                        value="update"
                        checked={dedupMode === 'update'}
                        onChange={() => setDedupMode('update')}
                        className="text-emerald-600"
                      />
                      <span>Mettre à jour le Montant DH (Recommandé)</span>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="dedupWorker"
                        value="skip"
                        checked={dedupMode === 'skip'}
                        onChange={() => setDedupMode('skip')}
                        className="text-emerald-600"
                      />
                      <span>Ignorer l'importation</span>
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

            {/* ÉTAPE 3 : PREVIEW & VALIDATION */}
            {importStep === 'preview' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="font-black text-slate-800">
                      {parsedRows.filter((r) => r.isValid).length} ligne(s) valides
                    </span>
                    {parsedRows.some((r) => !r.isValid) && (
                      <span className="text-rose-600 ml-2 font-bold">
                        ({parsedRows.filter((r) => !r.isValid).length} ligne(s) avec erreurs - Montants négatifs interdits)
                      </span>
                    )}
                  </div>
                </div>

                {importResult && (
                  <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold p-3 rounded-xl flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{importResult}</span>
                  </div>
                )}

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-black text-[10px] uppercase sticky top-0">
                      <tr>
                        <th className="p-2">Nom et Prénom</th>
                        <th className="p-2">Serres</th>
                        <th className="p-2">Montant (DH)</th>
                        <th className="p-2">Tâches</th>
                        <th className="p-2">Domaine</th>
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
                              value={row.nom_complet}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, { nom_complet: e.target.value })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-bold outline-none rounded border border-transparent hover:border-slate-300 uppercase"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.serre_nom}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, { serre_nom: e.target.value })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-semibold outline-none rounded border border-transparent hover:border-slate-300"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.prix_convenu}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, {
                                  prix_convenu: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-black text-emerald-800 outline-none rounded border border-transparent hover:border-slate-300 focus:bg-white"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.taches}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, { taches: e.target.value })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-semibold outline-none rounded border border-transparent hover:border-slate-300"
                            />
                          </td>
                          <td className="p-1.5">
                            <input
                              type="text"
                              value={row.domaine_str}
                              onChange={(e) =>
                                handleUpdateParsedRow(row.index, { domaine_str: e.target.value })
                              }
                              className="w-full bg-transparent px-1.5 py-1 text-xs font-semibold outline-none rounded border border-transparent hover:border-slate-300"
                            />
                            {row.errors.length > 0 && (
                              <span className="text-[9px] text-rose-600 block pl-1 font-semibold">
                                {row.errors.join(', ')}
                              </span>
                            )}
                          </td>
                          <td className="p-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveParsedRow(row.index)}
                              className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
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
                    className="flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-xs disabled:opacity-50"
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

      {/* 4. MODALE CRÉATION / MODIFICATION MANUELLE */}
      {isModalOpen && editingOuvrier && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-black text-sm text-slate-900">
                {editingOuvrier.id ? 'Modifier ouvrier contractuel' : 'Créer un ouvrier contractuel'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-700 block mb-1">
                    Nom <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex. EL AMRANI"
                    value={editingOuvrier.nom || ''}
                    onChange={(e) => setEditingOuvrier({ ...editingOuvrier, nom: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-emerald-500 uppercase"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-700 block mb-1">
                    Prénom <span className="text-slate-400 font-normal">(Optionnel)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="ex. Fatima"
                    value={editingOuvrier.prenom || ''}
                    onChange={(e) => setEditingOuvrier({ ...editingOuvrier, prenom: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Montant initial (DH) */}
              <div className="p-3 bg-emerald-50/70 rounded-2xl border border-emerald-200 space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-emerald-950 block">
                  Montant initial ADMIN (DH) <span className="text-rose-600">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      placeholder="ex. 100"
                      value={editingOuvrier.prix_convenu ?? 100}
                      onChange={(e) =>
                        setEditingOuvrier({
                          ...editingOuvrier,
                          prix_convenu: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full bg-white border border-emerald-300 rounded-xl px-3 py-2 text-sm font-black text-emerald-900 outline-none focus:border-emerald-600"
                    />
                    <span className="absolute right-3 top-2 text-xs font-black text-emerald-700">DH</span>
                  </div>
                  <span className="text-xs text-slate-500 font-bold">/ Jour</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Tarif de base configuré par l'Admin. Le Caporal pourra l'ajuster lors du pointage quotidien.
                </p>
              </div>

              {/* Statut actif */}
              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="checkbox"
                  id="ouvrier_actif"
                  checked={editingOuvrier.actif !== false}
                  onChange={(e) => setEditingOuvrier({ ...editingOuvrier, actif: e.target.checked })}
                  className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                />
                <label htmlFor="ouvrier_actif" className="text-xs font-bold text-slate-800 cursor-pointer">
                  Travailleur actif (disponible pour les pointages)
                </label>
              </div>

              {/* Options avancées facultatives */}
              <details className="text-xs text-slate-600 border border-slate-200 rounded-xl p-2.5 bg-slate-50/50">
                <summary className="font-bold text-slate-700 cursor-pointer select-none">
                  Options facultatives (Matricule, Domaine, Serre)
                </summary>
                <div className="space-y-2.5 pt-2 mt-2 border-t border-slate-200">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                        Matricule
                      </label>
                      <input
                        type="text"
                        value={editingOuvrier.matricule || ''}
                        onChange={(e) => setEditingOuvrier({ ...editingOuvrier, matricule: e.target.value })}
                        className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                        Domaine
                      </label>
                      <select
                        value={editingOuvrier.domaine_id || domaines[0]?.id}
                        onChange={(e) => {
                          const nextDom = e.target.value;
                          const allowed = getSerresForDomaine(serres, nextDom, domaines);
                          const keepSerre =
                            editingOuvrier.serre_id &&
                            allowed.some((s) => s.id === editingOuvrier.serre_id)
                              ? editingOuvrier.serre_id
                              : null;
                          setEditingOuvrier({
                            ...editingOuvrier,
                            domaine_id: nextDom,
                            serre_id: keepSerre,
                          });
                        }}
                        className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
                      >
                        {domaines.map((d) => (
                          <option key={d.id} value={d.id}>
                            Domaine {d.nom}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                      Serre habituelle
                    </label>
                    <select
                      value={editingOuvrier.serre_id || ''}
                      onChange={(e) => setEditingOuvrier({ ...editingOuvrier, serre_id: e.target.value || null })}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
                    >
                      <option value="">-- Aucune / Variable --</option>
                      {getSerresForDomaine(
                        serres,
                        editingOuvrier.domaine_id || domaines[0]?.id || 'dom_d2',
                        domaines
                      ).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nom} ({s.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 block mb-0.5">
                      Tâches / Serres (Notes)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Serres: S1, S2 | Tâches: TAILLAGE"
                      value={editingOuvrier.notes || ''}
                      onChange={(e) => setEditingOuvrier({ ...editingOuvrier, notes: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                    />
                  </div>
                </div>
              </details>

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
