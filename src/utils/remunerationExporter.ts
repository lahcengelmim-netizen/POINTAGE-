/**
 * Moteur de calcul et d'exportation Excel de la RÉMUNÉRATION JOURNALIÈRE
 * Application : LAHCEN POINTEUR
 *
 * Modèle Excel obligatoire : D002_2026-11-15_BROUILLON
 * Feuille unique : "Pointage"
 * 21 colonnes exactes dans l'ordre :
 * docId | dateTrava | ouvrierId | nomOuvrier | DT | serreId | rubanId | cultureId |
 * tacheTypeId | tache | uniteMetrique | quantiteMetrique | quantite | heureDeb |
 * heureFin | dureeRep | periodeJo | statut | equipeId | tarifExcep | remuneration
 *
 * Cinq règles officielles de rémunération :
 * A. STANDARD         : 11,875 DH / heure  (07:00-16:00, pause 1h => 8h = 95 DH ; 07:00-14:00, pause 0h => 7h)
 * B. RÉCOLTE RONDE    : 1,1875 DH / caisse (PLATEAUX, quantité réelle dans quantiteMetrique, AUCUN minimum de 80)
 * C. RÉCOLTE CERISE   : 3,8 DH / caisse    (PLATEAUX, quantité réelle dans quantiteMetrique)
 * D. TTT D3           : 16 DH / heure      (HEURE, quantiteMetrique vide)
 * E. ÉBOURGEONNAGE D5 : 150 DH forfait     (mode forfait, unite = 1, tarifExcep = 150)
 */

import * as XLSX from 'xlsx';
import {
  AffectationTache,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
  TacheSerreConfig,
} from '../types';

export type RemunerationCategorie =
  | 'STANDARD'
  | 'RECOLTE'
  | 'RECOLTE_CERISE'
  | 'TRAITEMENT_D3'
  | 'EBOURGEONNAGE_D5'
  | 'UNITE'
  | 'INCERTAIN';

export type ModeRemunerationExport = 'temps' | 'metrique' | 'unite' | 'forfait';

export const REMUNERATION_SHEET_NAME = 'Pointage';

export const TARIF_STANDARD_HEURE = 11.875;
export const TARIF_STANDARD_JOUR_95 = 95;
export const TARIF_RECOLTE_PLATEAU = 1.1875;
export const TARIF_RECOLTE_RONDE = 1.1875;
export const TARIF_RECOLTE_CERISE = 3.8;
export const TARIF_TRAITEMENT_D3_HEURE = 16;
export const TARIF_EBOURGEONNAGE_D5_FORFAIT = 150;

export const STANDARD_HEURE_DEB = '07:00';
export const STANDARD_HEURE_FIN = '16:00';
export const STANDARD_DUREE_PAUSE = 1;
export const STANDARD_DUREE_EFFECTIVE = 8;

export const DEFAULT_RUBAN_LABEL = 'Tous les Rubans';
export const DEFAULT_ALL_SERRES_LABEL = 'Toutes les serres';

export const REMUNERATION_EXCEL_COLUMNS = [
  'docId',
  'dateTrava',
  'ouvrierId',
  'nomOuvrier',
  'DT',
  'serreId',
  'rubanId',
  'cultureId',
  'tacheTypeId',
  'tache',
  'uniteMetrique',
  'quantiteMetrique',
  'quantite',
  'heureDeb',
  'heureFin',
  'dureeRep',
  'periodeJo',
  'statut',
  'equipeId',
  'tarifExcep',
  'remuneration',
] as const;

export interface RemunerationExcelRow {
  docId: string;
  dateTrava: string;
  ouvrierId: string;
  nomOuvrier: string;
  DT: string;
  serreId: string;
  rubanId: string;
  cultureId: string;
  tacheTypeId: string;
  tache: string;
  uniteMetrique: 'HEURE' | 'PLATEAUX' | 'FORFAIT' | 'UNITE' | '';
  quantiteMetrique: number | null;
  quantite: number | null;
  heureDeb: string;
  heureFin: string;
  dureeRep: number;
  periodeJo: string;
  statut: string;
  equipeId: string;
  tarifExcep: number | null;
  remuneration: number | null;
}

export interface RemunerationRowOverride {
  categorie?: Exclude<RemunerationCategorie, 'INCERTAIN'>;
  quantite?: number | null; // heures pour STANDARD / TRAITEMENT_D3, caisses pour RECOLTE / RECOLTE_CERISE, unités pour EBOURGEONNAGE_D5 / UNITE
  unite?: number | null;
  tarifExcep?: number | null;
  heureDeb?: string;
  heureFin?: string;
  dureeRep?: number;
}

export interface RemunerationDraftRow extends RemunerationExcelRow {
  rowKey: string;
  workerKey: string;
  domaineId: string;
  domaineNom: string;
  autoCategorie: RemunerationCategorie;
  effectiveCategorie: RemunerationCategorie;
  modeRemuneration: ModeRemunerationExport;
  unite: number | null;
  workValue: number | null;
  classificationReason: string;
  needsAdminAction: boolean;
  validationErrors: string[];
  recolteCaissesSource: number | null;
  recolteEntriesCount: number;
  affectationsCount: number;
}

export interface WorkerRemunerationTotal {
  workerKey: string;
  ouvrierId: string | number;
  nomOuvrier: string;
  rowsCount: number;
  totalDH: number;
  hasErrors: boolean;
}

export interface DomaineRemunerationTotal {
  DT: string;
  domaineNom: string;
  domaineId: string;
  rowsCount: number;
  ouvriersCount: number;
  totalDH: number;
}

export interface RemunerationValidationIssue {
  rowKey: string;
  ouvrierId: string | number;
  nomOuvrier: string;
  DT: string;
  tache: string;
  messages: string[];
}

export interface RemunerationPreviewResult {
  rows: RemunerationDraftRow[];
  totalByWorker: WorkerRemunerationTotal[];
  totalByDomaine: DomaineRemunerationTotal[];
  grandTotalDH: number;
  totalOuvriersDistincts: number;
  validationIssues: RemunerationValidationIssue[];
  canExportWithoutError: boolean;
}

export function roundRemuneration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100000) / 100000;
}

