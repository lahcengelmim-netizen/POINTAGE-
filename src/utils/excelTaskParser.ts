/**
 * Parser pour l'importation de tâches depuis un fichier Excel (.xlsx, .xls), CSV ou texte brut
 * Règle :
 * - Lire les colonnes "code" et "nom"
 * - Si le code est absent, laisser le champ vide
 * - Au format texte : accepter "CODE;NOM" ou "CODE - NOM" ou tabulations par ligne
 * - Dans l'aperçu d'import, signaler les codes en double en rouge
 */

import * as XLSX from 'xlsx';
import { Tache } from '../types';

export interface ParsedTaskRow {
  index: number;
  code: string | null;
  nom: string;
  statut: 'valide' | 'doublon_code' | 'doublon_nom' | 'erreur';
  motif: string;
}

export interface ParseTaskResult {
  success: boolean;
  rows: ParsedTaskRow[];
  totalLignes: number;
  validesCount: number;
  doublonsCodeCount: number;
  doublonsNomCount: number;
  erreursCount: number;
  sourceName: string;
  error?: string;
}

function normalizeHeader(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Analyse une liste de lignes brutes (texte collé)
 */
export function parseTasksFromText(
  rawText: string,
  existingTasks: Tache[],
  isReplaceMode: boolean = false
): ParseTaskResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return {
      success: false,
      rows: [],
      totalLignes: 0,
      validesCount: 0,
      doublonsCodeCount: 0,
      doublonsNomCount: 0,
      erreursCount: 0,
      sourceName: 'Texte collé',
      error: 'Le texte est vide. Veuillez coller votre liste de tâches.',
    };
  }

  const rawEntries: Array<{ code: string | null; nom: string }> = [];

  for (const line of lines) {
    let code: string | null = null;
    let nom = '';

    if (line.includes(';')) {
      const parts = line.split(';');
      code = parts[0]?.trim() || null;
      nom = parts.slice(1).join(';').trim();
    } else if (line.includes(' - ')) {
      const parts = line.split(' - ');
      code = parts[0]?.trim() || null;
      nom = parts.slice(1).join(' - ').trim();
    } else if (line.includes('\t')) {
      const parts = line.split('\t');
      code = parts[0]?.trim() || null;
      nom = parts.slice(1).join('\t').trim();
    } else {
      // Une seule valeur : nom seul, code vide
      nom = line.trim();
    }

    rawEntries.push({ code, nom });
  }

  return processParsedEntries(rawEntries, existingTasks, isReplaceMode, 'Texte collé');
}

/**
 * Analyse un fichier Excel (.xlsx, .xls) ou CSV
 */
export async function parseTasksFromFile(
  file: File,
  existingTasks: Tache[],
  isReplaceMode: boolean = false
): Promise<ParseTaskResult> {
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        rows: [],
        totalLignes: 0,
        validesCount: 0,
        doublonsCodeCount: 0,
        doublonsNomCount: 0,
        erreursCount: 0,
        sourceName: file.name,
        error: 'Le fichier ne contient aucune feuille.',
      };
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(firstSheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (rawData.length === 0) {
      return {
        success: false,
        rows: [],
        totalLignes: 0,
        validesCount: 0,
        doublonsCodeCount: 0,
        doublonsNomCount: 0,
        erreursCount: 0,
        sourceName: file.name,
        error: 'La feuille Excel est vide.',
      };
    }

    // Détecter la ligne d'en-tête
    let headerRowIndex = -1;
    let codeColIndex = -1;
    let nomColIndex = -1;

    for (let r = 0; r < Math.min(rawData.length, 5); r++) {
      const row = rawData[r] as unknown[];
      let foundCode = -1;
      let foundNom = -1;

      row.forEach((cell, colIdx) => {
        const text = normalizeHeader(String(cell || ''));
        if (text === 'code' || text === 'codetache' || text === 'ref' || text === 'reference' || text === 'id') {
          foundCode = colIdx;
        }
        if (
          text === 'nom' ||
          text === 'tache' ||
          text === 'nomtache' ||
          text === 'intitule' ||
          text === 'libelle' ||
          text === 'designation' ||
          text === 'poste'
        ) {
          foundNom = colIdx;
        }
      });

      if (foundNom !== -1 || (foundCode !== -1 && row.length >= 2)) {
        headerRowIndex = r;
        codeColIndex = foundCode;
        nomColIndex = foundNom;
        break;
      }
    }

    let startDataRow = 0;
    if (headerRowIndex !== -1) {
      startDataRow = headerRowIndex + 1;
    } else {
      // Pas d'en-tête explicite : si 2 colonnes, col 0 = code, col 1 = nom. Si 1 colonne, col 0 = nom.
      const firstRow = rawData[0] as unknown[];
      if (firstRow.length >= 2) {
        codeColIndex = 0;
        nomColIndex = 1;
      } else {
        codeColIndex = -1;
        nomColIndex = 0;
      }
    }

    if (nomColIndex === -1 && codeColIndex !== -1) {
      nomColIndex = codeColIndex === 0 ? 1 : 0;
    }

    const rawEntries: Array<{ code: string | null; nom: string }> = [];

    for (let r = startDataRow; r < rawData.length; r++) {
      const row = rawData[r] as unknown[];
      if (!row || row.every((c) => c === '' || c === undefined || c === null)) continue;

      let rawCode = codeColIndex !== -1 && row[codeColIndex] !== undefined ? String(row[codeColIndex]).trim() : '';
      let rawNom = nomColIndex !== -1 && row[nomColIndex] !== undefined ? String(row[nomColIndex]).trim() : '';

      // Si le nom est vide mais qu'on a une seule cellule qui contient "CODE;NOM" ou "CODE - NOM"
      if (!rawNom && rawCode) {
        if (rawCode.includes(';')) {
          const parts = rawCode.split(';');
          rawCode = parts[0]?.trim() || '';
          rawNom = parts.slice(1).join(';').trim();
        } else if (rawCode.includes(' - ')) {
          const parts = rawCode.split(' - ');
          rawCode = parts[0]?.trim() || '';
          rawNom = parts.slice(1).join(' - ').trim();
        }
      }

      rawEntries.push({
        code: rawCode ? rawCode : null,
        nom: rawNom,
      });
    }

    return processParsedEntries(rawEntries, existingTasks, isReplaceMode, file.name);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return {
      success: false,
      rows: [],
      totalLignes: 0,
      validesCount: 0,
      doublonsCodeCount: 0,
      doublonsNomCount: 0,
      erreursCount: 0,
      sourceName: file.name,
      error: `Impossible de lire le fichier: ${msg}`,
    };
  }
}

