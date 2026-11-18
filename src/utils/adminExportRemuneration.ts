/**
 * Moteur indépendant : EXPORT RÉMUNÉRATION (RÉSERVÉ ADMINISTRATEUR)
 * Application : LAHCEN POINTEUR
 * Source des données : POINTAGE MATIN (en lecture seule)
 *
 * Modèle Excel obligatoire : D002_2026-11-16_BROUILLON (3) - Copie.xlsx
 * - Feuille unique : "Pointage"
 * - 21 colonnes exactes dans cet ordre :
 *   docId | dateTrava | ouvrierId | nomOuvrier | DT | serreId | rubanId | cultureId |
 *   tacheTypeId | tache | uniteMetrique | quantiteMetrique | quantite | heureDeb |
 *   heureFin | dureeRep | periodeJo | statut | equipeId | tarifExcep | remuneration
 *
 * Règles strictes :
 * - Utiliser ExcelJS pour préserver fidèlement les propriétés du classeur modèle (.xlsx).
 * - Ne jamais utiliser les lignes d'exemple du fichier modèle comme données du jour.
 * - Tarif connu et confirmé -> statut = 'VALIDÉE', tarifExcep et remuneration renseignés.
 * - Tarif inconnu ou non confirmé -> statut = 'EN COURS', tarifExcep = '', remuneration = ''.
 * - Les lignes EN COURS ne sont jamais intégrées aux totaux validés.
 * - Un tarif déjà validé n'est jamais modifié silencieusement.
 */

import ExcelJS from 'exceljs';
import {
  AffectationTache,
  Domaine,
  Ouvrier,
  Pointage,
  RecolteEntry,
  Serre,
  Tache,
  TacheSerreConfig,
  UserAccount,
} from '../types';

export const ADMIN_EXPORT_SHEET_NAME = 'Pointage';
export const ADMIN_EXPORT_TEMPLATE_FILENAME = 'D002_2026-11-16_BROUILLON (3) - Copie.xlsx';
export const ADMIN_EXPORT_TEMPLATE_PUBLIC_URL = '/templates/D002_2026-11-16_BROUILLON%20(3)%20-%20Copie.xlsx';
export const ADMIN_EXPORT_RUBAN_LABEL = 'Tous les Rubans';
export const ADMIN_EXPORT_ALL_SERRES_LABEL = 'Toutes les serres';

export const ADMIN_TARIF_STANDARD_HEURE = 11.875;
export const ADMIN_TARIF_RECOLTE_CERISE = 3.8;
export const ADMIN_TARIF_RECOLTE_RONDE = 1.1875;
export const ADMIN_TARIF_TTT_D3_HEURE = 16;
export const ADMIN_TARIF_EBOURGEONNAGE_D5 = 150;
export const ADMIN_TARIF_STATIONNAIRE_JOUR = 100;
export const ADMIN_TARIF_TRAITEMENT_PHYTO_JOUR = 105;

export const ADMIN_EXPORT_EXCEL_COLUMNS = [
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

export type AdminRowStatut = 'EN COURS' | 'VALIDÉE';

export type AdminCalcMode =
  | 'STANDARD_HORAIRE'
  | 'FORFAIT_JOUR'
  | 'CAISSE'
  | 'HEURE_TTT';

export type AdminRemunerationType =
  | 'STANDARD'
  | 'RECOLTE_CERISE'
  | 'RECOLTE_RONDE'
  | 'TTT_D3'
  | 'EBOURGEONNAGE_D5'
  | 'CONFIGURED'
  | 'TARIF_INCONNU';

export interface AdminRemunerationExcelRow {
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
  uniteMetrique: string;
  quantiteMetrique: number | '';
  quantite: number | '';
  heureDeb: string;
  heureFin: string;
  dureeRep: number | '';
  periodeJo: string;
  statut: AdminRowStatut;
  equipeId: string;
  tarifExcep: number | '';
  remuneration: number | '';
}

export interface AdminRowValidation {
  rowKey: string;
  statut: AdminRowStatut;
  calcMode: AdminCalcMode;
  tarifExcep: number | null;
  heureDeb?: string;
  heureFin?: string;
  dureeRep?: number | '';
  heures?: number | null;
  caisses?: number | null;
  uniteMetrique?: string;
  validatedAt?: string;
  validatedBy?: string;
  locked?: boolean;
}

export interface SavedTaskTariffRule {
  tacheKey: string;
  calcMode: AdminCalcMode;
  tarifExcep: number;
  uniteMetrique?: string;
  updatedAt: string;
}

export interface AdminRemunerationDraftRow extends AdminRemunerationExcelRow {
  rowKey: string;
  workerKey: string;
  tacheId: string;
  numeroOuvrier: number;
  domaineId: string;
  domaineShort: string;
  autoType: AdminRemunerationType;
  calcMode: AdminCalcMode;
  classificationReason: string;
  isAutoConfirmed: boolean;
  isManuallyValidated: boolean;
  isLockedValidation: boolean;
  effectiveHours: number;
  recolteCaissesSource: number | null;
  recolteEntriesCount: number;
  affectationsCount: number;
  pointageHeure: string;
  blockingErrors: string[];
  pendingWarnings: string[];
}

export interface AdminWorkerTotal {
  workerKey: string;
  ouvrierId: string;
  numeroOuvrier: number;
  nomOuvrier: string;
  validatedRowsCount: number;
  pendingRowsCount: number;
  totalValidatedDH: number;
}

export interface AdminDomaineTotal {
  DT: string;
  domaineShort: string;
  domaineId: string;
  validatedRowsCount: number;
  pendingRowsCount: number;
  ouvriersValidatedCount: number;
  totalValidatedDH: number;
}

export interface AdminValidationIssue {
  rowKey: string;
  ouvrierId: string;
  nomOuvrier: string;
  DT: string;
  tache: string;
  severity: 'error' | 'warning';
  messages: string[];
}

export interface AdminPreExportChecks {
  dateValid: boolean;
  hasRows: boolean;
  hasDuplicates: boolean;
  missingTasksCount: number;
  enCoursCount: number;
  valideeCount: number;
  totalsMatchValidated: boolean;
  blockingIssues: AdminValidationIssue[];
  pendingIssues: AdminValidationIssue[];
}

export interface AdminRemunerationPreviewResult {
  rows: AdminRemunerationDraftRow[];
  enCoursRows: AdminRemunerationDraftRow[];
  valideeRows: AdminRemunerationDraftRow[];
  totalByWorker: AdminWorkerTotal[];
  totalByDomaine: AdminDomaineTotal[];
  grandTotalValidatedDH: number;
  totalOuvriersDistincts: number;
  totalOuvriersValidated: number;
  checks: AdminPreExportChecks;
  canExport: boolean;
}

export function isAdminExportAuthorized(
  user?: Pick<UserAccount, 'role' | 'module_attribue' | 'actif'> | null
): boolean {
  if (!user) return false;
  if (user.actif === false) return false;
  if (user.module_attribue === 'contractuelles') return false;
  return user.role === 'admin';
}

export function roundAdminAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100000) / 100000;
}

export function normalizeTextNoAccent(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeAdminDomaineShort(
  domaineNom?: string | null,
  domaineId?: string | null
): string {
  const raw = (domaineNom || '').trim().toUpperCase();
  if (raw) {
    const m = raw.match(/^(?:DOMAINE\s*|DT?\s*)0*(\d+)$/i);
    if (m) return `D${parseInt(m[1], 10)}`;
    if (/^D0*\d+$/.test(raw)) return `D${parseInt(raw.replace(/^D/, ''), 10)}`;
  }
  if (domaineId) {
    const cleanId = domaineId.trim().toLowerCase();
    const mId = cleanId.match(/^(?:dom_)?d0*(\d+)$/);
    if (mId) return `D${parseInt(mId[1], 10)}`;
  }
  return '';
}

export function formatAdminDomaineDT(
  domaineNom?: string | null,
  domaineId?: string | null
): string {
  const shortCode = normalizeAdminDomaineShort(domaineNom, domaineId);
  if (!shortCode) return '';
  const m = shortCode.match(/^D(\d+)$/);
  if (m) return `D${String(parseInt(m[1], 10)).padStart(3, '0')}`;
  return shortCode;
}

export function isUuidOrTechnicalId(val?: string | null): boolean {
  const s = String(val || '').trim();
  if (!s) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return true;
  }
  if (/^(?:ouv|ptg|aff|usr|rec|dom|serre|tch|cie)_[a-z0-9_-]+$/i.test(s)) {
    return true;
  }
  return false;
}

export function extractBusinessWorkerNumber(raw?: unknown): number {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }
  const s = String(raw ?? '').trim();
  if (!s || isUuidOrTechnicalId(s)) return 0;
  const directDigits = s.match(/^0*(\d+)$/);
  if (directDigits) {
    const n = parseInt(directDigits[1], 10);
    return n > 0 ? n : 0;
  }
  const codeMatch = s.match(/^0*(\d+)-D0*\d+$/i);
  if (codeMatch) {
    const n = parseInt(codeMatch[1], 10);
    return n > 0 ? n : 0;
  }
  return 0;
}

