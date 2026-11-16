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
 * Trois règles officielles de rémunération :
 * A. STANDARD      : 11,875 DH / heure  (07:00-16:00, 1h pause non rémunérée => 8h = 95 DH)
 * B. RÉCOLTE       : 1,1875 DH / plateau (PLATEAUX, quantité réelle de caisses, AUCUN minimum de 80)
 * C. TRAITEMENT D3 : 16 DH / heure      (HEURE, quantité d'heures renseignée/ajustée par l'admin)
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
  | 'TRAITEMENT_D3'
  | 'INCERTAIN';

export const REMUNERATION_SHEET_NAME = 'Pointage';

export const TARIF_STANDARD_HEURE = 11.875;
export const TARIF_RECOLTE_PLATEAU = 1.1875;
export const TARIF_TRAITEMENT_D3_HEURE = 16;

export const STANDARD_HEURE_DEB = '07:00';
export const STANDARD_HEURE_FIN = '16:00';
export const STANDARD_DUREE_PAUSE = 1;
export const STANDARD_DUREE_EFFECTIVE = 8;

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
  ouvrierId: string | number;
  nomOuvrier: string;
  DT: string;
  serreId: string;
  rubanId: string;
  cultureId: string;
  tacheTypeId: string;
  tache: string;
  uniteMetrique: 'HEURE' | 'PLATEAUX' | '';
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
  quantite?: number | null; // heures pour STANDARD / TRAITEMENT_D3, plateaux pour RECOLTE
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
    const stripped = rawClean.replace(/^DT?0*\d+\s*[-_]?\s*/i, '').replace(/^S(?=[A-Z0-9])/i, '');
    code = expectedDT ? `${expectedDT}S${stripped}` : rawClean;
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

export function parseTimeToHours(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const match = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
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
  return roundRemuneration(caisses * TARIF_RECOLTE_PLATEAU);
}

export function calculateTraitementD3Remuneration(heures: number): number {
  if (!Number.isFinite(heures) || heures <= 0) return 0;
  return roundRemuneration(heures * TARIF_TRAITEMENT_D3_HEURE);
}

export function getTarifForCategorie(categorie: RemunerationCategorie): number | null {
  switch (categorie) {
    case 'STANDARD':
      return TARIF_STANDARD_HEURE;
    case 'RECOLTE':
      return TARIF_RECOLTE_PLATEAU;
    case 'TRAITEMENT_D3':
      return TARIF_TRAITEMENT_D3_HEURE;
    default:
      return null;
  }
}

export function getUniteForCategorie(categorie: RemunerationCategorie): 'HEURE' | 'PLATEAUX' | '' {
  switch (categorie) {
    case 'STANDARD':
    case 'TRAITEMENT_D3':
      return 'HEURE';
    case 'RECOLTE':
      return 'PLATEAUX';
    default:
      return '';
  }
}

