/**
 * Utilitaires métier et workflow de validation — Module Contractuelles (Lahcen Pointeur)
 *
 * Règles garanties :
 * - Calcul déterministe de la durée de travail (heure_debut -> heure_fin)
 * - Distinction stricte entre tarif_initial (catalogue), montant_propose (caporal), montant_valide (admin)
 * - Aucun montant non validé par l'administrateur n'est comptabilisé dans la rémunération officielle
 * - Si ABSENT : 0 DH proposé et 0 DH validé
 * - Historique immuable des modifications, soumissions, validations et refus
 */

import * as XLSX from 'xlsx';
import {
  ContractuelActivite,
  ContractuelHistoriqueAction,
  ContractuelHistoriqueEntry,
  ContractuelOuvrier,
  ContractuelPointage,
  StatutValidationContractuel,
} from '../types';

export function roundAmount(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100) / 100;
}

/**
 * Calcule la durée en heures entre deux horaires HH:MM.
 * Retourne null si un horaire est absent ou invalide ou si fin <= début.
 */
export function computeWorkDurationHours(
  heureDebut?: string | null,
  heureFin?: string | null
): number | null {
  if (!heureDebut || !heureFin) return null;
  const m1 = /^(\d{1,2}):(\d{2})$/.exec(heureDebut.trim());
  const m2 = /^(\d{1,2}):(\d{2})$/.exec(heureFin.trim());
  if (!m1 || !m2) return null;

  const h1 = parseInt(m1[1], 10);
  const min1 = parseInt(m1[2], 10);
  const h2 = parseInt(m2[1], 10);
  const min2 = parseInt(m2[2], 10);

  if (h1 > 23 || h2 > 23 || min1 > 59 || min2 > 59) return null;

  const startMinutes = h1 * 60 + min1;
  const endMinutes = h2 * 60 + min2;
  if (endMinutes <= startMinutes) return null;

  return Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
}