export function formatAdminOuvrierId(
  numeroOuvrier: number | string,
  domaineShort: string
): string {
  const num = extractBusinessWorkerNumber(numeroOuvrier);
  if (num <= 0) return '';
  const domClean = (domaineShort || '').trim().toUpperCase();
  return domClean ? `${num}-${domClean}` : String(num);
}

export function parseSerreInfo(rawValue?: string | null): {
  embeddedDT: string | null;
  serreNum: number | null;
} {
  const clean = (rawValue || '').trim();
  if (!clean) return { embeddedDT: null, serreNum: null };

  const fullMatch = clean.match(/^DT?0*(\d+)\s*[-_\s]*S(?:ERRE)?\s*[-_\s]*0*(\d+)$/i);
  if (fullMatch) {
    return {
      embeddedDT: `D${String(parseInt(fullMatch[1], 10)).padStart(3, '0')}`,
      serreNum: parseInt(fullMatch[2], 10),
    };
  }

  const techDomMatch = clean.match(/^serre_d0*(\d+)_0*(\d+)$/i);
  if (techDomMatch) {
    return {
      embeddedDT: `D${String(parseInt(techDomMatch[1], 10)).padStart(3, '0')}`,
      serreNum: parseInt(techDomMatch[2], 10),
    };
  }

  const simpleMatch = clean.match(/^(?:SERRE[\s_-]*|S)0*(\d+)$/i);
  if (simpleMatch) {
    return {
      embeddedDT: null,
      serreNum: parseInt(simpleMatch[1], 10),
    };
  }

  if (/^\d+$/.test(clean)) {
    return {
      embeddedDT: null,
      serreNum: parseInt(clean, 10),
    };
  }

  return { embeddedDT: null, serreNum: null };
}

export function getExpectedDTBySerreNum(serreNum: number): string | null {
  if (!Number.isFinite(serreNum) || serreNum <= 0) return null;
  if (serreNum >= 1 && serreNum <= 15) return 'D002';
  if (serreNum >= 16 && serreNum <= 22) return 'D003';
  if (serreNum >= 23 && serreNum <= 42) return 'D005';
  return null;
}

function isPlaceholderUnassignedSerre(val?: string | null): boolean {
  const n = normalizeTextNoAccent(val);
  return (
    !n ||
    n === 'non affectee' ||
    n === 'aucune' ||
    n === 'aucune serre' ||
    n === 'toutes les serres' ||
    n === '-' ||
    n === '—'
  );
}

export function getAdminSerreDomainePrefix(dtCode: string): string {
  const upper = (dtCode || '').trim().toUpperCase();
  if (upper === 'D002' || upper === 'D2') return 'D002';
  const m = upper.match(/^D0*(\d+)$/);
  if (m) return `D${parseInt(m[1], 10)}`;
  return upper;
}

export function formatSingleAdminSerreCode(params: {
  rawSerre?: string | null;
  serreObj?: Serre | null;
  rowDT: string;
}): { code: string; mismatchError: string | null } {
  const { rawSerre, serreObj, rowDT } = params;
  if (!serreObj && isPlaceholderUnassignedSerre(rawSerre)) {
    return { code: '', mismatchError: null };
  }

  const fromRaw = parseSerreInfo(rawSerre);
  const fromCode = parseSerreInfo(serreObj?.code);
  const fromNom = parseSerreInfo(serreObj?.nom);
  const fromId = parseSerreInfo(serreObj?.id);

  const serreNum =
    fromRaw.serreNum ??
    fromCode.serreNum ??
    fromNom.serreNum ??
    fromId.serreNum ??
    (serreObj?.ordre && serreObj.ordre > 0 ? serreObj.ordre : null);

  const serreObjDT = serreObj?.domaine_id ? formatAdminDomaineDT(null, serreObj.domaine_id) : null;
  const embeddedDT = fromRaw.embeddedDT ?? fromCode.embeddedDT ?? fromId.embeddedDT ?? null;
  const rangeDT = serreNum !== null ? getExpectedDTBySerreNum(serreNum) : null;
  const authoritativeDT = serreObjDT || embeddedDT || rangeDT || rowDT || '';
  const serrePrefix = getAdminSerreDomainePrefix(authoritativeDT);

  let code = '';
  if (serreNum !== null && serrePrefix) {
    code = `${serrePrefix}S${serreNum}`;
  } else if (serreObj && (serreObj.code || serreObj.nom)) {
    const rawClean = (serreObj.code || serreObj.nom || '').trim().toUpperCase();
    if (!rawClean || isUuidOrTechnicalId(rawClean)) {
      return {
        code: '',
        mismatchError: `Identifiant de serre invalide (${serreObj.id}) : code métier manquant.`,
      };
    }
    const stripped = rawClean.replace(/^DT?0*\d+\s*[-_]?\s*/i, '').replace(/^S(?=[A-Z0-9])/i, '');
    code = serrePrefix ? `${serrePrefix}S${stripped}` : rawClean;
  } else {
    const rawClean = (rawSerre || '').trim();
    if (!rawClean) return { code: '', mismatchError: null };
    return {
      code: '',
      mismatchError: `Serre introuvable dans le référentiel (${rawClean}) : aucun identifiant ne doit être fabriqué.`,
    };
  }

  let mismatchError: string | null = null;
  if (rowDT && authoritativeDT && rowDT !== authoritativeDT) {
    mismatchError = `Serre ${code} appartient au domaine ${authoritativeDT} et non au domaine ${rowDT}.`;
  }

  return { code, mismatchError };
}

