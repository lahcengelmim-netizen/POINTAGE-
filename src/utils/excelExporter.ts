/**
 * Service d'exportation Excel conforme aux spécifications exactes :
 * - Feuille unique "Pointage"
 * - Colonnes exactes, dans cet ordre :
 *   Date | Domaine | N° ouvrier | Nom et prénom | Présence | Code tâche | Tâche | Heures supplémentaires
 * - Date au format JJ/MM/AAAA.
 * - Domaine : D1 à D5 (le domaine choisi ce jour-là pour le pointage).
 * - N° ouvrier : numéro de l'ouvrier.
 * - Nom et prénom : nom complet de l'ouvrier.
 * - Présence : "Présent" ou "Absent".
 * - Une ligne par couple (ouvrier, tâche) pour chaque date concernée.
 * - Un ouvrier affecté à plusieurs tâches : une ligne par tâche, avec les mêmes informations d'ouvrier.
 * - Un ouvrier présent sans aucune tâche : une seule ligne, avec Code tâche et Tâche vides.
 * - Un ouvrier absent : une seule ligne, Présence = "Absent", Code tâche et Tâche vides.
 * - Les absents sont donc exportés.
 * - Heures supplémentaires : écrire la quantité et l'unité (ex : "2 ruban", "1 heure", "2 forfait").
 *   Si l'ouvrier a une entrée supplémentaire ce jour-là, la répéter sur chacune de ses lignes pour cette date. Vide si aucune entrée.
 * - Trier par date, puis par domaine, puis par numéro d'ouvrier, puis par code tâche.
 * - En-têtes en gras, largeur des colonnes ajustée, filtre automatique, volets figés sous la ligne d'en-tête.
 * - Nom de fichier : "pointage-JJ-MM-AAAA.xlsx" ou "pointage-JJ-MM-AAAA_au_JJ-MM-AAAA.xlsx".
 * - Téléchargement via Blob et lien avec attribut download.
 * - Confirmation : "Export terminé : X lignes".
 */

import * as XLSX from 'xlsx';
import { Company, Ouvrier, Tache, Domaine, Pointage, AffectationTache, HeureSupplementaire } from '../types';
import * as storage from '../services/storage';

export interface ExportPeriodParams {
  mode: 'unique' | 'periode';
  singleDate: string; // YYYY-MM-DD
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
}

export interface ExportResult {
  success: boolean;
  filename: string;
  totalLignes: number;
  error?: string;
}

export function formatDateForFilename(dateIso: string): string {
  const parts = dateIso.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateIso;
}

export function formatDateForCell(dateIso: string): string {
  const parts = dateIso.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateIso;
}

function getDatesInRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const current = new Date(startIso);
  const end = new Date(endIso);

  if (current > end) {
    return [];
  }

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Formate le texte d'heures supplémentaires pour un ouvrier donné ce jour-là :
 * Ex : "2 ruban", "1 heure", "2 forfait", ou combiné "2 ruban, 1 heure"
 */
function formatHeuresSuppCell(suppEntries: HeureSupplementaire[]): string {
  if (!suppEntries || suppEntries.length === 0) return '';

  return suppEntries
    .map((s) => {
      const q = s.quantite !== undefined && s.quantite !== null
        ? s.quantite
        : s.heures !== undefined && s.heures !== null
        ? s.heures
        : '';
      const u = s.unite || (s.type === 'tache' ? 'ruban' : 'heure');
      if (q !== '') {
        return `${q} ${u}`.trim();
      }
      return `${u}`.trim();
    })
    .filter(Boolean)
    .join(', ');
}