export function formatDurationLabel(duree?: number | null): string {
  if (duree === null || duree === undefined || !Number.isFinite(duree) || duree <= 0) {
    return '—';
  }
  const totalMin = Math.round(duree * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function normalizeStatutValidation(raw?: string | null): StatutValidationContractuel {
  const val = String(raw || '').trim().toUpperCase();
  if (val === 'VALIDE' || val === 'VALIDÉ') return 'VALIDE';
  if (val === 'REFUSE' || val === 'REFUSÉ') return 'REFUSE';
  if (
    val === 'SOUMIS' ||
    val === 'SOUMIS_PAR_CAPORAL' ||
    val === 'EN_ATTENTE' ||
    val === 'EN_ATTENTE_VALIDATION_ADMIN' ||
    val === 'EN_ATTENTE_DE_VALIDATION_ADMIN'
  ) {
    return 'SOUMIS';
  }
  return 'BROUILLON';
}

export function getStatutValidationLabel(statut?: string | null): string {
  const norm = normalizeStatutValidation(statut);
  switch (norm) {
    case 'VALIDE':
      return 'VALIDÉ';
    case 'REFUSE':
      return 'REFUSÉ';
    case 'SOUMIS':
      return 'SOUMIS (Attente Admin)';
    default:
      return 'BROUILLON';
  }
}

export function isTarifModifie(
  tarifInitial?: number | null,
  montantPropose?: number | null,
  present: boolean = true
): boolean {
  if (!present) return false;
  const initVal = roundAmount(Number(tarifInitial) || 0);
  const propVal = roundAmount(Number(montantPropose) || 0);
  return Math.abs(propVal - initVal) > 0.009;
}

/**
 * Montant officiel validé par l'administrateur uniquement.
 * Retourne 0 si absent, brouillon, soumis en attente, ou refusé.
 */
export function getOfficialPointageMontant(ptg?: Partial<ContractuelPointage> | null): number {
  if (!ptg || !ptg.present) return 0;
  const statut = normalizeStatutValidation(ptg.statut_validation);
  if (statut !== 'VALIDE') return 0;
  return roundAmount(Number(ptg.montant_valide ?? ptg.montant_total_jour ?? 0));
}

/**
 * Montant proposé par le caporal (ou tarif initial si pas encore modifié).
 */
export function getProposedPointageMontant(
  ptg?: Partial<ContractuelPointage> | null,
  fallbackTarifInitial: number = 0
): number {
  if (!ptg || !ptg.present) return 0;
  if (ptg.montant_propose !== undefined && ptg.montant_propose !== null) {
    return roundAmount(Number(ptg.montant_propose));
  }
  if (typeof ptg.montant_total_jour === 'number' && ptg.montant_total_jour > 0) {
    return roundAmount(ptg.montant_total_jour);
  }
  return roundAmount(fallbackTarifInitial);
}

export function buildHistoriqueEntry(params: {
  action: ContractuelHistoriqueAction;
  auteur_id: string;
  auteur_nom: string;
  auteur_role: string;
  statut_avant?: StatutValidationContractuel | null;
  statut_apres: StatutValidationContractuel;
  present: boolean;
  domaine_id?: string;
  taches_ids?: string[];
  taches_noms?: string[];
  serres_ids?: string[];
  serres_noms?: string[];
  heure_debut?: string | null;
  heure_fin?: string | null;
  duree_heures?: number | null;
  tarif_initial?: number;
  montant_propose?: number;
  montant_valide?: number | null;
  tarif_modifie?: boolean;
  motif?: string | null;
  timestamp?: string;
}): ContractuelHistoriqueEntry {
  return {
    id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: params.timestamp || new Date().toISOString(),
    action: params.action,
    auteur_id: params.auteur_id,
    auteur_nom: params.auteur_nom,
    auteur_role: params.auteur_role,
    statut_avant: params.statut_avant ?? null,
    statut_apres: params.statut_apres,
    present: params.present,
    domaine_id: params.domaine_id,
    taches_ids: params.taches_ids ? [...params.taches_ids] : [],
    taches_noms: params.taches_noms ? [...params.taches_noms] : [],
    serres_ids: params.serres_ids ? [...params.serres_ids] : [],
    serres_noms: params.serres_noms ? [...params.serres_noms] : [],
    heure_debut: params.heure_debut ?? null,
    heure_fin: params.heure_fin ?? null,
    duree_heures: params.duree_heures ?? null,
    tarif_initial: params.tarif_initial !== undefined ? roundAmount(params.tarif_initial) : undefined,
    montant_propose: params.montant_propose !== undefined ? roundAmount(params.montant_propose) : undefined,
    montant_valide:
      params.montant_valide !== undefined && params.montant_valide !== null
        ? roundAmount(params.montant_valide)
        : null,
    tarif_modifie: params.tarif_modifie,
    motif: params.motif ?? null,
  };
}

export function appendHistorique(
  existingHistory: ContractuelHistoriqueEntry[] | undefined | null,
  nextEntry: ContractuelHistoriqueEntry
): ContractuelHistoriqueEntry[] {
  const prev = Array.isArray(existingHistory) ? existingHistory : [];
  return [...prev, nextEntry];
}

export function buildContractuellesWorkbook(params: {
  pointages: ContractuelPointage[];
  allOuvriers: ContractuelOuvrier[];
  date?: string;
  filterDesc?: string;
}): { wb: XLSX.WorkBook; fileName: string; officialTotalDH: number; proposedTotalDH: number } {
  const { pointages, allOuvriers, date, filterDesc } = params;
  const dateFormatted = date || new Date().toISOString().slice(0, 10);

  const totalOuvriers = allOuvriers.length;
  const presentsCount = pointages.filter((p) => p.present).length;
  const absentsCount = Math.max(0, totalOuvriers - presentsCount);
  const validatedCount = pointages.filter(
    (p) => p.present && normalizeStatutValidation(p.statut_validation) === 'VALIDE'
  ).length;
  const pendingCount = pointages.filter(
    (p) => p.present && normalizeStatutValidation(p.statut_validation) === 'SOUMIS'
  ).length;

  const officialTotalDH = roundAmount(
    pointages.reduce((sum, p) => sum + getOfficialPointageMontant(p), 0)
  );
  const proposedTotalDH = roundAmount(
    pointages.reduce((sum, p) => sum + getProposedPointageMontant(p), 0)
  );

  const validatedActivities: Array<ContractuelActivite & { pointage_ref?: ContractuelPointage }> = [];
  pointages.forEach((p) => {
    if (p.present && normalizeStatutValidation(p.statut_validation) === 'VALIDE') {
      if (p.activites && p.activites.length > 0) {
        p.activites.forEach((a) => validatedActivities.push({ ...a, pointage_ref: p }));
      } else {
        validatedActivities.push({
          id: `act_synth_${p.id}`,
          pointage_id: p.id,
          company_id: p.company_id,
          ouvrier_id: p.ouvrier_id,
          nom_complet: p.nom_complet,
          matricule: p.matricule,
          date: p.date,
          tache_id: p.taches_ids?.[0] || 'tch_contractuel',
          tache_nom: p.taches_texte || p.taches_noms?.join(', ') || 'Prestation contractuelle',
          domaine_id: p.domaine_id,
          serre_id: p.serre_id || p.serres_ids?.[0] || 'non_affectee',
          serre_nom: p.serres_texte || p.serres_noms?.join(', ') || 'Non affectée',
          serres_ids: p.serres_ids,
          serres_noms: p.serres_noms,
          serres_texte: p.serres_texte,
          mode_remuneration: 'JOUR',
          quantite: p.duree_heures || 1,
          unite: p.duree_heures ? 'HEURE' : 'JOUR',
          prix_unitaire: getOfficialPointageMontant(p),
          montant_total: getOfficialPointageMontant(p),
          created_by_id: p.created_by_id,
          created_by_nom: p.created_by_nom,
          created_at: p.created_at,
          pointage_ref: p,
        });
      }
    }
  });

  const wb = XLSX.utils.book_new();

  // FEUILLE 1 : RÉCAPITULATIF
  const recapData = [
    { 'Indicateur': 'Exploitation Agricole', 'Valeur': 'Lahcen Pointeur' },
    { 'Indicateur': 'Module', 'Valeur': 'Gestion des Contractuelles' },
    { 'Indicateur': 'Date / Période', 'Valeur': dateFormatted },
    { 'Indicateur': 'Filtre', 'Valeur': filterDesc || 'Tous les domaines' },
    { 'Indicateur': 'Total Ouvriers Contractuels', 'Valeur': totalOuvriers },
    { 'Indicateur': 'Nombre de Présents', 'Valeur': presentsCount },
    { 'Indicateur': 'Nombre d\'Absents', 'Valeur': absentsCount },
    { 'Indicateur': 'Pointages Validés Admin', 'Valeur': validatedCount },
    { 'Indicateur': 'Pointages En Attente Admin', 'Valeur': pendingCount },
    { 'Indicateur': 'Montant Total Proposé (DH)', 'Valeur': proposedTotalDH },
    { 'Indicateur': 'Montant Officiel Validé (DH)', 'Valeur': officialTotalDH },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recapData), '1. Récapitulatif');

  // FEUILLE 2 : POINTAGE DÉTAILLÉ
  const detailPointageData: any[] = [];
  if (pointages.length > 0) {
    pointages.forEach((ptg) => {
      const ouvrier = allOuvriers.find((o) => o.id === ptg.ouvrier_id);
      const isPresent = Boolean(ptg.present);
      const statut = normalizeStatutValidation(ptg.statut_validation);
      const domNom = (ptg.domaine_id || ouvrier?.domaine_id || 'dom_d2').replace('dom_', '').toUpperCase();
      const tachesStr = isPresent ? (ptg.taches_texte || ptg.taches_noms?.join(', ') || '—') : '—';
      const serresStr = isPresent ? (ptg.serres_texte || ptg.serres_noms?.join(', ') || ptg.serre_id || '—') : '—';
      const horaireStr = isPresent && ptg.heure_debut && ptg.heure_fin ? `${ptg.heure_debut} - ${ptg.heure_fin}` : '—';
      const tarifInit = roundAmount(Number(ptg.tarif_initial ?? ouvrier?.prix_convenu ?? 0));
      const montantProp = isPresent ? getProposedPointageMontant(ptg, tarifInit) : 0;
      const montantOfficiel = getOfficialPointageMontant(ptg);

      detailPointageData.push({
        'Date': ptg.date,
        'Matricule': ptg.matricule || ouvrier?.matricule || '',
        'Nom Complet': ptg.nom_complet || ouvrier?.nom_complet || '',
        'Domaine': domNom,
        'Présence': isPresent ? 'PRÉSENT' : 'ABSENT',
        'Tâches': tachesStr,
        'Serres': serresStr,
        'Horaires': horaireStr,
        'Durée': isPresent ? formatDurationLabel(ptg.duree_heures) : '—',
        'Tarif Initial (DH)': tarifInit,
        'Montant Proposé (DH)': montantProp,
        'Tarif Modifié': ptg.tarif_modifie ? 'OUI' : 'NON',
        'Statut Validation': getStatutValidationLabel(statut),
        'Montant Validé Officiel (DH)': montantOfficiel,
        'Saisi par': ptg.created_by_nom || 'Caporal',
        'Validé par': ptg.validated_by_nom || '—',
        'Motif': ptg.motif_refus || ptg.motif_modification || '—',
      });
    });
  } else {
    allOuvriers.forEach((ouvrier) => {
      detailPointageData.push({
        'Date': dateFormatted,
        'Matricule': ouvrier.matricule,
        'Nom Complet': ouvrier.nom_complet,
        'Domaine': ouvrier.domaine_id.replace('dom_', '').toUpperCase(),
        'Présence': 'Non pointé',
        'Tâches': '—',
        'Serres': '—',
        'Horaires': '—',
        'Durée': '—',
        'Tarif Initial (DH)': ouvrier.prix_convenu,
        'Montant Proposé (DH)': 0,
        'Tarif Modifié': 'NON',
        'Statut Validation': 'BROUILLON',
        'Montant Validé Officiel (DH)': 0,
        'Saisi par': '—',
        'Validé par': '—',
        'Motif': '—',
      });
    });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailPointageData), '2. Pointage Détaillé');

  // FEUILLE 3 : RÉMUNÉRATIONS OFFICIELLES VALIDÉES
  const detailRemunerationsData = validatedActivities.map((act) => ({
    'Date': act.date,
    'Matricule': act.matricule,
    'Ouvrier': act.nom_complet,
    'Domaine': act.domaine_id.replace('dom_', '').toUpperCase(),
    'Serres Affectées': act.serres_texte || act.serre_nom || act.serre_id,
    'Tâche Réalisée': act.tache_nom,
    'Horaires': act.pointage_ref?.heure_debut && act.pointage_ref?.heure_fin
      ? `${act.pointage_ref.heure_debut}-${act.pointage_ref.heure_fin}`
      : '—',
    'Durée (h)': act.pointage_ref?.duree_heures ?? '—',
    'Tarif Initial (DH)': act.pointage_ref?.tarif_initial ?? act.prix_unitaire,
    'Montant Proposé (DH)': act.pointage_ref?.montant_propose ?? act.montant_total,
    'Montant Validé Officiel (DH)': act.montant_total,
    'Validé par': act.pointage_ref?.validated_by_nom || 'Admin',
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      detailRemunerationsData.length > 0
        ? detailRemunerationsData
        : [{ 'Information': 'Aucune rémunération validée par l\'administrateur sur cette sélection.' }]
    ),
    '3. Rémunérations'
  );

  // FEUILLE 4 : RÉCAPITULATIF PAR SERRE (VALIDÉS UNIQUEMENT)
  const serreMap = new Map<string, { ouvriers: Set<string>; tachesCount: number; totalDH: number; domaine: string }>();
  validatedActivities.forEach((act) => {
    const serreNames = (Array.isArray(act.serres_noms) && act.serres_noms.length > 0)
      ? act.serres_noms
      : [act.serre_nom || act.serre_id || 'Serre Non Définie'];

    serreNames.forEach((sName) => {
      if (!serreMap.has(sName)) {
        serreMap.set(sName, {
          ouvriers: new Set<string>(),
          tachesCount: 0,
          totalDH: 0,
          domaine: act.domaine_id.replace('dom_', '').toUpperCase(),
        });
      }
      const entry = serreMap.get(sName)!;
      entry.ouvriers.add(act.ouvrier_id);
      entry.tachesCount += 1;
      entry.totalDH = roundAmount(entry.totalDH + act.montant_total / serreNames.length);
    });
  });

  const recapSerreData: any[] = [];
  serreMap.forEach((val, serreName) => {
    recapSerreData.push({
      'Serre': serreName,
      'Domaine': val.domaine,
      'Nombre d\'Ouvriers Distincts': val.ouvriers.size,
      'Nombre de Tâches': val.tachesCount,
      'Total Rémunération Validée (DH)': val.totalDH,
    });
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(recapSerreData.length > 0 ? recapSerreData : [{ 'Information': 'Aucune serre validée.' }]),
    '4. Récapitulatif Serres'
  );

  // FEUILLE 5 : HISTORIQUE PAR OUVRIER (OFFICIEL VALIDÉ UNIQUEMENT)
  const histoWorkerData = allOuvriers.map((ouvrier) => {
    const workerPtgs = pointages.filter((p) => p.ouvrier_id === ouvrier.id);
    const joursPresents = workerPtgs.filter((p) => p.present).length;
    const workerOfficialDH = roundAmount(
      workerPtgs.reduce((sum, p) => sum + getOfficialPointageMontant(p), 0)
    );
    const workerProposedDH = roundAmount(
      workerPtgs.reduce((sum, p) => sum + getProposedPointageMontant(p, ouvrier.prix_convenu), 0)
    );

    return {
      'Matricule': ouvrier.matricule,
      'Nom Complet': ouvrier.nom_complet,
      'Domaine': ouvrier.domaine_id.replace('dom_', '').toUpperCase(),
      'Jours Présents': joursPresents,
      'Mode Habituel': ouvrier.mode_remuneration,
      'Tarif Initial Catalogue (DH)': ouvrier.prix_convenu,
      'Total Proposé Caporal (DH)': workerProposedDH,
      'Total Officiel Validé Admin (DH)': workerOfficialDH,
    };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(histoWorkerData), '5. Historique Ouvrier');

  const safeDate = dateFormatted.replace(/\s+/g, '_');
  const fileName = `contractuelles-lahcen-${safeDate}.xlsx`;
  return { wb, fileName, officialTotalDH, proposedTotalDH };
}
