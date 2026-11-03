/**
 * Module TÂCHES SUPPLÉMENTAIRES — AGRIPOINTAGE
 * - Suivi précis des travaux en quantités physiques (> 0)
 * - Saisie individuelle ou collective (plusieurs ouvriers pour une même tâche)
 * - RÈGLE STRICTE : JAMAIS de mélange d'unités incompatibles dans les totaux
 * - Modification et suppression ciblée
 * - Export Excel (.xlsx) via SheetJS
 * - Accessible au Caporal et à l'Administrateur
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  ClipboardList,
  Calendar,
  Search,
  Plus,
  Trash2,
  Edit2,
  Download,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Warehouse,
  User,
  Filter,
  FileSpreadsheet,
  X,
  Users,
  Check,
  Tag,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Ouvrier, Tache, Domaine, Serre, TacheSupplementaire, UserAccount } from '../types';
import {
  fetchTachesSupplementairesServer,
  createTachesSupplementairesServer,
  updateTacheSupplementaireServer,
  deleteTacheSupplementaireServer,
} from '../services/tachesSupplementairesService';
import * as storage from '../services/storage';

interface TachesSupplementairesViewProps {
  currentUser: UserAccount;
  allOuvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose?: () => void;
}

const UNITES_STANDARDS = [
  { label: 'Caisse', value: 'caisse' },
  { label: 'Kg', value: 'kg' },
  { label: 'Mètre', value: 'mètre' },
  { label: 'Ruban', value: 'ruban' },
  { label: 'Ligne', value: 'ligne' },
  { label: 'Forfait', value: 'forfait' },
  { label: 'Heure', value: 'heure' },
];

export const TachesSupplementairesView: React.FC<TachesSupplementairesViewProps> = ({
  currentUser,
  allOuvriers,
  taches,
  domaines,
  serres,
  selectedDate,
  onSelectDate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'saisie' | 'historique' | 'recap'>('saisie');

  // Données
  const [items, setItems] = useState<TacheSupplementaire[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Formulaire de saisie
  const [formDate, setFormDate] = useState<string>(selectedDate);
  const [saisieMode, setSaisieMode] = useState<'individuelle' | 'collective'>('individuelle');
  const [workerNumberInput, setWorkerNumberInput] = useState<string>('');
  const [selectedWorker, setSelectedWorker] = useState<Ouvrier | null>(null);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<Set<string>>(new Set());
  const [workerSearchQuery, setWorkerSearchQuery] = useState<string>('');

  const [nomTache, setNomTache] = useState<string>('Désherbage');
  const [selectedTacheId, setSelectedTacheId] = useState<string>('');
  const [quantite, setQuantite] = useState<string>('10');
  const [unite, setUnite] = useState<string>('caisse');
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>('dom_d2');
  const [selectedSerreId, setSelectedSerreId] = useState<string>('');
  const [observation, setObservation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Filtres historique
  const [filterDate, setFilterDate] = useState<string>(selectedDate);
  const [filterWorkerQuery, setFilterWorkerQuery] = useState<string>('');
  const [filterDomaine, setFilterDomaine] = useState<string>('ALL');
  const [filterUnite, setFilterUnite] = useState<string>('ALL');

  // Modification
  const [editingItem, setEditingItem] = useState<TacheSupplementaire | null>(null);
  const [editQty, setEditQty] = useState<string>('');
  const [editUnite, setEditUnite] = useState<string>('');
  const [editNomTache, setEditNomTache] = useState<string>('');
  const [editObs, setEditObs] = useState<string>('');

  // Charger les données initiales
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchTachesSupplementairesServer();
      if (res.success && res.taches_supplementaires) {
        setItems(res.taches_supplementaires);
      } else {
        const local = storage.getAllTachesSupplementaires(currentUser.company_id || 'cie_lahcen_pointeur');
        setItems(local);
      }
    } catch {
      const local = storage.getAllTachesSupplementaires(currentUser.company_id || 'cie_lahcen_pointeur');
      setItems(local);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Détection ouvrier individuel par numéro
  useEffect(() => {
    const num = parseInt(workerNumberInput.trim(), 10);
    if (!isNaN(num) && num > 0) {
      const found = allOuvriers.find((o) => o.numero === num);
      setSelectedWorker(found || null);
    } else {
      setSelectedWorker(null);
    }
  }, [workerNumberInput, allOuvriers]);

  // Ouvriers triés pour la sélection collective
  const sortedWorkers = useMemo(() => {
    return [...allOuvriers].sort((a, b) => a.numero - b.numero);
  }, [allOuvriers]);

  const filteredSelectionWorkers = useMemo(() => {
    const q = workerSearchQuery.trim().toLowerCase();
    if (!q) return sortedWorkers;
    return sortedWorkers.filter((w) => w.numero.toString().includes(q) || w.nom.toLowerCase().includes(q));
  }, [sortedWorkers, workerSearchQuery]);

  const handleToggleWorker = (workerId: string) => {
    setSelectedWorkerIds((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  const handleSelectAllWorkers = () => {
    setSelectedWorkerIds(new Set(sortedWorkers.map((w) => w.id)));
  };

  const handleDeselectAllWorkers = () => {
    setSelectedWorkerIds(new Set());
  };

  // Enregistrement
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const qty = parseFloat(quantite.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      setFeedback({ type: 'error', text: 'La quantité doit être un nombre strictement supérieur à 0.' });
      return;
    }

    if (!nomTache.trim()) {
      setFeedback({ type: 'error', text: 'Veuillez renseigner l\'intitulé de la tâche.' });
      return;
    }

    // Cibles d'ouvriers
    const targets: Array<{ id: string; numero: number }> = [];
    if (saisieMode === 'individuelle') {
      if (!selectedWorker) {
        setFeedback({ type: 'error', text: 'Veuillez saisir un numéro d\'ouvrier valide.' });
        return;
      }
      targets.push({ id: selectedWorker.id, numero: selectedWorker.numero });
    } else {
      if (selectedWorkerIds.size === 0) {
        setFeedback({ type: 'error', text: 'Veuillez sélectionner au moins un ouvrier pour cette tâche collective.' });
        return;
      }
      sortedWorkers.forEach((w) => {
        if (selectedWorkerIds.has(w.id)) {
          targets.push({ id: w.id, numero: w.numero });
        }
      });
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ouvriers: targets,
        date: formDate,
        nom_tache: nomTache.trim(),
        tache_id: selectedTacheId || null,
        quantite: qty,
        unite: unite.trim().toLowerCase(),
        domaine_id: selectedDomaineId || null,
        serre_id: selectedSerreId || null,
        observation: observation.trim() || null,
      };

      const res = await createTachesSupplementairesServer(payload);
      if (res.success && res.items) {
        setItems((prev) => [...res.items!, ...prev]);
        setFeedback({
          type: 'success',
          text: `✓ ${res.count || targets.length} tâche(s) supplémentaire(s) enregistrée(s) (${qty} ${unite}).`,
        });
        if (saisieMode === 'individuelle') {
          setWorkerNumberInput('');
          setSelectedWorker(null);
        } else {
          setSelectedWorkerIds(new Set());
        }
        setObservation('');
      } else {
        // Fallback local
        const savedList: TacheSupplementaire[] = [];
        for (const t of targets) {
          const lRes = storage.saveTacheSupplementaire(
            currentUser.company_id || 'cie_lahcen_pointeur',
            t.id,
            formDate,
            {
              nom_tache: nomTache.trim(),
              tache_id: selectedTacheId || null,
              quantite: qty,
              unite: unite.trim().toLowerCase(),
              domaine_id: selectedDomaineId,
              serre_id: selectedSerreId,
              observation: observation.trim() || undefined,
              created_by_id: currentUser.id,
              created_by_nom: currentUser.nom,
            }
          );
          if (lRes.success && lRes.item) savedList.push(lRes.item);
        }
        setItems((prev) => [...savedList, ...prev]);
        setFeedback({
          type: 'success',
          text: `✓ ${savedList.length} tâche(s) enregistrée(s) localement (${qty} ${unite}).`,
        });
        if (saisieMode === 'individuelle') {
          setWorkerNumberInput('');
          setSelectedWorker(null);
        } else {
          setSelectedWorkerIds(new Set());
        }
        setObservation('');
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur lors de l\'enregistrement.' });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  // Suppression
  const handleDelete = async (id: string) => {
    if (!confirm('Confirmez-vous la suppression de cette tâche supplémentaire ?')) return;
    try {
      await deleteTacheSupplementaireServer(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setFeedback({ type: 'success', text: 'Tâche supprimée avec succès.' });
    } catch {
      storage.deleteTacheSupplementaire(id);
      setItems((prev) => prev.filter((it) => it.id !== id));
      setFeedback({ type: 'success', text: 'Supprimée localement.' });
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  // Ouvrir modification
  const handleOpenEdit = (item: TacheSupplementaire) => {
    setEditingItem(item);
    setEditQty(item.quantite.toString());
    setEditUnite(item.unite);
    setEditNomTache(item.nom_tache);
    setEditObs(item.observation || '');
  };

  // Enregistrer modification
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const q = parseFloat(editQty.replace(',', '.'));
    if (isNaN(q) || q <= 0) {
      alert('La quantité doit être supérieure à 0.');
      return;
    }

    try {
      const res = await updateTacheSupplementaireServer(editingItem.id, {
        quantite: q,
        unite: editUnite.toLowerCase(),
        nom_tache: editNomTache.trim(),
        observation: editObs.trim() || null,
      });

      if (res.success && res.item) {
        setItems((prev) => prev.map((it) => (it.id === editingItem.id ? res.item! : it)));
      } else {
        setItems((prev) =>
          prev.map((it) =>
            it.id === editingItem.id
              ? { ...it, quantite: q, unite: editUnite.toLowerCase(), nom_tache: editNomTache.trim(), observation: editObs.trim() }
              : it
          )
        );
      }
      setEditingItem(null);
      setFeedback({ type: 'success', text: 'Tâche supplémentaire modifiée avec succès.' });
    } catch (err: any) {
      alert(err.message || 'Erreur mise à jour');
    }
  };

  // Liste filtrée pour l'historique
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filterDate && it.date !== filterDate) return false;
      if (filterDomaine !== 'ALL' && it.domaine_id !== filterDomaine) return false;
      if (filterUnite !== 'ALL' && it.unite.toLowerCase() !== filterUnite.toLowerCase()) return false;
      if (filterWorkerQuery.trim()) {
        const q = filterWorkerQuery.trim().toLowerCase();
        const numMatch = it.numero_ouvrier?.toString().includes(q);
        const ouvrier = allOuvriers.find((o) => o.id === it.ouvrier_id);
        const nameMatch = ouvrier?.nom.toLowerCase().includes(q);
        const taskMatch = it.nom_tache.toLowerCase().includes(q);
        if (!numMatch && !nameMatch && !taskMatch) return false;
      }
      return true;
    });
  }, [items, filterDate, filterDomaine, filterUnite, filterWorkerQuery, allOuvriers]);

  // Récapitulatif avec règle stricte : JAMAIS de mélange d'unités incompatibles dans les totaux
  const statsRecap = useMemo(() => {
    const totalsByUnit: Record<string, number> = {};
    const byWorker: Record<
      string,
      {
        ouvrier: Ouvrier | undefined;
        numero: number;
        units: Record<string, number>;
        count: number;
      }
    > = {};

    filteredItems.forEach((it) => {
      const q = Number(it.quantite || 0);
      const u = (it.unite || 'unité').toLowerCase();

      // Total par unité
      totalsByUnit[u] = (totalsByUnit[u] || 0) + q;

      // Par ouvrier
      const wKey = it.ouvrier_id || `num_${it.numero_ouvrier}`;
      if (!byWorker[wKey]) {
        const o = allOuvriers.find((x) => x.id === it.ouvrier_id || x.numero === it.numero_ouvrier);
        byWorker[wKey] = {
          ouvrier: o,
          numero: it.numero_ouvrier,
          units: {},
          count: 0,
        };
      }
      byWorker[wKey].units[u] = (byWorker[wKey].units[u] || 0) + q;
      byWorker[wKey].count += 1;
    });

    return {
      totalsByUnit,
      workersList: Object.values(byWorker).sort((a, b) => b.count - a.count),
      totalEntries: filteredItems.length,
    };
  }, [filteredItems, allOuvriers]);

  // Export Excel SheetJS
  const handleExportExcel = () => {
    if (filteredItems.length === 0) {
      alert('Aucune tâche à exporter pour ces critères.');
      return;
    }

    const rows = filteredItems.map((it) => {
      const o = allOuvriers.find((x) => x.id === it.ouvrier_id || x.numero === it.numero_ouvrier);
      const d = domaines.find((dom) => dom.id === it.domaine_id);
      const s = serres.find((ser) => ser.id === it.serre_id);
      return {
        Date: it.date,
        'N° Ouvrier': it.numero_ouvrier,
        'Nom Ouvrier': o ? o.nom : `Ouvrier #${it.numero_ouvrier}`,
        Tâche: it.nom_tache,
        Quantité: it.quantite,
        Unité: it.unite,
        Domaine: d ? d.nom : it.domaine_id || '—',
        Serre: s ? s.nom : it.serre_id || '—',
        Observation: it.observation || '',
        'Enregistré par': it.created_by_nom || it.created_by_role || '—',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tâches Supplémentaires');
    const filename = `AgriPointage_Taches_Supp_${filterDate || 'Historique'}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  return (
    <div className="space-y-3 pb-24 animate-in fade-in select-none">
      {/* En-tête */}
      <div className="bg-white rounded-3xl p-3.5 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-xl shadow-sm">
            📋
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>TÂCHES SUPPLÉMENTAIRES</span>
              <span className="text-[10px] bg-blue-100 text-blue-900 border border-blue-300 px-2 py-0.5 rounded-full font-bold">
                {currentUser.role === 'admin' ? 'Admin' : 'Caporal'}
              </span>
            </h2>
            <p className="text-xs font-semibold text-slate-500">Travaux et rendements physiques</p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Navigation par Onglets */}
      <div className="bg-white p-1 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-3 gap-1 text-xs font-bold">
        <button
          type="button"
          onClick={() => setActiveTab('saisie')}
          className={`py-2 rounded-xl transition ${
            activeTab === 'saisie'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          ✍️ Saisie directe
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('historique')}
          className={`py-2 rounded-xl transition ${
            activeTab === 'historique'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          📋 Historique ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('recap')}
          className={`py-2 rounded-xl transition ${
            activeTab === 'recap'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          📊 Synthèse & Totaux
        </button>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-xs animate-in fade-in ${
            feedback.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-200" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 text-red-200" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* ONGLET 1 : SAISIE DIRECTE */}
      {activeTab === 'saisie' && (
        <form onSubmit={handleSave} className="bg-white rounded-3xl p-4 border border-slate-200 shadow-xs space-y-3.5">
          {/* Mode de Saisie : Individuelle vs Collective */}
          <div className="bg-slate-100 p-1 rounded-2xl flex text-xs font-bold">
            <button
              type="button"
              onClick={() => setSaisieMode('individuelle')}
              className={`flex-1 py-1.5 rounded-xl transition ${
                saisieMode === 'individuelle'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👤 Saisie individuelle
            </button>
            <button
              type="button"
              onClick={() => setSaisieMode('collective')}
              className={`flex-1 py-1.5 rounded-xl transition ${
                saisieMode === 'collective'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👥 Saisie collective (Groupe)
            </button>
          </div>

          {/* Ligne Date & Domaine */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Date de travail
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => {
                  setFormDate(e.target.value);
                  onSelectDate(e.target.value);
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-blue-600 outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Domaine
              </label>
              <select
                value={selectedDomaineId}
                onChange={(e) => setSelectedDomaineId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-blue-600 outline-none"
              >
                {domaines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Saisie Ouvrier : Individuelle vs Collective */}
          {saisieMode === 'individuelle' ? (
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Numéro de l'ouvrier (Recherche instantanée)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Ex: 12"
                  value={workerNumberInput}
                  onChange={(e) => setWorkerNumberInput(e.target.value)}
                  className="w-28 bg-blue-50/50 border-2 border-blue-400 rounded-2xl px-3 py-2.5 text-base font-black text-blue-950 focus:border-blue-600 outline-none"
                />
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 flex items-center justify-between">
                  {selectedWorker ? (
                    <div>
                      <span className="text-xs font-black text-slate-900 block">
                        #{selectedWorker.numero} — {selectedWorker.nom}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                        ✓ Ouvrier reconnu
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400 italic">
                      {workerNumberInput ? 'Aucun ouvrier trouvé' : 'Saisissez le N° d\'ouvrier'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-black text-slate-600 uppercase">
                  Sélection des ouvriers du groupe ({selectedWorkerIds.size} choisi(s))
                </label>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleSelectAllWorkers}
                    className="text-[10px] font-bold text-blue-700 hover:underline"
                  >
                    Tous
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAllWorkers}
                    className="text-[10px] font-bold text-slate-500 hover:underline"
                  >
                    Aucun
                  </button>
                </div>
              </div>

              <input
                type="text"
                placeholder="Filtrer les ouvriers..."
                value={workerSearchQuery}
                onChange={(e) => setWorkerSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs outline-none"
              />

              <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto p-1 bg-slate-50 rounded-2xl border border-slate-200">
                {filteredSelectionWorkers.map((w) => {
                  const isSelected = selectedWorkerIds.has(w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => handleToggleWorker(w.id)}
                      className={`p-1.5 rounded-xl text-left border transition flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600 text-white border-blue-700 font-black'
                          : 'bg-white text-slate-700 border-slate-200 font-bold hover:bg-slate-100'
                      }`}
                    >
                      <span className="text-[11px] truncate">#{w.numero} {w.nom}</span>
                      {isSelected && <Check className="w-3 h-3 shrink-0 ml-1 text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Intitulé de la tâche */}
          <div>
            <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
              Intitulé de la tâche
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ex: Désherbage, Taille, Effeuillage..."
                value={nomTache}
                onChange={(e) => setNomTache(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-slate-900 focus:border-blue-600 outline-none"
              />
              <select
                value={selectedTacheId}
                onChange={(e) => {
                  setSelectedTacheId(e.target.value);
                  const t = taches.find((tc) => tc.id === e.target.value);
                  if (t) setNomTache(t.nom);
                }}
                className="w-36 bg-slate-50 border border-slate-300 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 outline-none"
              >
                <option value="">Sélection rapide</option>
                {taches.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quantité & Unité physique */}
          <div className="bg-blue-50/40 rounded-2xl p-3 border border-blue-200 space-y-2">
            <div className="text-[11px] font-black text-blue-950 uppercase flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-blue-700" />
              <span>Quantité & Unité de mesure</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-blue-900 mb-0.5">Quantité réalisée</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={quantite}
                  onChange={(e) => setQuantite(e.target.value)}
                  className="w-full bg-white border-2 border-blue-400 rounded-xl px-3 py-2 text-sm font-black text-blue-950"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-blue-900 mb-0.5">Unité</label>
                <select
                  value={unite}
                  onChange={(e) => setUnite(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-2 py-2 text-xs font-black text-slate-800 uppercase"
                >
                  {UNITES_STANDARDS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Serre (Optionnel) & Observation */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Serre (Optionnel)
              </label>
              <select
                value={selectedSerreId}
                onChange={(e) => setSelectedSerreId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-blue-600 outline-none"
              >
                <option value="">-- Sans serre --</option>
                {serres.filter((s) => s.actif).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} - {s.nom}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Observation / Remarque
              </label>
              <input
                type="text"
                placeholder="Ex: Ligne 1 à 4"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-blue-600 outline-none"
              />
            </div>
          </div>

          {/* Bouton de validation */}
          <button
            type="submit"
            disabled={isSubmitting || (saisieMode === 'individuelle' ? !selectedWorker : selectedWorkerIds.size === 0)}
            className={`w-full py-3.5 rounded-2xl font-black text-xs flex items-center justify-center gap-2 shadow-md transition active:scale-98 ${
              (saisieMode === 'individuelle' ? selectedWorker : selectedWorkerIds.size > 0)
                ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>
              {saisieMode === 'individuelle'
                ? 'ENREGISTRER LA TÂCHE SUPPLÉMENTAIRE'
                : `ENREGISTRER POUR LES ${selectedWorkerIds.size} OUVRIERS`}
            </span>
          </button>
        </form>
      )}

      {/* ONGLET 2 : HISTORIQUE & FILTRES */}
      {activeTab === 'historique' && (
        <div className="space-y-3">
          {/* Barre de Filtres */}
          <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-xs space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
              />
              <select
                value={filterDomaine}
                onChange={(e) => setFilterDomaine(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
              >
                <option value="ALL">Tous domaines</option>
                {domaines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
              <select
                value={filterUnite}
                onChange={(e) => setFilterUnite(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 outline-none uppercase"
              >
                <option value="ALL">Toutes unités</option>
                {UNITES_STANDARDS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher par n°, ouvrier ou nom de tâche..."
                value={filterWorkerQuery}
                onChange={(e) => setFilterWorkerQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-800 outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] font-bold text-slate-500">
                {filteredItems.length} tâche(s) trouvée(s)
              </span>
              <button
                type="button"
                onClick={handleExportExcel}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-3 py-1.5 rounded-xl shadow-xs transition active:scale-95 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Exporter Excel</span>
              </button>
            </div>
          </div>

          {/* Liste des Opérations */}
          <div className="space-y-2">
            {filteredItems.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center text-slate-400">
                <ClipboardList className="w-10 h-10 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                <p className="text-xs font-bold">Aucune tâche supplémentaire enregistrée pour ces critères.</p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const ouvrier = allOuvriers.find((o) => o.id === item.ouvrier_id || o.numero === item.numero_ouvrier);
                const domaineObj = domaines.find((d) => d.id === item.domaine_id);
                const serreObj = serres.find((s) => s.id === item.serre_id);

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-950 font-black flex items-center justify-center text-xs shrink-0">
                        #{item.numero_ouvrier}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-slate-900">
                            {ouvrier ? ouvrier.nom : `Ouvrier #${item.numero_ouvrier}`}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">
                            • {item.nom_tache}
                          </span>
                          <span className="text-[10px] font-black text-blue-950 bg-blue-100 px-1.5 py-0.2 rounded-md">
                            {item.quantite} {item.unite}
                          </span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>📅 {item.date}</span>
                          {domaineObj && <span>📍 {domaineObj.nom}</span>}
                          {serreObj && <span>🏛️ {serreObj.nom}</span>}
                        </div>
                        {item.observation && (
                          <p className="text-[10px] font-medium text-slate-600 italic mt-0.5">
                            "{item.observation}"
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(item)}
                        className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                        title="Modifier"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ONGLET 3 : RÉCAPITULATIF & TOTAUX DISTINCTS PAR UNITÉ */}
      {activeTab === 'recap' && (
        <div className="space-y-3">
          {/* Carte Totaux par unité (JAMAIS MÉLANGÉES) */}
          <div className="bg-gradient-to-br from-blue-700 to-indigo-800 text-white rounded-3xl p-4 shadow-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-200 block">
                Totaux Séparés par Unité (Règle stricte : non sommées)
              </span>
              <button
                type="button"
                onClick={handleExportExcel}
                className="bg-white text-blue-900 font-black text-xs px-3 py-1.5 rounded-xl shadow-xs hover:bg-blue-50 transition active:scale-95 flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Excel</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {Object.keys(statsRecap.totalsByUnit).length === 0 ? (
                <span className="text-xs font-semibold text-blue-200">Aucune donnée</span>
              ) : (
                Object.entries(statsRecap.totalsByUnit).map(([unitName, sum]) => (
                  <div key={unitName} className="bg-white/10 rounded-2xl p-2.5 backdrop-blur-xs">
                    <span className="text-[10px] font-bold uppercase text-blue-200 block">
                      {unitName}
                    </span>
                    <span className="text-xl font-black">
                      {Math.round(sum * 100) / 100}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Tableau Récapitulatif par Ouvrier */}
          <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-xs">
            <h3 className="text-xs font-black text-slate-800 uppercase mb-2 px-1">
              Détail par ouvrier (Unités distinctes)
            </h3>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {statsRecap.workersList.map((item) => (
                <div key={item.numero} className="py-2.5 px-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 font-black text-slate-800 text-[11px] flex items-center justify-center">
                      #{item.numero}
                    </span>
                    <div>
                      <span className="text-xs font-black text-slate-900 block">
                        {item.ouvrier ? item.ouvrier.nom : `Ouvrier #${item.numero}`}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400">
                        {item.count} opération(s)
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 justify-end max-w-[55%]">
                    {Object.entries(item.units).map(([uName, val]) => (
                      <span
                        key={uName}
                        className="text-[11px] font-black text-blue-950 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200"
                      >
                        {Math.round(val * 100) / 100} {uName}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modale de Modification */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-sm w-full p-4 border border-slate-200 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-900 uppercase">
                Modifier la tâche supplémentaire
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-600 mb-1">Intitulé tâche</label>
              <input
                type="text"
                value={editNomTache}
                onChange={(e) => setEditNomTache(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">Quantité</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">Unité</label>
                <select
                  value={editUnite}
                  onChange={(e) => setEditUnite(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-2 text-xs font-bold"
                >
                  {UNITES_STANDARDS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-600 mb-1">Observation</label>
              <input
                type="text"
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="flex-1 py-2.5 rounded-xl font-bold text-xs bg-slate-100 text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="flex-1 py-2.5 rounded-xl font-black text-xs bg-blue-600 hover:bg-blue-700 text-white shadow-xs"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