export function exportPointageExcel(
  company: Company,
  ouvriers: Ouvrier[],
  taches: Tache[],
  domaines: Domaine[],
  defaultDomaineId: string,
  period: ExportPeriodParams
): ExportResult {
  try {
    // 1. Validation de la période
    let datesToExport: string[] = [];
    let filename = '';

    if (period.mode === 'unique') {
      if (!period.singleDate || !period.singleDate.trim()) {
        return {
          success: false,
          filename: '',
          totalLignes: 0,
          error: 'Veuillez sélectionner une date valide pour l\'export.',
        };
      }
      datesToExport = [period.singleDate.trim()];
      filename = `pointage-${formatDateForFilename(period.singleDate.trim())}.xlsx`;
    } else {
      const start = period.startDate?.trim();
      const end = period.endDate?.trim();

      if (!start || !end) {
        return {
          success: false,
          filename: '',
          totalLignes: 0,
          error: 'Veuillez renseigner la date de début et la date de fin de la période.',
        };
      }

      if (start > end) {
        return {
          success: false,
          filename: '',
          totalLignes: 0,
          error: 'Période invalide : la date de début doit être antérieure ou égale à la date de fin.',
        };
      }

      datesToExport = getDatesInRange(start, end);
      if (datesToExport.length === 0) {
        return {
          success: false,
          filename: '',
          totalLignes: 0,
          error: 'Période invalide ou vide.',
        };
      }

      filename = `pointage-${formatDateForFilename(start)}_au_${formatDateForFilename(end)}.xlsx`;
    }

    // Indexation des données de référence
    const ouvrierMap = new Map<string, Ouvrier>(ouvriers.map((o) => [o.id, o]));
    const tacheMap = new Map<string, Tache>(taches.map((t) => [t.id, t]));
    const domaineMap = new Map<string, Domaine>(domaines.map((d) => [d.id, d]));

    // Liste des ouvriers actifs de la société (référence pour absences)
    const activeWorkers = ouvriers.filter((o) => o.actif);

    interface ExportRowItem {
      dateRaw: string;
      domaineNom: string;
      numeroOuvrier: number;
      codeTache: string;
      cells: (string | number)[];
    }

    const rows: ExportRowItem[] = [];

    // 2. Traitement jour par jour
    datesToExport.forEach((dateIso) => {
      const dateCell = formatDateForCell(dateIso);

      // Charger les données de la date
      const dayPointages: Pointage[] = storage.getPointages(company.id, dateIso);
      const dayAffectations: AffectationTache[] = storage.getAffectations(company.id, dateIso);
      const dayHeuresSupp: HeureSupplementaire[] = storage.getHeuresSupplementaires(company.id, dateIso);

      // Déterminer le domaine par défaut de la journée (ex: D1 à D5, choisi pour ce jour)
      let dayDominantDomNom = 'D2';
      const firstWithDom = dayPointages.find((p) => p.domaine_id);
      if (firstWithDom && firstWithDom.domaine_id) {
        const dom = domaineMap.get(firstWithDom.domaine_id);
        if (dom) dayDominantDomNom = dom.nom;
      } else {
        const defaultDom = domaineMap.get(defaultDomaineId);
        if (defaultDom) dayDominantDomNom = defaultDom.nom;
      }

      // Map des pointages par ID ouvrier (présents uniquement)
      const pointedWorkersMap = new Map<string, Pointage>();
      dayPointages.forEach((p) => {
        if (p.present !== false) {
          pointedWorkersMap.set(p.ouvrier_id, p);
        }
      });

      // Identifier tous les ouvriers à exporter ce jour-là :
      // - Tous les ouvriers actifs (présents ou absents)
      // - Ainsi que les éventuels ouvriers inactifs qui auraient été pointés (historique)
      const workersForDateMap = new Map<string, Ouvrier>();
      activeWorkers.forEach((w) => workersForDateMap.set(w.id, w));
      dayPointages.forEach((p) => {
        const w = ouvrierMap.get(p.ouvrier_id);
        if (w) workersForDateMap.set(w.id, w);
      });

      const workersListForDate = Array.from(workersForDateMap.values());

      workersListForDate.forEach((ouvrier) => {
        const pointage = pointedWorkersMap.get(ouvrier.id);
        const isPresent = Boolean(pointage && pointage.present !== false);

        // Domaine de cet ouvrier pour ce jour
        let workerDomNom = dayDominantDomNom;
        if (pointage && pointage.domaine_id) {
          const domObj = domaineMap.get(pointage.domaine_id);
          if (domObj) workerDomNom = domObj.nom;
        }

        // Heures supplémentaires de cet ouvrier pour ce jour
        const workerSuppEntries = dayHeuresSupp.filter((h) => h.ouvrier_id === ouvrier.id);
        const heuresSuppText = formatHeuresSuppCell(workerSuppEntries);

        if (!isPresent) {
          // --- OUVRIER ABSENT ---
          // Une seule ligne, Présence = "Absent", Code tâche et Tâche vides
          rows.push({
            dateRaw: dateIso,
            domaineNom: workerDomNom,
            numeroOuvrier: ouvrier.numero,
            codeTache: '',
            cells: [
              dateCell,
              workerDomNom,
              ouvrier.numero,
              ouvrier.nom,
              'Absent',
              '',
              '',
              heuresSuppText,
            ],
          });
        } else {
          // --- OUVRIER PRÉSENT ---
          // Trouver toutes les tâches affectées à cet ouvrier pour cette date
          const workerAffs = dayAffectations.filter((a) => a.ouvrier_id === ouvrier.id);

          // Rétrocompatibilité : si aucune affectation mais pointage.tache_id existe
          const tacheIds: string[] = workerAffs.map((a) => a.tache_id);
          if (tacheIds.length === 0 && pointage?.tache_id) {
            tacheIds.push(pointage.tache_id);
          }

          if (tacheIds.length === 0) {
            // Présent sans aucune tâche : une seule ligne, Code tâche et Tâche vides
            rows.push({
              dateRaw: dateIso,
              domaineNom: workerDomNom,
              numeroOuvrier: ouvrier.numero,
              codeTache: '',
              cells: [
                dateCell,
                workerDomNom,
                ouvrier.numero,
                ouvrier.nom,
                'Présent',
                '',
                '',
                heuresSuppText,
              ],
            });
          } else {
            // Un ouvrier affecté à plusieurs tâches : une ligne par tâche
            tacheIds.forEach((tId) => {
              const t = tacheMap.get(tId);
              const code = t?.code?.trim() || '';
              const nom = t?.nom?.trim() || '';

              rows.push({
                dateRaw: dateIso,
                domaineNom: workerDomNom,
                numeroOuvrier: ouvrier.numero,
                codeTache: code,
                cells: [
                  dateCell,
                  workerDomNom,
                  ouvrier.numero,
                  ouvrier.nom,
                  'Présent',
                  code,
                  nom,
                  heuresSuppText,
                ],
              });
            });
          }
        }
      });
    });

    // 3. Tri selon spécification :
    // "Trier par date, puis par domaine, puis par numéro d'ouvrier, puis par code tâche."
    rows.sort((a, b) => {
      // 1. Date (chronologique)
      if (a.dateRaw !== b.dateRaw) {
        return a.dateRaw.localeCompare(b.dateRaw);
      }
      // 2. Domaine
      if (a.domaineNom !== b.domaineNom) {
        return a.domaineNom.localeCompare(b.domaineNom);
      }
      // 3. Numéro d'ouvrier (numérique croissant)
      if (a.numeroOuvrier !== b.numeroOuvrier) {
        return a.numeroOuvrier - b.numeroOuvrier;
      }
      // 4. Code tâche
      return a.codeTache.localeCompare(b.codeTache);
    });

    // 4. Colonnes dans l'ordre exact :
    // Date | Domaine | N° ouvrier | Nom et prénom | Présence | Code tâche | Tâche | Heures supplémentaires
    const headers = [
      'Date',
      'Domaine',
      'N° ouvrier',
      'Nom et prénom',
      'Présence',
      'Code tâche',
      'Tâche',
      'Heures supplémentaires',
    ];

    const sheetData: (string | number)[][] = [headers, ...rows.map((r) => r.cells)];

    // 5. Création du classeur avec feuille unique "Pointage"
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

    const totalRowsCount = sheetData.length;
    const numCols = headers.length;

    // Calcul de la largeur des colonnes ajustée au contenu
    const colWidths: number[] = new Array(numCols).fill(12);
    sheetData.forEach((row) => {
      row.forEach((cell, colIdx) => {
        const len = String(cell !== undefined && cell !== null ? cell : '').length;
        if (len > colWidths[colIdx]) {
          colWidths[colIdx] = len;
        }
      });
    });

    worksheet['!cols'] = colWidths.map((w) => ({ wch: Math.max(w + 3, 12) }));

    // Filtre automatique sur la première ligne
    const lastColLetter = XLSX.utils.encode_col(numCols - 1);
    worksheet['!autofilter'] = {
      ref: `A1:${lastColLetter}${Math.max(totalRowsCount, 1)}`,
    };

    // Volets figés sous la ligne d'en-tête (ligne 1 figée)
    worksheet['!views'] = [
      {
        state: 'frozen',
        ySplit: 1,
        xSplit: 0,
        topLeftCell: 'A2',
        activeCell: 'A2',
      },
    ];
    (worksheet as any)['!freeze'] = {
      state: 'frozen',
      ySplit: 1,
      xSplit: 0,
      topLeftCell: 'A2',
      activeCell: 'A2',
    };

    // En-têtes en gras
    for (let c = 0; c < numCols; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].s = {
          font: { bold: true, color: { rgb: '000000' } },
          fill: { fgColor: { rgb: 'E2E8F0' } },
        };
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pointage');

    // 6. Téléchargement sur le téléphone via lien Blob et attribut download
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);

    return {
      success: true,
      filename,
      totalLignes: rows.length,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue lors de l\'export.';
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      error: msg,
    };
  }
}