export function parseAdminTimeToHours(hhmm?: string | null): number | null {
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

export function resolveAdminDureeRep(
  heureDeb: string,
  heureFin: string,
  explicitDureeRep?: number | ''
): number | '' {
  if (explicitDureeRep !== undefined && explicitDureeRep !== '' && Number.isFinite(Number(explicitDureeRep))) {
    return Math.max(0, Number(explicitDureeRep));
  }
  const deb = heureDeb.trim();
  const fin = heureFin.trim();
  if (!deb || !fin) return '';
  if (deb === '07:00' && fin === '14:00') return 0;
  if (deb === '07:00' && fin === '16:00') return 1;
  const debH = parseAdminTimeToHours(deb);
  const finH = parseAdminTimeToHours(fin);
  if (debH !== null && finH !== null) {
    const span = finH >= debH ? finH - debH : 24 - debH + finH;
    return span >= 8 ? 1 : 0;
  }
  return '';
}

export function computeAdminEffectiveHours(
  heureDeb: string,
  heureFin: string,
  dureeRep: number | ''
): number {
  const deb = parseAdminTimeToHours(heureDeb);
  const fin = parseAdminTimeToHours(heureFin);
  if (deb === null || fin === null) return 0;
  const brut = fin >= deb ? fin - deb : 24 - deb + fin;
  const pause = dureeRep === '' ? 0 : Math.max(0, Number(dureeRep) || 0);
  return Math.max(0, roundAdminAmount(brut - pause));
}

export function computeAdminHeureFinFromHours(
  heureDeb: string,
  effectiveHours: number,
  dureeRep: number | ''
): string {
  const deb = parseAdminTimeToHours(heureDeb);
  if (deb === null || !Number.isFinite(effectiveHours) || effectiveHours <= 0) return '';
  const pause = dureeRep === '' ? 0 : Math.max(0, Number(dureeRep) || 0);
  const totalMinutes = Math.round((deb + effectiveHours + pause) * 60) % (24 * 60);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function extractConfiguredTaskRate(tache?: Tache | null): {
  rate: number | null;
  mode: AdminCalcMode | null;
} {
  if (!tache) return { rate: null, mode: null };
  const anyT = tache as any;
  const rawRate =
    anyT.tarif_unitaire ??
    anyT.prix_unitaire ??
    anyT.tarif ??
    anyT.tarif_jour;
  const num = rawRate !== undefined && rawRate !== null && rawRate !== '' ? Number(rawRate) : NaN;
  if (!Number.isFinite(num) || num <= 0) {
    return { rate: null, mode: null };
  }
  const rawMode = String(anyT.mode_remuneration || '').toUpperCase();
  let mode: AdminCalcMode = 'FORFAIT_JOUR';
  if (rawMode === 'HEURE' || rawMode === 'HORAIRE' || rawMode === 'STANDARD_HORAIRE') {
    mode = 'STANDARD_HORAIRE';
  } else if (rawMode === 'CAISSE' || rawMode === 'UNITE') {
    mode = 'CAISSE';
  } else if (rawMode === 'HEURE_TTT') {
    mode = 'HEURE_TTT';
  }
  return { rate: num, mode };
}

/**
 * Identifie strictement si une tâche possède un tarif confirmé ou inconnu.
 * RÈGLE CRITIQUE :
 * Ne jamais appliquer 95 DH aveuglément à des tâches sans règle confirmée.
 * Toute tâche sans tarif confirmé passe en statut EN COURS avec tarifExcep = '' et remuneration = ''.
 */
export function classifyAdminTaskRule(params: {
  tache?: Tache | null;
  domaineShort: string;
  recolteNotes?: string;
  hasRecolteEntries?: boolean;
  savedTaskTariff?: SavedTaskTariffRule | null;
}): {
  type: AdminRemunerationType;
  calcMode: AdminCalcMode;
  confirmedTarif: number | null;
  isConfirmed: boolean;
  defaultUniteMetrique: string;
  reason: string;
} {
  const {
    tache,
    domaineShort,
    recolteNotes = '',
    hasRecolteEntries = false,
    savedTaskTariff = null,
  } = params;

  const nomNorm = normalizeTextNoAccent(tache?.nom);
  const codeNorm = normalizeTextNoAccent(tache?.code);
  const notesNorm = normalizeTextNoAccent(recolteNotes);
  const fullTask = `${nomNorm} ${codeNorm}`.trim();

  // 1. Tâche explicitement configurée sur l'objet Tache ou dans le catalogue validé par l'Admin
  const explicit = extractConfiguredTaskRate(tache);
  if (explicit.rate !== null) {
    return {
      type: 'CONFIGURED',
      calcMode: explicit.mode || 'FORFAIT_JOUR',
      confirmedTarif: explicit.rate,
      isConfirmed: true,
      defaultUniteMetrique: explicit.mode === 'CAISSE' ? 'PLATEAUX' : explicit.mode === 'HEURE_TTT' ? 'HEURE' : '',
      reason: `Tarif configuré sur la tâche : ${explicit.rate} DH.`,
    };
  }

  if (savedTaskTariff && savedTaskTariff.tarifExcep > 0) {
    return {
      type: 'CONFIGURED',
      calcMode: savedTaskTariff.calcMode,
      confirmedTarif: savedTaskTariff.tarifExcep,
      isConfirmed: true,
      defaultUniteMetrique: savedTaskTariff.uniteMetrique || '',
      reason: `Tarif confirmé par l’administrateur pour cette tâche : ${savedTaskTariff.tarifExcep} DH.`,
    };
  }

  // 2. Aucune tâche associée -> toujours EN COURS (ne rien inventer)
  if (!tache || !nomNorm || nomNorm === 'sans tache') {
    if (hasRecolteEntries && notesNorm.includes('cerise')) {
      return {
        type: 'RECOLTE_CERISE',
        calcMode: 'CAISSE',
        confirmedTarif: ADMIN_TARIF_RECOLTE_CERISE,
        isConfirmed: false, // Tâche absente : nécessite confirmation Admin
        defaultUniteMetrique: 'PLATEAUX',
        reason: 'Caisses Cerise détectées sans tâche affectée : validation administrateur requise.',
      };
    }
    return {
      type: 'TARIF_INCONNU',
      calcMode: 'FORFAIT_JOUR',
      confirmedTarif: null,
      isConfirmed: false,
      defaultUniteMetrique: '',
      reason: 'Aucune tâche affectée au Pointage Matin : tarif inconnu (EN COURS).',
    };
  }

  // 3. ÉBOURGEONNAGE D5 -> forfait confirmé 150 DH uniquement sur D5, unite = '1'
  const isEbourgeonnage = fullTask.includes('ebourgeon') || fullTask.includes('bourgeon');
  if (isEbourgeonnage && domaineShort === 'D5') {
    return {
      type: 'EBOURGEONNAGE_D5',
      calcMode: 'FORFAIT_JOUR',
      confirmedTarif: ADMIN_TARIF_EBOURGEONNAGE_D5,
      isConfirmed: true,
      defaultUniteMetrique: '1',
      reason: 'Ébourgeonnage D5 : forfait confirmé 150 DH, uniteMetrique = 1.',
    };
  }

  // 4. RÉCOLTE (Cerise = 3,8 DH/caisse ; Ronde = 1,1875 DH/caisse)
  const isRecolteTask =
    fullTask.includes('recolte') ||
    fullTask.includes('cueillette') ||
    /^r0*\d+$/i.test(codeNorm);

  if (isRecolteTask) {
    if (fullTask.includes('cerise') || notesNorm.includes('cerise')) {
      return {
        type: 'RECOLTE_CERISE',
        calcMode: 'CAISSE',
        confirmedTarif: ADMIN_TARIF_RECOLTE_CERISE,
        isConfirmed: true,
        defaultUniteMetrique: 'PLATEAUX',
        reason: 'Récolte Cerise : tarif confirmé 3,8 DH / caisse.',
      };
    }
    if (fullTask.includes('ronde') || notesNorm.includes('ronde')) {
      return {
        type: 'RECOLTE_RONDE',
        calcMode: 'CAISSE',
        confirmedTarif: ADMIN_TARIF_RECOLTE_RONDE,
        isConfirmed: true,
        defaultUniteMetrique: 'PLATEAUX',
        reason: 'Récolte Ronde : tarif confirmé 1,1875 DH / caisse.',
      };
    }
    // Récolte générique sans variété précisée -> EN COURS pour choix explicite Cerise / Ronde / tarif
    return {
      type: 'TARIF_INCONNU',
      calcMode: 'CAISSE',
      confirmedTarif: null,
      isConfirmed: false,
      defaultUniteMetrique: 'PLATEAUX',
      reason: 'Récolte sans variété confirmée (Cerise 3,8 DH ou Ronde 1,1875 DH) : validation requise.',
    };
  }

  // 5. TTT / TRAITEMENT
  // - D3 : 16 DH / heure avec heures réelles valides
  // - D2 : TRAITEMENT PHYTO D2 = 105 DH
  // - Autres domaines (D1, D4, D5) : NE PAS appliquer 105 DH -> EN COURS
  const isTraitementTask =
    /\bttt\b/.test(fullTask) ||
    fullTask.includes('traitement') ||
    fullTask.includes('phyto') ||
    fullTask.includes('phytosanitaire') ||
    fullTask.includes('pulverisation') ||
    fullTask.includes('sulfatage') ||
    /^phy/i.test(codeNorm);

  if (isTraitementTask) {
    if (domaineShort === 'D3') {
      return {
        type: 'TTT_D3',
        calcMode: 'HEURE_TTT',
        confirmedTarif: ADMIN_TARIF_TTT_D3_HEURE,
        isConfirmed: true,
        defaultUniteMetrique: 'HEURE',
        reason: 'TTT D3 : tarif confirmé 16 DH / heure (nécessite heures réelles).',
      };
    }
    if (domaineShort === 'D2') {
      return {
        type: 'CONFIGURED',
        calcMode: 'FORFAIT_JOUR',
        confirmedTarif: ADMIN_TARIF_TRAITEMENT_PHYTO_JOUR,
        isConfirmed: true,
        defaultUniteMetrique: '',
        reason: 'Traitement Phyto D2 : tarif confirmé 105 DH.',
      };
    }
    return {
      type: 'TARIF_INCONNU',
      calcMode: 'FORFAIT_JOUR',
      confirmedTarif: null,
      isConfirmed: false,
      defaultUniteMetrique: '',
      reason: `Traitement Phyto sur ${domaineShort || 'autre domaine'} : le tarif 105 DH s’applique uniquement à D2 (EN COURS).`,
    };
  }

  // 6. STATIONNAIRE : tarif officiel confirmé 100 DH
  if (fullTask.includes('stationnaire') || fullTask.includes('station') || codeNorm === 'sta01') {
    return {
      type: 'CONFIGURED',
      calcMode: 'FORFAIT_JOUR',
      confirmedTarif: ADMIN_TARIF_STATIONNAIRE_JOUR,
      isConfirmed: true,
      defaultUniteMetrique: '',
      reason: 'Stationnaire : tarif confirmé 100 DH.',
    };
  }

  // 7. INSTABLE / STANDARD explicite : 11,875 DH/h (8h = 95 DH pour 07:00-16:00, 7h = 83,125 DH pour 07:00-14:00)
  if (
    fullTask.includes('instable') ||
    fullTask.includes('standard') ||
    codeNorm === 'ins01'
  ) {
    return {
      type: 'STANDARD',
      calcMode: 'STANDARD_HORAIRE',
      confirmedTarif: ADMIN_TARIF_STANDARD_HEURE,
      isConfirmed: true,
      defaultUniteMetrique: '',
      reason: 'Standard / Instable : tarif horaire confirmé 11,875 DH/h.',
    };
  }

  // 8. Toute autre tâche sans tarif configuré ni confirmé -> EN COURS (JAMAIS 95 DH par défaut !)
  return {
    type: 'TARIF_INCONNU',
    calcMode: 'STANDARD_HORAIRE',
    confirmedTarif: null,
    isConfirmed: false,
    defaultUniteMetrique: '',
    reason: `Tarif inconnu ou non confirmé pour "${tache.nom}" : validation administrateur requise (EN COURS).`,
  };
}

interface ResolvedSerreToken {
  raw: string;
  serreObj?: Serre | null;
}

function resolveSerreTokens(
  serreIdRaw: string | null | undefined,
  serreNomRaw: string | null | undefined,
  serresIdsArr: string[] | undefined,
  serresNomsArr: string[] | undefined,
  serreById: Map<string, Serre>,
  serreByCodeOrName: Map<string, Serre>
): ResolvedSerreToken[] {
  const tokens: ResolvedSerreToken[] = [];
  const seen = new Set<string>();

  const pushToken = (rawVal?: string | null, explicitObj?: Serre) => {
    if (!explicitObj && isPlaceholderUnassignedSerre(rawVal)) return;
    const clean = (rawVal || '').trim();
    const matchedObj =
      explicitObj ||
      serreById.get(clean) ||
      serreByCodeOrName.get(clean.toUpperCase());
    const key = matchedObj?.id || clean.toUpperCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    tokens.push({
      raw: clean || matchedObj?.nom || matchedObj?.code || '',
      serreObj: matchedObj || null,
    });
  };

  const idsList =
    Array.isArray(serresIdsArr) && serresIdsArr.length > 0
      ? serresIdsArr
      : (serreIdRaw || '')
          .split(/[,+]+/)
          .map((s) => s.trim())
          .filter((s) => !isPlaceholderUnassignedSerre(s));

  idsList.forEach((id, idx) => {
    const sObj = serreById.get(id) || serreByCodeOrName.get(id.toUpperCase());
    if (!sObj && isUuidOrTechnicalId(id)) {
      const fallbackNom =
        (Array.isArray(serresNomsArr) && serresNomsArr[idx]) ||
        (idsList.length === 1 && serreNomRaw && !serreNomRaw.includes(',') && !serreNomRaw.includes('+')
          ? serreNomRaw
          : null);
      if (fallbackNom && !isPlaceholderUnassignedSerre(fallbackNom) && !isUuidOrTechnicalId(fallbackNom)) {
        pushToken(fallbackNom);
        return;
      }
    }
    pushToken(sObj?.nom || sObj?.code || id, sObj);
  });

  if (tokens.length === 0 && Array.isArray(serresNomsArr)) {
    serresNomsArr.forEach((nom) => pushToken(nom));
  }

  if (tokens.length === 0 && serreNomRaw && !isPlaceholderUnassignedSerre(serreNomRaw)) {
    serreNomRaw
      .split(/[,+]+/)
      .map((s) => s.trim())
      .forEach((nom) => pushToken(nom));
  }

  return tokens;
}

export interface BuildAdminExportRemunerationParams {
  dateIso: string;
  domaineFilter?: string; // 'ALL' | 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | domaine id
  ouvriers: Ouvrier[];
  taches: Tache[];
  domaines: Domaine[];
  serres: Serre[];
  pointages: Pointage[];
  affectations: AffectationTache[];
  recoltes: RecolteEntry[];
  tacheSerresConfigs?: TacheSerreConfig[];
  defaultDomaineId?: string;
  validations?: Record<string, AdminRowValidation>;
  taskTariffCatalog?: Record<string, SavedTaskTariffRule>;
}

/**
 * Construit en lecture seule les lignes EXPORT RÉMUNÉRATION à partir de POINTAGE MATIN.
 * - Chaque association réelle ouvrier + tâche + domaine génère une ligne distincte.
 * - Tarif confirmé (et quantité/heures réelles connues) -> statut = VALIDÉE.
 * - Tarif inconnu/non confirmé ou variable manquante -> statut = EN COURS, tarifExcep = '', remuneration = ''.
 * - Aucun tarif validé n'est modifié silencieusement.
 */
export function buildAdminExportRemunerationRows(
  params: BuildAdminExportRemunerationParams
): AdminRemunerationPreviewResult {
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
    validations = {},
    taskTariffCatalog = {},
  } = params;

  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || '').trim());

  const ouvrierById = new Map<string, Ouvrier>();
  const ouvrierByNum = new Map<number, Ouvrier>();
  ouvriers.forEach((o) => {
    if (o?.id) ouvrierById.set(o.id, o);
    if (o?.numero && Number(o.numero) > 0) ouvrierByNum.set(Number(o.numero), o);
  });

  const tacheById = new Map<string, Tache>(taches.filter(Boolean).map((t) => [t.id, t]));
  const domaineById = new Map<string, Domaine>(domaines.filter(Boolean).map((d) => [d.id, d]));
  const serreById = new Map<string, Serre>(serres.filter(Boolean).map((s) => [s.id, s]));
  const serreByCodeOrName = new Map<string, Serre>();
  serres.forEach((s) => {
    if (!s) return;
    if (s.code) serreByCodeOrName.set(s.code.trim().toUpperCase(), s);
    if (s.nom) serreByCodeOrName.set(s.nom.trim().toUpperCase(), s);
  });

  const taskConfigMap = new Map<string, TacheSerreConfig>();
  tacheSerresConfigs
    .filter((c) => c && c.date === dateIso)
    .forEach((c) => taskConfigMap.set(c.tache_id, c));

  // Uniquement les ouvriers réellement présents à dateIso dans POINTAGE MATIN (absents exclus)
  const presentPointagesByWorker = new Map<string, Pointage>();
  pointages
    .filter((p) => p && p.date === dateIso && p.present !== false)
    .forEach((p) => {
      const key = p.ouvrier_id ? `id:${p.ouvrier_id}` : `num:${p.numero_ouvrier}`;
      const existing = presentPointagesByWorker.get(key);
      if (!existing || Number(p.timestamp || 0) >= Number(existing.timestamp || 0)) {
        presentPointagesByWorker.set(key, p);
      }
    });

  const dayAffectations = affectations.filter((a) => a && a.date === dateIso);
  const dayRecoltes = recoltes.filter(
    (r) => r && r.date === dateIso && (!r.type_operation || r.type_operation === 'RECOLTE')
  );

  interface GroupedWork {
    groupKey: string;
    workerKey: string;
    tacheId: string;
    numeroOuvrier: number;
    nomOuvrier: string;
    domaineId: string;
    domaineShort: string;
    dtCode: string;
    tacheObj: Tache | null;
    tacheTypeId: string;
    tacheNom: string;
    serreCodesSet: Set<string>;
    serreCodesOrder: string[];
    serreMismatchErrors: Set<string>;
    cultureSet: Set<string>;
    equipeSet: Set<string>;
    recolteNotes: string[];
    recolteCaisses: number;
    recolteEntriesCount: number;
    affectationsCount: number;
    hasRecolteEntriesForWorker: boolean;
    pointageHeure: string;
    explicitHeureDeb?: string;
    explicitHeureFin?: string;
    explicitDureeRep?: number | '';
    explicitQuantite?: number | '';
    explicitUnite?: string;
    explicitPeriodeJo?: string;
  }

  const groupsMap = new Map<string, GroupedWork>();

  const resolveDomaine = (domId?: string | null) => {
    const id = domId || defaultDomaineId;
    const domObj = id ? domaineById.get(id) : undefined;
    const domShort = normalizeAdminDomaineShort(domObj?.nom || domId, id) || 'D2';
    const dtCode = formatAdminDomaineDT(domObj?.nom || domId, id) || 'D002';
    return {
      domaineId: domObj?.id || id || 'dom_d2',
      domaineShort: domShort,
      dtCode,
    };
  };

  const attachSerreToken = (grp: GroupedWork, tok: ResolvedSerreToken) => {
    const formatted = formatSingleAdminSerreCode({
      rawSerre: tok.raw,
      serreObj: tok.serreObj,
      rowDT: grp.dtCode,
    });
    if (formatted.mismatchError) {
      grp.serreMismatchErrors.add(formatted.mismatchError);
    }
    if (!formatted.code) return;
    const key = formatted.code.toUpperCase();
    if (!grp.serreCodesSet.has(key)) {
      grp.serreCodesSet.add(key);
      grp.serreCodesOrder.push(formatted.code);
    }
  };

  presentPointagesByWorker.forEach((ptg) => {
    const resolvedOuvrier =
      (ptg.ouvrier_id ? ouvrierById.get(ptg.ouvrier_id) : undefined) ||
      (ptg.numero_ouvrier ? ouvrierByNum.get(Number(ptg.numero_ouvrier)) : undefined);

    const anyResolved = resolvedOuvrier as any;
    const anyPtgMeta = ptg as any;
    const numeroOuvrier =
      extractBusinessWorkerNumber(resolvedOuvrier?.numero) ||
      extractBusinessWorkerNumber(ptg.numero_ouvrier) ||
      extractBusinessWorkerNumber(anyResolved?.matricule) ||
      extractBusinessWorkerNumber(anyResolved?.code) ||
      extractBusinessWorkerNumber(anyPtgMeta?.matricule);

    const nomOuvrier =
      resolvedOuvrier?.nom?.trim() ||
      anyPtgMeta.nom_ouvrier?.trim() ||
      (numeroOuvrier > 0 ? `Ouvrier #${numeroOuvrier}` : '');

    const workerKey =
      numeroOuvrier > 0
        ? `num_${numeroOuvrier}`
        : resolvedOuvrier?.id || ptg.ouvrier_id || `ptg_${ptg.id}`;

    const workerAffs = dayAffectations.filter(
      (a) =>
        (numeroOuvrier > 0 && Number(a.numero_ouvrier) === numeroOuvrier) ||
        (ptg.ouvrier_id && a.ouvrier_id === ptg.ouvrier_id) ||
        (resolvedOuvrier?.id && a.ouvrier_id === resolvedOuvrier.id)
    );

    const workerRecoltes = dayRecoltes.filter(
      (r) =>
        (numeroOuvrier > 0 && Number(r.numero_ouvrier) === numeroOuvrier) ||
        (ptg.ouvrier_id && r.ouvrier_id === ptg.ouvrier_id) ||
        (resolvedOuvrier?.id && r.ouvrier_id === resolvedOuvrier.id)
    );

    interface WorkSourceItem {
      tacheObj: Tache | null;
      domaineId: string;
      serreTokens: ResolvedSerreToken[];
      cultureId: string;
      equipeId: string;
      fromAff: boolean;
      heureDeb?: string;
      heureFin?: string;
      dureeRep?: number | '';
      quantite?: number | '';
      unite?: string;
      periodeJo?: string;
    }

    const workItems: WorkSourceItem[] = [];

    if (workerAffs.length > 0) {
      workerAffs.forEach((aff) => {
        const tObj = aff.tache_id ? tacheById.get(aff.tache_id) || null : null;
        const domId = aff.domaine_id || ptg.domaine_id || defaultDomaineId;
        let serresResolved = resolveSerreTokens(
          aff.serre_id,
          aff.serre_nom,
          aff.serres_ids,
          aff.serres_noms,
          serreById,
          serreByCodeOrName
        );
        if (serresResolved.length === 0 && aff.tache_id) {
          const cfg = taskConfigMap.get(aff.tache_id);
          if (cfg && (!cfg.domaine_id || cfg.domaine_id === domId)) {
            serresResolved = resolveSerreTokens(
              null,
              null,
              cfg.serre_ids,
              cfg.serre_noms,
              serreById,
              serreByCodeOrName
            );
          }
        }
        const anyAff = aff as any;
        workItems.push({
          tacheObj: tObj,
          domaineId: domId,
          serreTokens: serresResolved,
          cultureId: String(anyAff.culture_id || anyAff.culture || '').trim(),
          equipeId: String(anyAff.equipe_id || '').trim(),
          fromAff: true,
          heureDeb: anyAff.heure_debut || anyAff.heureDeb,
          heureFin: anyAff.heure_fin || anyAff.heureFin,
          dureeRep:
            anyAff.dureeRep !== undefined && anyAff.dureeRep !== ''
              ? Number(anyAff.dureeRep)
              : undefined,
          quantite:
            anyAff.quantite !== undefined && anyAff.quantite !== '' && anyAff.quantite !== null
              ? Number(anyAff.quantite)
              : undefined,
          unite: anyAff.unite ? String(anyAff.unite).trim() : undefined,
          periodeJo: anyAff.periodeJo ? String(anyAff.periodeJo).trim() : undefined,
        });
      });
    } else {
      const tObj = ptg.tache_id ? tacheById.get(ptg.tache_id) || null : null;
      const domId = ptg.domaine_id || defaultDomaineId;
      let serresResolved = resolveSerreTokens(
        ptg.serre_id,
        ptg.serre_nom,
        undefined,
        undefined,
        serreById,
        serreByCodeOrName
      );
      if (serresResolved.length === 0 && ptg.tache_id) {
        const cfg = taskConfigMap.get(ptg.tache_id);
        if (cfg && (!cfg.domaine_id || cfg.domaine_id === domId)) {
          serresResolved = resolveSerreTokens(
            null,
            null,
            cfg.serre_ids,
            cfg.serre_noms,
            serreById,
            serreByCodeOrName
          );
        }
      }
      const anyPtg = ptg as any;
      workItems.push({
        tacheObj: tObj,
        domaineId: domId,
        serreTokens: serresResolved,
        cultureId: String(anyPtg.culture_id || anyPtg.culture || '').trim(),
        equipeId: String(anyPtg.equipe_id || '').trim(),
        fromAff: false,
        heureDeb: anyPtg.heure_debut || anyPtg.heureDeb,
        heureFin: anyPtg.heure_fin || anyPtg.heureFin,
        dureeRep:
          anyPtg.dureeRep !== undefined && anyPtg.dureeRep !== ''
            ? Number(anyPtg.dureeRep)
            : undefined,
        quantite:
          anyPtg.quantite !== undefined && anyPtg.quantite !== '' && anyPtg.quantite !== null
            ? Number(anyPtg.quantite)
            : undefined,
        unite: anyPtg.unite ? String(anyPtg.unite).trim() : undefined,
        periodeJo: anyPtg.periodeJo ? String(anyPtg.periodeJo).trim() : undefined,
      });
    }

    workItems.forEach((item) => {
      const dom = resolveDomaine(item.domaineId);
      const tacheTypeId = item.tacheObj?.code?.trim() || '';
      const tacheNom = item.tacheObj?.nom?.trim() || '';
      const tacheId = item.tacheObj?.id || '';
      const tacheKey = tacheId || tacheNom || 'SANS_TACHE';
      const groupKey = `${dateIso}__${workerKey}__${dom.dtCode}__${tacheKey}`;

      let grp = groupsMap.get(groupKey);
      if (!grp) {
        grp = {
          groupKey,
          workerKey,
          tacheId,
          numeroOuvrier,
          nomOuvrier,
          domaineId: dom.domaineId,
          domaineShort: dom.domaineShort,
          dtCode: dom.dtCode,
          tacheObj: item.tacheObj,
          tacheTypeId,
          tacheNom,
          serreCodesSet: new Set<string>(),
          serreCodesOrder: [],
          serreMismatchErrors: new Set<string>(),
          cultureSet: new Set<string>(),
          equipeSet: new Set<string>(),
          recolteNotes: [],
          recolteCaisses: 0,
          recolteEntriesCount: 0,
          affectationsCount: 0,
          hasRecolteEntriesForWorker: workerRecoltes.length > 0,
          pointageHeure: ptg.heure || '',
          explicitHeureDeb: item.heureDeb,
          explicitHeureFin: item.heureFin,
          explicitDureeRep: item.dureeRep,
          explicitQuantite: item.quantite,
          explicitUnite: item.unite,
          explicitPeriodeJo: item.periodeJo,
        };
        groupsMap.set(groupKey, grp);
      }

      if (item.fromAff) grp.affectationsCount += 1;
      item.serreTokens.forEach((tok) => attachSerreToken(grp!, tok));
      if (item.cultureId) grp.cultureSet.add(item.cultureId);
      if (item.equipeId) grp.equipeSet.add(item.equipeId);
      if (!grp.explicitHeureDeb && item.heureDeb) grp.explicitHeureDeb = item.heureDeb;
      if (!grp.explicitHeureFin && item.heureFin) grp.explicitHeureFin = item.heureFin;
      if (grp.explicitDureeRep === undefined && item.dureeRep !== undefined) grp.explicitDureeRep = item.dureeRep;
      if (grp.explicitQuantite === undefined && item.quantite !== undefined) grp.explicitQuantite = item.quantite;
    });

    // Rattacher les récoltes réelles (caisses + serres + notes Cerise/Ronde)
    if (workerRecoltes.length > 0) {
      const workerGroups = Array.from(groupsMap.values()).filter((g) => g.workerKey === workerKey);
      const recolteGroups = workerGroups.filter((g) => {
        const cls = classifyAdminTaskRule({
          tache: g.tacheObj,
          domaineShort: g.domaineShort,
          hasRecolteEntries: true,
        });
        return (
          cls.type === 'RECOLTE_CERISE' ||
          cls.type === 'RECOLTE_RONDE' ||
          normalizeTextNoAccent(g.tacheNom).includes('recolte')
        );
      });

      const attachRecolteToGroup = (targetGroup: GroupedWork, rec: RecolteEntry) => {
        targetGroup.recolteCaisses += Number(rec.caisses) || 0;
        targetGroup.recolteEntriesCount += 1;
        if (rec.notes) targetGroup.recolteNotes.push(rec.notes);
        if (rec.created_by_nom) targetGroup.equipeSet.add(rec.created_by_nom);
        const recTokens = resolveSerreTokens(
          rec.serre_id,
          rec.serre_nom,
          undefined,
          undefined,
          serreById,
          serreByCodeOrName
        );
        recTokens.forEach((tok) => attachSerreToken(targetGroup, tok));
      };

      if (recolteGroups.length > 0) {
        workerRecoltes.forEach((rec) => {
          const recDomShort = normalizeAdminDomaineShort(null, rec.domaine_id || '');
          const match = recDomShort ? recolteGroups.find((g) => g.domaineShort === recDomShort) : undefined;
          attachRecolteToGroup(match || recolteGroups[0], rec);
        });
      }
      // Ne jamais rattacher des caisses de récolte à une tâche calculée au temps ou au forfait
    }
  });

  // Filtre par domaine (Tous, D1..D5 ou domaine_id)
  const normalizedFilter =
    domaineFilter && domaineFilter !== 'ALL'
      ? normalizeAdminDomaineShort(
          domaines.find((d) => d.id === domaineFilter)?.nom || domaineFilter,
          domaineFilter
        )
      : 'ALL';

  const filteredGroups = Array.from(groupsMap.values())
    .filter((g) => normalizedFilter === 'ALL' || g.domaineShort === normalizedFilter)
    .sort((a, b) => {
      if (a.dtCode !== b.dtCode) return a.dtCode.localeCompare(b.dtCode);
      if (a.numeroOuvrier !== b.numeroOuvrier) return a.numeroOuvrier - b.numeroOuvrier;
      return a.tacheTypeId.localeCompare(b.tacheTypeId);
    });

  const rows: AdminRemunerationDraftRow[] = filteredGroups.map((g, idx) => {
    const taskCatalogKey = g.tacheId || g.tacheTypeId || g.tacheNom;
    const savedTaskTariff = taskCatalogKey ? taskTariffCatalog[taskCatalogKey] || null : null;

    const autoCls = classifyAdminTaskRule({
      tache: g.tacheObj,
      domaineShort: g.domaineShort,
      recolteNotes: g.recolteNotes.join(' '),
      hasRecolteEntries: g.hasRecolteEntriesForWorker,
      savedTaskTariff,
    });

    const val = validations[g.groupKey];
    const hasManualValidation = Boolean(val && val.statut === 'VALIDÉE' && val.tarifExcep !== null && Number(val.tarifExcep) > 0);
    const isLockedValidation = Boolean(hasManualValidation && val?.locked !== false);

    // Respecter le mode et tarif validé si verrouillé/validé par Admin, sinon règle auto
    const calcMode: AdminCalcMode = hasManualValidation
      ? val!.calcMode
      : val?.calcMode || autoCls.calcMode;

    // Heures réelles : doivent provenir uniquement du pointage ou d'une validation explicite (jamais inventées)
    const hasExplicitHours = Boolean(g.explicitHeureDeb && g.explicitHeureFin);
    let heureDeb = (val?.heureDeb ?? g.explicitHeureDeb ?? '').trim();
    let heureFin = (val?.heureFin ?? g.explicitHeureFin ?? '').trim();

    const dureeRep: number | '' = resolveAdminDureeRep(
      heureDeb,
      heureFin,
      val?.dureeRep !== undefined ? val.dureeRep : g.explicitDureeRep
    );

    let effectiveHours = computeAdminEffectiveHours(heureDeb, heureFin, dureeRep);
    if (val?.heures !== undefined && val.heures !== null && Number(val.heures) > 0) {
      effectiveHours = Math.max(0, Number(val.heures));
      if (!val.heureFin && !g.explicitHeureFin && effectiveHours > 0 && heureDeb) {
        heureFin = computeAdminHeureFinFromHours(heureDeb, effectiveHours, dureeRep === '' ? 0 : dureeRep);
      }
    }

    // Quantité réelle (uniquement pour rémunération par caisse ; vide pour rémunération au temps / forfait)
    const caissesSource: number | null =
      calcMode === 'CAISSE'
        ? val?.caisses !== undefined && val.caisses !== null
          ? Number(val.caisses)
          : g.recolteEntriesCount > 0
          ? g.recolteCaisses
          : null
        : null;

    const quantiteMetrique: number | '' =
      calcMode === 'CAISSE' && caissesSource !== null && Number.isFinite(caissesSource) && caissesSource > 0
        ? caissesSource
        : '';

    // Règle stricte : le champ quantite doit rester vide
    const quantite: number | '' = '';

    const uniteMetrique =
      calcMode === 'CAISSE'
        ? (val?.uniteMetrique !== undefined ? val.uniteMetrique : g.explicitUnite ?? autoCls.defaultUniteMetrique) || 'PLATEAUX'
        : calcMode === 'HEURE_TTT'
        ? (val?.uniteMetrique !== undefined ? val.uniteMetrique : autoCls.defaultUniteMetrique) || 'HEURE'
        : autoCls.type === 'EBOURGEONNAGE_D5'
        ? '1'
        : val?.uniteMetrique !== undefined
        ? val.uniteMetrique
        : '';

    const periodeJo =
      g.explicitPeriodeJo ||
      (heureDeb && heureFin ? 'JOURNEE' : '');

    // Détermination statut VALIDÉE vs EN COURS + calcul rémunération UNIQUEMENT si VALIDÉE
    let statut: AdminRowStatut = 'EN COURS';
    let tarifExcep: number | '' = '';
    let remuneration: number | '' = '';

    if (hasManualValidation) {
      const tVal = Number(val!.tarifExcep);
      if (calcMode === 'STANDARD_HORAIRE' || calcMode === 'HEURE_TTT') {
        if (effectiveHours > 0) {
          statut = 'VALIDÉE';
          tarifExcep = tVal;
          remuneration = roundAdminAmount(effectiveHours * tVal);
        }
      } else if (calcMode === 'CAISSE') {
        if (typeof quantiteMetrique === 'number' && quantiteMetrique > 0) {
          statut = 'VALIDÉE';
          tarifExcep = tVal;
          remuneration = roundAdminAmount(quantiteMetrique * tVal);
        }
      } else {
        // FORFAIT_JOUR
        statut = 'VALIDÉE';
        tarifExcep = tVal;
        remuneration = roundAdminAmount(tVal);
      }
    } else if (autoCls.isConfirmed && autoCls.confirmedTarif !== null && autoCls.confirmedTarif > 0) {
      // Tarif confirmé depuis la configuration réelle — vérifier que les variables requises existent réellement
      const tAuto = autoCls.confirmedTarif;
      if (calcMode === 'STANDARD_HORAIRE') {
        if (effectiveHours > 0) {
          statut = 'VALIDÉE';
          tarifExcep = tAuto;
          remuneration = roundAdminAmount(effectiveHours * tAuto);
        }
      } else if (calcMode === 'HEURE_TTT') {
        // TTT D3 exige des heures réelles (sinon reste EN COURS)
        if (effectiveHours > 0) {
          statut = 'VALIDÉE';
          tarifExcep = tAuto;
          remuneration = roundAdminAmount(effectiveHours * tAuto);
        }
      } else if (calcMode === 'CAISSE') {
        // Récolte exige des caisses réelles > 0 (sinon reste EN COURS)
        if (typeof quantiteMetrique === 'number' && quantiteMetrique > 0) {
          statut = 'VALIDÉE';
          tarifExcep = tAuto;
          remuneration = roundAdminAmount(quantiteMetrique * tAuto);
        }
      } else {
        // FORFAIT_JOUR (Stationnaire 100, Traitement Phyto hors D3 105, Ébourgeonnage D5 150, ou tarif explicite)
        statut = 'VALIDÉE';
        tarifExcep = tAuto;
        remuneration = roundAdminAmount(tAuto);
      }
    }

    // GARDE STRICTE : si EN COURS, tarifExcep et remuneration DOIVENT rester vides ('')
    if (statut === 'EN COURS') {
      tarifExcep = '';
      remuneration = '';
    }

    const ouvrierId = formatAdminOuvrierId(g.numeroOuvrier, g.domaineShort);
    const serreId =
      g.serreCodesOrder.length > 0 ? g.serreCodesOrder.join('+') : ADMIN_EXPORT_ALL_SERRES_LABEL;

    // Contrôles structurels bloquants vs avertissements EN COURS
    const blockingErrors: string[] = [];
    const pendingWarnings: string[] = [];

    if (!dateValid) {
      blockingErrors.push('Date sélectionnée invalide (format attendu AAAA-MM-JJ).');
    }
    if (
      !g.numeroOuvrier ||
      g.numeroOuvrier <= 0 ||
      !ouvrierId ||
      isUuidOrTechnicalId(ouvrierId) ||
      !/^\d+-D\d+$/i.test(ouvrierId)
    ) {
      blockingErrors.push(
        'Code métier ouvrierId manquant ou invalide (format attendu : NUMERO-DOMAINE, jamais un UUID ni ID technique).'
      );
    }
    if (!g.nomOuvrier) {
      blockingErrors.push('Nom réel de l’ouvrier manquant.');
    }
    if (!/^D\d{3}$/.test(g.dtCode)) {
      blockingErrors.push(`Code Domaine DT invalide (${g.dtCode || 'vide'}).`);
    }
    if (g.serreMismatchErrors.size > 0) {
      g.serreMismatchErrors.forEach((m) => blockingErrors.push(m));
    }

    if (statut === 'EN COURS') {
      if (!g.tacheObj) {
        pendingWarnings.push('Tâche non affectée au Pointage Matin : saisir tâche et tarif pour valider.');
      } else if (!autoCls.isConfirmed && !hasManualValidation) {
        pendingWarnings.push(autoCls.reason);
      } else if (calcMode === 'HEURE_TTT' && effectiveHours <= 0) {
        pendingWarnings.push('Heures réelles manquantes pour TTT D3 (16 DH/h) : statut EN COURS.');
      } else if (calcMode === 'CAISSE' && quantiteMetrique === '') {
        pendingWarnings.push('Quantité de caisses réelle manquante pour la récolte : statut EN COURS.');
      } else if (calcMode === 'STANDARD_HORAIRE' && effectiveHours <= 0) {
        pendingWarnings.push('Heures réelles absentes du pointage : aucune durée inventée (statut EN COURS).');
      } else {
        pendingWarnings.push('En attente de validation du tarif par l’administrateur.');
      }
    } else {
      if (tarifExcep === '' || Number(tarifExcep) <= 0) {
        blockingErrors.push('Ligne VALIDÉE sans tarifExcep.');
      }
      if (remuneration === '' || Number(remuneration) <= 0) {
        blockingErrors.push('Ligne VALIDÉE sans montant de rémunération.');
      }
    }

    const docId = `${g.dtCode}_${dateIso}_${ouvrierId || 'CODE_ABSENT'}_${idx + 1}`;

    return {
      rowKey: g.groupKey,
      workerKey: g.workerKey,
      tacheId: g.tacheId,
      numeroOuvrier: g.numeroOuvrier,
      domaineId: g.domaineId,
      domaineShort: g.domaineShort,
      autoType: autoCls.type,
      calcMode,
      classificationReason: autoCls.reason,
      isAutoConfirmed: autoCls.isConfirmed,
      isManuallyValidated: hasManualValidation,
      isLockedValidation,
      effectiveHours: hasExplicitHours || statut === 'VALIDÉE' || effectiveHours > 0 ? effectiveHours : 0,
      recolteCaissesSource: g.recolteEntriesCount > 0 ? g.recolteCaisses : null,
      recolteEntriesCount: g.recolteEntriesCount,
      affectationsCount: g.affectationsCount,
      pointageHeure: g.pointageHeure,
      blockingErrors,
      pendingWarnings,
      // 21 colonnes exactes dans l'ordre du modèle
      docId,
      dateTrava: dateIso,
      ouvrierId,
      nomOuvrier: g.nomOuvrier,
      DT: g.dtCode,
      serreId,
      rubanId: ADMIN_EXPORT_RUBAN_LABEL,
      cultureId: Array.from(g.cultureSet).join('+'),
      tacheTypeId: g.tacheTypeId,
      tache: g.tacheNom,
      uniteMetrique,
      quantiteMetrique,
      quantite,
      heureDeb,
      heureFin,
      dureeRep,
      periodeJo,
      statut,
      equipeId: Array.from(g.equipeSet).join(', '),
      tarifExcep,
      remuneration,
    };
  });

  // Vérification doublons docId / rowKey
  const seenRowKeys = new Set<string>();
  const seenDocIds = new Set<string>();
  let hasDuplicates = false;
  rows.forEach((r) => {
    if (seenRowKeys.has(r.rowKey) || seenDocIds.has(r.docId)) {
      hasDuplicates = true;
      r.blockingErrors.push('Doublon détecté sur la ligne exportée.');
    }
    seenRowKeys.add(r.rowKey);
    seenDocIds.add(r.docId);
  });

  const enCoursRows = rows.filter((r) => r.statut === 'EN COURS');
  const valideeRows = rows.filter((r) => r.statut === 'VALIDÉE');

  // Totaux VALIDÉS uniquement par ouvrier (EN COURS exclus)
  const workerTotalsMap = new Map<string, AdminWorkerTotal>();
  rows.forEach((r) => {
    const prev = workerTotalsMap.get(r.workerKey) || {
      workerKey: r.workerKey,
      ouvrierId: r.ouvrierId,
      numeroOuvrier: r.numeroOuvrier,
      nomOuvrier: r.nomOuvrier,
      validatedRowsCount: 0,
      pendingRowsCount: 0,
      totalValidatedDH: 0,
    };
    if (r.statut === 'VALIDÉE' && typeof r.remuneration === 'number') {
      prev.validatedRowsCount += 1;
      prev.totalValidatedDH = roundAdminAmount(prev.totalValidatedDH + r.remuneration);
    } else {
      prev.pendingRowsCount += 1;
    }
    workerTotalsMap.set(r.workerKey, prev);
  });

  const totalByWorker = Array.from(workerTotalsMap.values()).sort(
    (a, b) => a.numeroOuvrier - b.numeroOuvrier
  );

  // Totaux VALIDÉS uniquement par domaine (EN COURS exclus)
  const domTotalsMap = new Map<
    string,
    {
      DT: string;
      domaineShort: string;
      domaineId: string;
      validatedRowsCount: number;
      pendingRowsCount: number;
      validatedWorkers: Set<string>;
      totalValidatedDH: number;
    }
  >();

  rows.forEach((r) => {
    const prev = domTotalsMap.get(r.DT) || {
      DT: r.DT,
      domaineShort: r.domaineShort,
      domaineId: r.domaineId,
      validatedRowsCount: 0,
      pendingRowsCount: 0,
      validatedWorkers: new Set<string>(),
      totalValidatedDH: 0,
    };
    if (r.statut === 'VALIDÉE' && typeof r.remuneration === 'number') {
      prev.validatedRowsCount += 1;
      prev.validatedWorkers.add(r.workerKey);
      prev.totalValidatedDH = roundAdminAmount(prev.totalValidatedDH + r.remuneration);
    } else {
      prev.pendingRowsCount += 1;
    }
    domTotalsMap.set(r.DT, prev);
  });

  const totalByDomaine: AdminDomaineTotal[] = Array.from(domTotalsMap.values())
    .map((d) => ({
      DT: d.DT,
      domaineShort: d.domaineShort,
      domaineId: d.domaineId,
      validatedRowsCount: d.validatedRowsCount,
      pendingRowsCount: d.pendingRowsCount,
      ouvriersValidatedCount: d.validatedWorkers.size,
      totalValidatedDH: d.totalValidatedDH,
    }))
    .sort((a, b) => a.DT.localeCompare(b.DT));

  const grandTotalValidatedDH = roundAdminAmount(
    valideeRows.reduce((sum, r) => sum + (typeof r.remuneration === 'number' ? r.remuneration : 0), 0)
  );

  const sumByWorkers = roundAdminAmount(
    totalByWorker.reduce((sum, w) => sum + w.totalValidatedDH, 0)
  );
  const sumByDomaines = roundAdminAmount(
    totalByDomaine.reduce((sum, d) => sum + d.totalValidatedDH, 0)
  );
  const totalsMatchValidated =
    Math.abs(grandTotalValidatedDH - sumByWorkers) < 0.001 &&
    Math.abs(grandTotalValidatedDH - sumByDomaines) < 0.001;

  const blockingIssues: AdminValidationIssue[] = rows
    .filter((r) => r.blockingErrors.length > 0)
    .map((r) => ({
      rowKey: r.rowKey,
      ouvrierId: r.ouvrierId,
      nomOuvrier: r.nomOuvrier,
      DT: r.DT,
      tache: r.tache || '(Sans tâche)',
      severity: 'error',
      messages: r.blockingErrors,
    }));

  const pendingIssues: AdminValidationIssue[] = rows
    .filter((r) => r.pendingWarnings.length > 0)
    .map((r) => ({
      rowKey: r.rowKey,
      ouvrierId: r.ouvrierId,
      nomOuvrier: r.nomOuvrier,
      DT: r.DT,
      tache: r.tache || '(Sans tâche)',
      severity: 'warning',
      messages: r.pendingWarnings,
    }));

  const checks: AdminPreExportChecks = {
    dateValid,
    hasRows: rows.length > 0,
    hasDuplicates,
    missingTasksCount: rows.filter((r) => !r.tache).length,
    enCoursCount: enCoursRows.length,
    valideeCount: valideeRows.length,
    totalsMatchValidated,
    blockingIssues,
    pendingIssues,
  };

  return {
    rows,
    enCoursRows,
    valideeRows,
    totalByWorker,
    totalByDomaine,
    grandTotalValidatedDH,
    totalOuvriersDistincts: totalByWorker.length,
    totalOuvriersValidated: totalByWorker.filter((w) => w.validatedRowsCount > 0).length,
    checks,
    canExport: dateValid && rows.length > 0 && !hasDuplicates && blockingIssues.length === 0 && totalsMatchValidated,
  };
}

