/**
 * Parser pour l'importation de fichiers Excel (.xlsx, .xls) et CSV (.csv) d'ouvriers
 * Respecte les critères :
 * - Insensible à la casse et aux accents pour la détection des colonnes
 * - Fallback si pas d'en-tête : colonne 1 = numéro, colonne 2 = nom
 * - Nettoyage du numéro (ex: 12.0 -> 12)
 * - Détection des doublons (société et internes au fichier) et des erreurs
 */

import * as XLSX from 'xlsx';
import { Ouvrier } from '../types';

export interface ParsedWorkerRow {
  index: number; // Ligne dans le fichier
  numero: number | null;
  nom: string;
  telephone?: string;
  statut: 'valide' | 'doublon' | 'erreur';
  motif: string;
}

export interface ParseWorkerFileResult {
  success: boolean;
  rows: ParsedWorkerRow[];
  totalLignes: number;
  validesCount: number;
  doublonsCount: number;
  erreursCount: number;
  nomFichier: string;
  error?: string;
}

// Nettoyer une chaîne : minuscules, suppression des accents et caractères spéciaux
function normaliserTexte(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Convertir une valeur Excel en numéro entier propre
function formaterNumero(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;

  // Si c'est déjà un nombre
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return null;
    return Math.floor(val);
  }

  // Si c'est une chaîne
  const str = String(val).trim().replace(',', '.');
  // Enlever les décimales éventuelles (ex: "12.0" -> 12)
  const num = parseFloat(str);
  if (isNaN(num) || num <= 0) return null;
  return Math.floor(num);
}