export function calculateRemunerationByCategorie(
  categorie: RemunerationCategorie,
  quantite: number | null
): number | null {
  if (quantite === null || !Number.isFinite(quantite) || quantite <= 0) return null;
  switch (categorie) {
    case 'STANDARD':
      return calculateStandardRemuneration(quantite);
    case 'RECOLTE':
      return calculateRecolteRemuneration(quantite);
    case 'TRAITEMENT_D3':
      return calculateTraitementD3Remuneration(quantite);
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

  // 1. Tâche manquante ou sans libellé identifiable
  if (!tache || !nomNorm || nomNorm === 'sans tache') {
    if (hasRecolteEntries) {
      return {
        categorie: 'INCERTAIN',
        reason:
          'Aucune tâche pointée mais des caisses récoltées existent à cette date : confirmer RÉCOLTE (1,1875 DH) ou STANDARD (11,875 DH).',
      };
    }
    if (isD3) {
      return {
        categorie: 'INCERTAIN',
        reason:
          'Ouvrier pointé dans le Domaine D3 sans tâche identifiable : confirmer TRAITEMENT D3 (16 DH/h) ou STANDARD (11,875 DH/h).',
      };
    }
    return {
      categorie: 'INCERTAIN',
      reason: 'Affectation sans tâche identifiable : confirmer le type de rémunération avant export.',
    };
  }

  // 2. RÉCOLTE (prioritaire sur le domaine, même en D3 ou D5)
  const isRecolteTask =
    nomNorm.includes('recolte') ||
    nomNorm.includes('cueillette') ||
    /^r0*\d+$/i.test(codeNorm);

  if (isRecolteTask) {
    return {
      categorie: 'RECOLTE',
      reason: 'Tâche Récolte détectée : tarif réel par plateau (1,1875 DH/caisse, sans minimum).',
    };
  }

  // 3. TRAITEMENT (D3 -> 16 DH/h, hors D3 -> alerte admin pour confirmation)
  const isTraitementTask =
    nomNorm.includes('traitement') ||
    nomNorm.includes('phyto') ||
    nomNorm.includes('phytosanitaire') ||
    nomNorm.includes('pulverisation') ||
    nomNorm.includes('sulfatage') ||
    /^phy/i.test(codeNorm);

  if (isTraitementTask) {
    if (isD3 || fullTask.includes('d3')) {
      return {
        categorie: 'TRAITEMENT_D3',
        reason: 'Traitement dans le Domaine D3 : rémunération horaire à 16 DH/h.',
      };
    }
    return {
      categorie: 'INCERTAIN',
      reason:
        `Tâche Traitement détectée hors Domaine D3 (${normalizeDomaineCode(domaine?.nom, domaine?.id) || 'Domaine inconnu'}) : confirmer TRAITEMENT (16 DH/h) ou STANDARD (11,875 DH/h).`,
    };
  }

  // 4. Tâches agricoles standards explicites (y compris en D3 si la tâche réelle n'est pas Traitement)
  return {
    categorie: 'STANDARD',
    reason: 'Tâche standard (07:00–16:00, pause 1h = 8h effectives × 11,875 DH/h).',
  };
}

interface ResolvedSerreToken {
  raw: string;
  serreObj?: Serre;
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
    if (!clean && !explicitObj) return;
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
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);

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
      .split(',')
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
        return cls.categorie === 'RECOLTE';
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
    const tarifExcep = getTarifForCategorie(effectiveCategorie);
    const uniteMetrique = getUniteForCategorie(effectiveCategorie);

    let heureDeb = '';
    let heureFin = '';
    let dureeRep = 0;
    let quantite: number | null = null;

    if (effectiveCategorie === 'STANDARD') {
      heureDeb = ov.heureDeb ?? STANDARD_HEURE_DEB;
      heureFin = ov.heureFin ?? STANDARD_HEURE_FIN;
      dureeRep = ov.dureeRep ?? STANDARD_DUREE_PAUSE;
      if (ov.quantite !== undefined && ov.quantite !== null) {
        quantite = ov.quantite;
      } else {
        const computedH = computeEffectiveHours(heureDeb, heureFin, dureeRep);
        quantite = computedH > 0 ? computedH : STANDARD_DUREE_EFFECTIVE;
      }
    } else if (effectiveCategorie === 'RECOLTE') {
      heureDeb = ov.heureDeb ?? STANDARD_HEURE_DEB;
      heureFin = ov.heureFin ?? STANDARD_HEURE_FIN;
      dureeRep = ov.dureeRep ?? STANDARD_DUREE_PAUSE;
      if (ov.quantite !== undefined && ov.quantite !== null) {
        quantite = ov.quantite;
      } else {
        quantite = g.recolteEntriesCount > 0 ? g.recolteCaisses : null;
      }
    } else if (effectiveCategorie === 'TRAITEMENT_D3') {
      heureDeb = ov.heureDeb ?? STANDARD_HEURE_DEB;
      dureeRep = ov.dureeRep ?? 0;
      quantite = ov.quantite !== undefined ? ov.quantite : null;
      if (ov.heureFin) {
        heureFin = ov.heureFin;
      } else if (quantite !== null && quantite > 0) {
        heureFin = computeHeureFinFromDuration(heureDeb, quantite, dureeRep);
      }
    } else {
      heureDeb = ov.heureDeb ?? STANDARD_HEURE_DEB;
      heureFin = ov.heureFin ?? '';
      dureeRep = ov.dureeRep ?? 0;
      quantite = ov.quantite !== undefined ? ov.quantite : null;
    }

    const remuneration = calculateRemunerationByCategorie(effectiveCategorie, quantite);

    // Validations avant export
    const validationErrors: string[] = [];
    if (!g.ouvrierIdRaw || Number(g.ouvrierIdRaw) <= 0) {
      validationErrors.push('Code ouvrier manquant.');
    }
    if (!/^D\d{3}$/.test(g.dtCode)) {
      validationErrors.push(`Code Domaine DT invalide (${g.dtCode || 'vide'}) : format D00X requis.`);
    }
    if (g.serreMismatchErrors.size > 0) {
      g.serreMismatchErrors.forEach((msg) => validationErrors.push(msg));
    }
    if (effectiveCategorie === 'INCERTAIN') {
      validationErrors.push(
        !g.tacheNom
          ? 'Affectation sans tâche identifiable.'
          : `Identification incertaine : ${autoCls.reason}`
      );
    }
    if (effectiveCategorie === 'RECOLTE' && (quantite === null || quantite <= 0)) {
      validationErrors.push('Quantité de récolte manquante (plateaux/caisses).');
    }
    if (effectiveCategorie === 'TRAITEMENT_D3' && (quantite === null || quantite <= 0)) {
      validationErrors.push('Nombre d\'heures de traitement D3 non renseigné.');
    }
    if (effectiveCategorie === 'STANDARD' && (quantite === null || quantite <= 0)) {
      validationErrors.push('Durée effective invalide pour le travail standard.');
    }
    if (effectiveCategorie !== 'INCERTAIN' && (tarifExcep === null || tarifExcep <= 0)) {
      validationErrors.push('Tarif incorrect ou manquant.');
    }

    const expectedTarif = getTarifForCategorie(effectiveCategorie);
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
      ouvrierId: g.ouvrierIdRaw,
      nomOuvrier: g.nomOuvrier,
      DT: g.dtCode,
      serreId: g.serresOrder.join(', '),
      rubanId: Array.from(g.rubanSet).join(', '),
      cultureId: Array.from(g.cultureSet).join(', '),
      tacheTypeId: g.tacheTypeId,
      tache: g.tacheNom,
      uniteMetrique,
      quantiteMetrique: quantite,
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
    prev.totalDH = roundRemuneration(prev.totalDH + (row.remuneration || 0));
    if (row.validationErrors.length > 0) prev.hasErrors = true;
    workerTotalsMap.set(row.workerKey, prev);
  });

  const totalByWorker = Array.from(workerTotalsMap.values()).sort(
    (a, b) => (Number(a.ouvrierId) || 0) - (Number(b.ouvrierId) || 0)
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