export function getAdminExportRemunerationFilename(
  dateIso: string,
  domaineFilter: string,
  domaines: Domaine[]
): string {
  const domObj = domaines.find((d) => d.id === domaineFilter);
  const dt =
    !domaineFilter || domaineFilter === 'ALL'
      ? 'TOUS_DOMAINES'
      : formatAdminDomaineDT(domObj?.nom || domaineFilter, domaineFilter) || 'DOMAINE';
  return `EXPORT_REMUNERATION_${dt}_${dateIso}.xlsx`;
}

function rowToExcelValues(r: AdminRemunerationExcelRow): (string | number)[] {
  return [
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
    r.quantiteMetrique === '' ? '' : r.quantiteMetrique,
    r.quantite === '' ? '' : r.quantite,
    r.heureDeb,
    r.heureFin,
    r.dureeRep === '' ? '' : r.dureeRep,
    r.periodeJo,
    r.statut,
    r.equipeId,
    r.statut === 'VALIDÉE' && r.tarifExcep !== '' ? r.tarifExcep : '',
    r.statut === 'VALIDÉE' && r.remuneration !== '' ? r.remuneration : '',
  ];
}

function cloneStyleSafe<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return obj;
  }
}

export async function validateAdminExcelTemplate(
  templateBuffer: ArrayBuffer | Uint8Array
): Promise<{
  valid: boolean;
  sheetName?: string;
  headers?: string[];
  error?: string;
}> {
  try {
    const workbook = new ExcelJS.Workbook();
    const rawArr =
      templateBuffer instanceof Uint8Array
        ? new Uint8Array(templateBuffer)
        : new Uint8Array(templateBuffer);
    const copiedAb = new ArrayBuffer(rawArr.byteLength);
    new Uint8Array(copiedAb).set(rawArr);
    await workbook.xlsx.load(copiedAb);

    if (workbook.worksheets.length !== 1) {
      return {
        valid: false,
        error: `Le modèle Excel doit contenir exactement 1 feuille nommée "${ADMIN_EXPORT_SHEET_NAME}" (${workbook.worksheets.length} trouvée(s)).`,
      };
    }

    const ws = workbook.worksheets[0];
    if (!ws || ws.name !== ADMIN_EXPORT_SHEET_NAME) {
      return {
        valid: false,
        error: `La feuille unique doit se nommer exactement "${ADMIN_EXPORT_SHEET_NAME}" (trouvé : "${ws?.name || ''}").`,
      };
    }

    const headerRow = ws.getRow(1);
    const actualHeaders: string[] = [];
    for (let c = 1; c <= ADMIN_EXPORT_EXCEL_COLUMNS.length; c++) {
      actualHeaders.push(String(headerRow.getCell(c).value ?? '').trim());
    }

    for (let i = 0; i < ADMIN_EXPORT_EXCEL_COLUMNS.length; i++) {
      if (actualHeaders[i] !== ADMIN_EXPORT_EXCEL_COLUMNS[i]) {
        return {
          valid: false,
          sheetName: ws.name,
          headers: actualHeaders,
          error: `Colonne ${i + 1} invalide dans le modèle : attendu "${ADMIN_EXPORT_EXCEL_COLUMNS[i]}", trouvé "${actualHeaders[i] || '(vide)'}".`,
        };
      }
    }

    const maxCols = Math.max(ws.columnCount || 0, headerRow.cellCount || 0);
    for (let c = ADMIN_EXPORT_EXCEL_COLUMNS.length + 1; c <= maxCols; c++) {
      const extraVal = String(headerRow.getCell(c).value ?? '').trim();
      if (extraVal) {
        return {
          valid: false,
          sheetName: ws.name,
          headers: actualHeaders,
          error: `Colonne supplémentaire non autorisée détectée en position ${c} ("${extraVal}"). Exactement 21 colonnes sont autorisées.`,
        };
      }
    }

    return {
      valid: true,
      sheetName: ws.name,
      headers: actualHeaders,
    };
  } catch (err: unknown) {
    return {
      valid: false,
      error:
        err instanceof Error
          ? `Impossible de lire le modèle Excel : ${err.message}`
          : 'Impossible de lire le modèle Excel.',
    };
  }
}

