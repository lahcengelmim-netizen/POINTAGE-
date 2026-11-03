/**
 * Module HEURES SUPPLÉMENTAIRES — AGRIPOINTAGE
 * - Suivi précis du temps de travail en heures (> 0)
 * - Calcul automatique de la durée (heure début -> heure fin) avec override
 * - Supporte plusieurs saisies pour le même ouvrier le même jour
 * - Modification et suppression ciblée
 * - Récapitulatif : totaux par ouvrier, par jour, par domaine
 * - Export Excel (.xlsx) via SheetJS
 * - Accessible au Caporal et à l'Administrateur
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Clock,
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
  Layers,
  FileSpreadsheet,
  X,
  Save,
  RotateCcw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Ouvrier, Domaine, Serre, HeureSupplementaire, UserAccount } from '../types';
import {
  syncAndFetchHeuresSupplementairesServer,
  createHeureSupplementaireServer,
  updateHeureSupplementaireServer,
  deleteHeureSupplementaireServer,
} from '../services/heuresSupplementairesService';
import * as storage from '../services/storage';

interface HeuresSupplementairesViewProps {
  currentUser: UserAccount;
  allOuvriers: Ouvrier[];
  domaines: Domaine[];
  serres: Serre[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onClose?: () => void;
}

export const HeuresSupplementairesView: React.FC<HeuresSupplementairesViewProps> = ({
  currentUser,
  allOuvriers,
  domaines,
  serres,
  selectedDate,
  onSelectDate,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'saisie' | 'historique' | 'recap'>('saisie');

  // Données
  const [items, setItems] = useState<HeureSupplementaire[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Formulaire de saisie
  const [formDate, setFormDate] = useState<string>(selectedDate);
  const [workerNumberInput, setWorkerNumberInput] = useState<string>('');
  const [selectedWorker, setSelectedWorker] = useState<Ouvrier | null>(null);
  const [heureDebut, setHeureDebut] = useState<string>('17:00');
  const [heureFin, setHeureFin] = useState<string>('19:00');
  const [dureeHeures, setDureeHeures] = useState<string>('2');
  const [selectedDomaineId, setSelectedDomaineId] = useState<string>('dom_d2');
  const [selectedSerreId, setSelectedSerreId] = useState<string>('');
  const [observation, setObservation] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Filtres historique
  const [filterDate, setFilterDate] = useState<string>(selectedDate);
  const [filterWorkerQuery, setFilterWorkerQuery] = useState<string>('');
  const [filterDomaine, setFilterDomaine] = useState<string>('ALL');

  // Modification
  const [editingItem, setEditingItem] = useState<HeureSupplementaire | null>(null);
  const [editDuration, setEditDuration] = useState<string>('');
  const [editDebut, setEditDebut] = useState<string>('');
  const [editFin, setEditFin] = useState<string>('');
  const [editObs, setEditObs] = useState<string>('');

  // Charger les données initiales
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await syncAndFetchHeuresSupplementairesServer();
      if (res.success && res.supplementaires) {
        setItems(res.supplementaires);
      } else {
        // Fallback local
        const local = storage.getAllHeuresSupplementaires(currentUser.company_id || 'cie_lahcen_pointeur');
        setItems(local.filter((h) => h.type === 'heures' || !h.type));
      }
    } catch {
      const local = storage.getAllHeuresSupplementaires(currentUser.company_id || 'cie_lahcen_pointeur');
      setItems(local.filter((h) => h.type === 'heures' || !h.type));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Détection ouvrier par numéro
  useEffect(() => {
    const num = parseInt(workerNumberInput.trim(), 10);
    if (!isNaN(num) && num > 0) {
      const found = allOuvriers.find((o) => o.numero === num);
      setSelectedWorker(found || null);
    } else {
      setSelectedWorker(null);
    }
  }, [workerNumberInput, allOuvriers]);

  // Calcul automatique de la durée quand heure_debut ou heure_fin changent
  useEffect(() => {
    if (heureDebut && heureFin && heureDebut.includes(':') && heureFin.includes(':')) {
      const [h1, m1] = heureDebut.split(':').map((v) => parseInt(v, 10));
      const [h2, m2] = heureFin.split(':').map((v) => parseInt(v, 10));
      if (!isNaN(h1) && !isNaN(m1) && !isNaN(h2) && !isNaN(m2)) {
        let diffMinutes = (h2 * 60 + m2) - (h1 * 60 + m1);
        if (diffMinutes < 0) diffMinutes += 24 * 60; // franchissement minuit
        const calculated = Math.round((diffMinutes / 60) * 100) / 100;
        if (calculated > 0) {
          setDureeHeures(calculated.toString());
        }
      }
    }
  }, [heureDebut, heureFin]);

  // Enregistrement d'une heure supplémentaire
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!selectedWorker) {
      setFeedback({ type: 'error', text: 'Veuillez saisir un numéro d\'ouvrier valide.' });
      return;
    }

    const duration = parseFloat(dureeHeures.replace(',', '.'));
    if (isNaN(duration) || duration <= 0) {
      setFeedback({ type: 'error', text: 'La durée en heures doit être un nombre strictement supérieur à 0.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ouvrier_id: selectedWorker.id,
        numero_ouvrier: selectedWorker.numero,
        date: formDate,
        heure_debut: heureDebut || null,
        heure_fin: heureFin || null,
        duree_heures: duration,
        heures: duration,
        domaine_id: selectedDomaineId || null,
        serre_id: selectedSerreId || null,
        observation: observation.trim() || null,
      };

      const res = await createHeureSupplementaireServer(payload);
      if (res.success && res.item) {
        setItems((prev) => [res.item!, ...prev]);
        setFeedback({
          type: 'success',
          text: `✓ ${duration} heure(s) enregistrée(s) pour #${selectedWorker.numero} ${selectedWorker.nom}.`,
        });
        // Réinitialiser champs ouvrier
        setWorkerNumberInput('');
        setSelectedWorker(null);
        setObservation('');
      } else {
        // Enregistrement fallback local
        const localRes = storage.saveHeureSupplementaire(
          currentUser.company_id || 'cie_lahcen_pointeur',
          selectedWorker.id,
          formDate,
          {
            type: 'heures',
            heures: duration,
            quantite: duration,
            unite: 'heure',
            domaine_id: selectedDomaineId,
            serre_id: selectedSerreId,
            observation: observation.trim() || undefined,
            created_by_id: currentUser.id,
            created_by_nom: currentUser.nom,
          }
        );
        if (localRes.success && localRes.item) {
          setItems((prev) => [localRes.item!, ...prev]);
          setFeedback({
            type: 'success',
            text: `✓ ${duration} h enregistrée(s) localement pour #${selectedWorker.numero} ${selectedWorker.nom}.`,
          });
          setWorkerNumberInput('');
          setSelectedWorker(null);
          setObservation('');
        } else {
          setFeedback({ type: 'error', text: res.error || 'Erreur lors de l\'enregistrement.' });
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || 'Erreur de connexion.' });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setFeedback(null), 4000);
    }
  };

  // Suppression
  const handleDelete = async (id: string) => {
    if (!confirm('Confirmez-vous la suppression de cette heure supplémentaire ?')) return;
    try {
      await deleteHeureSupplementaireServer(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setFeedback({ type: 'success', text: 'Opération supprimée avec succès.' });
    } catch {
      storage.deleteHeureSupplementaire(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
      setFeedback({ type: 'success', text: 'Supprimée localement.' });
    }
    setTimeout(() => setFeedback(null), 3000);
  };

  // Ouvrir modification
  const handleOpenEdit = (item: HeureSupplementaire) => {
    setEditingItem(item);
    setEditDuration((item.duree_heures || item.heures || item.quantite || 0).toString());
    setEditDebut(item.heure_debut || '');
    setEditFin(item.heure_fin || '');
    setEditObs(item.observation || '');
  };

  // Enregistrer modification
  const handleSaveEdit = async () => {
    if (!editingItem) return;
    const dur = parseFloat(editDuration.replace(',', '.'));
    if (isNaN(dur) || dur <= 0) {
      alert('La durée doit être supérieure à 0.');
      return;
    }

    try {
      const res = await updateHeureSupplementaireServer(editingItem.id, {
        duree_heures: dur,
        heures: dur,
        heure_debut: editDebut || null,
        heure_fin: editFin || null,
        observation: editObs.trim() || null,
      });

      if (res.success && res.item) {
        setItems((prev) => prev.map((it) => (it.id === editingItem.id ? res.item! : it)));
      } else {
        setItems((prev) =>
          prev.map((it) =>
            it.id === editingItem.id
              ? { ...it, duree_heures: dur, heures: dur, quantite: dur, observation: editObs.trim() }
              : it
          )
        );
      }
      setEditingItem(null);
      setFeedback({ type: 'success', text: 'Heure supplémentaire mise à jour.' });
    } catch (err: any) {
      alert(err.message || 'Erreur mise à jour');
    }
  };

  // Liste filtrée pour l'historique
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filterDate && it.date !== filterDate) return false;
      if (filterDomaine !== 'ALL' && it.domaine_id !== filterDomaine) return false;
      if (filterWorkerQuery.trim()) {
        const q = filterWorkerQuery.trim().toLowerCase();
        const numMatch = it.numero_ouvrier?.toString().includes(q);
        const ouvrier = allOuvriers.find((o) => o.id === it.ouvrier_id);
        const nameMatch = ouvrier?.nom.toLowerCase().includes(q);
        if (!numMatch && !nameMatch) return false;
      }
      return true;
    });
  }, [items, filterDate, filterDomaine, filterWorkerQuery, allOuvriers]);

  // Récapitulatif : totaux par ouvrier, par domaine, total global
  const statsRecap = useMemo(() => {
    const byWorker: Record<string, { ouvrier: Ouvrier | undefined; numero: number; totalHeures: number; count: number }> = {};
    const byDomaine: Record<string, number> = {};
    let grandTotal = 0;

    filteredItems.forEach((it) => {
      const h = Number(it.duree_heures || it.heures || it.quantite || 0);
      grandTotal += h;

      // Par ouvrier
      const wKey = it.ouvrier_id || `num_${it.numero_ouvrier}`;
      if (!byWorker[wKey]) {
        const o = allOuvriers.find((x) => x.id === it.ouvrier_id || x.numero === it.numero_ouvrier);
        byWorker[wKey] = {
          ouvrier: o,
          numero: it.numero_ouvrier,
          totalHeures: 0,
          count: 0,
        };
      }
      byWorker[wKey].totalHeures += h;
      byWorker[wKey].count += 1;

      // Par domaine
      const dKey = it.domaine_id || 'Autre';
      byDomaine[dKey] = (byDomaine[dKey] || 0) + h;
    });

    return {
      grandTotal: Math.round(grandTotal * 100) / 100,
      workersList: Object.values(byWorker).sort((a, b) => b.totalHeures - a.totalHeures),
      domainesSummary: byDomaine,
      totalEntries: filteredItems.length,
    };
  }, [filteredItems, allOuvriers]);

  // Export Excel SheetJS
  const handleExportExcel = () => {
    if (filteredItems.length === 0) {
      alert('Aucune donnée à exporter pour ces filtres.');
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
        Domaine: d ? d.nom : it.domaine_id || '—',
        Serre: s ? s.nom : it.serre_id || '—',
        'Heure Début': it.heure_debut || '—',
        'Heure Fin': it.heure_fin || '—',
        'Durée (Heures)': it.duree_heures || it.heures || it.quantite || 0,
        Observation: it.observation || '',
        'Enregistré par': it.created_by_nom || it.created_by_role || '—',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Heures Supplémentaires');
    const filename = `AgriPointage_Heures_Supp_${filterDate || 'Historique'}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  return (
    <div className="space-y-3 pb-24 animate-in fade-in select-none">
      {/* En-tête */}
      <div className="bg-white rounded-3xl p-3.5 border border-slate-200 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-600 text-white flex items-center justify-center font-black text-xl shadow-sm">
            ⏱️
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>HEURES SUPPLÉMENTAIRES</span>
              <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-full font-bold">
                {currentUser.role === 'admin' ? 'Admin' : 'Caporal'}
              </span>
            </h2>
            <p className="text-xs font-semibold text-slate-500">Temps supplémentaire par ouvrier</p>
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
              ? 'bg-amber-600 text-white shadow-xs'
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
              ? 'bg-amber-600 text-white shadow-xs'
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
              ? 'bg-amber-600 text-white shadow-xs'
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
          {/* Ligne Date & Domaine */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Date de travail
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => {
                    setFormDate(e.target.value);
                    onSelectDate(e.target.value);
                  }}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-amber-600 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Domaine
              </label>
              <select
                value={selectedDomaineId}
                onChange={(e) => setSelectedDomaineId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-amber-600 outline-none"
              >
                {domaines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Saisie Ouvrier par Numéro */}
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
                className="w-28 bg-amber-50/50 border-2 border-amber-400 rounded-2xl px-3 py-2.5 text-base font-black text-amber-950 focus:border-amber-600 outline-none"
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

          {/* Horaires et Durée calculée */}
          <div className="bg-amber-50/40 rounded-2xl p-3 border border-amber-200 space-y-2">
            <div className="text-[11px] font-black text-amber-950 uppercase flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-700" />
              <span>Plage horaire & Durée automatique</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Début</label>
                <input
                  type="time"
                  value={heureDebut}
                  onChange={(e) => setHeureDebut(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-black text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Fin</label>
                <input
                  type="time"
                  value={heureFin}
                  onChange={(e) => setHeureFin(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-black text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-amber-900 mb-0.5">Durée (h)</label>
                <input
                  type="number"
                  step="0.25"
                  min="0.1"
                  value={dureeHeures}
                  onChange={(e) => setDureeHeures(e.target.value)}
                  className="w-full bg-amber-100/70 border-2 border-amber-500 rounded-xl px-2 py-1.5 text-xs font-black text-amber-950"
                />
              </div>
            </div>
          </div>

          {/* Serre (Optionnel) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-black text-slate-600 uppercase mb-1">
                Serre (Optionnel)
              </label>
              <select
                value={selectedSerreId}
                onChange={(e) => setSelectedSerreId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-amber-600 outline-none"
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
                placeholder="Ex: Arrosage tardif"
                value={observation}
                onChange={(e) => setObservation(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-800 focus:border-amber-600 outline-none"
              />
            </div>
          </div>

          {/* Bouton de validation */}
          <button
            type="submit"
            disabled={isSubmitting || !selectedWorker}
            className={`w-full py-3.5 rounded-2xl font-black text-xs flex items-center justify-center gap-2 shadow-md transition active:scale-98 ${
              selectedWorker
                ? 'bg-amber-600 hover:bg-amber-700 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>ENREGISTRER L'HEURE SUPPLÉMENTAIRE</span>
          </button>
        </form>
      )}

      {/* ONGLET 2 : HISTORIQUE & FILTRES */}
      {activeTab === 'historique' && (
        <div className="space-y-3">
          {/* Barre de Filtres */}
          <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-xs space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
              />
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 rounded-xl"
              >
                Toutes dates
              </button>

              <select
                value={filterDomaine}
                onChange={(e) => setFilterDomaine(e.target.value)}
                className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold text-slate-800 outline-none"
              >
                <option value="ALL">Tous domaines</option>
                {domaines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nom}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher par n° ou nom d'ouvrier..."
                value={filterWorkerQuery}
                onChange={(e) => setFilterWorkerQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-xs font-bold text-slate-800 outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] font-bold text-slate-500">
                {filteredItems.length} opération(s) trouvée(s)
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
                <Clock className="w-10 h-10 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
                <p className="text-xs font-bold">Aucune heure supplémentaire enregistrée pour ces critères.</p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const ouvrier = allOuvriers.find((o) => o.id === item.ouvrier_id || o.numero === item.numero_ouvrier);
                const domaineObj = domaines.find((d) => d.id === item.domaine_id);
                const serreObj = serres.find((s) => s.id === item.serre_id);
                const duration = item.duree_heures || item.heures || item.quantite || 0;

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-950 font-black flex items-center justify-center text-xs shrink-0">
                        #{item.numero_ouvrier}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-slate-900">
                            {ouvrier ? ouvrier.nom : `Ouvrier #${item.numero_ouvrier}`}
                          </span>
                          <span className="text-[10px] font-black text-amber-950 bg-amber-100 px-1.5 py-0.2 rounded-md">
                            {duration} h
                          </span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>📅 {item.date}</span>
                          {domaineObj && <span>📍 {domaineObj.nom}</span>}
                          {serreObj && <span>🏛️ {serreObj.nom}</span>}
                          {item.heure_debut && item.heure_fin && (
                            <span>⏰ {item.heure_debut} - {item.heure_fin}</span>
                          )}
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
                        className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
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

      {/* ONGLET 3 : RÉCAPITULATIF & TOTAUX */}
      {activeTab === 'recap' && (
        <div className="space-y-3">
          {/* Carte Grand Total */}
          <div className="bg-gradient-to-br from-amber-600 to-amber-800 text-white rounded-3xl p-4 shadow-md flex items-center justify-between">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-200 block">
                Total Heures Supplémentaires
              </span>
              <span className="text-3xl font-black">{statsRecap.grandTotal} h</span>
              <span className="text-[11px] font-semibold text-amber-100 block mt-0.5">
                {statsRecap.workersList.length} ouvrier(s) concerné(s) ({statsRecap.totalEntries} saisies)
              </span>
            </div>

            <button
              type="button"
              onClick={handleExportExcel}
              className="bg-white text-amber-900 font-black text-xs px-3.5 py-2.5 rounded-2xl shadow-sm hover:bg-amber-50 transition active:scale-95 flex items-center gap-1.5"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>Excel</span>
            </button>
          </div>

          {/* Tableau Récapitulatif par Ouvrier */}
          <div className="bg-white rounded-3xl p-3 border border-slate-200 shadow-xs">
            <h3 className="text-xs font-black text-slate-800 uppercase mb-2 px-1">
              Détail par ouvrier
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
                        {item.count} enregistrement(s)
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-black text-amber-900 bg-amber-50 px-2.5 py-1 rounded-xl border border-amber-200">
                    {Math.round(item.totalHeures * 100) / 100} h
                  </span>
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
                Modifier l'heure supplémentaire
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
              <label className="block text-[10px] font-black text-slate-600 mb-1">Durée (heures)</label>
              <input
                type="number"
                step="0.25"
                min="0.1"
                value={editDuration}
                onChange={(e) => setEditDuration(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-black text-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">Début</label>
                <input
                  type="time"
                  value={editDebut}
                  onChange={(e) => setEditDebut(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">Fin</label>
                <input
                  type="time"
                  value={editFin}
                  onChange={(e) => setEditFin(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2 py-1.5 text-xs font-bold"
                />
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
                className="flex-1 py-2.5 rounded-xl font-black text-xs bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
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