export async function parseWorkerFile(
  file: File,
  existingWorkers: Ouvrier[],
  isReplaceMode: boolean = false
): Promise<ParseWorkerFileResult> {
  const existingNumbers = new Set(existingWorkers.map((o) => o.numero));
  const seenNumbersInFile = new Set<number>();

  try {
    const dataBuffer = await file.arrayBuffer();
    
    // Options de lecture SheetJS (gère xlsx, xls et csv avec encodage UTF-8)
    const workbook = XLSX.read(dataBuffer, {
      type: 'array',
      cellDates: false,
      raw: false,
    });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return {
        success: false,
        rows: [],
        totalLignes: 0,
        validesCount: 0,
        doublonsCount: 0,
        erreursCount: 0,
        nomFichier: file.name,
        error: 'Le fichier ne contient aucune feuille de calcul lisible.',
      };
    }

    // Lire la première feuille
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // Convertir en tableau 2D de chaînes/valeurs
    const rawData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (!rawData || rawData.length === 0) {
      return {
        success: false,
        rows: [],
        totalLignes: 0,
        validesCount: 0,
        doublonsCount: 0,
        erreursCount: 0,
        nomFichier: file.name,
        error: 'Le fichier est vide ou ne contient aucune donnée.',
      };
    }

    // Détection de l'en-tête (ligne 0)
    const firstRow = rawData[0] as unknown[];
    let colNumeroIdx = -1;
    let colNomIdx = -1;
    let colTelIdx = -1;
    let hasHeader = false;

    // Motifs de colonnes
    const MOTIFS_NUMERO = ['numero', 'numéro', 'n°', 'no', 'matricule', 'num', 'id_ouvrier', 'matricule_ouvrier'];
    const MOTIFS_NOM = ['nom', 'nom complet', 'nom et prenom', 'nom & prenom', 'prenom nom', 'name', 'full name', 'ouvrier'];
    const MOTIFS_TEL = ['telephone', 'téléphone', 'tel', 'phone', 'gsm', 'mobile'];

    // Chercher les en-têtes dans la première ligne
    if (firstRow && Array.isArray(firstRow)) {
      firstRow.forEach((cellVal, idx) => {
        const text = normaliserTexte(String(cellVal || ''));
        if (MOTIFS_NUMERO.some((m) => text === m || text.includes(m))) {
          if (colNumeroIdx === -1) colNumeroIdx = idx;
        }
        if (MOTIFS_NOM.some((m) => text === m || text.includes(m))) {
          if (colNomIdx === -1) colNomIdx = idx;
        }
        if (MOTIFS_TEL.some((m) => text === m || text.includes(m))) {
          if (colTelIdx === -1) colTelIdx = idx;
        }
      });
    }

    // Si on a trouvé au moins la colonne numéro ou nom dans la 1ère ligne, c'est un en-tête
    if (colNumeroIdx !== -1 || colNomIdx !== -1) {
      hasHeader = true;
      if (colNumeroIdx === -1) colNumeroIdx = 0;
      if (colNomIdx === -1) colNomIdx = colNumeroIdx === 0 ? 1 : 0;
    } else {
      // Pas d'en-tête détecté : fallback première colonne = numéro, deuxième colonne = nom
      hasHeader = false;
      colNumeroIdx = 0;
      colNomIdx = 1;
    }

    const startIndex = hasHeader ? 1 : 0;
    const parsedRows: ParsedWorkerRow[] = [];

    for (let i = startIndex; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];
      if (!row || !Array.isArray(row)) continue;

      // Extraire les cellules
      const rawNumVal = row[colNumeroIdx];
      const rawNomVal = row[colNomIdx];
      const rawTelVal = colTelIdx >= 0 ? row[colTelIdx] : undefined;

      const numStr = String(rawNumVal !== undefined && rawNumVal !== null ? rawNumVal : '').trim();
      const nomStr = String(rawNomVal !== undefined && rawNomVal !== null ? rawNomVal : '').trim();
      const telStr = rawTelVal ? String(rawTelVal).trim() : undefined;

      // Si la ligne est complètement vide, on l'ignore
      if (!numStr && !nomStr) {
        continue;
      }

      const numFormate = formaterNumero(rawNumVal);

      // CONTRÔLE 1 : Numéro manquant ou invalide -> ERREUR
      if (numFormate === null) {
        parsedRows.push({
          index: i + 1,
          numero: null,
          nom: nomStr || '(Nom manquant)',
          telephone: telStr,
          statut: 'erreur',
          motif: !numStr ? 'Numéro manquant' : `Numéro invalide ("${numStr}")`,
        });
        continue;
      }

      // Nom par défaut si manquant
      const nomPropre = nomStr || `Ouvrier #${numFormate}`;

      // CONTRÔLE 2 : Numéro déjà existant dans la société
      if (existingNumbers.has(numFormate)) {
        const existant = existingWorkers.find((o) => o.numero === numFormate);
        if (isReplaceMode) {
          seenNumbersInFile.add(numFormate);
          parsedRows.push({
            index: i + 1,
            numero: numFormate,
            nom: nomPropre,
            telephone: telStr,
            statut: 'valide',
            motif: `Mise à jour de ${existant?.nom || 'l\'ouvrier existant'}`,
          });
          continue;
        } else {
          parsedRows.push({
            index: i + 1,
            numero: numFormate,
            nom: nomPropre,
            telephone: telStr,
            statut: 'doublon',
            motif: `Déjà attribué à ${existant?.nom || 'un ouvrier existant'}`,
          });
          continue;
        }
      }

      // CONTRÔLE 3 : Numéro en double dans le même fichier -> DOUBLON
      if (seenNumbersInFile.has(numFormate)) {
        parsedRows.push({
          index: i + 1,
          numero: numFormate,
          nom: nomPropre,
          telephone: telStr,
          statut: 'doublon',
          motif: 'Doublon à l\'intérieur du fichier (déjà présent plus haut)',
        });
        continue;
      }

      // LIGNE VALIDE -> À AJOUTER
      seenNumbersInFile.add(numFormate);
      parsedRows.push({
        index: i + 1,
        numero: numFormate,
        nom: nomPropre,
        telephone: telStr,
        statut: 'valide',
        motif: 'Prêt à être ajouté',
      });
    }

    const validesCount = parsedRows.filter((r) => r.statut === 'valide').length;
    const doublonsCount = parsedRows.filter((r) => r.statut === 'doublon').length;
    const erreursCount = parsedRows.filter((r) => r.statut === 'erreur').length;

    return {
      success: true,
      rows: parsedRows,
      totalLignes: parsedRows.length,
      validesCount,
      doublonsCount,
      erreursCount,
      nomFichier: file.name,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue lors de la lecture du fichier';
    return {
      success: false,
      rows: [],
      totalLignes: 0,
      validesCount: 0,
      doublonsCount: 0,
      erreursCount: 0,
      nomFichier: file.name,
      error: `Fichier mal formé ou illisible : ${message}`,
    };
  }
}