/**
 * Construit le classeur Excel (.xlsx) EXCLUSIVEMENT depuis le fichier modèle original :
 * - Si `templateBuffer` est absent, ARRÊTE la génération sans jamais inventer de modèle de remplacement.
 * - Vérifie strictement la feuille unique "Pointage" et les 21 colonnes exactes dans l'ordre.
 * - Supprime les lignes d'exemple (>= 2) sans modifier aucune propriété, colonne, style ni vue du modèle.
 * - N'ajoute artificiellement ni gel de volets, ni filtre automatique, ni mise en forme absente du modèle.
 */
export async function buildAdminExportWorkbook(
  rows: AdminRemunerationExcelRow[],
  templateBuffer?: ArrayBuffer | Uint8Array | null
): Promise<{ workbook: ExcelJS.Workbook; usedTemplateFile: boolean }> {
  if (!templateBuffer || templateBuffer.byteLength === 0) {
    throw new Error(
      `TEMPLATE_MISSING: Modèle Excel original "${ADMIN_EXPORT_TEMPLATE_FILENAME}" absent de l’environnement. Veuillez l’importer avant de générer l’export.`
    );
  }

  const tplCheck = await validateAdminExcelTemplate(templateBuffer);
  if (!tplCheck.valid) {
    throw new Error(`TEMPLATE_INVALID: ${tplCheck.error}`);
  }

  const workbook = new ExcelJS.Workbook();
  const rawArr =
    templateBuffer instanceof Uint8Array
      ? new Uint8Array(templateBuffer)
      : new Uint8Array(templateBuffer);
  const copiedAb = new ArrayBuffer(rawArr.byteLength);
  new Uint8Array(copiedAb).set(rawArr);
  await workbook.xlsx.load(copiedAb);

  const ws = workbook.getWorksheet(ADMIN_EXPORT_SHEET_NAME)!;
  const hadAutoFilter = Boolean(ws.autoFilter);

  // Mémoriser uniquement les styles/hauteur réellement présents sur la ligne 2 du modèle original
  const sampleRow = ws.rowCount >= 2 ? ws.getRow(2) : null;
  const sampleRowHeight = sampleRow?.height;
  const colTemplateStyles: Partial<ExcelJS.Style>[] = [];
  for (let c = 1; c <= ADMIN_EXPORT_EXCEL_COLUMNS.length; c++) {
    const cell = sampleRow ? sampleRow.getCell(c) : null;
    colTemplateStyles.push(cell?.style ? cloneStyleSafe(cell.style) : {});
  }

  // Supprimer toutes les lignes d'exemple (>= 2) sans toucher à l'en-tête ni aux propriétés du modèle
  if (ws.rowCount > 1) {
    ws.spliceRows(2, ws.rowCount - 1);
  }

  // Injecter uniquement les données réelles du jour dans les 21 colonnes existantes
  rows.forEach((r, idx) => {
    const targetRow = ws.getRow(idx + 2);
    if (sampleRowHeight !== undefined) {
      targetRow.height = sampleRowHeight;
    }
    const values = rowToExcelValues(r);
    values.forEach((val, colIdx) => {
      const cell = targetRow.getCell(colIdx + 1);
      if (colTemplateStyles[colIdx] && Object.keys(colTemplateStyles[colIdx]).length > 0) {
        cell.style = cloneStyleSafe(colTemplateStyles[colIdx]);
      }
      cell.value = val === '' ? null : val;
    });
    targetRow.commit();
  });

  // Mettre à jour l'autoFilter UNIQUEMENT s'il figurait déjà dans le modèle original
  if (hadAutoFilter) {
    ws.autoFilter = `A1:U${Math.max(rows.length + 1, 1)}`;
  }

  return { workbook, usedTemplateFile: true };
}