export function normalizeText(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeDomaineCode(domaineNom?: string | null, domaineId?: string | null): string {
  const raw = (domaineNom || '').trim().toUpperCase();
  if (raw) {
    const m = raw.match(/^(?:DOMAINE\s*|DT?\s*)0*(\d+)$/i);
    if (m) return `D${Number(m[1])}`;
    return raw;
  }
  if (domaineId) {
    const mId = domaineId.trim().toLowerCase().match(/^dom_d0*(\d+)$/);
    if (mId) return `D${Number(mId[1])}`;
  }
  return '';
}

export function formatDomaineDT(domaineNom?: string | null, domaineId?: string | null): string {
  const norm = normalizeDomaineCode(domaineNom, domaineId);
  if (!norm) return '';
  const m = norm.match(/^D0*(\d+)$/);
  if (m) {
    return `D${String(Number(m[1])).padStart(3, '0')}`;
  }
  return norm;
}

export function isDomaineD3(domaineNom?: string | null, domaineId?: string | null): boolean {
  return normalizeDomaineCode(domaineNom, domaineId) === 'D3';
}

export function isDomaineD5(domaineNom?: string | null, domaineId?: string | null): boolean {
  return normalizeDomaineCode(domaineNom, domaineId) === 'D5';
}

/**
 * Règle 1 : Format obligatoire ouvrierId = NUMERO_OUVRIER-DOMAINE
 * Exemples : 1-D2, 55-D3, 120-D5
 */
export function formatOuvrierIdForExport(
  numeroOuvrier: string | number | null | undefined,
  domaineNom?: string | null,
  domaineId?: string | null
): string {
  const num = Number(numeroOuvrier);
  const dom = normalizeDomaineCode(domaineNom, domaineId);
  if (!Number.isFinite(num) || num <= 0 || !dom) return '';
  return `${Math.trunc(num)}-${dom}`;
}

/**
 * Référentiel officiel d'appartenance des serres par numéro :
 * - Serres 1 à 15  -> D002 (Domaine D2)
 * - Serres 16 à 22 -> D003 (Domaine D3)
 * - Serres 23 à 42 -> D005 (Domaine D5)
 */
export function getExpectedDomaineDTBySerreNumber(serreNum: number): string | null {
  if (!Number.isFinite(serreNum) || serreNum <= 0) return null;
  if (serreNum >= 1 && serreNum <= 15) return 'D002';
  if (serreNum >= 16 && serreNum <= 22) return 'D003';
  if (serreNum >= 23 && serreNum <= 42) return 'D005';
  return null;
}

/**
 * Extrait un éventuel domaine explicite et le numéro de serre depuis un libellé/code/id.
 * Exemples supportés sans jamais créer de double concaténation :
 * - "Serre 2", "S02", "S2", "serre_2", "D002S2", "D2S2" -> { num: 2 }
 * - "SERRE 16", "S16", "serre_16", "D003S16" -> { num: 16 }
 * - "SERRE 23", "D5-S23", "serre_d5_23", "D005S23" -> { embeddedDT: 'D005', num: 23 }
 */
export function parseSerreDescriptor(rawValue?: string | null): {
  embeddedDT: string | null;
  serreNum: number | null;
} {
  const clean = (rawValue || '').trim();
  if (!clean) return { embeddedDT: null, serreNum: null };

  // 1. Format complet ou préfixé Domaine : D002S2, D003S16, D005S23, D5-S23, D2 S02, D005-SERRE 23
  const fullMatch = clean.match(
    /^DT?0*(\d+)\s*[-_\s]*S(?:ERRE)?\s*[-_\s]*0*(\d+)$/i
  );
  if (fullMatch) {
    return {
      embeddedDT: `D${String(Number(fullMatch[1])).padStart(3, '0')}`,
      serreNum: Number(fullMatch[2]),
    };
  }

  // 2. ID technique type "serre_d5_23" ou "serre_d3_16"
  const techDomMatch = clean.match(/^serre_d0*(\d+)_0*(\d+)$/i);
  if (techDomMatch) {
    return {
      embeddedDT: `D${String(Number(techDomMatch[1])).padStart(3, '0')}`,
      serreNum: Number(techDomMatch[2]),
    };
  }

  // 3. Format standard : "Serre 2", "SERRE 16", "S02", "S16", "serre_2"
  const simpleMatch = clean.match(/^(?:SERRE[\s_-]*|S)0*(\d+)$/i);
  if (simpleMatch) {
    return {
      embeddedDT: null,
      serreNum: Number(simpleMatch[1]),
    };
  }

  // 4. Nombre pur en dernier recours
  if (/^\d+$/.test(clean)) {
    return {
      embeddedDT: null,
      serreNum: Number(clean),
    };
  }

  return { embeddedDT: null, serreNum: null };
}

export interface NormalizedSerreExportResult {
  code: string;
  expectedDT: string | null;
  mismatchError: string | null;
}

/**
 * Normalise un code/nom/id de serre pour l'export Excel uniquement au format D00XSY
 * (ex: D002S2, D003S16, D005S23), évite toute double concaténation et vérifie l'appartenance au Domaine.
 */
export function formatSerreCodeForExport(params: {
  rawSerre?: string | null;
  serreObj?: Serre | null;
  rowDomaineDT: string;
}): NormalizedSerreExportResult {
  const { rawSerre, serreObj, rowDomaineDT } = params;
  const rowDT = formatDomaineDT(rowDomaineDT) || '';

  const parsedFromRaw = parseSerreDescriptor(rawSerre);
  const parsedFromCode = parseSerreDescriptor(serreObj?.code);
  const parsedFromNom = parseSerreDescriptor(serreObj?.nom);
  const parsedFromId = parseSerreDescriptor(serreObj?.id);

  const serreNum =
    parsedFromRaw.serreNum ??
    parsedFromCode.serreNum ??
    parsedFromNom.serreNum ??
    parsedFromId.serreNum ??
    (serreObj?.ordre && serreObj.ordre > 0 ? serreObj.ordre : null);

  const serreObjDT = serreObj?.domaine_id ? formatDomaineDT(null, serreObj.domaine_id) : null;
  const parsedEmbeddedDT =
    parsedFromRaw.embeddedDT ?? parsedFromCode.embeddedDT ?? parsedFromId.embeddedDT ?? null;
  const rangeExpectedDT = serreNum !== null ? getExpectedDomaineDTBySerreNumber(serreNum) : null;

  // Domaine autoritaire de la serre :
  // 1) domaine_id explicite de la serre s'il existe
  // 2) préfixe Domaine explicite dans le code source (ex: D5-S23 -> D005)
  // 3) plage officielle des numéros de serre (1-15: D002, 16-22: D003, 23-42: D005)
  const expectedDT = serreObjDT || parsedEmbeddedDT || rangeExpectedDT || (rowDT || null);

  let code = '';
  if (serreNum !== null && expectedDT) {
    code = `${expectedDT}S${serreNum}`;
  } else {
    // Fallback pour un libellé de serre non numérique : éviter toute double concaténation
    const rawClean = (serreObj?.code || serreObj?.nom || rawSerre || '').trim().toUpperCase();
    if (!rawClean) {
      return { code: '', expectedDT, mismatchError: null };
    }
    const stripped = rawClean
      .replace(/^DT?0*\d+\s*[-_]?\s*/i, '')
      .replace(/^S(?=[A-Z0-9])/i, '')
      .replace(/\s+/g, '');
    code = expectedDT ? `${expectedDT}S${stripped}` : rawClean.replace(/\s+/g, '');
  }

  let mismatchError: string | null = null;
  if (rowDT && expectedDT && rowDT !== expectedDT) {
    mismatchError = `Serre ${code} appartient au domaine ${expectedDT} et ne correspond pas au domaine ${rowDT}.`;
  } else if (
    serreNum !== null &&
    rangeExpectedDT &&
    rowDT &&
    rangeExpectedDT !== rowDT &&
    !serreObjDT
  ) {
    mismatchError = `Serre ${code} (n°${serreNum}) appartient théoriquement au domaine ${rangeExpectedDT} et non à ${rowDT}.`;
  }

  return {
    code,
    expectedDT,
    mismatchError,
  };
}

export function normalizeTimeHHMM(hhmm?: string | null): string {
  if (!hhmm) return '';
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return hhmm.trim();
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return hhmm.trim();
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Règle 12 : Durée de pause exacte selon l'horaire :
 * - 07:00 à 16:00 => dureeRep = 1
 * - 07:00 à 14:00 => dureeRep = 0
 */
export function getDureeRepForSchedule(
  heureDeb?: string | null,
  heureFin?: string | null,
  fallback = 0
): number {
  const deb = normalizeTimeHHMM(heureDeb);
  const fin = normalizeTimeHHMM(heureFin);
  if (deb === '07:00' && fin === '16:00') return 1;
  if (deb === '07:00' && fin === '14:00') return 0;
  return Math.max(0, Number.isFinite(fallback) ? fallback : 0);
}

export function parseTimeToHours(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h + m / 60;
}

export function computeEffectiveHours(heureDeb: string, heureFin: string, dureeRep: number): number {
  const deb = parseTimeToHours(heureDeb);
  const fin = parseTimeToHours(heureFin);
  if (deb === null || fin === null) return 0;
  const brut = fin >= deb ? fin - deb : 24 - deb + fin;
  return Math.max(0, roundRemuneration(brut - Math.max(0, dureeRep || 0)));
}

export function computeHeureFinFromDuration(heureDeb: string, effectiveHours: number, dureeRep: number): string {
  const deb = parseTimeToHours(heureDeb);
  if (deb === null || !Number.isFinite(effectiveHours) || effectiveHours <= 0) return '';
  const totalMinutes = Math.round((deb + effectiveHours + Math.max(0, dureeRep || 0)) * 60) % (24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function calculateStandardRemuneration(heuresEffectives: number): number {
  if (!Number.isFinite(heuresEffectives) || heuresEffectives <= 0) return 0;
  return roundRemuneration(heuresEffectives * TARIF_STANDARD_HEURE);
}

export function calculateRecolteRemuneration(caisses: number): number {
  // IMPORTANT : Ne jamais imposer un minimum de 80 caisses.
  if (!Number.isFinite(caisses) || caisses <= 0) return 0;
  return roundRemuneration(caisses * TARIF_RECOLTE_RONDE);
}

export function calculateRecolteCeriseRemuneration(caisses: number): number {
  if (!Number.isFinite(caisses) || caisses <= 0) return 0;
  return roundRemuneration(caisses * TARIF_RECOLTE_CERISE);
}

export function calculateTraitementD3Remuneration(heures: number): number {
  if (!Number.isFinite(heures) || heures <= 0) return 0;
  return roundRemuneration(heures * TARIF_TRAITEMENT_D3_HEURE);
}

export function calculateEbourgeonnageD5Remuneration(unite: number = 1): number {
  if (!Number.isFinite(unite) || unite <= 0) return 0;
  return roundRemuneration(unite * TARIF_EBOURGEONNAGE_D5_FORFAIT);
}

export function getTarifForCategorie(
  categorie: RemunerationCategorie,
  customTarif?: number | null
): number | null {
  switch (categorie) {
    case 'STANDARD':
      return TARIF_STANDARD_HEURE;
    case 'RECOLTE':
      return TARIF_RECOLTE_RONDE;
    case 'RECOLTE_CERISE':
      return TARIF_RECOLTE_CERISE;
    case 'TRAITEMENT_D3':
      return TARIF_TRAITEMENT_D3_HEURE;
    case 'EBOURGEONNAGE_D5':
      return TARIF_EBOURGEONNAGE_D5_FORFAIT;
    case 'UNITE':
      return customTarif !== undefined && customTarif !== null && customTarif > 0 ? customTarif : null;
    default:
      return null;
  }
}

export function getUniteForCategorie(
  categorie: RemunerationCategorie
): 'HEURE' | 'PLATEAUX' | 'FORFAIT' | 'UNITE' | '' {
  switch (categorie) {
    case 'STANDARD':
    case 'TRAITEMENT_D3':
      return 'HEURE';
    case 'RECOLTE':
    case 'RECOLTE_CERISE':
      return 'PLATEAUX';
    case 'EBOURGEONNAGE_D5':
      return 'FORFAIT';
    case 'UNITE':
      return 'UNITE';
    default:
      return '';
  }
}

export function getModeRemunerationForCategorie(
  categorie: RemunerationCategorie
): ModeRemunerationExport {
  switch (categorie) {
    case 'RECOLTE':
    case 'RECOLTE_CERISE':
      return 'metrique';
    case 'EBOURGEONNAGE_D5':
      return 'forfait';
    case 'UNITE':
      return 'unite';
    default:
      return 'temps';
  }
}

export function calculateRemunerationByCategorie(
  categorie: RemunerationCategorie,
  quantite: number | null,
  customTarif?: number | null
): number | null {
  if (quantite === null || !Number.isFinite(quantite) || quantite <= 0) return null;
  switch (categorie) {
    case 'STANDARD':
      return calculateStandardRemuneration(quantite);
    case 'RECOLTE':
      return calculateRecolteRemuneration(quantite);
    case 'RECOLTE_CERISE':
      return calculateRecolteCeriseRemuneration(quantite);
    case 'TRAITEMENT_D3':
      return calculateTraitementD3Remuneration(quantite);
    case 'EBOURGEONNAGE_D5':
      return calculateEbourgeonnageD5Remuneration(quantite);
    case 'UNITE':
      return customTarif && customTarif > 0 ? roundRemuneration(quantite * customTarif) : null;
    default:
      return null;
  }
}

/**
 * Identification automatique du type de travail à partir des données réelles
 * de la tâche et du domaine (sans jamais classer uniquement par domaine si la tâche
 * indique clairement un autre type de travail).
 */
export function classifyRemunerationWorkType(params: {
  tache?: Pick<Tache, 'id' | 'code' | 'nom'> | null;
  domaine?: Pick<Domaine, 'id' | 'nom'> | null;
  hasRecolteEntries?: boolean;
}): {
  categorie: RemunerationCategorie;
  reason: string;
} {
  const { tache, domaine, hasRecolteEntries = false } = params;
  const nomNorm = normalizeText(tache?.nom);
  const codeNorm = normalizeText(tache?.code);
  const fullTask = `${nomNorm} ${codeNorm}`.trim();
  const isD3 = isDomaineD3(domaine?.nom, domaine?.id);
  const isD5 = isDomaineD5(domaine?.nom, domaine?.id);

  // 1. Tâche manquante ou sans libellé identifiable
  if (!tache || !nomNorm || nomNorm === 'sans tache') {
    if (hasRecolteEntries) {
      return {
        categorie: 'INCERTAIN',
        reason:
          'Aucune tâche pointée mais des caisses récoltées existent à cette date : confirmer RÉCOLTE RONDE (1,1875 DH), RÉCOLTE CERISE (3,8 DH) ou STANDARD (11,875 DH).',
      };
    }
    if (isD3) {
      return {
        categorie: 'INCERTAIN',
        reason:
          'Ouvrier pointé dans le Domaine D3 sans tâche identifiable : confirmer TTT D3 (16 DH/h) ou STANDARD (11,875 DH/h).',
      };
    }
    return {
      categorie: 'INCERTAIN',
      reason: 'Affectation sans tâche identifiable : confirmer le type de rémunération avant export.',
    };
  }

  // 2. ÉBOURGEONNAGE D5 (forfait 150 DH, unite = 1)
  const isEbourgeonnageTask =
    nomNorm.includes('ebourgeonnage') ||
    nomNorm.includes('bourgeon') ||
    /^ebd/i.test(codeNorm);

  if (isEbourgeonnageTask && (isD5 || /\bd5\b/.test(fullTask) || codeNorm.includes('05') || codeNorm.includes('d5'))) {
    return {
      categorie: 'EBOURGEONNAGE_D5',
      reason: 'Ébourgeonnage D5 détecté : forfait spécifique 150 DH (unite = 1, tarifExcep = 150).',
    };
  }

  // 3. RÉCOLTE CERISE (3,8 DH / caisse) vs RÉCOLTE RONDE (1,1875 DH / caisse)
  const isCeriseTask =
    nomNorm.includes('cerise') ||
    codeNorm.includes('cerise') ||
    /^rc\d*$/i.test(codeNorm);

  if (isCeriseTask) {
    return {
      categorie: 'RECOLTE_CERISE',
      reason: 'Récolte Cerise détectée : tarif réel par caisse (3,8 DH/caisse).',
    };
  }

  const isRecolteTask =
    nomNorm.includes('recolte') ||
    nomNorm.includes('cueillette') ||
    nomNorm.includes('ronde') ||
    /^r0*\d+$/i.test(codeNorm);

  if (isRecolteTask) {
    return {
      categorie: 'RECOLTE',
      reason: 'Récolte Ronde détectée : tarif réel par caisse (1,1875 DH/caisse, sans minimum).',
    };
  }

  // 4. TRAITEMENT / TTT (D3 -> 16 DH/h, hors D3 -> alerte admin pour confirmation)
  const isTraitementTask =
    nomNorm.includes('traitement') ||
    nomNorm.includes('phyto') ||
    nomNorm.includes('phytosanitaire') ||
    nomNorm.includes('pulverisation') ||
    nomNorm.includes('sulfatage') ||
    /\bttt\b/.test(fullTask) ||
    /^ttt/i.test(codeNorm) ||
    /^phy/i.test(codeNorm);

  if (isTraitementTask) {
    if (isD3 || /\bd3\b/.test(fullTask)) {
      return {
        categorie: 'TRAITEMENT_D3',
        reason: 'Travail TTT dans le Domaine D3 : rémunération horaire à 16 DH/h.',
      };
    }
    return {
      categorie: 'INCERTAIN',
      reason:
        `Tâche TTT / Traitement détectée hors Domaine D3 (${normalizeDomaineCode(domaine?.nom, domaine?.id) || 'Domaine inconnu'}) : confirmer TTT (16 DH/h) ou STANDARD (11,875 DH/h).`,
    };
  }

  // 5. Tâches agricoles standards explicites (07:00-16:00, pause 1h = 8h effectives = 95 DH)
  return {
    categorie: 'STANDARD',
    reason: 'Tâche standard (07:00–16:00, pause 1h = 8h effectives × 11,875 DH/h = 95 DH).',
  };
}

interface ResolvedSerreToken {
  raw: string;
  serreObj?: Serre;
}

function isPlaceholderAllSerres(val?: string | null): boolean {
  const norm = normalizeText(val);
  return norm === 'toutes les serres' || norm === 'toutes' || norm === 'all' || val === '—';
}

function resolveRealSerresFromSource(
  serreIdRaw: string | null | undefined,
  serreNomRaw: string | null | undefined,
  serresIdsArr: string[] | undefined,
  serresNomsArr: string[] | undefined,
  serreMap: Map<string, Serre>,
  serreLookupByNameOrCode: Map<string, Serre>
): ResolvedSerreToken[] {
  const tokens: ResolvedSerreToken[] = [];
  const seen = new Set<string>();

  const pushToken = (rawVal?: string | null, explicitObj?: Serre) => {
    const clean = (rawVal || '').trim();
    if ((!clean && !explicitObj) || isPlaceholderAllSerres(clean)) return;
    const matchedObj =
      explicitObj ||
      serreMap.get(clean) ||
      serreLookupByNameOrCode.get(clean.toUpperCase());
    const dedupKey = matchedObj?.id || clean.toUpperCase();
    if (!seen.has(dedupKey)) {
      seen.add(dedupKey);
      tokens.push({
        raw: clean || matchedObj?.nom || matchedObj?.code || '',
        serreObj: matchedObj,
      });
    }
  };

  // Priorité aux IDs pour retrouver l'objet Serre exact (avec son domaine_id officiel), sinon noms
  const idsList =
    Array.isArray(serresIdsArr) && serresIdsArr.length > 0
      ? serresIdsArr
      : (serreIdRaw || '')
          .split(/[,+;]/)
          .map((s) => s.trim())
          .filter((s) => Boolean(s) && !isPlaceholderAllSerres(s));

  if (idsList.length > 0) {
    idsList.forEach((id) => {
      const sObj = serreMap.get(id) || serreLookupByNameOrCode.get(id.toUpperCase());
      pushToken(sObj?.nom || sObj?.code || id, sObj);
    });
  }

  if (tokens.length === 0 && Array.isArray(serresNomsArr)) {
    serresNomsArr.forEach((nom) => pushToken(nom));
  }

  if (tokens.length === 0 && serreNomRaw) {
    serreNomRaw
      .split(/[,+;]/)
      .map((s) => s.trim())
      .forEach((nom) => pushToken(nom));
  }

  return tokens;
}

export interface BuildDailyRemunerationParams {
  dateIso: string;
  domaineFilter?: string; // 'ALL' ou id/nom de domaine
  ouvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  pointages: Pointage[];
  affectations: AffectationTache[];
  recoltes: RecolteEntry[];
  tacheSerresConfigs?: TacheSerreConfig[];
  defaultDomaineId?: string;
  overrides?: Record<string, RemunerationRowOverride>;
}

/**
 * Construit les lignes consolidées de rémunération pour une date donnée
 * à partir des pointages, affectations et récoltes réels.
 */
export function buildDailyRemunerationRows(
  params: BuildDailyRemunerationParams
): RemunerationPreviewResult {
  const {
    dateIso,
    domaineFilter = 'ALL',
    ouvriers,
    taches,
    domaines,
    serres,
    pointages,
    affectations,
    recoltes,
    tacheSerresConfigs = [],
    defaultDomaineId = 'dom_d2',
    overrides = {},
  } = params;

  const ouvrierById = new Map<string, Ouvrier>();
  const ouvrierByNum = new Map<number, Ouvrier>();
  ouvriers.forEach((o) => {
    if (o.id) ouvrierById.set(o.id, o);
    if (o.numero && Number(o.numero) > 0) ouvrierByNum.set(Number(o.numero), o);
  });

  const tacheById = new Map<string, Tache>(taches.map((t) => [t.id, t]));
  const domaineById = new Map<string, Domaine>(domaines.map((d) => [d.id, d]));
  const serreById = new Map<string, Serre>(serres.map((s) => [s.id, s]));
  const serreLookupByNameOrCode = new Map<string, Serre>();
  serres.forEach((s) => {
    if (s.code) serreLookupByNameOrCode.set(s.code.trim().toUpperCase(), s);
    if (s.nom) serreLookupByNameOrCode.set(s.nom.trim().toUpperCase(), s);
  });

  // Config multi-serres par tâche du jour
  const taskConfigMap = new Map<string, TacheSerreConfig>();
  tacheSerresConfigs
    .filter((c) => c.date === dateIso)
    .forEach((c) => taskConfigMap.set(c.tache_id, c));

  // Pointages présents UNIQUEMENT pour dateIso (ne jamais inventer de pointage pour les absents)
  const dayPresentPointages = new Map<string, Pointage>();
  pointages
    .filter((p) => p && p.date === dateIso && p.present !== false)
    .forEach((p) => {
      const wKey = p.ouvrier_id ? `id:${p.ouvrier_id}` : `num:${p.numero_ouvrier}`;
      const existing = dayPresentPointages.get(wKey);
      if (!existing || Number(p.timestamp || 0) >= Number(existing.timestamp || 0)) {
        dayPresentPointages.set(wKey, p);
      }
    });

  // Affectations réelles pour dateIso
  const dayAffectations = affectations.filter((a) => a && a.date === dateIso);

  // Récoltes réelles (opération RECOLTE) pour dateIso
  const dayRecoltes = recoltes.filter(
    (r) =>
      r &&
      r.date === dateIso &&
      (!r.type_operation || r.type_operation === 'RECOLTE')
  );

  interface IntermediateGroup {
    groupKey: string;
    workerKey: string;
    ouvrierIdRaw: string | number;
    nomOuvrier: string;
    domaineId: string;
    domaineNom: string;
    dtCode: string;
    tacheObj: Tache | null;
    tacheTypeId: string;
    tacheNom: string;
    serresSet: Set<string>;
    serresOrder: string[];
    serreMismatchErrors: Set<string>;
    rubanSet: Set<string>;
    cultureSet: Set<string>;
    equipeSet: Set<string>;
    recolteCaisses: number;
    recolteEntriesCount: number;
    affectationsCount: number;
    hasRecolteEntriesForWorker: boolean;
  }

  const groupsMap = new Map<string, IntermediateGroup>();

  const addSerreToken = (group: IntermediateGroup, token: ResolvedSerreToken) => {
    const formatted = formatSerreCodeForExport({
      rawSerre: token.raw,
      serreObj: token.serreObj,
      rowDomaineDT: group.dtCode,
    });
    if (!formatted.code) return;
    const key = formatted.code.toUpperCase();
    if (!group.serresSet.has(key)) {
      group.serresSet.add(key);
      group.serresOrder.push(formatted.code);
    }
    if (formatted.mismatchError) {
      group.serreMismatchErrors.add(formatted.mismatchError);
    }
  };

  const resolveDomaineInfo = (domId?: string | null) => {
    const id = domId || defaultDomaineId;
    const domObj = id ? domaineById.get(id) : undefined;
    const domNom = normalizeDomaineCode(domObj?.nom, id) || 'D2';
    const dtCode = formatDomaineDT(domObj?.nom, id) || 'D002';
    return { domaineId: domObj?.id || id || 'dom_d2', domaineNom: domNom, dtCode };
  };

  dayPresentPointages.forEach((ptg) => {
    const resolvedOuvrier =
      (ptg.ouvrier_id ? ouvrierById.get(ptg.ouvrier_id) : undefined) ||
      (ptg.numero_ouvrier ? ouvrierByNum.get(Number(ptg.numero_ouvrier)) : undefined);

    const workerCode: string | number =
      resolvedOuvrier?.numero && Number(resolvedOuvrier.numero) > 0
        ? resolvedOuvrier.numero
        : ptg.numero_ouvrier && Number(ptg.numero_ouvrier) > 0
        ? ptg.numero_ouvrier
        : '';

    const nomOuvrier =
      resolvedOuvrier?.nom?.trim() ||
      (ptg as any).nom_ouvrier?.trim() ||
      (workerCode ? `Ouvrier #${workerCode}` : 'Ouvrier inconnu');

    const workerKey = resolvedOuvrier?.id || ptg.ouvrier_id || `num_${workerCode}`;

    // Affectations de cet ouvrier ce jour-là
    const workerAffs = dayAffectations.filter(
      (a) =>
        (ptg.ouvrier_id && a.ouvrier_id === ptg.ouvrier_id) ||
        (resolvedOuvrier?.id && a.ouvrier_id === resolvedOuvrier.id) ||
        (workerCode && Number(a.numero_ouvrier) === Number(workerCode))
    );

    // Récoltes réelles de cet ouvrier ce jour-là
    const workerRecoltes = dayRecoltes.filter(
      (r) =>
        (ptg.ouvrier_id && r.ouvrier_id === ptg.ouvrier_id) ||
        (resolvedOuvrier?.id && r.ouvrier_id === resolvedOuvrier.id) ||
        (workerCode && Number(r.numero_ouvrier) === Number(workerCode))
    );

    const totalWorkerRecolteCaisses = workerRecoltes.reduce(
      (acc, r) => acc + (Number(r.caisses) || 0),
      0
    );

    // Construire la liste des unités d'affectation réelles
    interface RawWorkItem {
      tacheObj: Tache | null;
      domaineId: string;
      serreTokens: ResolvedSerreToken[];
      rubanId: string;
      cultureId: string;
      equipeId: string;
      fromAff: boolean;
    }

    const workItems: RawWorkItem[] = [];

    if (workerAffs.length > 0) {
      workerAffs.forEach((aff) => {
        const tObj = aff.tache_id ? tacheById.get(aff.tache_id) || null : null;
        const domId = aff.domaine_id || ptg.domaine_id || defaultDomaineId;
        let serresResolved = resolveRealSerresFromSource(
          aff.serre_id,
          aff.serre_nom,
          aff.serres_ids,
          aff.serres_noms,
          serreById,
          serreLookupByNameOrCode
        );
        // Si aucune serre sur l'affectation mais une config tâche-serre existe pour cette tâche ce jour-là
        if (serresResolved.length === 0 && aff.tache_id) {
          const cfg = taskConfigMap.get(aff.tache_id);
          if (cfg && (!cfg.domaine_id || cfg.domaine_id === domId)) {
            serresResolved = resolveRealSerresFromSource(
              null,
              null,
              cfg.serre_ids,
              cfg.serre_noms,
              serreById,
              serreLookupByNameOrCode
            );
          }
        }
        workItems.push({
          tacheObj: tObj,
          domaineId: domId,
          serreTokens: serresResolved,
          rubanId: String((aff as any).ruban_id || (aff as any).ruban || '').trim(),
          cultureId: String((aff as any).culture_id || (aff as any).culture || '').trim(),
          equipeId: String((aff as any).equipe_id || '').trim(),
          fromAff: true,
        });
      });
    } else if (ptg.tache_id) {
      const tObj = tacheById.get(ptg.tache_id) || null;
      const domId = ptg.domaine_id || defaultDomaineId;
      const serresResolved = resolveRealSerresFromSource(
        ptg.serre_id,
        ptg.serre_nom,
        undefined,
        undefined,
        serreById,
        serreLookupByNameOrCode
      );
      workItems.push({
        tacheObj: tObj,
        domaineId: domId,
        serreTokens: serresResolved,
        rubanId: String((ptg as any).ruban_id || '').trim(),
        cultureId: String((ptg as any).culture_id || '').trim(),
        equipeId: String((ptg as any).equipe_id || '').trim(),
        fromAff: false,
      });
    } else {
      const domId = ptg.domaine_id || defaultDomaineId;
      const serresResolved = resolveRealSerresFromSource(
        ptg.serre_id,
        ptg.serre_nom,
        undefined,
        undefined,
        serreById,
        serreLookupByNameOrCode
      );
      workItems.push({
        tacheObj: null,
        domaineId: domId,
        serreTokens: serresResolved,
        rubanId: String((ptg as any).ruban_id || '').trim(),
        cultureId: String((ptg as any).culture_id || '').trim(),
        equipeId: String((ptg as any).equipe_id || '').trim(),
        fromAff: false,
      });
    }

    // Regrouper par (ouvrier + domaine + tâche) sans jamais fusionner des travaux incompatibles
    workItems.forEach((item) => {
      const domInfo = resolveDomaineInfo(item.domaineId);
      const tacheTypeId = item.tacheObj?.code?.trim() || '';
      const tacheNom = item.tacheObj?.nom?.trim() || '';
      const tacheKey = item.tacheObj?.id || tacheNom || 'SANS_TACHE';
      const groupKey = `${dateIso}__${workerKey}__${domInfo.dtCode}__${tacheKey}`;

      let grp = groupsMap.get(groupKey);
      if (!grp) {
        grp = {
          groupKey,
          workerKey,
          ouvrierIdRaw: workerCode,
          nomOuvrier,
          domaineId: domInfo.domaineId,
          domaineNom: domInfo.domaineNom,
          dtCode: domInfo.dtCode,
          tacheObj: item.tacheObj,
          tacheTypeId,
          tacheNom,
          serresSet: new Set<string>(),
          serresOrder: [],
          serreMismatchErrors: new Set<string>(),
          rubanSet: new Set<string>(),
          cultureSet: new Set<string>(),
          equipeSet: new Set<string>(),
          recolteCaisses: 0,
          recolteEntriesCount: 0,
          affectationsCount: 0,
          hasRecolteEntriesForWorker: workerRecoltes.length > 0,
        };
        groupsMap.set(groupKey, grp);
      }

      if (item.fromAff) grp.affectationsCount += 1;
      item.serreTokens.forEach((tok) => addSerreToken(grp!, tok));
      if (item.rubanId) grp.rubanSet.add(item.rubanId);
      if (item.cultureId) grp.cultureSet.add(item.cultureId);
      if (item.equipeId) grp.equipeSet.add(item.equipeId);
    });

    // Attacher les récoltes réelles (caisses + serres de récolte) aux groupes concernés
    if (workerRecoltes.length > 0) {
      const workerGroups = Array.from(groupsMap.values()).filter(
        (g) => g.workerKey === workerKey
      );
      const recolteGroups = workerGroups.filter((g) => {
        const cls = classifyRemunerationWorkType({
          tache: g.tacheObj,
          domaine: { id: g.domaineId, nom: g.domaineNom },
          hasRecolteEntries: true,
        });
        return cls.categorie === 'RECOLTE' || cls.categorie === 'RECOLTE_CERISE';
      });

      const attachRecolteSerres = (targetGroup: IntermediateGroup, rec: RecolteEntry) => {
        const recTokens = resolveRealSerresFromSource(
          rec.serre_id,
          rec.serre_nom,
          undefined,
          undefined,
          serreById,
          serreLookupByNameOrCode
        );
        recTokens.forEach((tok) => addSerreToken(targetGroup, tok));
      };

      if (recolteGroups.length > 0) {
        workerRecoltes.forEach((rec) => {
          const recDomCode = normalizeDomaineCode(null, rec.domaine_id || '');
          const matchingByDom = recDomCode
            ? recolteGroups.find((g) => g.domaineNom === recDomCode)
            : undefined;
          const targetGroup = matchingByDom || recolteGroups[0];
          targetGroup.recolteCaisses += Number(rec.caisses) || 0;
          targetGroup.recolteEntriesCount += 1;
          attachRecolteSerres(targetGroup, rec);
          if (rec.created_by_nom) targetGroup.equipeSet.add(rec.created_by_nom);
        });
      } else if (workerGroups.length > 0) {
        // Ouvrier pointé sans tâche RÉCOLTE explicite, mais ayant des caisses récoltées réelles
        const targetGroup = workerGroups[0];
        targetGroup.recolteCaisses = totalWorkerRecolteCaisses;
        targetGroup.recolteEntriesCount = workerRecoltes.length;
        workerRecoltes.forEach((rec) => {
          attachRecolteSerres(targetGroup, rec);
          if (rec.created_by_nom) targetGroup.equipeSet.add(rec.created_by_nom);
        });
      }
    }
  });

  // Filtre par domaine si sélectionné
  const normalizedFilter =
    domaineFilter && domaineFilter !== 'ALL'
      ? normalizeDomaineCode(domaineById.get(domaineFilter)?.nom || domaineFilter, domaineFilter)
      : 'ALL';

  const allGroups = Array.from(groupsMap.values())
    .filter((g) => normalizedFilter === 'ALL' || g.domaineNom === normalizedFilter)
    .sort((a, b) => {
      if (a.dtCode !== b.dtCode) return a.dtCode.localeCompare(b.dtCode);
      const numA = Number(a.ouvrierIdRaw) || 0;
      const numB = Number(b.ouvrierIdRaw) || 0;
      if (numA !== numB) return numA - numB;
      return a.tacheTypeId.localeCompare(b.tacheTypeId);
    });

  const rows: RemunerationDraftRow[] = allGroups.map((g, idx) => {
    const autoCls = classifyRemunerationWorkType({
      tache: g.tacheObj,
      domaine: { id: g.domaineId, nom: g.domaineNom },
      hasRecolteEntries: g.hasRecolteEntriesForWorker,
    });

    const ov = overrides[g.groupKey] || {};
    const effectiveCategorie: RemunerationCategorie = ov.categorie || autoCls.categorie;
    const modeRemuneration = getModeRemunerationForCategorie(effectiveCategorie);
    const tarifExcep = getTarifForCategorie(effectiveCategorie, ov.tarifExcep);
    const uniteMetrique = getUniteForCategorie(effectiveCategorie);

    let heureDeb = '';
    let heureFin = '';
    let dureeRep = 0;
    let workValue: number | null = null;
    let unite: number | null = null;
    let quantiteMetrique: number | null = null;

    if (effectiveCategorie === 'STANDARD') {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      heureFin = normalizeTimeHHMM(ov.heureFin) || STANDARD_HEURE_FIN;
      dureeRep = getDureeRepForSchedule(
        heureDeb,
        heureFin,
        ov.dureeRep ?? STANDARD_DUREE_PAUSE
      );
      if (ov.quantite !== undefined && ov.quantite !== null) {
        workValue = ov.quantite;
      } else {
        const computedH = computeEffectiveHours(heureDeb, heureFin, dureeRep);
        workValue = computedH > 0 ? computedH : STANDARD_DUREE_EFFECTIVE;
      }
      unite = null;
      quantiteMetrique = null;
    } else if (effectiveCategorie === 'RECOLTE' || effectiveCategorie === 'RECOLTE_CERISE') {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      heureFin = normalizeTimeHHMM(ov.heureFin) || STANDARD_HEURE_FIN;
      dureeRep = getDureeRepForSchedule(
        heureDeb,
        heureFin,
        ov.dureeRep ?? STANDARD_DUREE_PAUSE
      );
      if (ov.quantite !== undefined && ov.quantite !== null) {
        workValue = ov.quantite;
      } else {
        workValue = g.recolteEntriesCount > 0 ? g.recolteCaisses : null;
      }
      unite = null;
      quantiteMetrique = workValue;
    } else if (effectiveCategorie === 'TRAITEMENT_D3') {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      workValue = ov.quantite !== undefined ? ov.quantite : null;
      if (ov.heureFin) {
        heureFin = normalizeTimeHHMM(ov.heureFin);
        dureeRep = getDureeRepForSchedule(heureDeb, heureFin, ov.dureeRep ?? 0);
      } else if (workValue !== null && workValue > 0) {
        const preliminaryPause = ov.dureeRep ?? (workValue >= 8 ? 1 : 0);
        heureFin = computeHeureFinFromDuration(heureDeb, workValue, preliminaryPause);
        dureeRep = getDureeRepForSchedule(heureDeb, heureFin, preliminaryPause);
      } else {
        dureeRep = ov.dureeRep ?? 0;
      }
      unite = null;
      quantiteMetrique = null;
    } else if (effectiveCategorie === 'EBOURGEONNAGE_D5') {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      heureFin = normalizeTimeHHMM(ov.heureFin) || STANDARD_HEURE_FIN;
      dureeRep = getDureeRepForSchedule(
        heureDeb,
        heureFin,
        ov.dureeRep ?? STANDARD_DUREE_PAUSE
      );
      unite = ov.unite ?? ov.quantite ?? 1;
      workValue = unite;
      quantiteMetrique = null;
    } else if (effectiveCategorie === 'UNITE') {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      heureFin = normalizeTimeHHMM(ov.heureFin) || STANDARD_HEURE_FIN;
      dureeRep = getDureeRepForSchedule(
        heureDeb,
        heureFin,
        ov.dureeRep ?? STANDARD_DUREE_PAUSE
      );
      unite = ov.unite ?? ov.quantite ?? null;
      workValue = unite;
      quantiteMetrique = null;
    } else {
      heureDeb = normalizeTimeHHMM(ov.heureDeb) || STANDARD_HEURE_DEB;
      heureFin = normalizeTimeHHMM(ov.heureFin) || '';
      dureeRep = getDureeRepForSchedule(heureDeb, heureFin, ov.dureeRep ?? 0);
      workValue = ov.quantite !== undefined ? ov.quantite : null;
      unite = null;
      quantiteMetrique = null;
    }

    // Règle 11 : La colonne `quantite` doit toujours rester vide
    const quantite: number | null = null;
    const remuneration = calculateRemunerationByCategorie(
      effectiveCategorie,
      workValue,
      tarifExcep
    );

    // Règle 1 : Format ouvrierId = NUMERO_OUVRIER-DOMAINE (ex: 1-D2, 55-D3, 120-D5)
    const formattedOuvrierId = formatOuvrierIdForExport(
      g.ouvrierIdRaw,
      g.domaineNom,
      g.domaineId
    );

    // Règles 2 & 4 : Serres multiples séparées par `+` sans espaces ; sinon "Toutes les serres"
    const formattedSerreId =
      g.serresOrder.length > 0 ? g.serresOrder.join('+') : DEFAULT_ALL_SERRES_LABEL;

    // Règle 3 : Toujours mettre "Tous les Rubans"
    const formattedRubanId = DEFAULT_RUBAN_LABEL;

    // Validations avant export (Règles 1 à 12)
    const validationErrors: string[] = [];
    if (!g.ouvrierIdRaw || Number(g.ouvrierIdRaw) <= 0) {
      validationErrors.push('Code ouvrier manquant.');
    } else if (!/^\d+-D\d+$/i.test(formattedOuvrierId)) {
      validationErrors.push(
        `Format ouvrierId invalide (${formattedOuvrierId || 'vide'}) : format NUMERO-DOMAINE requis.`
      );
    }
    if (!/^D\d{3}$/.test(g.dtCode)) {
      validationErrors.push(`Code Domaine DT invalide (${g.dtCode || 'vide'}) : format D00X requis.`);
    }
    if (g.serreMismatchErrors.size > 0) {
      g.serreMismatchErrors.forEach((msg) => validationErrors.push(msg));
    }
    if (formattedSerreId !== DEFAULT_ALL_SERRES_LABEL && /\s/.test(formattedSerreId)) {
      validationErrors.push('Les serres multiples doivent être séparées par "+" sans espaces.');
    }
    if (effectiveCategorie === 'INCERTAIN') {
      validationErrors.push(
        !g.tacheNom
          ? 'Affectation sans tâche identifiable.'
          : `Identification incertaine : ${autoCls.reason}`
      );
    }
    if (
      (effectiveCategorie === 'RECOLTE' || effectiveCategorie === 'RECOLTE_CERISE') &&
      (workValue === null || workValue <= 0)
    ) {
      validationErrors.push('Quantité de récolte manquante (caisses).');
    }
    if (effectiveCategorie === 'TRAITEMENT_D3' && (workValue === null || workValue <= 0)) {
      validationErrors.push('Nombre d\'heures TTT D3 non renseigné.');
    }
    if (effectiveCategorie === 'STANDARD' && (workValue === null || workValue <= 0)) {
      validationErrors.push('Durée effective invalide pour le travail standard.');
    }
    if (effectiveCategorie === 'EBOURGEONNAGE_D5' && (unite === null || unite <= 0)) {
      validationErrors.push('Unité forfaitaire manquante pour ÉBOURGEONNAGE D5.');
    }
    if (effectiveCategorie === 'UNITE' && (unite === null || unite <= 0)) {
      validationErrors.push('Champ unité manquant pour le travail à l\'unité.');
    }
    if (effectiveCategorie !== 'INCERTAIN' && (tarifExcep === null || tarifExcep <= 0)) {
      validationErrors.push('Tarif incorrect ou manquant.');
    }

    const expectedTarif = getTarifForCategorie(effectiveCategorie, tarifExcep);
    if (
      effectiveCategorie !== 'INCERTAIN' &&
      tarifExcep !== null &&
      expectedTarif !== null &&
      Math.abs(tarifExcep - expectedTarif) > 1e-6
    ) {
      validationErrors.push('Tarif non conforme au barème officiel.');
    }

    const needsAdminAction =
      validationErrors.length > 0 || effectiveCategorie === 'TRAITEMENT_D3' || effectiveCategorie === 'INCERTAIN';

    const docId = `${g.dtCode}_${dateIso}_${g.ouvrierIdRaw || 'X'}_${idx + 1}`;

    return {
      rowKey: g.groupKey,
      workerKey: g.workerKey,
      docId,
      dateTrava: dateIso,
      ouvrierId: formattedOuvrierId,
      nomOuvrier: g.nomOuvrier,
      DT: g.dtCode,
      serreId: formattedSerreId,
      rubanId: formattedRubanId,
      cultureId: Array.from(g.cultureSet).join(', '),
      tacheTypeId: g.tacheTypeId,
      tache: g.tacheNom,
      uniteMetrique,
      quantiteMetrique,
      quantite,
      heureDeb,
      heureFin,
      dureeRep,
      periodeJo: 'JOURNEE',
      statut: 'BROUILLON',
      equipeId: Array.from(g.equipeSet).join(', '),
      tarifExcep,
      remuneration,
      domaineId: g.domaineId,
      domaineNom: g.domaineNom,
      autoCategorie: autoCls.categorie,
      effectiveCategorie,
      modeRemuneration,
      unite,
      workValue,
      classificationReason: autoCls.reason,
      needsAdminAction,
      validationErrors,
      recolteCaissesSource: g.recolteEntriesCount > 0 ? g.recolteCaisses : null,
      recolteEntriesCount: g.recolteEntriesCount,
      affectationsCount: g.affectationsCount,
    };
  });

  // Totaux par ouvrier
  const workerTotalsMap = new Map<string, WorkerRemunerationTotal>();
  rows.forEach((row) => {
    const prev = workerTotalsMap.get(row.workerKey) || {
      workerKey: row.workerKey,
      ouvrierId: row.ouvrierId,
      nomOuvrier: row.nomOuvrier,
      rowsCount: 0,
      totalDH: 0,
      hasErrors: false,
    };
    prev.rowsCount += 1;
    if (prev.ouvrierId && row.ouvrierId && !String(prev.ouvrierId).includes(row.ouvrierId)) {
      prev.ouvrierId = `${prev.ouvrierId}, ${row.ouvrierId}`;
    } else if (!prev.ouvrierId) {
      prev.ouvrierId = row.ouvrierId;
    }
    prev.totalDH = roundRemuneration(prev.totalDH + (row.remuneration || 0));
    if (row.validationErrors.length > 0) prev.hasErrors = true;
    workerTotalsMap.set(row.workerKey, prev);
  });

  const extractWorkerNum = (ouvId: string | number) => parseInt(String(ouvId), 10) || 0;
  const totalByWorker = Array.from(workerTotalsMap.values()).sort(
    (a, b) => extractWorkerNum(a.ouvrierId) - extractWorkerNum(b.ouvrierId)
  );

  // Totaux par domaine
  const domTotalsMap = new Map<
    string,
    { DT: string; domaineNom: string; domaineId: string; rowsCount: number; workers: Set<string>; totalDH: number }
  >();
  rows.forEach((row) => {
    const prev = domTotalsMap.get(row.DT) || {
      DT: row.DT,
      domaineNom: row.domaineNom,
      domaineId: row.domaineId,
      rowsCount: 0,
      workers: new Set<string>(),
      totalDH: 0,
    };
    prev.rowsCount += 1;
    prev.workers.add(row.workerKey);
    prev.totalDH = roundRemuneration(prev.totalDH + (row.remuneration || 0));
    domTotalsMap.set(row.DT, prev);
  });

  const totalByDomaine: DomaineRemunerationTotal[] = Array.from(domTotalsMap.values())
    .map((d) => ({
      DT: d.DT,
      domaineNom: d.domaineNom,
      domaineId: d.domaineId,
      rowsCount: d.rowsCount,
      ouvriersCount: d.workers.size,
      totalDH: d.totalDH,
    }))
    .sort((a, b) => a.DT.localeCompare(b.DT));

  const grandTotalDH = roundRemuneration(
    rows.reduce((sum, r) => sum + (r.remuneration || 0), 0)
  );

  const validationIssues: RemunerationValidationIssue[] = rows
    .filter((r) => r.validationErrors.length > 0)
    .map((r) => ({
      rowKey: r.rowKey,
      ouvrierId: r.ouvrierId,
      nomOuvrier: r.nomOuvrier,
      DT: r.DT,
      tache: r.tache || '(Sans tâche)',
      messages: r.validationErrors,
    }));

  return {
    rows,
    totalByWorker,
    totalByDomaine,
    grandTotalDH,
    totalOuvriersDistincts: totalByWorker.length,
    validationIssues,
    canExportWithoutError: rows.length > 0 && validationIssues.length === 0,
  };
}

/**
 * Construit le classeur Excel (.xlsx) conforme au modèle D002_2026-11-15_BROUILLON
 * Feuille : "Pointage", 21 colonnes exactes dans l'ordre.
 */
export function buildRemunerationWorkbook(rows: RemunerationExcelRow[]): XLSX.WorkBook {
  const headers = [...REMUNERATION_EXCEL_COLUMNS];
  const sheetData: (string | number)[][] = [
    headers,
    ...rows.map((r) => [
      r.docId,
      r.dateTrava,
      r.ouvrierId,
      r.nomOuvrier,
      r.DT,
      r.serreId,
      r.rubanId,
      r.cultureId,
      r.tacheTypeId,
      r.tache,
      r.uniteMetrique,
      r.quantiteMetrique ?? '',
      r.quantite ?? '',
      r.heureDeb,
      r.heureFin,
      r.dureeRep,
      r.periodeJo,
      r.statut,
      r.equipeId,
      r.tarifExcep ?? '',
      r.remuneration ?? '',
    ]),
  ];

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(sheetData);

  const numCols = headers.length;
  const totalRowsCount = sheetData.length;

  const colWidths: number[] = headers.map((h) => Math.max(h.length + 3, 12));
  sheetData.forEach((row) => {
    row.forEach((cell, colIdx) => {
      const len = String(cell !== undefined && cell !== null ? cell : '').length;
      if (len + 3 > colWidths[colIdx]) {
        colWidths[colIdx] = Math.min(len + 3, 42);
      }
    });
  });

  worksheet['!cols'] = colWidths.map((wch) => ({ wch }));

  const lastColLetter = XLSX.utils.encode_col(numCols - 1);
  worksheet['!autofilter'] = {
    ref: `A1:${lastColLetter}${Math.max(totalRowsCount, 1)}`,
  };

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

  for (let c = 0; c < numCols; c++) {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c });
    if (worksheet[cellAddress]) {
      worksheet[cellAddress].s = {
        font: { bold: true, color: { rgb: '000000' } },
        fill: { fgColor: { rgb: 'E2E8F0' } },
      };
    }
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, REMUNERATION_SHEET_NAME);
  return workbook;
}

export function getRemunerationExportFilename(
  dateIso: string,
  domaineFilter: string,
  domaines: Domaine[]
): string {
  const domObj = domaines.find((d) => d.id === domaineFilter);
  const dt =
    domaineFilter === 'ALL'
      ? 'TOUS_DOMAINES'
      : formatDomaineDT(domObj?.nom || domaineFilter, domaineFilter) || 'DOMAINE';
  return `${dt}_${dateIso}_BROUILLON.xlsx`;
}

export function exportRemunerationExcel(params: {
  rows: RemunerationDraftRow[];
  dateIso: string;
  domaineFilter: string;
  domaines: Domaine[];
  allowWithWarnings?: boolean;
}): {
  success: boolean;
  filename: string;
  totalLignes: number;
  error?: string;
} {
  try {
    const { rows, dateIso, domaineFilter, domaines, allowWithWarnings = false } = params;

    if (!rows || rows.length === 0) {
      return {
        success: false,
        filename: '',
        totalLignes: 0,
        error: 'Aucune ligne de pointage à exporter pour cette date et ce domaine.',
      };
    }

    const blockingErrors = rows.filter((r) => r.validationErrors.length > 0);
    if (!allowWithWarnings && blockingErrors.length > 0) {
      return {
        success: false,
        filename: '',
        totalLignes: 0,
        error: `${blockingErrors.length} ligne(s) comportent des erreurs ou données manquantes à corriger avant export.`,
      };
    }

    const filename = getRemunerationExportFilename(dateIso, domaineFilter, domaines);
    const workbook = buildRemunerationWorkbook(rows);
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
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      error: err instanceof Error ? err.message : 'Erreur lors de la génération Excel.',
    };
  }
}

export interface ImportedRemunerationRow extends RemunerationExcelRow {
  rowIndex: number;
  modeRemuneration: ModeRemunerationExport;
  unite: number | null;
  validationErrors: string[];
}

export interface ParseRemunerationWorkbookResult {
  success: boolean;
  sheetName: string;
  rows: ImportedRemunerationRow[];
  validRowsCount: number;
  errorRowsCount: number;
  totalRemunerationDH: number;
  errors: string[];
}

function toNullableNumber(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const cleaned = String(val).trim().replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Importe et valide un classeur Excel Tableau de Rémunération (21 colonnes, feuille "Pointage")
 * selon les 12 règles officielles.
 */
export function parseRemunerationWorkbook(workbook: XLSX.WorkBook): ParseRemunerationWorkbookResult {
  if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
    return {
      success: false,
      sheetName: '',
      rows: [],
      validRowsCount: 0,
      errorRowsCount: 0,
      totalRemunerationDH: 0,
      errors: ['Le classeur Excel ne contient aucune feuille.'],
    };
  }

  const sheetName = workbook.SheetNames.includes(REMUNERATION_SHEET_NAME)
    ? REMUNERATION_SHEET_NAME
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return {
      success: false,
      sheetName,
      rows: [],
      validRowsCount: 0,
      errorRowsCount: 0,
      totalRemunerationDH: 0,
      errors: [`Feuille "${sheetName}" introuvable.`],
    };
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (matrix.length === 0) {
    return {
      success: false,
      sheetName,
      rows: [],
      validRowsCount: 0,
      errorRowsCount: 0,
      totalRemunerationDH: 0,
      errors: ['La feuille Excel est vide.'],
    };
  }

  const headerRow = (matrix[0] || []).map((h) => String(h ?? '').trim());
  const globalErrors: string[] = [];
  if (headerRow.length !== REMUNERATION_EXCEL_COLUMNS.length) {
    globalErrors.push(
      `Nombre de colonnes invalide : ${headerRow.length} trouvées, ${REMUNERATION_EXCEL_COLUMNS.length} attendues.`
    );
  } else {
    REMUNERATION_EXCEL_COLUMNS.forEach((expectedCol, idx) => {
      if (headerRow[idx] !== expectedCol) {
        globalErrors.push(`Colonne ${idx + 1} invalide : "${headerRow[idx]}" au lieu de "${expectedCol}".`);
      }
    });
  }

  if (globalErrors.length > 0) {
    return {
      success: false,
      sheetName,
      rows: [],
      validRowsCount: 0,
      errorRowsCount: 0,
      totalRemunerationDH: 0,
      errors: globalErrors,
    };
  }

  const importedRows: ImportedRemunerationRow[] = [];

  for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
    const raw = matrix[rIdx] || [];
    const docId = String(raw[0] ?? '').trim();
    const dateTrava = String(raw[1] ?? '').trim();
    const ouvrierId = String(raw[2] ?? '').trim();
    const nomOuvrier = String(raw[3] ?? '').trim();
    const DT = String(raw[4] ?? '').trim();
    const serreId = String(raw[5] ?? '').trim();
    const rubanId = String(raw[6] ?? '').trim();
    const cultureId = String(raw[7] ?? '').trim();
    const tacheTypeId = String(raw[8] ?? '').trim();
    const tache = String(raw[9] ?? '').trim();
    const uniteMetrique = String(raw[10] ?? '').trim().toUpperCase() as RemunerationExcelRow['uniteMetrique'];
    const quantiteMetrique = toNullableNumber(raw[11]);
    const quantite = toNullableNumber(raw[12]);
    const heureDeb = normalizeTimeHHMM(String(raw[13] ?? ''));
    const heureFin = normalizeTimeHHMM(String(raw[14] ?? ''));
    const dureeRepVal = toNullableNumber(raw[15]);
    const dureeRep = dureeRepVal ?? 0;
    const periodeJo = String(raw[16] ?? '').trim();
    const statut = String(raw[17] ?? '').trim();
    const equipeId = String(raw[18] ?? '').trim();
    const tarifExcep = toNullableNumber(raw[19]);
    const remuneration = toNullableNumber(raw[20]);

    const rowErrors: string[] = [];

    // Règle 1 : ouvrierId au format NUMERO-DOMAINE (ex: 1-D2, 55-D3, 120-D5)
    if (!/^\d+-D\d+$/i.test(ouvrierId)) {
      rowErrors.push(`ouvrierId "${ouvrierId}" invalide (format NUMERO-DOMAINE requis).`);
    }

    // Règle 2 & 4 : serreId ("Toutes les serres" ou D00XSY+D00XSY sans espaces)
    if (!serreId) {
      rowErrors.push('serreId vide ("Toutes les serres" ou code serre requis).');
    } else if (serreId !== DEFAULT_ALL_SERRES_LABEL && /\s/.test(serreId)) {
      rowErrors.push(`serreId "${serreId}" contient des espaces interdits autour de "+".`);
    }

    // Règle 3 : rubanId = "Tous les Rubans"
    if (rubanId !== DEFAULT_RUBAN_LABEL) {
      rowErrors.push(`rubanId "${rubanId}" doit être "${DEFAULT_RUBAN_LABEL}".`);
    }

    // Règle 11 : colonne quantite doit rester vide
    if (quantite !== null) {
      rowErrors.push(`La colonne quantite doit rester vide (trouvé : ${quantite}).`);
    }

    // Règle 12 : dureeRep exacte pour 07:00-16:00 (1) et 07:00-14:00 (0)
    if (heureDeb === '07:00' && heureFin === '16:00' && dureeRep !== 1) {
      rowErrors.push(`Pour 07:00 à 16:00, dureeRep doit être 1 (trouvé : ${dureeRep}).`);
    }
    if (heureDeb === '07:00' && heureFin === '14:00' && dureeRep !== 0) {
      rowErrors.push(`Pour 07:00 à 14:00, dureeRep doit être 0 (trouvé : ${dureeRep}).`);
    }

    const tacheNorm = normalizeText(tache);
    let modeRemuneration: ModeRemunerationExport = 'temps';
    let unite: number | null = null;

    if (
      uniteMetrique === 'FORFAIT' ||
      ((tacheNorm.includes('ebourgeonnage') || tacheNorm.includes('bourgeon')) && DT === 'D005')
    ) {
      modeRemuneration = 'forfait';
      unite = 1;
      if (tarifExcep !== TARIF_EBOURGEONNAGE_D5_FORFAIT) {
        rowErrors.push(`ÉBOURGEONNAGE D5 : tarifExcep doit être 150 (trouvé : ${tarifExcep}).`);
      }
      if (quantiteMetrique !== null) {
        rowErrors.push('ÉBOURGEONNAGE D5 : quantiteMetrique doit être vide.');
      }
    } else if (uniteMetrique === 'UNITE') {
      modeRemuneration = 'unite';
      if (tarifExcep === null || tarifExcep <= 0) {
        rowErrors.push('Travail à l\'unité : tarifExcep manquant ou invalide.');
      } else if (remuneration !== null && remuneration > 0) {
        unite = roundRemuneration(remuneration / tarifExcep);
      }
      if (quantiteMetrique !== null) {
        rowErrors.push('Travail à l\'unité : quantiteMetrique doit être vide.');
      }
    } else if (
      uniteMetrique === 'PLATEAUX' ||
      tacheNorm.includes('recolte') ||
      tacheNorm.includes('cerise') ||
      tacheNorm.includes('ronde')
    ) {
      modeRemuneration = 'metrique';
      if (quantiteMetrique === null || quantiteMetrique <= 0) {
        rowErrors.push('Récolte : quantiteMetrique (nombre de caisses) manquante.');
      }
      if (tacheNorm.includes('cerise') && tarifExcep !== TARIF_RECOLTE_CERISE) {
        rowErrors.push(`Récolte Cerise : tarifExcep doit être 3.8 (trouvé : ${tarifExcep}).`);
      } else if (!tacheNorm.includes('cerise') && tarifExcep !== TARIF_RECOLTE_RONDE) {
        rowErrors.push(`Récolte Ronde : tarifExcep doit être 1.1875 (trouvé : ${tarifExcep}).`);
      }
    } else {
      modeRemuneration = 'temps';
      // Règle 10 : qteMetrique vide pour les ouvriers rémunérés au temps
      if (quantiteMetrique !== null) {
        rowErrors.push(`Travail au temps : quantiteMetrique doit rester vide (trouvé : ${quantiteMetrique}).`);
      }
      if ((tacheNorm.includes('ttt') || tacheNorm.includes('traitement') || tacheNorm.includes('phyto')) && DT === 'D003') {
        if (tarifExcep !== TARIF_TRAITEMENT_D3_HEURE) {
          rowErrors.push(`TTT D3 : tarifExcep doit être 16 (trouvé : ${tarifExcep}).`);
        }
      } else if (heureDeb === '07:00' && heureFin === '16:00' && dureeRep === 1) {
        if (remuneration !== null && Math.abs(remuneration - TARIF_STANDARD_JOUR_95) > 1e-4) {
          rowErrors.push(`Travail 07:00-16:00 (pause 1h) : rémunération attendue 95 DH (trouvé : ${remuneration}).`);
        }
      }
    }

    importedRows.push({
      rowIndex: rIdx + 1,
      docId,
      dateTrava,
      ouvrierId,
      nomOuvrier,
      DT,
      serreId,
      rubanId,
      cultureId,
      tacheTypeId,
      tache,
      uniteMetrique,
      quantiteMetrique,
      quantite,
      heureDeb,
      heureFin,
      dureeRep,
      periodeJo,
      statut,
      equipeId,
      tarifExcep,
      remuneration,
      modeRemuneration,
      unite,
      validationErrors: rowErrors,
    });
  }

  const errorRows = importedRows.filter((r) => r.validationErrors.length > 0);
  const totalRemunerationDH = roundRemuneration(
    importedRows.reduce((sum, r) => sum + (r.remuneration || 0), 0)
  );

  return {
    success: errorRows.length === 0 && importedRows.length > 0,
    sheetName,
    rows: importedRows,
    validRowsCount: importedRows.length - errorRows.length,
    errorRowsCount: errorRows.length,
    totalRemunerationDH,
    errors: errorRows.flatMap((r) =>
      r.validationErrors.map((msg) => `Ligne ${r.rowIndex} (${r.ouvrierId || '?'}): ${msg}`)
    ),
  };
}

export async function importRemunerationExcelFile(
  file: File
): Promise<ParseRemunerationWorkbookResult> {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    return parseRemunerationWorkbook(workbook);
  } catch (err: unknown) {
    return {
      success: false,
      sheetName: '',
      rows: [],
      validRowsCount: 0,
      errorRowsCount: 0,
      totalRemunerationDH: 0,
      errors: [err instanceof Error ? err.message : 'Impossible de lire le fichier Excel.'],
    };
  }
}