/**
 * Traite les entrées extraites, vérifie la validité et les doublons de codes (mis en évidence en rouge)
 */
function processParsedEntries(
  entries: Array<{ code: string | null; nom: string }>,
  existingTasks: Tache[],
  isReplaceMode: boolean,
  sourceName: string
): ParseTaskResult {
  const seenCodesInFile = new Set<string>();
  const seenNomsInFile = new Set<string>();

  const existingCodes = new Map<string, string>(); // codeUpper -> taskName
  const existingNoms = new Set<string>();

  if (!isReplaceMode) {
    existingTasks.forEach((t) => {
      if (t.code) existingCodes.set(t.code.trim().toUpperCase(), t.nom);
      existingNoms.add(t.nom.trim().toUpperCase());
    });
  }

  const rows: ParsedTaskRow[] = [];
  let validesCount = 0;
  let doublonsCodeCount = 0;
  let doublonsNomCount = 0;
  let erreursCount = 0;

  entries.forEach((item, idx) => {
    const rawNom = item.nom ? item.nom.trim().toUpperCase() : '';
    const rawCode = item.code ? item.code.trim().toUpperCase() : null;

    // Erreur : nom manquant
    if (!rawNom) {
      erreursCount++;
      rows.push({
        index: idx + 1,
        code: rawCode,
        nom: '',
        statut: 'erreur',
        motif: 'Nom de la tâche manquant',
      });
      return;
    }

    // Doublon de code
    if (rawCode) {
      if (seenCodesInFile.has(rawCode)) {
        doublonsCodeCount++;
        rows.push({
          index: idx + 1,
          code: rawCode,
          nom: rawNom,
          statut: 'doublon_code',
          motif: `Code "${rawCode}" répété plusieurs fois dans le fichier`,
        });
        return;
      }
      if (existingCodes.has(rawCode)) {
        doublonsCodeCount++;
        rows.push({
          index: idx + 1,
          code: rawCode,
          nom: rawNom,
          statut: 'doublon_code',
          motif: `Code "${rawCode}" déjà utilisé par "${existingCodes.get(rawCode)}"`,
        });
        return;
      }
    }

    // Doublon de nom
    if (seenNomsInFile.has(rawNom)) {
      doublonsNomCount++;
      rows.push({
        index: idx + 1,
        code: rawCode,
        nom: rawNom,
        statut: 'doublon_nom',
        motif: `Tâche "${rawNom}" répétée dans le fichier`,
      });
      return;
    }

    if (existingNoms.has(rawNom)) {
      doublonsNomCount++;
      rows.push({
        index: idx + 1,
        code: rawCode,
        nom: rawNom,
        statut: 'doublon_nom',
        motif: `Tâche "${rawNom}" existe déjà`,
      });
      return;
    }

    // Tout est valide
    if (rawCode) seenCodesInFile.add(rawCode);
    seenNomsInFile.add(rawNom);
    validesCount++;

    rows.push({
      index: idx + 1,
      code: rawCode,
      nom: rawNom,
      statut: 'valide',
      motif: 'Prêt à être importé',
    });
  });

  return {
    success: true,
    rows,
    totalLignes: entries.length,
    validesCount,
    doublonsCodeCount,
    doublonsNomCount,
    erreursCount,
    sourceName,
  };
}