export async function exportAdminRemunerationExcel(params: {
  rows: AdminRemunerationDraftRow[];
  dateIso: string;
  domaineFilter: string;
  domaines: Domaine[];
  currentUser?: Pick<UserAccount, 'role' | 'module_attribue' | 'actif'> | null;
  templateBuffer?: ArrayBuffer | Uint8Array | null;
  skipBrowserDownload?: boolean;
}): Promise<{
  success: boolean;
  filename: string;
  totalLignes: number;
  enCoursCount: number;
  valideeCount: number;
  usedTemplateFile: boolean;
  needsTemplateImport?: boolean;
  workbook?: ExcelJS.Workbook;
  buffer?: Uint8Array;
  error?: string;
}> {
  if (params.currentUser !== undefined && !isAdminExportAuthorized(params.currentUser)) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      enCoursCount: 0,
      valideeCount: 0,
      usedTemplateFile: false,
      error: 'Accès refusé : EXPORT RÉMUNÉRATION est strictement réservé à l’administrateur.',
    };
  }

  const {
    rows,
    dateIso,
    domaineFilter,
    domaines,
    templateBuffer = null,
    skipBrowserDownload = false,
  } = params;

  if (!templateBuffer || templateBuffer.byteLength === 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      enCoursCount: rows ? rows.filter((r) => r.statut === 'EN COURS').length : 0,
      valideeCount: rows ? rows.filter((r) => r.statut === 'VALIDÉE').length : 0,
      usedTemplateFile: false,
      needsTemplateImport: true,
      error: `Génération arrêtée : le modèle Excel original "${ADMIN_EXPORT_TEMPLATE_FILENAME}" est absent. Veuillez l’importer avant d’exporter.`,
    };
  }

  if (!rows || rows.length === 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      enCoursCount: 0,
      valideeCount: 0,
      usedTemplateFile: false,
      error: 'Aucun ouvrier présent dans Pointage Matin pour cette date et ce domaine.',
    };
  }

  const blockingErrors = rows.filter((r) => r.blockingErrors.length > 0);
  if (blockingErrors.length > 0) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      enCoursCount: rows.filter((r) => r.statut === 'EN COURS').length,
      valideeCount: rows.filter((r) => r.statut === 'VALIDÉE').length,
      usedTemplateFile: false,
      error: `Export bloqué : ${blockingErrors.length} ligne(s) comportent des anomalies structurelles (${blockingErrors[0].blockingErrors[0]}).`,
    };
  }

  try {
    const filename = getAdminExportRemunerationFilename(dateIso, domaineFilter, domaines);
    const { workbook, usedTemplateFile } = await buildAdminExportWorkbook(rows, templateBuffer);
    const rawOut = await workbook.xlsx.writeBuffer();
    const buffer = rawOut instanceof Uint8Array ? rawOut : new Uint8Array(rawOut);

    if (!skipBrowserDownload && typeof document !== 'undefined' && typeof URL !== 'undefined') {
      const blob = new Blob([buffer as BlobPart], {
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
    }

    return {
      success: true,
      filename,
      totalLignes: rows.length,
      enCoursCount: rows.filter((r) => r.statut === 'EN COURS').length,
      valideeCount: rows.filter((r) => r.statut === 'VALIDÉE').length,
      usedTemplateFile,
      workbook,
      buffer,
    };
  } catch (err: unknown) {
    return {
      success: false,
      filename: '',
      totalLignes: 0,
      enCoursCount: 0,
      valideeCount: 0,
      usedTemplateFile: false,
      error: err instanceof Error ? err.message : 'Erreur lors de la génération Excel.',
    };
  }
}
