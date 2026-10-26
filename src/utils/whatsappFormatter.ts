/**
 * Utilitaire de formatage strict du Récapitulatif WhatsApp
 * Conforme à la spécification :
 *
 * DATE : JJ/MM/AAAA
 *
 * POINTAGE MATIN (N) : 1 - 3 - 5 - 8 - 14 - 20
 *
 * R01 - RECOLTE (2) : 1.3
 *
 * E01 - EFFEUILLAGE (2) : 5.8
 *
 * ABSENCE (2) : 4.7
 *
 * SANS TÂCHE (2) : 14.20
 */

import { Ouvrier, Tache, Pointage, Domaine, AffectationTache, HeureSupplementaire } from '../types';

export function formatDateJJMM(dateIso: string): string {
  const parts = dateIso.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateIso;
}

export function generateWhatsAppRecap(params: {
  dateIso: string;
  ouvriersActifs: Ouvrier[];
  taches: Tache[];
  pointages: Pointage[];
  affectations?: AffectationTache[];
  domaines?: Domaine[];
  defaultDomaineId?: string;
  heuresSupp?: HeureSupplementaire[];
}): string {
  const {
    dateIso,
    ouvriersActifs,
    taches,
    pointages,
    affectations = [],
    domaines = [],
    defaultDomaineId = 'dom_d2',
    heuresSupp = [],
  } = params;

  const dateFormatee = formatDateJJMM(dateIso);
  const lignes: string[] = [];

  // 1. Date affichée une seule fois en haut
  lignes.push(`DATE : ${dateFormatee}`);
  // Ligne vide après la date
  lignes.push('');

  // Présents globaux (uniquement les ouvriers marqués présents)
  const presentPointages = pointages.filter((p) => p.present !== false);
  const pointesNumeros = Array.from(
    new Set(presentPointages.map((p) => p.numero_ouvrier))
  ).sort((a, b) => a - b);
  const totalPointes = pointesNumeros.length;

  // Ouvriers pointés ID set (présents uniquement)
  const pointesIds = new Set(presentPointages.map((p) => p.ouvrier_id));
  const pointageByOuvrierId = new Map<string, Pointage>(presentPointages.map((p) => [p.ouvrier_id, p]));

  // Domaines triés dans l'ordre configuré (D2, D3, D5, D1, D4...)
  const domainesTries = [...domaines].sort((a, b) => a.ordre - b.ordre);

  // Vérifier si plusieurs domaines ont des pointages aujourd'hui
  const activeDomaines = domainesTries.filter((dom) => {
    return presentPointages.some((p) => (p.domaine_id || defaultDomaineId) === dom.id);
  });

  const hasMultipleDomaines = activeDomaines.length > 1;

  if (hasMultipleDomaines) {
    // Si plusieurs domaines ont des pointages : regrouper par domaine
    activeDomaines.forEach((domaine, index) => {
      const pointagesDomaine = presentPointages.filter(
        (p) => (p.domaine_id || defaultDomaineId) === domaine.id
      );
      const domOuvrierIds = new Set(pointagesDomaine.map((p) => p.ouvrier_id));
      const domPointesNums = Array.from(
        new Set(pointagesDomaine.map((p) => p.numero_ouvrier))
      ).sort((a, b) => a - b);

      if (domPointesNums.length === 0) return;

      if (index > 0) {
        lignes.push('');
      }

      // Titre *DOMAINE Dx*
      const cleanDomNom = domaine.nom.trim().toUpperCase();
      const domHeader = cleanDomNom.startsWith('DOMAINE')
        ? `*${cleanDomNom}*`
        : `*DOMAINE ${cleanDomNom}*`;
      lignes.push(domHeader);

      // POINTAGE MATIN (N) : 1 - 3 - 5
      lignes.push(
        `POINTAGE MATIN (${domPointesNums.length}) : ${domPointesNums.join(' - ')}`
      );
      lignes.push('');

      // Tâches dans ce domaine
      const taskLinesDom: string[] = [];
      taches.forEach((tache) => {
        // Chercher dans affectations (ou pointage.tache_id pour rétrocompatibilité)
        const affs = affectations.filter(
          (a) => a.tache_id === tache.id && domOuvrierIds.has(a.ouvrier_id)
        );
        const legacyPtgs = pointagesDomaine.filter((p) => p.tache_id === tache.id);

        const nums = Array.from(
          new Set([...affs.map((a) => a.numero_ouvrier), ...legacyPtgs.map((p) => p.numero_ouvrier)])
        ).sort((a, b) => a - b);

        if (nums.length > 0) {
          const codePart = tache.code?.trim() ? `${tache.code.trim().toUpperCase()} - ` : '';
          const tacheLabel = `${codePart}${tache.nom.trim().toUpperCase()}`;
          taskLinesDom.push(`${tacheLabel} (${nums.length}) : ${nums.join('.')}`);
        }
      });

      if (taskLinesDom.length > 0) {
        lignes.push(taskLinesDom.join('\n\n'));
      }
    });
  } else {
    // UN SEUL DOMAINE (OU AUCUN) : pas de titre de domaine
    // Ligne "POINTAGE MATIN (N) : " suivie de TOUS les numéros séparés par " - "
    lignes.push(`POINTAGE MATIN (${totalPointes}) : ${pointesNumeros.join(' - ')}`);
    // Ligne vide après le bloc POINTAGE MATIN
    lignes.push('');

    // Une ligne par tâche ayant au moins un ouvrier affecté aujourd'hui
    const taskLines: string[] = [];
    taches.forEach((tache) => {
      // Trouver tous les ouvriers affectés à cette tâche aujourd'hui
      const affs = affectations.filter((a) => a.tache_id === tache.id);
      const legacyPtgs = pointages.filter((p) => p.tache_id === tache.id);

      const nums = Array.from(
        new Set([...affs.map((a) => a.numero_ouvrier), ...legacyPtgs.map((p) => p.numero_ouvrier)])
      ).sort((a, b) => a - b);

      if (nums.length > 0) {
        const codePart = tache.code?.trim() ? `${tache.code.trim().toUpperCase()} - ` : '';
        const tacheLabel = `${codePart}${tache.nom.trim().toUpperCase()}`;
        taskLines.push(`${tacheLabel} (${nums.length}) : ${nums.join('.')}`);
      }
    });

    if (taskLines.length > 0) {
      // Une ligne VIDE entre chaque tâche
      lignes.push(taskLines.join('\n\n'));
    }
  }

  // Absents : ouvriers actifs non pointés aujourd'hui
  const absents = ouvriersActifs.filter((o) => !pointesIds.has(o.id));
  const absentsNumeros = absents.map((o) => o.numero).sort((a, b) => a - b);
  const totalAbsents = absentsNumeros.length;

  if (totalAbsents > 0) {
    // Une ligne VIDE entre la dernière tâche et la ligne ABSENCE
    lignes.push('');
    lignes.push(`ABSENCE (${totalAbsents}) : ${absentsNumeros.join('.')}`);
  }

  // Présents sans tâche : présents qui n'ont AUCUNE affectation aujourd'hui
  const assignedWorkerIds = new Set<string>();
  affectations.forEach((a) => assignedWorkerIds.add(a.ouvrier_id));
  pointages.forEach((p) => {
    if (p.tache_id) assignedWorkerIds.add(p.ouvrier_id);
  });

  const sansTacheNumeros = pointages
    .filter((p) => !assignedWorkerIds.has(p.ouvrier_id))
    .map((p) => p.numero_ouvrier)
    .sort((a, b) => a - b);

  if (sansTacheNumeros.length > 0) {
    lignes.push('');
    lignes.push(
      `SANS TÂCHE (${sansTacheNumeros.length}) : ${sansTacheNumeros.join('.')}`
    );
  }

  // Heures supplémentaires / Tâches supplémentaires (placée après la ligne ABSENCE)
  const suppWorkerNums = Array.from(
    new Set(heuresSupp.map((h) => h.numero_ouvrier))
  ).sort((a, b) => a - b);

  if (suppWorkerNums.length > 0) {
    const formattedWorkers: string[] = [];

    suppWorkerNums.forEach((num) => {
      const entries = heuresSupp.filter((h) => h.numero_ouvrier === num);
      const entryStrings = entries.map((entry) => {
        const q = entry.quantite !== undefined && entry.quantite !== null
          ? entry.quantite
          : (entry.heures !== undefined && entry.heures !== null ? entry.heures : null);
        const unit = entry.unite?.trim() || (entry.type === 'tache' ? 'ruban' : 'heure');
        if (q !== null && q !== undefined) {
          return `${q} ${unit}`;
        }
        return unit;
      });

      formattedWorkers.push(`${num} (${entryStrings.join(', ')})`);
    });

    lignes.push('');
    lignes.push(`SUPPLEMENTAIRE (${suppWorkerNums.length}) : ${formattedWorkers.join(' - ')}`);
  }

  return lignes.join('\n');
}
